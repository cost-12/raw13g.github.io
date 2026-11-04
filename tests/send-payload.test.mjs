import assert from "node:assert/strict";
import net from "node:net";
import { test } from "node:test";
import {
  DEFAULT_BINLOADER_PORT,
  PAYLOAD_ALIASES,
  isPrivateIPv4,
  resolvePayloadPath,
  sendPayloadToBinLoader,
} from "../scripts/send-payload.mjs";

test("send-payload resolves aliases to valid relative project paths", () => {
  assert.equal(typeof PAYLOAD_ALIASES.ps4debug, "string");
  assert.equal(typeof PAYLOAD_ALIASES.fan60, "string");
  assert.equal(typeof PAYLOAD_ALIASES.goldhen13, "string");
  const resolved = resolvePayloadPath("ps4debug");
  assert.match(resolved, /ps4debug-ng_v1\.3\.3\.bin$/);
  const resolvedGh13 = resolvePayloadPath("goldhen13");
  assert.match(resolvedGh13, /goldhen_v2\.4b18\.13\.bin$/);
});

test("isPrivateIPv4 validates local network targets and loopback", () => {
  assert.equal(isPrivateIPv4("192.168.100.183"), true);
  assert.equal(isPrivateIPv4("10.0.0.1"), true);
  assert.equal(isPrivateIPv4("172.16.0.5"), true);
  assert.equal(isPrivateIPv4("127.0.0.1"), true);
  assert.equal(isPrivateIPv4("8.8.8.8"), false);
  assert.equal(isPrivateIPv4("not-an-ip"), false);
});

test("sendPayloadToBinLoader transmits bytes over mock TCP server", async () => {
  const mockServer = net.createServer();
  const receivedChunks = [];

  await new Promise((resolve) => mockServer.listen(0, "127.0.0.1", resolve));
  const port = mockServer.address().port;

  mockServer.on("connection", (socket) => {
    socket.on("data", (data) => receivedChunks.push(data));
  });

  const payload = Buffer.from([0xe9, 0x56, 0x22, 0x00, 0x00, 0xaa, 0xbb]);
  const result = await sendPayloadToBinLoader("127.0.0.1", payload, { port });

  assert.equal(result.bytesSent, payload.length);
  assert.equal(result.port, port);

  await new Promise((resolve) => setTimeout(resolve, 50));
  const received = Buffer.concat(receivedChunks);
  assert.deepEqual(received, payload);

  await new Promise((resolve) => mockServer.close(resolve));
});

