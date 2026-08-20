---
date: 2026-08-20
type: doc
priority: medium
status: pending
session: claude-code
---

# 対象 0 件で no-op になる一括更新スクリプトも「該当が無い」を成功扱いしない

## 事象

issue-start の eval 回帰（iteration-3）集計で、`grading.json` 30 件に
`timing.total_duration_seconds` を足す一括更新を相対パス glob で書いて実行したところ
`patched 0` と出た。非ゼロ終了させていないため成功と読め、そのまま再集計した
benchmark は Time 0.0s のままだった。実際は 30 件すべて未パッチで、直後に絶対パスで
再実行して 30 件パッチされたことで発覚した。

直接の引き金は cwd。直前の呼び出しが `cd <skill-creator>` しており、次の Bash 呼び出しでも
その cwd が残っていた（同セッションで `cd tests/issue-start/iteration-3` が
`No such file or directory` になったことでも裏付けられる）。

## 根本原因

- なぜ 0 件のまま先へ進んだか？ → スクリプトが 0 件を失敗にせず `patched 0` と出して正常終了した
  - なぜ 0 件になったか？ → 相対パス glob を使い、cwd が前の呼び出しの `cd` を引き継いでいた
    - なぜ相対パスで書いたか？ → `AGENTS.md` の「『該当が無い』を根拠にする検査・走査は
      陽性コントロールで…」を**検査・走査だけの規律**と読み、一括**更新**スクリプトを
      対象外と扱ったため ← 根本原因

KEDB 照合: `2026-06-08-eval-isolation-cd-not-persisted.md`（applied）と
`2026-06-16-relative-path-hook-cd-stray-sentinel.md`（applied）が cd／相対パスで既出。
ただし両者は「cwd がリセットされる」前提で、今回は逆に**持続**した。
cwd の振る舞いは呼び出し間で保証されないと扱うのが正しい。

横断スコープ: 使い捨ての一括更新・sed/patch・ファイル移動スクリプト全般。

## 提案

基底ドキュメント（`AGENTS.md`）の該当節で、対象を「検査・走査」から
「**0 件で no-op になりうる一括処理全般（更新・patch・移動を含む）**」へ広げ、次を明記する:

- パス依存の一括処理は絶対パスで書く（cwd は Bash 呼び出し間で保証されない）
- 対象 0 件は成功に倒さず非ゼロ終了にする（処理件数を必ず出力する）
