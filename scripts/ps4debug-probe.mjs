#!/usr/bin/env node
import net from "node:net";
import { pathToFileURL } from "node:url";

export const PS4DEBUG_MAGIC = 0xffaabbcc;
export const PS4DEBUG_CMD_VERSION = 0xbd000001;
export const PS4DEBUG_PORT = 744;
export const PS4DEBUG_VERSION_MAX_BYTES = 128;

export function buildVersionRequest() {
  const packet = Buffer.alloc(12);
  packet.writeUInt32LE(PS4DEBUG_MAGIC, 0);
  packet.writeUInt32LE(PS4DEBUG_CMD_VERSION, 4);
  packet.writeUInt32LE(0, 8);
  return packet;
}

export function isPrivateIPv4(address) {
  if (typeof address !== "string" || net.isIP(address) !== 4) return false;
  const [a, b] = address.split(".").map(Number);
  return a === 10 ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168);
}

/**
 * Performs only ps4debug's read-only CMD_VERSION handshake.
 * Port is injectable for isolated tests; the CLI always fixes it to 744.
 */
export function probePs4Debug(host, options = {}) {
  const port = options.port === undefined ? PS4DEBUG_PORT : options.port;
  const timeoutMs = options.timeoutMs === undefined ? 2500 : options.timeoutMs;
  const connect = options.connect || net.createConnection;

  if (typeof host !== "string" || net.isIP(host) !== 4) {
    return Promise.reject(new TypeError("Informe um endereço IPv4 válido para o PS4."));
  }
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    return Promise.reject(new RangeError("Porta TCP inválida."));
  }
  if (!Number.isInteger(timeoutMs) || timeoutMs < 100 || timeoutMs > 15000) {
    return Promise.reject(new RangeError("Timeout deve ficar entre 100 e 15000 ms."));
  }

  return new Promise((resolve, reject) => {
    const socket = connect({ host, port });
    let received = Buffer.alloc(0);
    let expectedLength = null;
    let settled = false;

    const finish = (error, result) => {
      if (settled) return;
      settled = true;
      socket.destroy();
      if (error) reject(error);
      else resolve(result);
    };

    socket.setTimeout(timeoutMs, () => {
      finish(new Error("Timeout ao consultar CMD_VERSION em TCP " + port + "."));
    });
    socket.once("error", (error) => {
      finish(new Error("TCP " + port + " indisponível: " + error.message));
    });
    socket.once("close", () => {
      if (!settled) finish(new Error("Conexão encerrada antes da resposta CMD_VERSION."));
    });
    socket.once("connect", () => socket.write(buildVersionRequest()));

    socket.on("data", (chunk) => {
      if (settled) return;
      received = Buffer.concat([received, chunk]);
      if (received.length > PS4DEBUG_VERSION_MAX_BYTES + 4) {
        finish(new Error("Resposta CMD_VERSION excedeu o limite esperado."));
        return;
      }
      if (expectedLength === null && received.length >= 4) {
        expectedLength = received.readUInt32LE(0);
        if (expectedLength < 1 || expectedLength > PS4DEBUG_VERSION_MAX_BYTES) {
          finish(new Error("Comprimento CMD_VERSION inválido: " + expectedLength));
          return;
        }
      }
      if (expectedLength !== null && received.length >= expectedLength + 4) {
        const version = received.subarray(4, 4 + expectedLength).toString("utf8");
        if (!/^[0-9]+\.[0-9]+$/.test(version)) {
          finish(new Error("Resposta CMD_VERSION não corresponde ao formato esperado."));
          return;
        }
        finish(null, {
          online: true,
          host,
          port,
          protocolVersion: version,
          command: "CMD_VERSION",
          readOnlyProbe: true,
        });
      }
    });
  });
}

async function main(argv = process.argv.slice(2)) {
  if (argv.length !== 1 || argv[0] === "--help" || argv[0] === "-h") {
    console.log("Uso: node scripts/ps4debug-probe.mjs <IP-privado-do-PS4>");
    console.log("Consulta somente CMD_VERSION no TCP 744; não lê nem altera memória.");
    return argv.length === 1 ? 0 : 2;
  }
  const host = argv[0];
  if (!isPrivateIPv4(host)) {
    console.error("Por segurança, informe somente um IPv4 privado (10/8, 172.16/12 ou 192.168/16).");
    return 2;
  }
  try {
    const result = await probePs4Debug(host, { port: PS4DEBUG_PORT });
    console.log(JSON.stringify(result, null, 2));
    return 0;
  } catch (error) {
    console.error(error.message);
    return 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().then((code) => {
    process.exitCode = code;
  }).catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
