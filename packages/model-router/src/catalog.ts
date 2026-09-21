import type { ModelDescriptor } from './types.js';

export interface ModelCatalog {
  list(): readonly ModelDescriptor[];
  find(provider: string, model: string): ModelDescriptor | null;
}

function catalogKey(provider: string, model: string): string {
  return `${provider}::${model}`;
}

/**
 * Injected and empty by default — deliberately no hardcoded vendor/model
 * list here. Real models are registered by whoever configures the router
 * (the Providers phase or a config layer), so this package works correctly
 * even with zero concrete providers implemented yet.
 */
export function createModelCatalog(models: readonly ModelDescriptor[]): ModelCatalog {
  const byKey = new Map<string, ModelDescriptor>();
  for (const descriptor of models) {
    byKey.set(catalogKey(descriptor.provider, descriptor.model), descriptor);
  }

  return {
    list(): readonly ModelDescriptor[] {
      return [...models];
    },
    find(provider: string, model: string): ModelDescriptor | null {
      return byKey.get(catalogKey(provider, model)) ?? null;
    }
  };
}
