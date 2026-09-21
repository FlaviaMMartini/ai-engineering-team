import Alert from '@mui/material/Alert';
import Step from '@mui/material/Step';
import StepLabel from '@mui/material/StepLabel';
import Stepper from '@mui/material/Stepper';
import { formatStatusLabel } from '../utils/format.js';

/** The linear happy-path order — mirrors domain's TaskState transition table (see AGENT_DESIGN.md). Not reimplemented logic, just a fixed display order. */
const HAPPY_PATH_STEPS = ['BACKLOG', 'PLANNING', 'READY', 'IN_PROGRESS', 'QA', 'HUMAN_REVIEW', 'DONE'] as const;

export interface WorkflowStatusProps {
  status: string;
}

/**
 * A pure display of the task's current status string — it does not
 * simulate or predict transitions. When the task is BLOCKED/FAILED, the
 * happy-path steps show only what's known (steps before the terminal
 * status are marked completed) and a separate alert calls out the off-path
 * state clearly.
 */
export function WorkflowStatus({ status }: WorkflowStatusProps) {
  const isOffPath = status === 'BLOCKED' || status === 'FAILED';
  const currentIndex = HAPPY_PATH_STEPS.findIndex((step) => step === status);
  const activeStep = isOffPath || currentIndex === -1 ? HAPPY_PATH_STEPS.length : currentIndex;

  return (
    <>
      <Stepper activeStep={activeStep} alternativeLabel sx={{ overflowX: 'auto', py: 1 }}>
        {HAPPY_PATH_STEPS.map((step) => (
          <Step key={step} completed={!isOffPath && HAPPY_PATH_STEPS.indexOf(step) < currentIndex}>
            <StepLabel>{formatStatusLabel(step)}</StepLabel>
          </Step>
        ))}
      </Stepper>
      {isOffPath && (
        <Alert severity={status === 'FAILED' ? 'error' : 'warning'} sx={{ mt: 1 }}>
          {status === 'FAILED' ? 'Task failed' : 'Task blocked'}
        </Alert>
      )}
    </>
  );
}
