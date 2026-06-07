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
    /[\s/@\\]/.test(normalized) ||
    normalized === "0.0.0.0" ||
    normalized.startsWith("0.0.0.0:") ||
    normalized === "[::]" ||
    normalized.startsWith("[::]:") ||
    normalized === "::" ||
    normalized.startsWith(":::")
  );
}

function encodePowershellScript(script: string): string {
  return Buffer.from(script, "utf16le").toString("base64");
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

  if (process.env.NODE_ENV === "production") {
    throw new Error("PUBLIC_APP_ORIGIN or APP_ORIGIN is required to issue worker pairing commands in production.");
  }

  const forwardedHost = firstHeaderValue(request.headers.get("x-forwarded-host"));
  const host = firstHeaderValue(request.headers.get("host"));
  const requestOrigin = normalizeOrigin(request.url);
  const requestProtocol = requestOrigin ? new URL(requestOrigin).protocol.replace(/:$/, "") : "https";
  const forwardedProto =
    firstHeaderValue(request.headers.get("x-forwarded-proto")) ||
    firstHeaderValue(request.headers.get("x-forwarded-protocol")) ||
    requestProtocol;
  const safeForwardedProto = forwardedProto === "http" || forwardedProto === "https" ? forwardedProto : requestProtocol;

  const publicHost = !hostLooksUnusable(forwardedHost)
    ? forwardedHost
    : !hostLooksUnusable(host)
      ? host
      : null;

  if (publicHost) {
    return `${safeForwardedProto}://${publicHost}`.replace(/\/+$/, "");
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
  const powershellBootstrapScript = [
    "$ErrorActionPreference = 'Stop'",
    "$ProgressPreference = 'SilentlyContinue'",
    "[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12 -bor [Net.ServicePointManager]::SecurityProtocol",
    "$bootstrapPath = Join-Path ([System.IO.Path]::GetTempPath()) ('clips-stage3-bootstrap-' + [Guid]::NewGuid().ToString('N') + '.ps1')",
    "Write-Host '[Clips] Downloading Stage 3 bootstrap...'",
    `Invoke-WebRequest '${origin}/stage3-worker/bootstrap.ps1' -UseBasicParsing -ErrorAction Stop -OutFile $bootstrapPath`,
    "Write-Host '[Clips] Running Stage 3 bootstrap...'",
    "try { . $bootstrapPath } finally { Remove-Item $bootstrapPath -Force -ErrorAction SilentlyContinue }",
    `Install-ClipsStage3Worker -Server '${origin}' -Token '${params.pairingToken}'`
  ].join("; ");
  const powershellBootstrapCommand =
    `powershell -NoProfile -ExecutionPolicy Bypass -EncodedCommand ` +
    encodePowershellScript(powershellBootstrapScript);
  const isLocalOrigin = isLocalStage3WorkerOrigin(origin);

  return {
    shell: isLocalOrigin ? localDevCommand : shellBootstrapCommand,
    powershell: isLocalOrigin ? localDevCommand : powershellBootstrapCommand,
    direct: isLocalOrigin ? localDevCommand : shellBootstrapCommand,
    localDev: localDevCommand
  };
}

export function buildStage3WorkerDesktopDeepLink(params: {
  origin: string;
  pairingToken: string;
  label?: string | null;
}): string {
  const origin = normalizeWorkerFacingOrigin(params.origin);
  const url = new URL("clips-stage3-worker://pair");
  url.searchParams.set("server", origin);
  url.searchParams.set("token", params.pairingToken);
  if (params.label?.trim()) {
    url.searchParams.set("label", params.label.trim());
  }
  return url.toString();
}
