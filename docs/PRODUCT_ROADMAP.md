# Timebox OS — プロダクトロードマップ

> 迷っているタスクを、実行する時間へ。

タイムボックス管理アプリの単体リポジトリ。
現時点で利用者へ出しているのは `https://maemichi.com/timebox.html`（`h1maekawa/maemichi.com`）で、
こちらは `https://timebox.maemichi.com` などへ切り出すための置き場。
アプリ側のコード（`assets/css/timebox.css` / `assets/js/timebox*.js` / `tests/`）は両者で同じもの。

---

## 1. 現在地（Phase 1 / 無料公開版）

実装済み。ログイン不要・無料・データは端末のブラウザにのみ保存する。

| 機能 | 状態 |
| --- | --- |
| 複数行入力からのタスク登録 | ✅ |
| 仕分け（今日やる／予定に入れる／回答待ち／いつかやる／やらない） | ✅ |
| 所要時間・優先度・締切・仕事/生活・時間帯の編集 | ✅ |
| 時間割の自動生成（決定論的） | ✅ |
| 24時間タイムライン（現在時刻線・枠・空き時間・完了・固定） | ✅ |
| 手動での時刻固定／固定解除（ドラッグ＋時刻入力） | ✅ |
| 未完了の翌日への持ち越し（持ち越し回数の記録） | ✅ |
| localStorage への保存（再読み込みで復元） | ✅ |
| ICS書き出し（Googleカレンダーへインポート） | ✅ |

### ファイル構成

```
index.html                       画面
assets/css/base.css              土台（色・フォント・ヘッダー・フッター）
assets/css/timebox.css           アプリ本体のスタイル（.tb- 接頭辞）
assets/js/timebox-engine.js      時間割の計算（純粋関数・DOMに触らない）
assets/js/timebox-storage.js     端末への保存
assets/js/timebox.js             描画とユーザー操作
tests/timebox-engine.test.js     エンジンのテスト（node --test）
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

---

## 2. Phase 2 — ユーザー基盤

- Googleログイン（Cloudflare Pages Functions で OAuth）
- D1（users / tasks / plans / calendar_events / task_history / subscriptions）
- Googleカレンダーの読み込み → 会議・予約を固定時間として表示
- 残った空き時間へタスクを自動配置し、確認のうえカレンダーへ反映
- 複数端末での同期
- プライバシーポリシー／利用規約／データ削除

### 守るルール

```
既存のGoogle予定       ＝ 原則として変更しない
Timebox OSが作った予定 ＝ 移動・更新・削除できる
```

他者との会議や外部予約をアプリ側が勝手に動かさない。
Googleのリフレッシュトークンはブラウザへ保存せず、Pages Functions で暗号化して D1 に置く。

必要なSecrets: `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` / `TOKEN_ENCRYPTION_KEY`

---

## 3. Phase 3 — Founderプラン（月額100円）

初期ユーザー限定の創業メンバー価格であり、将来の標準価格とは分ける。

| プラン | 価格 | 主な内容 |
| --- | --- | --- |
| 無料 | 0円 | タスク登録・仕分け・時間割・タイムライン・ローカル保存・ICS出力・直近7日の履歴 |
| Founder | 100円/月 | Googleログイン・カレンダー直接同期・クラウド保存・複数端末・90日履歴・基本的なAI提案・繰り返しルール・価格の永久維持 |
| Standard（将来） | 300〜500円/月 | 履歴無制限・高度なAI分析・自動化ルール・週次レポート・複数カレンダー |

- Stripe Checkout / Billing / Webhook / カスタマーポータル
- 100円は収益の中心ではなく、継続率と「有料でも使いたい人がいるか」を測るための価格
- 無料版に課金モーダルを頻繁に出さない。有料機能を選んだときだけ違いを説明する

判定は `assets/js/timebox-engine.js` の `PLAN_FEATURES` / `hasFeature()` を通す。
未知のプラン名は無料扱いになるため、課金状態が壊れても機能が漏れない。

必要なSecrets: `STRIPE_SECRET_KEY` / `STRIPE_WEBHOOK_SECRET`

---

## 4. Phase 4 — AIによる改善提案

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

## 5. Phase 5 — Standardプラン

自動化ルール／高度な分析／複数カレンダー／履歴無制限（月額300〜500円）。

---

## 6. 開発と公開

```bash
npm install
npm run dev      # http://localhost:5173/
npm test         # tests/timebox-engine.test.js
npm run build    # dist/ へ出力
```

Cloudflare Pages へ置く場合は Production branch `main` / Build command `npm run build` / 出力 `dist`。

```
agent/xxx ブランチ → Preview Deployment → 動作確認 → Pull Request → main へマージ → 本番公開
```

`main` へ直接コミットしない。

アプリ側を直したときは、まえみち版（`h1maekawa/maemichi.com` の `timebox.html`）にも
同じ内容を反映すること。
