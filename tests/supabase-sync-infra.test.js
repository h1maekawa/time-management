import test from "node:test";
import assert from "node:assert/strict";

import { getKindVersions, setKindVersions } from "../assets/js/supabase/known-versions.js";
import { enqueueOp, peekAll, clearQueue, removeOps } from "../assets/js/supabase/offline-queue.js";
import * as storage from "../assets/js/timebox-storage.js";

// ─── known-versions（namespace分離のKVS） ────────────────────

test("known-versions: namespace/kindごとに独立して保存・取得できる", () => {
  setKindVersions("user/u1", "tasks", { t1: 2 });
  setKindVersions("user/u1", "captures", { c1: 1 });
  setKindVersions("user/u2", "tasks", { t1: 99 });

  assert.deepEqual(getKindVersions("user/u1", "tasks"), { t1: 2 });
  assert.deepEqual(getKindVersions("user/u1", "captures"), { c1: 1 });
  assert.deepEqual(getKindVersions("user/u2", "tasks"), { t1: 99 });
  assert.deepEqual(getKindVersions("user/u3", "tasks"), {});
});

// ─── offline-queue（オフライン中の再送要求を永続化） ──────────

test("offline-queue: enqueue/peekAll/clearQueueが動作し、namespaceごとに分離される", () => {
  clearQueue("user/queue-test-a");
  clearQueue("user/queue-test-b");

  enqueueOp("user/queue-test-a", { kind: "resync", payload: {} });
  enqueueOp("user/queue-test-a", { kind: "resync", payload: {} });
  enqueueOp("user/queue-test-b", { kind: "resync", payload: {} });

  assert.equal(peekAll("user/queue-test-a").length, 2);
  assert.equal(peekAll("user/queue-test-b").length, 1);

  clearQueue("user/queue-test-a");
  assert.equal(peekAll("user/queue-test-a").length, 0);
  assert.equal(peekAll("user/queue-test-b").length, 1);
});

test("offline-queue: removeOpsは成功した分だけ取り除き、残りは再送のため残す", () => {
  clearQueue("user/queue-test-c");
  const a = enqueueOp("user/queue-test-c", { kind: "resync", payload: {} });
  const b = enqueueOp("user/queue-test-c", { kind: "resync", payload: {} });

  const remaining = removeOps("user/queue-test-c", [a.opId]);
  assert.equal(remaining.length, 1);
  assert.equal(remaining[0].opId, b.opId);
  clearQueue("user/queue-test-c");
});

// ─── Cache Namespace（Guest/User分離。§39） ───────────────────

test("storage: namespace切り替えでGuestとUserのキャッシュが分離される。既存guest keyは維持される", () => {
  storage.setActiveNamespace(null);
  storage.clearAll();
  const guestTask = { id: "guest-task", title: "guest" };
  storage.save({ ...storage.load(), tasks: [guestTask] });
  const guestState = storage.load();
  assert.equal(guestState.tasks.length, 1);

  storage.setActiveNamespace(storage.userNamespace("user-xyz"));
  const freshUserState = storage.load();
  assert.equal(freshUserState.tasks.length, 0); // 新しいnamespaceは空から始まる

  const userTask = { id: "user-task", title: "user" };
  storage.save({ ...storage.load(), tasks: [userTask] });
  assert.equal(storage.load().tasks.length, 1);
  assert.equal(storage.load().tasks[0].id, "user-task");

  // Guestへ戻すと、Userのキャッシュとは無関係にGuestの内容がそのまま残っている
  storage.setActiveNamespace(null);
  assert.equal(storage.load().tasks.length, 1);
  assert.equal(storage.load().tasks[0].id, "guest-task");

  // 同じUserへ再ログインすればキャッシュは再利用できる
  storage.setActiveNamespace(storage.userNamespace("user-xyz"));
  assert.equal(storage.load().tasks[0].id, "user-task");

  storage.setActiveNamespace(null);
  storage.clearAll();
});

test("userNamespace: user-idごとに一意な名前空間文字列を作る", () => {
  assert.equal(storage.userNamespace("abc"), "user/abc");
  assert.notEqual(storage.userNamespace("abc"), storage.userNamespace("def"));
});
