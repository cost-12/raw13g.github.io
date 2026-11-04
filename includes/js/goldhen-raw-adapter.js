import { sha256Hex } from "./fan-threshold.js";

export const GOLDHEN_1400_RAW = Object.freeze({
  firmware: "14.00",
  version: "2.4b18.13",
  path: "includes/payloads/GoldHEN/goldhen_v2.4b18.13.bin",
  bytes: 297496,
  sha256: "39452f5e1c305ac9efcb4745eef7958b4db8c6d85299529f08700970b009ea4d",
  header: Object.freeze([0xe9, 0xa6, 0x16, 0x00, 0x00]),
});

export const GOLDHEN_1400_PATCHSET = Object.freeze({
  path: "includes/payloads/GoldHEN/patchset-1400.bin",
  bytes: 641,
  terminalByte: 0xc3,
  requiredKernelSites: 57,
});

/**
 * Phase B preflight only. This module intentionally does not map, dispatch,
 * create a thread, or change kernel memory. The raw GoldHEN image is not
 * launchable on FW14 until the firmware-specific patchset and a canonical
 * readback audit for all 57 patch sites are independently available.
 */
export async function preflightGoldHENRaw(dependencies = {}) {
  const fetchImpl = dependencies.fetchImpl || globalThis.fetch;
  const telemetry = dependencies.telemetry || dependencies.mark || null;

  const emit = (tag, detail) => {
    if (typeof telemetry === "function") telemetry(tag, detail);
    else if (typeof globalThis.reportToolTelemetry === "function") globalThis.reportToolTelemetry(tag, detail);
    else if (typeof globalThis.mark === "function") globalThis.mark(tag, detail);
  };

  const blocked = (reason, fields = {}) => {
    emit(
      "GOLDHEN-DISPATCH-BLOCKED",
      "firmware=14.00 version=2.4b18.13 reason=" + reason +
        " verifiedKernelSites=0",
    );
    return {
      kind: "goldhen-raw-preflight",
      firmware: GOLDHEN_1400_RAW.firmware,
      version: GOLDHEN_1400_RAW.version,
      dispatchAllowed: false,
      status: "blocked",
      reason,
      requiredKernelSites: GOLDHEN_1400_PATCHSET.requiredKernelSites,
      verifiedKernelSites: 0,
      ...fields,
    };
  };

  if (typeof fetchImpl !== "function") {
    return blocked("fetch-unavailable");
  }

  emit(
    "PAYLOAD-SELECTED",
    "flavor=GoldHEN version=" + GOLDHEN_1400_RAW.version +
      " firmware=" + GOLDHEN_1400_RAW.firmware +
      " asset=" + GOLDHEN_1400_RAW.path,
  );

  let payloadResponse;
  try {
    payloadResponse = await fetchImpl(GOLDHEN_1400_RAW.path, { cache: "no-store" });
  } catch (error) {
    return blocked("payload-fetch-failed", {
      detail: error && error.message ? error.message : String(error),
    });
  }

  if (!payloadResponse || !payloadResponse.ok) {
    return blocked("payload-http-error", {
      httpStatus: payloadResponse ? Number(payloadResponse.status) || 0 : 0,
    });
  }

  let payloadBytes;
  try {
    payloadBytes = new Uint8Array(await payloadResponse.arrayBuffer());
  } catch (error) {
    return blocked("payload-read-failed", {
      detail: error && error.message ? error.message : String(error),
    });
  }

  emit(
    "PAYLOAD-DOWNLOADED",
    "flavor=GoldHEN version=" + GOLDHEN_1400_RAW.version +
      " bytes=" + payloadBytes.byteLength,
  );

  if (payloadBytes.byteLength !== GOLDHEN_1400_RAW.bytes) {
    return blocked("payload-size-mismatch", {
      actualBytes: payloadBytes.byteLength,
      expectedBytes: GOLDHEN_1400_RAW.bytes,
    });
  }

  if (!GOLDHEN_1400_RAW.header.every((value, index) => payloadBytes[index] === value)) {
    return blocked("payload-header-mismatch");
  }

  let payloadSha256;
  try {
    payloadSha256 = await sha256Hex(payloadBytes);
  } catch (error) {
    return blocked("payload-digest-unavailable", {
      detail: error && error.message ? error.message : String(error),
    });
  }

  if (payloadSha256 !== GOLDHEN_1400_RAW.sha256) {
    return blocked("payload-digest-mismatch", {
      actualSha256: payloadSha256,
      expectedSha256: GOLDHEN_1400_RAW.sha256,
    });
  }

  emit(
    "PAYLOAD-VALIDATED",
    "flavor=GoldHEN version=" + GOLDHEN_1400_RAW.version +
      " validation=size-header-sha256",
  );

  let patchsetResponse;
  try {
    patchsetResponse = await fetchImpl(GOLDHEN_1400_PATCHSET.path, { cache: "no-store" });
  } catch (error) {
    return blocked("patchset-fetch-failed", {
      payloadVerified: true,
      detail: error && error.message ? error.message : String(error),
    });
  }

  if (!patchsetResponse || !patchsetResponse.ok) {
    return blocked("firmware-patchset-missing", {
      payloadVerified: true,
      patchsetPath: GOLDHEN_1400_PATCHSET.path,
      patchsetHttpStatus: patchsetResponse ? Number(patchsetResponse.status) || 0 : 0,
    });
  }

  let patchsetBytes;
  try {
    patchsetBytes = new Uint8Array(await patchsetResponse.arrayBuffer());
  } catch (error) {
    return blocked("patchset-read-failed", {
      payloadVerified: true,
      detail: error && error.message ? error.message : String(error),
    });
  }

  if (
    patchsetBytes.byteLength !== GOLDHEN_1400_PATCHSET.bytes ||
    patchsetBytes[patchsetBytes.length - 1] !== GOLDHEN_1400_PATCHSET.terminalByte
  ) {
    return blocked("patchset-shape-mismatch", {
      payloadVerified: true,
      patchsetBytes: patchsetBytes.byteLength,
      expectedPatchsetBytes: GOLDHEN_1400_PATCHSET.bytes,
      terminalByte: patchsetBytes.length ? patchsetBytes[patchsetBytes.length - 1] : null,
    });
  }

  emit(
    "GOLDHEN-PATCHSET-VALIDATED",
    "bytes=" + patchsetBytes.byteLength + " shape=641-byte-ret",
  );

  // Presence and shape are not proof that the 57 target sites were patched.
  // The canonical per-site before/after manifest and target-side readback
  // verifier have not yet been integrated, so launch remains disabled.
  emit(
    "GOLDHEN-57-SITE-AUDIT-BLOCKED",
    "required=57 verified=0 source=canonical-manifest-missing",
  );
  return blocked("canonical-57-site-readback-audit-missing", {
    payloadVerified: true,
    patchsetShapeVerified: true,
    patchsetBytes: patchsetBytes.byteLength,
    requiredKernelSites: GOLDHEN_1400_PATCHSET.requiredKernelSites,
    verifiedKernelSites: 0,
  });
}
