import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("production Docker runtime keeps Codex writable under the non-root clips user", async () => {
  const dockerfile = await readFile("Dockerfile", "utf-8");

  assert.match(dockerfile, /^ENV HOME=\/home\/clips$/m);
  assert.match(dockerfile, /^ENV XDG_CACHE_HOME=\/home\/clips\/\.cache$/m);
  assert.match(dockerfile, /^ENV XDG_CONFIG_HOME=\/home\/clips\/\.config$/m);
  assert.match(dockerfile, /^ENV XDG_DATA_HOME=\/home\/clips\/\.local\/share$/m);
  assert.match(dockerfile, /^ENV XDG_STATE_HOME=\/home\/clips\/\.local\/state$/m);
  assert.match(dockerfile, /\bgosu\b/);
  assert.doesNotMatch(dockerfile, /^USER clips$/m);
  assert.match(
    dockerfile,
    /^CMD \["\/bin\/sh", "scripts\/render-entrypoint\.sh"\]$/m
  );

  assert.match(dockerfile, /chown -R clips:clips \/var\/data \/home\/clips/);
  assert.match(dockerfile, /chown -R clips:clips \/usr\/local\/lib\/node_modules\/@openai/);
  assert.match(dockerfile, /find \/usr\/local\/bin -maxdepth 1 -name 'codex\*' -exec chown -h clips:clips \{\} \+/);
});

test("Render entrypoint repairs mounted persistent disk ownership before dropping privileges", async () => {
  const entrypoint = await readFile("scripts/render-entrypoint.sh", "utf-8");

  assert.match(entrypoint, /mkdir -p "\$APP_DATA_DIR" "\$CODEX_SESSIONS_DIR"/);
  assert.match(
    entrypoint,
    /chown clips:clips "\$APP_DATA_DIR" "\$CODEX_SESSIONS_DIR"/
  );
  assert.match(
    entrypoint,
    /chown -R clips:clips "\$CODEX_SESSIONS_DIR" "\$HOME"/
  );
  assert.match(
    entrypoint,
    /exec gosu clips \.\/node_modules\/\.bin\/next start -H 0\.0\.0\.0 -p "\$PORT"/
  );
});
