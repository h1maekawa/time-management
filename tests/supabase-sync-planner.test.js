import test from "node:test";
import assert from "node:assert/strict";

import { planPush, planPull, nextKnownVersionsAfterPush } from "../assets/js/supabase/sync-planner.js";

test("planPush: Cloudに無いidはinsertへ分類される", () => {
  const plan = planPush({ localItems: [{ id: "t1" }], cloudRows: [], knownVersions: {} });
  assert.equal(plan.inserts.length, 1);
  assert.equal(plan.updates.length, 0);
  assert.equal(plan.conflicts.length, 0);
});

test("planPush: knownVersionsが未設定(初回)でCloud行が存在する場合は安全な更新として扱う", () => {
  const plan = planPush({
    localItems: [{ id: "t1", title: "x" }],
    cloudRows: [{ id: "t1", version: 3 }],
    knownVersions: {},
  });
  assert.equal(plan.updates.length, 1);
  assert.equal(plan.updates[0].expectedVersion, 3);
  assert.equal(plan.conflicts.length, 0);
});

test("planPush: knownVersionsが現在のCloud versionと一致すれば更新できる", () => {
  const plan = planPush({
    localItems: [{ id: "t1" }],
    cloudRows: [{ id: "t1", version: 2 }],
    knownVersions: { t1: 2 },
  });
  assert.equal(plan.updates.length, 1);
  assert.equal(plan.conflicts.length, 0);
});

test("planPush: knownVersionsとCloud versionが食い違えばConflict（他端末で変更された）", () => {
  const plan = planPush({
    localItems: [{ id: "t1" }],
    cloudRows: [{ id: "t1", version: 5 }],
    knownVersions: { t1: 2 },
  });
  assert.equal(plan.updates.length, 0);
  assert.deepEqual(plan.conflicts, ["t1"]);
});

test("planPull: knownVersionsと一致する行は変化なしとしてスキップされる", () => {
  const plan = planPull({ cloudRows: [{ id: "t1", version: 2 }], knownVersions: { t1: 2 } });
  assert.equal(plan.toApply.length, 0);
  assert.equal(plan.toRemove.length, 0);
});

test("planPull: versionが進んでいる行はtoApplyへ、deleted_atがある行はtoRemoveへ", () => {
  const plan = planPull({
    cloudRows: [
      { id: "t1", version: 3, deleted_at: null },
      { id: "t2", version: 4, deleted_at: "2026-08-11T00:00:00.000Z" },
    ],
    knownVersions: { t1: 2, t2: 3 },
  });
  assert.deepEqual(plan.toApply.map((r) => r.id), ["t1"]);
  assert.deepEqual(plan.toRemove, ["t2"]);
  assert.equal(plan.nextKnownVersions.t1, 3);
  assert.equal(plan.nextKnownVersions.t2, 4);
});

test("nextKnownVersionsAfterPush: insert成功は1、update成功はexpected+1になる", () => {
  const next = nextKnownVersionsAfterPush({
    knownVersions: { t1: 2 },
    insertedIds: ["t2"],
    updatedIds: ["t1"],
  });
  assert.equal(next.t1, 3);
  assert.equal(next.t2, 1);
});
