/**
 * POST /api/ai/analyze-brain-dump
 *
 * Cloudflare Pages Function。AI APIキーはここ（サーバー側）だけで扱い、
 * フロントエンドへは一切渡さない（env.AI_API_KEY はCloudflare Pagesの
 * 環境変数/Secretとして設定する。このリポジトリにはコミットしない）。
 *
 * env.AI_API_KEY が無い場合は 501 を返す。フロントエンド（assets/js/ai-client.js）は
 * これを「AI機能が未設定です」として扱い、既存の parseTaskLines による
 * ルールベースのfallbackへ切り替える。Manual Entryはこの状態でも通常通り使える。
 */

import { buildPrompt, parseModelOutput } from "./_lib.js";

const MAX_TEXT_LENGTH = 8000;
const MAX_CONTEXT_LENGTH = 2000;

function json(body, status) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

export async function onRequestPost({ request, env }) {
  const apiKey = env.AI_API_KEY;
  if (!apiKey) {
    return json({ error: "ai_not_configured", message: "AI機能が未設定です。" }, 501);
  }

  let body;
  try {
    body = await request.json();
  } catch {
    return json({ error: "invalid_request", message: "リクエストの形式が正しくありません。" }, 400);
  }

  const text = String(body?.text ?? "").slice(0, MAX_TEXT_LENGTH).trim();
  if (!text) {
    return json({ error: "empty_text", message: "Brain Dumpの内容が空です。" }, 400);
  }

  const availableMinutes = Number(body?.availableMinutes);
  const prompt = buildPrompt({
    text,
    date: typeof body?.date === "string" ? body.date : null,
    availableMinutes: Number.isFinite(availableMinutes) ? availableMinutes : null,
    recentContext:
      typeof body?.recentContext === "string" ? body.recentContext.slice(0, MAX_CONTEXT_LENGTH) : null,
  });

  let upstream;
  try {
    upstream = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: env.AI_MODEL || "claude-haiku-4-5-20251001",
        max_tokens: 1536,
        messages: [{ role: "user", content: prompt }],
      }),
    });
  } catch {
    return json({ error: "upstream_unreachable", message: "AIサービスへ接続できませんでした。" }, 502);
  }

  if (!upstream.ok) {
    return json({ error: "upstream_error", message: "AIサービスの呼び出しに失敗しました。" }, 502);
  }

  let data;
  try {
    data = await upstream.json();
  } catch {
    return json({ error: "upstream_invalid_response", message: "AIサービスの応答を読み取れませんでした。" }, 502);
  }

  return json(parseModelOutput(data), 200);
}
