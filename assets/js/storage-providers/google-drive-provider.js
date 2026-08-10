/**
 * Google Drive Provider — skeleton.
 *
 * 今回はUIとProvider Interfaceの枠のみ用意する（完全実装は対象外）。
 * 想定する保存先: appDataFolder（アプリ専用の隠しフォルダ）または利用者が選ぶフォルダ。
 * Secret（OAuth Client Secretなど）はFrontendへは一切置かない
 * （実装時はCloudflare Pages Functions経由でトークン交換する設計にする）。
 */

export class NotImplementedError extends Error {}

export function createGoogleDriveProvider() {
  return {
    id: "google-drive",
    label: "Google Drive",

    isConfigured() {
      return false;
    },

    async configure() {
      throw new NotImplementedError("Google Drive連携は準備中です。");
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
      return { ok: false, message: "準備中です。" };
    },

    async disconnect() {},
  };
}
