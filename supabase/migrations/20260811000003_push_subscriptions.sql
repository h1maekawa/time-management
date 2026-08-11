-- DAYLOOP Mini / Web Push — push_subscriptions（§75-77）。
--
-- Push endpoint/keysはUser所有Data。user_idで分離し、他Userのsubscriptionへは
-- 絶対にアクセスできないようにする（§76）。Server-side送信Secret(VAPID private key)は
-- ここには置かない（Cloudflare Pages Functionsのsecretとしてのみ扱う）。
--
-- 同じdeviceからの再購読で行が増え続けないよう、(user_id, device_id) を一意にし、
-- upsertで上書きする（§90 no-duplicate-subscription）。

create table if not exists public.push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  device_id text not null,
  endpoint text not null,
  p256dh text not null,
  auth_key text not null,
  enabled boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  last_used_at timestamptz,
  unique (user_id, device_id)
);

create index if not exists idx_push_subscriptions_user_id on public.push_subscriptions (user_id);

create trigger trg_push_subscriptions_touch
  before update on public.push_subscriptions
  for each row execute function public.daylock_touch_row();

alter table public.push_subscriptions enable row level security;

create policy "push_subscriptions_select_own" on public.push_subscriptions
  for select using (auth.uid() is not null and auth.uid() = user_id);

create policy "push_subscriptions_insert_own" on public.push_subscriptions
  for insert with check (auth.uid() is not null and auth.uid() = user_id);

create policy "push_subscriptions_update_own" on public.push_subscriptions
  for update using (auth.uid() is not null and auth.uid() = user_id)
  with check (auth.uid() is not null and auth.uid() = user_id);

create policy "push_subscriptions_delete_own" on public.push_subscriptions
  for delete using (auth.uid() is not null and auth.uid() = user_id);
