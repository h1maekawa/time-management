/**
 * Google Sheets (GAS) Provider.
 *
 * 補助的な保存先としてのみ扱う（主Backendにはしない）。
 * Google Apps Script の Web App を「Google Sheetsへの読み書きConnector」として叩くだけで、
 * Cloudflare / AI / 認証の中心Backendはここには置かない。
 *
 * webAppUrl・spreadsheetId はどちらも秘匿情報ではない
 * （アクセス制御はGAS Web Appのデプロイ設定側で行う想定）ため、
 * このモジュール自体はSecretを一切扱わない。
 */

export const DEFAULT_GAS_SHEET_NAMES = {
  tasks: "Tasks",
  executions: "Executions",
  skills: "Skills",
  settings: "Settings",
};

const WEB_APP_URL_PATTERN = /^https:\/\/script\.google\.com\/macros\/s\/[^/]+\/exec$/;

/** 純粋な検証関数。UIのフォーム検証・保存前チェックの両方から使う */
export function validateGasConfig(config) {
  const errors = [];
  const webAppUrl = String(config?.webAppUrl ?? "").trim();
  const spreadsheetId = String(config?.spreadsheetId ?? "").trim();

  if (!webAppUrl) {
    errors.push("Web App URLを入力してください。");
  } else if (!WEB_APP_URL_PATTERN.test(webAppUrl)) {
    errors.push("Web App URLの形式が正しくありません（https://script.google.com/macros/s/.../exec）。");
  }

  if (!spreadsheetId) {
    errors.push("Spreadsheet IDを入力してください。");
  }

  return { valid: errors.length === 0, errors };
}

async function callGas(config, action, payload) {
  const result = validateGasConfig(config);
  if (!result.valid) throw new Error(result.errors.join(" "));

  const response = await fetch(config.webAppUrl, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      action,
      spreadsheetId: config.spreadsheetId,
      sheetNames: { ...DEFAULT_GAS_SHEET_NAMES, ...(config.sheetNames ?? {}) },
      payload,
    }),
  });

  if (!response.ok) throw new Error("Google Sheetsとの通信に失敗しました。");
  return response.json();
}

export function createGoogleSheetsGasProvider() {
  return {
    id: "google-sheets-gas",
    label: "Google Sheets (GAS)",

    isConfigured(config) {
      return validateGasConfig(config).valid;
    },

    async configure(config = {}) {
      const result = validateGasConfig(config);
      if (!result.valid) throw new Error(result.errors.join(" "));
      return {
        webAppUrl: config.webAppUrl.trim(),
        spreadsheetId: config.spreadsheetId.trim(),
        sheetNames: { ...DEFAULT_GAS_SHEET_NAMES, ...(config.sheetNames ?? {}) },
      };
    },

    async loadState(config) {
      const res = await callGas(config, "loadState", {});
      return res?.state ?? null;
    },

    async saveState(state, config) {
      return callGas(config, "saveState", { state });
    },

    async appendExecution(execution, config) {
      return callGas(config, "appendExecution", { execution });
    },

    async saveCapture(capture, config) {
      return callGas(config, "saveCapture", { capture });
    },

    async saveAiAnalysis(analysis, config) {
      return callGas(config, "saveAiAnalysis", { analysis });
    },

    async saveSkill(skill, config) {
      return callGas(config, "saveSkill", { skill });
    },

    async saveAutomationCandidate(candidate, config) {
      return callGas(config, "saveAutomationCandidate", { candidate });
    },

    async healthCheck(config) {
      if (!this.isConfigured(config)) return { ok: false, message: "未接続です。" };
      try {
        await callGas(config, "healthCheck", {});
        return { ok: true, message: "接続済み" };
      } catch (error) {
        return { ok: false, message: error.message };
      }
    },

    async disconnect() {
      // Web App URL/Spreadsheet IDを設定側でクリアするだけでよい（Provider側は無状態）
    },
  };
}
