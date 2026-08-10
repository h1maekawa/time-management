# DAYLOOP — プロダクトロードマップ

> 全部書く。AIが整理。今日が決まる。

`h1maekawa/time-management` は DAYLOOP を独立Productとして開発する
リポジトリです。今後のDAYLOOP機能開発は、このリポジトリを
Source of Truthとします。（旧サービス名 `Timebox OS`。「Timebox」は現在、
DAYLOOP内で時間割へ配置する内部機能名として使用しています）

将来の本番URL: `https://timebox.maemichi.com/`
- `/` … Landing Page
- `/app` … DAYLOOPアプリ本体

---

## Phase 1 — Standalone（現在地・無料公開版）

ログイン不要・無料・データは端末のブラウザにのみ保存する。

| 機能 | 状態 |
| --- | --- |
| 複数行入力からのタスク登録 | ✅ |
| 仕分け（今日やる／予定に入れる／回答待ち／いつかやる／やらない） | ✅ |
| 所要時間・優先度・締切・仕事/生活・時間帯の編集 | ✅ |
| 時間割の自動生成（決定論的） | ✅ |
| 24時間タイムライン（現在時刻線・枠・空き時間・完了・固定） | ✅ |
| 手動での時刻固定／固定解除（PC: ドラッグ、モバイル: 時刻入力） | ✅ |
| 未完了の翌日への持ち越し（持ち越し回数の記録） | ✅ |
| localStorage への保存（再読み込みで復元、schema version付き） | ✅ |
| JSONバックアップ（保存・読み込み。ドメイン移行の手段） | ✅ |
| ICS書き出し（Googleカレンダーへインポート） | ✅ |
| 独立Landing Page + `/app` | ✅ |
| Cloudflare Pages単独Deploy対応 | ✅ |

### ファイル構成

```
index.html                        Landing Page
app/index.html                    DAYLOOP アプリ本体
assets/css/base.css                共通デザイントークン
assets/css/landing.css             Landing Page専用スタイル
assets/css/timebox.css             アプリのスタイル（.tb- 接頭辞）
assets/js/timebox-engine.js        時間割の計算（純粋関数・DOMに触らない）
assets/js/timebox-storage.js       端末への保存・JSONバックアップ
assets/js/timebox.js               描画とユーザー操作
tests/timebox-engine.test.js       エンジンのテスト（node --test）
tests/timebox-storage.test.js      保存層・インポート検証のテスト
```

### 時間割の並び順

1. 手動で固定されたタスク（指定時刻を必ず確保する）
2. 締切が近いタスク
3. 優先度が高いタスク
4. 持ち越し回数が多いタスク
5. 所要時間が長いタスク
6. カテゴリと時間帯が一致する枠を優先（配置先の選択で判断）

計算はすべて決定論的に行う。同じ入力なら毎回同じ時間割になることを
`tests/timebox-engine.test.js` で担保している。

### maemichi.com版からの移行

旧実装 `h1maekawa/maemichi.com` の `timebox.html` は、このリポジトリの
Deployが完了するまで削除しない。ユーザーが端末に貯めたデータは
Origin（ドメイン）が変わると自動では引き継がれないため、JSONバックアップの
書き出し・読み込みで移行する。

```
maemichi.com/timebox.html
  → 「バックアップを保存」で .json を書き出す
  → timebox.maemichi.com/app/ を開く
  → 「バックアップを読み込む」で同じ .json を読み込む
```

将来的には `maemichi.com/timebox.html` から `timebox.maemichi.com` へ
誘導するCTA・リダイレクトを追加する（今回は未実施）。

---

## Phase 2 — Google Login / Google Calendar / Cloud Storage

- Googleログイン（Cloudflare Pages Functions で OAuth）
- Cloudflare D1（`users` / `tasks` / `plans` / `calendar_events` / `task_history` / `subscriptions`）
- Googleカレンダーの読み込み → 会議・予約をBusy Blockとして表示
- 残った空き時間へタスクを自動配置し、確認のうえカレンダーへ反映
- 複数端末での同期（Cloud Storageへ差し替え可能なStorage Layer）
- プライバシーポリシー／利用規約／データ削除

### アーキテクチャ

```
Google Login
  ↓
Google Calendar Read
  ↓
既存予定取得
  ↓
Busy Block化
  ↓
空き時間計算
  ↓
Timebox Engine
  ↓
User Confirmation
  ↓
Google Calendar Write
```

### 安全ルール（最重要）

```
既存のGoogle予定     ＝ DAYLOOPから原則変更禁止
DAYLOOPが作った予定  ＝ 更新・削除できる
```

他者との会議・予約・外部イベント・既存予定をアプリ側が勝手に削除・移動しない。
Googleのリフレッシュトークンはブラウザへ保存せず、Pages Functions で暗号化して
D1に置く。

必要なSecrets（今回は未作成・未commit）: `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` / `TOKEN_ENCRYPTION_KEY`

---

## Phase 3 — Founderプラン

初期ユーザー限定の創業メンバー価格であり、将来の標準価格とは分ける。

| プラン | 価格 | 主な内容 |
| --- | --- | --- |
| 無料 | 0円 | タスク登録・仕分け・時間割・タイムライン・ローカル保存・JSONバックアップ・ICS出力 |
| Founder | 月額（予定） | Googleログイン・カレンダー直接同期・クラウド保存・複数端末・基本的なAI提案・価格の永久維持 |
| Standard（将来） | 月額（予定） | 履歴無制限・高度なAI分析・自動化ルール・複数カレンダー |

判定は `assets/js/timebox-engine.js` の `PLAN_FEATURES` / `hasFeature()` を通す。
未知のプラン名・壊れたプラン値は **free として扱う**。課金状態が壊れても
有料機能が誤って開放されない設計をPhase 1から維持している。

Stripe Checkout / Billing / Webhook / カスタマーポータルは今回未実装。
このロードマップにのみ計画として残す。

必要なSecrets（今回は未作成・未commit）: `STRIPE_SECRET_KEY` / `STRIPE_WEBHOOK_SECRET`

---

## Phase 4 — AIによる改善提案

蓄積するデータ: 予定所要時間 / 実際の所要時間 / 予定開始時刻 / 実際の開始時刻 /
完了・未完了 / 持ち越し回数 / 時刻変更回数 / 曜日 / 時間帯 / カテゴリ /
同じタスクの発生回数 / 提案の採用・拒否。

提案の例:

- 所要時間の補正（「商談準備」は予定30分に対し平均48分 → 初期値を50分にしますか？）
- 最適時間帯（資料作成は午前の完了率が高い → 午前へ優先配置しますか？）
- 繰り返し予定の検出（毎週月曜10:00から45分の繰り返しにしますか？）
- タスク分割（3回連続で持ち越し → 調査／構成／作成／確認へ分割しますか？）
- バッチ処理（分散しているメール返信を17:00からの30分へまとめますか？）
- 会議の前後準備の自動作成

### 安全設計

| レベル | 動作 |
| --- | --- |
| 1（初期値） | 提案のみ |
| 2 | 毎回確認してから実行 |
| 3 | 利用者が明示的に承認したルールだけ自動実行 |

AIが勝手にしてはいけないこと: 外部予定の削除・移動、締切の変更、タスクの完全削除、
自動化ルールの有効化、大量のカレンダー予定登録、有料プランへの変更。

---

## Phase 5 — Standardプラン

自動化ルール／高度な分析／複数カレンダー／履歴無制限。

---

## 開発と公開

```bash
npm install
npm run dev      # http://localhost:5173/ (Landing) と /app/ (アプリ)
npm test         # tests/*.test.js
npm run build    # dist/ へ出力（dist/index.html, dist/app/index.html）
```

Cloudflare Pages（Production branch: `main` / Build command: `npm run build` / 出力: `dist`）。
本番Custom Domainは `timebox.maemichi.com` を想定（Cloudflare PagesのCustom Domain設定で追加）。

```
feature/xxx ブランチ → Pull Request → CI（npm test / npm run build） → main へマージ → 本番公開
```

`main` へ直接コミットしない。
