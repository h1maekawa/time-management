import test from "node:test";
import assert from "node:assert/strict";

import {
  NOTIFICATION_DEFAULTS,
  normalizeNotificationPrefs,
  planNotifications,
  planCompletionNotification,
  buildNotificationMessage,
} from "../assets/js/mini/notification-prefs.js";

test("NOTIFICATION_DEFAULTS: End Notificationはデフォルトoff、他は既定でon（§79）", () => {
  assert.equal(NOTIFICATION_DEFAULTS.endNotification, false);
  assert.equal(NOTIFICATION_DEFAULTS.taskStartNotification, true);
  assert.equal(NOTIFICATION_DEFAULTS.fiveMinutesBefore, true);
  assert.equal(NOTIFICATION_DEFAULTS.showNextAfterComplete, true);
});

test("normalizeNotificationPrefs: 未設定/一部欠けた入力を安全に補う", () => {
  assert.deepEqual(normalizeNotificationPrefs(undefined), NOTIFICATION_DEFAULTS);
  assert.equal(normalizeNotificationPrefs({ endNotification: true }).endNotification, true);
  assert.equal(normalizeNotificationPrefs({ endNotification: true }).taskStartNotification, true);
});

test("planNotifications: ちょうど開始分でtask-startが1回だけ立つ", () => {
  const summary = { currentBlock: { title: "商談準備", start: "10:00", end: "10:45" }, nextBlock: null };
  const prefs = normalizeNotificationPrefs();

  const atStart = planNotifications({ summary, prefs, nowHHMM: "10:00" });
  assert.deepEqual(atStart.map((n) => n.kind), ["task-start"]);

  const oneMinuteLater = planNotifications({ summary, prefs, nowHHMM: "10:01" });
  assert.deepEqual(oneMinuteLater, []); // 同じtickを2回処理しない前提（呼び出し側が1分ごとにしか呼ばない）
});

test("planNotifications: 開始5分前ちょうどでfive-min-beforeが立つ", () => {
  const summary = { currentBlock: null, nextBlock: { title: "週次資料", start: "11:00", end: "12:00" } };
  const prefs = normalizeNotificationPrefs();

  const fireMinutesBefore = planNotifications({ summary, prefs, nowHHMM: "10:55" });
  assert.deepEqual(fireMinutesBefore.map((n) => n.kind), ["five-min-before"]);

  const tooEarly = planNotifications({ summary, prefs, nowHHMM: "10:50" });
  assert.deepEqual(tooEarly, []);
});

test("planNotifications: endNotificationはデフォルトOFFのため、終了時刻ちょうどでも何も出ない", () => {
  const summary = { currentBlock: { title: "商談準備", start: "10:00", end: "10:45" }, nextBlock: null };
  const prefs = normalizeNotificationPrefs();
  assert.deepEqual(planNotifications({ summary, prefs, nowHHMM: "10:45" }), []);
});

test("planNotifications: endNotificationをONにすると終了時刻ちょうどで立つ", () => {
  const summary = { currentBlock: { title: "商談準備", start: "10:00", end: "10:45" }, nextBlock: null };
  const prefs = normalizeNotificationPrefs({ endNotification: true });
  assert.deepEqual(planNotifications({ summary, prefs, nowHHMM: "10:45" }).map((n) => n.kind), ["end"]);
});

test("planNotifications: トグルOFFならCloud設定に関わらず出ない（過剰通知禁止の裏返し）", () => {
  const summary = { currentBlock: { title: "商談準備", start: "10:00", end: "10:45" }, nextBlock: null };
  const prefs = normalizeNotificationPrefs({ taskStartNotification: false });
  assert.deepEqual(planNotifications({ summary, prefs, nowHHMM: "10:00" }), []);
});

test("planCompletionNotification: showNextAfterComplete=trueかつnextBlockがあれば通知案を返す", () => {
  const prefs = normalizeNotificationPrefs();
  const plan = planCompletionNotification({ prefs, nextBlock: { title: "週次資料" } });
  assert.equal(plan.kind, "next-after-complete");
  assert.equal(plan.block.title, "週次資料");
});

test("planCompletionNotification: nextBlockが無い、またはトグルOFFならnull", () => {
  const prefs = normalizeNotificationPrefs();
  assert.equal(planCompletionNotification({ prefs, nextBlock: null }), null);
  assert.equal(
    planCompletionNotification({ prefs: normalizeNotificationPrefs({ showNextAfterComplete: false }), nextBlock: { title: "x" } }),
    null
  );
});

test("buildNotificationMessage: プライバシー設定offでタスク名を出さない（§87）", () => {
  const withTitle = buildNotificationMessage("task-start", { title: "商談準備" }, { showTaskTitle: true });
  assert.match(withTitle.body, /商談準備/);

  const withoutTitle = buildNotificationMessage("task-start", { title: "商談準備" }, { showTaskTitle: false });
  assert.doesNotMatch(withoutTitle.body, /商談準備/);
  assert.match(withoutTitle.body, /DAYLOOPの予定/);
});
