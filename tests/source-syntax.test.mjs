import assert from "node:assert/strict";
import { readdir } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

const projectRoot = fileURLToPath(new URL("..", import.meta.url));
const sourceDirectories = ["includes/js", "scripts"];

test("application and server JavaScript files parse with the supported Node runtime", async () => {
  const files = [];
  for (const directory of sourceDirectories) {
    const fullDirectory = path.join(projectRoot, directory);
    const entries = await readdir(fullDirectory, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.isFile() && entry.name.endsWith(".js")) {
        files.push(path.join(fullDirectory, entry.name));
      }
    }
  }

  assert.ok(files.length > 0, "no source files found");
  for (const file of files) {
    const result = spawnSync(process.execPath, ["--check", file], { encoding: "utf8" });
    assert.equal(result.status, 0, `${path.relative(projectRoot, file)} failed syntax check:\n${result.stderr}`);
  }
});
