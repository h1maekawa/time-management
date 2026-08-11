import test from "node:test";
import assert from "node:assert/strict";

import {
  createTask,
  createCapture,
  createAiAnalysis,
  createExecution,
  createSkill,
  createAutomationCandidate,
} from "../assets/js/timebox-engine.js";
import {
  taskToRow,
  rowToTask,
  captureToRow,
  rowToCapture,
  aiAnalysisToRow,
  rowToAiAnalysis,
  executionToRow,
  rowToExecution,
  skillToRow,
  rowToSkill,
  automationCandidateToRow,
  rowToAutomationCandidate,
} from "../assets/js/supabase/entity-mapping.js";

test("task: camelCase(local) <-> snake_case(row) の往復で意味のあるフィールドが失われない", () => {
  const task = createTask({
    id: "t1",
    title: "商談準備",
    minutes: 45,
    priority: 2,
    triage: "scheduled",
    plannedDate: "2026-08-12",
    deadline: "2026-08-15",
    category: "life",
    timeHint: "morning",
    done: true,
    carryCount: 2,
    carriedFrom: "2026-08-10",
    pinnedStart: "09:30",
    origin: "ai-brain-dump",
  });
  const row = taskToRow(task);
  assert.equal(row.planned_date, "2026-08-12");
  assert.equal(row.time_hint, "morning");
  assert.equal(row.carry_count, 2);
  assert.equal(row.carried_from, "2026-08-10");
  assert.equal(row.pinned_start, "09:30");

  const back = rowToTask({ ...row, created_at: task.createdAt });
  assert.equal(back.id, task.id);
  assert.equal(back.title, task.title);
  assert.equal(back.plannedDate, task.plannedDate);
  assert.equal(back.timeHint, task.timeHint);
  assert.equal(back.carryCount, task.carryCount);
  assert.equal(back.carriedFrom, task.carriedFrom);
  assert.equal(back.pinnedStart, task.pinnedStart);
  assert.equal(back.origin, task.origin);
  assert.equal(back.done, true);
});

test("capture: text <-> raw_text", () => {
  const capture = createCapture({ id: "c1", text: "メモ書き" });
  const row = captureToRow(capture);
  assert.equal(row.raw_text, "メモ書き");
  const back = rowToCapture({ ...row, created_at: capture.createdAt });
  assert.equal(back.text, "メモ書き");
});

test("aiAnalysis: captureId <-> capture_id, acceptedAt <-> accepted_at", () => {
  const analysis = createAiAnalysis({ id: "a1", captureId: "c1", suggestions: { tasks: [] }, acceptedAt: "2026-08-11T00:00:00.000Z" });
  const row = aiAnalysisToRow(analysis);
  assert.equal(row.capture_id, "c1");
  assert.equal(row.accepted_at, analysis.acceptedAt);
  const back = rowToAiAnalysis({ ...row, created_at: analysis.createdAt });
  assert.equal(back.captureId, "c1");
  assert.equal(back.acceptedAt, analysis.acceptedAt);
});

test("execution: plannedStart/actualMinutes等のフィールドが失われない", () => {
  const execution = createExecution({
    id: "e1",
    taskId: "t1",
    date: "2026-08-11",
    plannedStart: "09:00",
    plannedEnd: "09:30",
    plannedMinutes: 30,
    actualStart: "09:05",
    actualEnd: "09:40",
    actualMinutes: 35,
    completed: true,
    carryCount: 1,
  });
  const row = executionToRow(execution);
  assert.equal(row.task_id, "t1");
  assert.equal(row.planned_start, "09:00");
  assert.equal(row.actual_minutes, 35);
  const back = rowToExecution({ ...row, created_at: execution.createdAt });
  assert.equal(back.taskId, "t1");
  assert.equal(back.plannedStart, "09:00");
  assert.equal(back.actualMinutes, 35);
  assert.equal(back.completed, true);
});

test("skill: sourceTaskIds <-> source_task_ids", () => {
  const skill = createSkill({ id: "sk1", name: "型", steps: ["a", "b"], sourceTaskIds: ["t1", "t2"], confidence: 0.5 });
  const row = skillToRow(skill);
  assert.deepEqual(row.source_task_ids, ["t1", "t2"]);
  const back = rowToSkill({ ...row, created_at: skill.createdAt });
  assert.deepEqual(back.sourceTaskIds, ["t1", "t2"]);
  assert.deepEqual(back.steps, ["a", "b"]);
});

test("automationCandidate: 主要フィールドの往復", () => {
  const candidate = createAutomationCandidate({
    id: "au1",
    type: "estimate-adjustment",
    title: "見積もり調整",
    reason: "毎回超過",
    evidence: "5回連続",
    confidence: 0.7,
  });
  const row = automationCandidateToRow(candidate);
  assert.equal(row.type, "estimate-adjustment");
  const back = rowToAutomationCandidate({ ...row, created_at: candidate.createdAt });
  assert.equal(back.title, "見積もり調整");
  assert.equal(back.reason, "毎回超過");
});
