import { promises as fs } from "node:fs";
import { renderStage3Video, type Stage3RenderRequestBody } from "../../lib/stage3-render-service";
import { STAGE3_HOST_RENDER_PROGRESS_PREFIX } from "../../lib/stage3-host-render-child-client";

type Args = {
  input: string;
  output: string;
};

function parseArgs(argv: string[]): Args {
  let input = "";
  let output = "";
  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];
    if (value === "--input") {
      input = argv[index + 1] ?? "";
      index += 1;
    } else if (value === "--output") {
      output = argv[index + 1] ?? "";
      index += 1;
    }
  }
  if (!input || !output) {
    throw new Error("Usage: stage3-host-render-child --input <payload.json> --output <result.json>");
  }
  return { input, output };
}

async function writeOutput(outputPath: string, payload: unknown): Promise<void> {
  await fs.writeFile(outputPath, JSON.stringify(payload), "utf-8");
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  try {
    const payload = JSON.parse(await fs.readFile(args.input, "utf-8")) as Stage3RenderRequestBody;
    const rendered = await renderStage3Video(payload, {
      onProgress: (event) => {
        process.stdout.write(`${STAGE3_HOST_RENDER_PROGRESS_PREFIX}${JSON.stringify(event)}\n`);
      }
    });
    await writeOutput(args.output, {
      ok: true,
      resultJson: JSON.stringify({
        outputName: rendered.outputName,
        topCompacted: rendered.topCompacted,
        bottomCompacted: rendered.bottomCompacted,
        variation: {
          seed: rendered.variationManifest.seed,
          requestedMode: rendered.variationManifest.requestedMode,
          appliedMode: rendered.variationManifest.appliedMode,
          profileVersion: rendered.variationManifest.profileVersion
        }
      }),
      artifact: {
        filePath: rendered.filePath,
        fileName: rendered.outputName,
        mimeType: "video/mp4"
      },
      cleanupDir: rendered.cleanupDir
    });
  } catch (error) {
    await writeOutput(args.output, {
      ok: false,
      errorName: error instanceof Error ? error.name : undefined,
      errorMessage: error instanceof Error ? error.message : String(error),
      errorStack: error instanceof Error ? error.stack : undefined
    });
    process.exitCode = 1;
  }
}

void main();
