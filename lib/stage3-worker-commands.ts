function firstHeaderValue(value: string | null): string | null {
  if (!value) {
    return null;
  }
  const first = value
    .split(",")
    .map((part) => part.trim())
    .find(Boolean);
  return first || null;
}

function normalizeOrigin(value: string | null | undefined): string | null {
  const trimmed = value?.trim();
  if (!trimmed) {
    return null;
  }
  try {
    const url = new URL(trimmed);
    return url.origin.replace(/\/+$/, "");
  } catch {
    return null;
  }
}

function normalizeWorkerFacingOrigin(origin: string): string {
  try {
    const url = new URL(origin);
    if (url.hostname === "0.0.0.0" || url.hostname === "::" || url.hostname === "[::]") {
      url.hostname = "localhost";
    }
    return url.origin.replace(/\/+$/, "");
  } catch {
    return origin.replace(/\/+$/, "");
  }
}

function hostLooksUnusable(host: string | null): boolean {
  if (!host) {
    return true;
  }
  const normalized = host.trim().toLowerCase();
  return (
    normalized === "0.0.0.0" ||
    normalized.startsWith("0.0.0.0:") ||
    normalized === "[::]" ||
    normalized.startsWith("[::]:") ||
    normalized === "::" ||
    normalized.startsWith(":::")
  );
}

export function isLocalStage3WorkerOrigin(origin: string): boolean {
  return /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/i.test(origin.trim());
}

export function resolveStage3WorkerPublicOrigin(request: Request): string {
  const envOrigin = normalizeOrigin(
    process.env.PUBLIC_APP_ORIGIN ||
      process.env.APP_ORIGIN ||
      process.env.NEXT_PUBLIC_APP_ORIGIN ||
      null
  );
  if (envOrigin) {
    return envOrigin;
  }

  const forwardedHost = firstHeaderValue(request.headers.get("x-forwarded-host"));
  const host = firstHeaderValue(request.headers.get("host"));
  const requestOrigin = normalizeOrigin(request.url);
  const requestProtocol = requestOrigin ? new URL(requestOrigin).protocol.replace(/:$/, "") : "https";
  const forwardedProto =
    firstHeaderValue(request.headers.get("x-forwarded-proto")) ||
    firstHeaderValue(request.headers.get("x-forwarded-protocol")) ||
    requestProtocol;

  const publicHost = !hostLooksUnusable(forwardedHost)
    ? forwardedHost
    : !hostLooksUnusable(host)
      ? host
      : null;

  if (publicHost) {
    return `${forwardedProto}://${publicHost}`.replace(/\/+$/, "");
  }

  if (requestOrigin && !hostLooksUnusable(new URL(requestOrigin).host)) {
    return requestOrigin;
  }

  return "http://localhost:3000";
}

export function buildStage3WorkerCommands(params: {
  origin: string;
  pairingToken: string;
}): {
  shell: string;
  powershell: string;
  direct: string;
  localDev: string;
} {
  const origin = normalizeWorkerFacingOrigin(params.origin);
  const localDevCommand = `npm run stage3-worker -- pair --server ${origin} --token ${params.pairingToken}`;
  const shellBootstrapCommand = `curl -fsSL ${origin}/stage3-worker/bootstrap.sh | bash -s -- --server ${origin} --token ${params.pairingToken}`;
  const powershellBootstrapCommand =
    `powershell -NoProfile -ExecutionPolicy Bypass -Command ` +
    `"& { ` +
    `$ErrorActionPreference = 'Stop'; ` +
    `$ProgressPreference = 'SilentlyContinue'; ` +
    `[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12 -bor [Net.ServicePointManager]::SecurityProtocol; ` +
    `$bootstrapPath = Join-Path ([System.IO.Path]::GetTempPath()) ('clips-stage3-bootstrap-' + [Guid]::NewGuid().ToString('N') + '.ps1'); ` +
    `Write-Host '[Clips] Downloading Stage 3 bootstrap...'; ` +
    `Invoke-WebRequest '${origin}/stage3-worker/bootstrap.ps1' -UseBasicParsing -ErrorAction Stop -OutFile $bootstrapPath; ` +
    `Write-Host '[Clips] Running Stage 3 bootstrap...'; ` +
    `. $bootstrapPath; ` +
    `Install-ClipsStage3Worker -Server '${origin}' -Token '${params.pairingToken}'; ` +
    `}"`;
  const isLocalOrigin = isLocalStage3WorkerOrigin(origin);

  return {
    shell: isLocalOrigin ? localDevCommand : shellBootstrapCommand,
    powershell: isLocalOrigin ? localDevCommand : powershellBootstrapCommand,
    direct: isLocalOrigin ? localDevCommand : shellBootstrapCommand,
    localDev: localDevCommand
  };
}
