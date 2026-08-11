/**
 * Local State（camelCase, timebox-engine.js の create*() が作る形）と
 * Supabase の各テーブル行（snake_case）を相互変換する純粋関数群。
 *
 * ここではネットワーク・DBに一切触れない（cloud-provider.js から呼ばれる）。
 * 既存Task ID等はそのまま使う（IDを作り直さない。§18/§7）。
 */

export function taskToRow(task) {
  return {
    id: task.id,
    title: task.title ?? "",
    minutes: task.minutes ?? 30,
    priority: task.priority ?? 3,
    triage: task.triage ?? "today",
    planned_date: task.plannedDate ?? null,
    deadline: task.deadline ?? null,
    category: task.category ?? "work",
    time_hint: task.timeHint ?? "any",
    done: Boolean(task.done),
    carry_count: task.carryCount ?? 0,
    carried_from: task.carriedFrom ?? null,
    pinned_start: task.pinnedStart ?? null,
    origin: task.origin ?? "manual",
  };
}

export function rowToTask(row) {
  return {
    id: row.id,
    title: row.title ?? "",
    minutes: row.minutes ?? 30,
    priority: row.priority ?? 3,
    triage: row.triage ?? "today",
    plannedDate: row.planned_date ?? null,
    deadline: row.deadline ?? null,
    category: row.category ?? "work",
    timeHint: row.time_hint ?? "any",
    done: Boolean(row.done),
    carryCount: row.carry_count ?? 0,
    carriedFrom: row.carried_from ?? null,
    pinnedStart: row.pinned_start ?? null,
    origin: row.origin ?? "manual",
    createdAt: row.created_at ?? new Date().toISOString(),
  };
}

export function captureToRow(capture) {
  return {
    id: capture.id,
    raw_text: capture.text ?? "",
    status: capture.status ?? "draft",
  };
}

export function rowToCapture(row) {
  return {
    id: row.id,
    text: row.raw_text ?? "",
    status: row.status ?? "draft",
    createdAt: row.created_at ?? new Date().toISOString(),
  };
}

export function aiAnalysisToRow(analysis) {
  return {
    id: analysis.id,
    capture_id: analysis.captureId ?? null,
    suggestions: analysis.suggestions ?? {},
    model: analysis.model ?? null,
    accepted_at: analysis.acceptedAt ?? null,
  };
}

export function rowToAiAnalysis(row) {
  return {
    id: row.id,
    captureId: row.capture_id ?? null,
    suggestions: row.suggestions ?? {},
    model: row.model ?? null,
    acceptedAt: row.accepted_at ?? null,
    createdAt: row.created_at ?? new Date().toISOString(),
  };
}

export function executionToRow(execution) {
  return {
    id: execution.id,
    task_id: execution.taskId ?? null,
    date: execution.date ?? null,
    planned_start: execution.plannedStart ?? null,
    planned_end: execution.plannedEnd ?? null,
    planned_minutes: execution.plannedMinutes ?? null,
    actual_start: execution.actualStart ?? null,
    actual_end: execution.actualEnd ?? null,
    actual_minutes: execution.actualMinutes ?? null,
    completed: Boolean(execution.completed),
    carry_count: execution.carryCount ?? 0,
  };
}

export function rowToExecution(row) {
  return {
    id: row.id,
    taskId: row.task_id ?? null,
    date: row.date ?? null,
    plannedStart: row.planned_start ?? null,
    plannedEnd: row.planned_end ?? null,
    plannedMinutes: row.planned_minutes ?? null,
    actualStart: row.actual_start ?? null,
    actualEnd: row.actual_end ?? null,
    actualMinutes: row.actual_minutes ?? null,
    completed: Boolean(row.completed),
    carryCount: row.carry_count ?? 0,
    createdAt: row.created_at ?? new Date().toISOString(),
  };
}

export function skillToRow(skill) {
  return {
    id: skill.id,
    name: skill.name ?? "",
    description: skill.description ?? "",
    steps: skill.steps ?? [],
    source_task_ids: skill.sourceTaskIds ?? [],
    confidence: skill.confidence ?? 0,
    status: skill.status ?? "suggested",
  };
}

export function rowToSkill(row) {
  return {
    id: row.id,
    name: row.name ?? "",
    description: row.description ?? "",
    steps: row.steps ?? [],
    sourceTaskIds: row.source_task_ids ?? [],
    confidence: row.confidence ?? 0,
    status: row.status ?? "suggested",
    createdAt: row.created_at ?? new Date().toISOString(),
  };
}

export function automationCandidateToRow(candidate) {
  return {
    id: candidate.id,
    type: candidate.type ?? "routine",
    title: candidate.title ?? "",
    reason: candidate.reason ?? "",
    evidence: candidate.evidence ?? "",
    confidence: candidate.confidence ?? 0,
    status: candidate.status ?? "suggested",
  };
}

export function rowToAutomationCandidate(row) {
  return {
    id: row.id,
    type: row.type ?? "routine",
    title: row.title ?? "",
    reason: row.reason ?? "",
    evidence: row.evidence ?? "",
    confidence: row.confidence ?? 0,
    status: row.status ?? "suggested",
    createdAt: row.created_at ?? new Date().toISOString(),
  };
}
