# Skill Benchmark: replace-strategy

**Model**: claude-opus-5
**Date**: 2026-08-23T03:24:56Z
**Evals**: 1（eval 20 のみ）(1 run each per configuration)

## Summary

| Metric | With Skill | Without Skill | Delta |
|--------|------------|---------------|-------|
| Pass Rate | 100% ± 0% | 40% ± 0% | +0.60 |
| Time | 96.3s ± 0.0s | 122.9s ± 0.0s | -26.6s |
| Tokens | 312778 ± 0 | 162164 ± 0 | +150614 |

## 対象と結果（Issue #211 横断 API 表のテーブル列）

eval 20（新規）は「どの機能も所有せず**横断 API からしか読まれないテーブル**（`MST_DB_ADMIN` / `MST_DB_ACCESS` / `MST_URL`）が
インベントリのどこに記録されるか」を見る。既存 eval 1–19 は本変更で挙動が変わらないため再測せず、コストを新規 eval に集中させた（iteration-11 / 12 と同じ方針）。
**コスト最小化のため各 configuration 1 run のみ**で、run 間分散は測っていない（± 0 は分散ゼロの実測ではなく単一 run）。

- **with_skill 5/5**: 横断 API 表に `db-context` 行を作り、fan-out に 3 slug、**参照テーブル列に MST_ 3 つ**を記録。
  機能一覧のテーブル列は各機能の所有テーブル（DBS / SEARCH_INDEX / ROLES）に保ち、MST_ を機能行へ付け替えなかった。
  画面専用 API（`/api/dbs` / `/api/search` / `/api/roles`）は横断 API 表に上げず機能行の「新規実装 API」に置いた
- **without_skill 2/5**: **横断 API の表そのものを作らず**、`db-context` を機能一覧の 1 行（F-00「DB コンテキスト」）として扱った。
  結果 MST_ 3 テーブルは**機能が所有するテーブル**として記録され、下流が「機能一覧のテーブル列＝機能が所有するテーブル」を前提に読むと所有者を誤る。
  fan-out 列も無く「被依存: F-01, F-02, F-03」という散文になり、`status` モードが機械的に引ける形になっていない

## 弁別性の所見

- **assertion 3（3 テーブルを取りこぼさず表に記録している）は両 config で pass** し弁別しなかった。
  baseline も MST_ 3 つを機能行として書いたため。**後退検知**用として残す（「置き場所が正しいか」は assertion 1・2・5 が見る）
- **assertion 4（画面専用 API を横断扱いに上げない）も両 config で pass**。baseline は横断 API 表を持たないので上げようがなく、
  「上げていない」が空振りで満たされた。テンプレートの列名（「新規実装 API」）には従っていないが、実質的挙動は満たすと採点した。これも後退検知用
- **弁別しているのは assertion 1・2・5 の 3 本**（with 3/3 pass・without 0/3 pass）。いずれも「横断 API 表という置き場所」に依存する項目で、
  Issue #211 が塞いだ欠陥（列が無いと置き場所が無い）に直接対応する
- トークンは with_skill が 313k・without_skill が 162k で約 2 倍。with_skill は `references/features-issues.md` 等の参照読みが乗るため。
  時間は with_skill のほうが 27 秒短い（baseline は構造を自分で設計し直すのに時間を使った）
- 1 run のため flaky 判定はできない。弁別 3 本は出力の構造差（表の有無）に依るため揺れにくいと見ているが、再測時に確認する
