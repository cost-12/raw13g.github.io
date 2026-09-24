// RAW GAME - Firmware Detection & Compatibility Engine
// Methods based on WebKitty and specialized for 11.00 - 14.00 kernel architectures

export const SUPPORTED_FW_LIST = [
  "11.00", "11.02", "11.50", "11.52", "12.00", "12.02", 
  "12.50", "12.52", "13.00", "13.02", "13.04", "13.50", "13.52", "14.00"
];

export const FW_METADATA = {
  "11.00": { kpatch: "1100.bin", exploit: "SlopKit / Lapse", goldhen: true, hen: true, title: "FW 11.00" },
  "11.02": { kpatch: "1102.bin", exploit: "SlopKit / Lapse", goldhen: true, hen: true, title: "FW 11.02" },
  "11.50": { kpatch: "1150.bin", exploit: "SlopKit / Lapse", goldhen: true, hen: true, title: "FW 11.50" },
  "11.52": { kpatch: "1150.bin", exploit: "SlopKit / Lapse", goldhen: true, hen: true, title: "FW 11.52" },
  "12.00": { kpatch: "1200.bin", exploit: "SlopKit / Lapse", goldhen: true, hen: true, title: "FW 12.00" },
  "12.02": { kpatch: "1200.bin", exploit: "SlopKit / Lapse", goldhen: true, hen: true, title: "FW 12.02" },
  "12.50": { kpatch: "1250.bin", exploit: "SlopKit / Netctrl", goldhen: true, hen: true, title: "FW 12.50" },
  "12.52": { kpatch: "1250.bin", exploit: "SlopKit / Netctrl", goldhen: true, hen: true, title: "FW 12.52" },
  "13.00": { kpatch: "1300.bin", exploit: "SlopKit / Poops", goldhen: true, hen: true, title: "FW 13.00" },
  "13.02": { kpatch: "1302.bin", exploit: "Relapse (Sysent 663)", goldhen: false, hen: true, title: "FW 13.02" },
  "13.04": { kpatch: "1302.bin", exploit: "Relapse (Sysent 663)", goldhen: false, hen: true, title: "FW 13.04" },
  "13.50": { kpatch: "1350.bin", exploit: "Relapse (Sysent 663)", goldhen: false, hen: true, title: "FW 13.50" },
  "13.52": { kpatch: "1352.bin", exploit: "Relapse (Sysent 663)", goldhen: false, hen: true, title: "FW 13.52" },
  "14.00": { kpatch: "1400.bin", exploit: "Relapse (Sysent 663)", goldhen: false, hen: true, title: "FW 14.00" },
};

/**
 * Extracts and formats the PlayStation 4 firmware version from a User-Agent string.
 * Sony encodes the subversion in hex (e.g. 13.52 -> 13.52).
 */
export function detectFw(uaString) {
  const ua = uaString || (typeof navigator !== "undefined" ? navigator.userAgent : "");
  const isPs4 = /PlayStation\s+4/i.test(ua);
  
  const m = /PlayStation\s+4[/ ](\d+)\.(\d+)/i.exec(ua);
  if (!m) {
    return {
      isPs4: isPs4,
      fwKey: null,
      fwNum: null,
      supported: false,
      meta: null,
      platform: detectPlatform(ua),
    };
  }

  let ms = Number.parseInt(m[2], 16).toString(16);
  if (ms.length < 2) ms = "0" + ms;
  const fwKey = m[1] + "." + ms;
  const fwNum = Number.parseInt(m[1], 10) * 100 + Number.parseInt(ms, 10);
  const supported = SUPPORTED_FW_LIST.includes(fwKey);
  const meta = FW_METADATA[fwKey] || null;

  return {
    isPs4: true,
    fwKey,
    fwNum,
    supported,
    meta,
    platform: "PS4",
  };
}

/**
 * Identifies desktop or mobile device when not on a PS4.
 */
export function detectPlatform(ua) {
  if (/PlayStation\s+4/i.test(ua)) return "PS4";
  if (/Android/i.test(ua)) return "Android";
  if (/iPhone|iPad|iPod/i.test(ua)) return "iOS";
  if (/Macintosh/i.test(ua)) return "MacOS";
  if (/Windows/i.test(ua)) return "Windows";
  if (/Linux/i.test(ua)) return "Linux";
  return "Navegador";
}

// Global binding
if (typeof window !== "undefined") {
  window.RAW_CHECK_FW = {
    detectFw,
    detectPlatform,
    SUPPORTED_FW_LIST,
    FW_METADATA,
  };
}
