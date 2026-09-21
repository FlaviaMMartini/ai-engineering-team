/** Thrown by `ApplicationRuntime.shutdown()` if releasing a resource fails. `cause` is a sanitized `{name, message}` pair, never the raw thrown value. */
export class ShutdownError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = 'ShutdownError';
  }
}
