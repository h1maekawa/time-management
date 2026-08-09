import test from "node:test";
import assert from "node:assert/strict";

import * as storage from "../assets/js/timebox-storage.js";
import { createTask } from "../assets/js/timebox-engine.js";

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
