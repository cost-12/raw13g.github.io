import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

import {
  FAN_THRESHOLD_ENDPOINT,
  FAN_THRESHOLD_OPTIONS,
  resolveFanThreshold,
  sendFanThreshold,
  sha256Hex,
  validateFanPayload,
} from "../includes/js/fan-threshold.js";

test("resolveFanThreshold resolves supported temperatures and rejects invalid inputs", () => {
  for (const temp of [60, 70, 80, 85]) {
    const opt = resolveFanThreshold(temp);
    assert.ok(opt, `Profile for ${temp} °C must exist`);
    assert.equal(opt.temperature, temp);
    assert.match(opt.path, new RegExp(`ps4-fan-threshold${temp}\\.bin$`));
    assert.equal(opt.sha256.length, 64);
  }

  for (const invalid of [50, 65, 75, 90, null, undefined, "abc", {}]) {
    assert.equal(resolveFanThreshold(invalid), null);
  }
});

test("all four fan-threshold binaries exist, match sha256, and differ only at 0x2318", async () => {
  const binaryData = {};

  for (const opt of FAN_THRESHOLD_OPTIONS) {
    const bytes = await readFile(new URL(`../${opt.path}`, import.meta.url));
    assert.equal(bytes.length, 8992, `${opt.path} must have length 8992`);

    const digest = createHash("sha256").update(bytes).digest("hex");
    assert.equal(digest, opt.sha256, `${opt.path} sha256 mismatch`);

    // Validate 5-byte header
    assert.equal(bytes[0], 0xe9);
    assert.equal(bytes[1], 0x00);
    assert.equal(bytes[2], 0x00);
    assert.equal(bytes[3], 0x00);
    assert.equal(bytes[4], 0x00);

    // Validate temperature byte at offset 0x2318
    assert.equal(bytes[0x2318], opt.temperature);

    binaryData[opt.temperature] = bytes;
  }

  // Verify that between any two binaries, only offset 0x2318 differs
  const base60 = binaryData[60];
  for (const temp of [70, 80, 85]) {
    const target = binaryData[temp];
    const diffOffsets = [];
    for (let i = 0; i < base60.length; i++) {
      if (base60[i] !== target[i]) {
        diffOffsets.push(i);
      }
    }
    assert.deepEqual(
      diffOffsets,
      [0x2318],
      `Binaries 60 and ${temp} must differ ONLY at offset 0x2318`,
    );
  }
});

test("sha256Hex matches the standard digest with Web Crypto and the fallback", async () => {
  for (const option of FAN_THRESHOLD_OPTIONS) {
    const source = await readFile(new URL(`../${option.path}`, import.meta.url));
    const bytes = new Uint8Array(source);
    const expected = createHash("sha256").update(bytes).digest("hex");
    assert.equal(await sha256Hex(bytes), expected);
  }

  const cryptoDescriptor = Object.getOwnPropertyDescriptor(globalThis, "crypto");
  try {
    Object.defineProperty(globalThis, "crypto", {
      value: undefined,
      configurable: true,
      writable: true,
    });
    for (const option of FAN_THRESHOLD_OPTIONS) {
      const source = await readFile(new URL(`../${option.path}`, import.meta.url));
      const bytes = new Uint8Array(source);
      const expected = createHash("sha256").update(bytes).digest("hex");
      assert.equal(await sha256Hex(bytes), expected, `fallback SHA-256 for ${option.temperature}`);
    }
  } finally {
    if (cryptoDescriptor) {
      Object.defineProperty(globalThis, "crypto", cryptoDescriptor);
    } else {
      delete globalThis.crypto;
    }
  }
});

test("validateFanPayload enforces byte checks and header integrity", async () => {
  const valid60 = await readFile(
    new URL("../includes/payloads/Tools/fan-thresholds/ps4-fan-threshold60.bin", import.meta.url),
  );
  assert.doesNotThrow(() => validateFanPayload(new Uint8Array(valid60), 60));

  // Temperature mismatch at 0x2318
  assert.throws(
    () => validateFanPayload(new Uint8Array(valid60), 70),
    /não corresponde ao limiar/,
  );

  // Invalid length
  assert.throws(
    () => validateFanPayload(new Uint8Array(valid60.slice(0, 5000)), 60),
    /Tamanho inesperado/,
  );

  // Invalid header
  const corruptedHeader = new Uint8Array(valid60);
  corruptedHeader[0] = 0x00;
  assert.throws(
    () => validateFanPayload(corruptedHeader, 60),
    /Cabeçalho do payload Fan Threshold inválido/,
  );

  // Invalid type
  assert.throws(
    () => validateFanPayload("not-a-uint8array", 60),
    TypeError,
  );
});

test("sendFanThreshold manages fetch, XHR dispatch, telemetry, and error handling", async () => {
  const validBytes = await readFile(
    new URL("../includes/payloads/Tools/fan-thresholds/ps4-fan-threshold70.bin", import.meta.url),
  );

  const mockFetch = async () => ({
    ok: true,
    status: 200,
    arrayBuffer: async () => validBytes.buffer.slice(validBytes.byteOffset, validBytes.byteOffset + validBytes.byteLength),
  });

  // Successful dispatch and BinLoader acceptance
  const telemetryRecords = [];
  class SuccessXHR {
    open(method, url) {
      this.method = method;
      this.url = url;
    }
    send(buffer) {
      assert.equal(this.method, "POST");
      assert.equal(this.url, FAN_THRESHOLD_ENDPOINT);
      assert.equal(buffer.byteLength, 8992);
      this.status = 200;
      setTimeout(() => this.onload(), 1);
    }
  }

  const result = await sendFanThreshold(70, {
    fetchImpl: mockFetch,
    XMLHttpRequestCtor: SuccessXHR,
    telemetry: (tag, detail) => telemetryRecords.push({ tag, detail }),
  });

  assert.equal(result.state, "FAN-PAYLOAD-ACCEPTED");
  assert.equal(result.temperature, 70);
  assert.equal(result.httpStatus, 200);
  assert.equal(result.targetConfirmed, false, "HTTP 200 does not confirm target thermal change");

  const tags = telemetryRecords.map((r) => r.tag);
  assert.ok(tags.includes("PAYLOAD-SELECTED"));
  assert.ok(tags.includes("PAYLOAD-DOWNLOADED"));
  assert.ok(tags.includes("PAYLOAD-VALIDATED"));
  assert.ok(tags.includes("FAN-PAYLOAD-SENT"));
  assert.ok(tags.includes("FAN-PAYLOAD-ACCEPTED"));

  // Failure: BinLoader returns HTTP 500
  class ErrorXHR {
    open() {}
    send() {
      this.status = 500;
      setTimeout(() => this.onload(), 1);
    }
  }
  await assert.rejects(
    () => sendFanThreshold(70, {
      fetchImpl: mockFetch,
      XMLHttpRequestCtor: ErrorXHR,
    }),
    /BinLoader respondeu HTTP 500/,
  );

  // Failure: BinLoader connection refused
  class NetworkErrorXHR {
    open() {}
    send() {
      setTimeout(() => this.onerror(), 1);
    }
  }
  await assert.rejects(
    () => sendFanThreshold(70, {
      fetchImpl: mockFetch,
      XMLHttpRequestCtor: NetworkErrorXHR,
    }),
    /Não foi possível conectar ao BinLoader em 127\.0\.0\.1:9090/,
  );

  // Failure: BinLoader timeout
  class TimeoutXHR {
    open() {}
    send() {
      setTimeout(() => this.ontimeout(), 1);
    }
  }
  await assert.rejects(
    () => sendFanThreshold(70, {
      fetchImpl: mockFetch,
      XMLHttpRequestCtor: TimeoutXHR,
    }),
    /Tempo esgotado ao enviar o payload ao BinLoader/,
  );
});

test("sendFanThreshold rejects altered bytes before contacting BinLoader", async () => {
  const option = resolveFanThreshold(70);
  const source = await readFile(new URL(`../${option.path}`, import.meta.url));
  const tampered = new Uint8Array(source);
  tampered[0x100] ^= 0x01;
  let sent = false;

  class MustNotSendXHR {
    open() {}
    send() {
      sent = true;
    }
  }

  await assert.rejects(
    () => sendFanThreshold(70, {
      fetchImpl: async () => ({
        ok: true,
        status: 200,
        arrayBuffer: async () => tampered.buffer,
      }),
      XMLHttpRequestCtor: MustNotSendXHR,
    }),
    /SHA-256 divergente no payload Fan Threshold/,
  );
  assert.equal(sent, false, "tampered bytes must never reach BinLoader");
});

test("cache.appcache lists fan-threshold script and all 4 binary files with valid hashes", async () => {
  const manifest = await readFile(new URL("../cache.appcache", import.meta.url), "utf8");

  assert.match(manifest, /^# SHA-256: includes\/js\/fan-threshold\.js [0-9a-f]{64}$/m);
  assert.match(manifest, /^includes\/js\/fan-threshold\.js$/m);

  for (const temp of [60, 70, 80, 85]) {
    const relPath = `includes/payloads/Tools/fan-thresholds/ps4-fan-threshold${temp}\\.bin`;
    assert.match(manifest, new RegExp(`^# SHA-256: ${relPath} [0-9a-f]{64}$`, "m"));
    assert.match(manifest, new RegExp(`^${relPath}$`, "m"));
  }
});

