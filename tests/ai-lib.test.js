import test from "node:test";
import assert from "node:assert/strict";

import {
  AI_ROLE_DESCRIPTION,
  buildPrompt,
  extractJsonBlock,
  normalizeAiResponse,
  parseModelOutput,
} from "../functions/api/ai/_lib.js";

// ─── buildPrompt ───────────────────────────────────────────

test("buildPrompt は役割説明を含み、時間割配置はしないことを明記する", () => {
  const prompt = buildPrompt({ text: "テスト" });
  assert.match(prompt, /タスク候補として整理/);
  assert.match(prompt, /時間割配置は一切行わない|時間割そのものは提案せず/);
  assert.ok(prompt.includes(AI_ROLE_DESCRIPTION));
});

test("buildPrompt は入力テキストと日付・利用可能時間を含める", () => {
  const prompt = buildPrompt({ text: "田中さん返信", date: "2026-08-10", availableMinutes: 180 });
  assert.match(prompt, /田中さん返信/);
  assert.match(prompt, /2026-08-10/);
  assert.match(prompt, /180分/);
});

test("buildPrompt は availableMinutes / recentContext が無くても壊れない", () => {
  const prompt = buildPrompt({ text: "テスト", date: null, availableMinutes: null, recentContext: null });
  assert.ok(prompt.length > 0);
  // 未入力の値が "undefined" としてそのまま埋め込まれていないことを確認する
  // （スキーマ例に "string | null" という語自体は含まれるためnullチェックはしない）
  assert.doesNotMatch(prompt, /undefined/);
  assert.match(prompt, /日付: 不明/);
});

// ─── extractJsonBlock ──────────────────────────────────────

test("extractJsonBlock はコードフェンス付きの応答からJSONだけを取り出す", () => {
  const raw = "はい、整理しました。\n```json\n{\"goal\": \"resolve\"}\n```\nよろしくお願いします。";
  assert.equal(extractJsonBlock(raw), '{"goal": "resolve"}');
});

test("extractJsonBlock はフェンスが無くても { } の範囲を取り出す", () => {
  const raw = 'ここがJSONです: {"goal": null, "tasks": []} 以上です。';
  assert.equal(extractJsonBlock(raw), '{"goal": null, "tasks": []}');
});

test("extractJsonBlock はJSONが見当たらなければ元のテキストを返す", () => {
  assert.equal(extractJsonBlock("not json at all"), "not json at all");
});

// ─── normalizeAiResponse ───────────────────────────────────

test("normalizeAiResponse は範囲外のpriority/minutesを丸める", () => {
  const result = normalizeAiResponse({
    tasks: [{ title: "テスト", priority: 99, estimatedMinutes: 99999, category: "invalid" }],
  });
  assert.equal(result.tasks[0].priority, 5);
  assert.equal(result.tasks[0].estimatedMinutes, 480);
  assert.equal(result.tasks[0].category, "work");
});

test("normalizeAiResponse はtitleの無いタスク候補を除外する", () => {
  const result = normalizeAiResponse({ tasks: [{ title: "" }, { title: "有効なタスク" }, {}] });
  assert.equal(result.tasks.length, 1);
  assert.equal(result.tasks[0].title, "有効なタスク");
});

test("normalizeAiResponse は不正なtriage/deadlineをデフォルトに倒す", () => {
  const result = normalizeAiResponse({
    tasks: [{ title: "T", triage: "not-a-real-triage", deadline: "not-a-date" }],
  });
  assert.equal(result.tasks[0].triage, "today");
  assert.equal(result.tasks[0].deadline, null);
});

test("normalizeAiResponse は壊れた入力（null / 配列でないtasks）でも例外を投げない", () => {
  assert.deepEqual(normalizeAiResponse(null), { goal: null, summary: null, questions: [], tasks: [] });
  assert.deepEqual(normalizeAiResponse({ tasks: "not-an-array" }), {
    goal: null,
    summary: null,
    questions: [],
    tasks: [],
  });
});

// ─── parseModelOutput ──────────────────────────────────────

test("parseModelOutput はAnthropic Messages API形式のレスポンスからタスク候補を取り出す", () => {
  const data = {
    content: [
      {
        type: "text",
        text: '```json\n{"goal":"商談準備","tasks":[{"title":"資料を確認する","priority":4,"estimatedMinutes":30,"category":"work","triage":"today"}]}\n```',
      },
    ],
  };
  const result = parseModelOutput(data);
  assert.equal(result.goal, "商談準備");
  assert.equal(result.tasks.length, 1);
  assert.equal(result.tasks[0].title, "資料を確認する");
});

test("parseModelOutput は解析に失敗しても例外を投げず、空の提案を返す", () => {
  const result = parseModelOutput({ content: [{ type: "text", text: "JSONではない返答です" }] });
  assert.deepEqual(result.tasks, []);
  assert.match(result.summary, /解析に失敗/);
});
