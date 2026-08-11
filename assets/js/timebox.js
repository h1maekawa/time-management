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
import { createAccountController } from "./supabase/account-controller.js";
import { sanitizeDigits } from "./supabase/otp-input.js";
import { isPipSupported, openPipWindow, currentPipWindow } from "./mini/pip-support.js";
import { deriveMiniView } from "./mini/mini-state.js";
import {
  normalizeNotificationPrefs,
  planNotifications,
  planCompletionNotification,
  buildNotificationMessage,
} from "./mini/notification-prefs.js";
import { isAppBadgeSupported, setAppBadgeCount } from "./mini/app-badge.js";
import { getDeviceId } from "./mini/device-id.js";
import { getSupabaseClient } from "./supabase/client.js";
import {
  isPushSupported,
  isPushConfigured,
  getVapidPublicKey,
  urlBase64ToUint8Array,
  subscriptionToRow,
} from "./mini/push-subscription.js";

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

/** Auth / Guest→Account Migration / Account Delete を扱うコントローラ（§14-21, 33-38） */
const account = createAccountController({
  onChange: () => {
    // ログイン確立・ログアウト直後などはnamespaceが切り替わっているため、
    // 表示中のstateも読み直してから再描画する。
    state = storage.load();
    render();
  },
});

// ─── DAYLOOP Mini（Execution UI。§65-71） ────────────────────
/** "closed" | "sticky"（PC Fallback / 開いた直後） | "pip" */
let miniMode = "closed";
let miniPipWindow = null;
/**
 * #tb-mini要素への安定した参照。PiP windowへ実体移動すると
 * document.getElementById("tb-mini")（＝メインdocument基準のel()）は
 * 見つからなくなる（要素がメインdocumentのツリーから抜けるため）ので、
 * 一度取得した参照をnamespaceを跨いで使い回す。
 */
let miniElRef = null;
/** 予定時間超過の確認（§85）を、同じcurrentBlockの間だけ1回抑制する */
let overdueDismissedKey = null;
/** モバイルSticky NOW Barの展開状態（§74） */
let mobileNowExpanded = false;
/** 通知の二重発火を避けるため、直前にtickを処理した"HH:MM"を憶えておく */
let lastNotificationMinute = null;

// ─── 起動 ──────────────────────────────────────────────────

function init() {
  miniElRef = el("tb-mini");
  rollover();
  bindEvents();
  render();
  account.init();
  registerServiceWorker();

  window.addEventListener("online", () => {
    if (activeProvider().id === "cloud") {
      notify("info", "オンラインに戻りました。同期します。");
      syncStateToActiveProvider();
    }
  });
  window.addEventListener("offline", () => {
    if (activeProvider().id === "cloud") setSyncStatus("offline");
  });

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
  renderAccountUI();
  renderLoginModal();
  renderMigrationModal();
  if (el("tb-settings-modal") && !el("tb-settings-modal").hidden) renderSettingsModal();
  renderMini(summary);
  renderMobileNow(summary);
  updateAppBadge(tasks);
  checkAndFireNotifications(summary);
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

// ─── Account / Login / Migration ────────────────────────────

/** Header右上のAccount UI（§14） */
function renderAccountUI() {
  const container = el("tb-account");
  if (!container) return;
  const s = account.getState();

  if (s.status !== "authenticated" || !s.user) {
    container.innerHTML = `<button type="button" class="tb-btn tb-btn-ghost tb-btn-sm" data-action="open-login">ログイン</button>`;
    return;
  }

  const initial = (s.user.email || "?").trim().charAt(0).toUpperCase();
  container.innerHTML = `
    <div class="tb-account-menu ${s.accountMenuOpen ? "is-open" : ""}">
      <button type="button" class="tb-account-trigger" data-action="account-menu-toggle"
        aria-haspopup="true" aria-expanded="${s.accountMenuOpen}">
        <span class="tb-account-avatar" aria-hidden="true">${esc(initial)}</span>
        <span class="tb-account-email">${esc(s.user.email || "")}</span>
        <span class="tb-account-chevron" aria-hidden="true">⌄</span>
      </button>
      ${
        s.accountMenuOpen
          ? `<ul class="tb-account-dropdown" role="menu">
        <li role="none"><button type="button" role="menuitem" data-action="account-goto-settings" data-section="account">アカウント</button></li>
        <li role="none"><button type="button" role="menuitem" data-action="account-goto-settings" data-section="storage">データ</button></li>
        <li role="none"><button type="button" role="menuitem" data-action="account-goto-settings" data-section="integrations">連携</button></li>
        <li role="none"><button type="button" role="menuitem" data-action="account-logout">ログアウト</button></li>
      </ul>`
          : ""
      }
    </div>`;
}

/** ログインモーダル（§15/§16）: STEP1 メール → STEP2 6桁OTP */
function renderLoginModal() {
  const modal = el("tb-login-modal");
  const body = el("tb-login-body");
  if (!modal || !body) return;
  const s = account.getState();
  modal.hidden = !s.loginModalOpen;
  if (!s.loginModalOpen) return;

  if (s.loginStep === "otp") {
    const cooldown = account.resendCooldownRemaining();
    body.innerHTML = `
      <p class="tb-card-hint">確認コードを送りました</p>
      <p class="tb-card-title" style="margin-bottom:12px;">${esc(s.loginEmail)}</p>
      <div class="tb-otp-group" role="group" aria-label="6桁の確認コード">
        ${Array.from({ length: 6 })
          .map(
            (_, i) => `<input class="tb-otp-box" id="tb-otp-${i}" data-otp-index="${i}" type="text"
              inputmode="numeric" pattern="[0-9]*" maxlength="1"
              autocomplete="${i === 0 ? "one-time-code" : "off"}" aria-label="確認コード ${i + 1}桁目">`
          )
          .join("")}
      </div>
      ${s.otpError ? `<div class="tb-notice tb-notice-error"><span>${esc(s.otpError)}</span></div>` : ""}
      <div class="tb-row-actions" style="margin-top:16px;">
        <button type="button" class="tb-btn tb-btn-primary" data-action="otp-submit" ${
          s.otpSubmitting ? "disabled" : ""
        }>DAYLOOPを始める</button>
      </div>
      <div class="tb-row-actions">
        <button type="button" class="tb-btn tb-btn-ghost tb-btn-sm" data-action="otp-resend" ${
          cooldown > 0 ? "disabled" : ""
        }>コードを再送${cooldown > 0 ? `（${cooldown}秒）` : ""}</button>
        <button type="button" class="tb-btn tb-btn-ghost tb-btn-sm" data-action="otp-change-email">メールを変更</button>
      </div>`;
    if (!body.contains(document.activeElement)) el("tb-otp-0")?.focus();
  } else {
    body.innerHTML = `
      <p class="tb-card-title">時間がない。<br>だから、考える時間を減らす。</p>
      <label class="visually-hidden" for="tb-login-email">メールアドレス</label>
      <input type="email" id="tb-login-email" class="tb-text" placeholder="example@gmail.com"
        autocomplete="email" inputmode="email">
      ${s.loginError ? `<div class="tb-notice tb-notice-error"><span>${esc(s.loginError)}</span></div>` : ""}
      <div class="tb-row-actions" style="margin-top:12px;">
        <button type="button" class="tb-btn tb-btn-primary" data-action="login-email-submit" ${
          s.emailSubmitting ? "disabled" : ""
        }>メールで続ける</button>
      </div>
      <div class="tb-row-actions">
        <button type="button" class="tb-btn tb-btn-ghost tb-btn-sm" data-action="continue-guest">ログインせず試す</button>
      </div>
      ${
        !account.isCloudAvailable()
          ? `<p class="tb-card-hint">Cloud機能は未設定です。ログインせずに使えます。</p>`
          : ""
      }`;
    if (!body.contains(document.activeElement)) el("tb-login-email")?.focus();
  }
}

const MIGRATION_COPY = {
  "empty-cloud": {
    title: "データの引き継ぎ",
    body: (n) => `この端末に<strong>${n}件</strong>のタスクがあります。<br>DAYLOOPアカウントへ引き継ぎますか？`,
    actions: [
      { choice: "migrate", label: "アカウントへ引き継ぐ", primary: true },
      { choice: "keep-local", label: "この端末のまま使う", primary: false },
    ],
  },
  "both-have-data": {
    title: "この端末とCloudにデータがあります",
    body: (localN, cloudN) =>
      `この端末: <strong>${localN} Tasks</strong><br>DAYLOOP Cloud: <strong>${cloudN} Tasks</strong>`,
    actions: [
      { choice: "merge", label: "内容を統合", primary: true },
      { choice: "use-cloud", label: "Cloudを使用", primary: false },
      { choice: "use-local", label: "この端末を使用", primary: false },
    ],
  },
};

/** Guest→Account引き継ぎ / Local+Cloud統合（§19/§20）。絶対に自動実行しない */
function renderMigrationModal() {
  const modal = el("tb-migration-modal");
  const body = el("tb-migration-body");
  if (!modal || !body) return;
  const s = account.getState();
  const prompt = s.migrationPrompt;
  modal.hidden = !prompt;
  if (!prompt) return;

  const copy = MIGRATION_COPY[prompt.scenario];
  if (!copy) {
    modal.hidden = true;
    return;
  }
  body.innerHTML = `
    <p class="tb-card-hint">${copy.body(prompt.localCount, prompt.cloudCount)}</p>
    <div class="tb-row-actions" style="margin-top:16px;">
      ${copy.actions
        .map(
          (a) =>
            `<button type="button" class="tb-btn ${a.primary ? "tb-btn-primary" : "tb-btn-ghost"}"
              data-action="migration-choice" data-choice="${a.choice}">${esc(a.label)}</button>`
        )
        .join("")}
    </div>`;
}

// ─── DAYLOOP Mini（Execution UI。§65-71） ────────────────────

function notificationPrefs() {
  return normalizeNotificationPrefs(state.settings?.notifications);
}

function saveNotificationPrefs(patch) {
  state.settings = { ...state.settings, notifications: { ...notificationPrefs(), ...patch } };
  commit();
}

async function toggleMini() {
  if (miniMode !== "closed") {
    closeMini();
    return;
  }
  if (isPipSupported()) {
    try {
      const pipWindow = await openPipWindow({ width: 320, height: 360 });
      if (!pipWindow) throw new Error("pip_unavailable");
      miniPipWindow = pipWindow;
      miniMode = "pip";
      const miniEl = miniElRef;
      miniEl.classList.remove("is-sticky");
      miniEl.hidden = false;
      pipWindow.document.body.append(miniEl);
      // PiP windowも同じdata-action delegationを使えるようにする（Documentが別なため）
      pipWindow.document.addEventListener("click", onClick);
      pipWindow.addEventListener("pagehide", () => {
        if (miniMode === "pip") returnMiniToMainDocument();
      });
      render();
      return;
    } catch {
      miniMode = "closed";
      miniPipWindow = null;
      // requestWindow()はユーザー操作起点でも失敗しうる（Window数上限等）。Fallbackへ落ちる。
    }
  }
  openMiniSticky();
}

function openMiniSticky() {
  miniMode = "sticky";
  const miniEl = miniElRef;
  miniEl.classList.add("is-sticky");
  miniEl.hidden = false;
  render();
}

function returnMiniToMainDocument() {
  const miniEl = miniElRef;
  if (miniEl && miniPipWindow && miniEl.ownerDocument === miniPipWindow.document) {
    document.body.append(miniEl);
  }
  miniMode = "closed";
  miniPipWindow = null;
  if (miniEl) miniEl.hidden = true;
  render();
}

function closeMini() {
  if (miniMode === "pip" && miniPipWindow) {
    miniPipWindow.close();
    return; // pagehide が returnMiniToMainDocument() を呼ぶ
  }
  const miniEl = miniElRef;
  if (miniEl) {
    miniEl.hidden = true;
    miniEl.classList.remove("is-sticky");
  }
  miniMode = "closed";
  render();
}

function completeCurrentMiniTask() {
  const summary = summarize({ ...day(), tasks: todayTasks(), blocks: decorateBlocks(day().blocks ?? [], todayTasks()) }, nowHHMM());
  if (!summary.currentBlock) return;
  toggleDone(summary.currentBlock.taskId);
  overdueDismissedKey = null;

  const nextSummary = summarize({ ...day(), tasks: todayTasks(), blocks: decorateBlocks(day().blocks ?? [], todayTasks()) }, nowHHMM());
  const plan = planCompletionNotification({ prefs: notificationPrefs(), nextBlock: nextSummary.nextBlock });
  if (plan) fireNotification(plan.kind, plan.block);
}

function renderMini(summary) {
  const container = miniElRef;
  const toggleBtn = el("tb-mini-toggle");
  if (toggleBtn) toggleBtn.hidden = false;
  if (!container) return;

  const clock = container.querySelector("#tb-mini-clock");
  if (clock) clock.textContent = nowHHMM();

  if (miniMode === "closed") return;

  const view = deriveMiniView(summary);
  const body = container.querySelector("#tb-mini-body");
  if (!body) return;

  if (view.mode === "empty") {
    body.innerHTML = `<p class="tb-mini-time">今日の予定はまだありません。DAYLOOPで時間割をつくってください。</p>`;
  } else if (view.mode === "overdue") {
    const key = `${view.block.taskId}-${view.block.start}`;
    if (overdueDismissedKey === key) {
      body.innerHTML = miniNowMarkup(view.block, 0, view.nextBlock);
    } else {
      body.innerHTML = `
        <p class="tb-mini-label">NOW</p>
        <p class="tb-mini-title">${esc(view.block.title)}</p>
        <p class="tb-mini-overdue">予定時間を過ぎています。</p>
        <div class="tb-mini-row">
          <button type="button" class="tb-mini-btn is-ghost" data-action="mini-continue">続ける</button>
          <button type="button" class="tb-mini-btn" data-action="mini-replan">残りを組み直す</button>
        </div>`;
    }
  } else if (view.mode === "now") {
    body.innerHTML = miniNowMarkup(view.block, view.remainingMinutes, view.nextBlock);
  } else if (view.mode === "next-only") {
    body.innerHTML = `
      <p class="tb-mini-label">NEXT</p>
      <p class="tb-mini-title">${esc(view.nextBlock.title)}</p>
      <p class="tb-mini-time">${esc(view.nextBlock.start)} - ${esc(view.nextBlock.end)}</p>`;
  }
}

function miniNowMarkup(block, remainingMinutes, nextBlock) {
  return `
    <p class="tb-mini-label">NOW</p>
    <p class="tb-mini-title">${esc(block.title)}</p>
    <p class="tb-mini-time">${esc(block.start)} - ${esc(block.end)}</p>
    <p class="tb-mini-remaining">残り ${Math.max(0, remainingMinutes)}分</p>
    <div class="tb-mini-row">
      <button type="button" class="tb-mini-btn" data-action="mini-complete">完了</button>
      <button type="button" class="tb-mini-btn is-ghost" data-action="mini-open-main">DAYLOOPを開く</button>
    </div>
    ${
      nextBlock
        ? `<div class="tb-mini-next"><strong>NEXT</strong> ${esc(nextBlock.title)}（${esc(nextBlock.start)}〜）</div>`
        : ""
    }`;
}

// ─── Mobile Sticky NOW Bar（§73/§74） ─────────────────────────

function renderMobileNow(summary) {
  const container = el("tb-mobile-now");
  if (!container) return;
  const view = deriveMiniView(summary);

  if (view.mode === "empty") {
    container.hidden = true;
    return;
  }
  container.hidden = false;

  const summaryEl = el("tb-mobile-now-summary");
  if (summaryEl) {
    if (view.mode === "now") {
      summaryEl.textContent = `NOW ｜ ${view.block.title} ｜ 残り${Math.max(0, view.remainingMinutes)}分`;
    } else if (view.mode === "overdue") {
      summaryEl.textContent = `NOW ｜ ${view.block.title} ｜ 予定時間を超過`;
    } else {
      summaryEl.textContent = `NEXT ｜ ${view.nextBlock.title} ｜ ${view.nextBlock.start}〜`;
    }
  }

  const bar = el("tb-mobile-now-bar");
  if (bar) bar.setAttribute("aria-expanded", String(mobileNowExpanded));

  const expanded = el("tb-mobile-now-expanded");
  if (!expanded) return;
  expanded.hidden = !mobileNowExpanded;
  if (!mobileNowExpanded) return;

  if (view.mode === "now") {
    expanded.innerHTML = miniNowMarkup(view.block, view.remainingMinutes, view.nextBlock);
  } else if (view.mode === "overdue") {
    const key = `mobile-${view.block.taskId}-${view.block.start}`;
    expanded.innerHTML =
      overdueDismissedKey === key
        ? miniNowMarkup(view.block, 0, view.nextBlock)
        : `
      <p class="tb-mini-label">NOW</p>
      <p class="tb-mini-title">${esc(view.block.title)}</p>
      <p class="tb-mini-overdue">予定時間を過ぎています。</p>
      <div class="tb-mini-row">
        <button type="button" class="tb-mini-btn is-ghost" data-action="mini-continue">続ける</button>
        <button type="button" class="tb-mini-btn" data-action="mini-replan">残りを組み直す</button>
      </div>`;
  } else {
    expanded.innerHTML = `
      <p class="tb-mini-label">NEXT</p>
      <p class="tb-mini-title">${esc(view.nextBlock.title)}</p>
      <p class="tb-mini-time">${esc(view.nextBlock.start)} - ${esc(view.nextBlock.end)}</p>`;
  }
}

// ─── App Badge（§82） ──────────────────────────────────────────

function updateAppBadge(tasks) {
  const incomplete = tasks.filter((t) => !t.done).length;
  setAppBadgeCount(incomplete);
}

// ─── 実行サポート通知（§78/§79/§86/§87） ─────────────────────

function fireNotification(kind, block) {
  if (typeof Notification === "undefined" || Notification.permission !== "granted") return;
  const { title, body } = buildNotificationMessage(kind, block, {
    showTaskTitle: notificationPrefs().showTaskTitleInNotification,
  });
  try {
    const n = new Notification(title, { body, tag: `daylock-${kind}`, icon: "/images/dayloop/brand/dayloop-logo-icon.svg" });
    n.onclick = () => {
      window.focus();
      n.close();
    };
  } catch {
    // Notification生成に失敗しても実行そのものは継続する（付加機能のため）
  }
}

/** 1分ごとのtickからだけ呼ぶ（renderのたびに呼ぶと同じ通知が連打される） */
function checkAndFireNotifications(summary) {
  const nowKey = nowHHMM();
  if (lastNotificationMinute === nowKey) return;
  lastNotificationMinute = nowKey;

  const toFire = planNotifications({ summary, prefs: notificationPrefs(), nowHHMM: nowKey });
  for (const { kind, block } of toFire) fireNotification(kind, block);
}

// ─── Web Push 購読（§75-77/§90） ──────────────────────────────

async function registerServiceWorker() {
  if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) return null;
  try {
    return await navigator.serviceWorker.register("/sw.js", { scope: "/app/" });
  } catch {
    return null;
  }
}

async function subscribeToPush() {
  if (!isPushSupported() || !isPushConfigured()) {
    notify("warn", "通知機能は未設定です。");
    return;
  }
  const authState = account.getState();
  if (authState.status !== "authenticated") {
    notify("warn", "Push通知はログイン後に使えます。");
    return;
  }
  try {
    const permission = await Notification.requestPermission();
    if (permission !== "granted") {
      notify("warn", "通知が許可されませんでした。");
      return;
    }
    const registration = await registerServiceWorker();
    if (!registration) throw new Error("service_worker_unavailable");
    const subscription = await registration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(getVapidPublicKey()),
    });
    const row = subscriptionToRow({
      subscriptionJson: subscription.toJSON(),
      userId: authState.user.id,
      deviceId: getDeviceId(),
    });
    const client = await getSupabaseClient();
    if (!client) throw new Error("not_configured");
    const { error } = await client.from("push_subscriptions").upsert(row, { onConflict: "user_id,device_id" });
    if (error) throw error;
    notify("success", "この端末への通知を有効にしました。");
    renderSettingsModal();
  } catch {
    notify("error", "通知の設定に失敗しました。");
  }
}

async function unsubscribeFromPush() {
  try {
    const registration = await navigator.serviceWorker?.getRegistration("/app/");
    const subscription = await registration?.pushManager?.getSubscription();
    if (subscription) await subscription.unsubscribe();

    const authState = account.getState();
    if (authState.status === "authenticated") {
      const client = await getSupabaseClient();
      if (client) {
        await client
          .from("push_subscriptions")
          .update({ enabled: false })
          .eq("user_id", authState.user.id)
          .eq("device_id", getDeviceId());
      }
    }
    notify("info", "この端末への通知を無効にしました。");
    renderSettingsModal();
  } catch {
    notify("error", "解除に失敗しました。");
  }
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
    onOtpKeydown(event);
  });
  document.addEventListener("input", onOtpInput);
  document.addEventListener("paste", onOtpPaste);

  el("tb-import-file")?.addEventListener("change", onImportFileSelected);
}

// ─── OTP入力（数字のみ・auto advance・paste対応。§16/§59） ──────

function onOtpInput(event) {
  const target = event.target;
  if (!target?.matches?.("[data-otp-index]")) return;
  const index = Number(target.dataset.otpIndex);
  const clean = sanitizeDigits(target.value).slice(-1);
  target.value = clean;
  if (clean && index < 5) el(`tb-otp-${index + 1}`)?.focus();
}

function onOtpKeydown(event) {
  const target = event.target;
  if (!target?.matches?.("[data-otp-index]")) return;
  const index = Number(target.dataset.otpIndex);
  if (event.key === "Backspace" && !target.value && index > 0) {
    el(`tb-otp-${index - 1}`)?.focus();
  }
}

function onOtpPaste(event) {
  const target = event.target;
  if (!target?.matches?.("[data-otp-index]")) return;
  const text = event.clipboardData?.getData("text") ?? "";
  const digits = sanitizeDigits(text);
  if (!digits) return;
  event.preventDefault();
  for (let i = 0; i < 6; i += 1) {
    const box = el(`tb-otp-${i}`);
    if (box) box.value = digits[i] ?? "";
  }
  el(`tb-otp-${Math.max(0, Math.min(digits.length, 6) - 1)}`)?.focus();
}

function readOtpCode() {
  let code = "";
  for (let i = 0; i < 6; i += 1) code += el(`tb-otp-${i}`)?.value ?? "";
  return sanitizeDigits(code);
}

function onClick(event) {
  if (account.getState().accountMenuOpen && !event.target.closest(".tb-account-menu")) {
    account.toggleAccountMenu(false);
  }

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
    case "open-login":
      account.openLoginModal();
      break;
    case "close-login-modal":
      account.closeLoginModal();
      break;
    case "continue-guest":
      account.continueAsGuest();
      break;
    case "login-email-submit":
      account.submitEmail(el("tb-login-email")?.value ?? "");
      break;
    case "otp-submit":
      account.submitOtp(readOtpCode());
      break;
    case "otp-resend":
      account.resendOtp();
      break;
    case "otp-change-email":
      account.changeEmail();
      break;
    case "account-menu-toggle":
      account.toggleAccountMenu();
      break;
    case "account-goto-settings":
      account.toggleAccountMenu(false);
      settingsSection = target.dataset.section;
      openSettings();
      break;
    case "account-logout":
      account.toggleAccountMenu(false);
      account.signOut();
      break;
    case "open-cloud-settings":
      if (account.getState().status !== "authenticated") {
        account.openLoginModal();
      } else {
        settingsSection = "storage";
        openSettings();
      }
      break;
    case "cloud-manual-sync":
      syncStateToActiveProvider();
      notify("info", "同期を開始しました。");
      break;
    case "migration-choice":
      account.chooseMigration(target.dataset.choice);
      break;
    case "account-delete-start":
      account.startAccountDelete();
      break;
    case "account-delete-confirm":
      account.confirmAccountDeleteStep();
      break;
    case "account-delete-cancel":
      account.cancelAccountDelete();
      break;
    case "account-delete-final":
      account.finalizeAccountDelete();
      break;
    case "mini-toggle":
      toggleMini();
      break;
    case "mini-minimize":
      closeMini();
      break;
    case "mini-complete":
      completeCurrentMiniTask();
      break;
    case "mini-open-main":
      window.focus();
      break;
    case "mini-continue": {
      const summary = summarize(
        { ...day(), tasks: todayTasks(), blocks: decorateBlocks(day().blocks ?? [], todayTasks()) },
        nowHHMM()
      );
      if (summary.currentBlock) overdueDismissedKey = `${summary.currentBlock.taskId}-${summary.currentBlock.start}`;
      render();
      break;
    }
    case "mini-replan":
      overdueDismissedKey = null;
      rebuild({ fromHHMM: nowHHMM() });
      break;
    case "mobile-now-toggle":
      mobileNowExpanded = !mobileNowExpanded;
      render();
      break;
    case "notif-toggle":
      saveNotificationPrefs({ [target.dataset.pref]: !notificationPrefs()[target.dataset.pref] });
      renderSettingsModal();
      break;
    case "notif-request-permission":
      Notification?.requestPermission?.().then(() => renderSettingsModal());
      break;
    case "push-subscribe":
      subscribeToPush();
      break;
    case "push-unsubscribe":
      unsubscribeFromPush();
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
  account.closeLoginModal();
  // tb-migration-modal はここでは閉じない（§20: 明示的な選択でしか閉じない）
}

function openPlanModal(feature) {
  const labels = {
    googleCalendarSync:
      "Googleカレンダーとの直接同期は準備中です。いまは .ics ファイルを書き出して取り込めます。",
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
  if (typeof navigator !== "undefined" && navigator.onLine === false) {
    setSyncStatus("offline");
    return;
  }
  const config = activeProviderConfig();
  const namespace = storage.getActiveNamespace();
  setSyncStatus("pending");
  queueSync(async () => {
    try {
      const result = await provider.saveState(state, config, { namespace });
      setSyncStatus(result?.ok === false ? "error" : "synced", result?.error ?? "");
      if (result?.conflicts?.length > 0) {
        notify("warn", `別の端末で${result.conflicts.length}件のタスクが変更されています。「今すぐ同期」で最新の内容を取り込んでください。`);
      }
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
  { id: "account", label: "アカウント" },
  { id: "integrations", label: "連携" },
  { id: "storage", label: "データ" },
  { id: "focus", label: "実行サポート" },
  { id: "privacy", label: "プライバシー" },
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
  } else if (settingsSection === "integrations") {
    body.innerHTML = renderIntegrationsSection();
  } else if (settingsSection === "focus") {
    body.innerHTML = renderFocusSection();
  } else if (settingsSection === "privacy") {
    body.innerHTML = renderPrivacySection();
  } else {
    body.innerHTML = renderAccountSection();
  }
}

/** §79: 実行サポート（Mini / 通知） */
function renderFocusSection() {
  const prefs = notificationPrefs();
  const permission = typeof Notification !== "undefined" ? Notification.permission : "unsupported";

  const toggle = (pref, label) => `
    <label class="tb-inline-field">
      <input type="checkbox" data-action="notif-toggle" data-pref="${pref}" ${prefs[pref] ? "checked" : ""}>
      ${esc(label)}
    </label>`;

  return `
    <div class="tb-settings-section">
      <h3>実行サポート</h3>
      <p class="tb-card-hint">DAYLOOPを開かなくても、今やること・次にやることが分かるようにします。</p>

      <p class="tb-card-title" style="margin-bottom:4px;">Desktop Mini</p>
      ${toggle("desktopMiniEnabled", "Desktop Mini")}
      <p class="tb-card-hint">${isPipSupported() ? "このブラウザはミニ表示（常時手前表示）に対応しています。" : "このブラウザは常時手前表示に対応していないため、アプリ内の固定表示で代わります。"}</p>

      <hr class="tb-settings-divider">
      <p class="tb-card-title" style="margin-bottom:4px;">通知</p>
      ${toggle("taskStartNotification", "Task Start Notification")}
      ${toggle("fiveMinutesBefore", "5 Minutes Before")}
      ${toggle("showNextAfterComplete", "Show Next After Complete")}
      ${toggle("endNotification", "End Notification")}
      ${toggle("showTaskTitleInNotification", "通知にタスク名を表示する")}

      <p class="tb-card-hint">
        通知の許可状態: <strong>${esc(permission === "granted" ? "許可済み" : permission === "denied" ? "拒否されています" : "未確認")}</strong>
      </p>
      ${
        permission !== "granted"
          ? `<div class="tb-row-actions"><button type="button" class="tb-btn tb-btn-ghost tb-btn-sm" data-action="notif-request-permission">通知を許可する</button></div>`
          : ""
      }

      <hr class="tb-settings-divider">
      <p class="tb-card-title" style="margin-bottom:4px;">アプリを閉じていても通知を受け取る（Web Push）</p>
      <p class="tb-card-hint">DAYLOOPアカウントでログインすると、この端末をPush通知の対象として登録できます。</p>
      <div class="tb-row-actions">
        <button type="button" class="tb-btn tb-btn-primary tb-btn-sm" data-action="push-subscribe">この端末の通知を有効にする</button>
        <button type="button" class="tb-btn tb-btn-ghost tb-btn-sm" data-action="push-unsubscribe">無効にする</button>
      </div>
    </div>`;
}

/** §33/§34: アカウント */
function renderAccountSection() {
  const s = account.getState();

  if (s.status !== "authenticated" || !s.user) {
    return `
      <div class="tb-settings-section">
        <h3>アカウント</h3>
        <p class="tb-card-hint">現在はゲスト利用です。ログインしなくても使えます。</p>
        <p class="tb-card-hint">アカウントを作ると、DAYLOOP Cloudへ保存でき、複数端末から同じDAYLOOPを使えます。</p>
        <div class="tb-row-actions">
          <button type="button" class="tb-btn tb-btn-primary tb-btn-sm" data-action="open-login">ログイン / 新規登録</button>
        </div>
      </div>`;
  }

  return `
    <div class="tb-settings-section">
      <h3>アカウント</h3>
      <p class="tb-card-hint">Email: <strong>${esc(s.user.email ?? "")}</strong></p>
      <p class="tb-card-hint">プラン: <strong>Free Plan</strong></p>
      <p class="tb-card-hint">ログイン状態: <strong>✓ DAYLOOP Cloud</strong></p>
      <div class="tb-row-actions">
        <button type="button" class="tb-btn tb-btn-ghost tb-btn-sm" data-action="account-logout">ログアウト</button>
      </div>
    </div>`;
}

/** §33: 連携（Google Calendar / Obsidian / Google Sheets）。Coming Soonは誇張しない */
function renderIntegrationsSection() {
  return `
    <div class="tb-settings-section">
      <h3>連携</h3>
      <p class="tb-card-title" style="margin-bottom:4px;">Googleカレンダー</p>
      <p class="tb-card-hint"><strong>今すぐ使える:</strong> ICS書き出し（Googleカレンダーの「他のカレンダーを追加 → インポート」から取り込めます）。</p>
      <p class="tb-card-hint"><strong>Coming Soon:</strong> 直接同期。既存のGoogle予定をDAYLOOPが勝手に変更・削除することはありません。</p>
      <div class="tb-row-actions">
        <button type="button" class="tb-btn tb-btn-ghost tb-btn-sm" data-action="export-ics">Googleカレンダーへ追加（.ics）</button>
      </div>
      <hr class="tb-settings-divider">
      <p class="tb-card-title" style="margin-bottom:4px;">Obsidian / Google Sheets</p>
      <p class="tb-card-hint">
        Vaultフォルダの接続・Spreadsheetの接続は「データ」タブの保存先一覧から行えます。
      </p>
      <div class="tb-row-actions">
        <button type="button" class="tb-btn tb-btn-ghost tb-btn-sm" data-action="settings-section" data-section="storage">データを開く</button>
      </div>
    </div>`;
}

/** §33: プライバシー（AIへ送る内容 / Cloudへ保存する内容 / Account Delete） */
function renderPrivacySection() {
  const provider = activeProvider();
  const location =
    provider.id === "local"
      ? "この端末（ブラウザのlocalStorage）"
      : `この端末（キャッシュ） + ${provider.label}`;
  const s = account.getState();

  return `
    <div class="tb-settings-section">
      <h3>プライバシー</h3>
      <p class="tb-card-hint">現在の保存先: <strong>${esc(location)}</strong></p>

      <p class="tb-card-title" style="margin-bottom:4px;">AIへ送る内容</p>
      <p class="tb-card-hint">
        AIは「頭の中を全部書く」入力（Brain Dump）のテキストだけを、タスク候補として整理するために送ります。
        実際の時間割配置はAIではなく、Timebox Engineが決定論的に行います。保存はしません。
      </p>
      <p class="tb-card-hint">
        バックエンドが未設定の場合、Brain Dumpは自動的に「入力した行をそのままタスク候補にする」
        方式へ切り替わります。Manual Entryはこの状態でも通常どおり使えます。
      </p>

      <p class="tb-card-title" style="margin-bottom:4px;">Cloudへ保存する内容</p>
      <p class="tb-card-hint">
        ログインしてDAYLOOP Cloudを使う場合、タスク・時間割・Brain Dump・実行記録・Skillの候補をSupabaseへ保存します。
        Obsidianのフォルダ選択情報など端末固有の設定はCloudへ送りません。
      </p>

      <hr class="tb-settings-divider">
      <p class="tb-card-title" style="margin-bottom:4px;">アカウントの削除</p>
      ${renderAccountDeleteControls(s)}
    </div>`;
}

function renderAccountDeleteControls(s) {
  if (s.status !== "authenticated") {
    return `<p class="tb-card-hint">ログイン中のアカウントがある場合、ここから削除できます。</p>`;
  }
  if (s.deleteStep === 0) {
    return `
      <div class="tb-row-actions">
        <button type="button" class="tb-btn tb-btn-ghost tb-btn-sm" data-action="account-delete-start">アカウントを削除する</button>
      </div>`;
  }
  if (s.deleteStep === 1) {
    return `
      <div class="tb-notice tb-notice-warn">
        <span>アカウントとCloud上のデータが削除されます。この操作は取り消せません。</span>
      </div>
      <div class="tb-row-actions">
        <button type="button" class="tb-btn tb-btn-ghost tb-btn-sm" data-action="account-delete-cancel">キャンセル</button>
        <button type="button" class="tb-btn tb-btn-primary tb-btn-sm" data-action="account-delete-confirm">続ける</button>
      </div>`;
  }
  return `
    <div class="tb-notice tb-notice-warn">
      <span>本当によろしいですか？ ${esc(s.user?.email ?? "")} のアカウントとCloud上のすべてのデータが削除されます。</span>
    </div>
    ${s.deleteError ? `<div class="tb-notice tb-notice-error"><span>${esc(s.deleteError)}</span></div>` : ""}
    <div class="tb-row-actions">
      <button type="button" class="tb-btn tb-btn-ghost tb-btn-sm" data-action="account-delete-cancel">キャンセル</button>
      <button type="button" class="tb-btn tb-btn-danger tb-btn-sm" data-action="account-delete-final" ${
        s.deleteSubmitting ? "disabled" : ""
      }>アカウントを削除</button>
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
      <h3>データ</h3>
      <p class="tb-card-hint">
        現在の保存先: <strong>${esc(provider.label)}</strong>
        ${syncStatus ? ` / 状態: ${esc(SYNC_STATUS_LABEL[syncStatus] ?? syncStatus)}` : ""}
      </p>
      ${switchPanel}
      <ul class="tb-provider-list">${cards}</ul>
      <hr class="tb-settings-divider">
      <p class="tb-card-title" style="margin-bottom:4px;">バックアップ</p>
      <p class="tb-card-hint">保存先に関わらず、JSON Export / Import はいつでも使えます。ドメインや端末を変えるときの移行手段です。</p>
      <div class="tb-row-actions">
        <button type="button" class="tb-btn tb-btn-ghost tb-btn-sm" data-action="export-json">バックアップを保存</button>
        <button type="button" class="tb-btn tb-btn-ghost tb-btn-sm" data-action="import-json">バックアップを読み込む</button>
      </div>
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
  } else if (provider.id === "cloud") {
    const s = account.getState();
    if (s.status !== "authenticated") {
      controls = `
        <p class="tb-card-hint">アカウントでログインすると、複数端末から同じDAYLOOPデータを使えます。</p>
        <div class="tb-row-actions">
          <button type="button" class="tb-btn tb-btn-primary tb-btn-sm" data-action="open-login">ログインしてCloudを使う</button>
        </div>`;
    } else {
      controls = `
        <p class="tb-card-hint">✓ Accountと同期（${esc(s.user?.email ?? "")}）</p>
        <div class="tb-row-actions">
          ${
            isActive
              ? `<span class="tb-chip tb-chip-pinned">現在の保存先</span>`
              : `<button type="button" class="tb-btn tb-btn-ghost tb-btn-sm" data-action="provider-select" data-provider="cloud">Cloudにする</button>`
          }
          <button type="button" class="tb-btn tb-btn-ghost tb-btn-sm" data-action="cloud-manual-sync">今すぐ同期</button>
        </div>`;
    }
  } else {
    controls = `<span class="tb-lock">Coming Soon</span>`;
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
  if (targetId === "cloud") {
    if (account.getState().status !== "authenticated") {
      account.openLoginModal();
      return;
    }
    await account.connectCloudNow();
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
