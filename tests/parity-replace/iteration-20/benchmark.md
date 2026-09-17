# Skill Benchmark: parity-replace

**Model**: claude-code / claude-opus-5（CLI 2.1.274 (Claude Code)）
**Date**: 2026-09-17
**Evals**: 19 のみ（`with_skill` / `without_skill` 各 1 run。変更確認スコープなので Delta の数値は語らない）

## 何を変えたか（Issue #385）

`theming.md` に「移行元の宣言を『写さない』と決めるなら、その宣言が変える次元を全部測る」を新設し、
`porting.md` に記録表（`assets/porting-template.md`）と完了判定の 1 行を足した。
eval 19 は、`display: table` を「当てる相手が無いから写さない」と決め、根拠に**文字の位置だけ**を測った案を押し戻せるかを見る。

## Summary

| eval | with | without | 弁別した assertion |
|---|---|---|---|
| 19 写さない判断の次元 | **7/7** | 3/7 | 4（箱の寸法を両側で並べる・`display: table` の高さが中身で決まる・3 経路のどれにも出ない・`porting.md` への記録） |

2 run とも `isolation.txt` は `sandboxed`、`without_skill` の `contamination.txt` は `clean`。

## 読み取れたこと

- `without_skill` も「5px は規則が効く世界と効かない世界を区別できない値」には自力で到達した（assertion 5・7 は後退検知）。
  `table-layout: fixed` が別軸であることも指摘した
- 一方で**箱の高さ**という次元には最後まで触れず、記録先も「パリティログ」という一般語にとどまった
- `with_skill` は A〜F の表で経路ごとの効き方を並べ、確実に効くのは「利用者が画面で見つける」経路だけだと述べた
  （`theming.md` の「3 経路のどれにも出ないことがある」を引用）

## iteration-19（初版）で分かったこと

初版の prompt には「どの経路で気づけるか」を問う文が無く、`with_skill` でも 3 経路の assertion に到達しなかった（6/7）。
assertion を引き出す問いを prompt に足して取り直したのが iteration-20。
