import { createHash } from "node:crypto";
import { normalizeSupportedUrl } from "../lib/supported-url.ts";
for (const u of process.argv.slice(2)) {
  const n = normalizeSupportedUrl(u);
  console.log(u, "|", n, "|", createHash("sha1").update(n).digest("hex"));
}
