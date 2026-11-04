import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { test } from "node:test";

const require = createRequire(import.meta.url);
const {
  createDevServer,
  getLanIPv4Addresses,
  parseCliOptions,
} = require("../scripts/dev-server.js");

test("server CLI defaults to loopback and offers an explicit LAN mode", () => {
  assert.deepEqual(parseCliOptions([], {}), {
    host: "127.0.0.1",
    port: 8080,
    lan: false,
  });
  assert.deepEqual(parseCliOptions(["--lan"], {}), {
    host: "0.0.0.0",
    port: 8080,
    lan: true,
  });
  assert.deepEqual(parseCliOptions(["--host", "0.0.0.0", "--port", "9000"], {}), {
    host: "0.0.0.0",
    port: 9000,
    lan: true,
  });
  assert.throws(() => parseCliOptions(["--port", "bad"], {}), /PORT/);
  assert.throws(() => parseCliOptions(["--unknown"], {}), /desconhecida/);
});

test("LAN address discovery lists private IPv4 interfaces only", () => {
  const interfaces = {
    lo: [{ family: "IPv4", address: "127.0.0.1", internal: true }],
    wlan0: [{ family: "IPv4", address: "192.168.1.42", internal: false }],
    eth0: [{ family: 4, address: "10.0.0.8", internal: false }],
    docker0: [{ family: "IPv4", address: "172.18.0.1", internal: false }],
    uplink: [{ family: "IPv4", address: "203.0.113.7", internal: false }],
    wifi6: [{ family: "IPv6", address: "fe80::1", internal: false }],
  };
  assert.deepEqual(getLanIPv4Addresses(interfaces), [
    { name: "wlan0", address: "192.168.1.42" },
    { name: "eth0", address: "10.0.0.8" },
    { name: "docker0", address: "172.18.0.1" },
  ]);
});

test("server accepts requests when bound to all network interfaces", async () => {
  const server = createDevServer();
  try {
    await new Promise((resolve, reject) => {
      server.once("error", reject);
      server.listen(0, "0.0.0.0", resolve);
    });
    const response = await fetch(`http://127.0.0.1:${server.address().port}/__health`);
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { ok: true });
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test("local server serves files and stores diagnostic records", async () => {
  const temporaryDirectory = await mkdtemp(path.join(tmpdir(), "raw13g-server-test-"));
  const publicRoot = path.join(temporaryDirectory, "public");
  const logDirectory = path.join(temporaryDirectory, "logs");
  await mkdir(publicRoot, { recursive: true });
  await writeFile(path.join(publicRoot, "index.html"), "<h1>fixture</h1>");
  await writeFile(path.join(publicRoot, "cache.appcache"), "CACHE MANIFEST\n");

  const server = createDevServer({ root: publicRoot, logDir: logDirectory });
  try {
    await new Promise((resolve, reject) => {
      server.once("error", reject);
      server.listen(0, "127.0.0.1", resolve);
    });
    const { port } = server.address();
    const base = `http://127.0.0.1:${port}`;

    const health = await fetch(`${base}/__health`);
    assert.equal(health.status, 200);
    assert.deepEqual(await health.json(), { ok: true });

    const home = await fetch(base);
    assert.equal(await home.text(), "<h1>fixture</h1>");
    const manifest = await fetch(`${base}/cache.appcache`);
    assert.match(manifest.headers.get("content-type"), /text\/cache-manifest/);

    const error = {
      schemaVersion: 1,
      timestamp: new Date().toISOString(),
      type: "runtime",
      message: "example failure",
      stack: "example stack",
      source: "/app.js",
      line: 4,
      column: 2,
      page: "/index.html",
      userAgent: "test browser",
    };
    const accepted = await fetch(`${base}/__errors`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(error),
    });
    assert.equal(accepted.status, 202);
    assert.deepEqual(await accepted.json(), { accepted: true });

    const executionEvent = await fetch(`${base}/__errors`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        schemaVersion: 2,
        timestamp: new Date().toISOString(),
        type: "telemetry",
        event: "execution.start",
        message: "execution.start at 0xffffffff",
        page: "/jb.html?token=secret",
        source: "https://example.invalid/app.js?token=secret",
        userAgent: "test browser",
        sessionId: "session-1",
        runId: "run-1",
        firmware: "14.00",
        stage: 9,
        elapsedMs: 1234,
        application: "PS4HEN",
        asset: "payload2.bin",
        sizeBytes: 500544,
        httpStatus: 200,
        options: { jb: true, patch: false, payload: true, keepJb: false, extra: "discard" },
        diagnostics: {
          kind: "profile",
          carrierSlots: 2800000,
          maxAttempts: 2,
          attemptNumber: 1,
          copiedChars: 924176,
          sourceCovered: true,
          placementError: "ssv-deserialize",
          rawOffset: "0xdeadbeef",
        },
      }),
    });
    assert.equal(executionEvent.status, 202);

    const ordinaryEvent = await fetch(`${base}/t`, {
      method: "POST",
      headers: {
        "content-type": "application/x-www-form-urlencoded",
        referer: `${base}/jb.html`,
      },
      body: "PS4-JB&tag=PRIMITIVE-OK&detail=ready&runId=run-1&stage=1&elapsedMs=2000&firmware=14.00",
    });
    assert.equal(ordinaryEvent.status, 204);

    const handledFailure = await fetch(`${base}/t`, {
      method: "POST",
      headers: {
        "content-type": "application/x-www-form-urlencoded",
        referer: `${base}/jb.html?secret=hidden`,
      },
      body: "PS4-JB&tag=HEAP-PLACEMENT-MISS&detail=attempt+failed+at+0xffffffff&runId=run-1&stage=2&elapsedMs=3333&firmware=14.00",
    });
    assert.equal(handledFailure.status, 204);

    const successMarkers = [
      ["READ-PRIMITIVE-PASS", "arbitrary-read-established"],
      ["CANDIDATE-HEADER-SOURCE", "type=object-undefined=0-coerced-zero=0"],
      ["CORE-REVISION", "raw13g-core-v60"],
      ["HX1400-START", "route-entered"],
      ["HX1400-KERNEL-COMPLETE", "kernel-chain-finished"],
      ["PAYLOAD-LAUNCH-RETURNED", "accepted=false"],
      ["HEN-ARTIFACTS-OBSERVED", "new=/data/hen/version.txt"],
      ["HEN-PENDING", "readiness-unverified"],
      ["HEN-READY-CLAIM", "independent-attestation=false"],
      ["PRIMITIVE-HANDOFF", "phase=webkit-native-resolution"],
      ["NATIVE-FUNCTION-LOOKUP-START", "symbol=Math.expm1"],
      ["WEBKIT-BASE-RESOLVED", "resolved=true"],
      ["LIBKERNEL-ELF-SCAN-START", "step=0x4000"],
      ["SYSCALL-STUBS-READY", "found=4 missing=0"],
      ["HX1400-POST-PRIMITIVE-GATE", "eligible=true"],
      ["GROOM-PROFILE", "name=silverps4hen-mem1"],
      ["LEGACY-KERNEL-TABLE-SKIPPED", "FW 14.00 has no verified legacy kernel table"],
      ["LEGACY-KPATCH-TABLE-SKIPPED", "HX1400 kernel data is separate"],
      ["LEGACY-PAYLOAD-TABLE-SKIPPED", "HX1400 launch path is separate"],
      ["GOLDHEN-DISPATCH-BLOCKED", "reason=firmware-patchset-missing"],
      ["GOLDHEN-57-SITE-AUDIT-BLOCKED", "required=57 verified=0"],
      ["PS4DEBUG-PAYLOAD-SENT", "bytes=3175432"],
      ["PS4DEBUG-PAYLOAD-ACCEPTED", "httpStatus=202 serverObserved=false"],
      ["PS4DEBUG-SERVER-OBSERVED", "protocolVersion=1.3"],
    ];
    for (const [tag, detail] of successMarkers) {
      const response = await fetch(base + "/t", {
        method: "POST",
        headers: {
          "content-type": "application/x-www-form-urlencoded",
          referer: base + "/jb.html",
        },
        body: "PS4-JB&tag=" + encodeURIComponent(tag) +
          "&detail=" + encodeURIComponent(detail) +
          "&runId=run-1&stage=1&elapsedMs=4000&firmware=14.00",
      });
      assert.equal(response.status, 204, tag);
    }

    const blockedExecutionEvent = await fetch(`${base}/__errors`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        schemaVersion: 2,
        timestamp: new Date().toISOString(),
        type: "telemetry",
        event: "execution.blocked",
        message: "execution.blocked",
        page: "/jb.html",
        userAgent: "test browser",
        sessionId: "session-blocked",
        status: "running",
        lockOwner: "old-run-123",
        lockState: "running",
        lockStage: 1,
        lockAgeMs: 12500,
        lockStartedAt: 1700000000000,
        lockUpdatedAt: 1700000012500,
        lockProtected: false,
      }),
    });
    assert.equal(blockedExecutionEvent.status, 202);

    const log = (await readFile(path.join(logDirectory, "runtime-errors.ndjson"), "utf8"))
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line));
    assert.equal(log.length, 5 + successMarkers.length);
    assert.equal(log[0].message, "example failure");
    assert.equal(log[1].schemaVersion, 2);
    assert.equal(log[1].event, "execution.start");
    assert.equal(log[1].sessionId, "session-1");
    assert.equal(log[1].runId, "run-1");
    assert.equal(log[1].firmware, "14.00");
    assert.equal(log[1].stage, 4);
    assert.equal(log[1].page, "/jb.html");
    assert.equal(log[1].source, "");
    assert.equal(log[1].message, "execution.start at [endereço oculto]");
    assert.equal(log[1].application, "PS4HEN");
    assert.equal(log[1].asset, "payload2.bin");
    assert.equal(log[1].sizeBytes, 500544);
    assert.equal(log[1].httpStatus, 200);
    assert.deepEqual(log[1].options, { jb: true, patch: false, payload: true, keepJb: false });
    assert.deepEqual(log[1].diagnostics, {
      kind: "profile",
      carrierSlots: 2800000,
      maxAttempts: 2,
      attemptNumber: 1,
      copiedChars: 924176,
      sourceCovered: true,
      placementError: "ssv-deserialize",
    });
    assert.equal(log[2].type, "handled");
    assert.equal(log[2].schemaVersion, 2);
    assert.equal(log[2].event, "handled.primitive-ok");
    assert.equal(log[2].runId, "run-1");
    assert.equal(log[2].page, "/jb.html");
    assert.equal(log[2].message, "PRIMITIVE-OK: ready");

    assert.equal(log[3].type, "handled");
    assert.equal(log[3].schemaVersion, 2);
    assert.equal(log[3].event, "handled.heap-placement-miss");
    assert.equal(log[3].runId, "run-1");
    assert.equal(log[3].stage, 2);
    assert.equal(log[3].elapsedMs, 3333);
    assert.equal(log[3].firmware, "14.00");
    assert.equal(log[3].page, "/jb.html");
    assert.equal(log[3].message, "HEAP-PLACEMENT-MISS: attempt failed at [endereço oculto]");

    assert.deepEqual(
      log.slice(4, -1).map((record) => record.event),
      [
        "handled.read-primitive-pass",
        "handled.candidate-header-source",
        "handled.core-revision",
        "handled.hx1400-start",
        "handled.hx1400-kernel-complete",
        "handled.payload-launch-returned",
        "handled.hen-artifacts-observed",
        "handled.hen-pending",
        "handled.hen-ready-claim",
        "handled.primitive-handoff",
        "handled.native-function-lookup-start",
        "handled.webkit-base-resolved",
        "handled.libkernel-elf-scan-start",
        "handled.syscall-stubs-ready",
        "handled.hx1400-post-primitive-gate",
        "handled.groom-profile",
        "handled.legacy-kernel-table-skipped",
        "handled.legacy-kpatch-table-skipped",
        "handled.legacy-payload-table-skipped",
        "handled.goldhen-dispatch-blocked",
        "handled.goldhen-57-site-audit-blocked",
        "handled.ps4debug-payload-sent",
        "handled.ps4debug-payload-accepted",
        "handled.ps4debug-server-observed",
      ],
    );
    assert.equal(log[4].message, "READ-PRIMITIVE-PASS: arbitrary-read-established");
    assert.equal(log[5].message, "CANDIDATE-HEADER-SOURCE: type=object-undefined=0-coerced-zero=0");
    assert.equal(log[6].message, "CORE-REVISION: raw13g-core-v60");
    assert.equal(log[7].message, "HX1400-START: route-entered");

    const blockedRecord = log.at(-1);
    assert.equal(blockedRecord.event, "execution.blocked");
    assert.equal(blockedRecord.sessionId, "session-blocked");
    assert.equal(blockedRecord.status, "running");
    assert.equal(blockedRecord.lockOwner, "old-run-123");
    assert.equal(blockedRecord.lockState, "running");
    assert.equal(blockedRecord.lockStage, 1);
    assert.equal(blockedRecord.lockAgeMs, 12500);
    assert.equal(blockedRecord.lockStartedAt, 1700000000000);
    assert.equal(blockedRecord.lockUpdatedAt, 1700000012500);
    assert.equal(blockedRecord.lockProtected, false);

    const hiddenLog = await fetch(`${base}/.local-logs/runtime-errors.ndjson`);
    assert.equal(hiddenLog.status, 404);
    const invalid = await fetch(`${base}/__errors`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{}",
    });
    assert.equal(invalid.status, 400);

    const oversized = await fetch(`${base}/__errors`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ data: "x".repeat(65 * 1024) }),
    });
    assert.equal(oversized.status, 413);
  } finally {
    await new Promise((resolve) => server.close(resolve));
    await rm(temporaryDirectory, { recursive: true, force: true });
  }
});
