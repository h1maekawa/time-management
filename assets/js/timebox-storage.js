/**
 * Timebox OS — 保存層。
 *
 * 初期版は端末のlocalStorageだけで完結する（サーバーへ何も送らない）。
 * 将来クラウド保存へ移すときに困らないよう、
 *  - 保存の形はひとつのstateオブジェクトに寄せる
 *  - 読み書きの入口を load/save/patch の3つに絞る
 *  - version を持たせてマイグレーションできるようにする
 * の3点を守る。
 */

import { defaultWeeklyTemplate, todayLocal } from "./timebox-engine.js";

const KEY = "timebox-os/v1";
export const STORAGE_VERSION = 1;

/** localStorageが使えない環境（プライベートモード等）ではメモリ上で動かす */
let memoryFallback = null;

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
    settings: {
      plan: "free",
      lastOpenedDate: todayLocal(),
    },
  };
}

/** 欠けた項目を初期値で埋める。古い保存データを壊さずに読むため */
function normalize(raw) {
  const base = emptyState();
  if (!raw || typeof raw !== "object") return base;
  return {
    ...base,
    ...raw,
    version: STORAGE_VERSION,
    tasks: Array.isArray(raw.tasks) ? raw.tasks : base.tasks,
    days: raw.days && typeof raw.days === "object" ? raw.days : base.days,
    template: raw.template?.days?.length === 7 ? raw.template : base.template,
    history: Array.isArray(raw.history) ? raw.history : base.history,
    settings: { ...base.settings, ...(raw.settings ?? {}) },
  };
}

export function load() {
  if (memoryFallback) return memoryFallback;
  const store = storage();
  if (!store) {
    memoryFallback = emptyState();
    return memoryFallback;
  }
  try {
    const raw = store.getItem(KEY);
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
    memoryFallback = next;
    return next;
  }
  try {
    store.setItem(KEY, JSON.stringify(next));
  } catch (error) {
    // 容量超過など。データは失いたくないのでメモリへ退避する
    console.error("[timebox] 保存に失敗しました:", error);
    memoryFallback = next;
  }
  return next;
}

/** 部分更新。呼び出し側で毎回 load → 展開 → save を書かずに済ませる */
export function patch(changes) {
  return save({ ...load(), ...changes });
}

export function clearAll() {
  memoryFallback = null;
  const store = storage();
  if (store) store.removeItem(KEY);
  return emptyState();
}

/** 端末外へ持ち出す用（将来のクラウド移行・バックアップ） */
export function exportJson() {
  return JSON.stringify(load(), null, 2);
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
