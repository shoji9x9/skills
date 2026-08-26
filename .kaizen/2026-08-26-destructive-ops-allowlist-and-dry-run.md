---
date: 2026-08-26
type: doc
priority: high
status: pending
applied-to: []
session: claude-code
---

# 破壊的操作は allowlist で対象を決め、絞り込みを外したら破壊フラグも外す

## 事象

eval の `timing.json` を「今回作った分だけ」残して撤去しようとして、
除外パス列挙 ＋ `-delete` を実行し、**過去セッション分 358 件を削除**した:

```bash
find tests -name timing.json \
  ! -path 'tests/current-environment-bootstrap/*' \
  ! -path 'tests/replace-strategy/iteration-14/*' -print -delete
# → 358 件（対象は 8 件のはずだった）
```

直前の試行は `-newermt '-10 minutes'` で「今回作ったもの」に絞る形だったが、
bfs がこの時刻書式を拒否（`Invalid timestamp`）。**`-newermt` を外して再実行した際、
絞り込みの主軸が消えたことに気づかないまま `-delete` を残した。**

消えたのは全て `.gitignore` 対象のローカル生成物で、`result.json` から再生成可能だった
（git 追跡下の benchmark 143 件は無傷）。実害は限定的だったが、それは偶然。

## 根本原因

- なぜ 358 件消えたか → **denylist（除外パス列挙）で書いた**ため、
  除外に挙げなかったものが全て対象になった
- なぜ denylist にしたか → 元の allowlist（`-newermt`）がツールに拒否されて外れ、
  残った述語（`-name timing.json`）が事実上「全件」だと認識できなかった
- なぜ認識できなかったか → **`-delete` を付けたまま実行し、対象を先に列挙して
  確認しなかった**。エラーで条件を 1 つ削ったとき、それが唯一の安全弁だったかを
  検査する手順が無い ← 根本原因

横断スコープ: リポジトリ内のスクリプト（`reinstall-skill.sh` / `run-skill-eval.sh`）は
`rm -rf -- "$var"` 形式で対象が自分で作った一時ディレクトリに限定され、
`reinstall-skill.sh` は `skill_name` を kebab-case に制限するガードまで持つ。
**穴があるのはエージェントが対話中にその場で書く使い捨てコマンド**であり、
コード側の規律が及ばない領域。

## 提案

`AGENTS.md`「ワークフロー」に追記する:

- **破壊的操作（`find -delete` / `rm -rf` / `git clean`）は、対象を denylist ではなく
  allowlist で決める。** 「これ以外を消す」ではなく「これを消す」と書く。
  除外列挙は、列挙し忘れた全てが対象に入る。
- **実行前に、同じ述語から破壊フラグだけを外して対象を列挙し、件数と中身を確認する。**
  想定件数と一致しなければ実行しない。
- **エラーで述語を 1 つ削ったら、それが唯一の絞り込みでなかったかを確認する。**
  絞り込みが消えたなら破壊フラグも一度外す（条件を削った再実行が最も危険）。
