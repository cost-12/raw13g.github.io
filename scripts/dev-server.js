"use strict";

const fs = require("node:fs");
const http = require("node:http");
const os = require("node:os");
const path = require("node:path");

const DEFAULT_ROOT = path.resolve(__dirname, "..");

function createDevServer(options = {}) {
  const root = path.resolve(options.root || DEFAULT_ROOT);
  const logDir = path.resolve(options.logDir || path.join(root, ".local-logs"));
  const logFile = path.join(logDir, "runtime-errors.ndjson");
  const previousLogFile = logFile + ".1";
  const maxLogBytes = 5 * 1024 * 1024;

  const mimeTypes = {
    ".appcache": "text/cache-manifest; charset=utf-8",
    ".bin": "application/octet-stream",
    ".css": "text/css; charset=utf-8",
    ".html": "text/html; charset=utf-8",
    ".js": "text/javascript; charset=utf-8",
    ".json": "application/json; charset=utf-8",
    ".md": "text/markdown; charset=utf-8",
    ".png": "image/png",
    ".svg": "image/svg+xml",
    ".ttf": "font/ttf",
    ".woff2": "font/woff2"
  };

  function respond(res, status, body, contentType) {
    res.writeHead(status, {
      "Content-Type": contentType || "text/plain; charset=utf-8",
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff"
    });
    res.end(body);
  }

  function redactText(value, limit) {
    return String(value == null ? "" : value)
      .replace(/\b0x[0-9a-f]{6,}\b/gi, "[endereço oculto]")
      .replace(/(https?:\/\/[^\s?#]+)\?[^\s#]*/gi, "$1")
      .slice(0, limit);
  }

  function sanitizeRecord(input) {
    if (!input || typeof input !== "object" || Array.isArray(input)) return null;
    if (![1, 2].includes(input.schemaVersion) || typeof input.message !== "string") return null;

    const allowedTypes = new Set([
      "runtime",
      "resource",
      "unhandledrejection",
      "telemetry",
      "handled",
    ]);
    if (!allowedTypes.has(input.type)) return null;

    const cleanPath = (value, limit) => {
      if (typeof value !== "string") return "";
      const pathOnly = value.split(/[?#]/, 1)[0];
      return pathOnly.startsWith("/") ? pathOnly.slice(0, limit) : "";
    };
    const record = {
      schemaVersion: input.schemaVersion,
      receivedAt: new Date().toISOString(),
      timestamp: redactText(input.timestamp, 40),
      type: input.type,
      message: redactText(input.message, 2000),
      stack: redactText(input.stack, 8000),
      source: cleanPath(input.source, 1024),
      line: Number.isFinite(Number(input.line)) ? Number(input.line) : 0,
      column: Number.isFinite(Number(input.column)) ? Number(input.column) : 0,
      page: cleanPath(input.page, 512),
      userAgent: redactText(input.userAgent, 512)
    };

    if (input.schemaVersion === 2) {
      if (typeof input.event === "string" && /^[a-z][a-z0-9_.:-]{0,63}$/i.test(input.event)) {
        record.event = input.event;
      }
      if (typeof input.sessionId === "string" && /^[a-z0-9_-]{1,80}$/i.test(input.sessionId)) {
        record.sessionId = input.sessionId;
      }
      if (typeof input.runId === "string" && /^[a-z0-9_-]{1,80}$/i.test(input.runId)) {
        record.runId = input.runId;
      }
      if (typeof input.firmware === "string" && /^\d{1,2}\.\d{2}$/.test(input.firmware)) {
        record.firmware = input.firmware;
      }
      if (input.stage != null && Number.isFinite(Number(input.stage))) {
        record.stage = Math.max(0, Math.min(4, Math.trunc(Number(input.stage))));
      }
      if (input.previousStage != null && Number.isFinite(Number(input.previousStage))) {
        record.previousStage = Math.max(0, Math.min(4, Math.trunc(Number(input.previousStage))));
      }
      for (const field of ["elapsedMs", "durationMs", "stageDurationMs"]) {
        if (input[field] != null && Number.isFinite(Number(input[field]))) {
          record[field] = Math.max(0, Math.min(24 * 60 * 60 * 1000, Math.trunc(Number(input[field]))));
        }
      }
      for (const field of ["passCount", "failCount"]) {
        if (input[field] != null && Number.isFinite(Number(input[field]))) {
          record[field] = Math.max(0, Math.min(1000000, Math.trunc(Number(input[field]))));
        }
      }
      if (typeof input.status === "string") record.status = redactText(input.status, 64);
      if (typeof input.lockOwner === "string" && /^[a-z0-9_-]{1,80}$/i.test(input.lockOwner)) {
        record.lockOwner = input.lockOwner;
      }
      if (typeof input.lockState === "string" && /^[a-z0-9_-]{1,64}$/i.test(input.lockState)) {
        record.lockState = input.lockState;
      }
      if (Number.isInteger(input.lockStage) && input.lockStage >= 1 && input.lockStage <= 4) {
        record.lockStage = input.lockStage;
      }
      for (const field of ["lockAgeMs", "lockStartedAt", "lockUpdatedAt"]) {
        if (input[field] == null || !Number.isFinite(Number(input[field]))) continue;
        const value = Number(input[field]);
        if (value < 0 || value > 8640000000000000) continue;
        record[field] = Math.trunc(value);
      }
      if (typeof input.lockProtected === "boolean") {
        record.lockProtected = input.lockProtected;
      }
      if (input.application === "GoldHEN" || input.application === "PS4HEN" || input.application === "HEN") {
        record.application = input.application;
      }
      if (typeof input.asset === "string" && /^[A-Za-z0-9._-]{1,128}$/.test(input.asset)) {
        record.asset = input.asset;
      }
      for (const field of ["sizeBytes", "httpStatus"]) {
        if (input[field] != null && Number.isFinite(Number(input[field]))) {
          const maximum = field === "sizeBytes" ? 20 * 1024 * 1024 : 599;
          record[field] = Math.max(0, Math.min(maximum, Math.trunc(Number(input[field]))));
        }
      }
      if (input.progressPercent != null && Number.isFinite(Number(input.progressPercent))) {
        record.progressPercent = Math.max(0, Math.min(100, Number(input.progressPercent)));
      }
      if (input.options && typeof input.options === "object" && !Array.isArray(input.options)) {
        record.options = {
          jb: input.options.jb === true,
          patch: input.options.patch === true,
          payload: input.options.payload === true,
          keepJb: input.options.keepJb === true
        };
      }
      if (input.diagnostics && typeof input.diagnostics === "object" && !Array.isArray(input.diagnostics)) {
        const diagnostics = input.diagnostics;
        const cleanDiagnostics = {};
        if (typeof diagnostics.kind === "string" && /^[a-z][a-z0-9_-]{1,24}$/i.test(diagnostics.kind)) {
          cleanDiagnostics.kind = diagnostics.kind;
        }
        if (typeof diagnostics.uidClass === "string" && /^[a-z-]{1,24}$/i.test(diagnostics.uidClass)) {
          cleanDiagnostics.uidClass = diagnostics.uidClass;
        }
        if (typeof diagnostics.offsetHash === "string" && /^[0-9a-f]{8,64}$/i.test(diagnostics.offsetHash)) {
          cleanDiagnostics.offsetHash = diagnostics.offsetHash;
        }
        if (typeof diagnostics.placementError === "string" && /^[a-z][a-z0-9_-]{1,32}$/i.test(diagnostics.placementError)) {
          cleanDiagnostics.placementError = diagnostics.placementError;
        }
        if (typeof diagnostics.sourceCovered === "boolean") cleanDiagnostics.sourceCovered = diagnostics.sourceCovered;
        for (const field of ["uid", "pid", "carrierSlots", "maxAttempts", "attemptNumber", "copiedChars", "drainCount", "drainBytes", "slabBytes", "offsetCount", "offsetAligned", "offsetMissing"]) {
          if (diagnostics[field] == null || !Number.isFinite(Number(diagnostics[field]))) continue;
          const maximum = field === "pid" ? 0xffffffff : 100000000;
          cleanDiagnostics[field] = Math.max(0, Math.min(maximum, Math.trunc(Number(diagnostics[field]))));
        }
        if (Object.keys(cleanDiagnostics).length) record.diagnostics = cleanDiagnostics;
      }
    }
    return record;
  }

  function storeRecord(record) {
    fs.mkdirSync(logDir, { recursive: true });
    let currentSize = 0;
    try {
      currentSize = fs.statSync(logFile).size;
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }

    if (currentSize >= maxLogBytes) {
      fs.rmSync(previousLogFile, { force: true });
      try {
        fs.renameSync(logFile, previousLogFile);
      } catch (error) {
        if (error.code !== "ENOENT") throw error;
      }
    }

    fs.appendFileSync(logFile, JSON.stringify(record) + "\n", "utf8");
  }

  function readBody(req, res, limit, onComplete) {
    let body = "";
    let bodyBytes = 0;
    let oversized = false;
    req.setEncoding("utf8");
    req.on("data", (chunk) => {
      if (oversized) return;
      bodyBytes += Buffer.byteLength(chunk, "utf8");
      if (bodyBytes > limit) {
        oversized = true;
        respond(res, 413, "Corpo muito grande");
        return;
      }
      body += chunk;
    });
    req.on("end", () => {
      if (!oversized && !res.writableEnded) onComplete(body);
    });
  }

  function receiveError(req, res) {
    readBody(req, res, 64 * 1024, (body) => {
      let input;
      try {
        input = JSON.parse(body);
      } catch (error) {
        respond(res, 400, "JSON inválido");
        return;
      }

      const record = sanitizeRecord(input);
      if (!record) {
        respond(res, 400, "Formato de erro inválido");
        return;
      }

      try {
        storeRecord(record);
        respond(res, 202, JSON.stringify({ accepted: true }), "application/json; charset=utf-8");
      } catch (error) {
        console.error("Não foi possível gravar o erro local:", error.message);
        respond(res, 500, "Falha ao gravar log");
      }
    });
  }

  function receiveExecutionEvent(req, res) {
    readBody(req, res, 16 * 1024, (body) => {
      const form = new URLSearchParams(body);
      const tag = redactText(form.get("tag"), 120);
      const detail = redactText(form.get("detail"), 2000);
      if (!tag) {
        respond(res, 400, "Evento inválido");
        return;
      }

      // Keep ordinary progress chatter out of the durable log, but retain the
      // bounded memory diagnostics and significant lifecycle/telemetry gates.
      if (
        !/(FAIL|ERROR|THREW|ABORT|TIMEOUT|MISMATCH|LOST|POISON|BAD|INVALID|MISS|PANIC|REBOOT|MEMORY-CONFIG|ADDROF-COPY|ADDROF-REFRESH|PREDECESSOR-FILLED|SSV-STORE|SSV-STORED|SSV-GROOM|SSV-RETURNED|CANDIDATE-HEADER-SOURCE|READ-PRIMITIVE-PASS|PRIMITIVE-OK|PAIR-STATUS|CORE-REVISION|HX1400-START|HX1400-THREW|HX1400-STOP|HX1400-COMPLETE|HX1400-KERNEL-COMPLETE|HX1400-KBASE-READY|HX1400-ROUTE-ELIGIBILITY|HX1400-POST-PRIMITIVE-GATE|LIBKERNEL-DISCOVERED|LIBKERNEL-ELF-NOT-FOUND|LIBKERNEL-ELF-SCAN-START|LIBKERNEL-ERROR-IMPORT-RESOLVED|GADGET-BAD|GADGET-VERIFY|STUBS|SYSCALL-STUB|BASES|PRIMITIVE-HANDOFF|NATIVE-FUNCTION|WEBKIT-BASE-RESOLVED|GROOM-PROFILE|LEGACY-KERNEL-TABLE-SKIPPED|LEGACY-KPATCH-TABLE-SKIPPED|LEGACY-PAYLOAD-TABLE-SKIPPED|MODULE-LOADED|PAYLOAD-SELECTED|PAYLOAD-DOWNLOADED|PAYLOAD-VALIDATED|ENTRY-RETURNED|PAYLOAD-LAUNCH-RETURNED|HEN-OBSERVED|HEN-ARTIFACTS-OBSERVED|HEN-PENDING|HEN-READY|HEN-READINESS-UNVERIFIED|GOLDHEN-OBSERVED|GOLDHEN-PATCHSET|GOLDHEN-DISPATCH|GOLDHEN-57-SITE|PS4DEBUG-PAYLOAD|PS4DEBUG-SERVER-OBSERVED|EXECUTION-LOCK-STALE-RECLAIMED|FAN-PAYLOAD-SENT|FAN-PAYLOAD-ACCEPTED|FAN-THRESHOLD-OBSERVED)/i.test(
          tag,
        )
      ) {
        res.writeHead(204, { "Cache-Control": "no-store" });
        res.end();
        return;
      }

      const timestamp = new Date().toISOString();
      let page = "";
      try {
        page = new URL(req.headers.referer).pathname.slice(0, 512);
      } catch (error) {}

      const runId = form.get("runId") || "";
      const firmware = form.get("firmware") || "";
      const stageValue = Number(form.get("stage"));
      const elapsedValue = Number(form.get("elapsedMs"));
      const eventTag = tag.toLowerCase().replace(/[^a-z0-9_.:-]/g, "-").slice(0, 56);

      const record = {
        schemaVersion: 2,
        receivedAt: timestamp,
        timestamp,
        type: "handled",
        event: "handled." + eventTag,
        message: tag + (detail ? ": " + detail : ""),
        stack: "",
        source: "",
        line: 0,
        column: 0,
        page,
        userAgent: String(req.headers["user-agent"] || "").slice(0, 512)
      };
      if (/^[a-z0-9_-]{1,80}$/i.test(runId)) record.runId = runId;
      if (/^\d{1,2}\.\d{2}$/.test(firmware)) record.firmware = firmware;
      if (Number.isFinite(stageValue)) record.stage = Math.max(0, Math.min(4, Math.trunc(stageValue)));
      if (Number.isFinite(elapsedValue)) {
        record.elapsedMs = Math.max(0, Math.min(24 * 60 * 60 * 1000, Math.trunc(elapsedValue)));
      }
      try {
        storeRecord(record);
        res.writeHead(204, { "Cache-Control": "no-store" });
        res.end();
      } catch (error) {
        console.error("Não foi possível gravar o erro local:", error.message);
        respond(res, 500, "Falha ao gravar log");
      }
    });
  }

  function serveStatic(req, res, pathname) {
    let decodedPath;
    try {
      decodedPath = decodeURIComponent(pathname);
    } catch (error) {
      respond(res, 400, "Caminho inválido");
      return;
    }

    const relativePath = decodedPath === "/" ? "index.html" : decodedPath.replace(/^\/+/, "");
    const filePath = path.resolve(root, relativePath);
    if (relativePath.split(/[\\/]/).some((segment) => segment.startsWith("."))) {
      respond(res, 404, "Arquivo não encontrado");
      return;
    }
    if (filePath !== root && !filePath.startsWith(root + path.sep)) {
      respond(res, 403, "Acesso negado");
      return;
    }
    if (filePath === logDir || filePath.startsWith(logDir + path.sep)) {
      respond(res, 404, "Arquivo não encontrado");
      return;
    }

    fs.stat(filePath, (statError, stat) => {
      if (statError || !stat.isFile()) {
        respond(res, 404, "Arquivo não encontrado");
        return;
      }

      const headers = {
        "Content-Type": mimeTypes[path.extname(filePath).toLowerCase()] || "application/octet-stream",
        "Content-Length": stat.size,
        "Cache-Control": path.extname(filePath).toLowerCase() === ".appcache" ? "no-cache" : "no-store",
        "X-Content-Type-Options": "nosniff"
      };
      res.writeHead(200, headers);
      if (req.method === "HEAD") {
        res.end();
        return;
      }

      const stream = fs.createReadStream(filePath);
      stream.on("error", () => {
        if (!res.headersSent) respond(res, 404, "Arquivo não encontrado");
        else res.destroy();
      });
      stream.pipe(res);
    });
  }

  return http.createServer((req, res) => {
    let pathname;
    try {
      pathname = new URL(req.url, "http://localhost").pathname;
    } catch (error) {
      respond(res, 400, "URL inválida");
      return;
    }

    if (pathname === "/__health" && req.method === "GET") {
      respond(res, 200, JSON.stringify({ ok: true }), "application/json; charset=utf-8");
      return;
    }
    if (pathname === "/__errors" && req.method === "POST") {
      receiveError(req, res);
      return;
    }
    if (pathname === "/t" && req.method === "POST") {
      receiveExecutionEvent(req, res);
      return;
    }
    if (req.method !== "GET" && req.method !== "HEAD") {
      respond(res, 405, "Método não permitido");
      return;
    }

    serveStatic(req, res, pathname);
  });
}

function isPrivateIPv4(address) {
  if (typeof address !== "string") return false;
  const parts = address.split(".").map(Number);
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) {
    return false;
  }
  return (
    parts[0] === 10 ||
    (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) ||
    (parts[0] === 192 && parts[1] === 168)
  );
}

function getLanIPv4Addresses(interfaces = os.networkInterfaces()) {
  const addresses = [];
  for (const [name, records] of Object.entries(interfaces)) {
    for (const record of records || []) {
      const isIPv4 = record.family === "IPv4" || record.family === 4;
      if (!record.internal && isIPv4 && isPrivateIPv4(record.address)) {
        addresses.push({ name, address: record.address });
      }
    }
  }
  return addresses;
}

function parseCliOptions(argv = process.argv.slice(2), env = process.env) {
  let host = env.HOST || "127.0.0.1";
  let port = Number(env.PORT || 8080);

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--lan") {
      host = "0.0.0.0";
    } else if (arg === "--host" || arg === "--port") {
      const value = argv[++i];
      if (!value || value.startsWith("--")) throw new Error(`${arg} requer um valor.`);
      if (arg === "--host") host = value;
      else port = Number(value);
    } else if (arg === "--help" || arg === "-h") {
      return { help: true };
    } else {
      throw new Error(`Opção desconhecida: ${arg}`);
    }
  }

  if (!host) throw new Error("HOST não pode ficar vazio.");
  if (!Number.isInteger(port) || port < 0 || port > 65535) {
    throw new Error("PORT deve ser um inteiro entre 0 e 65535.");
  }

  return { host, port, lan: host === "0.0.0.0" || host === "::" };
}

function startDevServer(argv = process.argv.slice(2), env = process.env) {
  let options;
  try {
    options = parseCliOptions(argv, env);
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
    return;
  }
  if (options.help) {
    console.log("Uso: npm run dev [-- --host HOST --port PORT]");
    console.log("     npm run dev:lan");
    return;
  }

  const server = createDevServer();
  server.listen(options.port, options.host, () => {
    const address = server.address();
    console.log(`Servidor ouvindo em ${options.host}:${address.port}`);
    console.log(`Acesso neste computador: http://localhost:${address.port}`);
    console.log("Erros serão gravados em .local-logs/runtime-errors.ndjson");
    if (options.lan) {
      const addresses = getLanIPv4Addresses();
      if (addresses.length === 0) {
        console.log("Nenhum endereço IPv4 privado foi encontrado; verifique a conexão Wi-Fi/Ethernet.");
      } else {
        console.log("Acesso na rede local:");
        for (const item of addresses) {
          console.log(`  http://${item.address}:${address.port}  (${item.name})`);
        }
      }
    }
  });
  server.on("error", (error) => {
    console.error(`Falha ao iniciar servidor: ${error.message}`);
    process.exitCode = 1;
  });
}

if (require.main === module) startDevServer();

module.exports = { createDevServer, getLanIPv4Addresses, parseCliOptions };
