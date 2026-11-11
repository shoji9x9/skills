# Skill Benchmark: parity-replace

**Model**: claude-code / opus / 指定なし（直近の iteration-35 に合わせた）（harness `run-skill-eval/5`）
**Date**: 2026-11-11
**Evals**: 3（`with_skill` と `without_skill` を 1 run ずつ）

## 目的

Issue #993 で、`parity-replace` が `style_policy: free` の画面のある機能を、`spec-parity suite` の e2e のスイートと `spec-parity verify` を相手に進めるようにした（`references/style-free.md`）。
変更確認として、入力を変えた eval 26（fixture と assertion）と、新しく足した eval 27・28 を、両方の configuration で 1 run ずつ実行した。

## Summary

| eval | 入力の変更 | with_skill | without_skill | 前回の with_skill |
| --- | --- | --- | --- | --- |
| 26 | fixture（`style-free-no-suite`）と assertion | 5/5 | 3/5 | 文を変えたので比べない（iteration-35 は停止を前提にした別の assertion） |
| 27 | 新規 | 6/6 | 0/6 | - |
| 28 | 新規 | 6/6 | 4/6 | - |

すべての run で `isolation.txt` は `sandboxed`、`without_skill` の `contamination.txt` は `clean` だった。`with_skill` の `skill_usage.read` はすべて true だった。

## 観察

- eval 26: baseline はスキルが無いことを理由に止まり、`spec-parity suite` を案内しなかった（assertion 1・2）。`parity-suite` も案内しなかったので、assertion 3 は後退の検知の項目である。
- eval 27: baseline は `--target local-dev` で全件 pass を条件にし、`replace-metadata.json` に独自のキーを挙げ、`later` の担当と次の工程を `style_policy` の値の条件で並べただけだった。
- eval 28: `requires_skills` で `spec-parity` を置いたので、baseline も `spec-parity` を読み、トークンを寄せないことと `component_diffs` を宣言しないこと（assertion 1・2）、受け入れを利用者が決めること（assertion 5）を満たした。
  差が出たのは、UI ライブラリを選ばずに `references.ui_library` の整備を求めること（assertion 3）と、実装の点検に `web-design-guidelines` を使うこと（assertion 4）である。
- eval 28 は最初の run の後に、prompt に「実装した見た目を点検する方法と、見た目を受け入れるかを誰がいつ決めるかも教えて。」を足して実行し直した。
  最初の prompt は点検を問わず、`with_skill` が assertion 4 に触れなかった（5/6）。prompt を変えたので、最初の run は捨て、変えた後の run だけを記録した。
- eval 27・28 の run は、`references/style-free.md` に「手順 7（敵対的レビュー）」の節を足す前のバージョンで実行した。足した節は、どちらの assertion にも関わらない。
