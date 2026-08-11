import test from "node:test";
import assert from "node:assert/strict";

import {
  sanitizeDigits,
  digitsToArray,
  arrayToDigits,
  isComplete,
  nextFocusIndex,
  canResend,
  resendCooldownRemainingSeconds,
  OTP_LENGTH,
  RESEND_COOLDOWN_MS,
} from "../assets/js/supabase/otp-input.js";

test("sanitizeDigits: 数字以外を除去し6桁に丸める", () => {
  assert.equal(sanitizeDigits("1a2b3c4d5e6f7g"), "123456");
  assert.equal(sanitizeDigits("12-34-56"), "123456");
  assert.equal(sanitizeDigits(""), "");
  assert.equal(sanitizeDigits(undefined), "");
  assert.equal(sanitizeDigits("123456789"), "123456");
});

test("digitsToArray / arrayToDigits: 往復する", () => {
  const arr = digitsToArray("1234");
  assert.deepEqual(arr, ["1", "2", "3", "4", "", ""]);
  assert.equal(arrayToDigits(arr), "1234");
  assert.equal(arrayToDigits(["1", "2", "3", "4", "5", "6"]), "123456");
});

test("6桁ペーストは全マスへ自動展開される", () => {
  const arr = digitsToArray("654321");
  assert.equal(arr.length, OTP_LENGTH);
  assert.equal(arrayToDigits(arr), "654321");
});

test("isComplete: 6桁揃っているかどうか", () => {
  assert.equal(isComplete(["1", "2", "3", "4", "5", "6"]), true);
  assert.equal(isComplete(["1", "2", "3", "", "", ""]), false);
  assert.equal(isComplete([]), false);
});

test("nextFocusIndex: 入力があれば次のマスへ、最後のマスなら次は無い（auto advance）", () => {
  assert.equal(nextFocusIndex(0, "1"), 1);
  assert.equal(nextFocusIndex(4, "9"), 5);
  assert.equal(nextFocusIndex(5, "9"), null);
  assert.equal(nextFocusIndex(0, ""), null);
});

test("canResend / resendCooldownRemainingSeconds: クールダウン中はfalse、経過後はtrue", () => {
  const now = Date.parse("2026-08-11T10:00:00.000Z");
  const sentAt = new Date(now - 10_000).toISOString();

  assert.equal(canResend(sentAt, now), false);
  assert.equal(resendCooldownRemainingSeconds(sentAt, now), Math.ceil((RESEND_COOLDOWN_MS - 10_000) / 1000));

  const longAgo = new Date(now - RESEND_COOLDOWN_MS - 1000).toISOString();
  assert.equal(canResend(longAgo, now), true);
  assert.equal(resendCooldownRemainingSeconds(longAgo, now), 0);

  assert.equal(canResend(null, now), true);
});
