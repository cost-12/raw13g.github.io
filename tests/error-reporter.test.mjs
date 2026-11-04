import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { runInNewContext } from "node:vm";
import { test } from "node:test";

const source = await readFile(
  new URL("../includes/js/error-reporter.js", import.meta.url),
  "utf8",
);

function createReporter(hostname, applicationCache) {
  const listeners = new Map();
  const requests = [];
  const pageWindow = {
    location: {
      hostname,
      pathname: "/jb.html",
      href: `http://${hostname}/jb.html?token=private`,
    },
    addEventListener(type, listener) {
      listeners.set(type, listener);
    },
    applicationCache,
  };

  class FakeXMLHttpRequest {
    open(method, url, async) {
      this.method = method;
      this.url = url;
      this.async = async;
    }

    setRequestHeader(name, value) {
      this.contentType = [name, value];
    }

    send(body) {
      requests.push({
        method: this.method,
        url: this.url,
        async: this.async,
        contentType: this.contentType,
        record: JSON.parse(body),
      });
    }
  }

  runInNewContext(source, {
    window: pageWindow,
    navigator: { userAgent: "Test Browser" },
    XMLHttpRequest: FakeXMLHttpRequest,
    URL,
  });
  return { listeners, requests, pageWindow };
}

test("reporter stays inactive on public hosts", () => {
  const reporter = createReporter("raw13g.github.io");
  assert.equal(reporter.listeners.size, 0);
  assert.equal(reporter.requests.length, 0);
});

test("reporter sends runtime errors without query strings", () => {
  const reporter = createReporter("localhost");
  reporter.listeners.get("error")({
    target: reporter.pageWindow,
    message: "ReferenceError: missing value",
    error: { stack: "stack trace" },
    filename: "http://localhost/includes/js/app.js?cache=1",
    lineno: 12,
    colno: 4,
  });

  assert.equal(reporter.requests.length, 1);
  assert.equal(reporter.requests[0].url, "/__errors");
  assert.equal(reporter.requests[0].record.type, "runtime");
  assert.equal(reporter.requests[0].record.page, "/jb.html");
  assert.equal(reporter.requests[0].record.source, "/includes/js/app.js");
  assert.equal(reporter.requests[0].record.line, 12);
  assert.equal(reporter.requests[0].record.column, 4);
});

test("reporter records bounded execution-lock diagnostics for blocked sessions", () => {
  const reporter = createReporter("localhost");
  reporter.pageWindow.reportExecutionTelemetry("blocked", {
    status: "running",
    lockOwner: "old-run-123",
    lockState: "running",
    lockStage: 1,
    lockAgeMs: 12_500,
    lockStartedAt: 1_700_000_000_000,
    lockUpdatedAt: 1_700_000_012_500,
    lockProtected: false,
  });

  const record = reporter.requests[0].record;
  assert.equal(record.event, "execution.blocked");
  assert.equal(record.status, "running");
  assert.equal(record.lockOwner, "old-run-123");
  assert.equal(record.lockState, "running");
  assert.equal(record.lockStage, 1);
  assert.equal(record.lockAgeMs, 12_500);
  assert.equal(record.lockStartedAt, 1_700_000_000_000);
  assert.equal(record.lockUpdatedAt, 1_700_000_012_500);
  assert.equal(record.lockProtected, false);
});

test("reporter captures promise rejections and resource failures", () => {
  const reporter = createReporter("192.168.1.20");
  reporter.listeners.get("unhandledrejection")({
    reason: Object.assign(new Error("async failure"), { stack: "promise stack" }),
  });
  reporter.listeners.get("error")({
    target: { src: "http://192.168.1.20/missing.js?token=secret" },
  });

  assert.equal(reporter.requests.length, 2);
  assert.equal(reporter.requests[0].record.type, "unhandledrejection");
  assert.equal(reporter.requests[0].record.message, "async failure");
  assert.equal(reporter.requests[1].record.type, "resource");
  assert.equal(reporter.requests[1].record.source, "/missing.js");
});

test("reporter captures execution lifecycle with bounded diagnostic fields", () => {
  const reporter = createReporter("localhost");
  const send = reporter.pageWindow.reportExecutionTelemetry;
  send("start", {
    runId: "run-123",
    options: { jb: true, patch: false, payload: true, keepJb: false },
  });
  send("firmware", { firmware: "14.00", status: "recognized" });
  send("stage", { stage: 1 });
  send("stage", { stage: 2 });
  send("end", { stage: 2, status: "failed", passCount: 3, failCount: 1 });

  const records = reporter.requests.map((request) => request.record);
  assert.deepEqual(records.map((record) => record.event), [
    "execution.start",
    "execution.firmware",
    "execution.stage",
    "execution.stage",
    "execution.end",
  ]);
  assert.equal(records[0].schemaVersion, 2);
  assert.equal(records[0].runId, "run-123");
  assert.deepEqual(records[0].options, {
    jb: true,
    patch: false,
    payload: true,
    keepJb: false,
  });
  assert.equal(records[1].firmware, "14.00");
  assert.equal(records[3].stage, 2);
  assert.equal(records[3].previousStage, 1);
  assert.ok(Number.isFinite(records[3].stageDurationMs));
  assert.equal(records[4].status, "failed");
  assert.equal(records[4].passCount, 3);
  assert.equal(records[4].failCount, 1);
  assert.ok(records.every((record) => record.sessionId));
});

test("reporter records allowlisted tool events from the homepage and rejects arbitrary tags", () => {
  const reporter = createReporter("192.168.100.204");
  const send = reporter.pageWindow.reportToolTelemetry;
  assert.equal(typeof send, "function");

  send("PS4DEBUG-PAYLOAD-SENT", "bytes=3175432 endpoint=http://127.0.0.1:9090/");
  send("PS4DEBUG-PAYLOAD-ACCEPTED", "httpStatus=202 serverObserved=false");
  send("UNRESTRICTED-ARBITRARY-TAG", "must not be recorded");

  assert.equal(reporter.requests.length, 2);
  assert.equal(reporter.requests[0].url, "/__errors");
  assert.equal(reporter.requests[0].record.type, "telemetry");
  assert.equal(reporter.requests[0].record.event, "tool.ps4debug-payload-sent");
  assert.equal(
    reporter.requests[0].record.message,
    "PS4DEBUG-PAYLOAD-SENT: bytes=3175432 endpoint=http://127.0.0.1:9090/",
  );
  assert.equal(reporter.requests[1].record.event, "tool.ps4debug-payload-accepted");
  assert.equal(reporter.requests[1].record.status, "observed");
  assert.ok(reporter.requests.every((request) => request.record.sessionId));
});

test("reporter captures AppCache state and samples download progress", () => {
  const cacheListeners = new Map();
  const appCache = {
    status: 4,
    addEventListener(type, listener) {
      cacheListeners.set(type, listener);
    },
  };
  const reporter = createReporter("localhost", appCache);
  cacheListeners.get("cached")();
  cacheListeners.get("progress")({ loaded: 1, total: 4 });
  cacheListeners.get("progress")({ loaded: 1, total: 4 });
  reporter.listeners.get("load")();

  assert.equal(reporter.requests.length, 3);
  assert.equal(reporter.requests[0].record.event, "appcache.cached");
  assert.equal(reporter.requests[0].record.status, "update-ready");
  assert.equal(reporter.requests[1].record.event, "appcache.progress");
  assert.equal(reporter.requests[1].record.progressPercent, 25);
  assert.equal(reporter.requests[2].record.event, "page.load");
  assert.equal(reporter.requests[2].record.status, "update-ready");
});

test("reporter records when AppCache is unsupported", () => {
  const reporter = createReporter("localhost");
  reporter.listeners.get("load")();

  assert.equal(reporter.requests.length, 1);
  assert.equal(reporter.requests[0].record.event, "page.load");
  assert.equal(reporter.requests[0].record.status, "unsupported");
});

test("reporter records application selection, asset load, and launch status", () => {
  const reporter = createReporter("localhost");
  reporter.pageWindow.reportExecutionTelemetry("start", { runId: "run-app-1" });
  const reportApp = reporter.pageWindow.reportApplicationTelemetry;
  reportApp("selected", {
    application: "PS4HEN",
    asset: "payload2.bin",
    status: "selected",
  });
  reportApp("asset", {
    application: "PS4HEN",
    asset: "payload2.bin",
    status: "downloaded",
    sizeBytes: 500544,
    httpStatus: 200,
  });
  reportApp("launch", {
    application: "PS4HEN",
    asset: "payload2.bin",
    status: "started",
  });
  reportApp("launch", {
    application: "PS4HEN",
    asset: "../secret.bin",
    status: "started",
  });

  const records = reporter.requests.slice(1).map((request) => request.record);
  assert.deepEqual(records.map((record) => record.event), [
    "application.selected",
    "application.asset",
    "application.launch",
    "application.launch",
  ]);
  assert.ok(records.every((record) => record.runId === "run-app-1"));
  assert.equal(records[1].application, "PS4HEN");
  assert.equal(records[1].asset, "payload2.bin");
  assert.equal(records[1].sizeBytes, 500544);
  assert.equal(records[1].httpStatus, 200);
  assert.equal(records[3].asset, undefined, "asset paths must not be sent");
});

test("reporter keeps execution diagnostics bounded and structured", () => {
  const reporter = createReporter("192.168.1.42");
  reporter.pageWindow.reportExecutionTelemetry("start", { runId: "run-diag-1" });
  reporter.pageWindow.reportExecutionDiagnostics("profile", {
    carrierSlots: 2800000,
    maxAttempts: 2,
    attemptNumber: 1,
    copiedChars: 924176,
    sourceCovered: true,
    placementError: "ssv-deserialize",
    drainCount: 256,
    drainBytes: 16777216,
    slabBytes: 4194304,
    rawOffset: "0xdeadbeef",
  });
  reporter.pageWindow.reportExecutionDiagnostics("offsets", {
    offsetHash: "ABCDEF12",
    offsetCount: 80,
    offsetAligned: 64,
    offsetMissing: 0,
  });
  reporter.pageWindow.reportExecutionDiagnostics("identity", {
    uidClass: "user",
    uid: 1000,
    pid: 1234,
  });

  const diagnostics = reporter.requests.map((request) => request.record.diagnostics).filter(Boolean);
  assert.equal(diagnostics.length, 3);
  assert.deepEqual(diagnostics[0], {
    kind: "profile",
    carrierSlots: 2800000,
    maxAttempts: 2,
    attemptNumber: 1,
    copiedChars: 924176,
    sourceCovered: true,
    placementError: "ssv-deserialize",
    drainCount: 256,
    drainBytes: 16777216,
    slabBytes: 4194304,
  });
  assert.equal(diagnostics[1].offsetHash, "ABCDEF12");
  assert.equal(diagnostics[1].rawOffset, undefined);
  assert.deepEqual(diagnostics[2], { kind: "identity", uidClass: "user", uid: 1000, pid: 1234 });
});
