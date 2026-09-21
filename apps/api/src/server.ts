import { loadConfigFromEnv, loadHttpConfigFromEnv } from './composition/index.js';
import { createHttpServer } from './http/server.js';
import { bootstrap } from './runtime/index.js';

/**
 * The real process entrypoint (`npm run dev` / `npm start` both run this
 * file, per apps/api/package.json). Sequencing: read config -> bootstrap
 * the application runtime (persistence, git, providers, orchestrator) ->
 * build the Fastify server around it -> listen -> install graceful
 * shutdown. Uses plain console.log/console.error rather than a Fastify
 * logger for this top-level lifecycle: some of these lines (config errors,
 * bootstrap failures) can happen before a Fastify instance exists at all.
 * Fastify's own `logger: true` (see http/server.ts) covers all per-request
 * logging once the server is up.
 */
async function main(): Promise<void> {
  const config = loadConfigFromEnv();
  const httpConfig = loadHttpConfigFromEnv();

  const runtime = await bootstrap(config);
  const server = createHttpServer(runtime);

  await server.listen(httpConfig.host, httpConfig.port);
  console.log(`AI Engineering Team API listening on http://${httpConfig.host}:${httpConfig.port}`);

  let shuttingDown = false;
  async function shutdown(signal: string): Promise<void> {
    if (shuttingDown) return;
    shuttingDown = true;
    console.log(`Received ${signal}, shutting down gracefully...`);
    try {
      await server.close();
      await runtime.shutdown();
      process.exit(0);
    } catch (error) {
      console.error('Error during graceful shutdown:', error instanceof Error ? error.message : 'unknown error');
      process.exit(1);
    }
  }

  process.on('SIGINT', () => {
    void shutdown('SIGINT');
  });
  process.on('SIGTERM', () => {
    void shutdown('SIGTERM');
  });
}

main().catch((error: unknown) => {
  console.error('Failed to start the application:', error instanceof Error ? error.message : 'unknown error');
  process.exit(1);
});
