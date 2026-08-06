# Timebox OS

> 迷っているタスクを、実行する時間へ。

今日やることを書き出すと、優先順位と使える時間から1日の予定を自動で組み立てる
タイムボックス管理アプリです。タスクを登録するだけで終わらせず、
「何時から何分やるか」まで予定へ落とし込みます。

- 登録不要・無料
- データは利用者の端末（localStorage）にだけ保存し、サーバーへ送りません
- 作った時間割は .ics で書き出してGoogleカレンダーへ取り込めます

## 動かす

```bash
npm install
npm run dev
```

```bash
npm test        # tests/timebox-engine.test.js
npm run build   # dist/ へ出力
```

Node 22以上。ビルドはVite、出力は `dist/` です。
Cloudflare Pages へ置く場合は Build command `npm run build` / 出力ディレクトリ `dist`。

## ファイル構成

```
index.html                    画面
assets/css/base.css           土台（色・フォント・ヘッダー・フッター）
assets/css/timebox.css        アプリ本体のスタイル（.tb- 接頭辞）
assets/js/timebox-engine.js   時間割の計算（純粋関数・DOMに触らない）
assets/js/timebox-storage.js  端末への保存（localStorage）
assets/js/timebox.js          描画とユーザー操作
tests/timebox-engine.test.js  エンジンのテスト（node --test）
docs/TIMEBOX_OS_PRODUCT_ROADMAP.md  今後の計画
```

計算はすべて `timebox-engine.js` に純粋関数として隔離してあります。
DOMもlocalStorageも触らないので、`node --test` からそのまま検証できます。
時刻の計算をAIに任せていないため、同じ入力なら毎回同じ時間割になります。

## 時間割の並び順

1. 手動で固定されたタスク（指定した時刻を必ず確保する）
2. 締切が近いタスク
3. 優先度が高いタスク
4. 持ち越し回数が多いタスク
5. 所要時間が長いタスク
6. カテゴリ（仕事／生活）と時間帯が合う枠を優先

## まえみち版との関係

同じアプリを [maemichi.com](https://maemichi.com/) の中でも公開しています
（`h1maekawa/maemichi.com` の `timebox.html`）。
現時点で利用者へ出しているのはそちらで、このリポジトリは
`timebox.maemichi.com` などへ単体で切り出すための置き場です。

`assets/css/timebox.css` と `assets/js/timebox*.js`、`tests/` は両者で同じものを使います。
違うのは外側だけです。

| | maemichi.com版 | 単体版（このリポジトリ） |
| --- | --- | --- |
| 入口 | `timebox.html` | `index.html` |
| 土台のCSS | `assets/css/main.css`（サイト全体と共用） | `assets/css/base.css`（必要な分だけ） |
| ヘッダー / フッター | まえみちのナビ | Timebox OS のみ |

どちらかのアプリ側を直したら、もう一方へも同じ内容を反映してください。

## 今後

Googleカレンダーとの直接同期、クラウド保存、Founderプラン（月額100円）、
実績からのAI改善提案までの計画は
[docs/TIMEBOX_OS_PRODUCT_ROADMAP.md](docs/TIMEBOX_OS_PRODUCT_ROADMAP.md) にあります。
