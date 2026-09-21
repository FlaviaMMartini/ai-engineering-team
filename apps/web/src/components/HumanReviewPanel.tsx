import { useId, useState } from 'react';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Card from '@mui/material/Card';
import CardContent from '@mui/material/CardContent';
import Chip from '@mui/material/Chip';
import Stack from '@mui/material/Stack';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';
import { ApiError } from '../api/client.js';
import { getExecutionDiff, reviewExecution } from '../api/executions.js';
import type { ExecutionDiffResponseBody, ReviewDecisionType, ReviewDto } from '../types/api.js';
import { formatTimestamp } from '../utils/format.js';
import { DiffViewer } from './DiffViewer.js';
import { ErrorState } from './ErrorState.js';

export interface HumanReviewPanelProps {
  taskId: string;
  executionId: string;
  taskStatus: string;
  review: ReviewDto | null;
  /** Called after a decision is successfully recorded, so the caller can re-fetch execution details. */
  onReviewed: () => void;
}

/**
 * Specific to this one use case (human review of an execution) — not a
 * generic approval component. Renders exactly one of three things: the
 * already-recorded decision, the review controls (only while the task is
 * genuinely awaiting review and no decision exists yet), or nothing. Both
 * of the first two also offer "View Diff" (Phase 17), fetched only on
 * explicit click via GET /executions/:executionId/diff — never
 * automatically, and never counted as part of the approval decision
 * itself. Never optimistically changes workflow state — `onReviewed` only
 * fires after the API confirms the decision was recorded.
 */
export function HumanReviewPanel({ taskId, executionId, taskStatus, review, onReviewed }: HumanReviewPanelProps) {
  const [comment, setComment] = useState('');
  const [submitting, setSubmitting] = useState<ReviewDecisionType | null>(null);
  const [error, setError] = useState<string | null>(null);
  const commentFieldId = useId();

  const [diff, setDiff] = useState<ExecutionDiffResponseBody | null>(null);
  const [diffLoading, setDiffLoading] = useState(false);
  const [diffError, setDiffError] = useState<string | null>(null);

  async function handleViewDiff(): Promise<void> {
    if (diffLoading) return;
    setDiffLoading(true);
    setDiffError(null);
    try {
      const result = await getExecutionDiff(executionId);
      setDiff(result);
    } catch (fetchError) {
      setDiffError(fetchError instanceof ApiError ? fetchError.message : 'Diff unavailable for this execution.');
    } finally {
      setDiffLoading(false);
    }
  }

  const diffSection = (
    <Stack spacing={1.5} sx={{ mt: 2 }}>
      <Button variant="outlined" size="small" onClick={() => void handleViewDiff()} disabled={diffLoading} sx={{ alignSelf: 'flex-start' }}>
        {diffLoading ? 'Loading diff…' : diff !== null ? 'Refresh Diff' : 'View Diff'}
      </Button>
      {diffError !== null && <ErrorState message={diffError} />}
      {diff !== null && (
        <DiffViewer key={diff.executionId} files={diff.files} additions={diff.additions} deletions={diff.deletions} truncated={diff.truncated} />
      )}
    </Stack>
  );

  if (review !== null) {
    return (
      <Card variant="outlined">
        <CardContent>
          <Typography variant="h3" sx={{ mb: 1.5 }}>
            Human Review
          </Typography>
          <Chip
            label={review.decision}
            color={review.decision === 'APPROVED' ? 'success' : 'error'}
            sx={{ mb: 1.5 }}
          />
          <Typography variant="body2">{review.comment ?? 'No comment left.'}</Typography>
          <Typography variant="caption" color="text.secondary">
            Decided {formatTimestamp(review.decidedAt)}
          </Typography>
          {diffSection}
        </CardContent>
      </Card>
    );
  }

  if (taskStatus !== 'HUMAN_REVIEW') {
    return null;
  }

  async function submit(decision: ReviewDecisionType): Promise<void> {
    if (submitting !== null) return;
    setSubmitting(decision);
    setError(null);
    try {
      const trimmed = comment.trim();
      await reviewExecution(executionId, { taskId, decision, comment: trimmed.length > 0 ? trimmed : null });
      onReviewed();
    } catch (submitError) {
      setError(submitError instanceof ApiError ? submitError.message : 'Unable to submit review decision.');
    } finally {
      setSubmitting(null);
    }
  }

  return (
    <Card variant="outlined" sx={{ borderColor: 'warning.main', borderWidth: 2 }}>
      <CardContent>
        <Typography variant="h3" sx={{ mb: 1 }}>
          Human Review
        </Typography>
        <Typography variant="body2" color="text.secondary">
          The AI implementation is ready for review.
        </Typography>

        {diffSection}

        <Box sx={{ mt: 2 }}>
          <TextField
            id={commentFieldId}
            label="Comment (optional)"
            value={comment}
            onChange={(event) => setComment(event.target.value)}
            multiline
            minRows={3}
            fullWidth
            placeholder="Explain your decision, especially if rejecting..."
            disabled={submitting !== null}
          />
        </Box>

        {error !== null && <ErrorState message={error} />}

        <Stack direction="row" spacing={1.5} sx={{ mt: 2 }}>
          <Button variant="outlined" color="error" onClick={() => void submit('REJECTED')} disabled={submitting !== null}>
            {submitting === 'REJECTED' ? 'Rejecting…' : 'Reject'}
          </Button>
          <Button variant="contained" color="success" onClick={() => void submit('APPROVED')} disabled={submitting !== null}>
            {submitting === 'APPROVED' ? 'Approving…' : 'Approve'}
          </Button>
        </Stack>
      </CardContent>
    </Card>
  );
}
