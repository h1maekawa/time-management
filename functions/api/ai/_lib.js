/**
 * AI Brain Dump 解析の純粋ロジック（プロンプト組み立て・応答の整形）。
 *
 * ここは Cloudflare Pages Functions のルートハンドラ（analyze-brain-dump.js）と
 * Node のテスト（tests/ai-lib.test.js）の両方から読み込む共有モジュール。
 * ファイル名を `_lib.js` にしているのは、Pages Functions がアンダースコア始まりの
 * ファイルをルーティング対象から除外する規約に従うため（＝ここはAPIエンドポイントではない）。
 *
 * 重要: ここはタスク候補の"整理"だけを担当する。実際の時間割配置（いつ・何分）は
 * 一切行わない。時間割配置は常に assets/js/timebox-engine.js の buildSchedule() が担当する。
 */

import { TRIAGE_IDS, clampMinutes, clampPriority } from "../../../assets/js/timebox-engine.js";

export const AI_ROLE_DESCRIPTION =
  "あなたはタイムボックス管理アプリ Timebox OS の壁打ち相手です。" +
  "利用者が書き殴った Brain Dump（頭の中を全部書いたメモ）を読み、タスク候補として整理するのが役目です。" +
  "実際に「いつ・何分やるか」という時間割への配置は、Timebox OS本体の決定論的なスケジューリングエンジンが行います。" +
  "あなたは時刻や時間割そのものは提案せず、タスクの分解・優先度候補・所要時間候補・最初の一歩の提案にとどめてください。";

const OUTPUT_SCHEMA_EXAMPLE = {
  goal: "string | null（全体として目指していることの要約。読み取れなければnull）",
  summary: "string | null（Brain Dump全体の短い要約）",
  questions: ["string（整理のために利用者へ確認したいこと。無ければ空配列）"],
  tasks: [
    {
      title: "string（タスク名。動詞で）",
      project: "string | null",
      firstAction: "string | null（最初の一歩）",
      priority: "1〜5の整数。高いほど優先",
      estimatedMinutes: "5〜480の整数（分）",
      category: "work または life",
      deadline: "YYYY-MM-DD または null",
      subtasks: ["string"],
      dependencies: ["string（依存する他タスクのtitle）"],
      reason: "string（この優先度・所要時間になった理由）",
      triage: "today, scheduled, waiting, someday, dropped のいずれか",
    },
  ],
};

/**
 * モデルへ渡すプロンプトを組み立てる。
 * @param {{ text: string, date?: string|null, availableMinutes?: number|null, recentContext?: string|null }} input
 */
export function buildPrompt({ text, date, availableMinutes, recentContext }) {
  const lines = [
    AI_ROLE_DESCRIPTION,
    "",
    "次のBrain Dumpを読み、下記の厳密なJSON形式だけを出力してください。JSON以外の文章・前置き・コードフェンスは付けないでください。",
    "",
    `日付: ${date ?? "不明"}`,
    availableMinutes ? `今日使える時間の目安: 約${availableMinutes}分` : null,
    recentContext ? `直近の文脈: ${recentContext}` : null,
    "",
    "Brain Dump:",
    "---",
    String(text ?? ""),
    "---",
    "",
    "出力JSON形式（値はこの通りの型で埋めること）:",
    JSON.stringify(OUTPUT_SCHEMA_EXAMPLE, null, 2),
  ];
  return lines.filter((line) => line !== null).join("\n");
}

/**
 * モデルの生テキスト応答からJSON部分だけを取り出す。
 * ```json ... ``` で囲まれていても、前後に説明文が付いていても対応する。
 */
export function extractJsonBlock(raw) {
  const text = String(raw ?? "");
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenced) return fenced[1].trim();

  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start !== -1 && end !== -1 && end > start) return text.slice(start, end + 1);

  return text.trim();
}

const VALID_CATEGORIES = ["work", "life"];
const DEADLINE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

function normalizeTaskSuggestion(raw) {
  if (!raw || typeof raw !== "object") return null;
  const title = String(raw.title ?? "").trim();
  if (!title) return null;

  return {
    title,
    project: raw.project ? String(raw.project) : null,
    firstAction: raw.firstAction ? String(raw.firstAction) : null,
    priority: clampPriority(raw.priority ?? 3),
    estimatedMinutes: clampMinutes(raw.estimatedMinutes ?? 30),
    category: VALID_CATEGORIES.includes(raw.category) ? raw.category : "work",
    deadline: typeof raw.deadline === "string" && DEADLINE_PATTERN.test(raw.deadline) ? raw.deadline : null,
    subtasks: Array.isArray(raw.subtasks) ? raw.subtasks.map(String).filter(Boolean) : [],
    dependencies: Array.isArray(raw.dependencies) ? raw.dependencies.map(String).filter(Boolean) : [],
    reason: raw.reason ? String(raw.reason) : "",
    triage: TRIAGE_IDS.includes(raw.triage) ? raw.triage : "today",
  };
}

/**
 * モデルが返したJSON（parse済み）を、Review UIが期待する形へ整える。
 * 壊れた・欠けた値は安全側（デフォルト値）に倒し、例外を投げない。
 */
export function normalizeAiResponse(json) {
  const source = json && typeof json === "object" ? json : {};
  const tasks = Array.isArray(source.tasks)
    ? source.tasks.map(normalizeTaskSuggestion).filter(Boolean)
    : [];

  return {
    goal: source.goal ? String(source.goal) : null,
    summary: source.summary ? String(source.summary) : null,
    questions: Array.isArray(source.questions) ? source.questions.map(String).filter(Boolean) : [],
    tasks,
  };
}

/**
 * Anthropic Messages API のレスポンス全体から、Review UI向けの提案一式を取り出す。
 * 解析に失敗しても例外を投げず、空の提案 + summaryにエラー説明を入れて返す。
 */
export function parseModelOutput(data) {
  const block = Array.isArray(data?.content) ? data.content.find((c) => c?.type === "text") : null;
  const text = block?.text ?? data?.content?.[0]?.text ?? "";

  try {
    const parsed = JSON.parse(extractJsonBlock(text));
    return normalizeAiResponse(parsed);
  } catch {
    return { goal: null, summary: "AI応答の解析に失敗しました。", questions: [], tasks: [] };
  }
}
