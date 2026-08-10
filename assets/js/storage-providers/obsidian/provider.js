/**
 * ObsidianProvider — StorageProvider インターフェースの実装。
 *
 * 保存方式は2段階:
 *   第一優先: File System Access API でVault（またはそのサブフォルダ）へ直接書き込む
 *   Fallback: 未対応ブラウザでは obsidian://new URI を組み立てて呼び出し側に渡す
 *             （buildFallbackNewNoteUri。実際にリンクを開くのはUI側の責務）
 *
 * ローカル（localStorage）が常にTask Storeの実行時ソースであり続けるため
 * （Timebox Engineは常にlocalStorageを読む）、ここは「保存先を増やす」役割に徹する。
 * saveState() はJSONスナップショット（settings/timebox-state.json）と、
 * その日のDaily Noteの再生成をまとめて行う。
 */
import * as fsAccess from "./fs-access.js";
import * as idb from "./idb-handle-store.js";
import * as md from "./markdown.js";
import { buildNewNoteUri } from "./obsidian-uri.js";
import { normalizeState } from "../../timebox-storage.js";

let cachedRoot = null;

async function getRootHandle() {
  if (cachedRoot) return cachedRoot;
  try {
    cachedRoot = await idb.loadDirectoryHandle();
  } catch {
    cachedRoot = null;
  }
  return cachedRoot;
}

function pathsOf(config) {
  return { ...md.DEFAULT_OBSIDIAN_PATHS, ...(config?.paths ?? {}) };
}

export function createObsidianProvider() {
  return {
    id: "obsidian",
    label: "Obsidian",

    isConfigured(config) {
      return Boolean(config?.connected);
    },

    /** フォルダ選択ダイアログを開き、権限確認まで済ませたconfigを返す（保存はしない） */
    async configure(config = {}) {
      if (!fsAccess.isFileSystemAccessSupported()) {
        return {
          ...config,
          connected: false,
          mode: "uri-fallback",
          paths: pathsOf(config),
          dailyNoteMode: config.dailyNoteMode ?? "file",
        };
      }

      const handle = await fsAccess.pickVaultDirectory();
      const granted = await fsAccess.ensurePermission(handle);
      if (!granted) throw new Error("フォルダへのアクセス許可が得られませんでした。");

      cachedRoot = handle;
      await idb.saveDirectoryHandle(handle);

      return {
        ...config,
        connected: true,
        mode: "fs-access",
        vaultDirectoryName: handle.name,
        paths: pathsOf(config),
        dailyNoteMode: config.dailyNoteMode ?? "file",
      };
    },

    async healthCheck(config) {
      if (!this.isConfigured(config)) return { ok: false, message: "未接続です。" };
      if (config?.mode === "uri-fallback") {
        return { ok: true, message: "URIフォールバックで利用中です（直接保存は未対応ブラウザ）。" };
      }
      const root = await getRootHandle();
      if (!root) {
        return { ok: false, message: "フォルダの参照を復元できませんでした。もう一度選び直してください。" };
      }
      const granted = await fsAccess.ensurePermission(root);
      return granted
        ? { ok: true, message: "接続済み" }
        : { ok: false, message: "フォルダへのアクセス許可が失効しました。再度許可してください。" };
    },

    /** Vault内の timebox-state.json を読み戻す（無ければ null）。主にLocal→Obsidian移行の確認用 */
    async loadState(config) {
      const root = await getRootHandle();
      if (!root) return null;
      try {
        const settingsDir = await fsAccess.getOrCreateSubdirectory(root, pathsOf(config).settings);
        const text = await fsAccess.readFile(settingsDir, "timebox-state.json");
        if (!text) return null;
        return normalizeState(JSON.parse(text));
      } catch {
        return null;
      }
    },

    /** JSONスナップショット + 当日のDaily Noteをまとめて書き出す */
    async saveState(state, config) {
      const root = await getRootHandle();
      if (!root) return { ok: false, error: "vault_not_connected" };
      const p = pathsOf(config);

      try {
        const settingsDir = await fsAccess.getOrCreateSubdirectory(root, p.settings);
        await fsAccess.writeFile(settingsDir, "timebox-state.json", JSON.stringify(state, null, 2));

        const today = state.settings?.lastOpenedDate;
        if (today) {
          const dailyDir = await fsAccess.getOrCreateSubdirectory(root, p.daily);
          const dayPlan = state.days?.[today];
          const todayTasks = (state.tasks ?? []).filter(
            (t) => t.triage === "today" && t.plannedDate === today
          );
          const markdown = md.buildDailyMarkdown({
            date: today,
            blocks: dayPlan?.blocks ?? [],
            tasks: todayTasks,
            executions: state.executions ?? [],
          });
          await fsAccess.writeFile(dailyDir, md.dailyFilename(today), markdown, { mode: "overwrite" });
        }
        return { ok: true };
      } catch (error) {
        return { ok: false, error: error?.message ?? "unknown_error" };
      }
    },

    /**
     * 実行記録単体のファイルは増やさず、Daily Note側にまとめて反映する設計。
     * 呼び出し側（timebox.js）は appendExecution の後に saveState を呼べば最新化される。
     */
    async appendExecution() {
      return { ok: true, deferred: true };
    },

    /** Brain Dump（Capture）+ AI提案を1つのnoteとして保存する */
    async saveCapture(capture, config, analysis = null) {
      const root = await getRootHandle();
      if (!root) return { ok: false, error: "vault_not_connected" };
      const p = pathsOf(config);
      try {
        const dir = await fsAccess.getOrCreateSubdirectory(root, p.captures);
        const filename = md.captureFilename(capture);
        const today = capture.createdAt?.slice(0, 10);
        const markdown = md.buildCaptureMarkdown({
          capture,
          analysis,
          dailyLinkPath: today ? `${p.daily}/${today}` : null,
        });
        await fsAccess.writeFile(dir, filename, markdown, { mode: "overwrite" });
        return { ok: true, path: `${p.captures}/${filename}` };
      } catch (error) {
        return { ok: false, error: error?.message ?? "unknown_error" };
      }
    },

    /** Captureファイルの中にAI Summary / Suggested Tasksとして書き戻す（別ファイルは作らない） */
    async saveAiAnalysis(analysis, config, capture = null) {
      if (!capture) return { ok: false, error: "capture_required" };
      return this.saveCapture(capture, config, analysis);
    },

    async saveSkill(skill, config) {
      const root = await getRootHandle();
      if (!root) return { ok: false, error: "vault_not_connected" };
      try {
        const dir = await fsAccess.getOrCreateSubdirectory(root, pathsOf(config).skills);
        await fsAccess.writeFile(dir, md.skillFilename(skill), md.buildSkillMarkdown(skill), {
          mode: "overwrite",
        });
        return { ok: true };
      } catch (error) {
        return { ok: false, error: error?.message ?? "unknown_error" };
      }
    },

    async saveAutomationCandidate(candidate, config) {
      const root = await getRootHandle();
      if (!root) return { ok: false, error: "vault_not_connected" };
      try {
        const dir = await fsAccess.getOrCreateSubdirectory(root, pathsOf(config).automation);
        await fsAccess.writeFile(dir, md.automationFilename(candidate), md.buildAutomationMarkdown(candidate), {
          mode: "overwrite",
        });
        return { ok: true };
      } catch (error) {
        return { ok: false, error: error?.message ?? "unknown_error" };
      }
    },

    async disconnect() {
      cachedRoot = null;
      try {
        await idb.clearDirectoryHandle();
      } catch {
        // IndexedDBが使えない環境では何もできることがないので黙って終える
      }
    },

    /** File System Access APIが使えないブラウザ向けの obsidian://new リンクを組み立てる */
    buildFallbackNewNoteUri(config, capture) {
      const p = pathsOf(config);
      return buildNewNoteUri({
        vaultName: config?.vaultName,
        path: `${p.captures}/${md.captureFilename(capture)}`,
        content: capture.text,
      });
    },
  };
}
