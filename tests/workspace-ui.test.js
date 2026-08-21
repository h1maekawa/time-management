import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { summarize } from "../assets/js/timebox-engine.js";

const html = await readFile(new URL("../app/index.html", import.meta.url), "utf8");
const css = await readFile(new URL("../assets/css/timebox.css", import.meta.url), "utf8");

test("workspace はCalendar / Brain Dump / Today Tasksの実データDOMを保持する", () => {
  for (const id of [
    "tb-date", "tb-now", "tb-kpis", "tb-notices", "tb-braindump-input",
    "tb-braindump-ai-state", "tb-tabs", "tb-tasks", "tb-capacity",
    "tb-timeline-scroll", "tb-timeline", "tb-overflow", "tb-storage-state", "tb-account",
  ]) assert.match(html, new RegExp(`id=["']${id}["']`));

  assert.match(html, /class="tb-workspace"/);
  assert.match(html, /class="tb-workspace-calendar/);
  assert.match(html, /class="tb-workspace-chat/);
  assert.match(html, /class="tb-workspace-tasks/);
  assert.match(html, /data-action="brain-dump-analyze"/);
});

test("workspace metadata は現行Pages URLを指す", () => {
  assert.doesNotMatch(html, /timebox\.maemichi\.com/);
  assert.match(html, /https:\/\/time-management-cx7\.pages\.dev\/app\//);
  assert.match(html, /https:\/\/time-management-cx7\.pages\.dev\/images\/dayloop\/ogp\/dayloop-ogp\.png/);
});

test("desktop 3カラムとmobile 1カラム、横幅制約を定義する", () => {
  assert.match(css, /grid-template-columns:\s*minmax\(270px,.8fr\)\s+minmax\(440px,1.7fr\)\s+minmax\(290px,.9fr\)/);
  assert.match(css, /@media \(max-width: 760px\)[\s\S]*?\.tb-workspace \{ display: flex; flex-direction: column; \}/);
  assert.match(css, /\.tb-workspace > \*, \.tb-workspace-tasks \{ min-width: 0; \}/);
});

test("summarize はNOW/NEXTと残り時間を同じ集計から返す", () => {
  const summary = summarize({
    tasks: [{ done: false, category: "work", minutes: 45 }],
    windows: [],
    blocks: [
      { title: "NOW", start: "10:00", end: "10:45", done: false },
      { title: "NEXT", start: "11:00", end: "12:00", done: false },
    ],
  }, "10:21");
  assert.equal(summary.currentBlock.title, "NOW");
  assert.equal(summary.nextBlock.title, "NEXT");
  assert.equal(summary.remainingMinutes, 24);
  assert.equal(summary.overdue, null);
});
