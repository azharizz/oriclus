import { test } from "node:test";
import { strict as assert } from "node:assert";
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";

test("frontend source does not use effect hooks", async () => {
  async function inspect(directory) {
    const entries = await readdir(directory, { withFileTypes: true });
    for (const entry of entries) {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) await inspect(path);
      else if (/\.[jt]sx?$/.test(entry.name)) {
        const source = await readFile(path, "utf8");
        assert.doesNotMatch(source, /\buse(?:Layout|Insertion)?Effect\b/, path);
      }
    }
  }
  await inspect("web/src");
});
