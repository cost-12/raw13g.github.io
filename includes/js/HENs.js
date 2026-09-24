// RAW GAME - Payload & Jailbreak Flavor Manager
// Inspired by WebKitty methods with enhanced firmware awareness (11.00 - 14.00)

export const GOLDHEN_VERSIONS = [
  { id: "GHv2.4b18.12", name: "GoldHEN v2.4b18.12 (Mais Recente)", file: "goldhen_v2.4b18.12.bin", recommended: true },
  { id: "GHv2.4b18.10", name: "GoldHEN v2.4b18.10", file: "goldhen_v2.4b18.10.bin" },
  { id: "GHv2.4b18.9",  name: "GoldHEN v2.4b18.9",  file: "goldhen_v2.4b18.9.bin" },
  { id: "GHv2.4b18.8",  name: "GoldHEN v2.4b18.8",  file: "goldhen_v2.4b18.8.bin" },
  { id: "GHv2.4b18.7",  name: "GoldHEN v2.4b18.7",  file: "goldhen_v2.4b18.7.bin" },
  { id: "GHv2.4b18.6",  name: "GoldHEN v2.4b18.6",  file: "goldhen_v2.4b18.6.bin" },
];

export const DEFAULT_GH_VER = "GHv2.4b18.12";
export const GOLDHEN_BASE_PATH = "includes/payloads/GoldHEN/";
export const HEN_BASE_PATH = "includes/payloads/HEN/";
export const HEN_FILE = "payload2.bin";

/**
 * Checks if a given firmware supports GoldHEN.
 * Currently, GoldHEN is supported on PS4 firmwares <= 13.00.
 * Firmwares 13.02, 13.04, 13.50, 13.52, and 14.00 use native PS4HEN.
 */
export function isGoldHENSupported(fwKey) {
  if (!fwKey) return true; // Permite seleção em modo demo/PC
  const num = Number.parseFloat(fwKey);
  if (Number.isNaN(num)) return true;
  return num <= 13.00;
}

/**
 * Gets the current jailbreak flavor preference ('GoldHEN' or 'HEN').
 */
export function getJbFlavor(fwKey) {
  let flavor = "GoldHEN";
  try {
    flavor = localStorage.getItem("jailbreakFlavor") || "GoldHEN";
  } catch (e) {
    flavor = "GoldHEN";
  }
  // If the detected firmware does not support GoldHEN, fallback to HEN
  if (fwKey && !isGoldHENSupported(fwKey)) {
    flavor = "HEN";
  }
  return flavor;
}

/**
 * Saves jailbreak flavor preference.
 */
export function setJbFlavor(flavor, fwKey) {
  if (flavor === "GoldHEN" && fwKey && !isGoldHENSupported(fwKey)) {
    flavor = "HEN";
  }
  try {
    localStorage.setItem("jailbreakFlavor", flavor);
  } catch (e) {}
  return flavor;
}

/**
 * Gets selected GoldHEN version.
 */
export function getGoldHENVer() {
  try {
    return localStorage.getItem("GHVer") || DEFAULT_GH_VER;
  } catch (e) {
    return DEFAULT_GH_VER;
  }
}

/**
 * Sets selected GoldHEN version.
 */
export function setGoldHENVer(ver) {
  try {
    localStorage.setItem("GHVer", ver || DEFAULT_GH_VER);
  } catch (e) {}
}

/**
 * Resolves the payload file path to fetch and execute.
 */
export function resolvePayload(fwKey) {
  const flavor = getJbFlavor(fwKey);
  if (flavor === "GoldHEN" && isGoldHENSupported(fwKey)) {
    const ghVer = getGoldHENVer();
    const entry = GOLDHEN_VERSIONS.find(v => v.id === ghVer) || GOLDHEN_VERSIONS[0];
    const path = GOLDHEN_BASE_PATH + entry.file;
    try {
      sessionStorage.setItem("payload_path", path);
    } catch (e) {}
    return {
      flavor: "GoldHEN",
      name: entry.name,
      path: path,
    };
  } else {
    const path = HEN_BASE_PATH + HEN_FILE;
    try {
      sessionStorage.setItem("payload_path", path);
    } catch (e) {}
    return {
      flavor: "HEN",
      name: "PS4HEN (Nativo)",
      path: path,
    };
  }
}

// Window global bindings for non-module integration
if (typeof window !== "undefined") {
  window.RAW_HENS = {
    isGoldHENSupported,
    getJbFlavor,
    setJbFlavor,
    getGoldHENVer,
    setGoldHENVer,
    resolvePayload,
    GOLDHEN_VERSIONS,
  };
}
