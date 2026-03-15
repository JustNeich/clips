import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { listStage3DesignLabPresets } from "../lib/stage3-design-lab";
import { runTemplateCalibrationCapture } from "./template-calibration-capture";

type TemplateBatchSummaryItem = {
  templateId: string;
  status: string;
  lastMismatchPercent: number | null;
  lastChromeMismatchPercent: number | null;
};

function parseArgs(argv: string[]): { origin: string; outputDir: string; capture: boolean } {
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
  return {
    origin: args.get("origin") ?? process.env.TEMPLATE_LAB_ORIGIN ?? "http://localhost:3046",
    outputDir: args.get("output") ?? path.join(process.cwd(), "output", "playwright"),
    capture: args.get("capture") !== "0"
  };
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  await mkdir(options.outputDir, { recursive: true });

  const presets = listStage3DesignLabPresets();
  const summary: TemplateBatchSummaryItem[] = [];

  for (const preset of presets) {
    if (options.capture) {
      await runTemplateCalibrationCapture({
        origin: options.origin,
        templateId: preset.templateId,
        mode: "overlay",
        outputDir: options.outputDir,
        captureArtifacts: true,
        percy: false
      });
    }

    const reportPath = path.join(process.cwd(), "design", "templates", preset.templateId, "artifacts", "report.json");
    const sessionPath = path.join(process.cwd(), "design", "templates", preset.templateId, "session.json");
    const report = JSON.parse(await readFile(reportPath, "utf-8").catch(() => "null")) as {
      mismatchPercent?: number;
      chromeMismatchPercent?: number | null;
    } | null;
    const session = JSON.parse(await readFile(sessionPath, "utf-8").catch(() => "{}")) as { status?: string };

    summary.push({
      templateId: preset.templateId,
      status: session.status ?? "queued",
      lastMismatchPercent:
        typeof report?.mismatchPercent === "number" ? report.mismatchPercent : null,
      lastChromeMismatchPercent:
        typeof report?.chromeMismatchPercent === "number" ? report.chromeMismatchPercent : null
    });
  }

  const outputPath = path.join(process.cwd(), "design", "templates", "batch-report.json");
  await writeFile(outputPath, `${JSON.stringify(summary, null, 2)}\n`);
  process.stdout.write(`${JSON.stringify({ outputPath, summary }, null, 2)}\n`);
}

void main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.stack ?? error.message : String(error)}\n`);
  process.exit(1);
});
