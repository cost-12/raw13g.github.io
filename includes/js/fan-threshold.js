const FAN_THRESHOLD_BASE = "./includes/payloads/Tools/fan-thresholds/";
export const FAN_THRESHOLD_ENDPOINT = "http://127.0.0.1:9090/";

export const FAN_THRESHOLD_OPTIONS = Object.freeze([
  Object.freeze({
    temperature: 60,
    path: FAN_THRESHOLD_BASE + "ps4-fan-threshold60.bin",
    sha256: "73bda82299ce84440c678d0b20704bf74df507897eeffb392e7fb076f4417b13",
  }),
  Object.freeze({
    temperature: 70,
    path: FAN_THRESHOLD_BASE + "ps4-fan-threshold70.bin",
    sha256: "7be7b600f0ef89aa5bfa5e7f40d549103138286c0c04d0004f7bc9a6f6d0176c",
  }),
  Object.freeze({
    temperature: 80,
    path: FAN_THRESHOLD_BASE + "ps4-fan-threshold80.bin",
    sha256: "8734cbcd0ffaf2fe1f3169f201dc6d03d2674dd2f9f4c9e256e17945572835dd",
  }),
  Object.freeze({
    temperature: 85,
    path: FAN_THRESHOLD_BASE + "ps4-fan-threshold85.bin",
    sha256: "4793641950377600897cd799d9da1365dfe60452c3de93ed815f104fafc576ec",
  }),
]);

const FAN_PAYLOAD_SIZE = 8992;
const FAN_PAYLOAD_HEADER = [0xe9, 0x00, 0x00, 0x00, 0x00];
const FAN_THRESHOLD_OFFSET = 0x2318;
const SHA256_K = new Uint32Array([
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1,
  0x923f82a4, 0xab1c5ed5, 0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3,
  0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174, 0xe49b69c1, 0xefbe4786,
  0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147,
  0x06ca6351, 0x14292967, 0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13,
  0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85, 0xa2bfe8a1, 0xa81a664b,
  0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a,
  0x5b9cca4f, 0x682e6ff3, 0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208,
  0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
]);

function sha256Fallback(bytes) {
  const bitLength = bytes.length * 8;
  const paddedLength = Math.ceil((bytes.length + 9) / 64) * 64;
  const message = new Uint8Array(paddedLength);
  message.set(bytes);
  message[bytes.length] = 0x80;
  const view = new DataView(message.buffer);
  view.setUint32(paddedLength - 8, Math.floor(bitLength / 0x100000000), false);
  view.setUint32(paddedLength - 4, bitLength >>> 0, false);

  const hash = new Uint32Array([
    0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a,
    0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19,
  ]);
  const words = new Uint32Array(64);
  const rotateRight = (value, count) =>
    (value >>> count) | (value << (32 - count));

  for (let offset = 0; offset < paddedLength; offset += 64) {
    for (let i = 0; i < 16; i++) words[i] = view.getUint32(offset + i * 4, false);
    for (let i = 16; i < 64; i++) {
      const x = words[i - 15], y = words[i - 2];
      const s0 = rotateRight(x, 7) ^ rotateRight(x, 18) ^ (x >>> 3);
      const s1 = rotateRight(y, 17) ^ rotateRight(y, 19) ^ (y >>> 10);
      words[i] = (words[i - 16] + s0 + words[i - 7] + s1) >>> 0;
    }

    let a = hash[0], b = hash[1], c = hash[2], d = hash[3];
    let e = hash[4], f = hash[5], g = hash[6], h = hash[7];
    for (let i = 0; i < 64; i++) {
      const sum1 = rotateRight(e, 6) ^ rotateRight(e, 11) ^ rotateRight(e, 25);
      const choose = (e & f) ^ (~e & g);
      const temp1 = (h + sum1 + choose + SHA256_K[i] + words[i]) >>> 0;
      const sum0 = rotateRight(a, 2) ^ rotateRight(a, 13) ^ rotateRight(a, 22);
      const majority = (a & b) ^ (a & c) ^ (b & c);
      const temp2 = (sum0 + majority) >>> 0;
      h = g; g = f; f = e; e = (d + temp1) >>> 0;
      d = c; c = b; b = a; a = (temp1 + temp2) >>> 0;
    }
    hash[0] = (hash[0] + a) >>> 0;
    hash[1] = (hash[1] + b) >>> 0;
    hash[2] = (hash[2] + c) >>> 0;
    hash[3] = (hash[3] + d) >>> 0;
    hash[4] = (hash[4] + e) >>> 0;
    hash[5] = (hash[5] + f) >>> 0;
    hash[6] = (hash[6] + g) >>> 0;
    hash[7] = (hash[7] + h) >>> 0;
  }
  return Array.from(hash, (word) => word.toString(16).padStart(8, "0")).join("");
}

export async function sha256Hex(bytes) {
  if (!(bytes instanceof Uint8Array)) {
    throw new TypeError("SHA-256 espera uma instância de Uint8Array.");
  }
  const subtle = globalThis.crypto && globalThis.crypto.subtle;
  if (subtle && typeof subtle.digest === "function") {
    try {
      const digest = await subtle.digest("SHA-256", bytes);
      return Array.from(new Uint8Array(digest), (value) =>
        value.toString(16).padStart(2, "0")
      ).join("");
    } catch (error) {
      // Fall back for older WebKit builds and non-secure HTTP origins.
    }
  }
  return sha256Fallback(bytes);
}

export function resolveFanThreshold(temperature) {
  const numericTemperature = Number(temperature);
  return FAN_THRESHOLD_OPTIONS.find(
    (option) => option.temperature === numericTemperature,
  ) || null;
}

export function validateFanPayload(bytes, temperature) {
  if (!(bytes instanceof Uint8Array)) {
    throw new TypeError("O arquivo Fan Threshold não retornou bytes válidos.");
  }
  if (bytes.byteLength !== FAN_PAYLOAD_SIZE) {
    throw new Error(
      "Tamanho inesperado do payload Fan Threshold: " + bytes.byteLength,
    );
  }
  if (!FAN_PAYLOAD_HEADER.every((value, index) => bytes[index] === value)) {
    throw new Error("Cabeçalho do payload Fan Threshold inválido.");
  }
  if (bytes[FAN_THRESHOLD_OFFSET] !== temperature) {
    throw new Error("O payload não corresponde ao limiar selecionado.");
  }
}

export async function sendFanThreshold(temperature, dependencies = {}) {
  const option = resolveFanThreshold(temperature);
  if (!option) {
    throw new RangeError("Limiar inválido. Escolha 60, 70, 80 ou 85 °C.");
  }

  const fetchImpl = dependencies.fetchImpl || globalThis.fetch;
  const XhrCtor = dependencies.XMLHttpRequestCtor || globalThis.XMLHttpRequest;
  const endpoint = dependencies.endpoint || FAN_THRESHOLD_ENDPOINT;
  const timeoutMs = dependencies.timeoutMs || 7000;
  const telemetry = dependencies.telemetry || dependencies.mark || null;

  function emitTelemetry(tag, detail) {
    if (typeof telemetry === "function") {
      telemetry(tag, detail);
    } else if (typeof globalThis.reportToolTelemetry === "function") {
      globalThis.reportToolTelemetry(tag, detail);
    } else if (typeof globalThis.mark === "function") {
      globalThis.mark(tag, detail);
    }
  }

  emitTelemetry("PAYLOAD-SELECTED", "kind=fan-threshold temp=" + option.temperature);

  if (typeof fetchImpl !== "function") {
    throw new Error("Fetch indisponível para carregar o payload Fan Threshold.");
  }
  if (typeof XhrCtor !== "function") {
    throw new Error("XMLHttpRequest indisponível para acessar o BinLoader.");
  }

  const response = await fetchImpl(option.path, { cache: "no-store" });
  if (!response || !response.ok) {
    const status = response ? response.status : "sem resposta";
    throw new Error("Falha ao carregar o payload Fan Threshold (HTTP " + status + ").");
  }

  const bytes = new Uint8Array(await response.arrayBuffer());
  emitTelemetry("PAYLOAD-DOWNLOADED", "kind=fan-threshold temp=" + option.temperature + " bytes=" + bytes.byteLength);

  validateFanPayload(bytes, option.temperature);
  const calculatedSha256 = await sha256Hex(bytes);
  if (calculatedSha256 !== option.sha256) {
    throw new Error(
      "SHA-256 divergente no payload Fan Threshold: calculado=" +
      calculatedSha256 + " esperado=" + option.sha256,
    );
  }
  emitTelemetry(
    "PAYLOAD-VALIDATED",
    "kind=fan-threshold temp=" + option.temperature +
      " validation=sha256-verified sha256=" + calculatedSha256,
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
        emitTelemetry("FAN-PAYLOAD-ACCEPTED", "status=" + request.status + " temp=" + option.temperature);
        // Note: FAN-THRESHOLD-OBSERVED represents target-confirmed thermal state alteration,
        // which cannot be proven solely by HTTP 200/202 from the BinLoader socket.
        resolve({
          state: "FAN-PAYLOAD-ACCEPTED",
          temperature: option.temperature,
          bytes: bytes.byteLength,
          httpStatus: request.status,
          targetConfirmed: false,
        });
      } else {
        fail("BinLoader respondeu HTTP " + request.status + ".");
      }
    };
    request.onerror = () => fail(
      "Não foi possível conectar ao BinLoader em 127.0.0.1:9090.",
    );
    request.ontimeout = () => fail(
      "Tempo esgotado ao enviar o payload ao BinLoader (porta 9090).",
    );

    try {
      emitTelemetry("FAN-PAYLOAD-SENT", "temp=" + option.temperature + " bytes=" + bytes.byteLength + " endpoint=" + endpoint);
      request.send(bytes.buffer);
    } catch (error) {
      fail(
        "Falha ao enviar o payload ao BinLoader: " +
        (error && error.message ? error.message : String(error)),
      );
    }
  });
}

export function getBinLoaderEndpoint(customIp) {
  const ip = customIp || (typeof localStorage !== "undefined" && localStorage.getItem("ps4_binloader_ip")) || "127.0.0.1";
  return "http://" + ip + ":9090/";
}

export function bindFanThresholdControls({ root, isSupported }) {
  if (!root) return;

  if (isSupported === false) {
    root.classList.add("is-hidden");
    return;
  }

  root.classList.remove("is-hidden");
  const status = root.querySelector("[data-fan-status]");
  const buttons = Array.from(root.querySelectorAll("[data-fan-threshold]"));
  const ipInput = root.querySelector("[data-fan-target-ip]") || document.querySelector("[data-binloader-target-ip]");
  let busy = false;

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
      "Requer HEN/GoldHEN carregado e BinLoader ativo na porta TCP 9090.";
  }

  for (const button of buttons) {
    button.addEventListener("click", async () => {
      if (busy) return;
      const temperature = Number(button.dataset.fanThreshold);
      busy = true;
      for (const item of buttons) item.disabled = true;
      if (status) {
        status.dataset.state = "loading";
        status.textContent =
          "Enviando payload Fan Threshold (" + temperature + " °C) ao BinLoader...";
      }

      const targetIp = (ipInput && ipInput.value.trim()) || (typeof localStorage !== "undefined" && localStorage.getItem("ps4_binloader_ip")) || "127.0.0.1";
      const customEndpoint = "http://" + targetIp + ":9090/";

      try {
        const result = await sendFanThreshold(temperature, { endpoint: customEndpoint });
        if (status) {
          status.dataset.state = "ok";
          status.textContent =
            "BinLoader aceitou o payload térmico de " + result.temperature +
            " °C (HTTP " + result.httpStatus + "). Aplicação no hardware requer verificação de temperatura no console.";
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
        busy = false;
        for (const item of buttons) item.disabled = false;
      }
    });
  }
}
