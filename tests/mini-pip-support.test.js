import test from "node:test";
import assert from "node:assert/strict";

import { isPipSupported, currentPipWindow } from "../assets/js/mini/pip-support.js";

test("isPipSupported: windowが無いNode環境ではfalse（unsupported fallbackの入口）", () => {
  assert.equal(isPipSupported(), false);
});

test("currentPipWindow: 非対応環境ではnullを返し、例外を投げない", () => {
  assert.equal(currentPipWindow(), null);
});
