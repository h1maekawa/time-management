/**
 * DAYLOOP Mini（Execution UI）が「何を表示すべきか」を決める純粋関数。
 *
 * timebox-engine.js の summarize() が返す currentBlock/nextBlock/remainingMinutes/overdue を
 * そのまま使う。Main画面のタイムラインと別ロジックを作らない（§83）。
 */

/**
 * @param {ReturnType<import("../timebox-engine.js").summarize>} summary
 * @returns {{mode: "empty"|"now"|"overdue"|"next-only", block?: object, nextBlock?: object|null, remainingMinutes?: number|null}}
 */
export function deriveMiniView(summary) {
  if (summary.overdue && summary.currentBlock) {
    return { mode: "overdue", block: summary.currentBlock, nextBlock: summary.nextBlock ?? null };
  }
  if (summary.currentBlock) {
    return {
      mode: "now",
      block: summary.currentBlock,
      remainingMinutes: summary.remainingMinutes,
      nextBlock: summary.nextBlock ?? null,
    };
  }
  if (summary.nextBlock) {
    return { mode: "next-only", nextBlock: summary.nextBlock };
  }
  return { mode: "empty" };
}
