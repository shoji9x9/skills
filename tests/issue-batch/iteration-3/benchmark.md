# Skill Benchmark: issue-batch

**Model**: claude-opus-5[1m]
**Date**: 2026-08-21T02:39:24Z
**Evals**: 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15 (1 run each per configuration; eval 1-6 with_skill と eval 2 without_skill は 2 run)

## Summary

| Metric | With Skill | Without Skill | Delta |
|--------|------------|---------------|-------|
| Pass Rate | 100% ± 0% | 46% ± 33% | +0.54 |
| Time | 66.3s ± 29.8s | 74.8s ± 29.0s | -8.5s |
| Tokens | 3444 ± 1941 | 2579 ± 1421 | +865 |

## 実行条件

- 実行日: 2026-08-20〜21（Issue #176）
- ハーネス: `scripts/run-skill-eval.sh`。**両 configuration とも** `scripts/eval-sandbox.sh` の bwrap サンドボックス経由（全 run の `isolation.txt` が `sandboxed`）
- executor / analyzer: `claude-opus-5[1m]`（`--model` 未指定の既定。両 configuration 同一）
- run 数: 原則 1 run / configuration。eval 1〜6 の with_skill と eval 2 の without_skill のみ 2 run
- 全 baseline の `contamination.txt` は `verdict: clean`

### eval 別 Delta

| eval | with | without | Delta |
| --- | --- | --- | --- |
| 1 | 8/8 (100%) | 0/4 (0%) | +100pt |
| 2 | 4/4 (100%) | 0/2 (0%) | +100pt |
| 3 | 4/4 (100%) | 1/2 (50%) | +50pt |
| 4 | 4/4 (100%) | 1/2 (50%) | +50pt |
| 5 | 8/8 (100%) | 1/4 (25%) | +75pt |
| 6 | 6/6 (100%) | 2/3 (67%) | +33pt |
| 7 | 2/2 (100%) | 2/2 (100%) | **+0pt** |
| 8 | 4/4 (100%) | 0/4 (0%) | +100pt |
| 9 | 3/3 (100%) | 3/3 (100%) | **+0pt** |
| 10 | 4/4 (100%) | 3/4 (75%) | +25pt |
| 11 | 4/4 (100%) | 3/4 (75%) | +25pt |
| 12 | 4/4 (100%) | 2/4 (50%) | +50pt |
| 13 | 4/4 (100%) | 1/4 (25%) | +75pt |
| 14 | 3/3 (100%) | 1/3 (33%) | +67pt |
| 15 | 3/3 (100%) | 1/3 (33%) | +67pt |

## 除外した run

| run | 理由 |
| --- | --- |
| `tests/issue-batch/iteration-2/**` | レート制限解除確認プローブと修正前バンドルでの targeted eval。正式 benchmark に混ぜない |
| iteration-3 eval 7〜15 の初回 | セッションのレート制限（HTTP 429 / `is_error: true`）で全滅。成果物を削除し、制限解除後に取り直した |
| `eval-2/without_skill/excluded-contaminated-run-1/` | 汚染判定 CONTAMINATED。ただし marker の偽陽性（同ディレクトリの `EXCLUDED.md` に詳細）。marker 修正後の `run-2` を採用 |

429 の run は `contamination.txt` が `verdict: clean` と記録されるが、これはエラー応答を走査した結果であって
無汚染の証拠ではない。`is_error: true` の run は汚染判定にかかわらず無効として扱った。

## バンドル変更のタイムライン

with_skill run は `skills/issue-batch/` 全体を使い捨てプロジェクトへコピーして実行されるため、
sweep 途中のソース修正は with_skill 側の測定対象を変える（baseline はスキル未設置なので影響を受けない）。

| 時点 | 変更 | 影響 |
| --- | --- | --- |
| sweep 前 | `evals/README.md` から採点基準・eval トピック表を削除し、`--eval` 誤記を `--prompt` へ修正 | iteration-3 全体が修正後で統一 |
| sweep 前 | eval 13 prompt に `main` を追加、eval 6 prompt に引き渡し契約を問う一文を追加 | iteration-3 全体 |
| eval 5 baseline 完了後 | `references/project-config.md` に `review_tool` の意味論を明確化 | eval 1〜6 の run-1 は修正前、eval 7〜15 は修正後。eval 1〜6 は run-2 で修正後を再測定済み |

## analyst notes

### 弁別しなかった eval（Delta 0）

原因は read 汚染ではなく **assertion が一般論で満たせる**こと。次 iteration で検査項目を差し替える。

| eval | 原因 | 差し替え候補（skill 固有の語彙・成果物・停止条件へ寄せる） |
| --- | --- | --- |
| 7（browser 分岐） | 「Markdown 差分ならブラウザ検証は不要」「変更ファイル一覧と消費経路を根拠にする」は一般論で到達できる | `not-applicable` を状態値として使う／manifest に検証名・結果・証拠 URL / SHA を記録する／PR 本文に非適用根拠を含める／逆引き不能かつ環境が無人不可なら BLOCKED へ倒す |
| 9（BLOCKED 方針） | 「隔離可能な失敗は隔離」「fail-fast フラグは独立性より優先」「共有前提の破壊は全体停止」は標準的なバッチ実行セマンティクス | `continue_on_blocked` というキー名／setup 値が正本で CLI override は当該 run 限り・設定ファイルを書き換えない／BLOCKED worktree を保持し絶対パスと残作業を最終報告に残す |

### 個別 assertion 単位の非弁別（後退検知として保持）

- eval 3「設定、Issue、branch、PR を変更前に停止する」/ eval 4「branch / worktree / PR を作る前に全体を停止する」
  — プロンプト自体が副作用の有無を問い、スキル不在の baseline は実行手段が無いため自動的に満たす
- eval 5「一意な既存 branch / PR を再利用し、重複を作らない」— fixture の `state.json` から直接演繹でき、baseline も「冪等な skip」として満たす
- eval 6「auth: user と禁止されたデータ変更を preflight で検出する」「ログインや禁止操作解除を求めず BLOCKED にする」
  — fixture の skills.yml に平文で書かれた値と、プロンプトが直接問うている論点。eval 6 で弁別したのは handoff 契約の 1 項目のみ
- eval 10 assertion 2〜4（`--match-head-commit`／auto-merge 予約と MERGED の区別／手動 close しない）
  — GitHub 運用一般の知識で満たせる。baseline は 3 値判定（PASS / FAIL / UNKNOWN）まで自力で構成した。弁別したのは `pr-finalize-loop` への委譲一本化のみ
- eval 11 assertion 2〜4 — fixture が run 10 / run 11 という弁別材料を持つため、baseline も headSha 照合の必要性を導出した。弁別は base branch 照合のみ
- eval 14 assertion 1（解決値の算出）— fixture の skills.yml と CLI 引数の突き合わせで解ける

### run 間で揺れた項目（flaky）

- **eval 2「usage を示す」**: run-1 は option 一覧付きの usage ブロック、run-2 は修正済みコマンド形 2 行。assertion を
  「サブコマンドと option の一覧を示す」まで具体化すると安定する
- **eval 2「Issue の取得を行わない」**: iteration-2 と iteration-3 run-1 の baseline は Issue を取得しなかったが、
  run-2 の baseline は `gh api` GET で #101 / #102 を実取得して assertion を落とした。baseline が sandbox 外の
  public repo へ到達するかが run ごとに変わる。3 run 取って安定性を見るべき
- **eval 14 のプロンプト**: 「〜を dry-run し」を存在しない CLI option `--dry-run` と解釈した run があった
  （他 eval では同じ言い回しを指示として正しく読んでいる）。「dry-run として（実操作せず）報告して」へ直すと安定する

### 時間・token のトレードオフ

baseline は毎回「スキルが存在しない」ことの調査（`~/.claude/skills` 走査、プラグイン一覧、ファイルシステム全体検索）に
時間を使い、そのうえで一般論を組み立てている。with_skill はバンドルを読んで契約をなぞるため探索が短く、
その分を報告の密度（状態遷移表・述語・誤認しやすい点）に充てている。

### 修正の効果（再検証）

`references/project-config.md` の `review_tool` 明確化前は、eval 1 / 4 / 6 の with_skill が
`skills.common.review_tool` を「ローカルレビューの実行主体」と読み、正常系 fixture に対して
誤った BLOCKED を出していた。明確化後の run（eval 1 run-2 / 4 run-2 / 6 run-2 / 8 / 12 / 14 / 15）はいずれも
「`review_tool` は `pr-finalize-loop` の reviewer 指定であって停止条件ではない」と明示的に切り分けており、
誤 BLOCKED は 1 件も再現していない。
