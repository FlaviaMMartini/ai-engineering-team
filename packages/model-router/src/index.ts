export { createModelRouter } from './router.js';
export type { ModelRouter } from './router.js';

export { createModelCatalog } from './catalog.js';
export type { ModelCatalog } from './catalog.js';

export type { ModelCapability } from './capabilities.js';
export { ALL_MODEL_CAPABILITIES } from './capabilities.js';

export type {
  ModelDescriptor,
  ModelSelectionRequest,
  ModelSelectionResult,
  ModelTier,
  RejectedCandidate,
  RejectionReason,
  SelectionReason
} from './types.js';

export { ModelRouterError, NoEligibleModelError } from './errors.js';
