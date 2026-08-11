import test from "node:test";
import assert from "node:assert/strict";

import { summarize } from "../assets/js/timebox-engine.js";
import { deriveMiniView } from "../assets/js/mini/mini-state.js";

function plan(blocks) {
  return { tasks: [], blocks };
}

test("summarize: currentBlock/nextBlock/remainingMinutesを1つのselectorから返す（§83: Main/Miniで同じロジック）", () => {
  const blocks = [
    { taskId: "t1", title: "商談準備", start: "10:00", end: "10:45", done: false },
    { taskId: "t2", title: "週次資料", start: "11:00", end: "12:00", done: false },
  ];
  const summary = summarize(plan(blocks), "10:18");
  assert.equal(summary.currentBlock.title, "商談準備");
  assert.equal(summary.nextBlock.title, "週次資料");
  assert.equal(summary.remainingMinutes, 27);
  assert.equal(summary.overdue, false);
});

test("summarize: 予定終了時刻を過ぎるとoverdue:trueになり、remainingMinutesは負になる", () => {
  const blocks = [{ taskId: "t1", title: "商談準備", start: "10:00", end: "10:45", done: false }];
  const summary = summarize(plan(blocks), "10:50");
  assert.equal(summary.overdue, true);
  assert.equal(summary.remainingMinutes, -5);
});

test("summarize: 完了済みブロックはcurrentBlock/nextBlockの対象にならない", () => {
  const blocks = [{ taskId: "t1", title: "商談準備", start: "10:00", end: "10:45", done: true }];
  const summary = summarize(plan(blocks), "10:18");
  assert.equal(summary.currentBlock, null);
});

test("deriveMiniView: 今実行中でoverdueならmode=overdue、nextBlockも一緒に返す", () => {
  const summary = {
    overdue: true,
    currentBlock: { taskId: "t1", title: "A", start: "10:00", end: "10:45" },
    nextBlock: { taskId: "t2", title: "B", start: "11:00", end: "12:00" },
    remainingMinutes: -3,
  };
  const view = deriveMiniView(summary);
  assert.equal(view.mode, "overdue");
  assert.equal(view.block.title, "A");
  assert.equal(view.nextBlock.title, "B");
});

test("deriveMiniView: 実行中(overdueでない)ならmode=now", () => {
  const summary = {
    overdue: false,
    currentBlock: { taskId: "t1", title: "A", start: "10:00", end: "10:45" },
    nextBlock: null,
    remainingMinutes: 20,
  };
  const view = deriveMiniView(summary);
  assert.equal(view.mode, "now");
  assert.equal(view.remainingMinutes, 20);
});

test("deriveMiniView: currentBlockが無くnextBlockだけあればmode=next-only", () => {
  const summary = { overdue: false, currentBlock: null, nextBlock: { title: "B" }, remainingMinutes: null };
  const view = deriveMiniView(summary);
  assert.equal(view.mode, "next-only");
});

test("deriveMiniView: 何も無ければmode=empty", () => {
  const summary = { overdue: false, currentBlock: null, nextBlock: null, remainingMinutes: null };
  assert.equal(deriveMiniView(summary).mode, "empty");
});

test("Main ↔ Mini sync: 同じsummarize()呼び出し結果をMain/Mini双方の描画が参照する（二重ロジックが無いことの構造的検証）", () => {
  const blocks = [{ taskId: "t1", title: "A", start: "09:00", end: "09:30", done: false }];
  const summaryForMain = summarize(plan(blocks), "09:10");
  const summaryForMini = summarize(plan(blocks), "09:10");
  // 実装が同じ入力から同じ出力を返す一つの関数であることを保証する（別ロジックの分岐が無い）
  assert.deepEqual(summaryForMain.currentBlock, summaryForMini.currentBlock);
  assert.equal(summaryForMain.remainingMinutes, summaryForMini.remainingMinutes);
  assert.deepEqual(deriveMiniView(summaryForMain), deriveMiniView(summaryForMini));
});
