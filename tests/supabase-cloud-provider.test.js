import test from "node:test";
import assert from "node:assert/strict";

import { createCloudProvider, setActiveUser } from "../assets/js/storage-providers/cloud-provider.js";
import { createTask } from "../assets/js/timebox-engine.js";
import { createFakeSupabase } from "./helpers/fake-supabase.js";

function providerWith(fakeClient) {
  return createCloudProvider({ getClient: async () => fakeClient, isConfigured: () => true });
}

// ─── isConfigured / configure ──────────────────────────────

test("cloud provider(注入): isConfigured はSupabase設定 かつ ログイン中の両方が必要", () => {
  const fake = createFakeSupabase();
  const provider = providerWith(fake);

  setActiveUser(null);
  assert.equal(provider.isConfigured(), false);

  setActiveUser("user-a");
  assert.equal(provider.isConfigured(), true);
  setActiveUser(null);
});

test("cloud provider(注入): configure()はログイン済みならconnectedUserIdを返す", async () => {
  const fake = createFakeSupabase();
  const provider = providerWith(fake);
  setActiveUser("user-a");
  const config = await provider.configure();
  assert.equal(config.connectedUserId, "user-a");
  setActiveUser(null);
});

// ─── saveState: insert → update → conflict ─────────────────

test("saveState: 新規タスクはCloudへinsertされ、versionは1になる", async () => {
  const fake = createFakeSupabase();
  const provider = providerWith(fake);
  setActiveUser("user-a");

  const task = createTask({ id: "t1", title: "資料作成" });
  const result = await provider.saveState({ tasks: [task] }, {}, { namespace: "user/user-a" });

  assert.equal(result.ok, true);
  assert.equal(fake.db.tasks.length, 1);
  assert.equal(fake.db.tasks[0].id, "t1");
  assert.equal(fake.db.tasks[0].version, 1);
  assert.equal(fake.db.tasks[0].user_id, "user-a");
  setActiveUser(null);
});

test("saveState: 既知versionと一致していれば上書き更新でき、versionが進む（Conflict無し）", async () => {
  const fake = createFakeSupabase();
  const provider = providerWith(fake);
  setActiveUser("user-a");

  const task = createTask({ id: "t1", title: "資料作成" });
  await provider.saveState({ tasks: [task] }, {}, { namespace: "user/user-a" });

  const updated = { ...task, title: "資料作成（改訂）" };
  const result = await provider.saveState({ tasks: [updated] }, {}, { namespace: "user/user-a" });

  assert.equal(result.ok, true);
  assert.equal(result.conflicts, undefined);
  assert.equal(fake.db.tasks[0].title, "資料作成（改訂）");
  assert.equal(fake.db.tasks[0].version, 2);
  setActiveUser(null);
});

test("saveState: 別端末が先にCloud側を更新していた場合はConflictとして検出し、上書きしない（§28）", async () => {
  const fake = createFakeSupabase();
  const provider = providerWith(fake);
  setActiveUser("user-a");

  const task = createTask({ id: "t1", title: "資料作成" });
  await provider.saveState({ tasks: [task] }, {}, { namespace: "user/user-a" });

  // 別端末がCloud側だけを直接書き換えた状況を再現する（このprocessのknownVersionsキャッシュは古いまま）
  fake.db.tasks[0].title = "他端末での変更";
  fake.db.tasks[0].version = 5;

  const localEdit = { ...task, title: "この端末での変更" };
  const result = await provider.saveState({ tasks: [localEdit] }, {}, { namespace: "user/user-a" });

  assert.equal(result.ok, true);
  assert.equal(result.conflicts.length, 1);
  assert.equal(result.conflicts[0].kind, "tasks");
  assert.equal(result.conflicts[0].id, "t1");
  // 上書きされず、他端末の内容が残っている（勝手に消さない）
  assert.equal(fake.db.tasks[0].title, "他端末での変更");
  setActiveUser(null);
});

// ─── loadState ──────────────────────────────────────────────

test("loadState: Cloud行をLocal形式へマッピングして返す", async () => {
  const fake = createFakeSupabase({
    tasks: [
      {
        user_id: "user-a",
        id: "t1",
        title: "既存タスク",
        minutes: 30,
        priority: 3,
        triage: "today",
        planned_date: "2026-08-11",
        deadline: null,
        category: "work",
        time_hint: "any",
        done: false,
        carry_count: 0,
        carried_from: null,
        pinned_start: null,
        origin: "manual",
        created_at: "2026-08-01T00:00:00.000Z",
        deleted_at: null,
        version: 1,
      },
    ],
    day_plans: [{ user_id: "user-a", date: "2026-08-11", windows: [], blocks: [], version: 1 }],
    user_preferences: [{ user_id: "user-a", active_storage_provider: "cloud", settings: { plan: "free" } }],
  });
  const provider = providerWith(fake);
  setActiveUser("user-a");

  const state = await provider.loadState({}, { namespace: "user/user-a" });
  assert.equal(state.tasks.length, 1);
  assert.equal(state.tasks[0].title, "既存タスク");
  assert.equal(state.tasks[0].plannedDate, "2026-08-11");
  assert.ok(state.days["2026-08-11"]);
  assert.equal(state.settings.storageProviderId, "cloud");
  setActiveUser(null);
});

test("loadState: 未ログインならnullを返す（例外を投げない）", async () => {
  const fake = createFakeSupabase();
  const provider = providerWith(fake);
  setActiveUser(null);
  assert.equal(await provider.loadState({}), null);
});

// ─── Cross-user security（§41の一部をApp層でも検証） ─────────

test("cross-user: user_idで明示フィルタしているため、別Userの行は絶対に混ざらない", async () => {
  const fake = createFakeSupabase({
    tasks: [
      { user_id: "user-a", id: "shared-id", title: "Aのタスク", version: 1, deleted_at: null },
      { user_id: "user-b", id: "other-id", title: "Bのタスク", version: 1, deleted_at: null },
    ],
  });
  const provider = providerWith(fake);

  setActiveUser("user-a");
  const stateA = await provider.loadState({}, { namespace: "user/user-a" });
  assert.equal(stateA.tasks.length, 1);
  assert.equal(stateA.tasks[0].title, "Aのタスク");

  setActiveUser("user-b");
  const stateB = await provider.loadState({}, { namespace: "user/user-b" });
  assert.equal(stateB.tasks.length, 1);
  assert.equal(stateB.tasks[0].title, "Bのタスク");

  setActiveUser(null);
});

// ─── capture / execution / skill / automation candidate upsert ──

test("saveCapture: captureとanalysisを両方upsertする", async () => {
  const fake = createFakeSupabase();
  const provider = providerWith(fake);
  setActiveUser("user-a");

  const result = await provider.saveCapture(
    { id: "c1", text: "メモ", status: "draft", createdAt: new Date().toISOString() },
    {},
    { id: "a1", captureId: "c1", suggestions: {}, model: null, acceptedAt: null }
  );
  assert.equal(result.ok, true);
  assert.equal(fake.db.captures.length, 1);
  assert.equal(fake.db.ai_analyses.length, 1);
  setActiveUser(null);
});

test("appendExecution / saveSkill / saveAutomationCandidate: 未ログイン時はlogin_requiredを返す", async () => {
  const fake = createFakeSupabase();
  const provider = providerWith(fake);
  setActiveUser(null);

  assert.deepEqual(await provider.appendExecution({ id: "e1" }), { ok: false, error: "login_required" });
  assert.deepEqual(await provider.saveSkill({ id: "sk1" }), { ok: false, error: "login_required" });
  assert.deepEqual(await provider.saveAutomationCandidate({ id: "au1" }), {
    ok: false,
    error: "login_required",
  });
});

test("healthCheck: ログイン済みかつ接続できればok:true", async () => {
  const fake = createFakeSupabase({ profiles: [{ id: "user-a" }] });
  const provider = providerWith(fake);
  setActiveUser("user-a");
  const health = await provider.healthCheck();
  assert.equal(health.ok, true);
  setActiveUser(null);
});
