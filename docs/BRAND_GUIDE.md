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

`public/images/dayloop/brand/`:

- `dayloop-logo-icon.svg` — アイコン単体（Navy角丸背景あり）。favicon・アプリバー等
- `dayloop-logo-compact.svg` — アイコン単体（背景なし・透過）。小サイズ・インライン用
- `dayloop-logo-primary.svg` — アイコン＋ワードマーク（文字は濃色）。白背景用
- `dayloop-logo-dark.svg` — アイコン＋ワードマーク（文字は白）。暗い背景用

同じマークはLP側 `index.html` 内の `<symbol id="dl-mark">` にも実体化されている（`<use href="#dl-mark">` で参照）。
デザインを変更する場合は、この4ファイルとLP内の `<symbol>` を両方更新すること。

意匠: 円環（Loop、開いた円弧＋矢印＝Flow/継続）の内部に時計の針（Clock、10:10配置）、
上部に小さなDot（12時位置のマーカー）。Gradient: Blue(`#3D5AFE`) → Teal(`#14B8A6`)。

## Dot Pattern

`assets/css/landing.css` の `.lp-dot-pattern`。Blue / Teal / Mint の淡いドットグリッドを
中心から外側へマスクでフェードさせたもの。Corner / Edge にだけ使い、全面には敷かない。
note/Xテンプレート側は各HTMLファイル内に同じ考え方のCSSをインラインで持たせている
（単体で開いてスクリーンショットするための独立アセットのため、共通CSSを読み込まない）。

## Reusable Image Templates

すべて `public/images/dayloop/` 配下にHTML実体として保存。ブラウザで開いて
スクリーンショットすれば、そのままLP/note/X用画像になる（コピーではなく再生成が前提）。

| Template | Path | Size |
| --- | --- | --- |
| OGP | `ogp/dayloop-ogp-template.html` | 1200×630 |
| note Cover | `note/dayloop-note-cover-template.html?title=...` | 1280×720 (16:9) |
| X Post（Landscape/Square） | `x/dayloop-x-post-template.html?variant=landscape\|square&main=...&sub=...` | 1200×675 / 1080×1080 |

生成済みの実画像（差し替えサンプル）:

- `ogp/dayloop-ogp.png`
- `note/dayloop-note-cover-example1.jpg`（Example 1: 「時間がない。だから、考える時間を減らす。」）
- `x/dayloop-x-concept-landscape.jpg` / `x/dayloop-x-concept-square.jpg`
- `x/dayloop-x-carousel-1-problem.jpg` / `-2-dayloop.jpg` / `-3-result.jpg`（3枚Carousel）

画像化ツール（外部AI画像生成API）がない環境で作成したため、書き出しはPNG/JPEGとしている
（要件のファイル命名では`.webp`を挙げているが、変換ツールが無い環境だったための代替）。
`cwebp`等が使えるようになった場合はこの拡張子のまま再書き出しして`.webp`へ差し替えて構わない。

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
