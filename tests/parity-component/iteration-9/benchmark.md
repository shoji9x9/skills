# Skill Benchmark: parity-component

**Model**: claude-code / opus（CLI 2.1.284 (Claude Code)、harness `run-skill-eval/3`）
**Date**: 2026-09-29
**Evals**: 5・6・7・8・9（`with_skill` / `without_skill` 各 1 run。変更確認スコープなので Delta の数値は語らない）

## 何を変えたか

- Issue #456: 部品の動き（出し入れ・開閉）を capture で数え、同梱の探針 `motion-probe.mjs` で時系列を採り、
  `motion-compare.mjs` で現行とカタログを突き合わせる（`references/motion.md`）
- Issue #477: build で、部品の一生の順番（結び直し・引数の差し替え・付け直し・初期化の後の変化）で壊れる経路を判定し、
  順番を強制する見本で確かめる（`references/lifecycle.md`）

eval 8（fixture `motion-in-current`）と eval 9（fixture `lifecycle-binding`）を新設した。
eval 5・6・7 は、fixture の `metadata.json` に `capture.motions`（動きの無い部品の宣言）を足したので、入力が変わった eval として取り直した。
`breaking-change-request` はそれに加えて `build-metadata.json` に `motion` / `lifecycle` の欄を、`parity.md` に行を足している。

## Summary

| eval | with_skill | without_skill | 弁別した assertion 数 |
|---|---|---|---|
| 5 カタログ未宣言で停止する | 6/6 | 4/6 | 2 |
| 6 破壊的変更を自分で決めない | 5/5 | 4/5 | 1 |
| 7 カスケードを解いて勝っている宣言を確定する | 8/8 | 8/8 | 0 |
| 8 現行の動きを数えて時系列を採る計画を立てる | 7/8 | 2/8 | 5 |
| 9 一生の順番で壊れる経路を完了判定の前に拾う | 5/7 | 2/7 | 3 |

10 run とも `isolation.txt` は `sandboxed`、`without_skill` の `contamination.txt` は `clean`。
`with_skill` の 5 run はどれも Skill ツールで `parity-component` を呼んでいる。
`without_skill` の eval 9 は `SKILL.md` を 2 回読もうとしたが、ファイルが無く読めていない（応答にも「見つからなかった」とある）。

## 読み取れたこと

- **eval 8 は弁別した。** `without_skill` も jQuery UI の slide 600ms / 500ms を読んで「時系列で採る」とは書くが、
  `capture.motions` への記録・探針 `motion-probe.mjs` と `motions.json`・動きの採取中はアニメーションを止めないこと・
  フォーカス移動を操作にして `on_complete` で結ぶこと・自動で閉じる 15 秒を探針の遅れとして測ることは、どれも出なかった
  （15 秒は Playwright の時計の制御で境界を確かめる計画になった）。
  `with_skill` が落としたのは「2 回採った差を揺れ（許容差の根拠）にする」の理由の部分だけで、2 回採ること自体は書いている
- **eval 9 も弁別した。** 両 config とも `disabled` が初期化の後に反映されないことは読み取る
  （コードを読めば分かる不具合なので弁別しない）。
  `without_skill` は結び直し（StrictMode）に触れず、順番を強制する見本・直した処理を外す確認も出ない。
  `with_skill` は 3 条件で対象と判断し、4 経路を振り分けた。落としたのは、`data-*` 属性で「入ったことを先に確かめてから症状を見る」の順序と、
  順番の見本を `unbaselined_stories` に数えない点の 2 つ（`catalog.stories` に載せないことは書いた）
- **eval 9 は fixture を 1 回直して取り直した。** 最初の fixture は新側が押したときの波紋（`attachRipple`）を付けていた。
  それが「現行に無い動き」として両 config に拾われ、論点が逸れた。
  結び付けを Enter キー（`bindEnterKey`）に替えて eval 9 だけ取り直した（表の数字は取り直した run のもの）
- **eval 9 の fixture に残る食い違い**: `components.md` の採否（自前実装）と `docs/ui-library.md`（外部 UI ライブラリを採用しない）が、
  新側の市販部品の利用と食い違う。`without_skill` はこれを主な論点に挙げ、`with_skill` は挙げなかった。
  assertion には関わらないが、次にこの fixture を触るときに揃える
- **eval 5・6・7 は、fixture の変更による後退が無いことを確かめた。**
  `with_skill` の eval 5 は、前提判定で `motion-compare.mjs` を通し、動きの無い部品として exit 0 になることまで確かめている。
  eval 7 は iteration-8 と同じく弁別しない（後退検知専用。README 参照）
