import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

const manifestUrl = new URL("../cache.appcache", import.meta.url);
const manifest = await readFile(manifestUrl, "utf8");

test("every SHA-256 entry in the offline manifest matches its asset", async () => {
  const lines = manifest.split(/\r?\n/);
  const explicitLines = lines.slice(0, lines.indexOf("NETWORK:"));
  const entries = explicitLines
    .map((line) => line.match(/^# SHA-256: ([^\s]+) ([a-f0-9]{64})$/i))
    .filter(Boolean)
    .map(([, resource, hash]) => [resource, hash]);
  const resources = explicitLines.slice(1).filter((line) => line && !line.startsWith("#"));

  assert.ok(entries.length > 0, "manifest has no hash entries");
  assert.deepEqual(
    resources,
    entries.map(([resource]) => resource),
    "each explicit cache resource must have a separate SHA-256 comment"
  );
  assert.doesNotMatch(
    explicitLines.join("\n"),
    /^[^\s#]+[ \t]+#/m,
    "hash annotations must not be placed inline with resource URLs"
  );

  for (const [manifestPath, expectedHash] of entries) {
    const assetPath = manifestPath.split("?")[0];
    const bytes = await readFile(new URL(`../${assetPath}`, import.meta.url));
    const actualHash = createHash("sha256").update(bytes).digest("hex");
    assert.equal(actualHash, expectedHash.toLowerCase(), `${assetPath} hash mismatch`);
  }
});

test("both pages load the reporter and cache its source", async () => {
  assert.match(manifest, /^# SHA-256: includes\/js\/error-reporter\.js [a-f0-9]{64}$/m);
  assert.match(manifest, /^includes\/js\/error-reporter\.js$/m);
  for (const page of ["index.html", "jb.html"]) {
    const html = await readFile(new URL(`../${page}`, import.meta.url), "utf8");
    assert.match(html, /<script src="includes\/js\/error-reporter\.js"[^>]*><\/script>/);
  }
});

test("ApplicationCache errors are not reported as offline-ready", async () => {
  const index = await readFile(new URL("../index.html", import.meta.url), "utf8");
  const handler = index.match(/ac\.addEventListener\("error",\s*\(\)\s*=>\s*setCacheStatus\(([^;]+)\)\);/);
  assert.ok(handler, "ApplicationCache error handler is missing");
  assert.match(handler[1], /"bad",\s*"bad"/);
  assert.doesNotMatch(handler[1], /operante|pronto/i);
});
