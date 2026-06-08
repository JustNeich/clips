import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("production Docker runtime keeps Codex writable under the non-root clips user", async () => {
  const dockerfile = await readFile("Dockerfile", "utf-8");
  const userIndex = dockerfile.indexOf("USER clips");
  assert.notEqual(userIndex, -1);

  assert.match(dockerfile, /^ENV HOME=\/home\/clips$/m);
  assert.match(dockerfile, /^ENV XDG_CACHE_HOME=\/home\/clips\/\.cache$/m);
  assert.match(dockerfile, /^ENV XDG_CONFIG_HOME=\/home\/clips\/\.config$/m);
  assert.match(dockerfile, /^ENV XDG_DATA_HOME=\/home\/clips\/\.local\/share$/m);
  assert.match(dockerfile, /^ENV XDG_STATE_HOME=\/home\/clips\/\.local\/state$/m);

  const beforeUser = dockerfile.slice(0, userIndex);
  assert.match(beforeUser, /chown -R clips:clips \/var\/data \/home\/clips/);
  assert.match(beforeUser, /chown -R clips:clips \/usr\/local\/lib\/node_modules\/@openai/);
  assert.match(beforeUser, /find \/usr\/local\/bin -maxdepth 1 -name 'codex\*' -exec chown -h clips:clips \{\} \+/);
});
