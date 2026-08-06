/**
 * Timebox OS — 画面。
 *
 * 役割分担:
 *   timebox-engine.js  … 時間割の計算（純粋関数・テスト対象）
 *   timebox-storage.js … 端末への保存
 *   timebox.js         … 描画とユーザー操作（このファイル）
 *
 * 状態は state ひとつに集約し、変更したら必ず save() → render() を通す。
 * 途中でDOMだけ書き換えないことで、再読み込み後の表示とズレないようにする。
 */

import {
  CATEGORIES,
  DAY_MINUTES,
  HISTORY_DAYS,
  SNAP_MINUTES,
  TIME_HINTS,
  TRIAGE,
  buildIcs,
  buildSchedule,
  carryOverTasks,
  categoryOf,
  clampMinutes,
  clampPriority,
  formatDuration,
  freeSlots,
  hasFeature,
  parseTaskLines,
  promoteScheduled,
  summarize,
  toHHMM,
  toMinutes,
  todayLocal,
  nowHHMM,
  windowsForDate,
} from "./timebox-engine.js";

import * as storage from "./timebox-storage.js";

/** タイムラインの1時間あたりの高さ(px) */
const HOUR_HEIGHT = 44;

const el = (id) => document.getElementById(id);

let state = storage.load();
let today = todayLocal();
let activeTab = "today";
let dragTaskId = null;
/** 画面上部に出すお知らせ（描画のたびに作り直す一時的なもの） */
let notices = [];
/** 枠の編集中バッファ。保存を押すまで本体へ反映しない */
let windowDraft = null;

// ─── 起動 ──────────────────────────────────────────────────

function init() {
  rollover();
  bindEvents();
  render();

  // 現在時刻の線と「今やること」を1分ごとに更新する
  setInterval(() => {
    if (todayLocal() !== today) {
      today = todayLocal();
      rollover();
    }
    render();
  }, 60 * 1000);
}

/** 日付が変わったときの処理。持ち越しと予定日の引き上げを行う */
function rollover() {
  const promoted = promoteScheduled(state.tasks, today);
  const carried = carryOverTasks(promoted.tasks, today);

  state.tasks = carried.tasks;
  state.settings = { ...state.settings, lastOpenedDate: today };
  state = storage.pruneHistory(state, HISTORY_DAYS[plan()] ?? HISTORY_DAYS.free, today);
  ensureDay();
  state = storage.save(state);

  if (carried.carried > 0) {
    notices.push({
      kind: "warn",
      text: `昨日までの未完了 ${carried.carried}件を今日へ持ち越しました。今日やらないものは仕分けを変えてください。`,
    });
  }
  if (promoted.promoted > 0) {
    notices.push({ kind: "info", text: `予定していた ${promoted.promoted}件が今日になりました。` });
  }
}

/** 今日の器（枠と時間割）を用意する */
function ensureDay() {
  const existing = state.days[today];
  if (existing && Array.isArray(existing.windows) && existing.windows.length > 0) return existing;
  state.days[today] = {
    date: today,
    windows: windowsForDate(state.template, today).map((w) => ({ ...w })),
    blocks: existing?.blocks ?? [],
    updatedAt: new Date().toISOString(),
  };
  return state.days[today];
}

function plan() {
  return state.settings?.plan ?? "free";
}

function day() {
  return ensureDay();
}

function todayTasks() {
  return state.tasks.filter((t) => t.triage === "today" && t.plannedDate === today);
}

function commit() {
  state = storage.save(state);
  render();
}

// ─── 描画 ──────────────────────────────────────────────────

function esc(text) {
  return String(text ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function render() {
  const current = day();
  const tasks = todayTasks();
  const blocks = decorateBlocks(current.blocks ?? [], tasks);
  const summary = summarize({ ...current, tasks, blocks }, nowHHMM());

  renderStatus(summary);
  renderNotices();
  renderTabs();
  renderTasks();
  renderCapacity(summary);
  renderTimeline(current.windows ?? [], blocks);
  renderOverflow(tasks, blocks);
  renderStorageState();
  syncButtons(tasks, blocks);
}

/** 保存したブロックへ、最新のタスク状態（完了・削除）を重ねる */
function decorateBlocks(blocks, tasks) {
  const byId = new Map(tasks.map((t) => [t.id, t]));
  return blocks
    .filter((b) => byId.has(b.taskId))
    .map((b) => {
      const task = byId.get(b.taskId);
      return { ...b, title: task.title, done: task.done, pinned: Boolean(task.pinnedStart) };
    });
}

function renderStatus(summary) {
  const date = new Date(`${today}T00:00:00`);
  el("tb-date").textContent = new Intl.DateTimeFormat("ja-JP", {
    month: "long",
    day: "numeric",
    weekday: "short",
  }).format(date);
  el("tb-now").textContent = `現在 ${nowHHMM()}${
    summary.currentBlock ? ` — いまは「${summary.currentBlock.title}」の時間です` : ""
  }${!summary.currentBlock && summary.nextBlock ? ` — 次は ${summary.nextBlock.start} 「${summary.nextBlock.title}」` : ""}`;

  const kpis = [
    { label: "今日やること", value: `${summary.total}件` },
    { label: "予定時間", value: formatDuration(summary.plannedMinutes) },
    { label: "完了", value: `${summary.done}件 / ${summary.completionRate}%` },
  ];
  el("tb-kpis").innerHTML = kpis
    .map(
      (k) =>
        `<div class="tb-kpi"><p class="tb-kpi-label">${esc(k.label)}</p><p class="tb-kpi-value">${esc(k.value)}</p></div>`
    )
    .join("");
}

function renderNotices() {
  el("tb-notices").innerHTML = notices
    .map((n) => `<div class="tb-notice tb-notice-${n.kind}"><span>${esc(n.text)}</span></div>`)
    .join("");
}

function notify(kind, text) {
  notices = [{ kind, text }];
  render();
}

function renderTabs() {
  const counts = {};
  for (const task of state.tasks) counts[task.triage] = (counts[task.triage] ?? 0) + 1;

  el("tb-tabs").innerHTML = TRIAGE.map(
    (t) => `<button type="button" class="tb-tab" role="tab" data-action="tab" data-tab="${t.id}"
      aria-selected="${t.id === activeTab}">${esc(t.label)}<span class="tb-tab-count">${counts[t.id] ?? 0}</span></button>`
  ).join("");

  el("tb-triage-hint").textContent = TRIAGE.find((t) => t.id === activeTab)?.hint ?? "";
}

function renderTasks() {
  const list = state.tasks
    .filter((t) => t.triage === activeTab)
    .filter((t) => (activeTab === "today" ? t.plannedDate === today : true));

  if (list.length === 0) {
    el("tb-tasks").innerHTML = `<li class="tb-empty">${
      activeTab === "today"
        ? "上の入力欄に、今日やることを1行ずつ書き出してください。"
        : "ここに入れたタスクはありません。"
    }</li>`;
    return;
  }

  el("tb-tasks").innerHTML = list.map(taskRow).join("");
}

function taskRow(task) {
  const cat = categoryOf(task.category);
  const stars = [1, 2, 3, 4, 5]
    .map(
      (p) =>
        `<button type="button" class="tb-star ${p <= task.priority ? "is-on" : ""}"
          data-action="priority" data-id="${task.id}" data-value="${p}"
          aria-label="優先度${p}">★</button>`
    )
    .join("");

  const triageOptions = TRIAGE.map(
    (t) => `<option value="${t.id}" ${t.id === task.triage ? "selected" : ""}>${esc(t.label)}</option>`
  ).join("");

  const hintOptions = TIME_HINTS.map(
    (h) => `<option value="${h.id}" ${h.id === task.timeHint ? "selected" : ""}>${esc(h.label)}</option>`
  ).join("");

  const scheduling =
    task.triage === "today" || task.triage === "scheduled"
      ? `<label class="tb-inline-field">${task.triage === "scheduled" ? "予定日" : "固定"}
           ${
             task.triage === "scheduled"
               ? `<input type="date" class="tb-date" data-action="planned-date" data-id="${task.id}" value="${esc(task.plannedDate ?? "")}">`
               : `<input type="time" class="tb-time" step="900" data-action="pin" data-id="${task.id}" value="${esc(task.pinnedStart ?? "")}">`
           }
         </label>`
      : "";

  return `<li class="tb-task ${task.done ? "is-done" : ""}" draggable="true" data-id="${task.id}">
    <div class="tb-task-main">
      <button type="button" class="tb-check" data-action="done" data-id="${task.id}"
        aria-pressed="${task.done}" aria-label="${task.done ? "未完了に戻す" : "完了にする"}">${task.done ? "✓" : ""}</button>
      <span class="tb-task-title">${esc(task.title)}</span>
      <button type="button" class="tb-task-remove" data-action="remove" data-id="${task.id}" aria-label="削除">✕</button>
    </div>
    <div class="tb-task-meta">
      <button type="button" class="tb-chip tb-chip-${task.category}" data-action="category" data-id="${task.id}"
        title="クリックで仕事／生活を切り替え">${cat.icon} ${esc(cat.label)}</button>
      <span class="tb-stars" role="group" aria-label="優先度">${stars}</span>
      <label class="tb-inline-field">
        <input type="number" class="tb-number" min="5" max="480" step="5" value="${task.minutes}"
          data-action="minutes" data-id="${task.id}" aria-label="所要時間（分）">分
      </label>
      <label class="tb-inline-field">締切
        <input type="date" class="tb-date" data-action="deadline" data-id="${task.id}" value="${esc(task.deadline ?? "")}">
      </label>
      <label class="tb-inline-field">時間帯
        <select class="tb-select" data-action="timehint" data-id="${task.id}">${hintOptions}</select>
      </label>
      ${scheduling}
      <label class="tb-inline-field">仕分け
        <select class="tb-select" data-action="triage" data-id="${task.id}">${triageOptions}</select>
      </label>
      ${task.carryCount > 0 ? `<span class="tb-chip tb-chip-carry">持ち越し${task.carryCount}回</span>` : ""}
      ${task.pinnedStart ? `<span class="tb-chip tb-chip-pinned">${esc(task.pinnedStart)}に固定</span>` : ""}
    </div>
  </li>`;
}

function renderCapacity(summary) {
  const capacity = summary.capacity;
  el("tb-capacity").innerHTML = CATEGORIES.map((cat) => {
    const total = capacity[cat.id] ?? 0;
    const used = summary.used[cat.id] ?? 0;
    const rate = total === 0 ? 0 : Math.min(100, Math.round((used / total) * 100));
    return `<div class="tb-capacity-item">
      <div class="tb-capacity-label"><span>${cat.icon} ${esc(cat.label)}の時間</span>
        <span>${formatDuration(used)} / ${formatDuration(total)}</span></div>
      <div class="tb-bar"><span style="width:${rate}%;background:${cat.color}"></span></div>
    </div>`;
  }).join("");
}

function renderTimeline(windows, blocks) {
  const y = (minutes) => (minutes / 60) * HOUR_HEIGHT;
  const parts = [];

  for (let hour = 0; hour <= 24; hour += 1) {
    parts.push(
      `<div class="tb-hour" style="top:${y(hour * 60)}px">${String(hour).padStart(2, "0")}:00</div>`
    );
  }

  for (const w of windows) {
    const top = y(toMinutes(w.start));
    const height = Math.max(8, y(toMinutes(w.end)) - top);
    parts.push(
      `<div class="tb-window tb-window-${w.category}" style="top:${top}px;height:${height}px">
        <span class="tb-window-label">${esc(w.label)}</span></div>`
    );
  }

  for (const slot of freeSlots(windows, blocks)) {
    const top = y(toMinutes(slot.start));
    const height = Math.max(10, y(toMinutes(slot.end)) - top - 2);
    if (height < 18) continue;
    parts.push(
      `<div class="tb-free" style="top:${top}px;height:${height}px">空き ${slot.start}〜${slot.end}</div>`
    );
  }

  for (const block of blocks) {
    const top = y(toMinutes(block.start));
    const height = Math.max(16, y(toMinutes(block.end)) - top - 2);
    parts.push(
      `<div class="tb-block tb-block-${block.category} ${block.done ? "is-done" : ""}" style="top:${top}px;height:${height}px">
        <div>${block.pinned ? "📌 " : ""}${esc(block.title)}</div>
        <div class="tb-block-time">${block.start}〜${block.end}</div>
        ${
          block.pinned
            ? `<button type="button" class="tb-block-unpin" data-action="unpin" data-id="${block.taskId}">固定を外す</button>`
            : ""
        }
      </div>`
    );
  }

  parts.push(`<div class="tb-now" style="top:${y(toMinutes(nowHHMM()))}px"></div>`);

  const timeline = el("tb-timeline");
  timeline.style.height = `${(DAY_MINUTES / 60) * HOUR_HEIGHT}px`;
  timeline.innerHTML = parts.join("");
  scrollTimelineToNow();
}

let timelineScrolled = false;
function scrollTimelineToNow() {
  if (timelineScrolled) return;
  const container = el("tb-timeline-scroll");
  if (!container) return;
  container.scrollTop = Math.max(
    0,
    (toMinutes(nowHHMM()) / 60) * HOUR_HEIGHT - container.clientHeight / 3
  );
  timelineScrolled = true;
}

function renderOverflow(tasks, blocks) {
  const placed = new Set(blocks.map((b) => b.taskId));
  const left = tasks.filter((t) => !t.done && !placed.has(t.id));

  el("tb-overflow").innerHTML =
    left.length === 0 || blocks.length === 0
      ? ""
      : `<div class="tb-overflow"><strong>枠に入りきりません（${left.length}件）</strong>
          <div>${left.map((t) => esc(t.title)).join("、")}</div>
          <div>枠を広げるか、「いつかやる」へ回すか、所要時間を短くしてください。</div></div>`;
}

function renderStorageState() {
  el("tb-storage-state").textContent = storage.isPersistent()
    ? "データはこの端末のブラウザにだけ保存されます。サーバーへは送信していません。"
    : "このブラウザでは保存が使えません（プライベートモードなど）。タブを閉じると内容が消えます。";
}

function syncButtons(tasks, blocks) {
  const hasTasks = tasks.some((t) => !t.done);
  document.querySelector('[data-action="build"]').disabled = !hasTasks;
  document.querySelector('[data-action="build-from-now"]').disabled = !hasTasks;
  document.querySelector('[data-action="export-ics"]').disabled =
    blocks.length === 0 || !hasFeature(plan(), "icsExport");
}

// ─── 操作 ──────────────────────────────────────────────────

function bindEvents() {
  document.addEventListener("click", onClick);
  document.addEventListener("change", onChange);

  const timeline = el("tb-timeline");
  document.addEventListener("dragstart", (event) => {
    const item = event.target.closest?.(".tb-task");
    if (!item) return;
    dragTaskId = item.dataset.id;
    item.classList.add("is-dragging");
    event.dataTransfer.setData("text/plain", dragTaskId);
    event.dataTransfer.effectAllowed = "move";
    timeline.classList.add("is-droppable");
  });
  document.addEventListener("dragend", (event) => {
    event.target.closest?.(".tb-task")?.classList.remove("is-dragging");
    dragTaskId = null;
    timeline.classList.remove("is-droppable");
  });

  timeline.addEventListener("dragover", (event) => event.preventDefault());
  timeline.addEventListener("drop", (event) => {
    event.preventDefault();
    const id = event.dataTransfer.getData("text/plain") || dragTaskId;
    if (!id) return;
    const rect = timeline.getBoundingClientRect();
    const minutes = ((event.clientY - rect.top) / HOUR_HEIGHT) * 60;
    const snapped = Math.round(minutes / SNAP_MINUTES) * SNAP_MINUTES;
    pinTask(id, toHHMM(Math.max(0, Math.min(DAY_MINUTES - SNAP_MINUTES, snapped))));
  });

  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") closeModals();
  });
}

function onClick(event) {
  const target = event.target.closest("[data-action]");
  if (!target) return;
  const { action, id } = target.dataset;

  switch (action) {
    case "add-tasks":
      addTasks();
      break;
    case "tab":
      activeTab = target.dataset.tab;
      render();
      break;
    case "done":
      toggleDone(id);
      break;
    case "remove":
      updateTasks(state.tasks.filter((t) => t.id !== id));
      break;
    case "category":
      patchTask(id, (task) => ({ category: task.category === "work" ? "life" : "work" }));
      break;
    case "priority":
      patchTask(id, () => ({ priority: clampPriority(target.dataset.value) }));
      break;
    case "unpin":
      patchTask(id, () => ({ pinnedStart: null }));
      rebuild();
      break;
    case "build":
      rebuild();
      break;
    case "build-from-now":
      rebuild({ fromHHMM: nowHHMM() });
      break;
    case "export-ics":
      exportIcs();
      break;
    case "export-json":
      download(`timebox-backup-${today}.json`, storage.exportJson(), "application/json");
      break;
    case "reset":
      resetAll();
      break;
    case "locked":
      openPlanModal(target.dataset.feature);
      break;
    case "open-windows":
      openWindowModal();
      break;
    case "add-window":
      addWindowDraft(target.dataset.category);
      break;
    case "remove-window":
      windowDraft = windowDraft.filter((w) => w.id !== id);
      renderWindowDraft();
      break;
    case "save-windows":
      saveWindows();
      break;
    case "close-modal":
      closeModals();
      break;
    default:
      break;
  }
}

function onChange(event) {
  const target = event.target.closest("[data-action]");
  if (!target) return;
  const { action, id } = target.dataset;

  switch (action) {
    case "minutes":
      patchTask(id, () => ({ minutes: clampMinutes(target.value) }));
      break;
    case "deadline":
      patchTask(id, () => ({ deadline: target.value || null }));
      break;
    case "timehint":
      patchTask(id, () => ({ timeHint: target.value }));
      break;
    case "triage":
      changeTriage(id, target.value);
      break;
    case "pin":
      pinTask(id, target.value || null);
      break;
    case "planned-date":
      patchTask(id, () => ({ plannedDate: target.value || null }));
      break;
    case "window-field":
      updateWindowDraft(id, target.dataset.field, target.value);
      break;
    default:
      break;
  }
}

function addTasks() {
  const input = el("tb-input");
  const tasks = parseTaskLines(input.value, {
    category: el("tb-input-category").value,
    minutes: clampMinutes(el("tb-input-minutes").value),
    triage: "today",
    plannedDate: today,
  });

  if (tasks.length === 0) {
    notify("warn", "追加するタスクがありません。1行に1つ書いてください。");
    return;
  }

  state.tasks = [...state.tasks, ...tasks];
  input.value = "";
  activeTab = "today";
  notices = [{ kind: "success", text: `${tasks.length}件を追加しました。` }];
  commit();
}

function updateTasks(tasks) {
  state.tasks = tasks;
  commit();
}

function patchTask(id, patcher) {
  updateTasks(
    state.tasks.map((task) => (task.id === id ? { ...task, ...patcher(task) } : task))
  );
}

function toggleDone(id) {
  const task = state.tasks.find((t) => t.id === id);
  if (!task) return;
  const done = !task.done;

  // 完了記録は所要時間の見直し（将来のAI提案）で使うので残しておく
  const history = done
    ? [...state.history, { date: today, taskId: task.id, title: task.title, minutes: task.minutes, at: new Date().toISOString() }]
    : state.history.filter((h) => !(h.taskId === task.id && h.date === today));

  state.history = history;
  patchTask(id, () => ({ done }));
}

function changeTriage(id, triage) {
  patchTask(id, (task) => {
    if (triage === "today") return { triage, plannedDate: today };
    if (triage === "scheduled") {
      return { triage, plannedDate: task.plannedDate && task.plannedDate > today ? task.plannedDate : today };
    }
    // 今日の時間割からは外す。日付を持たせたままだと戻したとき混乱する
    return { triage, plannedDate: null, pinnedStart: null };
  });
}

function pinTask(id, hhmm) {
  const task = state.tasks.find((t) => t.id === id);
  if (!task) return;
  if (task.triage !== "today" || task.plannedDate !== today) {
    patchTask(id, () => ({ triage: "today", plannedDate: today, pinnedStart: hhmm }));
  } else {
    patchTask(id, () => ({ pinnedStart: hhmm }));
  }
  rebuild();
}

function rebuild(options = {}) {
  const current = day();
  const tasks = todayTasks();
  const result = buildSchedule({ date: today, windows: current.windows, tasks }, options);

  state.days[today] = {
    ...current,
    blocks: result.blocks,
    updatedAt: new Date().toISOString(),
  };

  notices =
    result.overflow.length > 0
      ? [{ kind: "warn", text: `${result.blocks.length}件を配置しました。${result.overflow.length}件は枠に入りませんでした。` }]
      : [{ kind: "success", text: `${result.blocks.length}件を時間割に置きました。` }];
  commit();
}

// ─── 枠の編集 ──────────────────────────────────────────────

function openWindowModal() {
  windowDraft = (day().windows ?? []).map((w) => ({ ...w }));
  el("tb-window-default").checked = false;
  el("tb-window-modal").hidden = false;
  renderWindowDraft();
}

function addWindowDraft(category) {
  const draft = windowDraft ?? [];
  windowDraft = [
    ...draft,
    {
      id: `w${Date.now().toString(36)}${draft.length}`,
      label: category === "work" ? "仕事" : "自分の時間",
      start: "09:00",
      end: "12:00",
      category,
    },
  ];
  renderWindowDraft();
}

function updateWindowDraft(id, field, value) {
  windowDraft = windowDraft.map((w) => (w.id === id ? { ...w, [field]: value } : w));
}

function renderWindowDraft() {
  el("tb-windows").innerHTML = windowDraft
    .map(
      (w) => `<li class="tb-window-row">
        <select class="tb-select" data-action="window-field" data-id="${w.id}" data-field="category">
          ${CATEGORIES.map(
            (c) => `<option value="${c.id}" ${c.id === w.category ? "selected" : ""}>${c.icon} ${esc(c.label)}</option>`
          ).join("")}
        </select>
        <input class="tb-text" type="text" value="${esc(w.label)}" data-action="window-field" data-id="${w.id}" data-field="label" aria-label="枠の名前">
        <input class="tb-time" type="time" step="900" value="${esc(w.start)}" data-action="window-field" data-id="${w.id}" data-field="start" aria-label="開始">
        <span>〜</span>
        <input class="tb-time" type="time" step="900" value="${esc(w.end)}" data-action="window-field" data-id="${w.id}" data-field="end" aria-label="終了">
        <button type="button" class="tb-task-remove" data-action="remove-window" data-id="${w.id}" aria-label="この枠を消す">✕</button>
      </li>`
    )
    .join("");
}

function saveWindows() {
  const cleaned = windowDraft
    .map((w) => ({ ...w, label: w.label.trim() || "枠" }))
    .filter((w) => toMinutes(w.end) > toMinutes(w.start))
    .sort((a, b) => toMinutes(a.start) - toMinutes(b.start));

  if (cleaned.length !== windowDraft.length) {
    notify("error", "終了が開始より前になっている枠があります。時刻を直してください。");
    return;
  }

  state.days[today] = { ...day(), windows: cleaned, updatedAt: new Date().toISOString() };

  if (el("tb-window-default").checked) {
    const days = state.template.days.map((d, index) =>
      index === new Date(`${today}T00:00:00`).getDay() ? cleaned.map((w) => ({ ...w })) : d
    );
    state.template = { days, updatedAt: new Date().toISOString() };
  }

  closeModals();
  rebuild();
}

function closeModals() {
  el("tb-window-modal").hidden = true;
  el("tb-plan-modal").hidden = true;
}

function openPlanModal(feature) {
  const labels = {
    googleCalendarSync:
      "Googleカレンダーとの直接同期は準備中です。いまは .ics ファイルを書き出して取り込めます。",
    cloudBackup:
      "クラウド保存と複数端末での共有は準備中です。いまのデータはこの端末に保存されています。",
  };
  el("tb-plan-modal-body").textContent = labels[feature] ?? "この機能は準備中です。";
  el("tb-plan-modal").hidden = false;
}

// ─── 書き出し ──────────────────────────────────────────────

function exportIcs() {
  const current = day();
  const blocks = decorateBlocks(current.blocks ?? [], todayTasks());
  if (blocks.length === 0) {
    notify("warn", "先に時間割をつくってください。");
    return;
  }
  download(`timebox-${today}.ics`, buildIcs({ date: today, blocks }), "text/calendar;charset=utf-8");
  notify(
    "success",
    "ICSファイルを保存しました。Googleカレンダーの「他のカレンダーを追加 → インポート」から取り込めます。"
  );
}

function download(filename, text, type) {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

function resetAll() {
  if (!window.confirm("この端末に保存したタスク・時間割・記録をすべて消します。よろしいですか？")) {
    return;
  }
  state = storage.clearAll();
  state = storage.save(state);
  activeTab = "today";
  notices = [{ kind: "info", text: "保存していたデータを消しました。" }];
  rollover();
  render();
}

init();
