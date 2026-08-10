/**
 * DAYLOOP — 画面（内部機能名: Timebox）。
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
  createAiAnalysis,
  createCapture,
  createExecution,
  createTask,
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
import * as aiClient from "./ai-client.js";
import { getProvider, listProviders } from "./storage-providers/registry.js";

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

/** Today画面の入力タブ: "brain-dump"（AIと整理する） | "manual"（自分で追加する） */
let entryMode = "brain-dump";
/** AI提案のレビュー中バッファ。Confirmを押すまでTask Storeへは入らない */
let reviewDraft = null;
/** 設定モーダルで開いているセクション */
let settingsSection = "storage";
/** 保存先切り替え中の確認待ち状態（{ targetId, targetConfig }） */
let providerSwitchDraft = null;
/** local以外のProviderへの同期状況: null(未使用) | pending | synced | offline | error */
let syncStatus = null;
let syncMessage = "";
/** 同期呼び出しを順番に実行するためのキュー（並行書き込みで競合させない） */
let syncChain = Promise.resolve();

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
  syncStateToActiveProvider();
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
  renderEntryMode();
  renderSyncChip();
  syncButtons(tasks, blocks);
}

/** 入力タブ（AIと整理する/自分で追加する）の見た目を切り替える。DOMは作り直さない */
function renderEntryMode() {
  const brainDumpPanel = el("tb-entry-brain-dump");
  const manualPanel = el("tb-entry-manual");
  if (!brainDumpPanel || !manualPanel) return;
  brainDumpPanel.hidden = entryMode !== "brain-dump";
  manualPanel.hidden = entryMode !== "manual";
  el("tb-entry-tab-brain-dump")?.setAttribute("aria-selected", String(entryMode === "brain-dump"));
  el("tb-entry-tab-manual")?.setAttribute("aria-selected", String(entryMode === "manual"));
}

const SYNC_STATUS_LABEL = { pending: "同期中…", synced: "同期済み", offline: "オフライン", error: "同期エラー" };

/** 保存先ステータスの小さなバッジ。Todayからいつでも保存先を確認・設定へ行ける */
function renderSyncChip() {
  const chip = el("tb-sync-chip");
  if (!chip) return;
  const provider = activeProvider();
  if (provider.id === "local") {
    chip.textContent = "保存先: この端末";
    chip.classList.remove("is-pending", "is-error");
    return;
  }
  const label = SYNC_STATUS_LABEL[syncStatus] ?? "未同期";
  chip.textContent = `保存先: ${provider.label}（${label}）`;
  chip.classList.toggle("is-pending", syncStatus === "pending");
  chip.classList.toggle("is-error", syncStatus === "error" || syncStatus === "offline");
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
  const base = storage.isPersistent()
    ? "データはこの端末のブラウザに保存されます。"
    : "このブラウザでは保存が使えません（プライベートモードなど）。タブを閉じると内容が消えます。";
  const provider = activeProvider();
  const extra =
    provider.id === "local"
      ? "サーバーへは送信していません。"
      : `加えて「${provider.label}」へも保存されます（保存先は設定から変更できます）。`;
  el("tb-storage-state").textContent = `${base} ${extra}`;
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

  el("tb-import-file")?.addEventListener("change", onImportFileSelected);
}

function onClick(event) {
  const target = event.target.closest("[data-action]");
  if (!target) return;
  const { action, id } = target.dataset;

  switch (action) {
    case "add-tasks":
      addTasks();
      break;
    case "entry-mode":
      entryMode = target.dataset.mode;
      renderEntryMode();
      break;
    case "brain-dump-analyze":
      analyzeBrainDumpInput();
      break;
    case "review-toggle":
      updateReviewCandidate(id, () => ({ included: target.checked }));
      target.closest(".tb-review-card")?.classList.toggle("is-excluded", !target.checked);
      break;
    case "review-confirm":
      confirmReview();
      break;
    case "open-settings":
      openSettings();
      break;
    case "settings-section":
      settingsSection = target.dataset.section;
      renderSettingsModal();
      break;
    case "provider-select":
      beginProviderSwitch(target.dataset.provider);
      break;
    case "obsidian-connect":
      beginObsidianConnect();
      break;
    case "gas-connect":
      beginGasConnect();
      break;
    case "provider-switch-copy":
      finalizeProviderSwitch(true);
      break;
    case "provider-switch-empty":
      finalizeProviderSwitch(false);
      break;
    case "provider-switch-cancel":
      cancelProviderSwitch();
      break;
    case "provider-disconnect":
      disconnectProvider(target.dataset.provider);
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
    case "import-json":
      el("tb-import-file")?.click();
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
    case "review-field": {
      const field = target.dataset.field;
      let value = target.value;
      if (field === "estimatedMinutes") value = clampMinutes(value);
      if (field === "priority") value = clampPriority(value);
      if (field === "deadline") value = value || null;
      updateReviewCandidate(id, () => ({ [field]: value }));
      break;
    }
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

  if (done) {
    // 実行記録: 開始時刻の計測UIはまだ無いため、実績時間は所要時間で近似する
    // （Skill/Automation候補を育てるための最低限の記録として。将来ここへ実測を足せる）
    const block = decorateBlocks(day().blocks ?? [], todayTasks()).find((b) => b.taskId === id);
    const execution = createExecution({
      taskId: task.id,
      date: today,
      plannedStart: block?.start ?? null,
      plannedEnd: block?.end ?? null,
      plannedMinutes: task.minutes,
      actualStart: block?.start ?? null,
      actualEnd: nowHHMM(),
      actualMinutes: task.minutes,
      completed: true,
      carryCount: task.carryCount ?? 0,
    });
    state.executions = [...state.executions, execution];

    const provider = activeProvider();
    if (provider.id !== "local") {
      queueSync(() => provider.appendExecution(execution, activeProviderConfig()));
    }
  }

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
  el("tb-review-modal").hidden = true;
  el("tb-settings-modal").hidden = true;
  reviewDraft = null;
  providerSwitchDraft = null;
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

/**
 * JSONバックアップの読み込み。
 * 失敗時は storage.importJson() が投げるだけで保存には触らないので、
 * ここでも catch した場合は既存データをそのまま残す（安全な失敗）。
 */
async function onImportFileSelected(event) {
  const input = event.target;
  const file = input.files?.[0];
  input.value = "";
  if (!file) return;

  let imported;
  try {
    const text = await file.text();
    imported = storage.importJson(text);
  } catch (error) {
    notify(
      "error",
      error instanceof storage.ImportError
        ? error.message
        : "バックアップの読み込みに失敗しました。現在のデータは変更していません。"
    );
    return;
  }

  const ok = window.confirm(
    "この端末に保存されているタスク・時間割・記録を、読み込んだバックアップで置き換えます。よろしいですか？"
  );
  if (!ok) return;

  state = storage.save(imported);
  activeTab = "today";
  notices = [{ kind: "success", text: "バックアップを読み込みました。" }];
  rollover();
  render();
}

// ─── AI Brain Dump → Review → Confirm ───────────────────────
//
// ここは「タスク候補を整理する」までがAIの役目で、確定した瞬間に
// createTask() を通って既存のTask Storeへ入る（origin: "ai-brain-dump"）。
// 実際の時間割配置はここでは一切行わず、従来どおり rebuild()（Timebox Engine）が担う。

async function analyzeBrainDumpInput() {
  const input = el("tb-braindump-input");
  const text = input.value.trim();
  if (!text) {
    notify("warn", "Brain Dumpの内容が空です。頭の中を書き出してから試してください。");
    return;
  }

  const capture = createCapture({ text });
  state.captures = [...state.captures, capture];
  state = storage.save(state);
  syncCaptureToActiveProvider(capture, null);

  const stateEl = el("tb-braindump-ai-state");
  if (stateEl) stateEl.textContent = "AIが整理しています…";

  let suggestions;
  let model = null;
  try {
    suggestions = await aiClient.analyzeBrainDump(text, { date: today });
    model = "claude";
  } catch (error) {
    // AI未接続時のfallback: 既存のparseTaskLines（1行=1タスク）でそのまま候補化する。
    // Manual Entryと同じ壊れないロジックを使うため、ここでも決定論的に動く。
    const fallbackTasks = parseTaskLines(text).map((t) => ({
      title: t.title,
      project: null,
      firstAction: null,
      priority: t.priority,
      estimatedMinutes: t.minutes,
      category: t.category,
      deadline: null,
      subtasks: [],
      dependencies: [],
      reason: "AI未接続のため、入力行をそのままタスク候補にしています。",
      triage: "today",
    }));
    suggestions = {
      goal: null,
      summary: null,
      questions: [],
      tasks: fallbackTasks,
      unavailableReason: error instanceof aiClient.AiUnavailableError ? error.message : "AI機能の呼び出しに失敗しました。",
    };
  }

  const analysis = createAiAnalysis({ captureId: capture.id, suggestions, model });
  state.aiAnalyses = [...state.aiAnalyses, analysis];
  state.captures = state.captures.map((c) => (c.id === capture.id ? { ...c, status: "analyzed" } : c));
  state = storage.save(state);

  const updatedCapture = state.captures.find((c) => c.id === capture.id);
  syncCaptureToActiveProvider(updatedCapture, analysis);

  if (stateEl) stateEl.textContent = "";
  openReview(updatedCapture, analysis);
}

function openReview(capture, analysis) {
  reviewDraft = {
    capture,
    analysis,
    candidates: (analysis.suggestions.tasks ?? []).map((t, i) => ({
      ...t,
      included: true,
      _id: `cand-${i}-${Date.now().toString(36)}`,
    })),
  };
  el("tb-review-modal").hidden = false;
  renderReview();
}

function renderReview() {
  if (!reviewDraft) return;
  const { analysis, candidates } = reviewDraft;
  const s = analysis.suggestions ?? {};

  const metaParts = [];
  if (s.unavailableReason) {
    metaParts.push(
      `<div class="tb-notice tb-notice-warn"><span>AI機能が未設定のため、入力した内容をそのままタスク候補にしています。内容を確認・編集してから取り込んでください。</span></div>`
    );
  }
  if (s.goal) metaParts.push(`<p class="tb-card-hint"><strong>ゴール:</strong> ${esc(s.goal)}</p>`);
  if (s.summary) metaParts.push(`<p class="tb-card-hint">${esc(s.summary)}</p>`);
  if ((s.questions ?? []).length) {
    metaParts.push(
      `<div class="tb-card-hint"><strong>AIからの質問:</strong><ul>${s.questions
        .map((q) => `<li>${esc(q)}</li>`)
        .join("")}</ul></div>`
    );
  }
  el("tb-review-meta").innerHTML = metaParts.join("");

  el("tb-review-list").innerHTML =
    candidates.length > 0
      ? candidates.map(reviewCandidateRow).join("")
      : `<li class="tb-empty">候補が見つかりませんでした。Brain Dumpの内容を見直してください。</li>`;
}

function reviewCandidateRow(c) {
  const categoryOptions = CATEGORIES.map(
    (cat) => `<option value="${cat.id}" ${cat.id === c.category ? "selected" : ""}>${cat.icon} ${esc(cat.label)}</option>`
  ).join("");
  const triageOptions = TRIAGE.map(
    (t) => `<option value="${t.id}" ${t.id === c.triage ? "selected" : ""}>${esc(t.label)}</option>`
  ).join("");
  const extra = [
    c.firstAction ? `最初の一歩: ${esc(c.firstAction)}` : "",
    (c.subtasks ?? []).length ? `内訳: ${c.subtasks.map(esc).join(" / ")}` : "",
    c.reason ? `理由: ${esc(c.reason)}` : "",
  ]
    .filter(Boolean)
    .join(" ／ ");

  return `<li class="tb-review-card" data-id="${c._id}">
    <div class="tb-review-card-head">
      <label class="tb-inline-field">
        <input type="checkbox" data-action="review-toggle" data-id="${c._id}" ${c.included ? "checked" : ""}> 取り込む
      </label>
    </div>
    <label class="visually-hidden" for="review-title-${c._id}">タスク名</label>
    <input id="review-title-${c._id}" class="tb-text tb-review-title" type="text" value="${esc(c.title)}"
      data-action="review-field" data-id="${c._id}" data-field="title">
    ${extra ? `<p class="tb-card-hint">${extra}</p>` : ""}
    <div class="tb-task-meta">
      <label class="tb-inline-field">区分
        <select data-action="review-field" data-id="${c._id}" data-field="category">${categoryOptions}</select>
      </label>
      <label class="tb-inline-field">所要
        <input class="tb-number" type="number" min="5" max="480" step="5" value="${c.estimatedMinutes}"
          data-action="review-field" data-id="${c._id}" data-field="estimatedMinutes">分
      </label>
      <label class="tb-inline-field">優先度
        <input class="tb-number" type="number" min="1" max="5" value="${c.priority}"
          data-action="review-field" data-id="${c._id}" data-field="priority">
      </label>
      <label class="tb-inline-field">締切
        <input class="tb-date" type="date" value="${esc(c.deadline ?? "")}"
          data-action="review-field" data-id="${c._id}" data-field="deadline">
      </label>
      <label class="tb-inline-field">仕分け
        <select data-action="review-field" data-id="${c._id}" data-field="triage">${triageOptions}</select>
      </label>
    </div>
  </li>`;
}

function updateReviewCandidate(id, patcher) {
  if (!reviewDraft) return;
  reviewDraft.candidates = reviewDraft.candidates.map((c) => (c._id === id ? { ...c, ...patcher(c) } : c));
}

function confirmReview() {
  if (!reviewDraft) return;
  const included = reviewDraft.candidates.filter((c) => c.included && String(c.title ?? "").trim());
  if (included.length === 0) {
    notify("warn", "取り込むタスクが選ばれていません。チェックを入れるか、キャンセルしてください。");
    return;
  }

  const newTasks = included.map((c) =>
    createTask({
      title: c.title,
      minutes: c.estimatedMinutes,
      priority: c.priority,
      category: c.category,
      deadline: c.deadline || null,
      triage: c.triage,
      plannedDate: c.triage === "today" || c.triage === "scheduled" ? today : null,
      origin: "ai-brain-dump",
    })
  );

  state.tasks = [...state.tasks, ...newTasks];
  state.aiAnalyses = state.aiAnalyses.map((a) =>
    a.id === reviewDraft.analysis.id ? { ...a, acceptedAt: new Date().toISOString() } : a
  );
  state.captures = state.captures.map((c) =>
    c.id === reviewDraft.capture.id ? { ...c, status: "converted" } : c
  );

  const finalCapture = state.captures.find((c) => c.id === reviewDraft.capture.id);
  const finalAnalysis = state.aiAnalyses.find((a) => a.id === reviewDraft.analysis.id);

  if (el("tb-braindump-input")) el("tb-braindump-input").value = "";
  activeTab = "today";
  notices = [{ kind: "success", text: `${newTasks.length}件をタスクに追加しました。` }];
  closeModals();
  commit();
  syncCaptureToActiveProvider(finalCapture, finalAnalysis);
}

// ─── Storage Provider 同期 ───────────────────────────────────
//
// local（localStorage）は常にsaveされ続ける実行時のSource of Truth。
// 他のProviderを選んでいる場合は、commit()のたびに"追加で"同期を試みるだけで、
// localへの保存や画面の動作はProviderの状態に一切左右されない。

function activeProvider() {
  return getProvider(state.settings?.storageProviderId ?? "local");
}

function activeProviderConfig() {
  const id = state.settings?.storageProviderId ?? "local";
  return state.settings?.storageProviders?.[id] ?? {};
}

function queueSync(task) {
  syncChain = syncChain.then(task).catch(() => {});
  return syncChain;
}

function setSyncStatus(status, message = "") {
  syncStatus = status;
  syncMessage = message;
  renderSyncChip();
}

function syncStateToActiveProvider() {
  const provider = activeProvider();
  if (provider.id === "local") {
    syncStatus = null;
    return;
  }
  const config = activeProviderConfig();
  setSyncStatus("pending");
  queueSync(async () => {
    try {
      const result = await provider.saveState(state, config);
      setSyncStatus(result?.ok === false ? "error" : "synced", result?.error ?? "");
    } catch {
      setSyncStatus("error", "同期に失敗しました。");
    }
  });
}

function syncCaptureToActiveProvider(capture, analysis) {
  const provider = activeProvider();
  if (provider.id === "local") return;
  const config = activeProviderConfig();
  setSyncStatus("pending");
  queueSync(async () => {
    try {
      const result = await provider.saveCapture(capture, config, analysis);
      setSyncStatus(result?.ok === false ? "error" : "synced", result?.error ?? "");
    } catch {
      setSyncStatus("error", "同期に失敗しました。");
    }
  });
}

// ─── 設定 / Data Storage 切り替え ────────────────────────────

function openSettings() {
  el("tb-settings-modal").hidden = false;
  renderSettingsModal();
}

const SETTINGS_SECTIONS = [
  { id: "account", label: "Account" },
  { id: "ai", label: "AI" },
  { id: "storage", label: "Data Storage" },
  { id: "calendar", label: "Calendar" },
  { id: "backup", label: "Backup" },
  { id: "privacy", label: "Privacy" },
];

function renderSettingsModal() {
  el("tb-settings-nav").innerHTML = SETTINGS_SECTIONS.map(
    (s) =>
      `<button type="button" class="tb-settings-nav-item" data-action="settings-section" data-section="${s.id}"
        aria-selected="${s.id === settingsSection}">${s.label}</button>`
  ).join("");

  const body = el("tb-settings-body");
  if (settingsSection === "storage") {
    body.innerHTML = renderDataStorageSection();
  } else if (settingsSection === "ai") {
    body.innerHTML = renderAiSection();
  } else if (settingsSection === "calendar") {
    body.innerHTML = renderCalendarSection();
  } else if (settingsSection === "backup") {
    body.innerHTML = renderBackupSection();
  } else if (settingsSection === "privacy") {
    body.innerHTML = renderPrivacySection();
  } else {
    body.innerHTML = renderAccountSection();
  }
}

function renderAccountSection() {
  return `
    <div class="tb-settings-section">
      <h3>Account</h3>
      <p class="tb-card-hint">現在はゲスト利用です。ログイン機能は準備中です（Phase 2でGoogleログインを予定）。</p>
      <p class="tb-card-hint">現在のプラン: <strong>${esc(state.settings.plan ?? "free")}</strong></p>
    </div>`;
}

function renderAiSection() {
  return `
    <div class="tb-settings-section">
      <h3>AI</h3>
      <p class="tb-card-hint">
        AIは「頭の中を全部書く」入力（Brain Dump）を、タスク候補として整理するために使います。
        実際の時間割配置はAIではなく、Timebox Engineが決定論的に行います。
      </p>
      <p class="tb-card-hint">
        バックエンドが未設定の場合、Brain Dumpは自動的に「入力した行をそのままタスク候補にする」
        方式へ切り替わります。Manual Entryはこの状態でも通常どおり使えます。
      </p>
    </div>`;
}

function renderCalendarSection() {
  return `
    <div class="tb-settings-section">
      <h3>Calendar</h3>
      <p class="tb-card-hint"><strong>今すぐ使える:</strong> ICS書き出し（Googleカレンダーの「他のカレンダーを追加 → インポート」から取り込めます）。</p>
      <p class="tb-card-hint"><strong>準備中:</strong> Googleカレンダーとの直接同期。既存のGoogle予定をDAYLOOPが勝手に変更・削除することはありません。</p>
    </div>`;
}

function renderBackupSection() {
  return `
    <div class="tb-settings-section">
      <h3>Backup</h3>
      <p class="tb-card-hint">保存先に関わらず、JSON Export / Import はいつでも使えます。ドメインや端末を変えるときの移行手段です。</p>
      <div class="tb-row-actions">
        <button type="button" class="tb-btn tb-btn-ghost tb-btn-sm" data-action="export-json">バックアップを保存</button>
        <button type="button" class="tb-btn tb-btn-ghost tb-btn-sm" data-action="import-json">バックアップを読み込む</button>
      </div>
    </div>`;
}

function renderPrivacySection() {
  const provider = activeProvider();
  const location =
    provider.id === "local"
      ? "この端末（ブラウザのlocalStorage）"
      : `この端末（キャッシュ） + ${provider.label}`;
  return `
    <div class="tb-settings-section">
      <h3>Privacy</h3>
      <p class="tb-card-hint">現在の保存先: <strong>${esc(location)}</strong></p>
      <p class="tb-card-hint">Phase 1では、利用者が選んだ保存先以外にデータを送信しません。AI Brain Dumpの解析はテキストをAPIへ送りますが、保存はしません。</p>
    </div>`;
}

function renderDataStorageSection() {
  const currentId = state.settings?.storageProviderId ?? "local";
  const provider = activeProvider();

  const cards = listProviders()
    .map((p) => renderProviderCard(p, p.id === currentId))
    .join("");

  const switchPanel = providerSwitchDraft ? renderProviderSwitchPanel() : "";

  return `
    <div class="tb-settings-section">
      <h3>Data Storage</h3>
      <p class="tb-card-hint">
        現在の保存先: <strong>${esc(provider.label)}</strong>
        ${syncStatus ? ` / 状態: ${esc(SYNC_STATUS_LABEL[syncStatus] ?? syncStatus)}` : ""}
      </p>
      ${switchPanel}
      <ul class="tb-provider-list">${cards}</ul>
    </div>`;
}

function renderProviderCard(provider, isActive) {
  const config = state.settings?.storageProviders?.[provider.id] ?? {};

  let controls = "";
  if (provider.id === "local") {
    controls = isActive
      ? `<span class="tb-chip tb-chip-pinned">現在の保存先</span>`
      : `<button type="button" class="tb-btn tb-btn-ghost tb-btn-sm" data-action="provider-select" data-provider="local">この端末にする</button>`;
  } else if (provider.id === "obsidian") {
    controls = `
      <div class="tb-provider-config">
        <label class="tb-inline-field">Captures <input class="tb-text" type="text" id="tb-settings-obsidian-captures" value="${esc(config.paths?.captures ?? "Timebox/Captures")}"></label>
        <label class="tb-inline-field">Daily <input class="tb-text" type="text" id="tb-settings-obsidian-daily" value="${esc(config.paths?.daily ?? "Timebox/Daily")}"></label>
        <label class="tb-inline-field">Skills <input class="tb-text" type="text" id="tb-settings-obsidian-skills" value="${esc(config.paths?.skills ?? "Timebox/Skills")}"></label>
        <label class="tb-inline-field">Automation <input class="tb-text" type="text" id="tb-settings-obsidian-automation" value="${esc(config.paths?.automation ?? "Timebox/Automation")}"></label>
      </div>
      <div class="tb-row-actions">
        <button type="button" class="tb-btn tb-btn-primary tb-btn-sm" data-action="obsidian-connect">Vaultフォルダを選ぶ</button>
        ${isActive ? `<span class="tb-chip tb-chip-pinned">現在の保存先</span>` : ""}
        ${isActive ? `<button type="button" class="tb-btn tb-btn-ghost tb-btn-sm" data-action="provider-disconnect" data-provider="obsidian">切断</button>` : ""}
      </div>
      <p class="tb-card-hint">HTTPS環境 + Chromium系ブラウザ向け。未対応ブラウザでは obsidian://new によるフォールバックを案内します。</p>`;
  } else if (provider.id === "google-sheets-gas") {
    controls = `
      <div class="tb-provider-config">
        <label class="tb-inline-field">Web App URL <input class="tb-text" type="text" id="tb-settings-gas-url" value="${esc(config.webAppUrl ?? "")}" placeholder="https://script.google.com/macros/s/xxxx/exec"></label>
        <label class="tb-inline-field">Spreadsheet ID <input class="tb-text" type="text" id="tb-settings-gas-sheet-id" value="${esc(config.spreadsheetId ?? "")}"></label>
      </div>
      <div class="tb-row-actions">
        <button type="button" class="tb-btn tb-btn-primary tb-btn-sm" data-action="gas-connect">接続する</button>
        ${isActive ? `<span class="tb-chip tb-chip-pinned">現在の保存先</span>` : ""}
        ${isActive ? `<button type="button" class="tb-btn tb-btn-ghost tb-btn-sm" data-action="provider-disconnect" data-provider="google-sheets-gas">切断</button>` : ""}
      </div>`;
  } else {
    controls = `<span class="tb-lock">近日対応</span>`;
  }

  return `<li class="tb-provider-card ${isActive ? "is-active" : ""}">
    <p class="tb-card-title" style="margin-bottom:4px;">${esc(provider.label)}</p>
    ${controls}
  </li>`;
}

function renderProviderSwitchPanel() {
  const target = getProvider(providerSwitchDraft.targetId);
  return `<div class="tb-notice tb-notice-info">
    <span>
      現在のデータを ${esc(target.label)} へコピーしますか？<br>
      <span class="tb-row-actions">
        <button type="button" class="tb-btn tb-btn-primary tb-btn-sm" data-action="provider-switch-copy">コピーして切り替える</button>
        <button type="button" class="tb-btn tb-btn-ghost tb-btn-sm" data-action="provider-switch-empty">空の状態で切り替える</button>
        <button type="button" class="tb-btn tb-btn-ghost tb-btn-sm" data-action="provider-switch-cancel">キャンセル</button>
      </span>
    </span>
  </div>`;
}

async function beginProviderSwitch(targetId) {
  if (targetId === "local") {
    state.settings = { ...state.settings, storageProviderId: "local" };
    providerSwitchDraft = null;
    commit();
    notify("success", "保存先をこの端末に切り替えました。");
    renderSettingsModal();
    return;
  }
  // obsidian / google-sheets-gas は専用の接続フロー（フォルダ選択・URL入力）を先に通す
  notify("warn", "先に保存先の接続設定を行ってください。");
}

async function beginObsidianConnect() {
  const provider = getProvider("obsidian");
  const existing = state.settings?.storageProviders?.obsidian ?? {};
  const config = {
    ...existing,
    paths: {
      captures: el("tb-settings-obsidian-captures")?.value || "Timebox/Captures",
      daily: el("tb-settings-obsidian-daily")?.value || "Timebox/Daily",
      skills: el("tb-settings-obsidian-skills")?.value || "Timebox/Skills",
      automation: el("tb-settings-obsidian-automation")?.value || "Timebox/Automation",
      settings: existing.paths?.settings || "Timebox/Settings",
      root: existing.paths?.root || "Timebox",
    },
  };

  try {
    const configured = await provider.configure(config);
    providerSwitchDraft = { targetId: "obsidian", targetConfig: configured };
    renderSettingsModal();
  } catch (error) {
    notify("error", error?.message || "Obsidianフォルダへの接続に失敗しました。");
  }
}

async function beginGasConnect() {
  const provider = getProvider("google-sheets-gas");
  const config = {
    webAppUrl: el("tb-settings-gas-url")?.value?.trim() ?? "",
    spreadsheetId: el("tb-settings-gas-sheet-id")?.value?.trim() ?? "",
  };

  try {
    const configured = await provider.configure(config);
    providerSwitchDraft = { targetId: "google-sheets-gas", targetConfig: configured };
    renderSettingsModal();
  } catch (error) {
    notify("error", error?.message || "Google Sheetsへの接続に失敗しました。");
  }
}

async function finalizeProviderSwitch(copy) {
  if (!providerSwitchDraft) return;
  const { targetId, targetConfig } = providerSwitchDraft;
  const provider = getProvider(targetId);

  if (copy) {
    try {
      const result = await provider.saveState(state, targetConfig);
      if (result?.ok === false) throw new Error(result.error || "コピーに失敗しました。");
    } catch (error) {
      // 失敗した移行は既存データにもProvider設定にも一切触れず、ここで打ち切る（安全な失敗）
      notify("error", `コピーに失敗したため切り替えを中止しました: ${error?.message ?? "unknown error"}`);
      providerSwitchDraft = null;
      renderSettingsModal();
      return;
    }
  }

  state.settings = {
    ...state.settings,
    storageProviderId: targetId,
    storageProviders: { ...state.settings.storageProviders, [targetId]: targetConfig },
  };
  providerSwitchDraft = null;
  commit();
  notify("success", `保存先を${provider.label}に切り替えました。`);
  renderSettingsModal();
}

function cancelProviderSwitch() {
  providerSwitchDraft = null;
  renderSettingsModal();
}

async function disconnectProvider(providerId) {
  const provider = getProvider(providerId);
  await provider.disconnect(activeProviderConfig());
  if ((state.settings?.storageProviderId ?? "local") === providerId) {
    state.settings = { ...state.settings, storageProviderId: "local" };
    commit();
  }
  notify("info", `${provider.label}との接続を解除しました。`);
  renderSettingsModal();
}

init();
