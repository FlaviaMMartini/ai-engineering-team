import { describe, expect, it } from 'vitest';
import {
  DEFAULT_MAX_RETRIES,
  InvalidTaskTransitionError,
  canTransition,
  retriesExhausted,
  transitionTask,
  type Task
} from './task.js';

function makeTask(overrides: Partial<Task> = {}): Task {
  return {
    id: 'task-1',
    projectId: 'project-1',
    repositoryId: 'repo-1',
    description: 'Implement JWT authentication',
    state: 'BACKLOG',
    branchName: null,
    retryCount: 0,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides
  };
}

describe('canTransition', () => {
  it('allows every documented forward transition', () => {
    expect(canTransition('BACKLOG', 'PLANNING')).toBe(true);
    expect(canTransition('PLANNING', 'READY')).toBe(true);
    expect(canTransition('PLANNING', 'BLOCKED')).toBe(true);
    expect(canTransition('READY', 'IN_PROGRESS')).toBe(true);
    expect(canTransition('IN_PROGRESS', 'QA')).toBe(true);
    expect(canTransition('QA', 'HUMAN_REVIEW')).toBe(true);
    expect(canTransition('QA', 'IN_PROGRESS')).toBe(true);
    expect(canTransition('HUMAN_REVIEW', 'DONE')).toBe(true);
    expect(canTransition('HUMAN_REVIEW', 'IN_PROGRESS')).toBe(true);
    expect(canTransition('BLOCKED', 'PLANNING')).toBe(true);
  });

  it('allows any non-terminal state to fail', () => {
    for (const state of ['BACKLOG', 'PLANNING', 'READY', 'IN_PROGRESS', 'QA', 'HUMAN_REVIEW', 'BLOCKED'] as const) {
      expect(canTransition(state, 'FAILED')).toBe(true);
    }
  });

  it('rejects skipping stages', () => {
    expect(canTransition('BACKLOG', 'IN_PROGRESS')).toBe(false);
    expect(canTransition('BACKLOG', 'DONE')).toBe(false);
    expect(canTransition('PLANNING', 'QA')).toBe(false);
  });

  it('rejects moving out of a terminal state', () => {
    expect(canTransition('DONE', 'IN_PROGRESS')).toBe(false);
    expect(canTransition('FAILED', 'BACKLOG')).toBe(false);
  });

  it('rejects a state transitioning to itself unless explicitly listed', () => {
    expect(canTransition('BACKLOG', 'BACKLOG')).toBe(false);
  });
});

describe('transitionTask', () => {
  it('applies a valid transition and stamps updatedAt', () => {
    const task = makeTask({ state: 'BACKLOG' });
    const next = transitionTask(task, 'PLANNING', '2026-01-02T00:00:00.000Z');
    expect(next.state).toBe('PLANNING');
    expect(next.updatedAt).toBe('2026-01-02T00:00:00.000Z');
    expect(next).not.toBe(task);
  });

  it('throws InvalidTaskTransitionError on an illegal transition', () => {
    const task = makeTask({ state: 'BACKLOG' });
    expect(() => transitionTask(task, 'DONE', '2026-01-02T00:00:00.000Z')).toThrow(InvalidTaskTransitionError);
  });

  it('the thrown error carries the attempted from/to states', () => {
    const task = makeTask({ state: 'BACKLOG' });
    try {
      transitionTask(task, 'DONE', '2026-01-02T00:00:00.000Z');
      expect.unreachable('expected transitionTask to throw');
    } catch (error) {
      expect(error).toBeInstanceOf(InvalidTaskTransitionError);
      const transitionError = error as InvalidTaskTransitionError;
      expect(transitionError.from).toBe('BACKLOG');
      expect(transitionError.to).toBe('DONE');
    }
  });

  it('increments retryCount on a QA -> IN_PROGRESS retry', () => {
    const task = makeTask({ state: 'QA', retryCount: 1 });
    const next = transitionTask(task, 'IN_PROGRESS', '2026-01-02T00:00:00.000Z');
    expect(next.retryCount).toBe(2);
  });

  it('does not increment retryCount on a non-retry transition', () => {
    const task = makeTask({ state: 'QA', retryCount: 1 });
    const next = transitionTask(task, 'HUMAN_REVIEW', '2026-01-02T00:00:00.000Z');
    expect(next.retryCount).toBe(1);
  });

  it('recovers a BLOCKED task back to PLANNING after human intervention', () => {
    const task = makeTask({ state: 'BLOCKED' });
    const next = transitionTask(task, 'PLANNING', '2026-01-02T00:00:00.000Z');
    expect(next.state).toBe('PLANNING');
    expect(next.retryCount).toBe(task.retryCount);
  });

  it('does not mutate the input task', () => {
    const task = makeTask({ state: 'BACKLOG' });
    transitionTask(task, 'PLANNING', '2026-01-02T00:00:00.000Z');
    expect(task.state).toBe('BACKLOG');
  });
});

describe('retriesExhausted', () => {
  it('is false below the default max', () => {
    expect(retriesExhausted(makeTask({ retryCount: DEFAULT_MAX_RETRIES - 1 }))).toBe(false);
  });

  it('is true at or above the default max', () => {
    expect(retriesExhausted(makeTask({ retryCount: DEFAULT_MAX_RETRIES }))).toBe(true);
    expect(retriesExhausted(makeTask({ retryCount: DEFAULT_MAX_RETRIES + 1 }))).toBe(true);
  });

  it('honors a custom max', () => {
    expect(retriesExhausted(makeTask({ retryCount: 1 }), 1)).toBe(true);
    expect(retriesExhausted(makeTask({ retryCount: 0 }), 1)).toBe(false);
  });
});
