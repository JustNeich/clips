import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { getTemplateFigmaSpec, getTemplateSpecRevision } from "../lib/stage3-template-spec";

type Args = {
  templateId: string;
  fileKey?: string;
  nodeId?: string;
};

function parseArgs(argv: string[]): Args {
  const values = new Map<string, string>();
  for (const token of argv) {
    const normalized = token.replace(/^--/, "");
    const separatorIndex = normalized.indexOf("=");
    if (separatorIndex === -1) {
      values.set(normalized, "1");
      continue;
    }
    values.set(normalized.slice(0, separatorIndex), normalized.slice(separatorIndex + 1));
  }

  const templateId = values.get("template");
  if (!templateId) {
    throw new Error("Expected --template=<templateId>.");
  }

  return {
    templateId,
    fileKey: values.get("fileKey") ?? undefined,
    nodeId: values.get("nodeId") ?? undefined
  };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const spec = getTemplateFigmaSpec(args.templateId);
  const templateDir = path.join(process.cwd(), "design", "templates", args.templateId);
  const targetPath = path.join(templateDir, "figma-spec.json");

  const nextSpec = {
    ...spec,
    figma:
      args.fileKey && args.nodeId
        ? {
            ...(spec.figma ?? {}),
            fileKey: args.fileKey,
            nodeId: args.nodeId
          }
        : spec.figma
  };

  await mkdir(templateDir, { recursive: true });
  await writeFile(targetPath, `${JSON.stringify(nextSpec, null, 2)}\n`, "utf-8");

  process.stdout.write(
    `${JSON.stringify(
      {
        templateId: args.templateId,
        targetPath,
        specRevision: getTemplateSpecRevision(args.templateId)
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
