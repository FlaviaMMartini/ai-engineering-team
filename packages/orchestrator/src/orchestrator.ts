import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import {
  estimatedContextAvoided,
  sumTokenUsage,
  ZERO_TOKEN_USAGE,
  type ContextPack,
  type ProjectId,
  type RepositoryId,
  type Task,
  type TokenBudget,
  type TokenCost,
  type TokenUsage,
  type WorkflowExecution
} from '@aet/domain';
import type { AgentResult, ArchitectPlan, DeveloperOutput, PriorContextExpansionOutcome, QAResult } from '@aet/agent-runtime';
import type { ContextCandidate, ContextEngine } from '@aet/context-engine';
import type { AiWorktree, GitRepository } from '@aet/git-integration';
import type { ModelRouter } from '@aet/model-router';
import { applyUsageToBudget, buildTaskTokenMetrics, summarizeRetryOverhead, type RetryUsageEntry } from '@aet/token-intelligence';
import type { AgentRuntime } from '@aet/agent-runtime';
import type { WorkflowEngine, WorkflowEventPublisher } from '@aet/workflow-engine';
import { evaluateContextExpansion } from './context-expansion.js';
import { getExecutionDiff } from './diff.js';
import { OrchestrationError } from './errors.js';
import { recordAgentExecution, recordAgentExecutionStarted, recordContextMetric, type OrchestratorPersistence } from './recording.js';
import { reviewExecution } from './review.js';
import type {
  EvaluatedContextExpansion,
  ExecuteTaskInput,
  ExecutionDiff,
  HumanReviewResult,
  Orchestrator,
  OrchestrationOutcome,
  OrchestrationResult,
  ReviewExecutionInput
} from './types.js';

export interface OrchestratorDependencies {
  workflowEngine: WorkflowEngine;
  /**
   * Phase 19 (BYOK): an `AgentRuntime` is no longer a fixed, shared
   * instance — it must be built per execution, scoped to that execution's
   * own project, so each agent call resolves that project's own provider
   * credential (never a globally-shared one). The composition root
   * supplies this factory; the Orchestrator only calls it once per
   * `execute()` and never touches a `CredentialStore`, a project's
   * provider configuration, or any secret itself — it "não manipula
   * secrets" exactly as this phase requires. Constructing an `AgentRuntime`
   * is cheap (pure object/closure wiring, no I/O — see composition root's
   * own doc comment on this), so doing it once per execution costs nothing
   * measurable.
   */
  createAgentRuntimeForProject: (projectId: ProjectId) => AgentRuntime;
  contextEngine: ContextEngine;
  /**
   * Phase 21 (repository selection): resolves and opens the specific
   * repository a task targets, by its `Task.repositoryId` — never a single,
   * fixed repository for the whole application anymore. The composition
   * root looks up the registered `Repository` row (or, for a task with no
   * repository selected, one it already scaffolded from scratch — see
   * apps/api's repository-management flow) and calls
   * `GitRepository.open()`. Called once per `execute()`, right after the
   * task itself is loaded, exactly like `createAgentRuntimeForProject`.
   */
  createGitRepositoryForTask: (repositoryId: RepositoryId) => Promise<GitRepository>;
  persistence: OrchestratorPersistence;
  /**
   * Accepted for contract completeness (per this phase's suggested
   * dependency shape) but never called directly — Agent Runtime already
   * has its own Model Router wired in internally. Orchestrator selects no
   * models itself.
   */
  modelRouter?: ModelRouter;
  /**
   * Phase 16: used only by `reviewExecution()` to publish
   * HUMAN_REVIEW_APPROVED/REJECTED after its transaction commits. Optional,
   * defaulting to a no-op publisher — same status as every other
   * WorkflowEvent in this codebase today (see workflow-engine/src/events.ts:
   * no real transport exists yet). `execute()` never uses this; its own
   * events still go exclusively through `workflowEngine`.
   */
  eventPublisher?: WorkflowEventPublisher;
}

interface ExecutionAccumulator {
  actualUsageTotal: TokenUsage;
  costs: (TokenCost | null)[];
  retryEntries: RetryUsageEntry[];
  lastProvider: string | null;
  lastModel: string | null;
  estimatedContextAvoidedTokens: number | null;
}

function newAccumulator(): ExecutionAccumulator {
  return {
    actualUsageTotal: ZERO_TOKEN_USAGE,
    costs: [],
    retryEntries: [],
    lastProvider: null,
    lastModel: null,
    estimatedContextAvoidedTokens: null
  };
}

function trackAgentResult(acc: ExecutionAccumulator, result: AgentResult<unknown>, retryNumber: number): void {
  acc.actualUsageTotal = sumTokenUsage(acc.actualUsageTotal, result.usage);
  acc.costs.push(result.cost);
  if (result.provider !== null) acc.lastProvider = result.provider;
  if (result.model !== null) acc.lastModel = result.model;
  if (retryNumber > 0) {
    acc.retryEntries.push({ usage: result.usage, calculatedCost: result.cost?.calculatedCost ?? null });
  }
}

/** Sums known cost fields across every LLM call made this execution. `pricingVersion`/`currency` fall back to the most recent known value — an approximation when different calls used different pricing versions (see the Phase 10 report). */
function sumCosts(costs: readonly (TokenCost | null)[]): TokenCost {
  const known = costs.filter((cost): cost is TokenCost => cost !== null);
  const sumField = (pick: (cost: TokenCost) => number | null): number | null => {
    const values = known.map(pick).filter((value): value is number => value !== null);
    return values.length === 0 ? null : values.reduce((total, value) => total + value, 0);
  };
  const last = known[known.length - 1];
  return {
    estimatedCost: sumField((cost) => cost.estimatedCost),
    calculatedCost: sumField((cost) => cost.calculatedCost),
    pricingVersion: last?.pricingVersion ?? null,
    currency: last?.currency ?? 'USD'
  };
}

async function cleanupWorktree(gitRepository: GitRepository, worktree: AiWorktree): Promise<string | null> {
  try {
    // force: true — this path only runs when the automated attempt already failed and is being
    // discarded; there is no recovery path in this phase for uncommitted work in a failed worktree.
    await gitRepository.removeWorktree(worktree, { force: true });
    return null;
  } catch (error) {
    return error instanceof Error ? error.message : 'Failed to clean up worktree';
  }
}

function now(): string {
  return new Date().toISOString();
}

/**
 * Builds a new `ContextPack` carrying everything `base` already had plus
 * the approved files' real content, read fresh from `repositoryRoot` (the
 * same root Context Engine itself scanned — see orchestrator.ts's Context
 * Engine call). `filesApproved` paths always come from `candidates` (never
 * from an LLM-supplied path directly), so they were already validated as
 * inside the repository root by Context Engine's own discovery step — no
 * new path-safety check is needed here. A file that's unreadable by the
 * time this runs (removed, permissions changed) is skipped rather than
 * failing the whole expansion — the Developer simply won't see it, same as
 * if it had never been found.
 */
function buildExpandedContextPack(
  repositoryRoot: string,
  base: ContextPack,
  candidates: readonly ContextCandidate[],
  filesApproved: readonly string[],
  newContextPackId: string,
  createdAt: string
): ContextPack {
  const alreadyIncluded = new Set(base.files.map((file) => file.filePath));
  const candidatesByPath = new Map(candidates.map((candidate) => [candidate.path, candidate]));

  const newFiles: { filePath: string; content: string }[] = [];
  let addedTokens = 0;
  for (const path of filesApproved) {
    if (alreadyIncluded.has(path)) continue;
    const candidate = candidatesByPath.get(path);
    if (candidate === undefined) continue;
    try {
      const content = readFileSync(join(repositoryRoot, path), 'utf8');
      newFiles.push({ filePath: path, content });
      addedTokens += candidate.estimatedTokens;
    } catch {
      continue;
    }
  }

  return {
    id: newContextPackId,
    taskId: base.taskId,
    agentExecutionId: base.agentExecutionId,
    files: [...base.files, ...newFiles],
    metric: {
      ...base.metric,
      filesSelected: base.metric.filesSelected + newFiles.length,
      estimatedSelectedContextTokens: base.metric.estimatedSelectedContextTokens + addedTokens
    },
    createdAt
  };
}

export function createOrchestrator(deps: OrchestratorDependencies): Orchestrator {
  async function finalize(
    outcome: OrchestrationOutcome,
    task: Task,
    workflowExecution: WorkflowExecution,
    worktree: AiWorktree | null,
    budget: TokenBudget,
    acc: ExecutionAccumulator,
    extras: {
      architectPlan?: ArchitectPlan | null;
      developerOutput?: DeveloperOutput | null;
      qaResult?: QAResult | null;
      evaluatedContextExpansion?: EvaluatedContextExpansion | null;
      errorMessage?: string | null;
    } = {}
  ): Promise<OrchestrationResult> {
    const updatedBudget = applyUsageToBudget(budget, acc.actualUsageTotal);
    try {
      deps.persistence.tasks.updateBudget(updatedBudget);
    } catch {
      // Best-effort bookkeeping — a failure here should not mask the actual outcome being returned.
    }

    const taskTokenMetrics = buildTaskTokenMetrics({
      taskId: task.id,
      budget: updatedBudget,
      cost: sumCosts(acc.costs),
      estimatedContextAvoided: acc.estimatedContextAvoidedTokens,
      retryOverhead: summarizeRetryOverhead(acc.retryEntries),
      contextExpansions: [],
      provider: acc.lastProvider,
      model: acc.lastModel
    });

    return {
      outcome,
      task,
      workflowExecution,
      architectPlan: extras.architectPlan ?? null,
      developerOutput: extras.developerOutput ?? null,
      qaResult: extras.qaResult ?? null,
      worktree,
      evaluatedContextExpansion: extras.evaluatedContextExpansion ?? null,
      taskTokenMetrics,
      errorMessage: extras.errorMessage ?? null
    };
  }

  async function transitionOrThrow(
    executionId: string,
    taskId: string,
    to: Parameters<WorkflowEngine['transition']>[0]['to'],
    event: Parameters<WorkflowEngine['transition']>[0]['event'],
    failureMessage: string
  ) {
    try {
      return await deps.workflowEngine.transition({ executionId, taskId, to, timestamp: now(), event });
    } catch (error) {
      throw new OrchestrationError('workflow_transition_failed', failureMessage, { cause: error });
    }
  }

  async function execute(input: ExecuteTaskInput): Promise<OrchestrationResult> {
    const initialTask = deps.persistence.tasks.findById(input.taskId);
    if (initialTask === null) {
      throw new OrchestrationError('task_not_found', `Task not found: ${input.taskId}`);
    }
    const budget = deps.persistence.tasks.findBudgetByTaskId(input.taskId);
    if (budget === null) {
      throw new OrchestrationError('task_not_found', `TokenBudget not found for task: ${input.taskId}`);
    }

    // Phase 19 (BYOK): resolved once per execution, scoped to this task's own project — every
    // agent call below uses this instance, never a globally-shared one (see OrchestratorDependencies).
    const agentRuntime = deps.createAgentRuntimeForProject(initialTask.projectId);

    // Phase 21 (repository selection): resolved once per execution, scoped to this task's own
    // repository — never a single, fixed repository for the whole application (see
    // OrchestratorDependencies). A failure here (e.g. the registered repository's folder was
    // moved/deleted since registration) is an infrastructure problem, not a modeled outcome, so
    // it's wrapped and thrown like the other setup steps below, not returned as 'blocked'/'failed'.
    let gitRepository: GitRepository;
    try {
      gitRepository = await deps.createGitRepositoryForTask(initialTask.repositoryId);
    } catch (error) {
      throw new OrchestrationError(
        'repository_unavailable',
        `Failed to open the repository for task ${input.taskId} (repositoryId: ${initialTask.repositoryId})`,
        { cause: error }
      );
    }

    let workflowExecution: WorkflowExecution;
    try {
      ({ workflowExecution } = await deps.workflowEngine.start({
        executionId: input.executionId,
        taskId: input.taskId,
        startedAt: now()
      }));
    } catch (error) {
      throw new OrchestrationError('workflow_start_failed', `Failed to start workflow for task ${input.taskId}`, { cause: error });
    }

    const acc = newAccumulator();

    // --- BACKLOG -> PLANNING ---
    const architectExecutionId = randomUUID();
    let taskResult = await transitionOrThrow(
      input.executionId,
      input.taskId,
      'PLANNING',
      { type: 'AGENT_STARTED', agentExecutionId: architectExecutionId, agentRole: 'ARCHITECT' },
      `Failed to transition task ${input.taskId} to PLANNING`
    );
    let task = taskResult.task;
    workflowExecution = taskResult.workflowExecution;

    // --- Context Engine ---
    const contextPackId = randomUUID();
    const buildResult = (() => {
      try {
        return deps.contextEngine.buildContext({
          repositoryRoot: gitRepository.path,
          taskId: input.taskId,
          contextPackId,
          taskDescription: task.description,
          maxContextTokens: input.maxContextTokens,
          createdAt: now()
        });
      } catch (error) {
        throw new OrchestrationError('context_build_failed', `Context Engine failed to build context for task ${input.taskId}`, {
          cause: error
        });
      }
    })();
    acc.estimatedContextAvoidedTokens = estimatedContextAvoided(buildResult.contextPack.metric);
    recordContextMetric(deps.persistence, randomUUID(), input.taskId, input.executionId, buildResult.contextPack);

    // --- Architect ---
    recordAgentExecutionStarted(deps.persistence, {
      agentExecutionId: architectExecutionId,
      taskId: input.taskId,
      workflowExecutionId: input.executionId,
      agentRole: 'ARCHITECT',
      retryNumber: 0,
      startedAt: now()
    });
    const architectResult = await agentRuntime.architect.execute({
      task,
      contextPack: buildResult.contextPack,
      repositorySummary: buildResult.repositorySummary,
      executionContext: {
        agentExecutionId: architectExecutionId,
        taskId: input.taskId,
        workflowExecutionId: input.executionId,
        retryNumber: 0
      },
      tokenBudget: budget
    });
    trackAgentResult(acc, architectResult, 0);
    recordAgentExecution(deps.persistence, randomUUID(), {
      agentExecutionId: architectExecutionId,
      taskId: input.taskId,
      workflowExecutionId: input.executionId,
      agentRole: 'ARCHITECT',
      retryNumber: 0,
      purpose: 'PLAN',
      artifactKind: 'PLAN',
      result: architectResult
    });

    if (architectResult.status !== 'success' || architectResult.output === null) {
      const blocked = await transitionOrThrow(
        input.executionId,
        input.taskId,
        'BLOCKED',
        { type: 'TASK_FAILED', reason: architectResult.error?.message ?? 'Architect failed to produce a plan' },
        `Failed to transition task ${input.taskId} to BLOCKED`
      );
      return finalize('blocked', blocked.task, blocked.workflowExecution, null, budget, acc, {
        errorMessage: architectResult.error?.message ?? 'Architect failed to produce a plan'
      });
    }

    const architectPlan = architectResult.output;

    // --- PLANNING -> READY ---
    taskResult = await transitionOrThrow(
      input.executionId,
      input.taskId,
      'READY',
      { type: 'LLM_REQUEST_COMPLETED', llmRequestId: architectExecutionId, usage: architectResult.usage },
      `Failed to transition task ${input.taskId} to READY`
    );
    task = taskResult.task;
    workflowExecution = taskResult.workflowExecution;

    // --- Isolated Git worktree ---
    // Phase 18: each WorkflowExecution gets its own worktree/branch, keyed by this task's
    // 1-indexed execution count so far (the current one, already persisted by workflowEngine.start()
    // above, included) — otherwise a second execution of the same task (e.g. after a Phase 16
    // HUMAN_REVIEW -> PLANNING rejection) would collide with the first execution's worktree/branch.
    const executionSequence = deps.persistence.workflowExecutions.findByTaskId(input.taskId).length;

    // Both steps below can throw after the task has already moved to READY (a persisted,
    // externally-visible checkpoint). Without catching here, a thrown OrchestrationError
    // propagates straight out of execute() with the task left stuck at READY forever — the
    // failure only ever existed in this one HTTP response, and TASK_TRANSITIONS has no
    // automatic path back out of that state. FAILED is legal from every task state, so on
    // either failure this transitions the task there and persists the real reason instead
    // of leaving a silent zombie the UI can only describe as "stuck."
    let worktree: AiWorktree;
    try {
      ({ worktree } = await gitRepository.createWorktree(input.taskId, task.description, executionSequence));

      // Durably associate this execution with the worktree it just created (Phase 17) —
      // without this, AiWorktree's own in-memory handle is lost once this HTTP response is
      // sent, and a later diff request would have no trusted way to find it again (see diff.ts).
      deps.persistence.executionWorktrees.create({
        executionId: input.executionId,
        taskId: input.taskId,
        worktreePath: worktree.path,
        branchName: worktree.branchName,
        baseCommitSha: worktree.baseCommitSha,
        createdAt: now()
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to prepare an isolated worktree for this task';
      const failed = await transitionOrThrow(
        input.executionId,
        input.taskId,
        'FAILED',
        { type: 'TASK_FAILED', reason: message },
        `Failed to transition task ${input.taskId} to FAILED after worktree setup failure`
      );
      return finalize('failed', failed.task, failed.workflowExecution, null, budget, acc, { errorMessage: message });
    }

    // --- READY -> IN_PROGRESS ---
    let developerExecutionId = randomUUID();
    taskResult = await transitionOrThrow(
      input.executionId,
      input.taskId,
      'IN_PROGRESS',
      { type: 'AGENT_STARTED', agentExecutionId: developerExecutionId, agentRole: 'DEVELOPER' },
      `Failed to transition task ${input.taskId} to IN_PROGRESS`
    );
    task = taskResult.task;
    workflowExecution = taskResult.workflowExecution;

    let retryNumber = 0;

    // Context expansion (see context-expansion.ts and buildExpandedContextPack above): bounded to
    // one attempt per execution. `activeContextPack` starts as the original pack and is swapped
    // for an expanded one only when a proposal is APPROVED/PARTIAL; `priorExpansionForDeveloper`
    // carries the explanation for the Developer's own retry prompt either way (see
    // PriorContextExpansionOutcome's doc comment).
    const MAX_CONTEXT_EXPANSIONS = 1;
    let contextExpansionCount = 0;
    let activeContextPack = buildResult.contextPack;
    let priorExpansionForDeveloper: PriorContextExpansionOutcome | null = null;

    // --- Developer / QA retry loop — bounded entirely by domain.retriesExhausted() via Workflow Engine ---
    for (;;) {
      recordAgentExecutionStarted(deps.persistence, {
        agentExecutionId: developerExecutionId,
        taskId: input.taskId,
        workflowExecutionId: input.executionId,
        agentRole: 'DEVELOPER',
        retryNumber,
        startedAt: now()
      });
      const developerResult = await agentRuntime.developer.execute({
        task,
        architectPlan,
        contextPack: activeContextPack,
        repositorySummary: buildResult.repositorySummary,
        executionContext: {
          agentExecutionId: developerExecutionId,
          taskId: input.taskId,
          workflowExecutionId: input.executionId,
          retryNumber
        },
        tokenBudget: budget,
        worktree,
        priorContextExpansion: priorExpansionForDeveloper
      });
      trackAgentResult(acc, developerResult, retryNumber);
      recordAgentExecution(deps.persistence, randomUUID(), {
        agentExecutionId: developerExecutionId,
        taskId: input.taskId,
        workflowExecutionId: input.executionId,
        agentRole: 'DEVELOPER',
        retryNumber,
        purpose: 'IMPLEMENTATION',
        artifactKind: 'DIFF_SUMMARY',
        result: developerResult
      });

      if (developerResult.status !== 'success' || developerResult.output === null) {
        const cleanupError = await cleanupWorktree(gitRepository, worktree);
        const failed = await transitionOrThrow(
          input.executionId,
          input.taskId,
          'FAILED',
          { type: 'TASK_FAILED', reason: developerResult.error?.message ?? 'Developer agent failed' },
          `Failed to transition task ${input.taskId} to FAILED after Developer failure`
        );
        return finalize('failed', failed.task, failed.workflowExecution, null, budget, acc, {
          architectPlan,
          errorMessage: [developerResult.error?.message ?? 'Developer agent failed', cleanupError ? `(cleanup also failed: ${cleanupError})` : null]
            .filter(Boolean)
            .join(' ')
        });
      }

      const developerOutput = developerResult.output;

      if (developerOutput.status === 'needs_context') {
        const proposal = developerOutput.contextExpansionProposal;
        const evaluated: EvaluatedContextExpansion | null =
          proposal === null ? null : evaluateContextExpansion(proposal, buildResult.candidates, budget, architectPlan.filesToCreate);

        // No proposal at all is a malformed-output edge case (parseOutput should always attach one
        // when status is 'needs_context') — nothing to act on, so this is a genuine stopping point.
        if (evaluated === null) {
          return finalize('context_expansion_required', task, workflowExecution, worktree, budget, acc, {
            architectPlan,
            developerOutput,
            evaluatedContextExpansion: null
          });
        }

        if (contextExpansionCount >= MAX_CONTEXT_EXPANSIONS) {
          // IN_PROGRESS can only legally move to QA or FAILED (see domain's TASK_TRANSITIONS) — and
          // there is no diff to send to QA here, so FAILED is the only honest option, exactly like
          // the Developer-failure branch above. A human can revise the plan and requeue the task.
          const cleanupError = await cleanupWorktree(gitRepository, worktree);
          const failed = await transitionOrThrow(
            input.executionId,
            input.taskId,
            'FAILED',
            { type: 'TASK_FAILED', reason: 'Developer still needs additional context after one expansion attempt' },
            `Failed to transition task ${input.taskId} to FAILED after exhausted context expansion`
          );
          return finalize('failed', failed.task, failed.workflowExecution, null, budget, acc, {
            architectPlan,
            developerOutput,
            evaluatedContextExpansion: evaluated,
            errorMessage: [
              `Developer requested "${proposal?.filesRequested.join(', ')}" again after a context expansion attempt.`,
              cleanupError ? `(cleanup also failed: ${cleanupError})` : null
            ]
              .filter(Boolean)
              .join(' ')
          });
        }

        // --- Resume: automatic decision already computed by evaluateContextExpansion (APPROVED/
        // PARTIAL/DENIED — see context-expansion.ts). Rebuild the context pack with whatever was
        // approved (nothing, for DENIED) and retry the Developer once with an explanation either way.
        contextExpansionCount += 1;
        activeContextPack = buildExpandedContextPack(
          gitRepository.path,
          buildResult.contextPack,
          buildResult.candidates,
          evaluated.filesApproved,
          randomUUID(),
          now()
        );
        priorExpansionForDeveloper = {
          filesRequested: evaluated.proposal.filesRequested,
          filesApproved: evaluated.filesApproved,
          filesNotFound: evaluated.filesNotFound,
          filesAlreadyPlannedToCreate: evaluated.filesAlreadyPlannedToCreate
        };
        retryNumber += 1;
        developerExecutionId = randomUUID();
        continue;
      }

      // --- IN_PROGRESS -> QA ---
      const qaExecutionId = randomUUID();
      taskResult = await transitionOrThrow(
        input.executionId,
        input.taskId,
        'QA',
        { type: 'FILES_MODIFIED', filePaths: developerOutput.filesChanged },
        `Failed to transition task ${input.taskId} to QA`
      );
      task = taskResult.task;
      workflowExecution = taskResult.workflowExecution;

      recordAgentExecutionStarted(deps.persistence, {
        agentExecutionId: qaExecutionId,
        taskId: input.taskId,
        workflowExecutionId: input.executionId,
        agentRole: 'QA',
        retryNumber,
        startedAt: now()
      });
      const qaAgentResult = await agentRuntime.qa.execute({
        task,
        architectPlan,
        contextPack: activeContextPack,
        repositorySummary: buildResult.repositorySummary,
        executionContext: {
          agentExecutionId: qaExecutionId,
          taskId: input.taskId,
          workflowExecutionId: input.executionId,
          retryNumber
        },
        tokenBudget: budget,
        // Real diff from git-integration — never the Developer's own textual claim about what changed.
        diff: developerOutput.diff ?? { files: [], additions: 0, deletions: 0, diffText: '' }
      });
      trackAgentResult(acc, qaAgentResult, retryNumber);
      recordAgentExecution(deps.persistence, randomUUID(), {
        agentExecutionId: qaExecutionId,
        taskId: input.taskId,
        workflowExecutionId: input.executionId,
        agentRole: 'QA',
        retryNumber,
        purpose: 'TEST_INTERPRETATION',
        artifactKind: 'TEST_RESULT_SUMMARY',
        result: qaAgentResult
      });

      if (qaAgentResult.status !== 'success' || qaAgentResult.output === null) {
        const cleanupError = await cleanupWorktree(gitRepository, worktree);
        const failed = await transitionOrThrow(
          input.executionId,
          input.taskId,
          'FAILED',
          { type: 'TASK_FAILED', reason: qaAgentResult.error?.message ?? 'QA agent failed' },
          `Failed to transition task ${input.taskId} to FAILED after QA agent failure`
        );
        return finalize('failed', failed.task, failed.workflowExecution, null, budget, acc, {
          architectPlan,
          developerOutput,
          errorMessage: [qaAgentResult.error?.message ?? 'QA agent failed', cleanupError ? `(cleanup also failed: ${cleanupError})` : null]
            .filter(Boolean)
            .join(' ')
        });
      }

      const qaResult = qaAgentResult.output;

      if (qaResult.status === 'pass') {
        const passed = await transitionOrThrow(
          input.executionId,
          input.taskId,
          'HUMAN_REVIEW',
          { type: 'QA_PASSED' },
          `Failed to transition task ${input.taskId} to HUMAN_REVIEW after QA pass`
        );
        return finalize('human_review_required', passed.task, passed.workflowExecution, worktree, budget, acc, {
          architectPlan,
          developerOutput,
          qaResult
        });
      }

      // qaResult.status === 'fail'
      const retryStatus = await deps.workflowEngine.getRetryStatus(input.taskId);
      if (retryStatus.retriesExhausted) {
        const exhausted = await transitionOrThrow(
          input.executionId,
          input.taskId,
          'HUMAN_REVIEW',
          {
            type: 'QA_FAILED',
            reason: `${qaResult.summary} (retries exhausted: ${retryStatus.retryCount}/${retryStatus.maxRetries})`
          },
          `Failed to transition task ${input.taskId} to HUMAN_REVIEW after exhausted retries`
        );
        return finalize('human_review_required', exhausted.task, exhausted.workflowExecution, worktree, budget, acc, {
          architectPlan,
          developerOutput,
          qaResult
        });
      }

      // Retry available: QA -> IN_PROGRESS. domain.transitionTask() increments retryCount for this exact transition.
      taskResult = await transitionOrThrow(
        input.executionId,
        input.taskId,
        'IN_PROGRESS',
        { type: 'QA_FAILED', reason: qaResult.summary },
        `Failed to transition task ${input.taskId} back to IN_PROGRESS for retry`
      );
      task = taskResult.task;
      workflowExecution = taskResult.workflowExecution;
      retryNumber += 1;
      developerExecutionId = randomUUID();
    }
  }

  return {
    execute,
    async getStatus(executionId) {
      return deps.workflowEngine.getExecution(executionId);
    },
    async reviewExecution(input: ReviewExecutionInput): Promise<HumanReviewResult> {
      return reviewExecution(deps.persistence, deps.eventPublisher, input);
    },
    async getExecutionDiff(executionId): Promise<ExecutionDiff | null> {
      return getExecutionDiff(deps.persistence, deps.createGitRepositoryForTask, executionId);
    }
  };
}
