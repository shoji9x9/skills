# Skill Benchmark: replace-strategy

**Model**: claude-opus-5
**Date**: 2026-08-23T01:30:13Z
**Evals**: 1（eval 19 のみ）(2 runs each per configuration)

## Summary

| Metric | With Skill | Without Skill | Delta |
|--------|------------|---------------|-------|
| Pass Rate | 100% ± 0% | 20% ± 0% | +0.80 |
| Time | 91.2s ± 0.4s | 132.7s ± 8.8s | -41.4s |
| Tokens | 185171 ± 46956 | 174882 ± 120 | +10288 |

## 対象と結果（Issue #209 features.md の 4 種以外 Issue 枠）

eval 19（新規）は「4 種に還元できない Issue（新側スキーマの前倒し #47）を features.md のどこに記録するか／行に何を書くか／識別子の採り方／
ヘッダ独自項目は書き直しで消えるか／移設後 `status` にどう出るか」の 5 点を見る。
既存 eval 1–18 は本変更で挙動が変わらないため再測せず、コストを新規 eval に集中させた（iteration-11 と同じ方針）。

- **with_skill 5/5 × 2 run**: 記録先を「その他の Issue（4 種以外）」表と特定し節ごと追加を提案、
  `4 種に当てはまらない理由` / `影響範囲` / 行ごとの依存順を必須項目として挙げ（4 種は種類で順序が決まる点と区別）、
  slug はインベントリ全体で一意だが `.replace/parity/<slug>/` を持たず下流スキルの対象外、
  非破壊更新の契約（テンプレートは雛形で上限ではない／テンプレートに無い項目を削除しない）、
  `status` は報告順の先頭に出し強度・ベースライン・フェーズ B・差分は「対象外」として未着手と区別、まで一致。
  2 run とも**ファイルを書き換えず提案に留めた**（「承認を得てから移す」契約に従った）
- **without_skill 1/5 × 2 run**: 通ったのは slug（`schema`・小文字 ASCII・一意）の 1 本だけ。記録先は run-1 が「横断 API 表」、
  run-2 が「機能一覧表」と**両 run とも別の表へ誤配置**し、run-2 はさらに**ヘッダの `- スキーマ Issue: #47` を承認なしに削除して features.md を書き換えた**
  （契約が禁じる「黙って移す・黙って消す」そのもの）。非破壊更新については run-1 が「次の書き直しで落ちる」と契約と逆の推測を述べた

## 弁別性の所見

- **assertion 3（slug）は両 config で pass** し弁別しなかった。fixture の既存 slug（`order` / `report` / `user`）から一般推論できるため。
  他の 4 本が 2 run とも 0/2 → 2/2 で分かれているので eval 全体の Delta は保たれるが、この 1 本は後退検知用として残す
- 残り 4 本は run 間のばらつきが無く（with 2/2 pass・without 0/2 pass）、flaky ではない
- トークンは with_skill が平均 185k・without_skill が 175k で大差なし。時間は with_skill のほうが約 40 秒短い
  （baseline は根拠が無いため探索・ファイル編集に時間を使った）
