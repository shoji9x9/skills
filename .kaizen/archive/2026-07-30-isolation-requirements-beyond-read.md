---
date: 2026-07-30
type: other
priority: high
status: applied
session: claude-code
---

# 隔離は「守る側の read」だけで設計せず、外への write と比較の対称性も要件に数える

## 事象

Issue #143 で `scripts/eval-sandbox.sh`（4 群の read 遮断）を eval ハーネスの既定挙動にした直後、
2 つの穴が実測で出た。

- **write が塞げていなかった。** without_skill の baseline run が `~/.claude/skills/skill-creator/`
  （anthropics/skills のベンダ配布物）を実際に書き換えた（`SKILL.md` ほか 4 ファイル改変＋
  `isolate_baseline.py` 新規＋`__pycache__`）。`--ro-bind $HOME` が無く、`~/.claude/skills` が
  read も write も可のままだった。pin された `github-tree-sha` の内容へ復旧した。
- **対称性が要件から漏れていた。** サンドボックスを `without_skill` にだけ当てたため、`with_skill` は
  `~/.claude/projects`（スキル本文と eval 設計そのものを含む当該セッションのトランスクリプト）や
  グローバルインストール済みスキルを読めていた。実測で、それを根拠に回答した run がある
  （`~/.claude/skills/skill-creator/scripts/run_eval.py` を grep して「隔離処理を持っていない」と述べた）。
  両側を同一サンドボックスに入れて取り直すと Delta は +0.47 → +0.40 に下がった。

## 根本原因

- なぜ穴が開いたか? → 隔離の目的を「baseline に skill 内容を read させない」の 1 点で定義した
  - なぜ 1 点で定義したか? → 直前の 5 回の再発がすべて read 汚染だったため、その事例の形を要件の全体と同一視した
    - なぜ同一視したか? → 隔離という機構が同時に担う他の性質——**外向きの副作用の封じ込め**（サンドボックス内の
      エージェントは `--dangerously-skip-permissions` で任意パスに書ける）と**比較の対称性**（A/B の差を
      測りたい 1 要因だけに保つ）——を要件として列挙していなかった ← 根本原因

KEDB 照合: [[2026-07-28-eval-baseline-read-contamination]]（applied）と同根だが、あちらは「read 経路の集合を
列挙し損ねた」。本件は経路ではなく**要件の集合**を列挙し損ねた層で、経路をすべて塞いでも残る。
`AGENTS.md`「等値比較を『正規化』で直すときは、両辺がズレうる軸を列挙して同じ正規化を両辺に当てる」の同型
（片側だけの処置が、別の軸が効いた瞬間に目的を外す）。

横断スコープ: 比較測定全般（プロンプト A/B・モデル比較・エージェント間比較）と、
`--dangerously-skip-permissions` で外部エージェントを起動する全ハーネスに効く。

## 提案（適用済み）

隔離・サンドボックスを設計するときは、要件を「何を読ませないか」で終えず次の 3 点を明示的に列挙する。

1. **read**: 守りたい内容へ到達できる経路の集合（既存の学びが扱う層）
2. **write**: サンドボックス内の実行主体が外へ残せる副作用。**逃がしてよい書き込み先を先に決め、それ以外は
   read-only にする**（`--ro-bind $HOME` ＋ 必要な箇所だけ tmpfs / bind で書き込み可に戻す）
3. **対称性**: 比較測定なら、比較する全 configuration を同一環境に置く。片側だけ隔離すると差が
   測りたい要因以外にも帰属する（隔離した側が不利になるとは限らず、隔離しない側が有利になる）

`scripts/eval-sandbox.sh` / `scripts/run-skill-eval.sh` に反映済み（`$HOME` read-only ＋ `~/.claude` 全体 tmpfs、
両 configuration へサンドボックス適用、`--verify` stage3 で書き込み封じ込めをホスト側から検査）。
検査は「陰性＝合格」にせず、走査根ごと・書き込み可否ごとに陽性コントロールを置く
（[[2026-07-30-negative-result-checks-need-positive-control]]）。
