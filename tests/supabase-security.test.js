import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "..");

const REQUIRED_TABLES = [
  "profiles",
  "user_preferences",
  "tasks",
  "day_plans",
  "captures",
  "ai_analyses",
  "executions",
  "skills",
  "automation_candidates",
  "devices",
  "integrations",
  "subscriptions",
];

function readMigrations() {
  const dir = path.join(root, "supabase", "migrations");
  const files = fs.readdirSync(dir).filter((f) => f.endsWith(".sql"));
  assert.ok(files.length >= 2, "migration SQLファイルが存在すること");
  return files.map((f) => fs.readFileSync(path.join(dir, f), "utf8")).join("\n");
}

function listSourceFiles(dir, exts = [".js"]) {
  const results = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === "node_modules" || entry.name === "dist") continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) results.push(...listSourceFiles(full, exts));
    else if (exts.some((ext) => entry.name.endsWith(ext))) results.push(full);
  }
  return results;
}

// ─── RLS migration existence（§52） ───────────────────────────

test("security: 全User-owned TableでRLSが有効化されている", () => {
  const sql = readMigrations();
  for (const table of REQUIRED_TABLES) {
    const pattern = new RegExp(`alter table public\\.${table} enable row level security`, "i");
    assert.match(sql, pattern, `${table} にRLSが設定されていること`);
  }
});

test("security: tasks等のUser-owned Tableは auth.uid() = user_id をSELECT/INSERT/UPDATE/DELETEすべてに要求する", () => {
  const sql = readMigrations();
  for (const table of ["tasks", "day_plans", "captures", "ai_analyses", "executions", "skills", "automation_candidates", "devices", "integrations", "user_preferences"]) {
    for (const op of ["select", "insert", "update", "delete"]) {
      const pattern = new RegExp(`create policy "${table}_${op}_own" on public\\.${table}`, "i");
      assert.match(sql, pattern, `${table} に ${op} 用ポリシーが存在すること`);
    }
  }
});

test("security: profilesは auth.uid() = id を条件にしている（emailではなくauth.users.idが正典）", () => {
  const sql = readMigrations();
  assert.match(sql, /create policy "profiles_select_own" on public\.profiles[\s\S]*?auth\.uid\(\) = id/);
});

test("security: subscriptionsはSELECTポリシーのみを持ち、INSERT/UPDATE/DELETEポリシーを作らない（§42）", () => {
  const sql = readMigrations();
  assert.match(sql, /create policy "subscriptions_select_own" on public\.subscriptions/);
  assert.doesNotMatch(sql, /create policy "subscriptions_insert_own"/);
  assert.doesNotMatch(sql, /create policy "subscriptions_update_own"/);
  assert.doesNotMatch(sql, /create policy "subscriptions_delete_own"/);
});

test("security: user_id列にRLS/Sync用のindexが張られている", () => {
  const sql = readMigrations();
  assert.match(sql, /create index if not exists idx_tasks_user_id on public\.tasks \(user_id\)/);
  assert.match(sql, /create index if not exists idx_tasks_user_updated_at on public\.tasks \(user_id, updated_at\)/);
  assert.match(sql, /create index if not exists idx_tasks_user_deleted_at on public\.tasks \(user_id, deleted_at\)/);
  assert.match(sql, /create index if not exists idx_tasks_user_planned_date on public\.tasks \(user_id, planned_date\)/);
});

// ─── no service role in frontend（§11/§52） ───────────────────

test("security: assets/js配下にSUPABASE_SERVICE_ROLE_KEYという実際の環境変数名への参照が無い（Frontendへ絶対に含めない）", () => {
  const files = listSourceFiles(path.join(root, "assets", "js"));
  for (const file of files) {
    const content = fs.readFileSync(file, "utf8");
    assert.doesNotMatch(
      content,
      /SUPABASE_SERVICE_ROLE_KEY/,
      `${path.relative(root, file)} にSUPABASE_SERVICE_ROLE_KEYの参照が無いこと`
    );
  }
});

test("security: SUPABASE_SERVICE_ROLE_KEYはfunctions/(Cloudflare Pages Functions)側だけで使われている", () => {
  const jsFiles = listSourceFiles(path.join(root, "assets", "js"));
  const usesInFrontend = jsFiles.some((f) => fs.readFileSync(f, "utf8").includes("SUPABASE_SERVICE_ROLE_KEY"));
  assert.equal(usesInFrontend, false);

  const deleteFn = fs.readFileSync(path.join(root, "functions", "api", "account", "delete.js"), "utf8");
  assert.match(deleteFn, /SUPABASE_SERVICE_ROLE_KEY/);
});

test("security: .env.exampleにVITE_接頭辞のClient向け変数のみ記載し、値は空である", () => {
  const envExample = fs.readFileSync(path.join(root, ".env.example"), "utf8");
  assert.match(envExample, /VITE_SUPABASE_URL=\s*$/m);
  assert.match(envExample, /VITE_SUPABASE_PUBLISHABLE_KEY=\s*$/m);
  assert.doesNotMatch(envExample, /VITE_SUPABASE_SERVICE_ROLE/);
});
