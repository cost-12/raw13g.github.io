import assert from "node:assert/strict";
import net from "node:net";
import { test } from "node:test";
import {
  buildVersionRequest,
  isPrivateIPv4,
  probePs4Debug,
  PS4DEBUG_CMD_VERSION,
  PS4DEBUG_MAGIC,
} from "../scripts/ps4debug-probe.mjs";

test("CMD_VERSION request uses the ps4debug-NG 12-byte little-endian header", () => {
  const packet = buildVersionRequest();
  assert.equal(packet.length, 12);
  assert.equal(packet.readUInt32LE(0), PS4DEBUG_MAGIC);
  assert.equal(packet.readUInt32LE(4), PS4DEBUG_CMD_VERSION);
  assert.equal(packet.readUInt32LE(8), 0);
});

test("PS4 target validator accepts only RFC1918 IPv4 addresses", () => {
  assert.equal(isPrivateIPv4("10.0.0.2"), true);
  assert.equal(isPrivateIPv4("172.16.0.2"), true);
  assert.equal(isPrivateIPv4("172.31.255.254"), true);
  assert.equal(isPrivateIPv4("192.168.1.20"), true);
  assert.equal(isPrivateIPv4("172.32.0.1"), false);
  assert.equal(isPrivateIPv4("127.0.0.1"), false);
  assert.equal(isPrivateIPv4("8.8.8.8"), false);
  assert.equal(isPrivateIPv4("::1"), false);
});

test("read-only CMD_VERSION probe confirms protocol version on a local fixture server", async () => {
  const server = net.createServer((socket) => {
    socket.once("data", (packet) => {
      assert.equal(packet.length, 12);
      assert.equal(packet.readUInt32LE(0), PS4DEBUG_MAGIC);
      assert.equal(packet.readUInt32LE(4), PS4DEBUG_CMD_VERSION);
      const version = Buffer.from("1.3", "ascii");
      const header = Buffer.alloc(4);
      header.writeUInt32LE(version.length, 0);
      socket.write(Buffer.concat([header, version]));
    });
  });

  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });

  try {
    const result = await probePs4Debug("127.0.0.1", {
      port: server.address().port,
      timeoutMs: 1000,
    });
    assert.deepEqual(result, {
      online: true,
      host: "127.0.0.1",
      port: server.address().port,
      protocolVersion: "1.3",
      command: "CMD_VERSION",
      readOnlyProbe: true,
    });
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test("CMD_VERSION probe rejects implausible response lengths", async () => {
  const server = net.createServer((socket) => {
    socket.once("data", () => {
      const header = Buffer.alloc(4);
      header.writeUInt32LE(500, 0);
      socket.write(header);
    });
  });

  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  try {
    await assert.rejects(
      probePs4Debug("127.0.0.1", {
        port: server.address().port,
        timeoutMs: 1000,
      }),
      /Comprimento CMD_VERSION inválido/,
    );
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});
