import test from "node:test";
import assert from "node:assert/strict";

import {
  snapshotState,
  countEntities,
  decideMigrationScenario,
  mergeEntitiesByUnion,
  mergeLocalAndCloudState,
} from "../assets/js/supabase/migration.js";

test("snapshotState: 深いコピーを返し、元のstateを変更しても影響しない", () => {
  const state = { tasks: [{ id: "t1", title: "x" }] };
  const snap = snapshotState(state);
  state.tasks[0].title = "changed";
  assert.equal(snap.tasks[0].title, "x");
});

test("countEntities: 各コレクションの件数を数える", () => {
  const counts = countEntities({ tasks: [1, 2, 3], captures: [1], executions: [], skills: undefined });
  assert.deepEqual(counts, { tasks: 3, captures: 1, executions: 0, skills: 0, automationCandidates: 0 });
});

test("decideMigrationScenario: 4つのケースを判定する（§19/§20/CASE B）", () => {
  assert.equal(decideMigrationScenario({ localTaskCount: 0, cloudTaskCount: 0 }), "empty-both");
  assert.equal(decideMigrationScenario({ localTaskCount: 12, cloudTaskCount: 0 }), "empty-cloud");
  assert.equal(decideMigrationScenario({ localTaskCount: 0, cloudTaskCount: 18 }), "empty-local");
  assert.equal(decideMigrationScenario({ localTaskCount: 12, cloudTaskCount: 18 }), "both-have-data");
});

test("mergeEntitiesByUnion: 異なるidは両方残り、同じidはより新しい方が残る", () => {
  const local = [
    { id: "a", title: "local-a", updatedAt: "2026-08-10T00:00:00.000Z" },
    { id: "b", title: "local-only" },
  ];
  const cloud = [
    { id: "a", title: "cloud-a-newer", updatedAt: "2026-08-11T00:00:00.000Z" },
    { id: "c", title: "cloud-only" },
  ];
  const merged = mergeEntitiesByUnion(local, cloud);
  const byId = Object.fromEntries(merged.map((m) => [m.id, m]));
  assert.equal(merged.length, 3);
  assert.equal(byId.a.title, "cloud-a-newer");
  assert.equal(byId.b.title, "local-only");
  assert.equal(byId.c.title, "cloud-only");
});

test("mergeEntitiesByUnion: どちらのバージョンも失わない（絶対に自動上書きしない, §20）", () => {
  const local = [{ id: "a", title: "local-newer", updatedAt: "2026-08-12T00:00:00.000Z" }];
  const cloud = [{ id: "a", title: "cloud-older", updatedAt: "2026-08-01T00:00:00.000Z" }];
  const merged = mergeEntitiesByUnion(local, cloud);
  assert.equal(merged.length, 1);
  assert.equal(merged[0].title, "local-newer");
});

test("mergeLocalAndCloudState: 各コレクションを統合し、days/templateはlocalを優先する", () => {
  const local = {
    tasks: [{ id: "t1", title: "local" }],
    captures: [],
    executions: [],
    skills: [],
    automationCandidates: [],
    days: { "2026-08-11": { date: "2026-08-11", windows: [{ start: "09:00" }] } },
    template: { days: [] },
  };
  const cloud = {
    tasks: [{ id: "t2", title: "cloud" }],
    captures: [],
    executions: [],
    skills: [],
    automationCandidates: [],
    days: { "2026-08-11": { date: "2026-08-11", windows: [{ start: "10:00" }] } },
  };
  const merged = mergeLocalAndCloudState(local, cloud);
  assert.equal(merged.tasks.length, 2);
  assert.deepEqual(merged.days, local.days);
});
