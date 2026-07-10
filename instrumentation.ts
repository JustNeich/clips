export async function register(): Promise<void> {
  // Portfolio recovery is intentionally driven by the authenticated Project Kings
  // daemon tick. Next instrumentation must never dispatch production work without
  // the production-DB singleton lease held by that daemon.
}
