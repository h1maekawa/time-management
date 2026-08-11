/**
 * DAYLOOP — 保存層（内部機能名: Timebox）。
 *
 * 初期版は端末のlocalStorageだけで完結する（サーバーへ何も送らない）。
 * 将来クラウド保存へ移すときに困らないよう、
 *  - 保存の形はひとつのstateオブジェクトに寄せる
 *  - 読み書きの入口を load/save/patch の3つに絞る
 *  - version を持たせてマイグレーションできるようにする
 * の3点を守る。
 */

import { defaultWeeklyTemplate, todayLocal } from "./timebox-engine.js";

// KEY はブラウザ内の名前空間の名前であり、スキーマバージョンとは独立している。
// スキーマバージョンは中身の `version` フィールド（STORAGE_VERSION）で管理する。
const KEY = "timebox-os/v1";
export const STORAGE_VERSION = 2;

/**
 * Cache Namespace（§39）。
 * Guest利用中はnull＝既存の "timebox-os/v1" をそのまま使う（rename/deleteしない）。
 * ログイン中は `user/<user-id>` へ切り替え、Account Cache と Guest State を分離する。
 * ログアウトすると null へ戻り、Guest画面へAccount側のキャッシュがそのまま出ることを防ぐ。
 * 同じAccountへ再ログインすれば同じキーを再び使うため、キャッシュは再利用される。
 */
let namespaceSuffix = null;
/** namespace(storageKey())ごとに分離したメモリ退避先。localStorageが無い環境でも
 * namespace切り替え後に元のnamespaceへ戻ればキャッシュが再利用できるようにする。 */
const memoryFallbackStore = new Map();

export function setActiveNamespace(namespace) {
  namespaceSuffix = namespace || null;
}

export function getActiveNamespace() {
  return namespaceSuffix;
}

export function userNamespace(userId) {
  return `user/${userId}`;
}

function storageKey() {
  return namespaceSuffix ? `${KEY}::${namespaceSuffix}` : KEY;
}

/** localStorageが使えない環境（プライベートモード等）ではメモリ上で動かす */
function storage() {
  try {
    const test = "__timebox_probe__";
    window.localStorage.setItem(test, "1");
    window.localStorage.removeItem(test);
    return window.localStorage;
  } catch {
    return null;
  }
}

export function isPersistent() {
  return storage() !== null;
}

export function emptyState() {
  return {
    version: STORAGE_VERSION,
    /** すべてのタスク。今日の分も後回しの分もここに入る */
    tasks: [],
    /** 日付ごとの時間割 { "YYYY-MM-DD": { date, windows, blocks, updatedAt } } */
    days: {},
    /** 曜日ごとの時間枠 */
    template: defaultWeeklyTemplate(),
    /** 完了記録。所要時間の学習（Phase 4）で使う */
    history: [],
    /** Brain Dump（殴り書き）の下書き。Task確定後も原文はここに残す */
    captures: [],
    /** Capture単位のAI提案。Task確定前の状態で、Task Storeとは別に持つ */
    aiAnalyses: [],
    /** Taskの実行記録（予定と実績）。Task本体とは別に積み上げる履歴 */
    executions: [],
    /** 繰り返しの手順から見つかった「型」の候補 */
    skills: [],
    /** 自動化してもよさそうなことの候補。承認するまでは何もしない */
    automationCandidates: [],
    settings: {
      plan: "free",
      lastOpenedDate: todayLocal(),
      /** データ保存先: local / obsidian / google-sheets-gas / google-drive / cloud */
      storageProviderId: "local",
      /** プロバイダごとの設定・同期状態。キーはproviderId */
      storageProviders: {},
    },
  };
}

/**
 * Version 1 → 2 マイグレーション。
 * v1にはcaptures/aiAnalyses/executions/skills/automationCandidatesが無かったので
 * 空配列で補い、既存タスクには origin: "manual" を補う
 * （AI Brain Dump生まれのタスクと区別するため）。
 * 既存の tasks/days/template/history/settings の中身は一切消さない・書き換えない。
 */
function migrateV1toV2(raw) {
  return {
    ...raw,
    version: 2,
    tasks: Array.isArray(raw.tasks)
      ? raw.tasks.map((task) => ({ ...task, origin: task.origin ?? "manual" }))
      : [],
    captures: Array.isArray(raw.captures) ? raw.captures : [],
    aiAnalyses: Array.isArray(raw.aiAnalyses) ? raw.aiAnalyses : [],
    executions: Array.isArray(raw.executions) ? raw.executions : [],
    skills: Array.isArray(raw.skills) ? raw.skills : [],
    automationCandidates: Array.isArray(raw.automationCandidates) ? raw.automationCandidates : [],
    settings: {
      ...raw.settings,
      storageProviderId: raw.settings?.storageProviderId ?? "local",
      storageProviders: raw.settings?.storageProviders ?? {},
    },
  };
}

/** 欠けた項目を初期値で埋める。古い保存データを壊さずに読むため */
function normalize(raw) {
  const base = emptyState();
  if (!raw || typeof raw !== "object") return base;

  const working = (Number(raw.version) || 1) < 2 ? migrateV1toV2(raw) : raw;

  return {
    ...base,
    ...working,
    version: STORAGE_VERSION,
    tasks: Array.isArray(working.tasks) ? working.tasks : base.tasks,
    days: working.days && typeof working.days === "object" ? working.days : base.days,
    template: working.template?.days?.length === 7 ? working.template : base.template,
    history: Array.isArray(working.history) ? working.history : base.history,
    captures: Array.isArray(working.captures) ? working.captures : base.captures,
    aiAnalyses: Array.isArray(working.aiAnalyses) ? working.aiAnalyses : base.aiAnalyses,
    executions: Array.isArray(working.executions) ? working.executions : base.executions,
    skills: Array.isArray(working.skills) ? working.skills : base.skills,
    automationCandidates: Array.isArray(working.automationCandidates)
      ? working.automationCandidates
      : base.automationCandidates,
    settings: {
      ...base.settings,
      ...(working.settings ?? {}),
      storageProviders: {
        ...base.settings.storageProviders,
        ...(working.settings?.storageProviders ?? {}),
      },
    },
  };
}

/** 配列の中から id が一致する要素を差し替える。無ければ末尾に足す（upsert） */
function upsertById(list, item) {
  const index = list.findIndex((existing) => existing.id === item.id);
  if (index === -1) return [...list, item];
  const next = [...list];
  next[index] = item;
  return next;
}

/** Brain Dumpの下書きを保存・更新する */
export function saveCapture(capture) {
  const state = load();
  return save({ ...state, captures: upsertById(state.captures, capture) });
}

/** Capture単位のAI提案を保存・更新する（Confirm前後どちらでも呼べる） */
export function saveAiAnalysis(analysis) {
  const state = load();
  return save({ ...state, aiAnalyses: upsertById(state.aiAnalyses, analysis) });
}

/** 実行記録を1件積み上げる（履歴なので上書きせず常に追加） */
export function appendExecution(execution) {
  const state = load();
  return save({ ...state, executions: [...state.executions, execution] });
}

/** Skill候補を保存・更新する */
export function saveSkill(skill) {
  const state = load();
  return save({ ...state, skills: upsertById(state.skills, skill) });
}

/** Automation Candidateを保存・更新する */
export function saveAutomationCandidate(candidate) {
  const state = load();
  return save({ ...state, automationCandidates: upsertById(state.automationCandidates, candidate) });
}

export function load() {
  const store = storage();
  if (!store) {
    const cached = memoryFallbackStore.get(storageKey());
    if (cached) return cached;
    const empty = emptyState();
    memoryFallbackStore.set(storageKey(), empty);
    return empty;
  }
  try {
    const raw = store.getItem(storageKey());
    return normalize(raw ? JSON.parse(raw) : null);
  } catch (error) {
    console.error("[timebox] 保存データを読めませんでした:", error);
    return emptyState();
  }
}

export function save(state) {
  const next = normalize(state);
  const store = storage();
  if (!store) {
    memoryFallbackStore.set(storageKey(), next);
    return next;
  }
  try {
    store.setItem(storageKey(), JSON.stringify(next));
  } catch (error) {
    // 容量超過など。データは失いたくないのでメモリへ退避する
    console.error("[timebox] 保存に失敗しました:", error);
    memoryFallbackStore.set(storageKey(), next);
  }
  return next;
}

/** 部分更新。呼び出し側で毎回 load → 展開 → save を書かずに済ませる */
export function patch(changes) {
  return save({ ...load(), ...changes });
}

export function clearAll() {
  memoryFallbackStore.delete(storageKey());
  const store = storage();
  if (store) store.removeItem(storageKey());
  return emptyState();
}

/** 端末外へ持ち出す用（将来のクラウド移行・バックアップ） */
export function exportJson() {
  return JSON.stringify(load(), null, 2);
}

/**
 * JSONインポートが失敗したことを表すエラー。
 * これを投げた時点では既存の保存データには一切触れていない
 * （呼び出し側は catch した時点で save() を呼ばなければ安全）。
 */
export class ImportError extends Error {}

function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function isValidTask(task) {
  return isPlainObject(task) && typeof task.id === "string" && typeof task.title === "string";
}

function isValidTemplate(template) {
  return isPlainObject(template) && Array.isArray(template.days) && template.days.length === 7;
}

/**
 * バックアップの形を確認する。
 * 将来 version が上がっても、ここだけ緩めれば古いバックアップを読み続けられる。
 */
function isValidBackupShape(raw) {
  if (!isPlainObject(raw)) return false;
  if (!Array.isArray(raw.tasks) || !raw.tasks.every(isValidTask)) return false;
  if (raw.days !== undefined && !isPlainObject(raw.days)) return false;
  if (raw.template !== undefined && !isValidTemplate(raw.template)) return false;
  if (raw.history !== undefined && !Array.isArray(raw.history)) return false;
  if (raw.settings !== undefined && !isPlainObject(raw.settings)) return false;
  if (raw.captures !== undefined && !Array.isArray(raw.captures)) return false;
  if (raw.aiAnalyses !== undefined && !Array.isArray(raw.aiAnalyses)) return false;
  if (raw.executions !== undefined && !Array.isArray(raw.executions)) return false;
  if (raw.skills !== undefined && !Array.isArray(raw.skills)) return false;
  if (raw.automationCandidates !== undefined && !Array.isArray(raw.automationCandidates)) return false;
  return true;
}

/**
 * JSONバックアップを取り込み、正規化した state を返す（保存はしない）。
 * 呼び出し側で内容を確認・確認ダイアログを出したうえで save() する想定。
 *
 * 失敗時は ImportError を投げるだけで、既存の保存データには触れない。
 */
export function importJson(text) {
  let raw;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new ImportError("JSONの形式が正しくありません。ファイルが壊れていないか確認してください。");
  }

  if (!isPlainObject(raw)) {
    throw new ImportError("バックアップの内容が読み取れませんでした。");
  }
  if (typeof raw.version !== "number" || !Number.isFinite(raw.version) || raw.version < 1) {
    throw new ImportError("バックアップのバージョン情報が見つかりません。DAYLOOPから書き出したファイルを選んでください。");
  }
  if (raw.version > STORAGE_VERSION) {
    throw new ImportError("このバックアップは新しいバージョンのDAYLOOPで作られています。アプリを更新してから読み込んでください。");
  }
  if (!isValidBackupShape(raw)) {
    throw new ImportError("バックアップの内容が壊れています。別のファイルを選ぶか、書き出しをやり直してください。");
  }

  return normalize(raw);
}

/**
 * normalize() を外部（storage-providers/）から使うための公開ラッパー。
 * Obsidianなど他のProviderが読み込んだ生データをTask Storeと同じ形へ揃えるのに使う。
 * 中身が壊れていても例外を投げず、emptyState() 相当へフォールバックする。
 */
export function normalizeState(raw) {
  return normalize(raw);
}

/**
 * 履歴の刈り込み。無料プランは直近7日だけ残す。
 * 消えて困る「これから使う日」は残し、過ぎた日だけを対象にする。
 */
export function pruneHistory(state, keepDays, today = todayLocal()) {
  if (!Number.isFinite(keepDays)) return state;
  const limit = new Date(today);
  limit.setDate(limit.getDate() - keepDays);
  const oldest = todayLocal(limit);

  const days = {};
  for (const [date, day] of Object.entries(state.days ?? {})) {
    if (date >= oldest || date >= today) days[date] = day;
  }
  return {
    ...state,
    days,
    history: (state.history ?? []).filter((h) => h.date >= oldest),
  };
}
