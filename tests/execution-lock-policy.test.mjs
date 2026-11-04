import assert from "node:assert/strict";
import { test } from "node:test";
import {
  EXECUTION_LOCK_STALE_MS,
  inspectExecutionLock,
} from "../includes/js/execution-lock-policy.js";

test("no lock is available", () => {
  const result = inspectExecutionLock(null, 100_000);
  assert.equal(result.blocked, false);
  assert.equal(result.stale, false);
  assert.equal(result.reason, null);
});

test("a running lock uses updatedAt rather than its original start time", () => {
  const result = inspectExecutionLock({
    owner: "run-active",
    state: "running",
    stage: 1,
    startedAt: 1_000,
    updatedAt: 95_000,
  }, 100_000);

  assert.equal(result.blocked, true);
  assert.equal(result.stale, false);
  assert.equal(result.ageMs, 5_000);
  assert.equal(result.lastActivityAt, 95_000);
});

test("a running lock without a heartbeat beyond the stale window can be reclaimed", () => {
  const result = inspectExecutionLock({
    owner: "run-stale",
    state: "running",
    stage: 1,
    startedAt: 1_000,
    updatedAt: 2_000,
  }, 2_000 + EXECUTION_LOCK_STALE_MS + 1);

  assert.equal(result.blocked, false);
  assert.equal(result.stale, true);
  assert.equal(result.reason, "stale-running");
});

test("legacy running locks fall back to startedAt", () => {
  const result = inspectExecutionLock({
    owner: "run-legacy-stage1",
    state: "running",
    stage: 1,
    startedAt: 1_000,
  }, 1_000 + EXECUTION_LOCK_STALE_MS + 1);

  assert.equal(result.blocked, false);
  assert.equal(result.stale, true);
  assert.equal(result.updatedAt, null);
});

test("legacy running locks without a stage fail closed even after the heartbeat ages out", () => {
  const result = inspectExecutionLock({
    owner: "legacy-run",
    state: "running",
    startedAt: 1_000,
    updatedAt: 2_000,
  }, 1_000_000);

  assert.equal(result.blocked, true);
  assert.equal(result.stale, false);
  assert.equal(result.protected, true);
  assert.equal(result.reason, "reboot_required");
  assert.equal(result.stage, null);
});

test("stage 2 running locks never expire automatically", () => {
  const result = inspectExecutionLock({
    owner: "stage-two-run",
    state: "running",
    stage: 2,
    startedAt: 1_000,
    updatedAt: 2_000,
  }, 1_000_000);

  assert.equal(result.blocked, true);
  assert.equal(result.stale, false);
  assert.equal(result.protected, true);
  assert.equal(result.reason, "reboot_required");
});

test("kernel-dirty, reboot-required, completed, and HX1400 states never expire automatically", () => {
  for (const state of [
    "kernel-dirty",
    "reboot_required",
    "reboot-required",
    "completed",
    "hx1400-running",
  ]) {
    const result = inspectExecutionLock({
      owner: "run-protected",
      state,
      stage: 1,
      startedAt: 1_000,
      updatedAt: 2_000,
    }, 1_000_000);

    assert.equal(result.blocked, true, state);
    assert.equal(result.stale, false, state);
    assert.equal(result.protected, true, state);
    assert.equal(result.reason, state);
  }
});

test("unknown or malformed lock states fail closed", () => {
  for (const record of [
    { owner: "run-unknown", state: "mystery", startedAt: 1_000 },
    { owner: "run-no-clock", state: "running", startedAt: "invalid" },
  ]) {
    const result = inspectExecutionLock(record, 1_000_000);
    assert.equal(result.blocked, true);
    assert.equal(result.stale, false);
  }
});

test("timestamps in the future do not produce a negative age", () => {
  const result = inspectExecutionLock({
    owner: "run-future",
    state: "running",
    stage: 1,
    startedAt: 50_000,
    updatedAt: 200_000,
  }, 100_000);

  assert.equal(result.blocked, true);
  assert.equal(result.ageMs, 0);
});
