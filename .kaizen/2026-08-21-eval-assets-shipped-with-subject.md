---
date: 2026-08-21
type: doc
priority: high
status: pending
applied-to: []
session: claude-code
---

# 測定対象に測定の答えを同梱したまま測らない

## 事象

Issue #176 の issue-batch eval で、`with_skill` run の出力が `skills/issue-batch/evals/README.md` に
書かれていた採点基準の語彙をそのまま反復していた。該当箇所は

> 「作らない・削除しない・重複しない」を合格に使う場合は、同じハーネスが対象 branch / PR / file を
> 列挙できる陽性コントロールを置く。0 件、timeout、コマンド失敗を clean に倒さない。

で、eval 5 / 13 の with_skill 出力に「列挙手段（陽性コントロール）が無いため 0 件を clean と報告しない」と
現れた。同 README には eval 番号とトピックの対応表（「構文境界（eval 2 / 3）、…cleanup（10〜14）」）もあった。

`scripts/run-skill-eval.sh` は `cp -R -- "${src}" "${proj}/.claude/skills/${skill}"` で
`skills/<name>/` を丸ごと使い捨てプロジェクトへ入れる。したがって `evals/evals.json`（assertion 全文）も
`with_skill` 側**だけ**に置かれる。baseline はスキル未設置なので見えない。

## 根本原因

なぜ 1: with_skill run が採点基準を読めた → なぜ 2: 採点基準がスキルバンドル内 (`evals/README.md`) にあった
→ なぜ 3: 被験体（配布スキル `skills/<name>/`）とテスト資産（`evals/`）を同じディレクトリに置き、
ハーネスのコピー時に分離していない。**測定対象と測定の答えが同一成果物に同居している。**

`.agents/rules/eval-assertion-discrimination.md` は「fixture に期待する答えを書かない」を規定するが、
対象を fixture に限定しており、**バンドルごとコピーされる `evals/` 自体**は視野に入っていなかった。

## 影響

- 今回は README の語彙が with_skill 出力に現れたが、**どの assertion も README だけでは満たせず**、
  Delta は無効化されなかった（eval 13 の with_skill は README を読んでいれば埋まったはずの
  default / protected 句を落としている）。
- ただし `evals.json` の同梱は本リポジトリの**全スキル・全 with_skill run**に常時効いており、
  with_skill 側だけが自分の採点基準を読める状態が続いている。

## 提案

1. `docs/skill-development.md`「eval 実行の隔離（必須）」に、**測定対象へ同梱する成果物から採点材料
   （assertion・採点基準・eval トピック表）を除く**ことを明記する。
2. ハーネス側で `evals/` をコピー対象外にする（`cp -R` ではなく `--exclude` 相当、または
   `SKILL.md` / `references/` / `assets/` / `scripts/` を明示コピー）。
3. `.agents/rules/eval-assertion-discrimination.md` の「入力が答えを持っていないか」の項を、
   fixture だけでなく**被験体に同梱される全ファイル**へ広げる。

## 横断スコープ

同じ構図は「評価対象の成果物の中に評価基準が入る」場面全般に効く。
`golden-dataset` / `parity-suite` のように判定基準を成果物として持つスキルでは、
その基準を新側実装のコンテキストへ渡さない設計になっているかを同じ観点で確認する。
