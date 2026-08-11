-- DAYLOOP Cloud — Row Level Security.
--
-- 原則: 全User-owned TableでRLSを有効化し、
--   auth.uid() IS NOT NULL AND auth.uid() = user_id (または profiles.id)
-- を満たす行だけを本人が読み書きできるようにする。
--
-- subscriptions は例外: Userは自分の行をSELECTのみ可能。
-- INSERT/UPDATE/DELETEはクライアントから禁止し、将来のBilling Webhook等
-- trusted server（service_role。RLSをバイパスする）だけが更新できるようにする。

-- ─────────────────────────────────────────────────────────────
-- profiles
-- ─────────────────────────────────────────────────────────────
alter table public.profiles enable row level security;

create policy "profiles_select_own" on public.profiles
  for select using (auth.uid() is not null and auth.uid() = id);

create policy "profiles_insert_own" on public.profiles
  for insert with check (auth.uid() is not null and auth.uid() = id);

create policy "profiles_update_own" on public.profiles
  for update using (auth.uid() is not null and auth.uid() = id)
  with check (auth.uid() is not null and auth.uid() = id);

create policy "profiles_delete_own" on public.profiles
  for delete using (auth.uid() is not null and auth.uid() = id);

-- ─────────────────────────────────────────────────────────────
-- user_preferences
-- ─────────────────────────────────────────────────────────────
alter table public.user_preferences enable row level security;

create policy "user_preferences_select_own" on public.user_preferences
  for select using (auth.uid() is not null and auth.uid() = user_id);

create policy "user_preferences_insert_own" on public.user_preferences
  for insert with check (auth.uid() is not null and auth.uid() = user_id);

create policy "user_preferences_update_own" on public.user_preferences
  for update using (auth.uid() is not null and auth.uid() = user_id)
  with check (auth.uid() is not null and auth.uid() = user_id);

create policy "user_preferences_delete_own" on public.user_preferences
  for delete using (auth.uid() is not null and auth.uid() = user_id);

-- ─────────────────────────────────────────────────────────────
-- tasks
-- ─────────────────────────────────────────────────────────────
alter table public.tasks enable row level security;

create policy "tasks_select_own" on public.tasks
  for select using (auth.uid() is not null and auth.uid() = user_id);

create policy "tasks_insert_own" on public.tasks
  for insert with check (auth.uid() is not null and auth.uid() = user_id);

create policy "tasks_update_own" on public.tasks
  for update using (auth.uid() is not null and auth.uid() = user_id)
  with check (auth.uid() is not null and auth.uid() = user_id);

create policy "tasks_delete_own" on public.tasks
  for delete using (auth.uid() is not null and auth.uid() = user_id);

-- ─────────────────────────────────────────────────────────────
-- day_plans
-- ─────────────────────────────────────────────────────────────
alter table public.day_plans enable row level security;

create policy "day_plans_select_own" on public.day_plans
  for select using (auth.uid() is not null and auth.uid() = user_id);

create policy "day_plans_insert_own" on public.day_plans
  for insert with check (auth.uid() is not null and auth.uid() = user_id);

create policy "day_plans_update_own" on public.day_plans
  for update using (auth.uid() is not null and auth.uid() = user_id)
  with check (auth.uid() is not null and auth.uid() = user_id);

create policy "day_plans_delete_own" on public.day_plans
  for delete using (auth.uid() is not null and auth.uid() = user_id);

-- ─────────────────────────────────────────────────────────────
-- captures
-- ─────────────────────────────────────────────────────────────
alter table public.captures enable row level security;

create policy "captures_select_own" on public.captures
  for select using (auth.uid() is not null and auth.uid() = user_id);

create policy "captures_insert_own" on public.captures
  for insert with check (auth.uid() is not null and auth.uid() = user_id);

create policy "captures_update_own" on public.captures
  for update using (auth.uid() is not null and auth.uid() = user_id)
  with check (auth.uid() is not null and auth.uid() = user_id);

create policy "captures_delete_own" on public.captures
  for delete using (auth.uid() is not null and auth.uid() = user_id);

-- ─────────────────────────────────────────────────────────────
-- ai_analyses
-- ─────────────────────────────────────────────────────────────
alter table public.ai_analyses enable row level security;

create policy "ai_analyses_select_own" on public.ai_analyses
  for select using (auth.uid() is not null and auth.uid() = user_id);

create policy "ai_analyses_insert_own" on public.ai_analyses
  for insert with check (auth.uid() is not null and auth.uid() = user_id);

create policy "ai_analyses_update_own" on public.ai_analyses
  for update using (auth.uid() is not null and auth.uid() = user_id)
  with check (auth.uid() is not null and auth.uid() = user_id);

create policy "ai_analyses_delete_own" on public.ai_analyses
  for delete using (auth.uid() is not null and auth.uid() = user_id);

-- ─────────────────────────────────────────────────────────────
-- executions
-- ─────────────────────────────────────────────────────────────
alter table public.executions enable row level security;

create policy "executions_select_own" on public.executions
  for select using (auth.uid() is not null and auth.uid() = user_id);

create policy "executions_insert_own" on public.executions
  for insert with check (auth.uid() is not null and auth.uid() = user_id);

create policy "executions_update_own" on public.executions
  for update using (auth.uid() is not null and auth.uid() = user_id)
  with check (auth.uid() is not null and auth.uid() = user_id);

create policy "executions_delete_own" on public.executions
  for delete using (auth.uid() is not null and auth.uid() = user_id);

-- ─────────────────────────────────────────────────────────────
-- skills
-- ─────────────────────────────────────────────────────────────
alter table public.skills enable row level security;

create policy "skills_select_own" on public.skills
  for select using (auth.uid() is not null and auth.uid() = user_id);

create policy "skills_insert_own" on public.skills
  for insert with check (auth.uid() is not null and auth.uid() = user_id);

create policy "skills_update_own" on public.skills
  for update using (auth.uid() is not null and auth.uid() = user_id)
  with check (auth.uid() is not null and auth.uid() = user_id);

create policy "skills_delete_own" on public.skills
  for delete using (auth.uid() is not null and auth.uid() = user_id);

-- ─────────────────────────────────────────────────────────────
-- automation_candidates
-- ─────────────────────────────────────────────────────────────
alter table public.automation_candidates enable row level security;

create policy "automation_candidates_select_own" on public.automation_candidates
  for select using (auth.uid() is not null and auth.uid() = user_id);

create policy "automation_candidates_insert_own" on public.automation_candidates
  for insert with check (auth.uid() is not null and auth.uid() = user_id);

create policy "automation_candidates_update_own" on public.automation_candidates
  for update using (auth.uid() is not null and auth.uid() = user_id)
  with check (auth.uid() is not null and auth.uid() = user_id);

create policy "automation_candidates_delete_own" on public.automation_candidates
  for delete using (auth.uid() is not null and auth.uid() = user_id);

-- ─────────────────────────────────────────────────────────────
-- devices
-- ─────────────────────────────────────────────────────────────
alter table public.devices enable row level security;

create policy "devices_select_own" on public.devices
  for select using (auth.uid() is not null and auth.uid() = user_id);

create policy "devices_insert_own" on public.devices
  for insert with check (auth.uid() is not null and auth.uid() = user_id);

create policy "devices_update_own" on public.devices
  for update using (auth.uid() is not null and auth.uid() = user_id)
  with check (auth.uid() is not null and auth.uid() = user_id);

create policy "devices_delete_own" on public.devices
  for delete using (auth.uid() is not null and auth.uid() = user_id);

-- ─────────────────────────────────────────────────────────────
-- integrations
-- ─────────────────────────────────────────────────────────────
alter table public.integrations enable row level security;

create policy "integrations_select_own" on public.integrations
  for select using (auth.uid() is not null and auth.uid() = user_id);

create policy "integrations_insert_own" on public.integrations
  for insert with check (auth.uid() is not null and auth.uid() = user_id);

create policy "integrations_update_own" on public.integrations
  for update using (auth.uid() is not null and auth.uid() = user_id)
  with check (auth.uid() is not null and auth.uid() = user_id);

create policy "integrations_delete_own" on public.integrations
  for delete using (auth.uid() is not null and auth.uid() = user_id);

-- ─────────────────────────────────────────────────────────────
-- subscriptions — SELECTのみ許可。書き込みはservice_role(trusted server)専用。
-- ─────────────────────────────────────────────────────────────
alter table public.subscriptions enable row level security;

create policy "subscriptions_select_own" on public.subscriptions
  for select using (auth.uid() is not null and auth.uid() = user_id);

-- INSERT/UPDATE/DELETEポリシーは意図的に作成しない。
-- RLSが有効な状態でポリシーが無い操作はデフォルトで拒否されるため、
-- authenticated/anonロールからの書き込みは常に拒否される。
-- service_role はRLSを自動的にバイパスするため、Cloudflare Pages Functions等の
-- trusted serverからのみ書き込み可能。
