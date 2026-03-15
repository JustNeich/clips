import { listStage3DesignLabPresets } from "../lib/stage3-design-lab";
import { runTemplateCalibrationCapture } from "./template-calibration-capture";

async function main() {
  const origin = process.env.TEMPLATE_LAB_ORIGIN ?? "http://localhost:3046";
  const presets = listStage3DesignLabPresets();

  for (const preset of presets) {
    await runTemplateCalibrationCapture({
      origin,
      templateId: preset.templateId,
      mode: "overlay",
      outputDir: `${process.cwd()}/output/playwright`,
      captureArtifacts: false,
      percy: true
    });
  }
}

void main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.stack ?? error.message : String(error)}\n`);
  process.exit(1);
});
