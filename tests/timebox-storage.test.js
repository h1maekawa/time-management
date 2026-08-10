import test from "node:test";
import assert from "node:assert/strict";

import * as storage from "../assets/js/timebox-storage.js";
import {
  createTask,
  createCapture,
  createAiAnalysis,
  createExecution,
  createSkill,
  createAutomationCandidate,
} from "../assets/js/timebox-engine.js";

const { STORAGE_VERSION, ImportError } = storage;

// このテストはブラウザ（window/localStorage）を持たないNode環境で動く。
// storage.js は localStorage が使えない場合メモリ上へフォールバックする実装に
// なっているため、load/save/patch/importJson のロジックはここで検証できる。
// 実ブラウザでのlocalStorage永続化そのものはブラウザでのSmoke Testで確認する。

test("load() は保存前は emptyState と同じ形を返す", () => {
  storage.clearAll();
  const state = storage.load();
  assert.equal(state.version, STORAGE_VERSION);
  assert.deepEqual(state.tasks, []);
  assert.equal(state.settings.plan, "free");
  assert.equal(state.template.days.length, 7);
});

test("save() / load() は往復する", () => {
  storage.clearAll();
  const task = createTask({ title: "テスト" });
  storage.save({ ...storage.load(), tasks: [task] });
  const loaded = storage.load();
  assert.equal(loaded.tasks.length, 1);
  assert.equal(loaded.tasks[0].title, "テスト");
});

test("patch() は既存の state へ部分的に反映する", () => {
  storage.clearAll();
  storage.patch({ settings: { plan: "founder", lastOpenedDate: "2026-08-10" } });
  assert.equal(storage.load().settings.plan, "founder");
});

test("exportJson() は importJson() で読み戻せる（バックアップの往復）", () => {
  storage.clearAll();
  const task = createTask({ title: "往復確認" });
  storage.save({ ...storage.load(), tasks: [task] });

  const json = storage.exportJson();
  const imported = storage.importJson(json);

  assert.equal(imported.tasks.length, 1);
  assert.equal(imported.tasks[0].title, "往復確認");
  assert.equal(imported.version, STORAGE_VERSION);
});

test("importJson() は壊れたJSON文字列を拒否する", () => {
  assert.throws(() => storage.importJson("{ not json"), ImportError);
});

test("importJson() は version の無いバックアップを拒否する", () => {
  assert.throws(() => storage.importJson(JSON.stringify({ tasks: [] })), ImportError);
});

test("importJson() は version が新しすぎるバックアップを拒否する", () => {
  assert.throws(
    () => storage.importJson(JSON.stringify({ version: STORAGE_VERSION + 1, tasks: [] })),
    ImportError
  );
});

test("importJson() は tasks が配列でないバックアップを拒否する", () => {
  assert.throws(
    () => storage.importJson(JSON.stringify({ version: 1, tasks: "not-an-array" })),
    ImportError
  );
});

test("importJson() は不正なtask要素を含むバックアップを拒否する", () => {
  assert.throws(
    () => storage.importJson(JSON.stringify({ version: 1, tasks: [{ id: 1 }] })),
    ImportError
  );
});

test("importJson() の失敗は既存の保存データを変更しない（安全な失敗）", () => {
  storage.clearAll();
  const task = createTask({ title: "壊さない" });
  storage.save({ ...storage.load(), tasks: [task] });

  assert.throws(() => storage.importJson("not json at all"));
  assert.throws(() => storage.importJson(JSON.stringify({ version: 1, tasks: [{ id: 1 }] })));

  const stillThere = storage.load();
  assert.equal(stillThere.tasks.length, 1);
  assert.equal(stillThere.tasks[0].title, "壊さない");
});

test("importJson() は正しいバックアップを normalize して返す（呼んだだけでは保存しない）", () => {
  storage.clearAll();
  const before = storage.load();
  const backup = { version: 1, tasks: [{ id: "t1", title: "インポート" }] };

  const imported = storage.importJson(JSON.stringify(backup));

  assert.equal(imported.tasks[0].title, "インポート");
  assert.deepEqual(storage.load(), before);
});

// ─── V1 → V2 migration ─────────────────────────────────────

test("V1 → V2: emptyState は新コレクションと storageProviderId を持つ", () => {
  storage.clearAll();
  const state = storage.load();
  assert.equal(state.version, 2);
  assert.deepEqual(state.captures, []);
  assert.deepEqual(state.aiAnalyses, []);
  assert.deepEqual(state.executions, []);
  assert.deepEqual(state.skills, []);
  assert.deepEqual(state.automationCandidates, []);
  assert.equal(state.settings.storageProviderId, "local");
});

test("V1 → V2: 旧バージョンのバックアップを読み込むと新コレクションが空配列で補われる", () => {
  const v1Backup = {
    version: 1,
    tasks: [{ id: "t1", title: "旧タスク" }],
    days: {},
    template: { days: [[], [], [], [], [], [], []] },
    history: [],
    settings: { plan: "free", lastOpenedDate: "2026-08-01" },
  };

  const migrated = storage.importJson(JSON.stringify(v1Backup));

  assert.equal(migrated.version, 2);
  assert.deepEqual(migrated.captures, []);
  assert.deepEqual(migrated.aiAnalyses, []);
  assert.deepEqual(migrated.executions, []);
  assert.deepEqual(migrated.skills, []);
  assert.deepEqual(migrated.automationCandidates, []);
  assert.equal(migrated.settings.storageProviderId, "local");
});

test("V1 → V2: 既存タスクは origin: manual を補われ、他フィールドは失われない", () => {
  const v1Backup = {
    version: 1,
    tasks: [{ id: "t1", title: "旧タスク", minutes: 45, priority: 4, category: "life" }],
  };

  const migrated = storage.importJson(JSON.stringify(v1Backup));
  const task = migrated.tasks[0];

  assert.equal(task.origin, "manual");
  assert.equal(task.title, "旧タスク");
  assert.equal(task.minutes, 45);
  assert.equal(task.priority, 4);
  assert.equal(task.category, "life");
});

test("V1 → V2 migration の失敗は既存の保存データを壊さない（安全な失敗）", () => {
  storage.clearAll();
  const task = createTask({ title: "壊さない・V2版" });
  storage.save({ ...storage.load(), tasks: [task] });

  // tasksが配列でない壊れたv1相当バックアップはimportJsonの入口で拒否される
  assert.throws(() => storage.importJson(JSON.stringify({ version: 1, tasks: {} })), storage.ImportError);

  const stillThere = storage.load();
  assert.equal(stillThere.tasks.length, 1);
  assert.equal(stillThere.tasks[0].title, "壊さない・V2版");
});

test("createTask() の origin はデフォルト manual、AI Brain Dump由来は ai-brain-dump を指定できる", () => {
  assert.equal(createTask({ title: "手動" }).origin, "manual");
  assert.equal(createTask({ title: "AI生成", origin: "ai-brain-dump" }).origin, "ai-brain-dump");
  assert.equal(createTask({ title: "不正値", origin: "not-a-real-origin" }).origin, "manual");
});

// ─── Capture / AI Analysis / Execution / Skill / Automation Candidate ─────

test("saveCapture() は Brain Dump の下書きを保存・更新する（upsert）", () => {
  storage.clearAll();
  const capture = createCapture({ text: "FS週次資料作らないと\n明日の商談準備" });
  storage.saveCapture(capture);
  assert.equal(storage.load().captures.length, 1);

  storage.saveCapture({ ...capture, status: "analyzed" });
  const state = storage.load();
  assert.equal(state.captures.length, 1);
  assert.equal(state.captures[0].status, "analyzed");
});

test("saveAiAnalysis() は Capture に紐づく AI 提案を保存する", () => {
  storage.clearAll();
  const capture = createCapture({ text: "テスト" });
  storage.saveCapture(capture);
  const analysis = createAiAnalysis({
    captureId: capture.id,
    suggestions: { goal: null, tasks: [{ title: "テストタスク" }], questions: [], summary: null },
  });
  storage.saveAiAnalysis(analysis);

  const state = storage.load();
  assert.equal(state.aiAnalyses.length, 1);
  assert.equal(state.aiAnalyses[0].captureId, capture.id);
  assert.equal(state.aiAnalyses[0].suggestions.tasks[0].title, "テストタスク");
});

test("appendExecution() は実行記録を常に追加する（上書きしない）", () => {
  storage.clearAll();
  storage.appendExecution(createExecution({ taskId: "t1", plannedMinutes: 30, actualMinutes: 31 }));
  storage.appendExecution(createExecution({ taskId: "t1", plannedMinutes: 30, actualMinutes: 45 }));

  const state = storage.load();
  assert.equal(state.executions.length, 2);
  assert.equal(state.executions[1].actualMinutes, 45);
});

test("saveSkill() / saveAutomationCandidate() は保存・更新できる", () => {
  storage.clearAll();
  const skill = createSkill({ name: "FS商談準備", steps: ["GBP確認", "HP確認"], confidence: 0.82 });
  storage.saveSkill(skill);
  assert.equal(storage.load().skills[0].status, "suggested");

  storage.saveSkill({ ...skill, status: "approved" });
  assert.equal(storage.load().skills[0].status, "approved");

  const candidate = createAutomationCandidate({
    type: "estimate-adjustment",
    title: "商談準備の見積もり調整",
    confidence: 0.7,
  });
  storage.saveAutomationCandidate(candidate);
  assert.equal(storage.load().automationCandidates[0].type, "estimate-adjustment");
});
