import { sha256Hex } from "./fan-threshold.js";

export const PS4DEBUG_NG = Object.freeze({
  version: "1.3.3",
  path: "./includes/payloads/Tools/ps4debug-ng_v1.3.3.bin",
  bytes: 3175432,
  sha256: "b348affbb6434ff6892ce24e5f1387e4e6657756c3ba42d117fb73b58d08f7a2",
  header: Object.freeze([0xe9, 0x56, 0x22, 0x00, 0x00]),
  binLoaderUrl: "http://127.0.0.1:9090/",
  debuggerPort: 744,
});

export async function validatePs4DebugPayload(bytes) {
  if (!(bytes instanceof Uint8Array)) {
    throw new TypeError("ps4debug-NG não retornou bytes válidos.");
  }
  if (bytes.byteLength !== PS4DEBUG_NG.bytes) {
    throw new Error(
      "Tamanho inesperado do ps4debug-NG: " + bytes.byteLength +
        " (esperado " + PS4DEBUG_NG.bytes + ").",
    );
  }
  if (!PS4DEBUG_NG.header.every((value, index) => bytes[index] === value)) {
    throw new Error("Cabeçalho do ps4debug-NG inválido.");
  }
  const digest = await sha256Hex(bytes);
  if (digest !== PS4DEBUG_NG.sha256) {
    throw new Error("SHA-256 divergente no ps4debug-NG: " + digest);
  }
  return { bytes: bytes.byteLength, sha256: digest };
}

export async function sendPs4DebugPayload(dependencies = {}) {
  const fetchImpl = dependencies.fetchImpl || globalThis.fetch;
  const XhrCtor = dependencies.XMLHttpRequestCtor || globalThis.XMLHttpRequest;
  const endpoint = dependencies.endpoint || PS4DEBUG_NG.binLoaderUrl;
  const timeoutMs = dependencies.timeoutMs || 10000;
  const telemetry = dependencies.telemetry || dependencies.mark || null;

  const emit = (tag, detail) => {
    if (typeof telemetry === "function") telemetry(tag, detail);
    else if (typeof globalThis.reportToolTelemetry === "function") globalThis.reportToolTelemetry(tag, detail);
    else if (typeof globalThis.mark === "function") globalThis.mark(tag, detail);
  };

  emit(
    "PS4DEBUG-PAYLOAD-SELECTED",
    "version=" + PS4DEBUG_NG.version + " asset=ps4debug-ng_v1.3.3.bin",
  );

  if (typeof fetchImpl !== "function") throw new Error("Fetch indisponível.");
  if (typeof XhrCtor !== "function") throw new Error("XMLHttpRequest indisponível.");

  const response = await fetchImpl(PS4DEBUG_NG.path, { cache: "no-store" });
  if (!response || !response.ok) {
    throw new Error(
      "Falha ao carregar ps4debug-NG (HTTP " +
        (response ? response.status : "sem resposta") + ").",
    );
  }

  const bytes = new Uint8Array(await response.arrayBuffer());
  emit("PS4DEBUG-PAYLOAD-DOWNLOADED", "bytes=" + bytes.byteLength);

  const validation = await validatePs4DebugPayload(bytes);
  emit(
    "PS4DEBUG-PAYLOAD-VALIDATED",
    "bytes=" + validation.bytes + " sha256=" + validation.sha256,
  );

  return new Promise((resolve, reject) => {
    const request = new XhrCtor();
    let settled = false;

    const fail = (message) => {
      if (settled) return;
      settled = true;
      reject(new Error(message));
    };

    request.open("POST", endpoint, true);
    request.timeout = timeoutMs;
    request.onload = () => {
      if (settled) return;
      if (request.status === 200 || request.status === 202) {
        settled = true;
        emit(
          "PS4DEBUG-PAYLOAD-ACCEPTED",
          "httpStatus=" + request.status +
            " tcpPort=" + PS4DEBUG_NG.debuggerPort +
            " serverObserved=false",
        );
        resolve({
          state: "PS4DEBUG-PAYLOAD-ACCEPTED",
          httpStatus: request.status,
          bytes: validation.bytes,
          debuggerPort: PS4DEBUG_NG.debuggerPort,
          serverObserved: false,
        });
      } else {
        fail("BinLoader respondeu HTTP " + request.status + ".");
      }
    };
    request.onerror = () => fail("Não foi possível conectar ao BinLoader em 127.0.0.1:9090.");
    request.ontimeout = () => fail("Tempo esgotado ao enviar ps4debug-NG ao BinLoader.");
    try {
      emit(
        "PS4DEBUG-PAYLOAD-SENT",
        "bytes=" + validation.bytes + " endpoint=" + endpoint,
      );
      request.send(bytes.buffer);
    } catch (error) {
      fail("Falha ao enviar ps4debug-NG: " +
        (error && error.message ? error.message : String(error)));
    }
  });
}

export function bindPs4DebugControls({ root, isSupported }) {
  if (!root) return;
  if (isSupported === false) {
    root.classList.add("is-hidden");
    return;
  }

  root.classList.remove("is-hidden");
  const button = root.querySelector("[data-ps4debug-send]");
  const status = root.querySelector("[data-ps4debug-status]");
  const ipInput = root.querySelector("[data-ps4debug-target-ip]") || document.querySelector("[data-binloader-target-ip]");
  if (!button) return;

  if (ipInput) {
    try {
      const savedIp = localStorage.getItem("ps4_binloader_ip");
      if (savedIp) ipInput.value = savedIp;
      ipInput.addEventListener("input", (e) => {
        try {
          localStorage.setItem("ps4_binloader_ip", e.target.value.trim());
        } catch (err) {}
      });
    } catch (e) {}
  }

  if (status) {
    status.textContent =
      "Requer HEN/GoldHEN ativo e BinLoader compatível na porta TCP 9090. " +
      "A resposta do BinLoader não confirma o serviço de depuração.";
  }

  button.addEventListener("click", async () => {
    button.disabled = true;
    if (status) {
      status.dataset.state = "loading";
      status.textContent = "Validando o binário e enviando ps4debug-NG ao BinLoader...";
    }

    const targetIp = (ipInput && ipInput.value.trim()) || (typeof localStorage !== "undefined" && localStorage.getItem("ps4_binloader_ip")) || "127.0.0.1";
    const customEndpoint = "http://" + targetIp + ":9090/";

    try {
      const result = await sendPs4DebugPayload({ endpoint: customEndpoint });
      if (status) {
        status.dataset.state = "accepted";
        status.textContent =
          "BinLoader aceitou " + result.bytes + " bytes (HTTP " +
          result.httpStatus + "). TCP " + result.debuggerPort +
          " ainda não foi confirmado. No computador da rede, execute: " +
          "node scripts/ps4debug-probe.mjs " + targetIp + ".";
      }
    } catch (error) {
      if (status) {
        status.dataset.state = "error";
        let msg = error && error.message ? error.message : String(error);
        if (location.protocol === "https:" && (msg.includes("127.0.0.1:9090") || msg.includes("conectar") || msg.includes("NetworkError") || msg.includes("Failed to fetch"))) {
          msg += " (GitHub Pages HTTPS restringe conexões de rede locais por Conteúdo Misto. Utilize o comando de envio no terminal ou execute via host HTTP local).";
        }
        status.textContent = msg;
      }
    } finally {
      button.disabled = false;
    }
  });
}
