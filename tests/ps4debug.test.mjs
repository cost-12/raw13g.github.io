import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import {
  PS4DEBUG_NG,
  sendPs4DebugPayload,
  validatePs4DebugPayload,
} from "../includes/js/ps4debug-ng.js";

function response(bytes) {
  const buffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
  return { ok: true, status: 200, arrayBuffer: async () => buffer };
}

class FakeXhr {
  constructor(status = 202) {
    this.status = status;
    this.sent = null;
    FakeXhr.instances.push(this);
  }
  open(method, url, async) {
    this.method = method;
    this.url = url;
    this.async = async;
  }
  send(body) {
    this.sent = body;
    queueMicrotask(() => this.onload());
  }
}
FakeXhr.instances = [];

test("ps4debug-NG release binary matches pinned size, header and SHA-256", async () => {
  const bytes = new Uint8Array(await readFile(
    new URL("../includes/payloads/Tools/ps4debug-ng_v1.3.3.bin", import.meta.url)
  ));
  const result = await validatePs4DebugPayload(bytes);
  assert.equal(result.bytes, 3175432);
  assert.equal(result.sha256, PS4DEBUG_NG.sha256);
});

test("ps4debug-NG sender validates then records SENT and ACCEPTED separately", async () => {
  const bytes = new Uint8Array(await readFile(
    new URL("../includes/payloads/Tools/ps4debug-ng_v1.3.3.bin", import.meta.url)
  ));
  FakeXhr.instances.length = 0;
  const events = [];
  const result = await sendPs4DebugPayload({
    fetchImpl: async (url) => {
      assert.equal(url, PS4DEBUG_NG.path);
      return response(bytes);
    },
    XMLHttpRequestCtor: FakeXhr,
    endpoint: "http://127.0.0.1:9090/",
    telemetry: (tag, detail) => events.push({ tag, detail }),
  });

  assert.equal(result.state, "PS4DEBUG-PAYLOAD-ACCEPTED");
  assert.equal(result.httpStatus, 202);
  assert.equal(result.serverObserved, false);
  assert.equal(result.debuggerPort, 744);
  assert.deepEqual(
    events.map((event) => event.tag),
    [
      "PS4DEBUG-PAYLOAD-SELECTED",
      "PS4DEBUG-PAYLOAD-DOWNLOADED",
      "PS4DEBUG-PAYLOAD-VALIDATED",
      "PS4DEBUG-PAYLOAD-SENT",
      "PS4DEBUG-PAYLOAD-ACCEPTED",
    ],
  );

  const request = FakeXhr.instances[0];
  assert.equal(request.method, "POST");
  assert.equal(request.url, "http://127.0.0.1:9090/");
  assert.equal(request.sent.byteLength, PS4DEBUG_NG.bytes);
});

test("ps4debug-NG rejects a corrupt binary before contacting BinLoader", async () => {
  const bytes = new Uint8Array(await readFile(
    new URL("../includes/payloads/Tools/ps4debug-ng_v1.3.3.bin", import.meta.url)
  ));
  bytes[100] ^= 0xff;
  let contacted = false;
  class ContactTrackingXhr extends FakeXhr {
    constructor() {
      super();
      contacted = true;
    }
  }

  await assert.rejects(
    sendPs4DebugPayload({
      fetchImpl: async () => response(bytes),
      XMLHttpRequestCtor: ContactTrackingXhr,
    }),
    /SHA-256 divergente/,
  );
  assert.equal(contacted, false);
});

test("ps4debug sender never reports TCP 744 as observed after HTTP acceptance", async () => {
  const source = await readFile(
    new URL("../includes/js/ps4debug-ng.js", import.meta.url),
    "utf8",
  );
  assert.match(source, /serverObserved: false/);
  assert.doesNotMatch(source, /WebSocket|WebSocketStream/);
  assert.match(source, /PS4DEBUG-PAYLOAD-ACCEPTED/);
});
