declare module "*.mjs" {
  const value: any;
  export const DEFAULT_MAX_STALENESS_MINUTES: number;
  export function buildRefreshPlan(input?: any): any;
  export function parseArgs(argv: string[]): any;
  export default value;
}
