/**
 * DAYLOOP Cloud Provider — Supabase PostgreSQL / Supabase Auth 実装。
 *
 * 「Timebox Cloud（近日対応）」だったStubを置き換える（Provider ID互換性は維持: id="cloud"）。
 *
 * 設計方針（§7/§22-25）:
 *  - Coreなエンティティ(tasks/captures/aiAnalyses/executions/skills/automationCandidates)は
 *    Relational Tableへ1行=1エンティティで保存する。全State巨大JSONを1行で毎回上書きしない。
 *  - 可変で構造化されていない部分(day windows/timeline blocks/AI提案の中身/設定)はjsonbで持つ。
 *  - 認証はSupabase Auth（Email OTP）。ログイン状態はモジュール外（auth-service.js）が管理し、
 *    ログイン成功/ログアウト時に `setActiveUser(userId)` を呼んでもらう。
 *  - Query時はRLSだけに頼らず、必ず `.eq("user_id", userId)` を明示する（§9/§40）。
 *
 * テスト容易性（§53）: `createCloudProvider({ getClient, isConfigured })` は実Supabase Clientを
 * 直接importせず注入できる。テストではfakeなquery builder（.from().select()...）を渡すことで、
 * Networkに触れずにpush/pull/conflictのロジックを検証できる。
 */
import { getSupabaseClient, isSupabaseConfigured } from "../supabase/client.js";
import { normalizeState } from "../timebox-storage.js";
import {
  taskToRow,
  rowToTask,
  captureToRow,
  rowToCapture,
  aiAnalysisToRow,
  rowToAiAnalysis,
  executionToRow,
  rowToExecution,
  skillToRow,
  rowToSkill,
  automationCandidateToRow,
  rowToAutomationCandidate,
} from "../supabase/entity-mapping.js";
import { planPush, nextKnownVersionsAfterPush } from "../supabase/sync-planner.js";
import { getKindVersions, setKindVersions } from "../supabase/known-versions.js";

export class LoginRequiredError extends Error {}
export class CloudNotConfiguredError extends Error {}

/** ログイン中のUser ID。auth-service.js の onAuthStateChange から更新される（モジュール全体で共有）。 */
let activeUserId = null;

export function setActiveUser(userId) {
  activeUserId = userId || null;
}

export function getActiveUser() {
  return activeUserId;
}

const COLLECTIONS = [
  { key: "tasks", table: "tasks", toRow: taskToRow, fromRow: rowToTask },
  { key: "captures", table: "captures", toRow: captureToRow, fromRow: rowToCapture },
  { key: "aiAnalyses", table: "ai_analyses", toRow: aiAnalysisToRow, fromRow: rowToAiAnalysis },
  { key: "executions", table: "executions", toRow: executionToRow, fromRow: rowToExecution },
  { key: "skills", table: "skills", toRow: skillToRow, fromRow: rowToSkill },
  {
    key: "automationCandidates",
    table: "automation_candidates",
    toRow: automationCandidateToRow,
    fromRow: rowToAutomationCandidate,
  },
];

/** 1つのCollection(tasks等)をCloudへPushする。楽観的並行制御でConflictを検出する。 */
async function pushCollection({ client, userId, namespace, table, kind, localList, toRow }) {
  const knownVersions = getKindVersions(namespace, kind);
  if (localList.length === 0) return { conflicts: [] };

  const ids = localList.map((item) => item.id);
  const { data: cloudRows, error: selectError } = await client
    .from(table)
    .select("id, version")
    .eq("user_id", userId)
    .in("id", ids);
  if (selectError) throw selectError;

  const plan = planPush({
    localItems: localList.map(toRow),
    cloudRows: cloudRows ?? [],
    knownVersions,
  });

  const insertedIds = [];
  const updatedIds = [];
  const conflicts = [...plan.conflicts];

  if (plan.inserts.length > 0) {
    const rows = plan.inserts.map((item) => ({ ...item, user_id: userId }));
    const { error } = await client.from(table).upsert(rows, { onConflict: "user_id,id" });
    if (error) throw error;
    insertedIds.push(...plan.inserts.map((item) => item.id));
  }

  for (const { id, expectedVersion, item } of plan.updates) {
    const { data, error } = await client
      .from(table)
      .update(item)
      .eq("user_id", userId)
      .eq("id", id)
      .eq("version", expectedVersion)
      .select("id");
    if (error) throw error;
    if (data && data.length > 0) updatedIds.push(id);
    else conflicts.push(id);
  }

  const nextKnownVersions = nextKnownVersionsAfterPush({ knownVersions, insertedIds, updatedIds });
  setKindVersions(namespace, kind, nextKnownVersions);
  return { conflicts };
}

async function pushDayPlans({ client, userId, days }) {
  const entries = Object.values(days ?? {});
  if (entries.length === 0) return;
  const rows = entries.map((d) => ({
    user_id: userId,
    date: d.date,
    windows: d.windows ?? [],
    blocks: d.blocks ?? [],
  }));
  // day_plansは端末のタイムライン編集を素直に反映するため、日付単位のupsert(last-write-wins)とする。
  // Task本体のような版管理はしない（§28の対象は主にtasksのようなidを持つエンティティ）。
  const { error } = await client.from("day_plans").upsert(rows, { onConflict: "user_id,date" });
  if (error) throw error;
}

async function pushUserPreferences({ client, userId, settings }) {
  // Provider固有Secret / Device固有パス(Obsidian Handle等)はCloudへ保存しない（§31/§32）。
  const { error } = await client.from("user_preferences").upsert(
    {
      user_id: userId,
      active_storage_provider: settings?.storageProviderId ?? "local",
      default_category: null,
      settings: { plan: settings?.plan ?? "free" },
    },
    { onConflict: "user_id" }
  );
  if (error) throw error;
}

async function fetchCollection({ client, userId, table, fromRow }) {
  const { data, error } = await client
    .from(table)
    .select("*")
    .eq("user_id", userId)
    .is("deleted_at", null);
  if (error) throw error;
  return (data ?? []).map(fromRow);
}

async function fetchDayPlans({ client, userId }) {
  const { data, error } = await client.from("day_plans").select("*").eq("user_id", userId);
  if (error) throw error;
  const days = {};
  for (const row of data ?? []) {
    days[row.date] = {
      date: row.date,
      windows: row.windows ?? [],
      blocks: row.blocks ?? [],
      updatedAt: row.updated_at,
    };
  }
  return days;
}

export function createCloudProvider({ getClient = getSupabaseClient, isConfigured = isSupabaseConfigured } = {}) {
  async function requireClient() {
    if (!isConfigured()) throw new CloudNotConfiguredError("Cloud機能は未設定です。");
    const client = await getClient();
    if (!client) throw new CloudNotConfiguredError("Cloud機能は未設定です。");
    return client;
  }

  function requireUser() {
    if (!activeUserId) throw new LoginRequiredError("ログインしてください。");
    return activeUserId;
  }

  return {
    id: "cloud",
    label: "DAYLOOP Cloud",

    isConfigured() {
      return isConfigured() && Boolean(activeUserId);
    },

    async configure() {
      if (!isConfigured()) throw new CloudNotConfiguredError("Cloud機能は未設定です。");
      if (!activeUserId) throw new LoginRequiredError("ログインすると、DAYLOOP Cloudが使えます。");
      return { connectedUserId: activeUserId };
    },

    async loadState(config, { namespace } = {}) {
      if (!isConfigured() || !activeUserId) return null;
      const client = await requireClient();
      const userId = requireUser();

      const partial = {};
      for (const { key, table, fromRow } of COLLECTIONS) {
        partial[key] = await fetchCollection({ client, userId, table, fromRow });
      }
      partial.days = await fetchDayPlans({ client, userId });

      const { data: prefRow } = await client
        .from("user_preferences")
        .select("*")
        .eq("user_id", userId)
        .maybeSingle();
      partial.settings = {
        storageProviderId: prefRow?.active_storage_provider ?? "cloud",
        plan: prefRow?.settings?.plan ?? "free",
      };

      void namespace; // 呼び出し側(timebox.js)がnamespace切り替え自体を担当する
      return normalizeState(partial);
    },

    async saveState(state, config, { namespace } = {}) {
      if (!isConfigured()) return { ok: false, error: "not_configured" };
      if (!activeUserId) return { ok: false, error: "login_required" };
      try {
        const client = await requireClient();
        const userId = requireUser();
        const conflicts = [];

        for (const { key, table, toRow } of COLLECTIONS) {
          const result = await pushCollection({
            client,
            userId,
            namespace,
            table,
            kind: table,
            localList: state[key] ?? [],
            toRow,
          });
          conflicts.push(...result.conflicts.map((id) => ({ kind: key, id })));
        }

        await pushDayPlans({ client, userId, days: state.days });
        await pushUserPreferences({ client, userId, settings: state.settings });

        if (conflicts.length > 0) return { ok: true, conflicts };
        return { ok: true };
      } catch (error) {
        return { ok: false, error: error?.message || "sync_failed" };
      }
    },

    async appendExecution(execution) {
      if (!isConfigured() || !activeUserId) return { ok: false, error: "login_required" };
      try {
        const client = await requireClient();
        const userId = requireUser();
        const { error } = await client
          .from("executions")
          .upsert({ ...executionToRow(execution), user_id: userId }, { onConflict: "user_id,id" });
        if (error) throw error;
        return { ok: true };
      } catch (error) {
        return { ok: false, error: error?.message || "sync_failed" };
      }
    },

    async saveCapture(capture, config, analysis) {
      if (!isConfigured() || !activeUserId) return { ok: false, error: "login_required" };
      try {
        const client = await requireClient();
        const userId = requireUser();
        const { error } = await client
          .from("captures")
          .upsert({ ...captureToRow(capture), user_id: userId }, { onConflict: "user_id,id" });
        if (error) throw error;
        if (analysis) {
          const { error: analysisError } = await client
            .from("ai_analyses")
            .upsert({ ...aiAnalysisToRow(analysis), user_id: userId }, { onConflict: "user_id,id" });
          if (analysisError) throw analysisError;
        }
        return { ok: true };
      } catch (error) {
        return { ok: false, error: error?.message || "sync_failed" };
      }
    },

    async saveAiAnalysis(analysis) {
      if (!isConfigured() || !activeUserId) return { ok: false, error: "login_required" };
      try {
        const client = await requireClient();
        const userId = requireUser();
        const { error } = await client
          .from("ai_analyses")
          .upsert({ ...aiAnalysisToRow(analysis), user_id: userId }, { onConflict: "user_id,id" });
        if (error) throw error;
        return { ok: true };
      } catch (error) {
        return { ok: false, error: error?.message || "sync_failed" };
      }
    },

    async saveSkill(skill) {
      if (!isConfigured() || !activeUserId) return { ok: false, error: "login_required" };
      try {
        const client = await requireClient();
        const userId = requireUser();
        const { error } = await client
          .from("skills")
          .upsert({ ...skillToRow(skill), user_id: userId }, { onConflict: "user_id,id" });
        if (error) throw error;
        return { ok: true };
      } catch (error) {
        return { ok: false, error: error?.message || "sync_failed" };
      }
    },

    async saveAutomationCandidate(candidate) {
      if (!isConfigured() || !activeUserId) return { ok: false, error: "login_required" };
      try {
        const client = await requireClient();
        const userId = requireUser();
        const { error } = await client
          .from("automation_candidates")
          .upsert({ ...automationCandidateToRow(candidate), user_id: userId }, { onConflict: "user_id,id" });
        if (error) throw error;
        return { ok: true };
      } catch (error) {
        return { ok: false, error: error?.message || "sync_failed" };
      }
    },

    async healthCheck() {
      if (!isConfigured()) return { ok: false, message: "Cloud機能は未設定です。" };
      if (!activeUserId) return { ok: false, message: "ログインするとDAYLOOP Cloudが使えます。" };
      try {
        const client = await requireClient();
        const { error } = await client.from("profiles").select("id").eq("id", activeUserId).maybeSingle();
        if (error) return { ok: false, message: "Cloudへ接続できませんでした。" };
        return { ok: true, message: "接続済みです。" };
      } catch {
        return { ok: false, message: "Cloudへ接続できませんでした。" };
      }
    },

    async disconnect() {
      // Cloud自体からの「切断」はログアウトと同義のため、ここでは何もしない
      // （ログアウトは auth-service.js の signOut() が担当する）。
    },
  };
}
