import test from "node:test";
import assert from "node:assert/strict";

import {
  buildIcs,
  buildSchedule,
  carryOverTasks,
  createTask,
  formatDuration,
  freeSlots,
  hasFeature,
  orderTasks,
  parseTaskLines,
  promoteScheduled,
  shiftDate,
  summarize,
  toHHMM,
  toMinutes,
  windowsForDate,
  defaultWeeklyTemplate,
} from "../assets/js/timebox-engine.js";

/** 平日の枠を1組（午前仕事・昼休み・午後仕事・夜は自分の時間） */
const WINDOWS = [
  { id: "am", label: "午前の仕事", start: "09:00", end: "12:00", category: "work" },
  { id: "lunch", label: "昼休み", start: "12:00", end: "13:00", category: "life" },
  { id: "pm", label: "午後の仕事", start: "13:00", end: "18:00", category: "work" },
  { id: "evening", label: "自分の時間", start: "18:00", end: "22:00", category: "life" },
];

function task(overrides) {
  return createTask({ plannedDate: "2026-08-10", ...overrides });
}

function plan(tasks, windows = WINDOWS) {
  return { date: "2026-08-10", windows, tasks };
}

// ─── 時刻ユーティリティ ────────────────────────────────────

test("toMinutes / toHHMM は往復して同じ値になる", () => {
  assert.equal(toMinutes("09:30"), 570);
  assert.equal(toHHMM(570), "09:30");
  assert.equal(toHHMM(-10), "00:00");
  assert.equal(toHHMM(24 * 60 + 30), "24:00");
});

test("formatDuration は日本語で読める形にする", () => {
  assert.equal(formatDuration(0), "0分");
  assert.equal(formatDuration(45), "45分");
  assert.equal(formatDuration(60), "1時間");
  assert.equal(formatDuration(95), "1時間35分");
});

test("shiftDate は月をまたいでも正しく進む", () => {
  assert.equal(shiftDate("2026-08-31", 1), "2026-09-01");
  assert.equal(shiftDate("2026-01-01", -1), "2025-12-31");
});

// ─── 入力の取り込み ────────────────────────────────────────

test("parseTaskLines は1行1タスクにし、空行と重複を落とす", () => {
  const tasks = parseTaskLines("提案資料を修正する\n\n請求書を確認する\n提案資料を修正する\n・本を30分読む");
  assert.deepEqual(
    tasks.map((t) => t.title),
    ["提案資料を修正する", "請求書を確認する", "本を30分読む"]
  );
  assert.equal(tasks[0].minutes, 30);
  assert.equal(tasks[0].priority, 3);
  assert.equal(tasks[0].triage, "today");
});

test("createTask は範囲外の値を丸める", () => {
  assert.equal(createTask({ minutes: 1 }).minutes, 5);
  assert.equal(createTask({ minutes: 9999 }).minutes, 480);
  assert.equal(createTask({ priority: 9 }).priority, 5);
  assert.equal(createTask({ priority: 0 }).priority, 3);
  assert.equal(createTask({ timeHint: "midnight" }).timeHint, "any");
  assert.equal(createTask({ triage: "unknown" }).triage, "today");
});

// ─── 並び順 ────────────────────────────────────────────────

test("orderTasks は 締切→優先度→持ち越し→所要時間 の順に並べる", () => {
  const ordered = orderTasks([
    task({ title: "所要時間が長い", priority: 3, minutes: 90 }),
    task({ title: "持ち越し3回", priority: 3, minutes: 30, carryCount: 3 }),
    task({ title: "優先度5", priority: 5, minutes: 30 }),
    task({ title: "締切が今日", priority: 1, minutes: 15, deadline: "2026-08-10" }),
  ]);
  assert.deepEqual(
    ordered.map((t) => t.title),
    ["締切が今日", "優先度5", "持ち越し3回", "所要時間が長い"]
  );
});

test("orderTasks は完了済みを除く", () => {
  const ordered = orderTasks([task({ title: "済", done: true }), task({ title: "未" })]);
  assert.deepEqual(ordered.map((t) => t.title), ["未"]);
});

// ─── 時間割の生成 ──────────────────────────────────────────

test("buildSchedule はカテゴリの合う枠にだけ入れる", () => {
  const { blocks } = buildSchedule(
    plan([
      task({ title: "見積を作る", category: "work", minutes: 60 }),
      task({ title: "夕食を作る", category: "life", minutes: 60, timeHint: "evening" }),
    ])
  );
  const work = blocks.find((b) => b.title === "見積を作る");
  const life = blocks.find((b) => b.title === "夕食を作る");
  assert.equal(work.start, "09:00");
  assert.equal(work.end, "10:00");
  assert.equal(life.start, "18:00");
});

test("buildSchedule はブロックの間に転換時間を空ける", () => {
  const { blocks } = buildSchedule(
    plan([
      task({ title: "A", minutes: 60, priority: 5 }),
      task({ title: "B", minutes: 30, priority: 4 }),
    ])
  );
  assert.equal(blocks[0].start, "09:00");
  assert.equal(blocks[0].end, "10:00");
  assert.equal(blocks[1].start, "10:10");
});

test("buildSchedule は手動固定した時刻を必ず守る", () => {
  const { blocks } = buildSchedule(
    plan([
      task({ title: "優先度5だが自動", minutes: 60, priority: 5 }),
      task({ title: "14:00に固定", minutes: 30, priority: 1, pinnedStart: "14:00" }),
    ])
  );
  const pinned = blocks.find((b) => b.title === "14:00に固定");
  assert.equal(pinned.start, "14:00");
  assert.equal(pinned.pinned, true);
  // 固定を避けて自動配置される
  const auto = blocks.find((b) => b.title === "優先度5だが自動");
  assert.equal(auto.start, "09:00");
});

test("buildSchedule は固定ブロックに重ならないよう後続をずらす", () => {
  const { blocks } = buildSchedule(
    plan([
      task({ title: "固定", minutes: 60, pinnedStart: "09:30" }),
      task({ title: "自動", minutes: 60, priority: 5 }),
    ])
  );
  const auto = blocks.find((b) => b.title === "自動");
  // 09:00〜09:30では60分入らないので、固定ブロック＋転換時間の後ろへ
  assert.equal(auto.start, "10:40");
});

test("buildSchedule は時間帯の希望に合う枠を先に試す", () => {
  const { blocks } = buildSchedule(
    plan([task({ title: "朝に確認する", minutes: 30, category: "life", timeHint: "morning" })], [
      { id: "early", label: "朝", start: "07:00", end: "09:00", category: "life" },
      { id: "night", label: "夜", start: "18:00", end: "22:00", category: "life" },
    ])
  );
  assert.equal(blocks[0].start, "07:00");
});

test("buildSchedule は枠に入らないタスクを overflow に出す", () => {
  const { blocks, overflow } = buildSchedule(
    plan([task({ title: "8時間の作業", minutes: 480, category: "work" })])
  );
  assert.equal(blocks.length, 0);
  assert.deepEqual(overflow.map((t) => t.title), ["8時間の作業"]);
});

test("buildSchedule は fromHHMM 以降だけを使う（今から詰め直す）", () => {
  const { blocks } = buildSchedule(plan([task({ title: "A", minutes: 30 })]), {
    fromHHMM: "14:20",
  });
  assert.equal(blocks[0].start, "14:20");
});

test("buildSchedule は同じ入力なら同じ結果になる", () => {
  const tasks = [
    task({ id: "a", title: "A", minutes: 60, priority: 4, createdAt: "2026-08-10T00:00:00Z" }),
    task({ id: "b", title: "B", minutes: 60, priority: 4, createdAt: "2026-08-10T00:00:01Z" }),
  ];
  const first = buildSchedule(plan(tasks)).blocks;
  const second = buildSchedule(plan(tasks)).blocks;
  assert.deepEqual(first, second);
});

// ─── 空き時間 ──────────────────────────────────────────────

test("freeSlots は枠の中の空きだけを返す", () => {
  const free = freeSlots(
    [{ id: "am", label: "午前", start: "09:00", end: "12:00", category: "work" }],
    [{ start: "09:00", end: "10:00" }, { start: "11:00", end: "11:30" }]
  );
  assert.deepEqual(
    free.map((f) => `${f.start}-${f.end}`),
    ["10:00-11:00", "11:30-12:00"]
  );
});

// ─── 持ち越し ──────────────────────────────────────────────

test("carryOverTasks は昨日の未完了を今日へ引き継ぎ、固定時刻を外す", () => {
  const { tasks, carried } = carryOverTasks(
    [
      task({ title: "終わらなかった", plannedDate: "2026-08-09", pinnedStart: "10:00" }),
      task({ title: "終わった", plannedDate: "2026-08-09", done: true }),
      task({ title: "今日の分", plannedDate: "2026-08-10" }),
    ],
    "2026-08-10"
  );
  assert.equal(carried, 1);
  const moved = tasks.find((t) => t.title === "終わらなかった");
  assert.equal(moved.plannedDate, "2026-08-10");
  assert.equal(moved.carryCount, 1);
  assert.equal(moved.carriedFrom, "2026-08-09");
  assert.equal(moved.pinnedStart, null);
  // 完了済みは動かさない
  assert.equal(tasks.find((t) => t.title === "終わった").plannedDate, "2026-08-09");
});

test("promoteScheduled は予定日が来たタスクを今日やるへ上げる", () => {
  const { tasks, promoted } = promoteScheduled(
    [
      task({ title: "今日の予定", triage: "scheduled", plannedDate: "2026-08-10" }),
      task({ title: "来週の予定", triage: "scheduled", plannedDate: "2026-08-17" }),
    ],
    "2026-08-10"
  );
  assert.equal(promoted, 1);
  assert.equal(tasks[0].triage, "today");
  assert.equal(tasks[1].triage, "scheduled");
});

// ─── 集計 ──────────────────────────────────────────────────

test("summarize は今やるブロックと次のブロックを返す", () => {
  const tasks = [task({ title: "A", minutes: 60 }), task({ title: "B", minutes: 30, priority: 2 })];
  const { blocks } = buildSchedule(plan(tasks));
  const summary = summarize({ ...plan(tasks), blocks }, "09:30");
  assert.equal(summary.currentBlock.title, "A");
  assert.equal(summary.nextBlock.title, "B");
  assert.equal(summary.total, 2);
  assert.equal(summary.completionRate, 0);
});

// ─── 枠テンプレート ────────────────────────────────────────

test("windowsForDate は曜日ごとの枠を返す", () => {
  const template = defaultWeeklyTemplate();
  // 2026-08-10 は月曜、2026-08-09 は日曜
  assert.ok(windowsForDate(template, "2026-08-10").some((w) => w.category === "work"));
  assert.ok(windowsForDate(template, "2026-08-09").every((w) => w.category === "life"));
});

// ─── ICS ───────────────────────────────────────────────────

test("buildIcs はブロックぶんのVEVENTを作る", () => {
  const tasks = [task({ title: "見積を作る", minutes: 60 })];
  const { blocks } = buildSchedule(plan(tasks));
  const ics = buildIcs({ date: "2026-08-10", blocks }, { now: new Date("2026-08-10T00:00:00Z") });

  assert.match(ics, /^BEGIN:VCALENDAR/);
  assert.match(ics, /END:VCALENDAR$/);
  assert.equal((ics.match(/BEGIN:VEVENT/g) ?? []).length, 1);
  // タイムゾーンを付けないフローティング時刻（取り込み先の時間帯で解釈される）
  assert.match(ics, /DTSTART:20260810T090000\r\n/);
  assert.match(ics, /DTEND:20260810T100000\r\n/);
  assert.match(ics, /SUMMARY:💼 見積を作る/);
  assert.match(ics, /\r\n/);
});

test("buildIcs はカンマなどをエスケープする", () => {
  const ics = buildIcs(
    {
      date: "2026-08-10",
      blocks: [
        {
          taskId: "x",
          title: "A社, B社へ連絡",
          start: "09:00",
          end: "09:30",
          priority: 3,
          category: "work",
        },
      ],
    },
    { now: new Date("2026-08-10T00:00:00Z") }
  );
  assert.match(ics, /SUMMARY:💼 A社\\, B社へ連絡/);
});

// ─── プラン判定 ────────────────────────────────────────────

test("hasFeature は無料プランで有料機能を閉じる", () => {
  assert.equal(hasFeature("free", "localPlanning"), true);
  assert.equal(hasFeature("free", "icsExport"), true);
  assert.equal(hasFeature("free", "googleCalendarSync"), false);
  assert.equal(hasFeature("founder", "googleCalendarSync"), true);
  assert.equal(hasFeature("founder", "automationRules"), false);
  assert.equal(hasFeature("standard", "automationRules"), true);
  // 未知のプランは無料扱いにする（課金状態が壊れても機能が漏れない）
  assert.equal(hasFeature("unknown", "googleCalendarSync"), false);
});
