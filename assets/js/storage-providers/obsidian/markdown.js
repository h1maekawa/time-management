/**
 * Obsidian保存の純粋ロジック（ファイル名の安全化・Markdown生成）。
 * File System Access APIなどブラウザ専用の処理は fs-access.js 側に分離してあり、
 * ここはDOM・ファイルシステムに一切触らないので Node のテストからそのまま検証できる。
 */

export const DEFAULT_OBSIDIAN_PATHS = {
  root: "Timebox",
  captures: "Timebox/Captures",
  daily: "Timebox/Daily",
  skills: "Timebox/Skills",
  automation: "Timebox/Automation",
  settings: "Timebox/Settings",
};

/**
 * ファイル名として安全な文字列にする。
 * OS/Obsidianで問題になりやすい文字（パス区切り・ワイルドカード・Markdownリンク記号など）を
 * 全角ハイフンではなく半角ハイフンへ寄せ、空になったら "untitled" を返す。
 */
export function sanitizeObsidianFilename(name) {
  const cleaned = String(name ?? "")
    .replace(/[\\/:*?"<>|#^[\]]/g, "-")
    .replace(/\s+/g, " ")
    .trim();
  const safe = cleaned || "untitled";
  return safe.slice(0, 120);
}

function pad2(n) {
  return String(n).padStart(2, "0");
}

/** Capture作成日時からファイル名を作る（例: 2026-08-10-1530-brain-dump.md） */
export function captureFilename(capture) {
  const created = new Date(capture?.createdAt ?? Date.now());
  const stamp = Number.isNaN(created.getTime())
    ? "unknown-time"
    : `${created.getFullYear()}-${pad2(created.getMonth() + 1)}-${pad2(created.getDate())}-${pad2(
        created.getHours()
      )}${pad2(created.getMinutes())}`;
  return `${stamp}-brain-dump.md`;
}

export function dailyFilename(date) {
  return `${date}.md`;
}

export function skillFilename(skill) {
  return `${sanitizeObsidianFilename(skill?.name || skill?.id || "skill")}.md`;
}

export function automationFilename(candidate) {
  return `${sanitizeObsidianFilename(candidate?.title || candidate?.id || "automation-candidate")}.md`;
}

function yamlValue(value) {
  if (value === null || value === undefined) return "null";
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  // 簡易的なYAML文字列化。コロンや引用符を含む値もダブルクォートで包めば壊れない
  const text = String(value);
  return /[:#"'\n]/.test(text) ? JSON.stringify(text) : text;
}

function frontmatter(fields) {
  const lines = ["---"];
  for (const [key, value] of Object.entries(fields)) {
    if (value === undefined) continue;
    lines.push(`${key}: ${yamlValue(value)}`);
  }
  lines.push("---");
  return lines.join("\n");
}

/**
 * Brain Dump（Capture）+ AI提案を1つのnoteにまとめる。
 * spec例: Timebox/Captures/2026-08-10-1530-brain-dump.md
 */
export function buildCaptureMarkdown({ capture, analysis, dailyLinkPath }) {
  const fm = frontmatter({
    type: "capture",
    createdAt: capture.createdAt,
    source: "ai-brain-dump",
    status: capture.status,
  });

  const suggestions = analysis?.suggestions;
  const suggestedTasks = (suggestions?.tasks ?? []).map((t) => `- [ ] ${t.title}`).join("\n");

  const parts = [fm, "", "# Brain Dump", "", capture.text.trim(), ""];

  if (suggestions?.summary) {
    parts.push("## AI Summary", "", suggestions.summary, "");
  }
  if (suggestedTasks) {
    parts.push("## Suggested Tasks", "", suggestedTasks, "");
  }
  if (dailyLinkPath) {
    parts.push("## Links", "", `- [[${dailyLinkPath}]]`, "");
  }

  return parts.join("\n");
}

/**
 * その日のDaily Noteを組み立てる。
 * spec例: Timebox/Daily/2026-08-10.md
 */
export function buildDailyMarkdown({ date, blocks = [], tasks = [], executions = [] }) {
  const fm = frontmatter({ type: "daily-plan", date, storage: "obsidian" });

  const plan = blocks.length
    ? blocks.map((b) => `- ${b.start}-${b.end} ${b.title}`).join("\n")
    : "（まだ時間割を作成していません）";

  const taskList = tasks.length
    ? tasks.map((t) => `- [${t.done ? "x" : " "}] ${t.title}`).join("\n")
    : "（タスクがありません）";

  const dayExecutions = executions.filter((e) => e.date === date && e.actualMinutes != null);
  const executionList = dayExecutions.length
    ? dayExecutions.map((e) => `- ${e.taskTitle ?? e.taskId}: ${e.actualMinutes}分`).join("\n")
    : "（まだ実行記録がありません）";

  return [
    fm,
    "",
    "# Today",
    "",
    "## Plan",
    "",
    plan,
    "",
    "## Tasks",
    "",
    taskList,
    "",
    "## Execution",
    "",
    executionList,
    "",
    "## Notes",
    "",
    "",
  ].join("\n");
}

/**
 * Skill候補のnoteを組み立てる。
 * spec例: Timebox/Skills/fs-meeting-prep.md
 */
export function buildSkillMarkdown(skill) {
  const fm = frontmatter({ type: "skill", status: skill.status, confidence: skill.confidence });
  const steps = (skill.steps ?? []).map((step, i) => `${i + 1}. ${step}`).join("\n");

  return [
    fm,
    "",
    `# ${skill.name}`,
    "",
    "## Steps",
    "",
    steps || "（手順が未設定です）",
    "",
    "## Evidence",
    "",
    skill.description || "（根拠が未記入です）",
    "",
  ].join("\n");
}

/** Automation Candidateのnoteを組み立てる */
export function buildAutomationMarkdown(candidate) {
  const fm = frontmatter({
    type: "automation-candidate",
    candidateType: candidate.type,
    status: candidate.status,
    confidence: candidate.confidence,
  });

  return [
    fm,
    "",
    `# ${candidate.title}`,
    "",
    "## Reason",
    "",
    candidate.reason || "（理由が未記入です）",
    "",
    "## Evidence",
    "",
    candidate.evidence || "（根拠が未記入です）",
    "",
  ].join("\n");
}
