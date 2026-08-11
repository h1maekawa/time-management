/**
 * 実行サポート通知（§78/§79/§87）の純粋ロジック。
 *
 * 実際のNotification APIの呼び出し（許可要求・表示）はtimebox.js側で行い、
 * ここでは「今のタイミングでどの種類の通知を出すべきか」「本文に何を書くか」だけを決める。
 * 1分ごとのtick（既存のsetInterval）で呼ばれる前提のため、`start`/`end`ちょうどの分・
 * 5分前ちょうどの分だけ真になる判定にしてあり、重複通知や連続通知を避けている（§78 過剰通知禁止）。
 */
import { toMinutes } from "../timebox-engine.js";

export const NOTIFICATION_DEFAULTS = {
  desktopMiniEnabled: true,
  taskStartNotification: true,
  fiveMinutesBefore: true,
  showNextAfterComplete: true,
  endNotification: false, // §79: Default OFF
  showTaskTitleInNotification: true, // §87: タスク名を表示 / OFFなら「DAYLOOPの予定があります」
};

export function normalizeNotificationPrefs(raw) {
  return { ...NOTIFICATION_DEFAULTS, ...(raw ?? {}) };
}

/**
 * @param {{currentBlock: object|null, nextBlock: object|null}} summary
 * @param {ReturnType<typeof normalizeNotificationPrefs>} prefs
 * @param {string} nowHHMM
 * @returns {{kind: "task-start"|"five-min-before"|"end", block: object}[]}
 */
export function planNotifications({ summary, prefs, nowHHMM }) {
  const now = toMinutes(nowHHMM);
  const toFire = [];

  if (prefs.taskStartNotification && summary.currentBlock) {
    if (toMinutes(summary.currentBlock.start) === now) {
      toFire.push({ kind: "task-start", block: summary.currentBlock });
    }
  }

  if (prefs.fiveMinutesBefore && summary.nextBlock) {
    if (toMinutes(summary.nextBlock.start) - now === 5) {
      toFire.push({ kind: "five-min-before", block: summary.nextBlock });
    }
  }

  if (prefs.endNotification && summary.currentBlock) {
    if (toMinutes(summary.currentBlock.end) === now) {
      toFire.push({ kind: "end", block: summary.currentBlock });
    }
  }

  return toFire;
}

/** 完了直後の「次は〜」通知（§78）。ポーリングではなく完了アクションから直接呼ぶ。 */
export function planCompletionNotification({ prefs, nextBlock }) {
  if (!prefs.showNextAfterComplete || !nextBlock) return null;
  return { kind: "next-after-complete", block: nextBlock };
}

const MESSAGES = {
  "task-start": (title) => `今やること：${title}`,
  "five-min-before": (title) => `まもなく『${title}』です`,
  end: () => "予定時間になりました。",
  "next-after-complete": (title) => `次は『${title}』です`,
};

/** 通知本文を組み立てる。プライバシー設定でタスク名を出さない選択もできる（§87）。 */
export function buildNotificationMessage(kind, block, { showTaskTitle = true } = {}) {
  const title = "DAYLOOP";
  if (!showTaskTitle) {
    return { title, body: "DAYLOOPの予定があります。" };
  }
  const build = MESSAGES[kind];
  return { title, body: build ? build(block?.title ?? "") : "DAYLOOPの予定があります。" };
}
