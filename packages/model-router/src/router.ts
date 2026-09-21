import type { ModelCatalog } from './catalog.js';
import { selectModel } from './selection.js';
import type { ModelSelectionRequest, ModelSelectionResult } from './types.js';

export interface ModelRouter {
  selectModel(request: ModelSelectionRequest): ModelSelectionResult;
}

/**
 * The only public entry point. Resolves entirely against the injected
 * catalog — no SDK, no HTTP, no knowledge of any specific vendor. Works
 * correctly even with an empty catalog (it just rejects every request via
 * NoEligibleModelError), so this package is fully usable before any real
 * provider exists.
 */
export function createModelRouter(catalog: ModelCatalog): ModelRouter {
  return {
    selectModel(request: ModelSelectionRequest): ModelSelectionResult {
      return selectModel(catalog.list(), request);
    }
  };
}
