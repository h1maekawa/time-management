/**
 * Timebox Cloud Provider — skeleton（Coming Soon）。
 *
 * Phase 2以降、Cloudflare Pages Functions + D1 で実装する想定
 * （docs/PRODUCT_ROADMAP.md 参照）。今回はStorage Provider Architectureへ
 * 差し替え可能な形の枠だけを用意し、UI上は「近日対応」と表示する。
 */

export class NotImplementedError extends Error {}

export function createCloudProvider() {
  return {
    id: "cloud",
    label: "Timebox Cloud（近日対応）",

    isConfigured() {
      return false;
    },

    async configure() {
      throw new NotImplementedError("Timebox Cloudは近日対応予定です。");
    },

    async loadState() {
      return null;
    },

    async saveState() {
      return { ok: false, error: "not_implemented" };
    },

    async appendExecution() {
      return { ok: false, error: "not_implemented" };
    },

    async saveCapture() {
      return { ok: false, error: "not_implemented" };
    },

    async saveAiAnalysis() {
      return { ok: false, error: "not_implemented" };
    },

    async saveSkill() {
      return { ok: false, error: "not_implemented" };
    },

    async saveAutomationCandidate() {
      return { ok: false, error: "not_implemented" };
    },

    async healthCheck() {
      return { ok: false, message: "近日対応予定です。" };
    },

    async disconnect() {},
  };
}
