---
date: 2026-09-24
type: skill
priority: medium
status: pending
applied-to: []
session: claude-code
---

# push 直後の CI 待ちは、チェック未登録の非 0 を状態として扱う

## 事象

pr-finalize-loop で push 直後に
`gh pr checks --watch ...; echo rc; gh pr checks --required --json ...`
を 1 呼び出しで実行した。チェックが未登録で両コマンドが
`no checks reported` を返し、末尾の `--required` の非 0 が
ツール呼び出しのエラーとして記録された（kaizen 候補になった）。
同スキルは「必須チェック 0 件で --required は非 0 終了」と明記しており、
AGENTS.md にも「期待される非 0 を終了コードへ漏らさない」規律がある。

2026-09-25（Issue #478）: 変更前後の比較で `diff <(before) <(after)` を
1 呼び出しの末尾に置き、「差がある」を表す diff の exit 1 が
ツールエラーとして記録された（差分は想定どおり＝新規変異 2 件だけ）。
同じセッションで `oxfmt --check` を末尾に置いた呼び出しも、
生成直後の JSON の整形差で exit 1 を漏らした。

## 根本原因

- なぜ非 0 が漏れた? 前ラウンドで成功した待機コマンドを写し、
  push 直後という状態の違い（未登録）を分岐しなかった
- なぜ分岐しなかった? 未登録・pending・fail・pass の写像を毎回
  散文から組み立てる形で、定型化した呼び出しを写すと抜ける
- なぜ散文? pr-finalize-loop が CI 待ちの状態判定をスクリプトで
  同梱していない（同梱は resolve-review-tool.sh だけ）
- （2026-09-25 追記）なぜ CI 待ち以外でも漏れた? 判定用コマンド
  （diff / grep / --check）を裸で末尾に置いた。AGENTS.md の規律は散文で、
  使い捨ての比較コマンドを書く瞬間に照合される仕組みが無く、
  決定論的な検出は bash-command-guard に無い（kaizen 候補化で事後に拾うだけ）

## 提案

CI の待機・判定は状態を終了コードへ写像する同梱スクリプトで行い、未登録（no checks）を失敗として漏らさない。

- pr-finalize-loop に scripts/wait-required-checks.sh を同梱し、
  未登録の上限つき再確認・--watch・--required の判定をまとめ、
  0=全成功 / 1=失敗確定 / 3=上限まで未登録 のように状態を返す
- SKILL.md の「CI 状態の確認」をこのスクリプト呼び出しに置き換える
- 横断: pr-review-handle / issue-batch の CI 待ちも同じ形か確認する
- 横断（2026-09-25 追記）: CI 待ちに限らず、比較・検査コマンド（diff / cmp / grep /
  `--check`）を呼び出しの最終コマンドに置く ad-hoc 検証も同じ形。
  結果を `rc=0; cmd || rc=$?; case` で写像する
- 仕組み案: bash-command-guard に「最終セグメントが裸の diff / cmp /
  `--check`」を警告（ブロックでなく通知）する検査を足せるか検討する
