# DAYLOOP — Supabase Setup

DAYLOOP Cloud（アカウント / ログイン / 複数端末同期）は Supabase (PostgreSQL + Auth) を
使って実装しています。このドキュメントは、機能を有効にするために必要な
Supabase Dashboard 側 / Cloudflare Pages 側の作業手順です。

Supabase を設定しなくても DAYLOOP 自体は壊れません。Guest / この端末への保存 / Obsidian は
そのまま使えます（§54 Build without secret）。

---

## 1. Supabase Project 作成

1. https://supabase.com でプロジェクトを作成する。
2. Database Region は利用者に近いリージョンを選ぶ（例: Tokyo (ap-northeast-1) があれば選択）。
3. Project の Settings → API から以下を控える。
   - Project URL → `VITE_SUPABASE_URL`
   - `anon` / `publishable` key → `VITE_SUPABASE_PUBLISHABLE_KEY`
     （legacy anon key構成のプロジェクトの場合は `VITE_SUPABASE_ANON_KEY` を使ってもよい）
   - `service_role` key → `SUPABASE_SERVICE_ROLE_KEY`（**Frontendへは絶対に渡さない**）

## 2. Database Migration の適用

`supabase/migrations/` にSQLを用意しています。

Supabase CLI がある場合:

```bash
supabase login
supabase link --project-ref <your-project-ref>
supabase db push
```

CLI が無い場合は、Supabase Dashboard → SQL Editor で
`supabase/migrations/20260811000001_init_schema.sql` →
`supabase/migrations/20260811000002_rls_policies.sql` の順に貼り付けて実行してください。

マイグレーションは追加のみ（additive）です。既存データを削除する文は含まれていません。

## 3. Auth（Email OTP）の有効化

1. Authentication → Providers → Email を有効化する。
2. 「Confirm email」関連の設定はOTP（6桁コード）フローを使うため、
   Magic Link ではなく **OTP** を利用する設定にする（Email OTP length: 6, expiry: 600秒程度を推奨）。
3. Authentication → Email Templates で、OTPコードを含むテンプレートを日本語向けに調整してよい。
4. Password によるサインアップ/サインインは使用しません（Primary LoginはEmail OTPのみ）。

## 4. Custom SMTP（本番）

本番環境ではSupabaseのデフォルトSMTP（低いレート制限・到達率）に依存しないでください。
Authentication → Settings → SMTP Settings から [Resend](https://resend.com/) 等のCustom SMTPを設定します。

- 送信元ドメインのSPF/DKIM/DMARCを設定する。
- SMTP Secret（APIキー等）はSupabase Dashboard側にのみ保存し、リポジトリへコミットしない。

## 5. Cloudflare Turnstile（CAPTCHA保護）

1. Cloudflare Dashboard → Turnstile でサイトキー/シークレットキーを発行する。
2. Supabase Dashboard → Authentication → Settings → Bot and Abuse Protection で
   Turnstile を有効化し、シークレットキーを設定する。
3. Frontend側は `VITE_TURNSTILE_SITE_KEY` にサイトキー（公開情報）を設定する。
4. シークレットキーはSupabase Dashboard側にのみ保存する（コード側にコミットしない）。

## 6. Row Level Security（RLS）

`20260811000002_rls_policies.sql` が全User-owned TableでRLSを有効化し、
`auth.uid() = user_id`（profilesのみ `auth.uid() = id`）を要求するポリシーを作成します。

`subscriptions` はSELECTポリシーのみで、INSERT/UPDATE/DELETEポリシーを意図的に作成していません。
将来、有料プランのWebhook等はservice_role（RLSをバイパスする）を持つtrusted serverからのみ
書き込む設計です。

## 7. 環境変数

`.env.example` を参照してください。

| 変数 | 用途 | 公開範囲 |
| --- | --- | --- |
| `VITE_SUPABASE_URL` | Supabase Project URL | Frontend（公開情報） |
| `VITE_SUPABASE_PUBLISHABLE_KEY` | Supabase publishable key | Frontend（公開情報） |
| `VITE_SUPABASE_ANON_KEY` | legacy anon key構成のfallback | Frontend（公開情報） |
| `VITE_TURNSTILE_SITE_KEY` | Turnstile site key | Frontend（公開情報） |
| `SUPABASE_URL` | Cloudflare Pages Functions用 | Server専用 |
| `SUPABASE_SERVICE_ROLE_KEY` | Account Delete等の管理操作用 | Server専用・絶対非公開 |

`VITE_` 接頭辞が付いた変数だけがViteのビルドでブラウザバンドルへ含まれます。
`SUPABASE_SERVICE_ROLE_KEY` に `VITE_` を付けないでください。

## 7b. DAYLOOP Mini / Web Push（§65-92）

`push_subscriptions` はSupabaseの通常のマイグレーション/RLSで完結しており、
端末の購読登録（Settings → 実行サポート → 「この端末の通知を有効にする」）は
ログイン中のSupabase Clientから直接書き込みます（追加のServer Endpointは不要）。

VAPID鍵を生成し、`VITE_PUSH_VAPID_PUBLIC_KEY` に公開鍵を設定してください。

```bash
npx web-push generate-vapid-keys
```

**残課題（このリポジトリには含まれていません）**: 「5分前」等、DAYLOOPを閉じている間に
実際にPushを送信するサーバー処理（VAPID秘密鍵でのペイロード署名・送信、および
それを決まった時刻に起動するスケジューラ）です。Cloudflare Pages Functions単体では
定期実行の仕組みを持たないため、Cloudflare Cron Triggers（`wrangler.toml`の`[triggers]`）
を使った別ワーカー、またはSupabase Edge Functions + `pg_cron`等の構成が必要です。
DAYLOOPを開いている間の通知（Task Start / 5分前 / 完了後Next / End）はNotification API
で完結しており、この残課題の影響を受けません。

## 8. Local Development

1. `cp .env.example .env` として値を埋める（`.env` は `.gitignore` 済み）。
2. `npm run dev` で起動する。
3. Supabase CLIでローカルスタックを使う場合は `supabase start`
   （`supabase/config.toml` を参照。ローカルURL/anon keyは `supabase status` で確認できる）。

## 9. Preview / Production（Cloudflare Pages）

Cloudflare Pages のプロジェクト設定 → Environment variables で、
Production / Preview それぞれに以下を設定してください。

- Frontend用（`VITE_` 接頭辞）: Build時の環境変数として設定する。
- Server用（`SUPABASE_URL` / `SUPABASE_SERVICE_ROLE_KEY`）: Pages Functions の環境変数（Secret）として設定する。
  Secretは値を暗号化して保存できるCloudflare Pagesの機能を使うこと。

## 10. 動作確認チェックリスト

- [ ] Migration適用後、Supabase Dashboard → Table Editor で12テーブルが存在する
- [ ] 各テーブルで RLS が Enabled になっている（Table Editor上の鍵アイコン）
- [ ] Email OTPでの新規登録・ログインができる
- [ ] 別ブラウザ（別User）でログインし、他Userのタスクが見えない・操作できないことを確認する（§41）
- [ ] `npm run build` 後、`dist/` に `SUPABASE_SERVICE_ROLE_KEY` の値が含まれていないことを確認する
