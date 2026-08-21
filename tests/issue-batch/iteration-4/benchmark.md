# Skill Benchmark: issue-batch

**Model**: claude-opus-5[1m]
**Date**: 2026-08-21T03:50:16Z
**Evals**: 7, 9, 11 (1 run each per configuration)

## Summary

| Metric | With Skill | Without Skill | Delta |
|--------|------------|---------------|-------|
| Pass Rate | 100% ± 0% | 52% ± 28% | +0.48 |
| Time | 73.6s ± 17.6s | 80.9s ± 23.6s | -7.3s |
| Tokens | 3817 ± 924 | 3288 ± 1476 | +528 |

## 目的

iteration-3 で Delta が小さかった eval の assertion を skill 固有の具体へ差し替え、弁別が戻るかを検証する
部分 iteration。対象は eval 7 / 9 / 11 のみで、他 eval は iteration-3 が最新。

- 実行日: 2026-08-21（Issue #176）
- ハーネス: `scripts/run-skill-eval.sh`（両 configuration とも bwrap サンドボックス経由）
- executor / analyzer: `claude-opus-5[1m]`。1 run / configuration
- 全 baseline の `contamination.txt` は `verdict: clean`

## 差し替え内容と結果

| eval | iteration-3 | iteration-4 | 判定 |
| --- | --- | --- | --- |
| 7 | 2/2 vs 2/2 = **+0pt** | 4/4 vs 3/4 = **+25pt** | 部分的 |
| 9 | 3/3 vs 3/3 = **+0pt** | 5/5 vs 1/5 = **+80pt** | 弁別が戻った |
| 11 | 4/4 vs 3/4 = **+25pt** | 5/5 vs 3/5 = **+40pt** | 改善 |

### eval 9（成功）

プロンプトに「既定の続行方針がどの設定で決まるか」「`--stop-on-blocked` が設定ファイルに与える影響」
「BLOCKED になった Issue 101 の worktree と最終報告の扱い」を追加し、assertion に 2 項目を足した。

**副次効果が大きかった。** baseline は追加項目に答えられないだけでなく、iteration-3 では一般論として
正答していた既存 2 項目についても「仕様書がなければ決められない事項で、私が書けば創作になります」として
回答を辞退した。憶測で埋められない具体を問うと、周辺の一般論まで bluff できなくなる。

### eval 11（改善）

プロンプトに「登録待ちが 0 件だったときにどの状態値で表し分けるか」「`deployment.workflows` に
空配列が明示保存されている場合との違い」を追加し、assertion を 4 → 5 に増やした。

baseline は独自語彙で 4 分類（`pending` / `timeout` / `not_triggered` / `disabled`）を構成し、
空配列と未設定を truthy 判定でまとめてはいけないという実装注意まで自力で導出した。
それでも新項目を落としたのは次の 3 点による。

1. 語彙が全て独自で `not-applicable` / `not-configured` が現れない（本人も「仕様書があればそちらに合わせて」と留保）
2. **API 失敗の分類が無い**。`gh run list` の非ゼロ終了や権限不足を「0 件」と区別する枝が存在しない
3. **キー未設定時の扱いが契約と逆**。「未設定ならデフォルト挙動（workflow の自動検出）へフォールバックする」
   としたが、skill の契約は必須キー欠落を変更前停止＋setup 案内とする。ユーザーが承認していない workflow を
   暗黙に監視対象にする方向へ倒れている

### eval 7（部分的・目標未達）

追加した 2 項目（manifest / PR 本文への記録、根拠不足時に `not-applicable` へ倒さない）は
**baseline も自力で満たした**。baseline は `diff_base` / `diff_head` / `changed_files`（全件）/
`ui_surface_hits: []` を持つ独自 YAML を設計し、「『探した結果ゼロだった』と『そもそも探していない』を
区別するため空配列を明示的に記録」とまで書いた。弁別したのは状態値の語彙のみ（`not-applicable` 対 `not_required`）。

## 示唆

**概念レベルの契約は有能な baseline が再発明できる。** 「証拠を残せ」「不確実なら安全側へ倒せ」
「0 件を成功に丸めるな」は設計原則として導出可能なので、それ自体を検査項目にしても弁別しない。
弁別するのは次の 2 種類である。

1. **その skill だけが定める固有の名前** — 設定キー `continue_on_blocked`、状態値 `not-applicable` /
   `not-configured`、配置パス `.config/skills/shoji9x9/skills.yml`、委譲先 `pr-finalize-loop`
2. **一般則からは一意に決まらない選択** — CLI override を永続化しない、BLOCKED worktree を残す、
   元 branch に base を merge して別 branch を作らない、必須キー欠落を自動検出へフォールバックせず停止する

## 残る課題

- **eval 7 は +25pt のまま**。主題（逆引きが要る・証拠を残す・不確実なら安全側）が baseline に
  再発明可能なため、上限は +50pt 程度と見込まれる。後退検知が主目的の eval として扱う
- **run 数 1 の揺れ**。eval 11 の assertion 1（base branch 照合）と 4（`gh run watch`）は
  iteration-3 と iteration-4 で baseline の合否が逆転した（iter3: 1=FAIL / 4=PASS、iter4: 1=PASS / 4=FAIL）。
  この 2 項目の弁別性は単一 run では確定していない
- baseline が提案した「未設定なら workflow 自動検出へフォールバック」は契約と正反対で危険。
  skill 側は変更前停止で安全側だが、`references/project-config.md` に
  「未設定と空配列を同一視しない」旨を明記する価値がある（本 iteration では未実施）
