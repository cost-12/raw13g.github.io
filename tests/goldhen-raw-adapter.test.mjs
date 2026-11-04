import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import {
  GOLDHEN_1400_PATCHSET,
  GOLDHEN_1400_RAW,
  preflightGoldHENRaw,
} from "../includes/js/goldhen-raw-adapter.js";

function response(bytes, status = 200) {
  const buffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
  return { ok: status >= 200 && status < 300, status, arrayBuffer: async () => buffer };
}

test("GoldHEN 2.4b18.13 raw image preflight verifies exact size, header and SHA-256", async () => {
  const bytes = new Uint8Array(await readFile(
    new URL("../includes/payloads/GoldHEN/goldhen_v2.4b18.13.bin", import.meta.url)
  ));
  const telemetry = [];
  const result = await preflightGoldHENRaw({
    fetchImpl: async (url) => url === GOLDHEN_1400_RAW.path
      ? response(bytes)
      : response(new Uint8Array(), 404),
    telemetry: (tag, detail) => telemetry.push({ tag, detail }),
  });

  assert.equal(result.payloadVerified, true);
  assert.equal(result.dispatchAllowed, false);
  assert.equal(result.reason, "firmware-patchset-missing");
  assert.equal(result.patchsetPath, GOLDHEN_1400_PATCHSET.path);
  assert.equal(result.requiredKernelSites, 57);
  assert.equal(result.verifiedKernelSites, 0);
  assert.deepEqual(
    telemetry.map((event) => event.tag),
    [
      "PAYLOAD-SELECTED",
      "PAYLOAD-DOWNLOADED",
      "PAYLOAD-VALIDATED",
      "GOLDHEN-DISPATCH-BLOCKED",
    ],
  );
});

test("GoldHEN preflight remains blocked even when a 641-byte patchset-shaped file exists", async () => {
  const bytes = new Uint8Array(await readFile(
    new URL("../includes/payloads/GoldHEN/goldhen_v2.4b18.13.bin", import.meta.url)
  ));
  const patchset = new Uint8Array(GOLDHEN_1400_PATCHSET.bytes);
  patchset.fill(0x90);
  patchset[patchset.length - 1] = GOLDHEN_1400_PATCHSET.terminalByte;

  const result = await preflightGoldHENRaw({
    fetchImpl: async (url) => response(
      url === GOLDHEN_1400_RAW.path ? bytes : patchset
    ),
  });

  assert.equal(result.payloadVerified, true);
  assert.equal(result.patchsetShapeVerified, true);
  assert.equal(result.dispatchAllowed, false);
  assert.equal(result.reason, "canonical-57-site-readback-audit-missing");
  assert.equal(result.verifiedKernelSites, 0);
});

test("GoldHEN preflight refuses altered raw payload before checking patchset", async () => {
  const bytes = new Uint8Array(await readFile(
    new URL("../includes/payloads/GoldHEN/goldhen_v2.4b18.13.bin", import.meta.url)
  ));
  bytes[20] ^= 0xff;
  const requested = [];
  const result = await preflightGoldHENRaw({
    fetchImpl: async (url) => {
      requested.push(url);
      return response(bytes);
    },
  });
  assert.equal(result.dispatchAllowed, false);
  assert.equal(result.reason, "payload-digest-mismatch");
  assert.deepEqual(requested, [GOLDHEN_1400_RAW.path]);
});

test("GoldHEN raw adapter contains no thread-dispatch implementation", async () => {
  const source = await readFile(
    new URL("../includes/js/goldhen-raw-adapter.js", import.meta.url),
    "utf8",
  );
  assert.doesNotMatch(source, /pthread_create|callAddr|mmap\(/);
  assert.match(source, /dispatchAllowed: false/);
  assert.match(source, /canonical-57-site-readback-audit-missing/);
});
