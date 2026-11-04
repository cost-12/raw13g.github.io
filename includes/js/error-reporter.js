(function () {
  "use strict";

  var hostname = window.location.hostname.toLowerCase();
  var isLoopback =
    hostname === "localhost" ||
    hostname === "::1" ||
    hostname === "[::1]" ||
    hostname.indexOf("127.") === 0;
  var isPrivateIpv4 =
    hostname.indexOf("10.") === 0 ||
    hostname.indexOf("192.168.") === 0 ||
    /^172\.(1[6-9]|2[0-9]|3[01])\./.test(hostname);
  var isLocalHostname = hostname.slice(-6) === ".local";

  // Never transmit runtime details from the public GitHub Pages host.
  if (!isLoopback && !isPrivateIpv4 && !isLocalHostname) return;

  var endpoint = "/__errors";
  var pageStartedAt = Date.now();
  var sessionId = String(pageStartedAt) + "-" + String(Math.floor(Math.random() * 1000000000));
  var execution = null;

  function safeString(value, limit) {
    try {
      return String(value == null ? "" : value).slice(0, limit);
    } catch (error) {
      return "[unavailable]";
    }
  }

  function pagePath() {
    return window.location.pathname.slice(0, 512);
  }

  function sourcePath(value) {
    if (!value) return "";
    try {
      return new URL(value, window.location.href).pathname.slice(0, 1024);
    } catch (error) {
      return safeString(value, 1024).split(/[?#]/)[0];
    }
  }

  function send(record) {
    if (typeof XMLHttpRequest === "undefined") return;

    var request;
    try {
      request = new XMLHttpRequest();
      request.open("POST", endpoint, true);
      request.setRequestHeader("Content-Type", "application/json;charset=UTF-8");
      request.timeout = 2000;
      request.send(JSON.stringify(record));
    } catch (error) {}
  }

  function diagnosticNumber(value, maximum) {
    if (value == null || !Number.isFinite(Number(value))) return undefined;
    return Math.max(0, Math.min(maximum, Math.trunc(Number(value))));
  }

  function sanitizeDiagnostics(details) {
    if (!details || typeof details !== "object" || Array.isArray(details)) return undefined;
    var out = {};
    if (typeof details.kind === "string" && /^[a-z][a-z0-9_-]{1,24}$/i.test(details.kind)) {
      out.kind = details.kind;
    }
    if (typeof details.uidClass === "string" && /^[a-z-]{1,24}$/i.test(details.uidClass)) {
      out.uidClass = details.uidClass;
    }
    if (typeof details.offsetHash === "string" && /^[0-9a-f]{8,64}$/i.test(details.offsetHash)) {
      out.offsetHash = details.offsetHash;
    }
    if (typeof details.placementError === "string" && /^[a-z][a-z0-9_-]{1,32}$/i.test(details.placementError)) {
      out.placementError = details.placementError;
    }
    if (typeof details.sourceCovered === "boolean") out.sourceCovered = details.sourceCovered;
    ["uid", "pid", "carrierSlots", "maxAttempts", "attemptNumber", "copiedChars", "drainCount", "drainBytes", "slabBytes", "offsetCount", "offsetAligned", "offsetMissing"].forEach(function (field) {
      var value = diagnosticNumber(details[field], field === "pid" ? 0xffffffff : 100000000);
      if (value !== undefined) out[field] = value;
    });
    return Object.keys(out).length ? out : undefined;
  }

  function capture(type, message, details) {
    details = details || {};
    var record = {
      schemaVersion: 2,
      timestamp: new Date().toISOString(),
      type: safeString(type, 40),
      message: safeString(message, 2000),
      stack: safeString(details.stack, 8000),
      source: sourcePath(details.source),
      line: Number(details.line) || 0,
      column: Number(details.column) || 0,
      page: pagePath(),
      userAgent: safeString(navigator.userAgent, 512),
      sessionId: sessionId,
      elapsedMs: Math.max(0, Date.now() - pageStartedAt),
      runId: safeString(details.runId || (execution && execution.runId), 80),
      firmware: safeString(details.firmware || (execution && execution.firmware), 16)
    };
    if (details.event) record.event = safeString(details.event, 64);
    if (details.runId) record.runId = safeString(details.runId, 80);
    if (details.firmware) record.firmware = safeString(details.firmware, 16);
    if (details.application === "GoldHEN" || details.application === "PS4HEN" || details.application === "HEN") {
      record.application = details.application;
    }
    if (typeof details.asset === "string" && /^[A-Za-z0-9._-]{1,128}$/.test(details.asset)) {
      record.asset = details.asset;
    }
    if (details.sizeBytes != null && Number.isFinite(Number(details.sizeBytes))) {
      record.sizeBytes = Math.max(0, Math.min(20 * 1024 * 1024, Math.trunc(Number(details.sizeBytes))));
    }
    if (details.httpStatus != null && Number.isFinite(Number(details.httpStatus))) {
      record.httpStatus = Math.max(0, Math.min(599, Math.trunc(Number(details.httpStatus))));
    }
    if (details.stage != null && Number.isFinite(Number(details.stage))) {
      record.stage = Number(details.stage);
    } else if (execution && execution.stage) {
      record.stage = execution.stage;
    }
    if (details.previousStage != null && Number.isFinite(Number(details.previousStage))) {
      record.previousStage = Number(details.previousStage);
    }
    if (details.durationMs != null && Number.isFinite(Number(details.durationMs))) {
      record.durationMs = Number(details.durationMs);
    }
    if (details.status) record.status = safeString(details.status, 64);
    if (typeof details.lockOwner === "string" && /^[a-z0-9-]{1,80}$/i.test(details.lockOwner)) {
      record.lockOwner = details.lockOwner;
    }
    if (typeof details.lockState === "string" && /^[a-z0-9_-]{1,64}$/i.test(details.lockState)) {
      record.lockState = details.lockState;
    }
    if (Number.isInteger(details.lockStage) && details.lockStage >= 1 && details.lockStage <= 4) {
      record.lockStage = details.lockStage;
    }
    ["lockAgeMs", "lockStartedAt", "lockUpdatedAt"].forEach(function (field) {
      var value = Number(details[field]);
      if (details[field] != null && Number.isFinite(value) && value >= 0 && value <= 8640000000000000) {
        record[field] = Math.trunc(value);
      }
    });
    if (typeof details.lockProtected === "boolean") record.lockProtected = details.lockProtected;
    if (details.progressPercent != null && Number.isFinite(Number(details.progressPercent))) {
      record.progressPercent = Number(details.progressPercent);
    }
    if (details.options && typeof details.options === "object") {
      record.options = {
        jb: details.options.jb === true,
        patch: details.options.patch === true,
        payload: details.options.payload === true,
        keepJb: details.options.keepJb === true
      };
    }
    if (details.passCount != null && Number.isFinite(Number(details.passCount))) {
      record.passCount = Number(details.passCount);
    }
    if (details.failCount != null && Number.isFinite(Number(details.failCount))) {
      record.failCount = Number(details.failCount);
    }
    if (details.stageDurationMs != null && Number.isFinite(Number(details.stageDurationMs))) {
      record.stageDurationMs = Number(details.stageDurationMs);
    }
    var diagnostics = sanitizeDiagnostics(details.diagnostics);
    if (diagnostics) record.diagnostics = diagnostics;
    send(record);
  }

  // The execution summary contains fixed fields only; raw UI text and payload data never enter telemetry.
  window.reportExecutionTelemetry = function (event, details) {
    details = details || {};
    var allowedEvents = { start: true, blocked: true, firmware: true, stage: true, end: true };
    if (!Object.prototype.hasOwnProperty.call(allowedEvents, event)) return;

    var now = Date.now();
    var runId = safeString(details.runId || (execution && execution.runId), 80);
    var durationMs = execution ? Math.max(0, now - execution.startedAt) : 0;
    var stageDurationMs = null;
    if (event === "start") {
      execution = { runId: runId, startedAt: now, stage: 0, stageStartedAt: now };
      durationMs = 0;
    } else if (event === "stage" && execution && Number(details.stage) !== execution.stage) {
      details.previousStage = execution.stage;
      stageDurationMs = Math.max(0, now - execution.stageStartedAt);
      execution.stage = Number(details.stage) || 0;
      execution.stageStartedAt = now;
    } else if (event === "end" && execution) {
      stageDurationMs = Math.max(0, now - execution.stageStartedAt);
    }
    if (event === "firmware" && execution && details.firmware) {
      execution.firmware = safeString(details.firmware, 16);
    }

    capture("telemetry", "execution." + event, {
      event: "execution." + event,
      runId: runId,
      firmware: details.firmware,
      stage: details.stage,
      previousStage: details.previousStage,
      durationMs: durationMs,
      stageDurationMs: stageDurationMs,
      status: details.status,
      lockOwner: details.lockOwner,
      lockState: details.lockState,
      lockStage: details.lockStage,
      lockAgeMs: details.lockAgeMs,
      lockStartedAt: details.lockStartedAt,
      lockUpdatedAt: details.lockUpdatedAt,
      lockProtected: details.lockProtected,
      options: details.options,
      passCount: details.passCount,
      failCount: details.failCount
    });
    if (event === "end") execution = null;
  };

  window.reportExecutionDiagnostics = function (kind, details) {
    details = details || {};
    var allowedKinds = { identity: true, offsets: true, profile: true };
    if (!Object.prototype.hasOwnProperty.call(allowedKinds, kind)) return;
    var diagnostics = sanitizeDiagnostics(Object.assign({}, details, { kind: kind }));
    if (!diagnostics) return;
    capture("telemetry", "execution.diagnostics", {
      event: "execution.diagnostics",
      runId: execution && execution.runId,
      firmware: execution && execution.firmware,
      stage: execution && execution.stage,
      diagnostics: diagnostics
    });
  };

  window.reportApplicationTelemetry = function (event, details) {
    details = details || {};
    var allowedEvents = { selected: true, asset: true, launch: true };
    var allowedStatuses = {
      selected: true,
      disabled: true,
      downloaded: true,
      validated: true,
      accepted: true,
      "http-error": true,
      "fetch-error": true,
      "not-reached": true,
      empty: true,
      "invalid-header": true,
      started: true,
      failed: true
    };
    if (!Object.prototype.hasOwnProperty.call(allowedEvents, event)) return;
    if (!Object.prototype.hasOwnProperty.call(allowedStatuses, details.status)) return;
    if (details.application !== "GoldHEN" && details.application !== "PS4HEN" && details.application !== "HEN") return;
    capture("telemetry", "application." + event, {
      event: "application." + event,
      application: details.application,
      asset: details.asset,
      status: details.status,
      sizeBytes: details.sizeBytes,
      httpStatus: details.httpStatus
    });
  };

  // Tool telemetry is separate from jailbreak execution telemetry. Only fixed
  // event names are accepted; arbitrary page strings and binary contents are
  // never forwarded by this helper.
  window.reportToolTelemetry = function (tag, detail) {
    var allowedEvents = {
      "PAYLOAD-SELECTED": true,
      "PAYLOAD-DOWNLOADED": true,
      "PAYLOAD-VALIDATED": true,
      "FAN-PAYLOAD-SENT": true,
      "FAN-PAYLOAD-ACCEPTED": true,
      "PS4DEBUG-PAYLOAD-SELECTED": true,
      "PS4DEBUG-PAYLOAD-DOWNLOADED": true,
      "PS4DEBUG-PAYLOAD-VALIDATED": true,
      "PS4DEBUG-PAYLOAD-SENT": true,
      "PS4DEBUG-PAYLOAD-ACCEPTED": true,
      "GOLDHEN-PATCHSET-VALIDATED": true,
      "GOLDHEN-57-SITE-AUDIT-BLOCKED": true,
      "GOLDHEN-DISPATCH-BLOCKED": true
    };
    if (typeof tag !== "string" || !Object.prototype.hasOwnProperty.call(allowedEvents, tag)) return;
    var event = "tool." + tag.toLowerCase().replace(/[^a-z0-9_.:-]/g, "-").slice(0, 56);
    var message = tag + (detail ? ": " + safeString(detail, 1000) : "");
    capture("telemetry", message, {
      event: event,
      status: "observed"
    });
  };

  function cacheStatusName(cache) {
    if (!cache) return "unsupported";
    var names = ["uncached", "idle", "checking", "downloading", "update-ready", "obsolete"];
    return names[cache.status] || "unknown";
  }

  function reportCacheEvent(event, progressPercent) {
    capture("telemetry", "appcache." + event, {
      event: "appcache." + event,
      status: cacheStatusName(window.applicationCache),
      progressPercent: progressPercent
    });
  }

  if (window.applicationCache && typeof window.applicationCache.addEventListener === "function") {
    var appCache = window.applicationCache;
    var cacheEvents = ["checking", "error", "noupdate", "downloading", "updateready", "cached", "obsolete"];
    cacheEvents.forEach(function (eventName) {
      appCache.addEventListener(eventName, function () {
        reportCacheEvent(eventName);
      });
    });
    var lastProgressBucket = -1;
    appCache.addEventListener("progress", function (event) {
      var percent = event && Number(event.total) > 0
        ? Math.max(0, Math.min(100, Math.floor((Number(event.loaded) / Number(event.total)) * 4) * 25))
        : null;
      var bucket = percent == null ? 0 : percent;
      if (bucket === lastProgressBucket) return;
      lastProgressBucket = bucket;
      reportCacheEvent("progress", percent);
    });
  }

  window.addEventListener("load", function () {
    capture("telemetry", "page.load", {
      event: "page.load",
      status: cacheStatusName(window.applicationCache)
    });
  });

  window.addEventListener("error", function (event) {
    if (event.target && event.target !== window) {
      var resource = event.target.src || event.target.href || "";
      try {
        resource = resource ? new URL(resource, window.location.href).pathname : "";
      } catch (error) {
        resource = "";
      }
      capture("resource", "Falha ao carregar recurso", { source: resource });
      return;
    }

    capture("runtime", event.message || "Erro de execução", {
      stack: event.error && event.error.stack,
      source: event.filename,
      line: event.lineno,
      column: event.colno
    });
  }, true);

  window.addEventListener("unhandledrejection", function (event) {
    var reason = event.reason;
    var message = reason && reason.message ? reason.message : reason;
    capture("unhandledrejection", message || "Promise rejeitada sem tratamento", {
      stack: reason && reason.stack
    });
  });
})();
