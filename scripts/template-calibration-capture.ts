import { mkdir, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { chromium } from "@playwright/test";

type CaptureOptions = {
  origin: string;
  templateId: string;
  mode: string;
  outputDir: string;
  captureArtifacts: boolean;
  percy: boolean;
};

function parseArgs(argv: string[]): CaptureOptions {
  const args = new Map<string, string>();
  for (const token of argv) {
    const normalized = token.replace(/^--/, "");
    const separatorIndex = normalized.indexOf("=");
    if (separatorIndex === -1) {
      args.set(normalized, "1");
      continue;
    }
    args.set(normalized.slice(0, separatorIndex), normalized.slice(separatorIndex + 1));
  }

  const templateId = args.get("template");
  if (!templateId) {
    throw new Error("Expected --template=<templateId>.");
  }

  return {
    origin: args.get("origin") ?? process.env.TEMPLATE_LAB_ORIGIN ?? "http://localhost:3046",
    templateId,
    mode: args.get("mode") ?? "overlay",
    outputDir: args.get("output") ?? path.join(process.cwd(), "output", "playwright"),
    captureArtifacts: args.get("capture") !== "0",
    percy: args.get("percy") === "1"
  };
}

export async function runTemplateCalibrationCapture(options: CaptureOptions): Promise<{
  screenshotPath: string;
  reportPath: string;
  bundle: unknown;
  artifactsCaptured: boolean;
}> {
  await mkdir(options.outputDir, { recursive: true });

  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1720, height: 1280 }, deviceScaleFactor: 1 });
  const url = `${options.origin}/design/template-road?template=${encodeURIComponent(options.templateId)}&mode=${encodeURIComponent(options.mode)}`;

  try {
    await page.goto(url, { waitUntil: "networkidle" });
    await page.waitForSelector("[data-template-road-root]");
    await page.waitForSelector(`[data-template-road-template="${options.templateId}"]`);
    await page.waitForSelector("[data-template-road-preview]");
    await page
      .waitForSelector(
        `[data-template-scene="${options.templateId}"][data-template-scene-ready="1"]`,
        { timeout: 15000 }
      )
      .catch(() => undefined);

    if (options.percy) {
      const percySnapshot = (await import("@percy/playwright")).default;
      await percySnapshot(page, `template-road:${options.templateId}`);
    }

    const preview = page.locator("[data-template-road-preview]");
    const screenshotPath = path.join(options.outputDir, `${options.templateId}.png`);
    await preview.screenshot({ path: screenshotPath });

    let artifactsCaptured = false;
    if (options.captureArtifacts) {
      const captureButton = page.locator("[data-template-road-capture]");
      await page.waitForSelector('[data-template-road-capture-state="ready"]', { timeout: 15000 }).catch(
        () => undefined
      );
      const captureEnabled = await captureButton.isEnabled().catch(() => false);
      if (captureEnabled) {
        await Promise.all([
          page.waitForResponse(
            (response) =>
              response.url().includes(`/api/design/template-sessions/${options.templateId}/artifacts`) &&
              response.request().method() === "POST",
            { timeout: 10000 }
          ),
          captureButton.click()
        ]);
        artifactsCaptured = true;
      }
    }

    const bundleResponse = await page.request.get(
      `${options.origin}/api/design/template-sessions/${options.templateId}`
    );
    if (!bundleResponse.ok()) {
      throw new Error(`Failed to fetch bundle for ${options.templateId}`);
    }
    const bundle = (await bundleResponse.json()) as unknown;

    const reportPath = path.join(options.outputDir, `${options.templateId}.report.json`);
    await writeFile(reportPath, `${JSON.stringify(bundle, null, 2)}\n`);

    return {
      screenshotPath,
      reportPath,
      bundle,
      artifactsCaptured
    };
  } finally {
    await page.close().catch(() => undefined);
    await browser.close().catch(() => undefined);
  }
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const result = await runTemplateCalibrationCapture(options);
  process.stdout.write(
    `${JSON.stringify(
      {
        templateId: options.templateId,
        screenshotPath: result.screenshotPath,
        reportPath: result.reportPath,
        artifactsCaptured: result.artifactsCaptured
      },
      null,
      2
    )}\n`
  );
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  void main().catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.stack ?? error.message : String(error)}\n`);
    process.exit(1);
  });
}
