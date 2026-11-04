#!/usr/bin/env node
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

const DEFAULT_INPUT = ".local-logs/runtime-errors.ndjson";

function eventName(record) {
  return String(record.event || record.type || "").toLowerCase();
}

function eventTime(record) {
  for (const value of [record.timestamp, record.receivedAt]) {
    if (typeof value !== "string" || !value.trim()) continue;
    const parsed = Date.parse(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return 0;
}

function hasValidTimestamp(record) {
  return eventTime(record) > 0;
}

function isTimestampMalformed(record) {
  const candidates = [record.timestamp, record.receivedAt]
    .filter((value) => value != null && String(value).trim() !== "");
  return candidates.some((value) =>
    typeof value !== "string" || !Number.isFinite(Date.parse(value)),
  );
}

export function parseNdjson(source) {
  const records = [];
  const errors = [];
  const lines = String(source).split(/\r?\n/);

  lines.forEach((line, index) => {
    if (!line.trim()) return;
    try {
      const value = JSON.parse(line);
      if (!value || typeof value !== "object" || Array.isArray(value)) {
        throw new TypeError("record must be a JSON object");
      }
      records.push({ ...value, _line: index + 1 });
    } catch (error) {
      errors.push({
        line: index + 1,
        message: error instanceof Error ? error.message : String(error),
      });
    }
  });

  return { records, errors };
}

function groupRuns(records) {
  const runs = new Map();
  records.forEach((inputRecord, index) => {
    const record = inputRecord._line == null
      ? { ...inputRecord, _line: index + 1 }
      : inputRecord;
    const runId = typeof record.runId === "string" ? record.runId.trim() : "";
    if (!runId) return;
    if (!runs.has(runId)) runs.set(runId, []);
    runs.get(runId).push(record);
  });
  for (const items of runs.values()) {
    items.sort((a, b) => eventTime(a) - eventTime(b) || a._line - b._line);
  }
  return runs;
}

function inspectLogQuality(records, runs) {
  const lifecycle = [...runs.entries()].map(([runId, items]) => {
    const starts = items.filter((record) => eventName(record) === "execution.start");
    const ends = items.filter((record) => eventName(record) === "execution.end");
    const firmwareValues = [...new Set(items
      .map((record) => record.firmware)
      .filter((value) => typeof value === "string" && value))];
    const sessionValues = [...new Set(items
      .map((record) => record.sessionId)
      .filter((value) => typeof value === "string" && value))];
    const timestamped = items.filter(hasValidTimestamp);
    const clientEvents = items
      .filter((record) => record.type === "telemetry" &&
        typeof record.timestamp === "string" && Number.isFinite(Date.parse(record.timestamp)))
      .sort((a, b) => a._line - b._line);
    let telemetryReordered = false;
    let previousClientTime = 0;
    for (const record of clientEvents) {
      const current = Date.parse(record.timestamp);
      if (previousClientTime && current < previousClientTime) telemetryReordered = true;
      previousClientTime = current;
    }
    return {
      runId,
      startCount: starts.length,
      endCount: ends.length,
      hasStart: starts.length > 0,
      hasEnd: ends.length > 0,
      firmwareConflict: firmwareValues.length > 1,
      sessionConflict: sessionValues.length > 1,
      telemetryReordered,
      missingTimestamps: items.filter((record) =>
        !record.timestamp && !record.receivedAt).length,
      malformedTimestamps: items.filter(isTimestampMalformed).length,
      timestampedRecords: timestamped.length,
    };
  });

  const eventWithoutRunId = records.filter((record) => {
    const name = eventName(record);
    return !String(record.runId || "").trim() &&
      (name.startsWith("execution.") || name.startsWith("application.") ||
       name.startsWith("handled."));
  }).length;
  const clientTelemetry = records.filter((record) =>
    record.type === "telemetry" &&
    typeof record.timestamp === "string" &&
    Number.isFinite(Date.parse(record.timestamp)) &&
    typeof record.receivedAt === "string" &&
    Number.isFinite(Date.parse(record.receivedAt)),
  );
  const apparentIngressLag = clientTelemetry
    .map((record) => Date.parse(record.receivedAt) - Date.parse(record.timestamp))
    .filter((value) => Number.isFinite(value));
  const sortedLag = [...apparentIngressLag].sort((a, b) => a - b);
  const medianIngressLagMs = sortedLag.length
    ? sortedLag[Math.floor(sortedLag.length / 2)]
    : null;
  const result = {
    recordsWithoutRunId: records.filter((record) =>
      !String(record.runId || "").trim()).length,
    eventRecordsWithoutRunId: eventWithoutRunId,
    malformedTimestampRecords: records.filter(isTimestampMalformed).length,
    missingTimestampRecords: records.filter((record) =>
      Boolean(String(record.runId || "").trim()) &&
      !record.timestamp && !record.receivedAt).length,
    runsWithoutStart: lifecycle.filter((item) => !item.hasStart).length,
    runsWithoutEnd: lifecycle.filter((item) => item.hasStart && !item.hasEnd).length,
    duplicateStartRuns: lifecycle.filter((item) => item.startCount > 1).length,
    duplicateEndRuns: lifecycle.filter((item) => item.endCount > 1).length,
    firmwareConflictRuns: lifecycle.filter((item) => item.firmwareConflict).length,
    sessionConflictRuns: lifecycle.filter((item) => item.sessionConflict).length,
    telemetryReorderedRuns: lifecycle.filter((item) => item.telemetryReordered).length,
    serverHandledRecords: records.filter((record) => record.type === "handled").length,
    clientTelemetryRecords: clientTelemetry.length,
    apparentIngressLagMedianMs: medianIngressLagMs,
    malformedLifecycleRuns: lifecycle.filter((item) =>
      item.malformedTimestamps > 0 || item.missingTimestamps > 0 ||
      item.startCount > 1 || item.endCount > 1 ||
      item.firmwareConflict || item.sessionConflict).length,
  };
  result.strictFailureCount =
    result.malformedTimestampRecords +
    result.missingTimestampRecords +
    result.runsWithoutStart +
    result.runsWithoutEnd +
    result.duplicateStartRuns +
    result.duplicateEndRuns +
    result.firmwareConflictRuns +
    result.sessionConflictRuns;
  return result;
}

function latestStartedRun(runs) {
  let selected = null;
  let selectedTime = -1;
  let selectedLine = -1;
  const entries = [...runs.entries()];
  const startedEntries = entries.filter(([, records]) =>
    records.some((record) => eventName(record) === "execution.start"),
  );
  const candidates = startedEntries.length ? startedEntries : entries;
  for (const [runId, records] of candidates) {
    const starts = records.filter((record) => eventName(record) === "execution.start");
    const start = starts.at(-1);
    const time = start ? eventTime(start) : Math.max(0, ...records.map(eventTime));
    const line = start?._line ?? Math.max(...records.map((record) => record._line || 0));
    if (!selected || time > selectedTime || (time === selectedTime && line > selectedLine)) {
      selected = { runId, records };
      selectedTime = time;
      selectedLine = line;
    }
  }
  return selected;
}

function hasMessage(records, pattern) {
  return records.some((record) => pattern.test(String(record.message || "")));
}

function latest(records, predicate) {
  for (let index = records.length - 1; index >= 0; index -= 1) {
    if (predicate(records[index])) return records[index];
  }
  return null;
}

function parseMemoryConfig(message) {
  const match = /MEMORY-CONFIG:\s*\[\d+\]\s*carrier-slots=(\d+)-carrier-bytes=(\d+)-drain-count=(\d+)-drain-bytes=(\d+)-slab-bytes=(\d+)/i.exec(String(message || ""));
  if (!match) return null;
  const [, carrierSlots, carrierBytes, drainCount, drainBytes, slabBytes] = match;
  return {
    carrierSlots: Number(carrierSlots),
    carrierBytes: Number(carrierBytes),
    drainCount: Number(drainCount),
    drainBytes: Number(drainBytes),
    slabBytes: Number(slabBytes),
    source: "handled MEMORY-CONFIG message",
  };
}

function summarizeDiagnosticSnapshots(records) {
  const diagnostics = records
    .filter((record) => eventName(record) === "execution.diagnostics" &&
      record.diagnostics && typeof record.diagnostics === "object");
  const byKind = {};
  const emptyByKind = {};
  for (const record of diagnostics) {
    const kind = String(record.diagnostics.kind || "unknown");
    byKind[kind] = (byKind[kind] || 0) + 1;
    if (Object.keys(record.diagnostics).every((key) => key === "kind")) {
      emptyByKind[kind] = (emptyByKind[kind] || 0) + 1;
    }
  }
  return {
    total: diagnostics.length,
    byKind,
    emptyByKind,
    emptyTotal: Object.values(emptyByKind).reduce((sum, count) => sum + count, 0),
  };
}

function inspectExperimentIdentity(records) {
  const aliases = {
    experimentId: ["experimentId", "experiment_id"],
    probeId: ["probeId", "probe_id"],
    probeRevision: ["probeRevision", "probe_revision", "probeVersion", "probe_version"],
    sourceDigest: ["sourceDigest", "sourceHash", "probeSourceSha256", "source_sha256"],
    manifestDigest: ["manifestDigest", "manifestHash", "manifest_sha256"],
    buildId: ["buildId", "build_id", "appRevision"],
    phaseId: ["phaseId", "phase_id", "executionPhase"],
  };
  const fields = {};
  for (const [name, keys] of Object.entries(aliases)) {
    const record = latest(records, (item) =>
      keys.some((key) => item[key] != null && String(item[key]).trim() !== ""),
    );
    const key = record && keys.find((candidate) =>
      record[candidate] != null && String(record[candidate]).trim() !== "",
    );
    fields[name] = key ? String(record[key]) : null;
  }
  const required = ["probeId", "probeRevision", "sourceDigest", "manifestDigest"];
  const missingRequired = required.filter((name) => !fields[name]);
  return {
    fields,
    required,
    missingRequired,
    complete: missingRequired.length === 0,
    exactProbeIdentityEstablished: missingRequired.length === 0,
  };
}

function runSignature(records) {
  const stageNumbers = records
    .filter((record) => eventName(record) === "execution.stage" &&
      Number.isFinite(Number(record.stage)))
    .map((record) => Number(record.stage));
  const placement = latest(records, (record) =>
    eventName(record) === "handled.ssv-placement-miss" ||
    /SSV-PLACEMENT-MISS/i.test(String(record.message || "")),
  );
  const memory = latest(records, (record) =>
    eventName(record) === "handled.memory-config" ||
    /MEMORY-CONFIG:/i.test(String(record.message || "")),
  );
  const offset = latest(records, (record) => record.diagnostics?.kind === "offsets");
  const end = latest(records, (record) => eventName(record) === "execution.end");
  const asset = latest(records, (record) => eventName(record) === "application.asset");
  const addrof = latest(records, (record) =>
    eventName(record) === "handled.addrof-copy" ||
    /ADDROF-COPY:/i.test(String(record.message || "")),
  );
  const placementText = placement
    ? String(placement.message || "")
      .replace(/^.*?SSV-PLACEMENT-MISS:\s*/i, "")
      .replace(/\[\d+\]/g, "[n]")
      .trim()
    : null;
  const memoryValues = parseMemoryConfig(memory?.message);
  const addrofMessage = String(addrof?.message || "");
  const chars = /chars=(\d+)/i.exec(addrofMessage);
  const capturedChars = chars ? Number(chars[1]) : null;
  const requiredSourceBytes = capturedChars == null
    ? null
    : Math.max(0, capturedChars - 8) * 2;
  const minimumCarrierSlots = requiredSourceBytes == null
    ? null
    : Math.ceil(requiredSourceBytes / 8);
  const coverageSlackBytes = requiredSourceBytes == null || !memoryValues
    ? null
    : memoryValues.carrierBytes - requiredSourceBytes;
  return {
    firmware: latest(records, (record) => eventName(record) === "execution.firmware")?.firmware || null,
    stageMax: stageNumbers.length ? Math.max(...stageNumbers) : null,
    endStatus: end?.status || null,
    placementError: placementText,
    assetStatus: asset?.status || null,
    addrofCopyChars: capturedChars,
    addrofSourceCovered: /source-covered=true/i.test(addrofMessage),
    requiredSourceBytes,
    minimumCarrierSlots,
    coverageSlackBytes,
    coverageSlackSlots: coverageSlackBytes == null
      ? null
      : Math.floor(coverageSlackBytes / 8),
    addrofRefreshCopyChars: (() => {
      const refresh = latest(records, (record) =>
        eventName(record) === "handled.addrof-refresh-copy" ||
        /ADDROF-REFRESH-COPY/i.test(String(record.message || "")),
      );
      const match = /chars=(\d+)/i.exec(String(refresh?.message || ""));
      return match ? Number(match[1]) : null;
    })(),
    readPrimitivePassObserved: hasMessage(records, /READ-PRIMITIVE-PASS/i),
    ssvReturnedClearedObserved: hasMessage(records, /SSV-RETURNED-CLEARED/i),
    coreRevision: (() => {
      const revision = latest(records, (record) =>
        eventName(record) === "handled.core-revision" ||
        /CORE-REVISION/i.test(String(record.message || "")),
      );
      return revision
        ? String(revision.message || "").replace(/^.*?CORE-REVISION:?\s*/i, "").trim() || null
        : null;
    })(),
    hx1400StartObserved: hasMessage(records, /HX1400-START/i),
    memoryProfile: memoryValues ? {
      carrierSlots: memoryValues.carrierSlots,
      carrierBytes: memoryValues.carrierBytes,
      drainCount: memoryValues.drainCount,
      drainBytes: memoryValues.drainBytes,
      slabBytes: memoryValues.slabBytes,
    } : null,
    offsetFingerprint: offset?.diagnostics ? {
      offsetHash: offset.diagnostics.offsetHash || null,
      offsetCount: offset.diagnostics.offsetCount ?? null,
      offsetAligned: offset.diagnostics.offsetAligned ?? null,
      offsetMissing: offset.diagnostics.offsetMissing ?? null,
    } : null,
  };
}

function compareWithPreviousRun(runs, currentRunId) {
  const ordered = [...runs.entries()].map(([runId, records]) => {
    const start = records.find((record) => eventName(record) === "execution.start");
    return {
      runId,
      records,
      time: start ? eventTime(start) : Math.max(0, ...records.map(eventTime)),
      line: start?._line ?? Math.max(0, ...records.map((record) => record._line || 0)),
    };
  }).sort((a, b) => a.time - b.time || a.line - b.line);
  const currentIndex = ordered.findIndex((item) => item.runId === currentRunId);
  if (currentIndex < 0 || currentIndex === 0) {
    return { previousRunId: null, classification: "no-previous-run", matchingSignatureRuns: 1 };
  }
  const current = ordered[currentIndex];
  const previous = ordered[currentIndex - 1];
  const currentSignature = runSignature(current.records);
  const previousSignature = runSignature(previous.records);
  const currentIdentity = inspectExperimentIdentity(current.records);
  const previousIdentity = inspectExperimentIdentity(previous.records);
  const identityComparable = currentIdentity.complete && previousIdentity.complete;
  const identityFields = currentIdentity.required;
  const sameProbeIdentity = identityComparable && identityFields.every((field) =>
    currentIdentity.fields[field] === previousIdentity.fields[field],
  );
  const fields = Object.keys(currentSignature);
  const unchangedFields = fields.filter((field) =>
    JSON.stringify(currentSignature[field]) === JSON.stringify(previousSignature[field]),
  );
  const changedFields = fields.filter((field) => !unchangedFields.includes(field));
  const matchingSignatureRuns = ordered.filter((item) =>
    JSON.stringify(runSignature(item.records)) === JSON.stringify(currentSignature),
  ).length;
  return {
    previousRunId: previous.runId,
    classification: changedFields.length ? "diagnostic-signature-changed" : "same-observed-signature",
    identicalSignatureToPrevious: changedFields.length === 0,
    unchangedFields,
    changedFields,
    matchingSignatureRuns,
    identityComparable,
    identityRelation: !identityComparable
      ? "not-comparable-missing-probe-metadata"
      : sameProbeIdentity
        ? "same-probe-revision-and-digests"
        : "different-probe-revision-or-digests",
    currentIdentity,
    previousIdentity,
    previousSignature,
    currentSignature,
  };
}

export function analyzeRuntimeLog(records, options = {}) {
  const runs = groupRuns(records);
  const integrity = inspectLogQuality(records, runs);
  const requestedId = options.runId;
  const selected = requestedId
    ? (runs.has(requestedId) ? { runId: requestedId, records: runs.get(requestedId) } : null)
    : latestStartedRun(runs);

  if (!selected) {
    return {
      runId: requestedId || null,
      found: false,
      totalRecords: records.length,
      totalRuns: runs.size,
      integrity,
      ssvFailureRuns: [...runs.values()].filter((items) =>
        items.some((record) => eventName(record) === "handled.ssv-placement-miss" ||
          /SSV-PLACEMENT-MISS/i.test(String(record.message || ""))),
      ).length,
    };
  }

  const items = selected.records;
  const runIntegrity = inspectLogQuality(items, new Map([[selected.runId, items]]));
  const diagnosticSnapshots = summarizeDiagnosticSnapshots(items);
  const experimentIdentity = inspectExperimentIdentity(items);
  const runComparison = compareWithPreviousRun(runs, selected.runId);
  const start = latest(items, (record) => eventName(record) === "execution.start");
  const firmwareRecord = latest(items, (record) => eventName(record) === "execution.firmware");
  const end = latest(items, (record) => eventName(record) === "execution.end");
  const appAsset = latest(items, (record) => eventName(record) === "application.asset");
  const appLaunch = latest(items, (record) => eventName(record) === "application.launch");
  const appSelected = latest(items, (record) => eventName(record) === "application.selected");
  const offsetDiag = latest(items, (record) => record.diagnostics?.kind === "offsets");
  const profileDiag = latest(items, (record) => record.diagnostics?.kind === "profile");
  const memoryConfig = latest(items, (record) => eventName(record) === "handled.memory-config" ||
    /MEMORY-CONFIG:/i.test(String(record.message || "")));
  const addrofCopy = latest(items, (record) => eventName(record) === "handled.addrof-copy" ||
    /ADDROF-COPY:/i.test(String(record.message || "")));
  const placementMisses = items.filter((record) =>
    eventName(record) === "handled.ssv-placement-miss" ||
    /SSV-PLACEMENT-MISS/i.test(String(record.message || "")),
  );
  const addrofFailures = items.filter((record) =>
    eventName(record) === "handled.addrof-fail" ||
    /ADDROF-FAIL:/i.test(String(record.message || "")),
  );
  const addrofRefreshCopy = latest(items, (record) =>
    eventName(record) === "handled.addrof-refresh-copy" ||
    /ADDROF-REFRESH-COPY/i.test(String(record.message || "")),
  );
  const refreshCopyCharsMatch = /chars=(\d+)/i.exec(String(addrofRefreshCopy?.message || ""));
  const readPrimitivePass = latest(items, (record) =>
    eventName(record) === "handled.read-primitive-pass" ||
    /READ-PRIMITIVE-PASS/i.test(String(record.message || "")),
  );
  const readPrimitiveMismatch = latest(items, (record) =>
    eventName(record) === "handled.read-primitive-mismatch" ||
    /READ-PRIMITIVE-MISMATCH/i.test(String(record.message || "")),
  );
  const primitiveOk = latest(items, (record) =>
    eventName(record) === "handled.primitive-ok" ||
    /PRIMITIVE-OK/i.test(String(record.message || "")),
  );
  const libkernelDiscovered = latest(items, (record) =>
    eventName(record) === "handled.libkernel-discovered" ||
    /LIBKERNEL-DISCOVERED/i.test(String(record.message || "")),
  );
  const libkernelNotFound = latest(items, (record) =>
    eventName(record) === "handled.libkernel-elf-not-found" ||
    /LIBKERNEL-ELF-NOT-FOUND/i.test(String(record.message || "")),
  );
  const hx1400Start = latest(items, (record) =>
    eventName(record) === "handled.hx1400-start" ||
    /HX1400-START/i.test(String(record.message || "")),
  );
  const hx1400Complete = latest(items, (record) =>
    eventName(record) === "handled.hx1400-complete" ||
    eventName(record) === "handled.hx1400-kernel-complete" ||
    /HX1400-(?:KERNEL-)?COMPLETE/i.test(String(record.message || "")),
  );
  const henArtifactsObserved = latest(items, (record) =>
    eventName(record) === "handled.hen-artifacts-observed" ||
    /HEN-ARTIFACTS-OBSERVED/i.test(String(record.message || "")),
  );
  const henReadyClaimed = latest(items, (record) =>
    eventName(record) === "handled.hen-ready" ||
    /HEN-READY/i.test(String(record.message || "")),
  );
  const coreRevisionRecord = latest(items, (record) =>
    eventName(record) === "handled.core-revision" ||
    /CORE-REVISION/i.test(String(record.message || "")),
  );
  const heapPlacementMiss = hasMessage(items, /HEAP-PLACEMENT-MISS/i);
  const attemptCeiling = hasMessage(items, /attempt-ceiling/i);
  const stageNumbers = items
    .filter((record) => eventName(record) === "execution.stage" && Number.isFinite(Number(record.stage)))
    .map((record) => Number(record.stage));
  const memoryProfile = parseMemoryConfig(memoryConfig?.message);
  const diagnosticProfile = profileDiag?.diagnostics || {};
  const mergedProfile = { ...(memoryProfile || {}), ...diagnosticProfile };
  const addrofCopyMessage = String(addrofCopy?.message || "");
  const addrofCopyCharsMatch = /chars=(\d+)/i.exec(addrofCopyMessage);
  const addrofCopyChars = addrofCopyCharsMatch ? Number(addrofCopyCharsMatch[1]) : null;
  const requiredSourceBytes = addrofCopyChars == null
    ? null
    : Math.max(0, addrofCopyChars - 8) * 2;
  const minimumCarrierSlots = requiredSourceBytes == null
    ? null
    : Math.ceil(requiredSourceBytes / 8);
  const coverageSlackBytes = requiredSourceBytes == null || !memoryProfile
    ? null
    : memoryProfile.carrierBytes - requiredSourceBytes;
  const addrofCoverage = requiredSourceBytes == null || !memoryProfile
    ? null
    : {
      copiedChars: addrofCopyChars,
      requiredSourceBytes,
      carrierBytes: memoryProfile.carrierBytes,
      minimumCarrierSlots,
      configuredCarrierSlots: memoryProfile.carrierSlots,
      slackBytes: coverageSlackBytes,
      slackSlots: Math.floor(coverageSlackBytes / 8),
      passes: coverageSlackBytes >= 0,
    };
  const appAssetStatus = appAsset?.status || "not-observed";
  const appLaunchStatus = appLaunch?.status || "not-observed";
  const appCacheState = items.some((record) => eventName(record) === "appcache.cached")
    ? "cached"
    : items.some((record) => eventName(record) === "appcache.noupdate")
      ? "no-update"
      : items.some((record) => eventName(record).startsWith("appcache."))
        ? "activity-observed"
        : "not-observed";
  const readPrimitivePassObserved = Boolean(readPrimitivePass);
  const ssvReturnedCleared = latest(items, (record) =>
    eventName(record) === "handled.ssv-returned-cleared" ||
    /SSV-RETURNED-CLEARED/i.test(String(record.message || "")),
  );
  const ssvReturnedClearedAfterPlacement = Boolean(
    ssvReturnedCleared &&
    placementMisses.length > 0 &&
    eventTime(ssvReturnedCleared) > eventTime(placementMisses.at(-1)),
  );
  const ssvRecoveredAfterRetry =
    placementMisses.length > 0 &&
    (readPrimitivePassObserved || ssvReturnedClearedAfterPlacement);
  const ssvBlocked = placementMisses.length > 0 && !ssvRecoveredAfterRetry;
  const sourceCovered = /source-covered=true/i.test(addrofCopyMessage) ||
    addrofCopy?.sourceCovered === true || diagnosticProfile.sourceCovered === true;

  const ssvRuns = [...runs.values()].filter((runRecords) =>
    runRecords.some((record) => eventName(record) === "handled.ssv-placement-miss" ||
      /SSV-PLACEMENT-MISS/i.test(String(record.message || ""))),
  ).length;

  return {
    found: true,
    runId: selected.runId,
    startedAt: start && eventTime(start) ? new Date(eventTime(start)).toISOString() : null,
    finishedAt: end && eventTime(end) ? new Date(eventTime(end)).toISOString() : null,
    firmware: firmwareRecord?.firmware || start?.firmware || null,
    firmwareStatus: firmwareRecord?.status || "not-observed",
    stageMax: stageNumbers.length ? Math.max(...stageNumbers) : null,
    endStatus: end?.status || "no execution.end record",
    passCount: Number.isFinite(Number(end?.passCount)) ? Number(end.passCount) : null,
    failCount: Number.isFinite(Number(end?.failCount)) ? Number(end.failCount) : null,
    app: appSelected?.application || appAsset?.application || appLaunch?.application || null,
    asset: appSelected?.asset || appAsset?.asset || appLaunch?.asset || null,
    appAssetStatus,
    appLaunchStatus,
    appAssetNotReached: appAssetStatus === "not-reached",
    ssvPlacementMissCount: placementMisses.length,
    ssvFailureRuns: ssvRuns,
    ssvBlocked,
    ssvRecoveredAfterRetry,
    ssvReturnedClearedObserved: Boolean(ssvReturnedCleared),
    ssvReturnedClearedAfterPlacement,
    ssvDetail: placementMisses.at(-1)?.message || null,
    readPrimitivePassObserved,
    readPrimitiveMismatchObserved: Boolean(readPrimitiveMismatch),
    primitiveOkObserved: Boolean(primitiveOk),
    libkernelDiscovered: Boolean(libkernelDiscovered),
    libkernelNotFound: Boolean(libkernelNotFound),
    hx1400StartObserved: Boolean(hx1400Start),
    hx1400CompleteObserved: Boolean(hx1400Complete),
    henArtifactsObserved: Boolean(henArtifactsObserved),
    henReadyClaimReported: Boolean(henReadyClaimed),
    coreRevision: coreRevisionRecord
      ? String(coreRevisionRecord.message || "").replace(/^.*?CORE-REVISION:?\s*/i, "").trim() || null
      : null,
    addrofRefreshCopyChars: refreshCopyCharsMatch ? Number(refreshCopyCharsMatch[1]) : null,
    heapPlacementMiss,
    attemptCeiling,
    addrofFailureCount: addrofFailures.length,
    addrofCopyObserved: Boolean(addrofCopy),
    addrofCopySourceCovered: sourceCovered,
    addrofCopyChars,
    addrofCoverage,
    memoryConfig: memoryConfig?.message || null,
    profile: Object.keys(mergedProfile).length ? mergedProfile : null,
    offsets: offsetDiag?.diagnostics || null,
    appCacheState,
    appCacheCached: appCacheState === "cached",
    recordCount: items.length,
    integrity,
    runIntegrity,
    diagnosticSnapshots,
    experimentIdentity,
    runComparison,
    disposition: henReadyClaimed
      ? "hx1400-hen-ready-client-claim-unverified"
      : henArtifactsObserved && hx1400Complete
        ? "hx1400-kernel-chain-complete-hen-artifacts-client-reported"
        : hx1400Complete
          ? "hx1400-kernel-chain-complete-hen-unverified"
          : hx1400Start
        ? "hx1400-started-incomplete"
        : readPrimitivePassObserved && ssvRecoveredAfterRetry
        ? "primitive-passed-after-placement-retry"
        : ssvReturnedCleared
          ? "ssv-returned-cleared-primitive-status-unverified"
          : ssvBlocked
            ? "blocked-at-placement"
            : readPrimitivePassObserved
              ? "primitive-passed-later-stage-incomplete"
              : end
                ? "ended-without-placement-error"
                : start
                  ? "incomplete-run"
                  : "partial-run-telemetry",
    evidenceBoundary: {
      payloadTransferReported: ["downloaded", "loaded", "ready"].includes(String(appAssetStatus).toLowerCase()),
      launchEventReported: appLaunchStatus === "started" || appLaunchStatus === "success",
      kernelMemoryAccessClaimReported: items.some((record) =>
        eventName(record) === "kernel.memory.verified" || eventName(record) === "kernel.rw.verified"),
      sandboxEscapeClaimReported: items.some((record) => eventName(record) === "sandbox.escape.verified"),
      privilegeTransitionClaimReported: items.some((record) => eventName(record) === "privilege.transition.verified"),
      henInstalledClaimReported: items.some((record) => eventName(record) === "hen.install.verified"),
      independentTargetEvidencePresent: false,
    },
  };
}

function escapeMarkdown(value) {
  return String(value ?? "not observed").replaceAll("|", "\\|").replaceAll("\n", " ");
}

export function renderMarkdown(report, parseErrors = []) {
  if (!report.found) {
    return [
      "# Runtime gate audit",
      "",
      "No execution run with a run ID was found in the supplied log.",
      "",
      `Records: ${report.totalRecords}; distinct runs: ${report.totalRuns}; SSV placement-failure runs: ${report.ssvFailureRuns}.`,
      parseErrors.length ? `Malformed lines: ${parseErrors.length}.` : "",
      report.integrity ? `Telemetry quality strict failures: ${report.integrity.strictFailureCount}.` : "",
      "",
    ].filter(Boolean).join("\n");
  }

  const gate = (name, status, evidence) => `| ${name} | ${status} | ${escapeMarkdown(evidence)} |`;
  const rows = [
    gate("Host execution started", report.startedAt ? "observed" : "not observed", report.startedAt),
    gate("Firmware recognition", report.firmwareStatus === "recognized" ? "recognized (browser-reported)" : "not verified", `${report.firmware || "unknown"} / ${report.firmwareStatus}`),
    gate("Execution stage", report.stageMax != null ? `stage ${report.stageMax} observed` : "not observed", `execution.end: ${report.endStatus}`),
    gate("History-state placement", report.ssvReturnedClearedAfterPlacement
      ? "SSV RETURNED AFTER EARLIER PLACEMENT ERROR"
      : report.ssvRecoveredAfterRetry
        ? "RECOVERED ON A LATER ATTEMPT"
        : report.ssvBlocked ? "BLOCKED" : "not demonstrated",
    report.ssvDetail || "no SSV placement error recorded"),
    gate("WebKit read primitive", report.readPrimitivePassObserved
      ? "pass marker observed (client-reported)"
      : report.ssvReturnedClearedObserved
        ? "SSV returned; final primitive pass marker not recorded"
        : report.readPrimitiveMismatchObserved ? "validation mismatch reported" : "not evidenced",
    "READ-PRIMITIVE-PASS is a browser marker; it is not independent target-side attestation."),
    gate("libkernel / HX1400 transition", report.hx1400CompleteObserved
      ? "HX1400 kernel-chain completion marker observed (client-reported)"
      : report.hx1400StartObserved
        ? "HX1400 start observed; run incomplete"
        : report.libkernelDiscovered
          ? "libkernel discovered; HX1400 start not observed"
          : report.libkernelNotFound ? "libkernel not found" : "not evidenced",
    "Kernel-chain completion does not establish payload initialization or HEN readiness."),
    gate("Payload asset telemetry", report.appAssetStatus, report.asset || "asset not identified; browser-reported status"),
    gate("HEN launch telemetry", report.appLaunchStatus, "Client-side launch status is a report, not proof of a running or installed HEN."),
    gate("HEN candidate artifacts", report.henArtifactsObserved ? "new candidate paths reported (client-side claim)" : "not observed", "A path appearing after launch is a diagnostic signal, not independent proof of HEN initialization."),
    gate("HEN readiness", report.henReadyClaimReported ? "client HEN-READY claim reported; independently unverified" : "not established", "Entry return, pthread creation, UID and filesystem artifacts do not independently attest readiness."),
    gate("Kernel memory access", report.evidenceBoundary.kernelMemoryAccessClaimReported ? "client claim reported; independently unverified" : "not evidenced", "Browser telemetry cannot establish kernel read/write. No inference from carrier/source-coverage or offset-table diagnostics."),
    gate("Sandbox / privilege transition", report.evidenceBoundary.sandboxEscapeClaimReported || report.evidenceBoundary.privilegeTransitionClaimReported ? "client claim reported; independently unverified" : "not evidenced", "This log contains no independent target-side attestation."),
    gate("HEN installed", report.evidenceBoundary.henInstalledClaimReported ? "client claim reported; independently unverified" : "not evidenced", "Asset selection/download and launch telemetry do not prove installation."),
  ];

  const lines = [
    "# Runtime gate audit",
    "",
    `- Run: \`${report.runId}\``,
    `- Started: ${report.startedAt || "unknown"}`,
    `- Finished: ${report.finishedAt || "no end event"}`,
    `- Firmware: ${report.firmware || "unknown"} (${report.firmwareStatus})`,
    `- Records in run: ${report.recordCount}`,
    `- Telemetry disposition: ${report.disposition}`,
    "",
    "## Telemetry quality",
    "",
    `- Selected-run strict failures: ${report.runIntegrity.strictFailureCount}.`,
    `- Selected-run malformed / missing timestamps: ${report.runIntegrity.malformedTimestampRecords} / ${report.runIntegrity.missingTimestampRecords}.`,
    `- Whole-log strict failures: ${report.integrity.strictFailureCount}.`,
    `- Whole-log runs without start / without end: ${report.integrity.runsWithoutStart} / ${report.integrity.runsWithoutEnd}.`,
    `- Whole-log duplicate start / end runs: ${report.integrity.duplicateStartRuns} / ${report.integrity.duplicateEndRuns}.`,
    `- Whole-log firmware / session conflicts: ${report.integrity.firmwareConflictRuns} / ${report.integrity.sessionConflictRuns}.`,
    `- Whole-log telemetry-reordered runs: ${report.integrity.telemetryReorderedRuns} (client timestamps only; server-handled events use server receipt time).`,
    `- Client telemetry records / server-handled records: ${report.integrity.clientTelemetryRecords} / ${report.integrity.serverHandledRecords}.`,
    `- Median apparent client-to-server ingress delta: ${report.integrity.apparentIngressLagMedianMs ?? "n/a"} ms (clock offset may affect this estimate).`,
    `- Event records without runId (whole log): ${report.integrity.eventRecordsWithoutRunId}.`,
    "",
    "## Gate status",
    "",
    "| Gate | Status | Evidence / limit |",
    "| --- | --- | --- |",
    ...rows,
    "",
    "## Diagnostic signals",
    "",
    `- SSV placement failures in this run: ${report.ssvPlacementMissCount}; affected runs in log: ${report.ssvFailureRuns}.`,
    `- ADDROF copy diagnostic: ${report.addrofCopyObserved ? "present" : "absent"}; chars: ${report.addrofCopyChars ?? "n/a"}; source coverage flag: ${report.addrofCopySourceCovered ? "true" : "not established"}.`,
    `- ADDROF coverage calculation: ${report.addrofCoverage ? JSON.stringify(report.addrofCoverage) : "not computable from this run"}.`,
    `- ADDROF failure records: ${report.addrofFailureCount}.`,
    `- ADDROF refresh-copy length: ${report.addrofRefreshCopyChars ?? "not recorded"} characters (diagnostic only).`,
    `- Core revision marker: ${report.coreRevision || "not recorded"}.`,
    `- SSV-RETURNED-CLEARED: observed=${report.ssvReturnedClearedObserved}; after earlier placement miss=${report.ssvReturnedClearedAfterPlacement}.`,
    `- Primitive markers: READ-PRIMITIVE-PASS=${report.readPrimitivePassObserved}; PRIMITIVE-OK=${report.primitiveOkObserved}; mismatch=${report.readPrimitiveMismatchObserved}.`,
    `- libkernel / HX1400 markers: discovered=${report.libkernelDiscovered}; not-found=${report.libkernelNotFound}; HX1400-start=${report.hx1400StartObserved}; HX1400-kernel-complete=${report.hx1400CompleteObserved}.`,
    `- HEN markers: candidate-artifacts=${report.henArtifactsObserved}; HEN-READY-client-claim=${report.henReadyClaimReported}; neither is independent target attestation.`,
    `- Memory profile: ${report.profile ? JSON.stringify(report.profile) : "not recorded"}.`,
    `- Diagnostic snapshots: ${report.diagnosticSnapshots.total} total; by kind: ${JSON.stringify(report.diagnosticSnapshots.byKind)}.`,
    `- Empty diagnostic snapshots: ${report.diagnosticSnapshots.emptyTotal}; by kind: ${JSON.stringify(report.diagnosticSnapshots.emptyByKind)}.`,
    `- Offset diagnostic: ${report.offsets ? JSON.stringify(report.offsets) : "not recorded"}.`,
    `- AppCache: ${report.appCacheState} (host-page cache state only; not an exploit-stage result).`,
    `- Attempt ceiling: ${report.attemptCeiling ? "reported" : "not reported"}; heap placement summary: ${report.heapPlacementMiss ? "reported" : "not reported"}.`,
    `- execution.end passCount/failCount: ${report.passCount ?? "n/a"}/${report.failCount ?? "n/a"}; these counters do not override the final status.`,
    "",
    "## Comparison with previous run",
    "",
    report.runComparison.previousRunId
      ? `- Previous run: ${report.runComparison.previousRunId}.`
      : "- No previous run was available for comparison.",
    `- Classification: ${report.runComparison.classification}.`,
    `- Runs with matching diagnostic signature: ${report.runComparison.matchingSignatureRuns}.`,
    `- Unchanged signature fields: ${(report.runComparison.unchangedFields || []).join(", ") || "none"}.`,
    `- Changed signature fields: ${(report.runComparison.changedFields || []).join(", ") || "none"}.`,
    `- Probe identity comparable: ${report.runComparison.identityComparable ? "yes" : "no"}.`,
    `- Probe identity relation: ${report.runComparison.identityRelation || "not available"}.`,
    "",
    "## Experiment identity",
    "",
    `- Exact probe identity established for this run: ${report.experimentIdentity.exactProbeIdentityEstablished ? "yes" : "no"}.`,
    `- Present metadata: ${Object.entries(report.experimentIdentity.fields).filter(([, value]) => value).map(([key]) => key).join(", ") || "none"}.`,
    `- Missing required metadata: ${report.experimentIdentity.missingRequired.join(", ") || "none"}.`,
    "",
    "## Interpretation",
    "",
    report.readPrimitivePassObserved && report.ssvRecoveredAfterRetry
      ? "One or more attempts reported an SSV placement/deserialization failure, but a later attempt emitted READ-PRIMITIVE-PASS. The earlier placement failure is classified as recovered; the pass marker remains client-reported and is not independent target-side proof."
      : report.ssvReturnedClearedAfterPlacement
        ? "A later attempt emitted SSV-RETURNED-CLEARED after an earlier placement failure. In core.js this marker follows the candidate/header/holder/function/native-executable validation path, but READ-PRIMITIVE-PASS was not recorded. Classify the SSV placement as advanced, while keeping the final primitive status unverified."
        : report.ssvBlocked
        ? "The latest observed WebKit primitive did not pass after the recorded SSV placement/deserialization failure(s). The attempt-ceiling and heap-placement messages are downstream termination/summary signals, not separate root causes."
        : "No SSV placement failure was recorded for this run. Absence of an error is not proof that a later gate passed.",
    report.appAssetNotReached
      ? "Client telemetry explicitly marked the payload asset as not-reached. No payload transfer was reported in this run."
      : "Payload transfer is only reported by the browser's application.asset event; verify it independently on the target.",
    report.addrofCopyObserved
      ? "ADDROF-COPY is retained as a local diagnostic only. source-covered=true describes the logged source-coverage check; it is not evidence of an arbitrary pointer, kernel read/write, sandbox escape, or privilege transition."
      : "No ADDROF-COPY diagnostic was present in this run.",
    report.diagnosticSnapshots.emptyTotal
      ? `The client emitted ${report.diagnosticSnapshots.emptyTotal} diagnostic snapshot(s) containing only a kind label and no measurements. These are counted as incomplete telemetry, not interpreted as successful checks.`
      : "All recorded diagnostic snapshots contained at least one measurement field.",
    report.runComparison.classification === "same-observed-signature"
      ? "The selected run matches the previous run across the auditor's observed signature fields. This indicates no measured diagnostic change between those sessions."
      : "The selected run's observed signature differs from the previous run or no comparison is available.",
    "",
    "This report is read-only. It does not change exploit parameters, retry a run, or claim HEN installation. All browser-originated events are untrusted telemetry until corroborated by independent target-side evidence.",
    "",
  ];

  if (parseErrors.length) {
    lines.push("## Log parsing warnings", "", `${parseErrors.length} malformed line(s) were skipped.`);
    for (const error of parseErrors.slice(0, 10)) {
      lines.push(`- Line ${error.line}: ${escapeMarkdown(error.message)}`);
    }
    lines.push("");
  }

  return lines.join("\n");
}

function parseArgs(argv) {
  const options = { input: DEFAULT_INPUT, format: "markdown" };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--input" && argv[index + 1]) options.input = argv[++index];
    else if (arg === "--output" && argv[index + 1]) options.output = argv[++index];
    else if (arg === "--run" && argv[index + 1]) options.runId = argv[++index];
    else if (arg === "--format" && argv[index + 1]) options.format = argv[++index];
    else if (arg === "--strict") options.strict = true;
    else if (arg === "--help" || arg === "-h") options.help = true;
    else throw new Error(`Unknown or incomplete argument: ${arg}`);
  }
  if (!["markdown", "json"].includes(options.format)) {
    throw new Error("--format must be markdown or json");
  }
  return options;
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    process.stdout.write(
      "Usage: node scripts/audit-runtime-gates.mjs [--input FILE] [--run RUN_ID] [--format markdown|json] [--output FILE] [--strict]\n",
    );
    return;
  }

  const absoluteInput = path.resolve(process.cwd(), options.input);
  const source = await readFile(absoluteInput, "utf8");
  const parsed = parseNdjson(source);
  const report = analyzeRuntimeLog(parsed.records, { runId: options.runId });
  const output = options.format === "json"
    ? JSON.stringify({ input: absoluteInput, strict: options.strict === true, report, parseErrors: parsed.errors }, null, 2) + "\n"
    : renderMarkdown(report, parsed.errors);

  if (options.output) {
    await writeFile(path.resolve(process.cwd(), options.output), output, "utf8");
    process.stdout.write(`Wrote ${options.output}\n`);
  } else {
    process.stdout.write(output);
  }

  if (options.strict) {
    const strictReport = options.runId && report.found
      ? analyzeRuntimeLog(
        parsed.records.filter((record) => record.runId === options.runId),
        { runId: options.runId },
      )
      : report;
    const scopedIntegrity = options.runId
      ? strictReport.runIntegrity
      : strictReport.integrity;
    const strictFailures = parsed.errors.length +
      (scopedIntegrity?.strictFailureCount || 0) +
      (strictReport.found ? 0 : 1);
    const scope = options.runId ? "selected run " + options.runId : "entire log";
    if (strictFailures > 0) {
      process.stderr.write("STRICT CHECK FAILED (" + scope + "): " + strictFailures + " telemetry/log integrity issue(s).\n");
      process.exitCode = 2;
    } else {
      process.stderr.write("STRICT CHECK PASSED (" + scope + "): no configured integrity failures.\n");
    }
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  main().catch((error) => {
    process.stderr.write(`runtime gate audit failed: ${error.message}\n`);
    process.exitCode = 1;
  });
}
