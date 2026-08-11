import test from "node:test";
import assert from "node:assert/strict";

import {
  isPushSupported,
  isPushConfigured,
  getVapidPublicKey,
  subscriptionToRow,
  isSameSubscription,
} from "../assets/js/mini/push-subscription.js";
import { getDeviceId } from "../assets/js/mini/device-id.js";
import { isAppBadgeSupported, setAppBadgeCount } from "../assets/js/mini/app-badge.js";

test("isPushSupported / isPushConfigured: Node環境（navigator/window/env無し）ではfalse。例外を投げない", () => {
  assert.equal(isPushSupported(), false);
  assert.equal(isPushConfigured(), false);
  assert.equal(getVapidPublicKey(), "");
});

test("subscriptionToRow: PushSubscription.toJSON()形式をpush_subscriptions行へ変換する", () => {
  const row = subscriptionToRow({
    subscriptionJson: { endpoint: "https://push.example/abc", keys: { p256dh: "P", auth: "A" } },
    userId: "user-1",
    deviceId: "device-1",
  });
  assert.deepEqual(row, {
    user_id: "user-1",
    device_id: "device-1",
    endpoint: "https://push.example/abc",
    p256dh: "P",
    auth_key: "A",
    enabled: true,
  });
});

test("isSameSubscription: endpointが一致する既存行があれば重複購読とみなす（§90 no-duplicate-subscription）", () => {
  const existing = { endpoint: "https://push.example/abc" };
  assert.equal(isSameSubscription(existing, { endpoint: "https://push.example/abc" }), true);
  assert.equal(isSameSubscription(existing, { endpoint: "https://push.example/xyz" }), false);
  assert.equal(isSameSubscription(null, { endpoint: "https://push.example/abc" }), false);
});

test("getDeviceId: Node環境(localStorage無し)でもメモリ上で安定したIDを返す（§77 device mapping）", () => {
  const first = getDeviceId();
  const second = getDeviceId();
  assert.equal(first, second);
  assert.ok(first.length > 0);
});

test("App Badge: Node環境では未対応として扱い、setAppBadgeCountは例外を投げない", () => {
  assert.equal(isAppBadgeSupported(), false);
  assert.doesNotThrow(() => setAppBadgeCount(3));
  assert.doesNotThrow(() => setAppBadgeCount(0));
});
