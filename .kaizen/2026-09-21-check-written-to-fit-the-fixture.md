---
date: 2026-09-21
type: rule
priority: high
status: pending
applied-to: []
session: claude-code
---

# fixture の形に合わせて検査を書き、検査が実形状に当たっていないことを green が隠した

## 事象

PR #429（Issue #426 / #428）で 3 回起きた。

1. `append-only-manifest.json` の `mutable_blocks` に `intentional_diffs.pending` と書いたが、
   設定ファイルの実形状は `skills.replace-strategy.intentional_diffs.pending`。キーパスはルートから引くので一致せず、
   **#426 の修正が丸ごと無効なまま PR に載った**。テスト fixture も同じくフラットな YAML だったため、
   除外が発火してもしなくても 76 件すべて green で、レビューが実形状で測って初めて分かった。
2. キーパス検査の先読み `(?!-+$)` がセグメント境界を見ておらず、`targets.-.forbidden_actions` が通っていた。
   リストマーカーと同じ綴りを名指しできる穴で、**自分でテストを書いて初めて判明**した（書いたつもりの検査が効いていなかった）。
3. registry 要素の照合キーをリスト要素の 1 行目からしか読まず、YAML のキー順次第で正規の棚卸しが exit 1 になり、
   逆のキー順では宣言文言の差し替えが exit 0 で通っていた。

## 根本原因

- なぜ検査が無効だったか? → fixture の形（フラットな YAML）に合わせてキーパスを書いたため
- なぜ fixture が実形状と違ったか? → 「検査が動く最小形」として自分で組み立て、
  正本のスキーマ（`replace-strategy` の `references/project-config.md` の設定例）と突き合わせなかった
- なぜ突き合わせなかったか? → **テストが green であることを「検査が効いている」の証拠として扱った**。
  キーパスが一致しないと検査は厳しい側（行が単位のまま）へ倒れるので、**無効でも他のテストは通る**。
  green はこの向きの故障を一切区別しない ← 根本原因

横断スコープ: 同じ形は `growable_containers` / `registry_groups` にも、`.replace/**` の成果物パスを引く
`evidence-gap-check.mjs` / `pending-triage-check.mjs` にもありうる。いずれも「パスが当たらない＝何も検出しない」で、
対象 0 件を成功に倒さない規約（`AGENTS.md`）とは別の経路——**検出器は動いているがどこにも当たっていない**状態になる。

## 提案

設定ファイル・成果物のキーやパスを引く検査は、テスト fixture をその形式の正本の実例から起こす。

- 適用先: `.agents/rules/state-space-and-mutation-proof.md`（`paths: scripts/**` / `skills/*/scripts/**`）
- fixture を自分で組み立てたら、正本（スキーマ文書の設定例・生成側スキルのテンプレート）と
  入れ子の深さ・キー名・値の書式を 1 段ずつ突き合わせる
- **検査が当たっていることを陰性コントロールで実証する**——正本と同じ形状の入力を 1 つ置き、
  検査を無効化する変異でそのテストが落ちることまで確かめる（green だけでは「当たっていない」と区別できない）
