import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

function argument(argv, name) {
  const index = argv.indexOf(name);
  return index >= 0 ? argv[index + 1] ?? null : null;
}

function normalizeServerOrigin(value) {
  const parsed = new URL(String(value || "").trim().replace(/\/+$/, ""));
  if (parsed.protocol !== "https:" && !["localhost", "127.0.0.1", "::1"].includes(parsed.hostname)) {
    throw new Error("Semantic worker pairing requires HTTPS outside localhost.");
  }
  return parsed.origin;
}

function platform() {
  return `${process.platform}-${process.arch}`;
}

export async function pairProjectKingsSemanticWorker(input) {
  const serverOrigin = normalizeServerOrigin(input.serverOrigin);
  const pairingToken = String(input.pairingToken || "").trim();
  if (!pairingToken) throw new Error("A short-lived semantic worker pairing token is required.");
  const outputPath = path.resolve(input.outputPath);
  if (!input.replace) {
    await fs.access(outputPath).then(
      () => {
        throw new Error("Semantic worker config already exists; pass --replace intentionally.");
      },
      () => undefined
    );
  }
  const fetchImpl = input.fetchImpl ?? fetch;
  const response = await fetchImpl(`${serverOrigin}/api/stage3/worker/auth/exchange`, {
    method: "POST",
    redirect: "error",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      pairingToken,
      label: input.label || `${os.hostname()} Project Kings Semantic`,
      platform: platform(),
      hostname: os.hostname(),
      appVersion: null,
      capabilities: {
        workerClass: "project-kings-semantic-only-v1",
        maxConcurrentJobsPerProcess: 3
      }
    })
  });
  const body = (await response.json().catch(() => null));
  if (
    !response.ok ||
    !body ||
    typeof body.sessionToken !== "string" ||
    typeof body.worker?.id !== "string"
  ) {
    throw new Error(`Semantic worker pairing failed with status ${response.status}.`);
  }
  const config = {
    serverOrigin,
    sessionToken: body.sessionToken,
    workerId: body.worker.id,
    label:
      typeof body.worker.label === "string" && body.worker.label.trim()
        ? body.worker.label.trim()
        : input.label || "Project Kings semantic worker"
  };
  await fs.mkdir(path.dirname(outputPath), { recursive: true, mode: 0o700 });
  const temporary = `${outputPath}.${process.pid}.${Date.now()}.tmp`;
  await fs.writeFile(temporary, `${JSON.stringify(config, null, 2)}\n`, {
    mode: 0o600,
    flag: "wx"
  });
  await fs.rename(temporary, outputPath);
  await fs.chmod(outputPath, 0o600);
  return {
    configPath: outputPath,
    workerId: config.workerId,
    label: config.label,
    serverOrigin,
    credentialsPrinted: false
  };
}

async function main() {
  const argv = process.argv.slice(2);
  const outputPath = path.resolve(
    argument(argv, "--output") ??
      path.join(
        os.homedir(),
        "Library",
        "Application Support",
        "Clips Project Kings Semantic Worker",
        "worker-config.json"
      )
  );
  const result = await pairProjectKingsSemanticWorker({
    serverOrigin: argument(argv, "--server") ?? process.env.CLIPS_APP_URL,
    pairingToken:
      argument(argv, "--token") ?? process.env.PROJECT_KINGS_SEMANTIC_PAIRING_TOKEN,
    outputPath,
    label: argument(argv, "--label"),
    replace: argv.includes("--replace")
  });
  console.log(JSON.stringify(result, null, 2));
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  });
}
