import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { constants as fsConstants } from "node:fs";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";

const execFileAsync = promisify(execFile);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..");
const templatePath = path.join(
  repoRoot,
  "support",
  "launchd",
  "com.zoro.clips-project-kings-semantic-worker.plist.tmpl"
);
const LABEL_PREFIX = "com.zoro.clips-project-kings-semantic-worker";
const INSTANCE_COUNT = 1;
const SEMANTIC_CONCURRENCY = 3;
const MINIMUM_CODEX_VERSION = [0, 144, 1];
const SAFE_VERSION_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._+-]{0,159}$/;
export const PROJECT_KINGS_DEFAULT_ROUTE_MANIFEST_FILENAME =
  "project-kings-model-routes-v4.json";

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value)
        .filter(([, entry]) => entry !== undefined)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, entry]) => [key, canonical(entry)])
    );
  }
  return value;
}

function argument(argv, name) {
  const index = argv.indexOf(name);
  return index >= 0 ? argv[index + 1] ?? null : null;
}

function xml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

async function assertRegularFile(filePath, label) {
  const stat = await fs.lstat(filePath);
  if (!stat.isFile() || stat.isSymbolicLink()) {
    throw new Error(`${label} must be a regular non-symlink file.`);
  }
  return stat;
}

async function validateCodexExecutable(codexBin, codexHome) {
  if (typeof codexBin !== "string" || !codexBin.trim()) {
    throw new Error("Semantic worker install requires an explicit --codex-bin or CODEX_BIN path.");
  }
  if (!path.isAbsolute(codexBin)) {
    throw new Error("Semantic worker Codex executable must be an absolute path.");
  }
  try {
    await assertRegularFile(codexBin, "Codex executable");
    await fs.access(codexBin, fsConstants.X_OK);
  } catch {
    throw new Error("Semantic worker Codex executable must be an existing executable regular non-symlink file.");
  }

  let versionOutput;
  try {
    const { stdout, stderr } = await execFileAsync(codexBin, ["--version"], {
      timeout: 10_000,
      maxBuffer: 1024 * 1024,
      env: {
        ...process.env,
        CODEX_BIN: codexBin,
        CODEX_HOME: codexHome
      }
    });
    versionOutput = [stdout, stderr]
      .map((value) => String(value || "").trim())
      .filter(Boolean)
      .join("\n");
  } catch {
    throw new Error("Semantic worker Codex executable version check failed.");
  }

  const match = /^codex(?:-cli)?\s+(\d+)\.(\d+)\.(\d+)(-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/.exec(
    versionOutput
  );
  if (!match) {
    throw new Error("Semantic worker Codex executable returned an unparseable version.");
  }
  const version = match.slice(1, 4).map(Number);
  const comparison = version.findIndex((value, index) => value !== MINIMUM_CODEX_VERSION[index]);
  const belowMinimum =
    comparison >= 0 && version[comparison] < MINIMUM_CODEX_VERSION[comparison];
  const minimumPrerelease = comparison === -1 && Boolean(match[4]);
  if (belowMinimum || minimumPrerelease) {
    throw new Error("Semantic worker requires Codex CLI 0.144.1 or newer.");
  }
  return versionOutput;
}

async function loadCandidate(input) {
  const [, , , , , codexVersion] = await Promise.all([
    assertRegularFile(input.bundlePath, "Semantic worker bundle"),
    assertRegularFile(input.bundleManifestPath, "Semantic worker bundle manifest"),
    assertRegularFile(input.routeManifestPath, "Frozen route manifest"),
    assertRegularFile(input.workerConfigPath, "Stage 3 worker config"),
    assertRegularFile(input.nodePath, "Node executable"),
    validateCodexExecutable(input.codexBin, input.codexHome),
    fs.access(input.nodePath, fsConstants.X_OK)
  ]);
  const [bundleBytes, manifestRaw, routeBytes, workerConfigStat, workerConfigRaw] = await Promise.all([
    fs.readFile(input.bundlePath),
    fs.readFile(input.bundleManifestPath, "utf-8"),
    fs.readFile(input.routeManifestPath),
    fs.stat(input.workerConfigPath),
    fs.readFile(input.workerConfigPath, "utf-8")
  ]);
  const manifest = JSON.parse(manifestRaw);
  const unsignedManifest = { ...manifest };
  delete unsignedManifest.manifestSha256;
  if (
    manifest.schemaVersion !== "project-kings-semantic-worker-bundle-v1" ||
    !SAFE_VERSION_PATTERN.test(String(manifest.semanticRuntimeVersion || "")) ||
    manifest.bundleSha256 !== sha256(bundleBytes) ||
    manifest.bundleSizeBytes !== bundleBytes.byteLength ||
    !Array.isArray(manifest.supportedKinds) ||
    manifest.supportedKinds.length !== 1 ||
    manifest.supportedKinds[0] !== "production-semantic" ||
    manifest.intendedLaunchdInstances !== INSTANCE_COUNT ||
    manifest.maxConcurrentJobsPerProcess !== SEMANTIC_CONCURRENCY ||
    manifest.credentialsInBundle !== false ||
    manifest.manifestSha256 !== sha256(JSON.stringify(canonical(unsignedManifest)))
  ) {
    throw new Error("Semantic worker bundle does not match its frozen manifest.");
  }
  if ((workerConfigStat.mode & 0o077) !== 0) {
    throw new Error("Stage 3 worker config must have 0600-or-stricter permissions.");
  }
  const workerConfig = JSON.parse(workerConfigRaw);
  if (
    typeof workerConfig.sessionToken !== "string" ||
    !workerConfig.sessionToken.trim() ||
    bundleBytes.includes(Buffer.from(workerConfig.sessionToken))
  ) {
    throw new Error("Semantic worker bundle/config credential boundary is invalid.");
  }
  const routeManifest = JSON.parse(routeBytes.toString("utf-8"));
  if (
    (routeManifest.schemaVersion !== 2 && routeManifest.schemaVersion !== 3) ||
    typeof routeManifest.manifestSha256 !== "string"
  ) {
    throw new Error("Semantic launchd install requires a production-ready route manifest v2/v3.");
  }
  if (!input.skipRuntimePreflight) {
    const ownsPreflightWorkRoot = !input.preflightWorkRoot;
    const preflightWorkRoot = input.preflightWorkRoot ??
      await fs.mkdtemp(path.join(os.tmpdir(), "project-kings-semantic-preflight-"));
    try {
      if (ownsPreflightWorkRoot) await fs.chmod(preflightWorkRoot, 0o700);
      await execFileAsync(input.nodePath, [input.bundlePath, "--preflight"], {
        timeout: 30_000,
        maxBuffer: 1024 * 1024,
        env: {
          ...process.env,
          PROJECT_KINGS_SEMANTIC_WORKER_ENABLED: "1",
          PROJECT_KINGS_SEMANTIC_WORKER_CONFIG_PATH: input.workerConfigPath,
          PROJECT_KINGS_SEMANTIC_CODEX_HOME: input.codexHome,
          PROJECT_KINGS_SEMANTIC_ROUTE_MANIFEST_PATH: input.routeManifestPath,
          PROJECT_KINGS_SEMANTIC_WORK_ROOT: preflightWorkRoot,
          CODEX_BIN: input.codexBin
        }
      });
    } catch {
      throw new Error(
        "Semantic worker bundle preflight failed for local Codex login, frozen manifest or runtime identity."
      );
    } finally {
      if (ownsPreflightWorkRoot) {
        await fs.rm(preflightWorkRoot, { recursive: true, force: true }).catch(() => undefined);
      }
    }
  }
  return {
    bundleBytes,
    manifest,
    routeBytes,
    routeManifest,
    routeFileSha256: sha256(routeBytes),
    codexVersion
  };
}

export function resolveSemanticWorkerInstallPaths(input = {}) {
  const home = input.homeDir ?? os.homedir();
  const installRoot =
    input.installRoot ??
    path.join(home, "Library", "Application Support", "Clips Project Kings Semantic Worker");
  return {
    home,
    installRoot,
    versionsRoot: path.join(installRoot, "versions"),
    currentLink: path.join(installRoot, "current"),
    statePath: path.join(installRoot, "install-state.json"),
    workRoot: path.join(installRoot, "work"),
    spoolRoot: path.join(installRoot, "spool"),
    logsRoot: path.join(installRoot, "logs"),
    launchAgentsRoot: input.launchAgentsRoot ?? path.join(home, "Library", "LaunchAgents")
  };
}

export async function buildProjectKingsSemanticWorkerLaunchdPlan(input) {
  const paths = resolveSemanticWorkerInstallPaths(input);
  const candidate = await loadCandidate(input);
  const versionName =
    `${candidate.manifest.semanticRuntimeVersion}-` +
    `${candidate.manifest.bundleSha256.slice(0, 12)}-${candidate.routeFileSha256.slice(0, 12)}-` +
    `${candidate.manifest.manifestSha256.slice(0, 12)}`;
  const versionDir = path.join(paths.versionsRoot, versionName);
  const template = await fs.readFile(templatePath, "utf-8");
  const bundlePath = path.join(paths.currentLink, "project-kings-semantic-worker.cjs");
  const routeManifestPath = path.join(paths.currentLink, "route-manifest.json");
  const instances = Array.from({ length: INSTANCE_COUNT }, (_, offset) => {
    const instance = offset + 1;
    const label = `${LABEL_PREFIX}.${instance}`;
    const plistPath = path.join(paths.launchAgentsRoot, `${label}.plist`);
    const replacements = {
      LABEL: label,
      NODE_PATH: input.nodePath,
      BUNDLE_PATH: bundlePath,
      INSTANCE: String(instance),
      WORKER_CONFIG_PATH: input.workerConfigPath,
      CODEX_HOME: input.codexHome,
      CODEX_BIN: input.codexBin,
      ROUTE_MANIFEST_PATH: routeManifestPath,
      WORK_ROOT: paths.workRoot,
      SPOOL_ROOT: paths.spoolRoot,
      STDOUT_PATH: path.join(paths.logsRoot, `semantic-${instance}.out.log`),
      STDERR_PATH: path.join(paths.logsRoot, `semantic-${instance}.err.log`)
    };
    let plist = template;
    for (const [key, value] of Object.entries(replacements)) {
      plist = plist.replaceAll(`{{${key}}}`, xml(value));
    }
    if (/{{[A-Z_]+}}/.test(plist)) throw new Error(`Launchd template has unresolved placeholders for ${label}.`);
    return { instance, label, plistPath, plist };
  });
  return {
    schemaVersion: "project-kings-semantic-worker-install-plan-v1",
    action: input.action,
    mutationAuthorized: input.action === "install" || input.action === "rollback",
    liveDeployPerformed: false,
    instanceCount: INSTANCE_COUNT,
    semanticConcurrency: SEMANTIC_CONCURRENCY,
    supportedKinds: ["production-semantic"],
    renderKindsClaimed: false,
    credentialsEmbedded: false,
    codexBin: input.codexBin,
    codexVersion: candidate.codexVersion,
    semanticRuntimeVersion: candidate.manifest.semanticRuntimeVersion,
    stage3AppVersion: candidate.manifest.stage3AppVersion,
    bundleSha256: candidate.manifest.bundleSha256,
    routeManifestId: candidate.routeManifest.manifestId,
    routeManifestSha256: candidate.routeManifest.manifestSha256,
    routeFileSha256: candidate.routeFileSha256,
    versionDir,
    ...paths,
    instances,
    candidate
  };
}

export async function buildProjectKingsSemanticWorkerRollbackPlan(input = {}) {
  const paths = resolveSemanticWorkerInstallPaths(input);
  const state = JSON.parse(await fs.readFile(paths.statePath, "utf-8"));
  if (
    state.schemaVersion !== "project-kings-semantic-worker-install-state-v1" ||
    typeof state.previousVersionDir !== "string" ||
    !state.previousVersionDir.trim()
  ) {
    throw new Error("No previous semantic worker version is available for rollback.");
  }
  const [currentVersionDir, previousVersionDir, versionsRoot] = await Promise.all([
    fs.realpath(paths.currentLink),
    fs.realpath(state.previousVersionDir),
    fs.realpath(paths.versionsRoot)
  ]);
  const relativeCurrent = path.relative(versionsRoot, currentVersionDir);
  const relativePrevious = path.relative(versionsRoot, previousVersionDir);
  if (
    !relativeCurrent ||
    !relativePrevious ||
    relativeCurrent.startsWith("..") ||
    relativePrevious.startsWith("..") ||
    path.isAbsolute(relativeCurrent) ||
    path.isAbsolute(relativePrevious)
  ) {
    throw new Error("Semantic worker rollback state points outside the version store.");
  }
  const instances = Array.from({ length: INSTANCE_COUNT }, (_, offset) => {
    const instance = offset + 1;
    const label = `${LABEL_PREFIX}.${instance}`;
    return {
      instance,
      label,
      plistPath: path.join(paths.launchAgentsRoot, `${label}.plist`)
    };
  });
  return {
    schemaVersion: "project-kings-semantic-worker-rollback-plan-v1",
    action: "rollback",
    mutationAuthorized: true,
    liveDeployPerformed: false,
    instanceCount: INSTANCE_COUNT,
    semanticConcurrency: SEMANTIC_CONCURRENCY,
    supportedKinds: ["production-semantic"],
    renderKindsClaimed: false,
    credentialsEmbedded: false,
    currentVersionDir,
    previousVersionDir,
    state,
    ...paths,
    instances
  };
}

async function atomicWrite(filePath, content, mode = 0o600) {
  await fs.mkdir(path.dirname(filePath), { recursive: true, mode: 0o700 });
  const temporary = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  await fs.writeFile(temporary, content, { mode, flag: "wx" });
  await fs.rename(temporary, filePath);
}

async function switchCurrentLink(currentLink, versionDir) {
  const temporary = `${currentLink}.next-${process.pid}`;
  await fs.rm(temporary, { force: true });
  await fs.symlink(versionDir, temporary);
  await fs.rename(temporary, currentLink);
}

async function restartInstances(plan) {
  const domain = `gui/${process.getuid()}`;
  for (const instance of plan.instances) {
    await execFileAsync("launchctl", ["bootout", `${domain}/${instance.label}`]).catch(() => undefined);
    await execFileAsync("launchctl", ["bootstrap", domain, instance.plistPath]);
    await execFileAsync("launchctl", ["kickstart", "-k", `${domain}/${instance.label}`]);
  }
}

async function install(plan) {
  await Promise.all([
    fs.mkdir(plan.workRoot, { recursive: true, mode: 0o700 }),
    fs.mkdir(plan.spoolRoot, { recursive: true, mode: 0o700 }),
    fs.mkdir(plan.logsRoot, { recursive: true, mode: 0o700 }),
    fs.mkdir(plan.launchAgentsRoot, { recursive: true })
  ]);
  const bundleTarget = path.join(plan.versionDir, "project-kings-semantic-worker.cjs");
  const manifestTarget = path.join(plan.versionDir, "manifest.json");
  const routeTarget = path.join(plan.versionDir, "route-manifest.json");
  const versionExists = await fs.access(plan.versionDir).then(() => true, () => false);
  if (versionExists) {
    const [existingBundle, existingManifest, existingRoute] = await Promise.all([
      fs.readFile(bundleTarget),
      fs.readFile(manifestTarget),
      fs.readFile(routeTarget)
    ]);
    if (
      sha256(existingBundle) !== plan.bundleSha256 ||
      sha256(existingManifest) !== sha256(`${JSON.stringify(plan.candidate.manifest, null, 2)}\n`) ||
      sha256(existingRoute) !== plan.routeFileSha256
    ) {
      throw new Error("Existing semantic worker version directory is not immutable/exact.");
    }
  } else {
    const stagingDir = `${plan.versionDir}.staging-${process.pid}-${Date.now()}`;
    await fs.mkdir(stagingDir, { recursive: false, mode: 0o700 });
    try {
      await atomicWrite(
        path.join(stagingDir, "project-kings-semantic-worker.cjs"),
        plan.candidate.bundleBytes,
        0o700
      );
      await atomicWrite(
        path.join(stagingDir, "manifest.json"),
        `${JSON.stringify(plan.candidate.manifest, null, 2)}\n`
      );
      await atomicWrite(path.join(stagingDir, "route-manifest.json"), plan.candidate.routeBytes);
      await fs.rename(stagingDir, plan.versionDir);
    } finally {
      await fs.rm(stagingDir, { recursive: true, force: true }).catch(() => undefined);
    }
  }
  let previousVersionDir = null;
  try {
    previousVersionDir = await fs.realpath(plan.currentLink);
  } catch {
    previousVersionDir = null;
  }
  await switchCurrentLink(plan.currentLink, plan.versionDir);
  for (const instance of plan.instances) {
    await atomicWrite(instance.plistPath, instance.plist, 0o600);
  }
  await atomicWrite(
    plan.statePath,
    `${JSON.stringify(
      {
        schemaVersion: "project-kings-semantic-worker-install-state-v1",
        installedAt: new Date().toISOString(),
        currentVersionDir: plan.versionDir,
        previousVersionDir,
        semanticRuntimeVersion: plan.semanticRuntimeVersion,
        bundleSha256: plan.bundleSha256,
        routeManifestSha256: plan.routeManifestSha256
      },
      null,
      2
    )}\n`
  );
  await restartInstances(plan);
}

async function rollback(plan) {
  const state = plan.state;
  await switchCurrentLink(plan.currentLink, plan.previousVersionDir);
  await atomicWrite(
    plan.statePath,
    `${JSON.stringify(
      {
        ...state,
        rolledBackAt: new Date().toISOString(),
        currentVersionDir: plan.previousVersionDir,
        previousVersionDir: plan.currentVersionDir
      },
      null,
      2
    )}\n`
  );
  await restartInstances(plan);
}

function safePlan(plan) {
  const { candidate: _candidate, instances, ...rest } = plan;
  return {
    ...rest,
    instances: instances.map(({ plist: _plist, ...instance }) => instance)
  };
}

async function main() {
  const argv = process.argv.slice(2);
  const action = argv.includes("--install")
    ? "install"
    : argv.includes("--rollback")
      ? "rollback"
      : "dry-run";
  const bundlePath = path.resolve(
    argument(argv, "--bundle") ??
      path.join(repoRoot, ".project-kings-semantic-worker-runtime", "project-kings-semantic-worker.cjs")
  );
  const bundleManifestPath = path.resolve(
    argument(argv, "--bundle-manifest") ??
      path.join(repoRoot, ".project-kings-semantic-worker-runtime", "manifest.json")
  );
  const routeManifestPath = path.resolve(
    argument(argv, "--route-manifest") ??
      path.join(
        repoRoot,
        "docs",
        "project-kings-production-pipeline-v1",
        "evidence",
        PROJECT_KINGS_DEFAULT_ROUTE_MANIFEST_FILENAME
      )
  );
  const workerConfigPath = path.resolve(
    argument(argv, "--worker-config") ??
      path.join(
        os.homedir(),
        "Library",
        "Application Support",
        "Clips Project Kings Semantic Worker",
        "worker-config.json"
      )
  );
  const codexHome = path.resolve(argument(argv, "--codex-home") ?? path.join(os.homedir(), ".codex"));
  const codexBinSource = argument(argv, "--codex-bin") ?? process.env.CODEX_BIN?.trim();
  const codexBin = codexBinSource?.trim() ? path.resolve(codexBinSource.trim()) : null;
  const commonPaths = {
    installRoot: argument(argv, "--install-root")
      ? path.resolve(argument(argv, "--install-root"))
      : undefined,
    launchAgentsRoot: argument(argv, "--launch-agents-root")
      ? path.resolve(argument(argv, "--launch-agents-root"))
      : undefined
  };
  const plan = action === "rollback"
    ? await buildProjectKingsSemanticWorkerRollbackPlan(commonPaths)
    : await buildProjectKingsSemanticWorkerLaunchdPlan({
        action,
        bundlePath,
        bundleManifestPath,
        routeManifestPath,
        workerConfigPath,
        codexHome,
        codexBin,
        nodePath: path.resolve(argument(argv, "--node") ?? process.execPath),
        ...commonPaths
      });
  if (action === "install") await install(plan);
  if (action === "rollback") await rollback(plan);
  console.log(JSON.stringify({ ...safePlan(plan), liveDeployPerformed: action !== "dry-run" }, null, 2));
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  });
}
