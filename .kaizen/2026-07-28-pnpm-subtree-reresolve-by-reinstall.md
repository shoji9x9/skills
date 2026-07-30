---
date: 2026-07-28
type: skill
priority: high
status: applied
session: claude-code
---

# pnpm の transitive 再解決は「親を remove し同一 range で add し直す」で範囲を絞る

## 事象

Issue #124 (postcss high) で `pnpm update postcss` を `--depth Infinity` / `-L` /
`"*"` / `--config.minimumReleaseAge=0` の全変種で試したが 8.5.15 のままだった。
lockfile 全再生成なら 8.5.23 に到達するが 122 パッケージ変更（typescript 6→7 等の
major を含む）となる──と結論して報告した。

ユーザーから「postcss に依存するパッケージを一旦アンインストールし、同一バージョンを
入れ直す」提案を受けて実測したところ、
`pnpm remove vitest && pnpm add -D 'vitest@^4.1.7'` でサブツリーだけが再解決され
postcss 8.5.23 に到達。変更は 50 件・major ゼロ・package.json 無変更に収まった。

## 根本原因

- なぜ最良手を取りこぼしたか? → 探索を `pnpm update` の**オプション空間**に限定し、
  `remove` / `add` という別動詞を候補に入れなかった
  - なぜ動詞を広げなかったか? → 「pnpm は lockfile の既存 transitive 解決を保持する」
    というメカニズムを特定した後、その**前提（lockfile にエントリが在ること）を崩す操作**へ
    発想を進めず二者択一に畳んだ
    - なぜ発想が進まなかったか? → KEDB の 2026-06-17 / 2026-07-05 が選択肢を
      「pnpm update」「完全再生成」「surgical hand-edit」の 3 択として記録しており、
      **サブツリー単位の再解決という中間手段が playbook に無かった** ← 根本原因

KEDB 照合: `2026-06-17-pnpm-peer-keyed-transitive-update.md`（applied、2026-07-05 追記あり）と
同根の 3 回目の再発。applied のため追記せず恒久側（スキル）を更新する。

横断スコープ: pnpm を使う任意リポの transitive 脆弱性対応全般。ただし Issue #123
（markdownlint-cli2 > js-yaml）・#23（@prantlf/jsonlint > ajv）のように親が exact pin して
いる場合はこの手法でも解消しない。

## 提案

ツールが目的の状態変更を拒むときは、同じ動詞のオプションを広げるだけで結論せず、拒む理由
（メカニズム）を特定し、そのメカニズムの前提を崩す別の動詞・操作を候補に加えてから
「不可能／大規模変更しかない」と結論する。

具体的には `pnpm-audit-alert-issue` / `dependabot-alert-issue` に以下を追記する:

1. transitive を patched へ上げる第 4 の手段として「親（direct dependency）を remove し
   同一 range で add し直す」を追加。float はそのサブツリーに限定される。
2. 先に親の依存宣言が range か exact pin かを確認する。exact pin ならこの手法でも上がらず
   上流待ちになる。
3. 手順: `pnpm remove <親>` → `pnpm add -D '<親>@<元の range>'` → package.json の range が
   書き換わったら元に戻して `pnpm install --lockfile-only` →
   `pnpm install --frozen-lockfile` と test で検証 → name@version 比較で float 範囲を確認。
4. 選択肢の優先順: (a) direct dep なら直接更新 (b) 親 remove+re-add (c) surgical hand-edit
   (d) 完全再生成。

## 適用（2026-07-30・Issue #143）

`skills/dependabot-alert-issue/references/pnpm-transitive-update.md` に「手段の優先順」と
「親を remove して同一 range で add し直す」節を追加した（動詞を広げてから結論する旨・exact pin の事前確認・手順・Issue #124 の実測値）。
`pnpm-audit-alert-issue`（private skill）は同ファイルを参照する要約を更新し、「到達しなければ完全再生成」の二者択一を外した。
[[2026-07-23-pnpm-update-stdout-vs-lockfile-diff]] と同じ成果物へ統合して適用。
