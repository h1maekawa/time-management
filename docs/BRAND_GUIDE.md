# DAYLOOP Brand Guide

DAYLOOPのブランド・LP・SNSビジュアルを統一するためのリファレンス。
LP・note・Xすべてで、下記のコアメッセージを変えないこと。

## Critical Copy（変更しない）

```
時間がない。
だから、考える時間を減らす。

全部書く。
AIが整理。
今日が決まる。

考える時間を減らして、やる時間を増やす。
```

## Brand Core

- サービス名: DAYLOOP
- ポジショニング: 「時間がない人のためのAI 1日実行アプリ」（Todoアプリ／Calendarアプリではない）
- Product Story: Brain Dump → AI Organize → Timebox → Focus → Re-plan → Memory → Learn → Skill → Next Day

## Color System

`assets/css/base.css` の `:root` が正。

| Token | 値 | 用途 |
| --- | --- | --- |
| `--dl-blue` | `#3D5AFE` | 落ち着いた青。メイングラデーションの起点 |
| `--dl-violet` / `--dl-teal` | `#14B8A6` | 青緑（Teal）。メイングラデーションの終点 |
| `--dl-violet-soft` / `--dl-mint` | `#6EE7B7` | ミントグリーン。ハイライト・見出しグラデーション終点 |
| `--dl-indigo` | `#241259` | Deep Indigo |
| `--dl-navy` | `#0F2A4A` | Navy。ロゴ背景など |
| `--bg-color` / `--surface-color` | `#EEEBFC` / `#ffffff` | 白基調の面 |

メイングラデーション: `linear-gradient(120deg, var(--dl-blue), var(--dl-violet))`（Blue → Green）。
`--dl-violet` / `--dl-violet-soft` という変数名は既存コードとの互換のため残しているが、
値は青緑・ミントグリーンに更新済み。新規コードでは `--dl-teal` / `--dl-mint` を使うこと。

## Logo — Loop + Clock + Flow

正式ロゴ（PNG・透過）。`public/images/dayloop/brand/`:

| File | 用途 | 置ける背景 |
| --- | --- | --- |
| `dayloop-wordmark.png` | アイコン＋ワードマーク。文字は濃紺 | 白・ラベンダー等の**明るい面**（/app のアプリバー） |
| `dayloop-wordmark-dark.png` | 同上。文字を `#F5F2FF` に置換 | **暗い面**（LPヘッダー） |
| `dayloop-mark.png` | シンボルマーク単体（256px）。針は濃紺 | 明るい面・favicon |
| `dayloop-mark-dark.png` | 同上。針を明色に置換 | 暗い面（LPフッター） |
| `dayloop-mark-glow.png` | グロー付きマーク（512px） | 暗い面のみ（LPヒーロー） |

ファビコン類は `public/favicon.png`（64px）と `public/apple-touch-icon.png`（180px・白地）。

元データ（高解像度）は `assets/brand-source/` に置いてある。`assets/` はViteのpublicコピー対象外なので
デプロイには含まれない。トリミング済みPNGを作り直すときはここから再生成する。

- `dayloop-wordmark-original.png` — アイコン＋ワードマーク（1254×1254、余白多め）
- `dayloop-mark-glow-original.png` — グロー付きマーク（1536×1024）

**暗い面用（`-dark`）は、元PNGのうち `max(R,G,B) < 140` の画素（＝濃紺の文字と時計の針）だけを
`#F5F2FF` へ置換して生成している。** グラデーションのマーク部分は明るいため影響を受けない。

意匠: 円環（Loop、開いた円弧＝Flow/継続）の内部に時計の針（Clock）、
右上に小さなDot。Gradient: Blue(`#3D5AFE`) → Teal(`#14B8A6`) → Mint。

> 旧プレースホルダ `dayloop-logo-*.svg`（4ファイル）と `public/favicon.svg` は、この正式ロゴへの
> 差し替えにより未使用。参照箇所は残っていないため、不要になれば削除してよい。

## Dot Pattern

`assets/css/landing.css` の `.lp-dot-pattern`。Blue / Teal / Mint の淡いドットグリッドを
中心から外側へマスクでフェードさせたもの。Corner / Edge にだけ使い、全面には敷かない。
note/Xテンプレート側は各HTMLファイル内に同じ考え方のCSSをインラインで持たせている
（単体で開いてスクリーンショットするための独立アセットのため、共通CSSを読み込まない）。

## Reusable Image Templates

すべて `public/images/dayloop/` 配下にHTML実体として保存。ロゴは相対パスで
`../brand/dayloop-wordmark.png`（正式ロゴ）を読むので、**ロゴを差し替えたらここも作り直す**。

| Template | Path | Size |
| --- | --- | --- |
| OGP | `ogp/dayloop-ogp-template.html` | 1200×630 |
| note Cover | `note/dayloop-note-cover-template.html?title=...` | 1280×720 (16:9) |
| X Post（Landscape/Square） | `x/dayloop-x-post-template.html?variant=landscape\|square&main=...&sub=...` | 1200×675 / 1080×1080 |

`main` は `\n` で改行、`<span class="accent">…</span>` でグラデーション強調ができる（innerHTMLで流し込む）。

### 書き出し方（2026-08-13に確立）

`npm run dev` でテンプレートを配信し、headless Chrome を **2倍解像度**で撮って
目標サイズへLANCZOS縮小する。等倍スクリーンショットより文字とロゴのエッジが滑らかになる。

```
"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" \
  --headless --disable-gpu --hide-scrollbars \
  --force-device-scale-factor=2 --virtual-time-budget=6000 \
  --window-size=1200,630 --screenshot=out.png \
  "http://localhost:5173/images/dayloop/ogp/dayloop-ogp-template.html"
```

手でスクリーンショットを撮るとマウスカーソルが写り込み、サイズも端末依存になるため使わない。

生成済みの実画像（差し替えサンプル）:

| File | 内容 |
| --- | --- |
| `ogp/dayloop-ogp.png` | 既定の見出し |
| `note/dayloop-note-cover-example1.jpg` | 既定（「時間がない。だから、考える時間を減らす。」） |
| `x/dayloop-x-concept-landscape.jpg` / `-square.jpg` | 同上コピーの Landscape / Square |
| `x/dayloop-x-carousel-1-problem.jpg` | 「時間がない。／やることは多い。／何からやるかを毎回考えている。」 |
| `x/dayloop-x-carousel-2-dayloop.jpg` | 「全部書く。／`AIが整理。`(accent)」 |
| `x/dayloop-x-carousel-3-result.jpg` | 「`今日が決まる。`(accent)」＋ sub「09:00 商談準備 → 10:00 資料作成」 |

書き出しはPNG/JPEG。`cwebp`等が使える環境になれば `.webp` へ差し替えて構わない。

## Image Generation Prompt Library

外部AI画像生成（Midjourney / DALL-E / Stable Diffusion等）でイラストを作る場合のテンプレート。

### DAYLOOP Concept Image

```
Brand: DAYLOOP
Concept: 時間がない。だから、考える時間を減らす。
Visual: busy person, floating tasks, brain dump, AI organize, daily schedule
Style: friendly editorial illustration, calm blue and green palette, white background,
       soft dot patterns, rounded UI, clean modern SaaS product branding
Mood: calm, trustworthy, friendly, focused
Avoid: cyberpunk, dark futuristic, aggressive red, overly corporate stock imagery, childish mascot
```

### note記事用（Before/After）

```
Brand: DAYLOOP
Scene: a busy office worker (20-40s) surrounded by floating sticky notes and task chips (Before),
       or calmly focused on one task on a laptop with a soft timeline UI beside them (After)
Style: friendly editorial illustration, soft lines, blue/green clothing accents,
       desk with laptop / notebook / coffee / plant, white background
Mood Before: slightly overwhelmed but not distressed, no exaggerated negative expression
Mood After: calm, focused
Avoid: corporate stock photo feel, pathological/negative expressions, cyberpunk
```

### X投稿用（Feature訴求）

```
Brand: DAYLOOP
Concept: [Brain Dump / AI Organize / Timeline / Re-plan] の1機能を1枚で
Visual: 該当するProduct UIのミニマルな再現（実UIのHTML/CSSモックを流用可能なら優先）
Style: white background, calm blue-green gradient accent, dot pattern corner decoration,
       bold Japanese headline (1 main copy + 1 supporting copy), DAYLOOP logo bottom-left
Mood: calm, friendly, focused
Avoid: 情報を詰め込みすぎない。1枚1メッセージ。
```

### AIキャラクター表現（使う場合）

```
Brand: DAYLOOP
Role: Friendly assistant that helps organize, never decides for the user
Style: simple, friendly robot/assistant motif, not cute-mascot, not futuristic/cyberpunk
Mood: helpful, calm, supportive — never the main character (the user always is)
```

## Current / Coming Soon（実装状況）

LPの「今すぐ使える機能 / これから追加する機能」（`index.html` `#features`）は、
実装調査に基づき常に実態と一致させること。2026-08-11時点の実態:

**実装済み**: 手動タスク追加、AI Brain Dump（Backend未設定時は行ごとの候補化にフォールバック）、
AI Review（優先度・所要時間提案）、Timebox決定論的スケジューリング、24時間タイムライン、
今から詰め直す（Re-plan / `build-from-now`）、ローカル保存、Obsidian保存（File System Access API
による一方向書き込み）、JSONバックアップ、ICS書き出し、Google Sheets(GAS)連携。

**未実装（Coming Soon表記が必須）**: 実行の実測タイマー（`actualMinutes`は現状 予定分数を
コピーしているだけで実測ではない）、Skillの自動検出（データモデルのみ存在、検出アルゴリズムは無し）、
Automation、Google Drive完全連携・DAYLOOP Cloud・複数端末同期（プロバイダはスケルトンのみ、
`NotImplementedError`を返す）、Googleカレンダー直接同期（現状は.ics書き出しでの片方向インポートのみ）。

実装状況が変わった場合は、このセクションとLP本文の両方を更新すること。
