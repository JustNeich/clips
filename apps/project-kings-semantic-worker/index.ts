import {
  preflightProjectKingsSemanticWorkerFromEnv,
  productionSemanticWorkerSafeStartupMessage,
  resolveProjectKingsSemanticWorkerBuildIdentity,
  runProjectKingsSemanticWorkerFromEnv
} from "../../lib/project-kings/production-semantic-worker-runtime";

const instanceIndex = process.argv.indexOf("--instance");
const instance = instanceIndex >= 0 ? process.argv[instanceIndex + 1]?.trim() || "unknown" : "manual";
const identity = resolveProjectKingsSemanticWorkerBuildIdentity();

console.log(
  productionSemanticWorkerSafeStartupMessage({
    instance,
    semanticRuntimeVersion: identity.semanticRuntimeVersion
  })
);

const run = process.argv.includes("--preflight")
  ? preflightProjectKingsSemanticWorkerFromEnv().then(({ identity: readyIdentity }) => {
      console.log(
        JSON.stringify({
          ready: true,
          workerClass: "project-kings-semantic-only-v1",
          appVersion: readyIdentity.appVersion,
          semanticRuntimeVersion: readyIdentity.semanticRuntimeVersion,
          supportedKinds: ["production-semantic"]
        })
      );
    })
  : runProjectKingsSemanticWorkerFromEnv();

void run.catch((error) => {
  console.error(error instanceof Error ? error.message : "Project Kings semantic worker failed closed.");
  process.exit(1);
});
