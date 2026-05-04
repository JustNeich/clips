import { runStage3WorkerCli } from "../../lib/stage3-worker-runtime";

void runStage3WorkerCli().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
