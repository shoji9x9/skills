# Skill Benchmark: golden-dataset

**Model**: claude-opus-5
**Date**: 2026-07-30T03:16:06Z
**Evals**: 10 (1 run each per configuration)

## Summary

| Metric | With Skill | Without Skill | Delta |
|--------|------------|---------------|-------|
| Pass Rate | 100% ± 0% | 0% ± 0% | +1.00 |
| Time | 83.8s ± 0.0s | 61.6s ± 0.0s | +22.2s |
| Tokens | 227149 ± 0 | 150147 ± 0 | +77002 |

## 対象と結果（Issue #159 ファイル入出力・ストレージ）

eval 10 は「アップロード用 fixture を手でコミット」「ストレージのテストバケットへ投入」という 2 つの逸脱要求への応答を見る。

- with_skill 4/4: 生成ツールへ寄せる規律（手書き静的データをコミットしない）・本物として通るバイト列の必要性・`storage.seedable: true` でもストレージ実体へ投入しない（v1 スコープ外）・未投入＝未検証として `verification.md` / `gaps` に残す、をすべて提示
- without_skill 0/4: ストレージ書き込みを断ったが理由は「非対話環境では外向き・不可逆な操作を避ける」であり、v1 スコープ外・未検証記録・生成ツールの規律はいずれも出ない

## ベースラインの read 汚染について

`without_skill` は `scripts/eval-sandbox.sh`（4 群遮断）経由・逐次で取得。事前 2 段検証と事後のマーカー grep（15 語）はいずれも 0 件で汚染なし。
経緯と手順は `tests/replace-strategy/iteration-10/benchmark.md` の同節を参照。

## fixture の cue 除去について（2026-07-30 追記）

本 iteration の測定に使った fixture の設定ファイルには、`targets:` の直前に
「DB を持つ target は 1 つも無い（静的サイトのため意図的）」というコメントがあった。
これは「意図的」であることを明言しており、**否定形の assertion**（「db を持つ target が
1 つも無いことを理由に停止していない」等）をベースラインが通しやすくなる cue だった
（Issue #160 の eval 整備中に `parity-diff` の fixture で同型・より重度の漏れが見つかったのを機に棚卸しした）。

- **コメントは削除した。** 規約は `docs/skill-development.md`「回帰テストを実行する」の
  「fixture に『期待する答え』を書かない」に明文化した
- **再計測はしていない。** cue の除去はベースラインを弱くする方向にしか働かないため、
  ここに記録した Delta は**下限**として有効である（実際の Delta はこれ以上になる）

- **`targets` の `develop` に付いていた `（意図的）` 注記も除去した**（配信型環境の db / start / commit_check の欠落を「意図的」と明言していた）。
  否定形の assertion（「〜が無いことを理由に停止していない」「db を持たない target の扱いに触れている」等）はこの 1 行で通ってしまうため、同じ cue の class に当たる。
  YAML のキー・値は変えていないので設定の意味論は不変で、**再計測はしていない**（cue の除去はベースラインを弱くする方向にしか働かないため、記録済みの Delta は下限として有効）。
  規約は `docs/skill-development.md`「回帰テストを実行する」の「fixture に『期待する答え』を書かない」に明文化した
