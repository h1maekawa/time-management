/**
 * AI Brain Dump 解析のクライアント側ラッパー。
 *
 * バックエンド（Cloudflare Pages Functions）が未設定・応答不能なときは
 * AiUnavailableError を投げる。呼び出し側（timebox-brain-dump.js）はこれを
 * 捕まえて、既存の parseTaskLines によるルールベースのfallbackへ切り替える。
 * Manual Entryはこの状態でも通常通り使える（AIは必須ではない）。
 */

export class AiUnavailableError extends Error {}

/**
 * @param {string} text Brain Dumpの生テキスト
 * @param {{ date?: string, availableMinutes?: number, recentContext?: string }} [context]
 */
export async function analyzeBrainDump(text, context = {}) {
  let response;
  try {
    response = await fetch("/api/ai/analyze-brain-dump", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ text, ...context }),
    });
  } catch {
    throw new AiUnavailableError("AI機能に接続できませんでした。");
  }

  if (response.status === 501) {
    throw new AiUnavailableError("AI機能が未設定です。");
  }
  if (!response.ok) {
    throw new AiUnavailableError("AI機能の呼び出しに失敗しました。");
  }

  try {
    return await response.json();
  } catch {
    throw new AiUnavailableError("AIの応答を読み取れませんでした。");
  }
}
