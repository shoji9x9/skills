---
date: 2026-09-02
type: rule
priority: medium
status: pending
applied-to: []
session: claude-code
---

# eval の assertion と fixture は「正本に実在する形か」を突き合わせてから確定する

## 事象

Issue #276 で eval 26 と新規 fixture を作り、code-review で 3 件を差し戻した。

- assertion 1 が `#101`（features.md ヘッダのゴールデンデータセット Issue）の取得を要求したが、
  `references/status.md` の導出項目 1〜7 はヘッダ項目を対象にしていない。
  契約に忠実な run は `#102`/`#103`/`#104` だけを引くため落ちる（偽陰性を回帰テストに埋め込んだ）。
- fixture の `parity/order/metadata.json` に正本に無いキー `current_commit` を書き、
  `dataset_version` を `"3"`（文字列）にした。正本は `target.commit` と数値。
- `strength.md` / `gaps.md` を自由形式の箇条書きで書いた。正本（`parity-suite`）が出す表形式ではなく、
  実在しない入力に対する挙動を測る eval になっていた。

## 根本原因

- なぜ偽陰性・非実在形式になったか? → assertion の根拠を「スキルの契約文」ではなく
  **自分が今書いた fixture の中身**（そこに置いた番号）から取り、fixture の形を思いつきで決めた
  - なぜ? → 新規 fixture は自分で書くので、突き合わせる相手（生成側スキルの様式・
    消費側スキルの導出項目）を開かなくても最後まで書けてしまう
    - なぜ気付かなかった? → `.agents/rules/eval-assertion-discrimination.md` の 5 点は
      「**測れるか**」（弁別・到達・材料・主価値・入力が答えを持っていないか）だけを問い、
      **「その要求・その形が正本に実在するか」を問う項目が無い** ← 根本原因（対策可能）

横断スコープ: 全 fixture の JSON キー形状を走査した。`parity/<slug>/metadata.json` は他の 6 fixture が
`artifacts_storage` / `capture_conditions` / `differ` / `noise_baseline` / `suite` / `traits` を持つのに対し、
今回のものだけ 5 キーの外れ値だった（eval が読む範囲に絞る意図的な疎はありうるが、
正本と突き合わせた形跡が無い点が問題）。他スキルに同種の逸脱は見つからなかった。

KEDB: [[2026-08-12-eval-prompt-change-breaks-assertion-reachability]] /
[[2026-08-31-eval-assertion-skill-bundle-boundary]] は同じ rule の**到達**の話（prompt 編集・
バンドル境界）で、機構が違う。どちらも applied のため追記せず恒久側を強化する。

## 提案

eval の assertion と fixture は、書いた時点で**正本に実在する形か**を突き合わせてから確定する。
assertion の根拠は自分が置いた fixture の中身ではなくスキルの契約文に取り、fixture の様式・キー・型は
その成果物を生成する側のスキルの正本に合わせる。

`.agents/rules/eval-assertion-discrimination.md` の検査項目に 6 点目を足す:

- **正本整合**: assertion が要求する挙動が**スキルの契約に実在する**かを、契約文（`SKILL.md` /
  `references/`）を開いて確かめる。fixture に置いた値から逆算して要求を作らない
  （fixture に番号があることは、スキルがそれを引く契約の証拠ではない）。
  fixture の様式・キー名・型は、その成果物を**生成する側のスキル**の正本に合わせる
  （同種の実物 fixture があるならそれを雛形にする）。正本に無いキーを発明しない・型を変えない——
  実在しない入力に対する挙動を測る eval は、本番で起きない故障だけを検出し、
  本番で起きる故障を見逃す。
