export type MacTcpPortPressure = {
  count: number;
  first: number;
  last: number;
  capacity: number;
  ratio: number;
};

export type MacProcessRecord = {
  pid: number;
  parentPid: number;
  command: string;
};

export type MacPublicRouteResult = {
  status: "ok" | "warn";
  detail: string;
};

export function parseMacTcpPortPressure(output: string): MacTcpPortPressure | null;
export function countMacTcpTimeWait(output: string): number;
export function findOrphanedStage3Browsers(output: string, homeDir: string): MacProcessRecord[];
export function classifyMacPublicRoute(result: {
  ok: boolean;
  stdout: string;
  stderr: string;
}): MacPublicRouteResult;
export function runMacMiniHealthcheck(): Promise<number>;
