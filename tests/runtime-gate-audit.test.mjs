import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";

import {
  analyzeRuntimeLog,
  parseNdjson,
  renderMarkdown,
} from "../scripts/audit-runtime-gates.mjs";

function record(runId, event, extra = {}) {
  return {
    runId,
    event,
    timestamp: "2026-10-31T08:30:00.000Z",
    ...extra,
  };
}

test("NDJSON parser reports malformed lines and continues", () => {
  const parsed = parseNdjson([
    '{"runId":"a","event":"execution.start"}',
    "{broken",
    "",
    '{"runId":"a","event":"execution.end","status":"failed"}',
  ].join("\n"));

  assert.equal(parsed.records.length, 2);
  assert.equal(parsed.errors.length, 1);
  assert.equal(parsed.errors[0].line, 2);
});

test("latest run is selected by execution start timestamp", () => {
  const records = [
    record("older", "execution.start", { timestamp: "2026-10-31T07:00:00Z" }),
    record("newer", "execution.start", { timestamp: "2026-10-31T08:00:00Z" }),
    record("older", "execution.end", { timestamp: "2026-10-31T08:10:00Z", status: "failed" }),
  ];

  const report = analyzeRuntimeLog(records);
  assert.equal(report.runId, "newer");
  assert.equal(report.endStatus, "no execution.end record");
});

test("HX kernel completion and HEN artifacts do not imply HEN readiness", () => {
  const records = [
    record("hx-claims", "execution.start", { firmware: "14.00" }),
    record("hx-claims", "handled.hx1400-kernel-complete", {
      message: "HX1400-KERNEL-COMPLETE: kernel patch chain completed",
    }),
    record("hx-claims", "handled.hen-artifacts-observed", {
      message: "HEN-ARTIFACTS-OBSERVED: new candidate path reported",
    }),
    record("hx-claims", "handled.hen-readiness-unverified", {
      message: "HEN-READINESS-UNVERIFIED: no independent readiness proof",
    }),
    record("hx-claims", "execution.end", {
      status: "hx1400-hen-artifacts-observed-unverified",
    }),
  ];

  const report = analyzeRuntimeLog(records);
  assert.equal(report.hx1400CompleteObserved, true);
  assert.equal(report.henArtifactsObserved, true);
  assert.equal(report.henReadyClaimReported, false);
  assert.equal(
    report.disposition,
    "hx1400-kernel-chain-complete-hen-artifacts-client-reported",
  );

  const markdown = renderMarkdown(report);
  assert.match(markdown, /HX1400 kernel-chain completion marker observed/);
  assert.match(markdown, /new candidate paths reported \(client-side claim\)/);
  assert.match(markdown, /HEN readiness.*not established/);

  const claimReport = analyzeRuntimeLog([
    ...records,
    record("hx-claims", "handled.hen-ready-claim", {
      message: "HEN-READY-CLAIM: client claim without target attestation",
    }),
  ]);
  assert.equal(claimReport.henReadyClaimReported, true);
  assert.equal(claimReport.disposition, "hx1400-hen-ready-client-claim-unverified");
});

test("history-state placement miss blocks the run and does not imply payload or HEN success", () => {
  const records = [
    record("run-1", "execution.start", { firmware: "14.00" }),
    record("run-1", "execution.firmware", { firmware: "14.00", status: "recognized" }),
    record("run-1", "execution.stage", { stage: 1 }),
    record("run-1", "handled.addrof-copy", {
      message: "ADDROF-COPY: [1] chars=924176-source-covered=true",
    }),
    record("run-1", "handled.ssv-placement-miss", {
      message: "SSV-PLACEMENT-MISS: TypeError:Unable to deserialize data.-stage=history-state",
    }),
    record("run-1", "handled.threw", {
      message: "THREW: core: gave up after 1 attempts (attempt-ceiling)",
    }),
    record("run-1", "handled.heap-placement-miss", {
      message: "HEAP-PLACEMENT-MISS: alignment pending",
    }),
    record("run-1", "application.asset", { status: "not-reached", asset: "payload2.bin" }),
    record("run-1", "execution.end", { status: "placement-miss", passCount: 3, failCount: 0 }),
  ];

  const report = analyzeRuntimeLog(records);
  assert.equal(report.ssvBlocked, true);
  assert.equal(report.stageMax, 1);
  assert.equal(report.addrofCopyObserved, true);
  assert.equal(report.addrofCopySourceCovered, true);
  assert.equal(report.addrofCopyChars, 924176);
  assert.equal(report.appAssetNotReached, true);
  assert.equal(report.evidenceBoundary.payloadTransferReported, false);
  assert.equal(report.evidenceBoundary.henInstalledClaimReported, false);
  assert.equal(report.evidenceBoundary.independentTargetEvidencePresent, false);
  assert.equal(report.endStatus, "placement-miss");
  assert.equal(report.passCount, 3);
  assert.equal(report.attemptCeiling, true);
});

test("an intermediate SSV placement miss is recovered when a later primitive pass is recorded", () => {
  const records = [
    record("run-recovered", "execution.start", { firmware: "14.00" }),
    record("run-recovered", "handled.memory-config", {
      message: "MEMORY-CONFIG: [1] carrier-slots=9100000-carrier-bytes=72800000-drain-count=48-drain-bytes=1572864-slab-bytes=3145728",
    }),
    record("run-recovered", "handled.addrof-refresh-copy", {
      message: "ADDROF-REFRESH-COPY: chars=34478608",
    }),
    record("run-recovered", "handled.ssv-placement-miss", {
      message: "SSV-PLACEMENT-MISS: TypeError:Unable to deserialize data.-stage=history-state",
    }),
    record("run-recovered", "handled.read-primitive-pass", {
      message: "READ-PRIMITIVE-PASS: arbitrary-read-established",
    }),
    record("run-recovered", "handled.primitive-ok", {
      message: "PRIMITIVE-OK",
    }),
    record("run-recovered", "handled.libkernel-discovered", {
      message: "LIBKERNEL-DISCOVERED",
    }),
    record("run-recovered", "handled.core-revision", {
      message: "CORE-REVISION: raw13g-core-v60",
    }),
    record("run-recovered", "handled.hx1400-start", {
      message: "HX1400-START",
    }),
  ];

  const report = analyzeRuntimeLog(records);
  assert.equal(report.ssvPlacementMissCount, 1);
  assert.equal(report.ssvBlocked, false);
  assert.equal(report.ssvRecoveredAfterRetry, true);
  assert.equal(report.readPrimitivePassObserved, true);
  assert.equal(report.primitiveOkObserved, true);
  assert.equal(report.libkernelDiscovered, true);
  assert.equal(report.hx1400StartObserved, true);
  assert.equal(report.hx1400CompleteObserved, false);
  assert.equal(report.coreRevision, "raw13g-core-v60");
  assert.equal(report.addrofRefreshCopyChars, 34478608);
  assert.equal(report.disposition, "hx1400-started-incomplete");

  const markdown = renderMarkdown(report);
  assert.match(markdown, /RECOVERED ON A LATER ATTEMPT/);
  assert.match(markdown, /pass marker observed \(client-reported\)/);
  assert.match(markdown, /HX1400 start observed; run incomplete/);
  assert.match(markdown, /earlier placement failure is classified as recovered/);
});

test("SSV-RETURNED-CLEARED after an earlier placement miss is advanced but not final primitive proof", () => {
  const records = [
    record("run-ssv-returned", "execution.start", {
      timestamp: "2026-11-03T19:49:41.000Z",
      firmware: "14.00",
    }),
    record("run-ssv-returned", "handled.ssv-placement-miss", {
      timestamp: "2026-11-03T19:49:45.000Z",
      message: "SSV-PLACEMENT-MISS: TypeError:Unable to deserialize data.",
    }),
    record("run-ssv-returned", "handled.ssv-returned-cleared", {
      timestamp: "2026-11-03T19:49:48.000Z",
      message: "SSV-RETURNED-CLEARED: [3] length=327681-predecessor-cleared=true",
    }),
  ];

  const report = analyzeRuntimeLog(records);
  assert.equal(report.ssvPlacementMissCount, 1);
  assert.equal(report.ssvBlocked, false);
  assert.equal(report.ssvRecoveredAfterRetry, true);
  assert.equal(report.ssvReturnedClearedObserved, true);
  assert.equal(report.ssvReturnedClearedAfterPlacement, true);
  assert.equal(report.readPrimitivePassObserved, false);
  assert.equal(report.disposition, "ssv-returned-cleared-primitive-status-unverified");

  const markdown = renderMarkdown(report);
  assert.match(markdown, /SSV RETURNED AFTER EARLIER PLACEMENT ERROR/);
  assert.match(markdown, /SSV returned; final primitive pass marker not recorded/);
  assert.match(markdown, /keeping the final primitive status unverified/);
});

test("SSV recurrence counts distinct runs rather than duplicate records", () => {
  const records = [
    record("a", "handled.ssv-placement-miss", { message: "SSV-PLACEMENT-MISS" }),
    record("a", "handled.ssv-placement-miss", { message: "SSV-PLACEMENT-MISS" }),
    record("b", "handled.ssv-placement-miss", { message: "SSV-PLACEMENT-MISS" }),
    record("b", "execution.start"),
  ];

  const report = analyzeRuntimeLog(records, { runId: "a" });
  assert.equal(report.ssvPlacementMissCount, 2);
  assert.equal(report.ssvFailureRuns, 2);
});

test("payload asset download and launch request remain distinct from verified install", () => {
  const records = [
    record("run-2", "execution.start"),
    record("run-2", "application.asset", { status: "downloaded", sizeBytes: 500000 }),
    record("run-2", "application.launch", { status: "started" }),
  ];

  const report = analyzeRuntimeLog(records);
  assert.equal(report.evidenceBoundary.payloadTransferReported, true);
  assert.equal(report.evidenceBoundary.launchEventReported, true);
  assert.equal(report.evidenceBoundary.henInstalledClaimReported, false);
  assert.equal(report.evidenceBoundary.independentTargetEvidencePresent, false);
});

test("ADDROF coverage margin is calculated from copied characters and carrier capacity", () => {
  const records = [
    record("run-coverage", "execution.start", { firmware: "14.00" }),
    record("run-coverage", "handled.memory-config", {
      message: "MEMORY-CONFIG: [1] carrier-slots=8700000-carrier-bytes=69600000-drain-count=96-drain-bytes=3145728-slab-bytes=3145728",
    }),
    record("run-coverage", "handled.addrof-copy", {
      message: "ADDROF-COPY: [1] chars=34478608-source-covered=true",
    }),
  ];

  const report = analyzeRuntimeLog(records);
  assert.deepEqual(report.addrofCoverage, {
    copiedChars: 34478608,
    requiredSourceBytes: 68957200,
    carrierBytes: 69600000,
    minimumCarrierSlots: 8619650,
    configuredCarrierSlots: 8700000,
    slackBytes: 642800,
    slackSlots: 80350,
    passes: true,
  });

  const markdown = renderMarkdown(report);
  assert.match(markdown, /"minimumCarrierSlots":8619650/);
  assert.match(markdown, /"slackBytes":642800/);
});

test("memory profile is reconstructed from the bounded MEMORY-CONFIG log line", () => {
  const report = analyzeRuntimeLog([
    record("run-memory", "execution.start"),
    record("run-memory", "handled.memory-config", {
      message: "MEMORY-CONFIG: [1] carrier-slots=2800000-carrier-bytes=22400000-drain-count=256-drain-bytes=16777216-slab-bytes=4194304",
    }),
    record("run-memory", "appcache.noupdate"),
  ]);

  assert.equal(report.profile.carrierSlots, 2800000);
  assert.equal(report.profile.carrierBytes, 22400000);
  assert.equal(report.profile.drainCount, 256);
  assert.equal(report.profile.drainBytes, 16777216);
  assert.equal(report.profile.slabBytes, 4194304);
  assert.equal(report.appCacheState, "no-update");
});

test("markdown explicitly limits ADDROF and HEN claims", () => {
  const report = analyzeRuntimeLog([
    record("run-3", "execution.start"),
    record("run-3", "handled.addrof-copy", {
      message: "ADDROF-COPY: source-covered=true",
    }),
    record("run-3", "handled.ssv-placement-miss", {
      message: "SSV-PLACEMENT-MISS: history-state",
    }),
  ]);

  const markdown = renderMarkdown(report);
  assert.match(markdown, /not evidence of an arbitrary pointer/);
  assert.match(markdown, /HEN installed/);
  assert.match(markdown, /client-side launch status is a report/i);
  assert.match(markdown, /did not pass after the recorded SSV placement\/deserialization failure/);
});

test("telemetry quality detects incomplete, duplicate, and orphan run records", () => {
  const records = [
    record("dup-run", "execution.start", { type: "telemetry", timestamp: "2026-10-31T08:00:00Z", firmware: "14.00", sessionId: "s1" }),
    record("dup-run", "execution.stage", { type: "telemetry", timestamp: "2026-10-31T07:59:00Z" }),
    record("dup-run", "execution.start", { timestamp: "2026-10-31T08:01:00Z", firmware: "13.00", sessionId: "s2" }),
    record("dup-run", "execution.end", { timestamp: "2026-10-31T08:02:00Z", status: "failed" }),
    record("dup-run", "execution.end", { timestamp: "2026-10-31T08:03:00Z", status: "failed" }),
    record("incomplete", "execution.start", { timestamp: "2026-10-31T08:04:00Z" }),
    record("orphan", "handled.ssv-placement-miss", { message: "SSV-PLACEMENT-MISS" }),
  ];

  const report = analyzeRuntimeLog(records, { runId: "dup-run" });
  assert.equal(report.integrity.runsWithoutStart, 1);
  assert.equal(report.integrity.runsWithoutEnd, 1);
  assert.equal(report.integrity.duplicateStartRuns, 1);
  assert.equal(report.integrity.duplicateEndRuns, 1);
  assert.equal(report.integrity.firmwareConflictRuns, 1);
  assert.equal(report.integrity.sessionConflictRuns, 1);
  assert.equal(report.integrity.telemetryReorderedRuns, 1);
  assert.ok(report.integrity.strictFailureCount >= 5);
});

test("latest run comparison identifies repeated diagnostic signatures", () => {
  const makeRun = (runId, startTime) => [
    record(runId, "execution.start", { timestamp: startTime, firmware: "14.00" }),
    record(runId, "execution.firmware", {
      timestamp: new Date(Date.parse(startTime) + 3).toISOString(),
      firmware: "14.00",
      status: "recognized",
    }),
    record(runId, "execution.stage", {
      timestamp: new Date(Date.parse(startTime) + 100).toISOString(),
      stage: 1,
    }),
    record(runId, "execution.diagnostics", {
      timestamp: new Date(Date.parse(startTime) + 120).toISOString(),
      diagnostics: { kind: "offsets", offsetHash: "0634abc5", offsetCount: 77, offsetAligned: 62, offsetMissing: 0 },
    }),
    record(runId, "handled.memory-config", {
      timestamp: new Date(Date.parse(startTime) + 200).toISOString(),
      message: "MEMORY-CONFIG: [1] carrier-slots=2800000-carrier-bytes=22400000-drain-count=256-drain-bytes=16777216-slab-bytes=4194304",
    }),
    record(runId, "handled.addrof-copy", {
      timestamp: new Date(Date.parse(startTime) + 300).toISOString(),
      message: "ADDROF-COPY: [1] chars=924176-source-covered=true",
    }),
    record(runId, "handled.ssv-placement-miss", {
      timestamp: new Date(Date.parse(startTime) + 400).toISOString(),
      message: "SSV-PLACEMENT-MISS: [1] TypeError:Unable to deserialize data.-stage=history-state",
    }),
    record(runId, "application.asset", {
      timestamp: new Date(Date.parse(startTime) + 500).toISOString(),
      status: "not-reached",
      asset: "payload2.bin",
    }),
    record(runId, "execution.end", {
      timestamp: new Date(Date.parse(startTime) + 600).toISOString(),
      status: "placement-miss",
      passCount: 3,
      failCount: 0,
    }),
  ];

  const records = [
    ...makeRun("run-a", "2026-10-31T08:00:00.000Z"),
    ...makeRun("run-b", "2026-10-31T08:05:00.000Z"),
  ];
  const report = analyzeRuntimeLog(records);

  assert.equal(report.runId, "run-b");
  assert.equal(report.runComparison.previousRunId, "run-a");
  assert.equal(report.runComparison.classification, "same-observed-signature");
  assert.equal(report.runComparison.identicalSignatureToPrevious, true);
  assert.equal(report.runComparison.matchingSignatureRuns, 2);
  assert.equal(report.runComparison.identityComparable, false);
  assert.equal(report.runComparison.identityRelation, "not-comparable-missing-probe-metadata");
  assert.equal(report.experimentIdentity.exactProbeIdentityEstablished, false);
  assert.deepEqual(report.experimentIdentity.missingRequired, [
    "probeId", "probeRevision", "sourceDigest", "manifestDigest",
  ]);
  assert.deepEqual(report.runComparison.changedFields, []);
});

test("probe identity is compared only when source and manifest metadata are present", () => {
  const withIdentity = (runId, timestamp, sourceDigest) => [
    record(runId, "execution.start", {
      timestamp,
      probeId: "history-regression-control",
      probeRevision: "v3",
      sourceDigest,
      manifestDigest: "manifest-sha-256",
    }),
    record(runId, "execution.end", {
      timestamp: new Date(Date.parse(timestamp) + 1000).toISOString(),
      status: "placement-miss",
    }),
  ];
  const same = analyzeRuntimeLog([
    ...withIdentity("identity-a", "2026-10-31T08:00:00Z", "source-a"),
    ...withIdentity("identity-b", "2026-10-31T08:05:00Z", "source-a"),
  ]);

  assert.equal(same.experimentIdentity.complete, true);
  assert.equal(same.runComparison.identityComparable, true);
  assert.equal(same.runComparison.identityRelation, "same-probe-revision-and-digests");

  const different = analyzeRuntimeLog([
    ...withIdentity("identity-a", "2026-10-31T08:00:00Z", "source-a"),
    ...withIdentity("identity-b", "2026-10-31T08:05:00Z", "source-b"),
  ]);
  assert.equal(different.runComparison.identityComparable, true);
  assert.equal(different.runComparison.identityRelation, "different-probe-revision-or-digests");
});

test("empty diagnostic snapshots are counted but never treated as measurements", () => {
  const report = analyzeRuntimeLog([
    record("diag-run", "execution.start"),
    record("diag-run", "execution.diagnostics", { diagnostics: { kind: "profile", carrierSlots: 2800000 } }),
    record("diag-run", "execution.diagnostics", { diagnostics: { kind: "profile" } }),
    record("diag-run", "execution.diagnostics", { diagnostics: { kind: "profile" } }),
  ]);

  assert.equal(report.diagnosticSnapshots.total, 3);
  assert.equal(report.diagnosticSnapshots.byKind.profile, 3);
  assert.equal(report.diagnosticSnapshots.emptyByKind.profile, 2);
  assert.equal(report.diagnosticSnapshots.emptyTotal, 2);
  assert.match(renderMarkdown(report), /2 diagnostic snapshot\(s\).*no measurements/);
});

test("client event clocks and server-handled timestamps are measured separately", () => {
  const records = [
    record("clock-run", "execution.start", {
      type: "telemetry",
      timestamp: "2026-10-31T08:00:00.000Z",
      receivedAt: "2026-10-31T08:00:01.000Z",
    }),
    record("clock-run", "execution.stage", {
      type: "telemetry",
      timestamp: "2026-10-31T08:00:02.000Z",
      receivedAt: "2026-10-31T08:00:03.000Z",
    }),
    record("clock-run", "execution.end", {
      type: "telemetry",
      timestamp: "2026-10-31T08:00:01.500Z",
      receivedAt: "2026-10-31T08:00:04.000Z",
    }),
    record("clock-run", "handled.ssv-placement-miss", {
      type: "handled",
      timestamp: "2026-10-31T08:00:05.000Z",
      receivedAt: "2026-10-31T08:00:05.000Z",
    }),
  ];
  const report = analyzeRuntimeLog(records);

  assert.equal(report.integrity.telemetryReorderedRuns, 1);
  assert.equal(report.integrity.clientTelemetryRecords, 3);
  assert.equal(report.integrity.serverHandledRecords, 1);
  assert.equal(report.integrity.apparentIngressLagMedianMs, 1000);
});

test("selected-run integrity is separated from accumulated history", () => {
  const report = analyzeRuntimeLog([
    record("historical", "execution.start", { timestamp: "2026-10-31T08:20:00Z" }),
    record("current", "execution.start", { timestamp: "2026-10-31T08:30:00Z" }),
    record("current", "execution.end", { timestamp: "2026-10-31T08:31:00Z", status: "ended" }),
  ], { runId: "current" });

  assert.equal(report.runIntegrity.strictFailureCount, 0);
  assert.equal(report.integrity.runsWithoutEnd, 1);
});

test("invalid timestamps are reported and a valid receivedAt remains usable", () => {
  const records = [
    record("timestamp-run", "execution.start", {
      timestamp: "not-a-date",
      receivedAt: "2026-10-31T08:30:00.000Z",
    }),
    record("timestamp-run", "execution.end", {
      timestamp: "2026-10-31T08:31:00.000Z",
    }),
  ];
  const report = analyzeRuntimeLog(records);
  assert.equal(report.integrity.malformedTimestampRecords, 1);
  assert.equal(report.integrity.runsWithoutEnd, 0);
  assert.equal(report.startedAt, "2026-10-31T08:30:00.000Z");
});

test("strict CLI validates either the full log or one selected run", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "runtime-gate-audit-"));
  const input = path.join(directory, "runtime-errors.ndjson");
  const script = path.resolve("scripts/audit-runtime-gates.mjs");
  try {
    const records = [
      record("complete", "execution.start"),
      record("complete", "execution.end", { status: "ended" }),
      record("historical-incomplete", "execution.start"),
    ];
    await writeFile(input, records.map((item) => JSON.stringify(item)).join("\n") + "\n");

    const wholeLog = spawnSync(process.execPath, [script, "--input", input, "--strict"], {
      encoding: "utf8",
    });
    assert.equal(wholeLog.status, 2, wholeLog.stderr);
    assert.match(wholeLog.stderr, /STRICT CHECK FAILED \(entire log\)/);

    const selectedComplete = spawnSync(process.execPath, [
      script, "--input", input, "--run", "complete", "--strict",
    ], { encoding: "utf8" });
    assert.equal(selectedComplete.status, 0, selectedComplete.stderr);
    assert.match(selectedComplete.stderr, /STRICT CHECK PASSED \(selected run complete\)/);

    const selectedIncomplete = spawnSync(process.execPath, [
      script, "--input", input, "--run", "historical-incomplete", "--strict",
    ], { encoding: "utf8" });
    assert.equal(selectedIncomplete.status, 2, selectedIncomplete.stderr);
    assert.match(selectedIncomplete.stderr, /STRICT CHECK FAILED/);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("client-originated verification markers are claims, not target evidence", () => {
  const report = analyzeRuntimeLog([
    record("claims", "execution.start"),
    record("claims", "kernel.rw.verified"),
    record("claims", "sandbox.escape.verified"),
    record("claims", "privilege.transition.verified"),
    record("claims", "hen.install.verified"),
  ]);

  assert.equal(report.evidenceBoundary.kernelMemoryAccessClaimReported, true);
  assert.equal(report.evidenceBoundary.sandboxEscapeClaimReported, true);
  assert.equal(report.evidenceBoundary.privilegeTransitionClaimReported, true);
  assert.equal(report.evidenceBoundary.henInstalledClaimReported, true);
  assert.equal(report.evidenceBoundary.independentTargetEvidencePresent, false);
  assert.match(renderMarkdown(report), /client claim reported; independently unverified/);
});
