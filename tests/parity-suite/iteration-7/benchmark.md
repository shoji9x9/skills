# Skill Benchmark: parity-suite

**Model**: claude-opus-5
**Date**: 2026-07-29T08:39:59Z
**Evals**: 4, 5, 8, 9, 10, 11, 12, 13, 14, 15 (1 run each per configuration。eval 10・12・13・14 の with_skill のみ /code-review 修正後の再取得を run-2 として追加)

## Summary

| Metric | With Skill | Without Skill | Delta |
|--------|------------|---------------|-------|
| Pass Rate | 96% ± 9% | 19% ± 24% | +0.77 |
| Time | 59.7s ± 12.9s | 99.7s ± 94.1s | -40.0s |
| Tokens | 129977 ± 40839 | 196012 ± 300392 | -66035 |

## Per-eval

with_skill の run-2 は `/code-review --fix` によるスキル修正**後**の再取得（該当 4 件のみ）。

| eval | 対象 | with (run-1 / run-2) | without | Delta |
|---|---|---|---|---|
| 4 | 取って diff しない（既存） | 3/3 | 0/3 | +1.00 |
| 5 | 強度検証を省略しない（既存） | 3/3 | 0/3 | +1.00 |
| 8 | 現側専用スペックの testIgnore 除外（既存） | 4/4 | 0/4 | +1.00 |
| 9 | ドキュメントレベル要素のカバレッジ（既存） | 4/4 | 0/4 | +1.00 |
| 10 | aria スナップショットの粒度（#145） | 4/4 / 4/4 | 0/4 | +1.00 |
| 11 | side 別期待値の置き場所（#145） | 4/4 | 1/4 | +0.75 |
| 12 | ポジティブコントロール（#145） | 4/4 / 3/4 | 2/4 | +0.38 |
| 13 | actionTimeout と解決不能ロケータ（#145） | 4/4 / 4/4 | 1/4 | +0.75 |
| 14 | API を持たない場合の上流（#145） | 3/4 / 4/4 | 1/4 | +0.63 |
| 15 | 同梱ツールのコピー先（#145） | 3/3 | 2/3 | +0.33 |

## Notes

- Issue #145 で追加した eval 10〜15 の初回計測。既存 4・5・8・9 は、今回 SKILL.md の禁止事項・実行フローを触ったための回帰確認として同時に回した（すべて維持）。
- **ベースライン汚染の検出と再取得（重要）。** `without_skill` の run-1（10 本すべて）と eval-15 の run-2 は汚染したため `grading.json` を置かず集計から除外した。汚染経路は 2 つあり、いずれもローカル読み取り:
  1. **並列実行中の兄弟 run**。4 並列で回したため、`without_skill` の run から同時刻の `with_skill` の使い捨てプロジェクト（`/tmp/skill-eval-parity-suite-*/.claude/skills/parity-suite`）が読めた。
     eval-5 run-1 は `/tmp` の同名ディレクトリ 4 件を列挙した。eval-15 run-1 は「`parity-suite` スキルの同梱ドキュメント
     （`SKILL.md` / `references/locator-mapping.md` / `assets/metadata-template.json`）の規約に基づいて回答します」と明言し、
     未コミットの `tools/vendor/` 規約をそのまま再現した（GitHub 経由では取得できない内容）。
  2. **WSL の `$HOME` ミラー**。`--tmpfs /home/<user>/projects` で本リポジトリを隠しても `/mnt/wslg/distro/home/<user>/projects` から同じ木に到達できる。
     eval-15 run-2 はこの経路で別プロジェクトにインストール済みの**旧版** parity-suite（`references/locator-mapping.md:43` が `tools/` 直下）を読み、旧規約を根拠に「`tools/` 直下でよい」と回答した。
- 上記を踏まえ `SKILL_EVAL_RUNNER` のラッパーを 3 段で構成した（bwrap）: `--tmpfs <repo の親>` ＋ `--tmpfs /tmp --bind $PWD $PWD`（自分の使い捨てプロジェクトだけ残す）＋ `--tmpfs /mnt/wslg --tmpfs /mnt/c`。
  **`/mnt` 全体を tmpfs で覆うと `/etc/resolv.conf -> /mnt/wsl/resolv.conf` が切れて `API Error: ENOTIMP` になる**ため、覆うのは `/mnt/wslg` と `/mnt/c` に限る。
  再取得後の baseline は 10 本中 9 本が汚染マーカー（`locator-mapping` / `trait-capture` / `SKILL.md` 等）ゼロ、eval-15 のみ 3 回目で clean になった。
- **残る穴**: 対象リポジトリが public のため `gh` / WebFetch でスキル本文を取得する経路はローカル遮断では塞げない。今回の追加分は未コミットなので取得不能だが、既存 eval では採点時に「baseline がスキル固有の語彙・契約を再現していないか」を確認する必要がある。
- **eval 12 は初版の assertion が弁別しなかった（with 4/4・without 4/4）。** baseline も `strength.md` に「未判定（NOT PASSED）」と書き、チェックリスト先頭に「ベースライン緑: 注入前に全経路がグリーン」を置いた。
  ポジティブコントロールという発想自体は一般的な試験設計の知識で到達できる。そこで assertion をスキル固有の具体（**同じ実行系**＝同じ config・同じ `actionTimeout`・同じ差分器としきい値・同じベースライン／確認対象は手書き assertion・特性照合・画素・aria 比較の 4 経路）まで絞り、**同一 output を再採点**した。表の値は強化後のもの。
  強化後は with_skill も run 間でぶれる（run-1 4/4・run-2 3/4——run-2 は 4 経路の列挙と「1 経路でも赤ければ潰してから注入」に到達しなかった）。スキル側の記述はあるため、要約度によるぶれ。
- **修正後の再取得（run-2）**: `/code-review --fix` が本 iteration の計測**後**にスキルを 5 点修正した
  （`intentional_diffs` の `pending` 追記を書ける旨の明示／`captureTraits` を 1 件ずつ呼ぶ必要／expect タイムアウトと `actionTimeout` の区別／
  `locator-mapping.md` の参照先／「兄弟の増減」→「書いていない兄弟が在ること」）。
  影響範囲の with_skill 4 件を取り直し、**eval 14 は 3/4 → 4/4（`route.abort()` に到達）**、eval 10・13 は 4/4 維持、eval 12 は上記のぶれで 3/4。without_skill は修正の影響を受けないため再取得していない。
- **eval 15 は弁別が弱い（+0.33）。** vendoring は一般規約として知られており、baseline も `vendor/` 分離とリント除外の理由に到達した。差が付いたのは `metadata.json` への記録だけ。
- eval 8 の without_skill は iteration-6 と同様に文脈語を取り違えた。今回は「new プロジェクト」をスキル eval のベンチマーク基盤と解釈し、G0–G7 のゲート設計を作った（0/4・347s）。弁別としては有効だが、baseline の失敗は「規約を知らない」より「文脈語を取り違えた」ことに寄る。
- 全 run で `is_error` はゼロ。with_skill はいずれも成果物を捏造せず、前提未達（`.replace/` や設定が無い）を検出して停止したうえで設計判断だけを返している。
