import cors from '@fastify/cors';
import Fastify, { type FastifyInstance } from 'fastify';
import type { ApplicationRuntime } from '../runtime/index.js';
import { registerCredentialRoutes } from './credential-routes.js';
import { registerErrorHandler } from './errors.js';
import { registerRoutes } from './routes.js';

export interface HttpServer {
  listen(host: string, port: number): Promise<void>;
  close(): Promise<void>;
}

/**
 * Pure Fastify factory: builds and wires the app, but does not decide when
 * to listen or how to shut down the rest of the process — that sequencing
 * lives in the top-level entrypoint (`apps/api/src/server.ts`), which also
 * owns `ApplicationRuntime`'s lifecycle. Keeping this file free of process
 * signal handling makes it usable from a test harness later without pulling
 * in `process.on(...)`.
 */
export function createHttpServer(runtime: ApplicationRuntime): HttpServer {
  const app: FastifyInstance = Fastify({ logger: true });

  // Phase 15: the browser-based web app (apps/web) is a separate origin from
  // this API in local dev (different Vite dev server port) and potentially
  // in any future deployment. There is still no auth/session/cookie
  // concept in this MVP, so reflecting the request origin with no
  // credentials is the minimal capability needed for a browser client to
  // read responses at all — not a new API contract, no new headers/fields
  // read by any route, nothing endpoint-specific. `@fastify/cors` has been
  // a declared apps/api dependency since Phase 11 for exactly this reason.
  void app.register(cors, { origin: true, credentials: false });

  registerErrorHandler(app);
  registerRoutes(app, runtime);
  registerCredentialRoutes(app, runtime);

  return {
    async listen(host: string, port: number): Promise<void> {
      await app.listen({ host, port });
    },
    async close(): Promise<void> {
      await app.close();
    }
  };
}
