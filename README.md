# DAYLOOP

> 全部書く。AIが整理。今日が決まる。

やることを頭の中のまま書くだけ。AIが整理して優先順位を決め、
今日の時間割までつくる **1日設計アプリ** です。

Todoリストを増やすアプリではなく、「今日、何を、いつやるか」まで決めます。
時間割（Timebox）へタスクを落とし込む機能はDAYLOOP内部の1機能として残っており、
その計算エンジンは `timebox-engine.js` という名前のまま提供しています
（旧サービス名 `Timebox OS` → 現在は `DAYLOOP` 内の「Timebox」機能）。

- 登録不要・無料
- AIを使わなくても利用可能（Brain Dumpの行ごとの候補化にフォールバック）
- データは利用者の端末（ブラウザの `localStorage`）にだけ保存し、サーバーへは送りません
- Obsidian（Vault内Markdown）保存にも対応
- 作った時間割は `.ics` で書き出してGoogleカレンダーへ取り込めます

このリポジトリ（`h1maekawa/time-management`）は DAYLOOP を独立Productとして
開発するための場所です。今後のDAYLOOP機能開発は、ここを Source of Truth とします。

## Product Concept

| 項目 | 内容 |
| --- | --- |
| Product名 | DAYLOOP |
| Primary Catch Copy | 全部書く。AIが整理。今日が決まる。 |
| サービス説明 | やることを頭の中のまま書くだけ。AIが整理して、優先順位を決め、今日の時間割までつくる1日設計アプリ。 |
| Product Category | AI Daily Planning App（AI 1日設計アプリ）。Todo / Task Manager / Calendarだけでは説明しない |
| 内部機能名 | Brain Dump / AI Organize / Timebox / Focus / History / Memory / Skills |
| 主ブランド | DAYLOOP（`maemichi` は `by maemichi` 程度のSecondary Branding） |
| 将来URL | `https://timebox.maemichi.com/`（Custom Domain設定はリポジトリ変更なしで切替可能） |

## Current Features

- Brain Dump入力（AIが整理 / Backend未設定時は行ごとに候補化してフォールバック）
- 複数行タスク登録 / 仕事・生活分類 / 優先順位 / 所要時間 / 締切
- タスク仕分け（今日やる・予定に入れる・回答待ち・いつかやる・やらない）
- 自動時間割生成（決定論的なスケジューリング） / 24時間タイムライン
- Drag & Drop（PC） / 手動時間固定・固定解除（モバイルは時刻入力欄から） / 今から詰め直す
- 翌日持ち越し / localStorage保存 / Obsidian保存 / JSONバックアップ（保存・読み込み） / ICS書き出し
- 実行履歴・Skill候補の土台

Googleカレンダーとの**直接同期はまだ実装していません**（Phase 2で設計のみ準備、下記参照）。

## URL構成

| パス | 内容 |
| --- | --- |
| `/` | Landing Page（DAYLOOP Product Story） |
| `/app` `/app/` | DAYLOOPアプリ本体 |

## Local Development

```bash
npm install
npm run dev
```

- Landing: http://localhost:5173/
- App: http://localhost:5173/app/

Node 20以上を推奨（開発・CIともにNode 22で動作確認済み）。

## Tests

```bash
npm test
```

`node --test` で `tests/timebox-engine.test.js`（スケジューリングエンジン）、
`tests/timebox-storage.test.js`（保存層・JSONインポートの検証）、
`tests/storage-providers.test.js`（Storage Provider）、
`tests/ai-lib.test.js`（AI Brain Dump解析ロジック）を実行します。

## Build

```bash
npm run build
```

Viteでビルドし、`dist/` に以下を出力します。

```
dist/index.html         Landing Page
dist/app/index.html     DAYLOOPアプリ本体
dist/assets/...         CSS / JS（ハッシュ付き）
dist/images/dayloop/    ロゴ・OGP等の画像（public/ をそのままコピー）
dist/favicon.png        ファビコン
dist/apple-touch-icon.png
dist/_redirects         /app → /app/ の301リダイレクト（Cloudflare Pages用）
```

## Directory

```
index.html                     Landing Page（DAYLOOP Product Story LP）
app/index.html                 DAYLOOPアプリ本体
assets/css/base.css            共通デザイントークン（DAYLOOP Brand Color・フォント・リセット）
assets/css/landing.css         Landing Page専用スタイル
assets/css/timebox.css         アプリ本体のスタイル（.tb- 接頭辞、内部機能名Timebox由来）
assets/js/timebox-engine.js    時間割の計算（純粋関数・DOMに触らない）
assets/js/timebox-storage.js   端末への保存・JSONエクスポート/インポート
assets/js/timebox.js           描画とユーザー操作
assets/js/storage-providers/   Local / Obsidian / Google Sheets(GAS) / Google Drive の保存先実装
assets/brand-source/           ロゴの元データ（高解像度PNG）。デプロイ対象外
tests/timebox-engine.test.js   エンジンのテスト
tests/timebox-storage.test.js  保存層のテスト
tests/storage-providers.test.js Storage Providerのテスト
tests/ai-lib.test.js           AI Brain Dump解析ロジックのテスト
public/_redirects              Cloudflare Pagesのルーティング設定
public/images/dayloop/brand/   正式ロゴPNG（明るい面用 / 暗い面用 / マーク単体）
public/favicon.png             ファビコン（DAYLOOP Symbol Mark）
public/apple-touch-icon.png    iOSホーム画面アイコン（白地180px）
docs/PRODUCT_ROADMAP.md        プロダクトロードマップ（Phase 1〜5）
vite.config.js                 マルチページビルド設定（index.html / app/index.html）
```

計算はすべて `timebox-engine.js` に純粋関数として隔離してあります。DOMも
localStorageも触らないので `node --test` からそのまま検証でき、時刻計算を
AIに任せていないため同じ入力なら毎回同じ時間割になります（deterministic scheduling）。
AIが担当するのはBrain Dumpの整理（タスク化・優先度候補・所要時間候補）だけで、
「いつ・何分やるか」を最終的に決めるのは常にこの決定論的エンジンです
（LP上の「提案するのはAI。決めるのはあなた。」はこの設計を指しています）。

## Storage / Branding互換性ポリシー（重要）

ブランドを `Timebox OS` → `DAYLOOP` へ変更するにあたり、**表示名だけを変更し、
内部の保存互換性は一切変更していません**。既存ユーザーのデータを壊さないためです。

| 項目 | 状態 |
| --- | --- |
| `localStorage` key（`timebox-os/v1`） | 変更なし |
| Storage schema version / JSON Backup schema | 変更なし |
| Obsidian保存先フォルダ（`Timebox/`, `Timebox/Captures` など） | 変更なし |
| Obsidian Vault Directory PickerのID（`timebox-os-vault`） | 変更なし |
| IndexedDBのハンドル保存名（`timebox-os-obsidian`） | 変更なし |
| Task schema / API route（`/api/ai/analyze-brain-dump`） | 変更なし |

変更したのはUI上の表示文言（タイトル・見出し・ボタン・エラーメッセージ・ICSの
`PRODID`など）のみです。将来的にストレージパスやキーを `dayloop/...` へ移行する
場合は、既存データを引き継ぐMigration戦略を別途設計してから行います（今回は未実施）。

## JSON Export / Import

`timebox.maemichi.com` のように将来ドメインが変わると、`localStorage` は
Originごとに分離されるため自動では引き継がれません。そのためJSONバックアップの
書き出し・読み込みを移行手段として用意しています。

- **書き出し**: 「データの扱い」カードの「バックアップを保存」で、現在の状態を
  `timebox-backup-YYYY-MM-DD.json` として保存します。
- **読み込み**: 「バックアップを読み込む」でファイルを選ぶと、JSONの構文・
  バージョン・スキーマを検証したうえで、上書き前に確認ダイアログを出します。
  検証に失敗した場合は既存の保存データを一切変更しません（安全な失敗）。

## ICS

「カレンダーへ入れる」カードの「Googleカレンダーへ追加（.ics）」から、その日の
時間割を `.ics` として書き出せます。`UID` / `DTSTAMP` / `DTSTART` / `DTEND` /
`SUMMARY` / `DESCRIPTION` を含み、Googleカレンダーの「他のカレンダーを追加 →
インポート」からそのまま取り込めます。タイムゾーンを付けないフローティング時刻
で書き出すため、取り込み先の時刻がそのまま反映されます。

Googleカレンダーとの**直接同期**は準備中です（下記Phase 2参照）。UI上でも
「今すぐ使える」ICS書き出しと「近日」の直接同期を明確に区別しています。

## Privacy

Phase 1では、ユーザーデータは利用者の端末のブラウザ内（またはユーザーが選んだ
Obsidian Vault）にのみ保存されます。サーバーへは何も送信しません
（AI整理を使う場合、Brain Dumpのテキストのみ解析目的でAPIへ送信されます）。
Landing Pageでも「登録不要・無料・データは自分の場所へ」と明記しており、
まだ実装していないクラウド保存・Google直接同期が動いているような表現は
していません。

## Cloudflare Pages

このリポジトリ単独でDeployできます。

- Production branch: `main`
- Build command: `npm run build`
- Build output directory: `dist`
- Node: `.node-version`（22）

`@supabase/supabase-js` が `engines: node >= 22` を要求するため、Nodeのバージョンを
リポジトリ側で固定してCI（`node-version: 22`）と揃えている。

> **未解決**: Cloudflare Pagesのビルドは #5（Supabase導入）以降失敗しており、
> 本番は #4 のデプロイのまま止まっている。`.node-version` を置いても解消しなかった。
> ビルドシステムv1のプロジェクトは `.node-version` を読まないため、ダッシュボードで
> 環境変数 `NODE_VERSION=22` を設定するか、ビルドシステムをv2へ上げる必要があるかもしれない。
> ローカルとGitHub Actions（Node 22）では `npm ci && npm run build` が通るため、
> Pages側のログを見ないと切り分けられない。

`public/_redirects` により `/app`（末尾スラッシュなし）へのアクセスも
`/app/` へ301リダイレクトされ、`dist/app/index.html` が表示されます。

## Custom Domain

Cloudflare Pagesのダッシュボードから、このProjectの Custom Domains に
`timebox.maemichi.com` を追加してください（DNSは `maemichi.com` 側のZoneで
CNAMEをCloudflare Pagesへ向ける想定）。コード内には `*.pages.dev` の
プレビューURLをハードコードしていないため、Custom Domain設定だけで
本番URLへ切り替えられます。

## Google Calendar Roadmap（Phase 2・未実装）

今回、Google Calendar APIによる直接同期は実装していません。次のアーキテクチャを
設計のみ用意しています（詳細は [docs/PRODUCT_ROADMAP.md](docs/PRODUCT_ROADMAP.md)）。

```
Google Login → Google Calendar Read → 既存予定取得 → Busy Block化
  → 空き時間計算 → Timebox Engine → User Confirmation → Google Calendar Write
```

安全ルール: **既存のGoogle予定はDAYLOOPから原則変更しない**。DAYLOOPが
作った予定だけを更新・削除できるようにする。

## Future Cloud Architecture

Phase 2以降で想定する構成（今回は未実装）。

- Cloudflare Pages / Pages Functions（OAuthコールバックなど）
- Cloudflare D1（`users` / `tasks` / `plans` / `calendar_events` / `task_history` / `subscriptions`）
- Google OAuth（Secrets: `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` / `TOKEN_ENCRYPTION_KEY`）

`assets/js/timebox-storage.js` は `load` / `save` / `patch` の3つの入口に
保存処理を絞っているため、将来この内部実装をCloud Storage呼び出しへ差し替えても
呼び出し側（`timebox.js`）を変えずに済む設計です。

## Monetization（Phase 3〜、未実装）

`assets/js/timebox-engine.js` の `PLAN_FEATURES` / `hasFeature()` で
プラン（`free` / `founder` / `standard`）ごとの機能可否を判定します。
**未知のプラン名や壊れたプラン値は `free` として扱う**ため、課金状態が
壊れても有料機能が誤って開放されません。Stripe決済自体は今回未実装です。

## Product Roadmap

Phase 1（Standalone）〜 Phase 5（Standardプラン）までの計画は
[docs/PRODUCT_ROADMAP.md](docs/PRODUCT_ROADMAP.md) にまとめています。

## maemichi.com版からの移行

旧実装 `h1maekawa/maemichi.com` の `timebox.html` は、このリポジトリの
Deployが完了するまで削除しません（今回SOURCE側への変更は一切行っていません）。
ユーザーは「バックアップを保存」→「バックアップを読み込む」でデータを
このアプリへ持ち込めます。詳細は
[docs/PRODUCT_ROADMAP.md](docs/PRODUCT_ROADMAP.md) を参照してください。
