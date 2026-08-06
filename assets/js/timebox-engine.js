/**
 * Timebox OS — 時間割エンジン。
 *
 * ここにはブラウザ固有の処理を書かない（DOM・localStorageを触らない）。
 * 純粋な関数だけにしておくことで `node --test` からそのまま検証できる。
 *
 * 時刻計算はAIに任せず決定的に行う。同じ入力なら毎回同じ時間割になることが、
 * 「今日はこれをやる」と決めきるための前提になる。
 */

// ─── 定数・区分 ────────────────────────────────────────────

/** タスクの仕分け先。画面のタブと1:1で対応する */
export const TRIAGE = [
  { id: "today", label: "今日やる", hint: "今日の時間割へ入れる" },
  { id: "scheduled", label: "予定に入れる", hint: "日付を決めて後日やる" },
  { id: "waiting", label: "回答待ち", hint: "相手の返事を待っている" },
  { id: "someday", label: "いつかやる", hint: "今は決めない" },
  { id: "dropped", label: "やらない", hint: "やらないと決めた" },
];

export const TRIAGE_IDS = TRIAGE.map((t) => t.id);

/** 仕事か生活か。所要時間とは独立した軸で、入れられる枠が変わる */
export const CATEGORIES = [
  { id: "work", label: "仕事", icon: "💼", color: "#2b6cb0" },
  { id: "life", label: "生活", icon: "🏠", color: "#2f855a" },
];

export function categoryOf(id) {
  return CATEGORIES.find((c) => c.id === id);
}

/** その行動に向いている時間帯 */
export const TIME_HINTS = [
  { id: "any", label: "いつでも" },
  { id: "morning", label: "朝" },
  { id: "daytime", label: "日中" },
  { id: "evening", label: "夜" },
];

/** 各ヒントが指す時間帯（分）。枠との重なりで判定する */
export const TIME_HINT_RANGES = {
  morning: [4 * 60, 11 * 60],
  daytime: [9 * 60, 18 * 60],
  evening: [17 * 60, 24 * 60],
};

/** ブロックの間に空ける転換時間（分） */
export const BUFFER_MINUTES = 10;

/** タイムラインへ落としたときに丸める単位（分） */
export const SNAP_MINUTES = 15;

export const DAY_MINUTES = 24 * 60;

export const WEEKDAY_LABELS = ["日", "月", "火", "水", "木", "金", "土"];

// ─── プラン（課金）判定 ────────────────────────────────────
// 初期版は free だけで動くが、後から有料機能を足せるよう入口を用意しておく。

/** @type {Record<string, Record<string, boolean>>} */
export const PLAN_FEATURES = {
  free: {
    localPlanning: true,
    icsExport: true,
    googleCalendarSync: false,
    cloudBackup: false,
    multiDeviceSync: false,
    aiInsights: false,
    automationRules: false,
    unlimitedHistory: false,
  },
  founder: {
    localPlanning: true,
    icsExport: true,
    googleCalendarSync: true,
    cloudBackup: true,
    multiDeviceSync: true,
    aiInsights: true,
    automationRules: false,
    unlimitedHistory: false,
  },
  standard: {
    localPlanning: true,
    icsExport: true,
    googleCalendarSync: true,
    cloudBackup: true,
    multiDeviceSync: true,
    aiInsights: true,
    automationRules: true,
    unlimitedHistory: true,
  },
};

/** 無料プランでの履歴保持日数。Founder以上は90日、Standardは無制限 */
export const HISTORY_DAYS = { free: 7, founder: 90, standard: Infinity };

export function hasFeature(plan, feature) {
  const features = PLAN_FEATURES[plan] ?? PLAN_FEATURES.free;
  return Boolean(features[feature]);
}

// ─── 時刻ユーティリティ ────────────────────────────────────

export function toMinutes(hhmm) {
  const [h, m] = String(hhmm).split(":").map(Number);
  return (h || 0) * 60 + (m || 0);
}

export function toHHMM(minutes) {
  const clamped = Math.max(0, Math.min(DAY_MINUTES, Math.round(minutes)));
  const h = Math.floor(clamped / 60);
  const m = clamped % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

export function formatDuration(minutes) {
  if (!minutes || minutes <= 0) return "0分";
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (h === 0) return `${m}分`;
  if (m === 0) return `${h}時間`;
  return `${h}時間${m}分`;
}

/** 端末のローカル日付 (YYYY-MM-DD)。利用者の生活時間に合わせる */
export function todayLocal(now = new Date()) {
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, "0");
  const d = String(now.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

/** 端末のローカル時刻 (HH:MM) */
export function nowHHMM(now = new Date()) {
  return `${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}`;
}

/** "YYYY-MM-DD" を n 日ずらす */
export function shiftDate(date, days) {
  const [y, m, d] = date.split("-").map(Number);
  const base = new Date(y, m - 1, d);
  base.setDate(base.getDate() + days);
  return todayLocal(base);
}

/** 0=日曜 〜 6=土曜 */
export function weekdayOf(date) {
  const [y, m, d] = date.split("-").map(Number);
  return new Date(y, m - 1, d).getDay();
}

// ─── 1日の枠（時間割の器） ─────────────────────────────────

/**
 * 初期テンプレート。出発点でしかないので、画面から生活に合わせて編集する。
 * 平日は日中を仕事、朝晩を自分の時間に。土日は終日プライベート。
 */
export function defaultWeeklyTemplate() {
  const weekday = [
    { id: "morning", label: "朝の準備", start: "07:00", end: "09:00", category: "life" },
    { id: "am", label: "午前の仕事", start: "09:00", end: "12:00", category: "work" },
    { id: "lunch", label: "昼休み", start: "12:00", end: "13:00", category: "life" },
    { id: "pm", label: "午後の仕事", start: "13:00", end: "18:00", category: "work" },
    { id: "evening", label: "自分の時間", start: "18:00", end: "22:00", category: "life" },
  ];
  const holiday = [
    { id: "am", label: "午前", start: "08:00", end: "12:00", category: "life" },
    { id: "pm", label: "午後", start: "13:00", end: "22:00", category: "life" },
  ];
  const clone = (windows, prefix) => windows.map((w) => ({ ...w, id: `${prefix}-${w.id}` }));

  return {
    days: [
      clone(holiday, "sun"),
      clone(weekday, "mon"),
      clone(weekday, "tue"),
      clone(weekday, "wed"),
      clone(weekday, "thu"),
      clone(weekday, "fri"),
      clone(holiday, "sat"),
    ],
    updatedAt: new Date().toISOString(),
  };
}

/** その日付に適用される枠を取り出す */
export function windowsForDate(template, date) {
  return template?.days?.[weekdayOf(date)] ?? [];
}

/** 枠の合計時間（分）をカテゴリ別に集計する */
export function windowCapacity(windows) {
  const capacity = { work: 0, life: 0 };
  for (const w of windows) {
    const minutes = Math.max(0, toMinutes(w.end) - toMinutes(w.start));
    capacity[w.category] = (capacity[w.category] ?? 0) + minutes;
  }
  return capacity;
}

// ─── タスク ────────────────────────────────────────────────

let seq = 0;

export function createTask(input = {}) {
  const title = String(input.title ?? "").trim();
  seq += 1;
  return {
    id: input.id ?? `t${Date.now().toString(36)}${seq.toString(36)}`,
    title,
    minutes: clampMinutes(input.minutes ?? 30),
    priority: clampPriority(input.priority ?? 3),
    /** 今日やる / 予定に入れる / 回答待ち / いつかやる / やらない */
    triage: TRIAGE_IDS.includes(input.triage) ? input.triage : "today",
    /** 実行する日 (YYYY-MM-DD)。today / scheduled のときだけ意味を持つ */
    plannedDate: input.plannedDate ?? null,
    /** 締切 (YYYY-MM-DD)。未設定なら null */
    deadline: input.deadline ?? null,
    category: input.category === "life" ? "life" : "work",
    timeHint: TIME_HINTS.some((h) => h.id === input.timeHint) ? input.timeHint : "any",
    done: Boolean(input.done),
    /** 何日ぶん持ち越したか。多いほど先に配置される */
    carryCount: Number(input.carryCount ?? 0),
    /** 直前に持ち越した元の日付 */
    carriedFrom: input.carriedFrom ?? null,
    /** 手動で固定した開始時刻 "HH:MM"。ある間は自動配置より優先される */
    pinnedStart: input.pinnedStart ?? null,
    createdAt: input.createdAt ?? new Date().toISOString(),
  };
}

export function clampMinutes(value) {
  const n = Math.round(Number(value) || 0);
  if (!Number.isFinite(n) || n < 5) return 5;
  return Math.min(480, n);
}

export function clampPriority(value) {
  const n = Math.round(Number(value) || 0);
  return Math.max(1, Math.min(5, n || 3));
}

/**
 * 複数行のテキストを1行=1タスクとして取り込む。
 * 空行と重複は落とす。並び順は入力順のまま。
 */
export function parseTaskLines(text, defaults = {}) {
  const seen = new Set();
  return String(text ?? "")
    .split(/\r?\n/)
    .map((line) => line.replace(/^[-・*\s]+/, "").trim())
    .filter((line) => {
      if (!line) return false;
      if (seen.has(line)) return false;
      seen.add(line);
      return true;
    })
    .map((title) => createTask({ ...defaults, title }));
}

/** その日の時間割に載るタスクか */
export function isScheduledFor(task, date) {
  if (task.triage === "today") return task.plannedDate === date;
  if (task.triage === "scheduled") return task.plannedDate === date;
  return false;
}

/**
 * 並び順のルール（仕様どおりの優先順位）:
 *   1. 締切が近いもの
 *   2. 優先度が高いもの
 *   3. 持ち越し回数が多いもの
 *   4. 所要時間が長いもの
 * ※ 手動固定は並び順ではなく「先に置く」で表現する（buildSchedule参照）
 */
export function orderTasks(tasks) {
  const deadlineRank = (task) => (task.deadline ? task.deadline : "9999-99-99");
  return [...tasks]
    .filter((task) => !task.done)
    .sort(
      (a, b) =>
        deadlineRank(a).localeCompare(deadlineRank(b)) ||
        b.priority - a.priority ||
        (b.carryCount ?? 0) - (a.carryCount ?? 0) ||
        b.minutes - a.minutes ||
        String(a.createdAt).localeCompare(String(b.createdAt))
    );
}

// ─── 時間割の生成 ──────────────────────────────────────────

/**
 * 指定タスクが入る最早の開始時刻を探す。
 * カテゴリの合う枠だけを候補にし、時間帯の希望に重なる枠から先に試す。
 * どこにも入らなければ null（＝はみ出し）。
 */
function findSlot(windows, busy, task, floor) {
  const candidates = windows.filter((w) => w.category === task.category);
  const hint =
    task.timeHint && task.timeHint !== "any" ? TIME_HINT_RANGES[task.timeHint] : null;
  const overlapsHint = (w) =>
    hint ? toMinutes(w.start) < hint[1] && toMinutes(w.end) > hint[0] : false;

  const ordered = hint
    ? [...candidates.filter(overlapsHint), ...candidates.filter((w) => !overlapsHint(w))]
    : candidates;

  for (const window of ordered) {
    const windowEnd = toMinutes(window.end);
    let cursor = Math.max(toMinutes(window.start), floor);

    const overlapping = busy
      .filter((b) => b.end > cursor && b.start < windowEnd)
      .sort((a, b) => a.start - b.start);

    for (const block of overlapping) {
      if (cursor + task.minutes <= block.start) return cursor;
      cursor = Math.max(cursor, block.end + BUFFER_MINUTES);
    }
    if (cursor + task.minutes <= windowEnd) return cursor;
  }
  return null;
}

function toBlock(task, start, pinned) {
  return {
    taskId: task.id,
    title: task.title,
    start: toHHMM(start),
    end: toHHMM(start + task.minutes),
    minutes: task.minutes,
    priority: task.priority,
    category: task.category,
    done: Boolean(task.done),
    pinned: Boolean(pinned),
  };
}

/**
 * 時間割を組む。
 *
 * @param {{date: string, windows: Array, tasks: Array}} plan
 * @param {{fromHHMM?: string}} [options] fromHHMM を渡すとその時刻以降だけを使う（今から詰め直す）
 * @returns {{blocks: Array, overflow: Array, windows: Array, free: Array}}
 */
export function buildSchedule(plan, options = {}) {
  const windows = plan.windows ?? [];
  const floor = options.fromHHMM ? toMinutes(options.fromHHMM) : 0;

  const pending = orderTasks(plan.tasks ?? []);
  const blocks = [];
  const overflow = [];
  const busy = [];

  // 1. 手動で固定されたタスクを先に置く。指定した時刻は必ず尊重する
  for (const task of pending) {
    if (!task.pinnedStart) continue;
    const start = toMinutes(task.pinnedStart);
    blocks.push(toBlock(task, start, true));
    busy.push({ start, end: start + task.minutes });
  }

  // 2. 残りを空いている枠へ順番に詰める
  for (const task of pending) {
    if (task.pinnedStart) continue;
    const start = findSlot(windows, busy, task, floor);
    if (start === null) {
      overflow.push(task);
      continue;
    }
    blocks.push(toBlock(task, start, false));
    busy.push({ start, end: start + task.minutes });
  }

  blocks.sort((a, b) => toMinutes(a.start) - toMinutes(b.start));
  return { blocks, overflow, windows, free: freeSlots(windows, blocks) };
}

/** 枠の中で、まだ何も入っていない時間帯（5分未満の端数は無視する） */
export function freeSlots(windows, blocks) {
  const busy = blocks
    .map((b) => ({ start: toMinutes(b.start), end: toMinutes(b.end) }))
    .sort((a, b) => a.start - b.start);

  const free = [];
  for (const window of windows) {
    let cursor = toMinutes(window.start);
    const end = toMinutes(window.end);
    for (const block of busy) {
      if (block.end <= cursor || block.start >= end) continue;
      if (block.start - cursor >= 5) {
        free.push({ start: toHHMM(cursor), end: toHHMM(block.start), category: window.category });
      }
      cursor = Math.max(cursor, block.end);
    }
    if (end - cursor >= 5) {
      free.push({ start: toHHMM(cursor), end: toHHMM(end), category: window.category });
    }
  }
  return free;
}

// ─── 集計 ──────────────────────────────────────────────────

export function summarize(plan, currentHHMM) {
  const tasks = plan.tasks ?? [];
  const blocks = plan.blocks ?? [];
  const total = tasks.length;
  const done = tasks.filter((t) => t.done).length;

  const byCategory = { work: 0, life: 0 };
  for (const task of tasks) byCategory[task.category] = (byCategory[task.category] ?? 0) + 1;

  const plannedMinutes = tasks.filter((t) => !t.done).reduce((sum, t) => sum + t.minutes, 0);
  const capacity = windowCapacity(plan.windows ?? []);

  const used = { work: 0, life: 0 };
  for (const block of blocks) {
    used[block.category] = (used[block.category] ?? 0) + (toMinutes(block.end) - toMinutes(block.start));
  }

  const now = toMinutes(currentHHMM);
  let currentBlock = null;
  let nextBlock = null;
  for (const block of blocks) {
    const start = toMinutes(block.start);
    const end = toMinutes(block.end);
    if (now >= start && now < end && !block.done) currentBlock = block;
    if (start > now && !nextBlock && !block.done) nextBlock = block;
  }

  return {
    total,
    done,
    remaining: total - done,
    completionRate: total === 0 ? 0 : Math.round((done / total) * 100),
    byCategory,
    plannedMinutes,
    capacity,
    used,
    currentBlock,
    nextBlock,
  };
}

// ─── 持ち越し ──────────────────────────────────────────────

/**
 * 前日以前の「今日やる」で終わらなかったタスクを、今日へ引き継ぐ。
 * 固定時刻は今日の枠に合わないので必ず外す（そのままだと過去の時刻に貼りつく）。
 *
 * @returns {{tasks: Array, carried: number}} 新しいタスク配列と引き継いだ件数
 */
export function carryOverTasks(tasks, date) {
  let carried = 0;
  const next = tasks.map((task) => {
    const stale =
      !task.done &&
      task.triage === "today" &&
      typeof task.plannedDate === "string" &&
      task.plannedDate < date;
    if (!stale) return task;
    carried += 1;
    return {
      ...task,
      plannedDate: date,
      carryCount: (task.carryCount ?? 0) + 1,
      carriedFrom: task.plannedDate,
      pinnedStart: null,
    };
  });
  return { tasks: next, carried };
}

/** 「予定に入れる」で今日が来たタスクを、今日やるへ引き上げる */
export function promoteScheduled(tasks, date) {
  let promoted = 0;
  const next = tasks.map((task) => {
    if (task.triage !== "scheduled" || task.plannedDate !== date || task.done) return task;
    promoted += 1;
    return { ...task, triage: "today" };
  });
  return { tasks: next, promoted };
}

// ─── ICS書き出し ───────────────────────────────────────────

function escapeIcs(text) {
  return String(text).replace(/([,;\\])/g, "\\$1").replace(/\r?\n/g, "\\n");
}

const utf8 = new TextEncoder();

/** RFC5545は1行75オクテットまで。日本語が入ると簡単に超えるので折り返す */
function foldLine(line) {
  if (utf8.encode(line).length <= 73) return line;

  const out = [];
  let current = "";
  let size = 0;
  for (const char of line) {
    const charSize = utf8.encode(char).length;
    if (size + charSize > 73) {
      out.push(current);
      current = "";
      size = 0;
    }
    current += char;
    size += charSize;
  }
  if (current) out.push(current);
  return out.join("\r\n ");
}

/** UTCのタイムスタンプ（DTSTAMP用） */
function utcStamp(date) {
  return date.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
}

/**
 * 時間割をICSにする。
 *
 * 日時はタイムゾーンを付けない「フローティング時刻」で書き出す。
 * 取り込んだカレンダー側のタイムゾーンで9:00は9:00として扱われるため、
 * 利用者がどの地域にいてもズレない。
 */
export function buildIcs(plan, options = {}) {
  const now = options.now ?? new Date();
  const stamp = utcStamp(now);
  const dateCompact = plan.date.replace(/-/g, "");

  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//maemichi//Timebox OS//JA",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
  ];

  for (const block of plan.blocks ?? []) {
    const cat = categoryOf(block.category);
    lines.push(
      "BEGIN:VEVENT",
      `UID:timebox-${plan.date}-${block.taskId}@maemichi.com`,
      `DTSTAMP:${stamp}`,
      `DTSTART:${dateCompact}T${block.start.replace(":", "")}00`,
      `DTEND:${dateCompact}T${block.end.replace(":", "")}00`,
      `SUMMARY:${escapeIcs(cat ? `${cat.icon} ${block.title}` : block.title)}`,
      `DESCRIPTION:${escapeIcs(
        [
          "Timebox OS で組んだ時間割",
          cat ? `区分: ${cat.label}` : "",
          `優先度: ${"★".repeat(block.priority)}`,
        ]
          .filter(Boolean)
          .join("\n")
      )}`,
      "END:VEVENT"
    );
  }

  lines.push("END:VCALENDAR");
  return lines.map(foldLine).join("\r\n");
}
