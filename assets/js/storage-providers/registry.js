/**
 * Storage Provider Adapter Architecture.
 *
 * どのProviderも次の形を満たす:
 *   id, label
 *   isConfigured(config) -> boolean
 *   configure(config)    -> Promise<config>            設定・接続処理（フォルダ選択など）
 *   loadState(config)     -> Promise<state|null>
 *   saveState(state, config) -> Promise<{ok, error?}>
 *   appendExecution(execution, config) -> Promise<{ok, error?}>
 *   saveCapture(capture, config, analysis?) -> Promise<{ok, error?}>
 *   saveAiAnalysis(analysis, config, capture?) -> Promise<{ok, error?}>
 *   saveSkill(skill, config) -> Promise<{ok, error?}>
 *   saveAutomationCandidate(candidate, config) -> Promise<{ok, error?}>
 *   healthCheck(config)  -> Promise<{ok, message?}>
 *   disconnect(config)   -> Promise<void>
 *
 * `local`（localStorage）は常時利用可能な基盤として扱う。他のProviderへ切り替えても
 * localへの保存は止めない（Frontend側の最低限のキャッシュとして残す。§6参照）。
 * 未知のIDや壊れた設定値が来ても必ず `local` にフォールバックし、動かなくならないようにする。
 */
import { createLocalProvider } from "./local-provider.js";
import { createObsidianProvider } from "./obsidian/provider.js";
import { createGoogleSheetsGasProvider } from "./google-sheets-gas-provider.js";
import { createGoogleDriveProvider } from "./google-drive-provider.js";
import { createCloudProvider } from "./cloud-provider.js";

const providers = {
  local: createLocalProvider(),
  obsidian: createObsidianProvider(),
  "google-sheets-gas": createGoogleSheetsGasProvider(),
  "google-drive": createGoogleDriveProvider(),
  cloud: createCloudProvider(),
};

export const PROVIDER_IDS = Object.keys(providers);

/** 未知のIDでも必ず local を返す（存在しないProviderで例外を出さない） */
export function getProvider(id) {
  return providers[id] ?? providers.local;
}

export function listProviders() {
  return PROVIDER_IDS.map((id) => providers[id]);
}

export function isKnownProviderId(id) {
  return PROVIDER_IDS.includes(id);
}
