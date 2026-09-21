/**
 * Fastify JSON Schema definitions for request validation. Kept separate
 * from types.ts: these are runtime schema objects Fastify uses to validate
 * and coerce incoming requests, not compile-time types (though the `as const`
 * shapes happen to line up with the TypeScript interfaces in types.ts).
 */

export const createTaskBodySchema = {
  type: 'object',
  required: ['projectId', 'description'],
  properties: {
    projectId: { type: 'string', minLength: 1 },
    /** Phase 21: optional — omitting it means "no repository selected," which scaffolds a brand-new one (see routes.ts). */
    repositoryId: { type: 'string', minLength: 1 },
    /** Used only when `repositoryId` is omitted, to name the new repository this creates. Ignored otherwise. */
    newRepositoryName: { type: 'string', minLength: 1 },
    description: { type: 'string', minLength: 1 },
    maxTokens: { type: ['integer', 'null'] },
    maxCost: { type: ['number', 'null'] }
  },
  additionalProperties: false
} as const;

export const taskParamsSchema = {
  type: 'object',
  required: ['taskId'],
  properties: {
    taskId: { type: 'string', minLength: 1 }
  }
} as const;

export const executeTaskBodySchema = {
  type: 'object',
  properties: {
    maxContextTokens: { type: 'integer', minimum: 1 }
  },
  additionalProperties: false
} as const;

export const executionParamsSchema = {
  type: 'object',
  required: ['executionId'],
  properties: {
    executionId: { type: 'string', minLength: 1 }
  }
} as const;

export const reviewExecutionBodySchema = {
  type: 'object',
  required: ['taskId', 'decision'],
  properties: {
    taskId: { type: 'string', minLength: 1 },
    decision: { type: 'string', enum: ['APPROVED', 'REJECTED'] },
    comment: { type: ['string', 'null'] }
  },
  additionalProperties: false
} as const;

// --- Projects & BYOK provider credentials (Phase 19) ---
// `apiKey` is intentionally `minLength: 1` only — no format/pattern
// constraint, since a provider-specific key format is exactly the kind of
// vendor knowledge this schema (shared, provider-agnostic) must not embed.

export const createProjectBodySchema = {
  type: 'object',
  required: ['name'],
  properties: {
    name: { type: 'string', minLength: 1 },
    description: { type: ['string', 'null'] }
  },
  additionalProperties: false
} as const;

export const projectParamsSchema = {
  type: 'object',
  required: ['projectId'],
  properties: {
    projectId: { type: 'string', minLength: 1 }
  }
} as const;

export const projectProviderParamsSchema = {
  type: 'object',
  required: ['projectId', 'provider'],
  properties: {
    projectId: { type: 'string', minLength: 1 },
    provider: { type: 'string', minLength: 1 }
  }
} as const;

export const connectProviderCredentialBodySchema = {
  type: 'object',
  required: ['apiKey'],
  properties: {
    apiKey: { type: 'string', minLength: 1 }
  },
  additionalProperties: false
} as const;

// --- Repository selection (Phase 21) ---

export const registerRepositoryBodySchema = {
  type: 'object',
  required: ['name', 'path'],
  properties: {
    name: { type: 'string', minLength: 1 },
    path: { type: 'string', minLength: 1 }
  },
  additionalProperties: false
} as const;
