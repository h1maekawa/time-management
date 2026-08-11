import test from "node:test";
import assert from "node:assert/strict";

import * as storage from "../assets/js/timebox-storage.js";
import { createTask, createCapture, createAiAnalysis, createExecution, createSkill, createAutomationCandidate } from "../assets/js/timebox-engine.js";

import { getProvider, listProviders, PROVIDER_IDS, isKnownProviderId } from "../assets/js/storage-providers/registry.js";
import { validateGasConfig } from "../assets/js/storage-providers/google-sheets-gas-provider.js";
import { createObsidianProvider } from "../assets/js/storage-providers/obsidian/provider.js";
import { NotImplementedError as DriveNotImplementedError } from "../assets/js/storage-providers/google-drive-provider.js";
import {
  createCloudProvider,
  setActiveUser as setCloudActiveUser,
  CloudNotConfiguredError,
  LoginRequiredError,
} from "../assets/js/storage-providers/cloud-provider.js";
import {
  sanitizeObsidianFilename,
  captureFilename,
  dailyFilename,
  buildCaptureMarkdown,
  buildDailyMarkdown,
  buildSkillMarkdown,
  buildAutomationMarkdown,
  DEFAULT_OBSIDIAN_PATHS,
} from "../assets/js/storage-providers/obsidian/markdown.js";

// ─── registry ──────────────────────────────────────────────

test("registry: PROVIDER_IDS は仕様どおりの5つを含む", () => {
  assert.deepEqual(PROVIDER_IDS, ["local", "obsidian", "google-sheets-gas", "google-drive", "cloud"]);
});

test("registry: 未知のIDでも必ず local Providerへフォールバックする", () => {
  const provider = getProvider("not-a-real-provider");
  assert.equal(provider.id, "local");
});

test("registry: listProviders() は5件返す、isKnownProviderId() は既知/未知を判定する", () => {
  assert.equal(listProviders().length, 5);
  assert.equal(isKnownProviderId("obsidian"), true);
  assert.equal(isKnownProviderId("dropbox"), false);
});

// ─── local provider ────────────────────────────────────────

test("local provider: isConfigured は常にtrue、saveCapture等はstorage.jsへ委譲する", async () => {
  storage.clearAll();
  const provider = getProvider("local");
  assert.equal(provider.isConfigured(), true);

  await provider.saveCapture(createCapture({ text: "テスト" }));
  await provider.saveAiAnalysis(createAiAnalysis({ suggestions: { tasks: [] } }));
  await provider.appendExecution(createExecution({ taskId: "t1" }));
  await provider.saveSkill(createSkill({ name: "スキル" }));
  await provider.saveAutomationCandidate(createAutomationCandidate({ title: "候補" }));

  const state = storage.load();
  assert.equal(state.captures.length, 1);
  assert.equal(state.aiAnalyses.length, 1);
  assert.equal(state.executions.length, 1);
  assert.equal(state.skills.length, 1);
  assert.equal(state.automationCandidates.length, 1);
});

test("local provider: healthCheck はNode環境でも例外を投げず結果を返す", async () => {
  const provider = getProvider("local");
  const result = await provider.healthCheck();
  assert.equal(typeof result.ok, "boolean");
});

// ─── Google Sheets (GAS) provider ──────────────────────────

test("validateGasConfig: webAppUrl / spreadsheetId が無ければ無効", () => {
  const result = validateGasConfig({});
  assert.equal(result.valid, false);
  assert.ok(result.errors.length >= 2);
});

test("validateGasConfig: 形式が正しくないwebAppUrlは無効", () => {
  const result = validateGasConfig({ webAppUrl: "https://example.com/not-gas", spreadsheetId: "abc" });
  assert.equal(result.valid, false);
});

test("validateGasConfig: 正しい形式のconfigは有効", () => {
  const result = validateGasConfig({
    webAppUrl: "https://script.google.com/macros/s/AKfycxxxx/exec",
    spreadsheetId: "1AbCdEf",
  });
  assert.equal(result.valid, true);
  assert.deepEqual(result.errors, []);
});

test("google-sheets-gas provider: isConfigured は validateGasConfig と一致する", () => {
  const provider = getProvider("google-sheets-gas");
  assert.equal(provider.isConfigured({}), false);
  assert.equal(
    provider.isConfigured({
      webAppUrl: "https://script.google.com/macros/s/AKfycxxxx/exec",
      spreadsheetId: "1AbCdEf",
    }),
    true
  );
});

// ─── Google Drive / Cloud provider skeletons ───────────────

test("google-drive provider: isConfigured は常にfalse、configure()はNotImplementedErrorを投げる", async () => {
  const drive = getProvider("google-drive");
  assert.equal(drive.isConfigured(), false);
  await assert.rejects(() => drive.configure(), DriveNotImplementedError);
  const driveHealth = await drive.healthCheck();
  assert.equal(driveHealth.ok, false);
});

// ─── DAYLOOP Cloud provider（Supabase実装。Node環境にはVITE_env変数が無いため、
//     「Cloud機能は未設定です」経路と、ログイン状態管理のロジックだけをNetwork無しで検証する）

test("cloud provider: Supabase未設定のNode環境ではisConfigured=false、configure()はCloudNotConfiguredErrorを投げる", async () => {
  const cloud = getProvider("cloud");
  setCloudActiveUser(null);
  assert.equal(cloud.id, "cloud");
  assert.equal(cloud.label, "DAYLOOP Cloud");
  assert.equal(cloud.isConfigured(), false);
  await assert.rejects(() => cloud.configure(), CloudNotConfiguredError);
});

test("cloud provider: 未設定時はloadState=null、saveState/appendExecution等はerror:not_configuredを返し例外を投げない", async () => {
  const cloud = getProvider("cloud");
  setCloudActiveUser(null);

  assert.equal(await cloud.loadState({}), null);
  assert.deepEqual(await cloud.saveState({ tasks: [] }, {}), { ok: false, error: "not_configured" });
  assert.deepEqual(await cloud.appendExecution(createExecution({ taskId: "t1" }), {}), {
    ok: false,
    error: "login_required",
  });

  const health = await cloud.healthCheck();
  assert.equal(health.ok, false);
  assert.match(health.message, /未設定/);
});

test("cloud provider: setActiveUser/getActiveUser でログイン状態を保持する（auth-serviceのonAuthStateChangeから呼ばれる想定）", async () => {
  const { setActiveUser, getActiveUser } = await import("../assets/js/storage-providers/cloud-provider.js");
  setActiveUser("user-123");
  assert.equal(getActiveUser(), "user-123");
  setActiveUser(null);
  assert.equal(getActiveUser(), null);
});

test("cloud provider: LoginRequiredError / CloudNotConfiguredError はErrorのサブクラス", () => {
  assert.ok(new LoginRequiredError("x") instanceof Error);
  assert.ok(new CloudNotConfiguredError("x") instanceof Error);
});

test("createCloudProvider(): registryのシングルトンと同じ形のProviderを独立して作れる", () => {
  const cloud = createCloudProvider();
  assert.equal(cloud.id, "cloud");
  assert.equal(typeof cloud.saveState, "function");
  assert.equal(typeof cloud.loadState, "function");
});

// ─── Obsidian markdown（純粋ロジック） ─────────────────────

test("sanitizeObsidianFilename: パス区切り文字・記号を安全な文字へ置き換える", () => {
  assert.equal(sanitizeObsidianFilename("FS/商談準備:確認?"), "FS-商談準備-確認-");
  assert.equal(sanitizeObsidianFilename("  "), "untitled");
  assert.equal(sanitizeObsidianFilename(""), "untitled");
  assert.equal(sanitizeObsidianFilename(undefined), "untitled");
});

test("sanitizeObsidianFilename: 長すぎる名前は120文字に切り詰める", () => {
  const long = "あ".repeat(200);
  assert.equal(sanitizeObsidianFilename(long).length, 120);
});

test("captureFilename / dailyFilename はspec通りの命名パターンになる", () => {
  const filename = captureFilename({ createdAt: "2026-08-10T15:30:00+09:00" });
  assert.match(filename, /^2026-08-10-\d{4}-brain-dump\.md$/);
  assert.equal(dailyFilename("2026-08-10"), "2026-08-10.md");
});

test("buildCaptureMarkdown はfrontmatter・原文・AI提案・Linksを含む", () => {
  const capture = createCapture({
    text: "FS週次資料作らないと\n明日の商談準備",
    createdAt: "2026-08-10T15:30:00+09:00",
    status: "analyzed",
  });
  const analysis = createAiAnalysis({
    suggestions: {
      summary: "週次資料と商談準備が優先度高め",
      tasks: [{ title: "明日の商談準備" }, { title: "FS週次資料" }],
    },
  });

  const markdown = buildCaptureMarkdown({
    capture,
    analysis,
    dailyLinkPath: `${DEFAULT_OBSIDIAN_PATHS.daily}/2026-08-10`,
  });

  assert.match(markdown, /^---\ntype: capture/);
  assert.match(markdown, /source: ai-brain-dump/);
  assert.match(markdown, /FS週次資料作らないと/);
  assert.match(markdown, /## AI Summary/);
  assert.match(markdown, /- \[ \] 明日の商談準備/);
  assert.match(markdown, /## Links/);
  assert.match(markdown, /\[\[Timebox\/Daily\/2026-08-10\]\]/);
});

test("buildDailyMarkdown はPlan/Tasks/Executionを含み、空でも壊れない", () => {
  const empty = buildDailyMarkdown({ date: "2026-08-10" });
  assert.match(empty, /type: daily-plan/);
  assert.match(empty, /## Plan/);
  assert.match(empty, /## Tasks/);
  assert.match(empty, /## Execution/);

  const filled = buildDailyMarkdown({
    date: "2026-08-10",
    blocks: [{ start: "09:00", end: "09:30", title: "KPI確認" }],
    tasks: [{ title: "KPI確認", done: true }, { title: "商談準備", done: false }],
    executions: [{ date: "2026-08-10", taskTitle: "KPI確認", actualMinutes: 31 }],
  });
  assert.match(filled, /- 09:00-09:30 KPI確認/);
  assert.match(filled, /- \[x\] KPI確認/);
  assert.match(filled, /- \[ \] 商談準備/);
  assert.match(filled, /KPI確認: 31分/);
});

test("buildSkillMarkdown / buildAutomationMarkdown はfrontmatterと本文を含む", () => {
  const skill = createSkill({ name: "FS商談準備", steps: ["GBP確認", "HP確認"], confidence: 0.82, description: "過去14回、似た手順で実施" });
  const skillMd = buildSkillMarkdown(skill);
  assert.match(skillMd, /type: skill/);
  assert.match(skillMd, /# FS商談準備/);
  assert.match(skillMd, /1\. GBP確認/);
  assert.match(skillMd, /過去14回/);

  const candidate = createAutomationCandidate({ type: "estimate-adjustment", title: "見積もり調整", reason: "毎回超過", evidence: "5回連続" });
  const candidateMd = buildAutomationMarkdown(candidate);
  assert.match(candidateMd, /type: automation-candidate/);
  assert.match(candidateMd, /candidateType: estimate-adjustment/);
  assert.match(candidateMd, /# 見積もり調整/);
  assert.match(candidateMd, /毎回超過/);
});

// ─── Obsidian provider: config validation / 未接続時の安全な失敗 ──────────
//
// File System Access API・IndexedDBはNode環境に存在しないため、
// 「フォルダ未接続」経路（=vault_not_connected）が安全に返ることをここで確認する。
// 実際のフォルダ選択・書き込みはブラウザでのSmoke Testで確認する。

test("obsidian provider: isConfigured() は connected フラグの有無で判定する", () => {
  const provider = createObsidianProvider();
  assert.equal(provider.isConfigured({}), false);
  assert.equal(provider.isConfigured({ connected: false }), false);
  assert.equal(provider.isConfigured({ connected: true }), true);
});

test("obsidian provider: 未接続時の healthCheck は ok:false と案内メッセージを返す", async () => {
  const provider = createObsidianProvider();
  const result = await provider.healthCheck({});
  assert.equal(result.ok, false);
  assert.match(result.message, /未接続/);
});

test("obsidian provider: 未接続（フォルダ未選択）時の保存系メソッドは例外を投げず vault_not_connected を返す", async () => {
  const provider = createObsidianProvider();
  await provider.disconnect(); // 前のテストで作られたキャッシュをNode環境でも安全にクリアできることを確認

  const saveStateResult = await provider.saveState({ tasks: [] }, {});
  assert.equal(saveStateResult.ok, false);
  assert.equal(saveStateResult.error, "vault_not_connected");

  const saveCaptureResult = await provider.saveCapture(createCapture({ text: "x" }), {});
  assert.equal(saveCaptureResult.ok, false);

  const saveSkillResult = await provider.saveSkill(createSkill({ name: "x" }), {});
  assert.equal(saveSkillResult.ok, false);

  const loaded = await provider.loadState({});
  assert.equal(loaded, null);
});

test("obsidian provider: saveAiAnalysis は capture が無いと安全に失敗する（別ファイルを作らない設計）", async () => {
  const provider = createObsidianProvider();
  const result = await provider.saveAiAnalysis(createAiAnalysis({}), {}, null);
  assert.equal(result.ok, false);
  assert.equal(result.error, "capture_required");
});

test("failed migration safety: Provider保存が失敗しても、local(storage.js)側のデータは一切変更されない", async () => {
  storage.clearAll();
  const task = createTask({ title: "ローカルに残るタスク" });
  storage.save({ ...storage.load(), tasks: [task] });
  const before = storage.load();

  const obsidian = createObsidianProvider();
  const result = await obsidian.saveState(before, {}); // vault未接続なので失敗する
  assert.equal(result.ok, false);

  // Provider側の失敗はlocalの状態に一切影響しない
  assert.deepEqual(storage.load(), before);
});
