import assert from "node:assert/strict";
import { test } from "node:test";

import { int64 } from "../includes/js/int64.js";

test("int64 addition carries into the high word", () => {
  const result = new int64(0xffffffff, 4).add32(1);
  assert.equal(result.low, 0);
  assert.equal(result.hi, 5);
});

test("int64 subtraction borrows from the high word", () => {
  const result = new int64(0, 5).sub32(1);
  assert.equal(result.low, 0xffffffff);
  assert.equal(result.hi, 4);
});

test("int64 supports in-place updates and hexadecimal formatting", () => {
  const value = new int64(0xffffffff, 0);
  value.add32inplace(1);
  assert.equal(value.toString(), "100000000");
  value.sub32inplace(1);
  assert.equal(value.toString(), "ffffffff");
});
