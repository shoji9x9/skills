---
date: 2026-10-18
type: hook
priority: medium
status: pending
applied-to: []
session: claude-code
---

# 型の検査は `pnpm run typecheck` で確かめ、自分で組んだ `tsc --noEmit -p .` の出力が空であることを合格の根拠にしない

## 事象

PR #698（Issue #663）で `scripts/lib/testing/child-timeout.ts` に `ts.skipOuterExpressions` を使った。
直した後の確認に `pnpm exec tsc --noEmit -p .` を実行し、出力が空だったので型の検査を通ったと判断した。
しかしこのリポジトリの型の検査は、プロジェクトの参照をたどる `tsc -b`（`pnpm run typecheck`）で、ルートの `tsconfig.json` 単体は `scripts/` を含まない。
`ts.skipOuterExpressions` は型の宣言に無い内部の API なので、commit の前の `typecheck` が TS2551 で止めて初めて分かった。

## 根本原因

- なぜ誤ったか → 検査するツールをそのまま実行せず、似た `tsc` の呼び出しを自分で組んだ
- なぜ気付かなかったか → 出力が空であることを、検査が対象を読んだ証拠として扱った。`AGENTS.md` の「0 件の結果を合格として扱わない」を、型の検査に当てなかった
- 既存の規約 → 「規約を満たすかは、その規約をチェックするツールをそのまま実行して確かめる」に当たる

## 提案

型の検査は `pnpm run typecheck` で確かめ、自分で組んだ `tsc --noEmit -p .` の出力が空であることを合格の根拠にしない。

- 適用先候補: `docs/agent-workflow.md`「規約を満たすかは、その規約をチェックするツールで確かめる」の例に、型の検査は `pnpm run typecheck` で確かめることを足す
- 適用先候補: Bash の PreToolUse の Hook で、`tsc --noEmit -p .` の形を検出して `pnpm run typecheck` を案内する
