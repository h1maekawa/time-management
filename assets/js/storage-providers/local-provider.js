/**
 * ローカル（この端末のlocalStorage）を StorageProvider インターフェースへ薄くラップしたもの。
 * 常にPhase 1の基盤として存在し、他のProviderを選んでいてもここへの保存は続く
 * （storage-providers/registry.js のコメント参照）。
 */
import * as storage from "../timebox-storage.js";

export function createLocalProvider() {
  return {
    id: "local",
    label: "この端末",

    isConfigured() {
      return true;
    },

    async configure() {
      return {};
    },

    async loadState() {
      return storage.load();
    },

    async saveState(state) {
      storage.save(state);
      return { ok: true };
    },

    async appendExecution(execution) {
      storage.appendExecution(execution);
      return { ok: true };
    },

    async saveCapture(capture) {
      storage.saveCapture(capture);
      return { ok: true };
    },

    async saveAiAnalysis(analysis) {
      storage.saveAiAnalysis(analysis);
      return { ok: true };
    },

    async saveSkill(skill) {
      storage.saveSkill(skill);
      return { ok: true };
    },

    async saveAutomationCandidate(candidate) {
      storage.saveAutomationCandidate(candidate);
      return { ok: true };
    },

    async healthCheck() {
      const persistent = storage.isPersistent();
      return {
        ok: persistent,
        message: persistent ? "利用可能です。" : "このブラウザでは保存が使えません（プライベートモードなど）。",
      };
    },

    async disconnect() {
      // ローカルは常時利用可能な基盤のため切断できない
    },
  };
}
