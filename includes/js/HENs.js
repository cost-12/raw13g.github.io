// RAW GAME - Payload & Jailbreak Flavor Manager
// Inspired by WebKitty methods with enhanced firmware awareness (11.00 - 14.00)

// GoldHEN v2.4b18.13 (released by SiSTRo with FTP fixes and FW14-related offsets)
// is available as an option for firmwares <= 13.00. For FW 14.00, GoldHEN
// remains blocked in Fase B pending the 57-site kernel patchset and readback audit.
// v2.4b18.12 remains the default version for <= 13.00.
export const GOLDHEN_VERSIONS = [
  { id: "GHv2.4b18.13", name: "GoldHEN v2.4b18.13", file: "goldhen_v2.4b18.13.bin" },
  { id: "GHv2.4b18.12", name: "GoldHEN v2.4b18.12 (Padrão ≤ 13.00)", file: "goldhen_v2.4b18.12.bin", recommended: true },
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
export const HX1400_HEN_FILE = "hen.bin";

function henFileForFirmware(fwKey) {
  return fwKey === "14.00" ? HX1400_HEN_FILE : HEN_FILE;
}

/**
 * Checks if a given firmware supports GoldHEN.
 * Currently, GoldHEN is supported on PS4 firmwares <= 13.00.
 * Firmware 14.00 uses the dedicated HX/BD-J HEN image; this does not
 * enable the separate GoldHEN 2.4b18.13 payload path.
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
export function resolvePayload(fwKey, requestedFlavor) {
  const storedFlavor = getJbFlavor(fwKey);
  const preferredFlavor =
    requestedFlavor === "GoldHEN" || requestedFlavor === "HEN"
      ? requestedFlavor
      : storedFlavor;
  const flavor =
    preferredFlavor === "GoldHEN" && isGoldHENSupported(fwKey)
      ? "GoldHEN"
      : "HEN";
  if (flavor === "GoldHEN") {
    const ghVer = getGoldHENVer();
    const entry =
      GOLDHEN_VERSIONS.find(v => v.id === ghVer) ||
      GOLDHEN_VERSIONS.find(v => v.id === DEFAULT_GH_VER) ||
      GOLDHEN_VERSIONS[0];
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
    const henFile = henFileForFirmware(fwKey);
    const path = HEN_BASE_PATH + henFile;
    try {
      sessionStorage.setItem("payload_path", path);
    } catch (e) {}
    return {
      flavor: "HEN",
      name: fwKey === "14.00" ? "HEN 14.00 (HX/BD-J image)" : "PS4HEN (Nativo)",
      path: path,
    };
  }
}

export const DEFAULT_GOLDHEN_CONFIG = Object.freeze({
  aioFix: true,
  gamePatch: true,
  pluginLoader: true,
});

export function getGoldHENConfig() {
  try {
    const aioFix = localStorage.getItem("goldhen_aio_fix");
    const gamePatch = localStorage.getItem("goldhen_game_patch");
    const pluginLoader = localStorage.getItem("goldhen_plugin_loader");
    return {
      aioFix: aioFix === null ? true : aioFix === "1",
      gamePatch: gamePatch === null ? true : gamePatch === "1",
      pluginLoader: pluginLoader === null ? true : pluginLoader === "1",
    };
  } catch (e) {
    return { ...DEFAULT_GOLDHEN_CONFIG };
  }
}

export function setGoldHENConfig(cfg = {}) {
  try {
    if (typeof cfg.aioFix === "boolean") {
      localStorage.setItem("goldhen_aio_fix", cfg.aioFix ? "1" : "0");
    }
    if (typeof cfg.gamePatch === "boolean") {
      localStorage.setItem("goldhen_game_patch", cfg.gamePatch ? "1" : "0");
    }
    if (typeof cfg.pluginLoader === "boolean") {
      localStorage.setItem("goldhen_plugin_loader", cfg.pluginLoader ? "1" : "0");
    }
  } catch (e) {}
}

export function formatGoldHENIni(cfg = {}) {
  const c = { ...DEFAULT_GOLDHEN_CONFIG, ...cfg };
  return (
    "[GoldHEN]\n" +
    "AIO_Fix_Enabled = " + (c.aioFix ? "1" : "0") + "\n" +
    "Game_Patch_Enabled = " + (c.gamePatch ? "1" : "0") + "\n" +
    "Plugin_Loader_Enabled = " + (c.pluginLoader ? "1" : "0") + "\n" +
    "FTP_Port = 2121\n" +
    "BinLoader_Port = 9090\n" +
    "Klog_Port = 3232\n"
  );
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
    HX1400_HEN_FILE,
    DEFAULT_GOLDHEN_CONFIG,
    getGoldHENConfig,
    setGoldHENConfig,
    formatGoldHENIni,
  };
}
