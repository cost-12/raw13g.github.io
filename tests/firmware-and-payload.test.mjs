import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { access, readFile } from "node:fs/promises";
import { test } from "node:test";

import { detectFw } from "../includes/js/checkFw.js";
import {
  DEFAULT_GH_VER,
  DEFAULT_GOLDHEN_CONFIG,
  formatGoldHENIni,
  getGoldHENConfig,
  getJbFlavor,
  isGoldHENSupported,
  resolvePayload,
  setGoldHENConfig,
  setGoldHENVer,
} from "../includes/js/HENs.js";
import { offsetsFor, PS4, validateOffsets } from "../includes/js/ps4_offsets.js";

class MemoryStorage {
  constructor(initial = {}) {
    this.values = new Map(Object.entries(initial));
  }

  getItem(key) {
    return this.values.has(key) ? this.values.get(key) : null;
  }

  setItem(key, value) {
    this.values.set(key, String(value));
  }

  removeItem(key) {
    this.values.delete(key);
  }
}

test("firmware parser normalizes supported PlayStation versions", () => {
  const result = detectFw("Mozilla/5.0 (PlayStation 4/13.52) AppleWebKit/605.1.15");
  assert.equal(result.isPs4, true);
  assert.equal(result.fwKey, "13.52");
  assert.equal(result.supported, true);

  const unsupported = detectFw("Mozilla/5.0 (PlayStation 4/15.00)");
  assert.equal(unsupported.fwKey, "15.00");
  assert.equal(unsupported.supported, false);

  const desktop = detectFw("Mozilla/5.0 (Windows NT 10.0; Win64; x64)");
  assert.equal(desktop.isPs4, false);
  assert.equal(desktop.platform, "Windows");
});

test("payload selection respects firmware support and resolves existing files", async () => {
  const previousLocalStorage = globalThis.localStorage;
  const previousSessionStorage = globalThis.sessionStorage;
  const hadLocalStorage = Object.hasOwn(globalThis, "localStorage");
  const hadSessionStorage = Object.hasOwn(globalThis, "sessionStorage");

  globalThis.localStorage = new MemoryStorage({ jailbreakFlavor: "GoldHEN" });
  globalThis.sessionStorage = new MemoryStorage();
  try {
    assert.equal(isGoldHENSupported("13.00"), true);
    assert.equal(isGoldHENSupported("13.02"), false);
    assert.equal(getJbFlavor("14.00"), "HEN");

    const goldhen = resolvePayload("11.00");
    assert.equal(goldhen.flavor, "GoldHEN");
    assert.match(goldhen.path, /goldhen_v2\.4b18\.12\.bin$/);
    await access(new URL(`../${goldhen.path}`, import.meta.url));

    setGoldHENVer("missing-version");
    assert.match(resolvePayload("11.00").path, /goldhen_v2\.4b18\.12\.bin$/);

    const hen = resolvePayload("14.00");
    assert.equal(hen.flavor, "HEN");
    assert.equal(hen.path, "includes/payloads/HEN/hen.bin");
    assert.equal(hen.name, "HEN 14.00 (HX/BD-J image)");
    await access(new URL(`../${hen.path}`, import.meta.url));
    assert.equal(globalThis.sessionStorage.getItem("payload_path"), hen.path);
  } finally {
    if (hadLocalStorage) globalThis.localStorage = previousLocalStorage;
    else delete globalThis.localStorage;
    if (hadSessionStorage) globalThis.sessionStorage = previousSessionStorage;
    else delete globalThis.sessionStorage;
  }
});

test("FW14 HEN selection is pinned to the HX-only image, not the legacy PS4HEN blob", async () => {
  const selected = resolvePayload("14.00");
  assert.equal(selected.flavor, "HEN");
  assert.equal(selected.path, "includes/payloads/HEN/hen.bin");

  const bytes = await readFile(new URL("../includes/payloads/HEN/hen.bin", import.meta.url));
  assert.equal(bytes.length, 562240);
  const henHash = createHash("sha256").update(bytes).digest("hex");
  assert.ok(
    henHash === "f83d3a68c8a5d38f3544e3102bf04b13d357d766e7101ffee4b9d37ee60695d6" ||
    henHash === "756077919fd59abd0eb3ae7b96b6295349b2a0a1b6a7d5c99b3c6898c4abe753"
  );

  const legacy = await readFile(new URL("../includes/payloads/HEN/payload2.bin", import.meta.url));
  assert.equal(legacy.length, 500544);
  assert.notEqual(bytes.length, legacy.length);
  assert.equal(isGoldHENSupported("14.00"), false);
});

test("GoldHEN 2.4b18.13 stays staged while FW14 resolves the HEN image", async () => {
  const goldhenPath = "includes/payloads/GoldHEN/goldhen_v2.4b18.13.bin";
  const goldhenBytes = await readFile(new URL(`../${goldhenPath}`, import.meta.url));
  assert.equal(goldhenBytes.length, 297496);
  assert.equal(
    createHash("sha256").update(goldhenBytes).digest("hex"),
    "39452f5e1c305ac9efcb4745eef7958b4db8c6d85299529f08700970b009ea4d"
  );

  const selector = await readFile(new URL("../includes/js/HENs.js", import.meta.url), "utf8");
  const manifest = await readFile(new URL("../cache.appcache", import.meta.url), "utf8");
  assert.doesNotMatch(selector, /DEFAULT_GH_VER\s*=\s*"GHv2\.4b18\.13"/);
  assert.match(selector, /id:\s*"GHv2\.4b18\.13"/);
  // The staged raw image is cached for offline preflight and <= 13.00 selection.
  assert.match(manifest, /goldhen_v2\.4b18\.13\.bin/);

  const previousLocalStorage = globalThis.localStorage;
  const previousSessionStorage = globalThis.sessionStorage;
  const hadLocalStorage = Object.hasOwn(globalThis, "localStorage");
  const hadSessionStorage = Object.hasOwn(globalThis, "sessionStorage");

  globalThis.localStorage = new MemoryStorage({ jailbreakFlavor: "GoldHEN", GHVer: "GHv2.4b18.13" });
  globalThis.sessionStorage = new MemoryStorage();
  try {
    const selected = resolvePayload("14.00", "GoldHEN");
    assert.equal(selected.flavor, "HEN");
    assert.equal(selected.path, "includes/payloads/HEN/hen.bin");

    // On FW <= 13.00, selecting .13 resolves to goldhen_v2.4b18.13.bin
    const resolved13 = resolvePayload("11.00", "GoldHEN");
    assert.equal(resolved13.flavor, "GoldHEN");
    assert.equal(resolved13.path, "includes/payloads/GoldHEN/goldhen_v2.4b18.13.bin");
    await access(new URL(`../${resolved13.path}`, import.meta.url));
  } finally {
    if (hadLocalStorage) globalThis.localStorage = previousLocalStorage;
    else delete globalThis.localStorage;
    if (hadSessionStorage) globalThis.sessionStorage = previousSessionStorage;
    else delete globalThis.sessionStorage;
  }
});

test("runtime payload selection cannot override firmware compatibility", async () => {
  const previousLocalStorage = globalThis.localStorage;
  const previousSessionStorage = globalThis.sessionStorage;
  const hadLocalStorage = Object.hasOwn(globalThis, "localStorage");
  const hadSessionStorage = Object.hasOwn(globalThis, "sessionStorage");

  globalThis.localStorage = new MemoryStorage({ jailbreakFlavor: "GoldHEN" });
  globalThis.sessionStorage = new MemoryStorage({
    payload_path: "includes/payloads/GoldHEN/goldhen_v2.4b18.12.bin",
  });
  try {
    const forcedGoldHEN = resolvePayload("14.00", "GoldHEN");
    assert.equal(forcedGoldHEN.flavor, "HEN");
    assert.equal(forcedGoldHEN.path, "includes/payloads/HEN/hen.bin");
    assert.equal(
      globalThis.sessionStorage.getItem("payload_path"),
      "includes/payloads/HEN/hen.bin"
    );
    await access(new URL(`../${forcedGoldHEN.path}`, import.meta.url));

    const requestedHEN = resolvePayload("11.00", "HEN");
    assert.equal(requestedHEN.flavor, "HEN");
    assert.equal(requestedHEN.path, "includes/payloads/HEN/payload2.bin");

    const requestedGoldHEN = resolvePayload("11.00", "GoldHEN");
    assert.equal(requestedGoldHEN.flavor, "GoldHEN");
    assert.match(requestedGoldHEN.path, /goldhen_v2\.4b18\.12\.bin$/);
    await access(new URL(`../${requestedGoldHEN.path}`, import.meta.url));
  } finally {
    if (hadLocalStorage) globalThis.localStorage = previousLocalStorage;
    else delete globalThis.localStorage;
    if (hadSessionStorage) globalThis.sessionStorage = previousSessionStorage;
    else delete globalThis.sessionStorage;
  }
});

test("jailbreak runner uses the firmware-aware payload resolver", async () => {
  const source = await readFile(
    new URL("../includes/js/jb.js", import.meta.url),
    "utf8"
  );
  assert.match(source, /HENs\.js\?v=hen14-only-1/);
  assert.match(
    source,
    /resolvePayload\(fwKey, params\.get\("flavor"\)\)/
  );
  assert.doesNotMatch(source, /params\.get\("payload_path"\)/);
  assert.doesNotMatch(source, /sessionStorage\.getItem\("payload_path"\)/);
});

test("HX1400 route is gated to 14.00 and hands KBASE to the kevent chain", async () => {
  const [runner, mem, core, route, kevent, manifest] = await Promise.all([
    readFile(new URL("../includes/js/jb.js", import.meta.url), "utf8"),
    readFile(new URL("../includes/js/mem.js", import.meta.url), "utf8"),
    readFile(new URL("../includes/js/core.js", import.meta.url), "utf8"),
    readFile(new URL("../includes/js/hx1400_port.js", import.meta.url), "utf8"),
    readFile(new URL("../includes/js/hx_kevent.js", import.meta.url), "utf8"),
    readFile(new URL("../cache.appcache", import.meta.url), "utf8"),
  ]);

  assert.match(runner, /HX1400_REQUESTED = params\.get\("hx1400"\) === "1"/);
  assert.match(runner, /HX1400_MODE = HX1400_REQUESTED && fwKey === "14\.00"/);
  assert.match(runner, /HX1400-ROUTE-ELIGIBILITY/);
  assert.match(runner, /LEGACY-KERNEL-TABLE-SKIPPED/);
  assert.match(runner, /LEGACY-KPATCH-TABLE-SKIPPED/);
  assert.match(runner, /LEGACY-PAYLOAD-TABLE-SKIPPED/);
  assert.equal(runner.includes("!kernelSupported || missing.length === 0"), false);
  assert.equal(runner.includes("!kernelSupported || !DO_PATCH"), false);
  assert.equal(runner.includes("!kernelSupported || !DO_PAYLOAD"), false);
  assert.match(runner, /PRIMITIVE-HANDOFF/);
  assert.match(runner, /NATIVE-FUNCTION-LOOKUP-START/);
  assert.match(runner, /WEBKIT-BASE-RESOLVED/);
  assert.match(runner, /LIBKERNEL-ELF-SCAN-START/);
  assert.match(runner, /SYSCALL-STUBS-READY/);
  assert.match(runner, /HX1400-POST-PRIMITIVE-GATE/);
  assert.match(runner, /requestedMemProfile === "1"/);
  assert.match(runner, /groomOverrides: groomSettings/);
  assert.match(runner, /GROOM-PROFILE/);
  assert.match(runner, /import\("\.\/hx1400_port\.js\?v=hx1400-1"\)/);
  assert.match(runner, /import\("\.\/hx_kevent\.js\?v=hx1400-hen-only-1"\)/);
  assert.ok(runner.indexOf("await routeModule.runHx1400(hxContext)") <
    runner.indexOf("await chainModule.runKevent({ ...hxContext, kbase })"));
  assert.match(route, /globalThis\.__HX_KBASE = kbase/);
  assert.match(kevent, /export async function runKevent\(c\)/);
  assert.match(kevent, /c\.fetchFile\("hen\.bin"\)/);
  assert.match(kevent, /params\.get\("hen-direct"\)/);
  assert.match(kevent, /henArtifactsObserved:\s*newArtifacts\.length > 0/);
  assert.match(kevent, /henArtifactsObserved:\s*newlyObserved\.size > 0/);
  assert.doesNotMatch(kevent, /henObserved:/);
  assert.match(kevent, /henReady:\s*false/g);
  assert.match(kevent, /independentTargetAttestation:\s*false/g);
  assert.doesNotMatch(kevent, /cole-goldhen-disc-v1\.bin|cole-compatibility-audit-v1\.bin/);
  assert.match(runner, /payloadRunning = false/);
  assert.match(runner, /const henReadyClaim = hxResult\.henReady === true/);
  assert.doesNotMatch(runner, /payloadRunning\s*=\s*hxResult/);
  assert.match(runner, /HX1400-KERNEL-COMPLETE/);
  assert.match(runner, /HEN-READINESS-UNVERIFIED/);
  assert.doesNotMatch(runner, /payloadRunning = hxResult\.launchAccepted/);
  assert.match(runner, /path === "hen\.bin" \? PAYLOAD_FILE : path/);
  assert.match(runner, /resolvedPath !== "includes\/payloads\/HEN\/hen\.bin"/);
  assert.match(runner, /resolvedPath !== "includes\/payloads\/HEN\/hen\.bin"/);

  // The staged GoldHEN raw image may be cached, but the FW14 selector stays HEN-only.
  assert.match(manifest, /goldhen_v2\.4b18\.13\.bin/);
  assert.match(manifest, /includes\/js\/HENs\.js\?v=hen14-only-1/);
  assert.match(runner, /from "\.\/core\.js\?v=16"/);
  assert.match(mem, /from "\.\/core\.js\?v=16"/);

  // Preserve RAW13G's local memory-stability changes while integrating HX.
  assert.match(core, /ADDROF-REFRESHED/);
  assert.match(runner, /CANDIDATE/);
  assert.match(core, /deferred-post-holes/);
  assert.ok(core.indexOf("history.replaceState(outerGraph") >
    core.indexOf("stage = \"holes\""));

  // AppCache must include every dynamically imported module and the HEN image.
  for (const asset of [
    "includes/js/hx1400_port.js?v=hx1400-1",
    "includes/js/hx_kevent.js?v=hx1400-hen-only-1",
    "includes/js/hx_tables.js?v=hx1400-1",
    "includes/payloads/HEN/hen.bin",
  ]) {
    assert.ok(manifest.includes(asset), `missing offline asset: ${asset}`);
  }

  await access(new URL("../includes/js/hx1400_port.js", import.meta.url));
  await access(new URL("../includes/js/hx_kevent.js", import.meta.url));
  await access(new URL("../includes/js/hx_tables.js", import.meta.url));
  await access(new URL("../includes/payloads/HEN/hen.bin", import.meta.url));
});

test("14.00 homepage launch keeps its firmware groom profile and enables HX1400", async () => {
  const index = await readFile(new URL("../index.html", import.meta.url), "utf8");

  assert.match(index, /const isHx1400 = fwKey === "14\.00"/);
  assert.match(index, /launchUrl\.searchParams\.set\("hx1400", "1"\)/);
  assert.match(index, /launchUrl\.searchParams\.set\("mem", "1"\)/);
  for (const stage of [3, 4, 5, 6, 7, 8, 9, 10]) {
    assert.match(index, new RegExp("stage" + stage + ': "1"'));
  }
  assert.match(index, /"hen-direct": "1"/);
  assert.doesNotMatch(index, /goldhen: "1"/);
  assert.match(index, /GoldHEN 2\.4b18\.13 não é carregado nesta etapa/);
  assert.match(index, /!isHx1400 && !target\.includes\("slots="/);
  assert.match(index, /!isHx1400 && !target\.includes\("attempts="/);
  assert.match(index, /hen\.bin, 562\.240 bytes/);
});

test("offset lookup uses firmware keys and reports missing tables", () => {
  const result = offsetsFor("Mozilla/5.0 (PlayStation 4/14.00)");
  assert.equal(result.key, "14.00");
  assert.equal(result.off, PS4["14.00"]);
  assert.equal(validateOffsets(result.off, result.key).ok, true);
  assert.equal(result.off.alias_of, "13.52-webkit");
  assert.equal(result.off.stage1_only, true);
  assert.equal(result.off.kernel_supported, false);
  assert.match(result.off.fw_status, /reference-from-Sentrix-capture/);
  assert.match(result.off.fw_status, /local-HW-validation=not-attested/);
  assert.equal(result.off.k_sysent_661, undefined);
  assert.equal(result.off.k_jmp_rsi, undefined);
  assert.equal(result.off.groom.slots, 9100000);
  assert.equal(result.off.groom.drain, 48);
  assert.equal(result.off.groom.attempts, 3);
  assert.equal(result.off.groomProfiles.mem1.profile, "silverps4hen-mem1");
  assert.equal(result.off.groomProfiles.mem1.slots, 8700000);
  assert.equal(result.off.groomProfiles.mem1.attempts, 4);
  assert.equal(result.off.groomProfiles.mem1.drain, 96);
  assert.equal(result.off.groomProfiles.mem1.drainsz, 0x8000);
  assert.equal(result.off.groomProfiles.mem1.slab, 0x300000);
  assert.equal(result.off.groomProfiles.mem1.bfly, 0x60000);
  assert.equal(result.off.groomProfiles.mem1.sep, 0x8000);
  assert.equal(result.off.groomProfiles.mem1.early, 0x60000);
  assert.equal(result.off.groomProfiles.mem1.guard, 0x70000);
  assert.equal(result.off.groomProfiles.mem1.pred, 0x60000);
  assert.equal(result.off.groomProfiles.mem1.final, 0x60000);

  assert.deepEqual(offsetsFor("Mozilla/5.0 (Windows NT 10.0)"), {
    key: null,
    off: null,
  });
  assert.equal(validateOffsets("15.00").ok, false);
});

test("GoldHEN configuration manager persists settings and formats config.ini", () => {
  const origLocal = globalThis.localStorage;
  const store = new MemoryStorage();
  Object.defineProperty(globalThis, "localStorage", {
    value: store,
    configurable: true,
    writable: true,
  });

  try {
    const defaultConfig = getGoldHENConfig();
    assert.deepEqual(defaultConfig, {
      aioFix: true,
      gamePatch: true,
      pluginLoader: true,
    });

    const defaultIni = formatGoldHENIni(defaultConfig);
    assert.match(defaultIni, /\[GoldHEN\]/);
    assert.match(defaultIni, /AIO_Fix_Enabled = 1/);
    assert.match(defaultIni, /Game_Patch_Enabled = 1/);
    assert.match(defaultIni, /Plugin_Loader_Enabled = 1/);

    setGoldHENConfig({ aioFix: false, gamePatch: true, pluginLoader: false });
    const updatedConfig = getGoldHENConfig();
    assert.equal(updatedConfig.aioFix, false);
    assert.equal(updatedConfig.gamePatch, true);
    assert.equal(updatedConfig.pluginLoader, false);

    const updatedIni = formatGoldHENIni(updatedConfig);
    assert.match(updatedIni, /AIO_Fix_Enabled = 0/);
    assert.match(updatedIni, /Game_Patch_Enabled = 1/);
    assert.match(updatedIni, /Plugin_Loader_Enabled = 0/);
  } finally {
    if (origLocal) {
      Object.defineProperty(globalThis, "localStorage", {
        value: origLocal,
        configurable: true,
        writable: true,
      });
    } else {
      delete globalThis.localStorage;
    }
  }
});
