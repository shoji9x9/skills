# Skill Benchmark: parity-diff

**Model**: claude-opus-5
**Date**: 2026-07-29T10:12:07Z
**Evals**: 3, 5, 6, 7, 8, 9, 10 (1 run each per configuration。eval-7 の without_skill は汚染により run-1 を破棄し run-2 を採用。eval-7・10 の with_skill は /code-review 修正後の再取得を run-2 として追加)

## Summary

| Metric | With Skill | Without Skill | Delta |
|--------|------------|---------------|-------|
| Pass Rate | 98% ± 7% | 18% ± 24% | +0.80 |
| Time | 59.7s ± 15.9s | 70.8s ± 58.8s | -11.1s |
| Tokens | 122174 ± 32008 | 76046 ± 24651 | +46128 |

## Per-eval

with_skill の run-2 は `/code-review` の指摘対応（`new-capture` プロジェクト分離・`capture_conditions.pages` / `masks` / `full_page` の契約化・画素経路の例外適用の明文化）**後**の再取得。

| eval | 対象 | with (run-1 / run-2) | without | Delta |
|---|---|---|---|---|
| 3 | 目視検出を代替提供しない（既存） | 3/3 | 0/3 | +1.00 |
| 5 | フォント差の切り分け（既存） | 4/4 | 2/4 | +0.50 |
| 6 | 他機能待ちの `blocked_by` と再判定トリガー（#147） | 5/5 | 0/5 | +1.00 |
| 7 | レジストリごとに効く経路（#147） | 5/5 / 5/5 | 0/5 | +1.00 |
| 8 | 「許容」確定の 2 段階（#147） | 4/4 | 1/4 | +0.75 |
| 9 | 仮説検証の観測条件（#147） | 4/4 | 2/4 | +0.50 |
| 10 | 新側採取スペックの雛形（#147） | —（破棄） / 4/5 | 0/5 | +0.80 |

## Notes

- Issue #147 で追加した eval 6〜10 の初回計測。既存 3・5 は、今回 SKILL.md の禁止事項・`references/triage.md` / `font-diff.md` を触ったための回帰確認として同時に回した（いずれも維持。5 は iteration-5 と同じ 4/4 対 2/4）。
- **ベースライン汚染の検出と再取得。** `without_skill` の eval-7 run-1 は汚染したため `grading.json` を置かず集計から除外し、遮断を広げた環境で run-2 を取り直した。
  run-1 は `normalize.md` の機械分類規則（`absorbed_T` の判定）・`component_diff_exceptions` の全フィールド・別プロジェクトの実測値（サブセット差の実例と件数）を再現し、
  「shoji9x9/skills#147 で起票済み」とまで述べていた（本 Issue の内容はローカルにしか無い形で参照されている）。
- **汚染経路は過去セッションの記録だった。** iteration-7（parity-suite）で使った 3 段の遮断（作業ツリー・`/tmp` の兄弟 run・WSL ミラー）に加え、
  `~/.claude/projects`（トランスクリプトとメモリ）・`~/.codex`・`~/.copilot/session-state` を `--tmpfs` で塞ぐ必要があった——**エージェントの会話ログはスキル本文を逐語で引用して保持している**ため、スキルソースを隠しても内容が読める。
  遮断の検証は 2 段で行った: (1) サンドボックス内で `grep -rl component_diff_exceptions ~` が 0 件、(2) run 後に出力へスキル固有マーカー（`absorbed_T` / `component_diff_exceptions` / `normalize.md` / `property: pixel` 等）を grep して 0 件。
  再取得した run-2 は独自スキーマ（`scope` / `systemic` / `tolerance` / `expires`）を創作し、**契約とは逆に「`component_diffs` の条件指定で吸収できる」と結論**した（0/5）。
- 残り 6 本の baseline はマーカー検査で clean だったため再取得していない（`~/.claude.json` に残る `parity-diff` は skill 名の利用回数カウンタのみで、内容を含まない）。
  **残る穴**は変わらず、対象リポジトリが public のため `gh` / WebFetch でスキル本文を取得する経路はローカル遮断では塞げない。今回の変更は未コミットのため取得不能。
- **修正後の再取得（run-2）**: `/code-review` の指摘対応が本計測**後**にスキルを変更したため、影響範囲の with_skill 2 件を取り直した。
  **eval-10 の run-1 は assertion 自体が変わった**（`new-capture` プロジェクトの確認を追加）ため `grading.json` を外して集計から除外し、run-2 のみを採用した。
  run-2 は 4/5——`current` / `new` 両方の除外と `new-capture` での実行・漏れた場合の結果は挙げたが、「無ければ撮らずに停止して `parity-suite` へ戻す」までは述べなかった（run-1 では述べていた。要約度によるぶれで、スキル側には記述がある）。
  eval-7 は assertion が変わっていないため run-1 を残し、`bbox` を照合キーとする追記後の run-2 も 5/5 で維持を確認した。
- **弁別が弱いのは eval 5・9（+0.50）と eval 8（+0.75）。** eval 9 のアサーション 1・2（観測条件の列挙・別条件の差ゼロを否定にしない）は一般的な実験計画の知識で到達でき、baseline も
  「差が実際に出ている領域を特定してから測れ」「プローブが的を外したと原因ではなかったは別物」に自力で到達した。差が付いたのは「比較の相手は常に現行」と「条件を書けない結論は未説明のまま残す」。
  eval 8 は baseline も「承認待ちを欄に明示する」2 段階に到達しており、差は分類欄の値（`許容候補（要確認）`）・収束判定への影響・レジストリへ書かない点だけだった。
  いずれも次イテレーションでスキル固有の述語へ寄せる余地がある（関連: `.kaizen/2026-07-23-eval-assertion-discrimination.md`）。
- 全 run で `is_error` はゼロ。with_skill はいずれも前提未達（`.replace/` も設定も無い）を検出したうえで停止し、成果物を捏造していない。
