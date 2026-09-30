# Skill Benchmark: parity-component

**Model**: claude-code / opus（CLI 2.1.284 (Claude Code)、harness `run-skill-eval/3`）
**Date**: 2026-09-30
**Evals**: 8（`with_skill` / `without_skill` 各 1 run）

## 何を変えたか

iteration-10 で eval 8 の `with_skill` が落とした「2 回採った差を揺れとして許容差の根拠にする」は理由の説明で、prompt（計画を問う）が引き出さない。
行動を問う assertion「2 回の時系列が大きく食い違ったら、許容差を広げず、遷移の手順か初期状態を揃えて採り直す」に替えた
（正本は `references/motion.md`「時系列を採る」）。スキルは iteration-11 から変えていない。

最初の起動は executor の OAuth トークンが失効して 2 run とも 401 で落ちた。再ログインの後、その run を消して取り直した。

## Summary

| eval | with_skill | without_skill | 弁別した assertion 数 |
|---|---|---|---|
| 8 現行の動きを数えて時系列を採る計画を立てる | 10/11 | 3/11 | 7 |

`isolation.txt` は `sandboxed`、`without_skill` の `contamination.txt` は `clean`、`with_skill` は Skill ツールで `parity-component` を呼んでいる。

## 読み取れたこと

- **差し替えた assertion を今度は落とした。** iteration-10 の run は「食い違ったら採り直す」を書き、今回の run は書かなかった。
  2 回採ること自体はどちらも書いている。食い違ったときの対処は計画の例外処理で、「何を・どの順で・どの条件で採るか」を問う prompt からは引き出されたりされなかったりする
- それ以外の 10 本は iteration-10 と同じく通り、`without_skill` は 3/11 で弁別は 7 本のまま
