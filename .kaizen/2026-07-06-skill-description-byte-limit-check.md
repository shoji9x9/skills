---
date: 2026-07-06
type: hook
priority: high
status: pending
session: claude-code
---

# SKILL.md frontmatter（description バイト長・YAML 妥当性）を決定論的に検査する

## 事象

（1）browser-test スキル作成時、日本語 description の加筆で `gh skill publish --dry-run` に
「description is 1078 chars (recommended max: 1024)」と警告された（修正して 984 バイトに短縮）。
検出は publish 直前の手動 dry-run のみ。横断確認で、マージ済みの aws-architecture-diagram も
現在 1051 バイトで超過しており、dry-run のたびに警告が出続けている（再発・放置の証拠）。

（2）【2026-07-19 追記】golden-dataset スキル作成時、description（未クオートスカラー）に
「A: 論理データ設計」のような ASCII コロン＋スペースを含めたため YAML の
「mapping values are not allowed in this context」で `gh skill install`（`reinstall-skill.sh`）
が失敗した。既存フック（markdownlint / skills-sync 等）は検出できず、reinstall 実行時に
初めて発覚した。

## 根本原因

- なぜ超過・破損する? → description を自然文で書く際、「文字数」感覚のバイト数見積もりも、
  YAML 未クオートスカラーの制約（「: 」＝コロン＋スペースがマッピング区切りになる）も
  執筆時には意識されない
- なぜ見積もりがずれる? → 上限は実測で UTF-8 バイト数（`awk length`=1078 と gh の 1078 が一致。
  日本語は 1 文字 3 バイトで実質約 340 文字）だが、AGENTS.md は「最大1024文字」と記載
- なぜ検出されない? → SKILL.md frontmatter を検査する決定論的チェック（pre-commit / CI）が無く、
  手動 dry-run や reinstall でしか気付けない ← 根本原因（両事象に共通・対策可能）

## 提案

SKILL.md の frontmatter は決定論的チェックで検査する: description の上限 1024 は UTF-8
バイト数（日本語は実質約 340 文字）、かつ frontmatter 全体が YAML としてパース可能であること。

- `scripts/` に skills/*/SKILL.md の frontmatter を検査するスクリプトを追加し、
  lefthook pre-commit と CI（Lint ジョブ）に組み込む:
  - (a) js-yaml（既存 devDependency）で frontmatter を YAML パース（失敗で fail）
  - (b) description の UTF-8 バイト長 >1024 で fail
- AGENTS.md「最大1024文字」を「最大 1024 バイト（UTF-8。日本語はおよそ 340 文字）」に訂正
- 横断対応: aws-architecture-diagram（現在 1051 バイト）の description 短縮と、
  全 SKILL.md の YAML 妥当性確認（チェック導入時に fail するため同時に対応する）
