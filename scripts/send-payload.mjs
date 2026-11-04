#!/usr/bin/env node
/**
 * PS4 Network Payload Dispatcher (BinLoader Port 9090)
 *
 * Sends homebrew payloads (ps4debug-NG, Fan Thresholds, or custom .bin)
 * over raw TCP to a jailbroken PlayStation 4 running BinLoader.
 *
 * Usage:
 *   node scripts/send-payload.mjs <PS4-IP> <payload-alias-or-path> [--port <port>]
 *
 * Aliases:
 *   ps4debug | ps4debug-ng -> ps4debug-ng_v1.3.3.bin
 *   fan60                  -> ps4-fan-threshold60.bin (60 °C)
 *   fan70                  -> ps4-fan-threshold70.bin (70 °C)
 *   fan80                  -> ps4-fan-threshold80.bin (80 °C)
 *   fan85                  -> ps4-fan-threshold85.bin (85 °C)
 */

import net from "node:net";
import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT_DIR = path.resolve(__dirname, "..");

export const DEFAULT_BINLOADER_PORT = 9090;

export const PAYLOAD_ALIASES = Object.freeze({
  ps4debug: "includes/payloads/Tools/ps4debug-ng_v1.3.3.bin",
  "ps4debug-ng": "includes/payloads/Tools/ps4debug-ng_v1.3.3.bin",
  goldhen: "includes/payloads/GoldHEN/goldhen_v2.4b18.13.bin",
  goldhen13: "includes/payloads/GoldHEN/goldhen_v2.4b18.13.bin",
  goldhen12: "includes/payloads/GoldHEN/goldhen_v2.4b18.12.bin",
  fan60: "includes/payloads/Tools/fan-thresholds/ps4-fan-threshold60.bin",
  fan70: "includes/payloads/Tools/fan-thresholds/ps4-fan-threshold70.bin",
  fan80: "includes/payloads/Tools/fan-thresholds/ps4-fan-threshold80.bin",
  fan85: "includes/payloads/Tools/fan-thresholds/ps4-fan-threshold85.bin",
});

export function resolvePayloadPath(input) {
  if (PAYLOAD_ALIASES[input]) {
    return path.join(ROOT_DIR, PAYLOAD_ALIASES[input]);
  }
  if (path.isAbsolute(input)) {
    return input;
  }
  return path.resolve(process.cwd(), input);
}

export function isPrivateIPv4(address) {
  if (typeof address !== "string" || net.isIP(address) !== 4) return false;
  const [a, b] = address.split(".").map(Number);
  return (
    a === 10 ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    address === "127.0.0.1"
  );
}

export function sendPayloadToBinLoader(host, payloadBytes, options = {}) {
  const port = options.port || DEFAULT_BINLOADER_PORT;
  const timeoutMs = options.timeoutMs || 10000;
  const connectFn = options.connect || net.createConnection;

  if (!isPrivateIPv4(host)) {
    return Promise.reject(new TypeError(`Endereço IPv4 inválido ou público: ${host}`));
  }
  if (!Buffer.isBuffer(payloadBytes) && !(payloadBytes instanceof Uint8Array)) {
    return Promise.reject(new TypeError("Payload deve ser Buffer ou Uint8Array."));
  }

  const buffer = Buffer.from(payloadBytes);

  return new Promise((resolve, reject) => {
    let settled = false;
    const socket = connectFn({ host, port }, () => {
      socket.write(buffer, (err) => {
        if (err) {
          if (!settled) {
            settled = true;
            socket.destroy();
            reject(new Error(`Falha no envio dos bytes: ${err.message}`));
          }
          return;
        }
        if (!settled) {
          settled = true;
          socket.end();
          resolve({
            host,
            port,
            bytesSent: buffer.length,
            sha256: createHash("sha256").update(buffer).digest("hex"),
          });
        }
      });
    });

    socket.setTimeout(timeoutMs);
    socket.on("timeout", () => {
      if (!settled) {
        settled = true;
        socket.destroy();
        reject(new Error(`Tempo esgotado conectando a ${host}:${port}`));
      }
    });

    socket.on("error", (err) => {
      if (!settled) {
        settled = true;
        reject(new Error(`Erro de conexão com ${host}:${port}: ${err.message}`));
      }
    });
  });
}

async function main() {
  const args = process.argv.slice(2);
  if (args.length < 2) {
    console.log("Uso: node scripts/send-payload.mjs <IP-do-PS4> <payload-alias-ou-arquivo> [--port 9090]");
    console.log("\nAliases disponíveis:");
    for (const [alias, relPath] of Object.entries(PAYLOAD_ALIASES)) {
      console.log(`  ${alias.padEnd(14)} -> ${relPath}`);
    }
    process.exit(1);
  }

  const host = args[0];
  const payloadArg = args[1];
  let port = DEFAULT_BINLOADER_PORT;

  const portIdx = args.indexOf("--port");
  if (portIdx !== -1 && args[portIdx + 1]) {
    port = parseInt(args[portIdx + 1], 10);
  }

  const filePath = resolvePayloadPath(payloadArg);
  console.log(`[*] Carregando payload de: ${filePath}`);

  let bytes;
  try {
    bytes = await readFile(filePath);
  } catch (err) {
    console.error(`[-] Falha ao ler arquivo: ${err.message}`);
    process.exit(1);
  }

  const sha256 = createHash("sha256").update(bytes).digest("hex");
  console.log(`[*] Tamanho: ${bytes.length} bytes | SHA-256: ${sha256}`);
  console.log(`[*] Conectando a ${host}:${port} (BinLoader)...`);

  try {
    const res = await sendPayloadToBinLoader(host, bytes, { port });
    console.log(`[+] SUCESSO: ${res.bytesSent} bytes enviados para ${res.host}:${res.port}`);
    if (payloadArg.includes("ps4debug")) {
      console.log("[*] Para testar o depurador ps4debug-NG, execute:");
      console.log(`    node scripts/ps4debug-probe.mjs ${host}`);
    }
  } catch (err) {
    console.error(`[-] Erro no envio: ${err.message}`);
    process.exit(1);
  }
}

const isDirectCli = process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url));
if (isDirectCli) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}

