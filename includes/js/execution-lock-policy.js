export const EXECUTION_LOCK_STALE_MS = 45_000;

const PROTECTED_LOCK_STATES = new Set([
  "completed",
  "kernel-dirty",
  "protected-active",
  "reboot-required",
  "reboot_required",
  "hx1400-running",
]);

function validTimestamp(value) {
  return typeof value === "number" && Number.isFinite(value) && value >= 0
    ? value
    : null;
}

/**
 * Classifies an existing browser execution lock without mutating it.
 *
 * Only a stale "running" lock with a known stage-1 position is reclaimable.
 * Legacy locks without stage metadata, and states that may represent a
 * completed jailbreak or a dirty/active kernel, require explicit action.
 */
export function inspectExecutionLock(
  record,
  now = Date.now(),
  staleAfterMs = EXECUTION_LOCK_STALE_MS,
) {
  if (!record || typeof record !== "object" || Array.isArray(record) ||
      typeof record.owner !== "string" || !record.owner.trim()) {
    return {
      blocked: false,
      stale: false,
      protected: false,
      reason: null,
      state: null,
      stage: null,
      ageMs: null,
      startedAt: null,
      updatedAt: null,
      lastActivityAt: null,
    };
  }

  const state = typeof record.state === "string" && record.state.trim()
    ? record.state.trim()
    : "unknown";
  const startedAt = validTimestamp(record.startedAt);
  const updatedAt = validTimestamp(record.updatedAt);
  const stage = Number.isInteger(record.stage) && record.stage >= 1 && record.stage <= 4
    ? record.stage
    : null;
  const lastActivityAt = updatedAt ?? startedAt;
  const ageMs = lastActivityAt === null
    ? null
    : Math.max(0, Number(now) - lastActivityAt);
  const protectedState = PROTECTED_LOCK_STATES.has(state) ||
    state.startsWith("hx1400-") ||
    stage === null ||
    stage >= 2;

  const details = {
    state,
    stage,
    ageMs,
    startedAt,
    updatedAt,
    lastActivityAt,
  };

  if (protectedState) {
    return {
      blocked: true,
      stale: false,
      protected: true,
      reason: stage === null || stage >= 2
        ? "reboot_required"
        : state,
      ...details,
    };
  }

  if (state === "running" && ageMs !== null && ageMs > staleAfterMs) {
    return {
      blocked: false,
      stale: true,
      protected: false,
      reason: "stale-running",
      ...details,
    };
  }

  return {
    blocked: true,
    stale: false,
    protected: state !== "running",
    reason: state === "running" ? "running" : state,
    ...details,
  };
}
