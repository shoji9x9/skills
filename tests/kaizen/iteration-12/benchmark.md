# Skill Benchmark: kaizen

**Model**: claude-opus-5
**Date**: 2026-08-28T14:31:51Z
**Evals**: 18（1 run each per configuration）

## スコープ

Issue #244（`.extract-done` がセッション全体を抽出済みにするため、1 本の branch で複数 commit すると
最初の commit までの活動しか抽出されない）で追加した eval 18 のみを実行した。
既存 eval は再実行していない（コスト最小化。走査器のロジック自体は未変更）。

## Summary

| Metric    | With Skill    | Without Skill | Delta      |
| --------- | ------------- | ------------- | ---------- |
| Pass Rate | 86% (6/7)     | 14% (1/7)     | +0.72      |
| Time      | 125.0s        | 107.6s        | +17.5s     |
| Tokens    | 455311        | 147724        | +307587    |

1 run ずつのため標準偏差は測っていない（表の ± 0 は分散の実測値ではない）。

## Per-assertion

| # | assertion（要約）                                        | with | without |
| - | -------------------------------------------------------- | ---- | ------- |
| 1 | checkpoint より後の未処理範囲を走査する                   | ✅   | ❌      |
| 2 | extract-done に transcript path を渡す（省略しない）      | ✅   | ❌      |
| 3 | `.extract-done` は checkpoint 不可時だけの fail safe      | ✅   | ❌      |
| 4 | checkpoint がある間はマーカーを尊重せず再走査する         | ✅   | ❌      |
| 5 | scanner の exit code 契約（0/1/2）を具体的に説明する      | ✅   | ❌      |
| 6 | 2 回目の抽出は checkpoint より後だけを読み重複起票しない  | ❌   | ❌      |
| 7 | マーカー先置き・センチネル手動削除の回避策を勧めない      | ✅   | ✅      |

## assertion 5 の書き換え（初版は弁別しなかった）

初版「新しい活動に候補が無ければ通り、あれば再ブロックされると区別している」は without_skill でも通った。
ベースラインが `git diff --cached` / `git log` による独自の推測でも同じ二値（通る／止まる）を言い当てられたため、
**弁別性ゼロ**だった（`eval-assertion-discrimination.md` の「一般的な振る舞いは baseline も自力で満たす」に該当）。

candidate scanner の exit code 契約（`0`=候補あり／`1`=検証済みゼロ／それ以外=不明）を明示させる形へ書き換えて
既存 2 run（新規 API 呼び出しなし）を再採点した。with_skill の応答は元々この契約を詳述しており、
without_skill の応答は本文全体を「契約」「exit」「scan」で検索して 0 件——スキル固有の語彙を要求することで
真陽性のまま discriminate するようになった（Delta は +0.57 → +0.72 に上昇）。

## assertion 7 は書き換えを断念した

否定形（回避策を勧めていない）が without_skill でも通る理由は「ベースラインが制御ファイルの存在自体を知らず、
勧めようがない」という構造的な無知であり、機構固有の語彙を足しても baseline は知らないものを提案できない。
assertion 2（transcript 付き extract-done を推奨する）と正の面で重複させない限り弁別化できず、
重複させると別の assertion の焼き直しになる。**この eval では測れないと結論し、Delta には寄与しない
後退検知専用として残す**（`docs/skill-development.md` の eval-assertion-discrimination 方針どおり）。

## 判明した課題

- **assertion 6 が with_skill でも不達。** 走査器が checkpoint 以降だけを読むことは説明できたが、
  **抽出（エージェント側の読み取り範囲）**を checkpoint 以降に限る規律（`references/extract.md` 手順 2 に追記した内容）は
  応答に出なかった。到達性の問題か、プロンプトがそこを問うていないかは 1 run では切り分けられない。

## 取り直した run

- **eval 18 / without_skill / run-1（初回試行）**: `contamination.txt` の `verdict` が `CONTAMINATED`。
  ベースラインが `~/projects/skills/.agents/skills/kaizen/` を読み、**変更前**の設計
  （「ゲートはセッションにつき 1 回だけ抽出を要求する」）を説明していた。
- **原因**: `scripts/eval-sandbox.sh` は自身のパスから `repo` / `repo_parent` を求める。git worktree（`/tmp` 配下）から
  実行するとその親は `/tmp` になり、**メインチェックアウト（`~/projects/skills`）が遮断対象に入らない**。
  worktree で作業しているときだけ開く穴で、隠す対象がそのリポジトリの installed copy（別リビジョン）なので
  「スキル無しのベースライン」として最悪の汚染になる。
- **対処**: `git worktree list --porcelain` が返す全 work tree の親を tmpfs で隠す処理を `eval-sandbox.sh` に追加し、
  取り直して `verdict: clean` を得た。集計に載っているのは取り直し後の run のみ。
  `--verify` を worktree 内から実行すると step 2 が `$PWD` を bind で戻すため過去 run の成果物が marker に当たる。
  修正の確認は「`$HOME` root の陽性コントロールが見つかったうえで、メインチェックアウト由来の hit が 0 件」で取った。
