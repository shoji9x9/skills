---
date: 2026-07-29
type: doc
priority: high
status: applied
session: claude-code
---

# 正規化で等値比較を直すときはズレうる軸を列挙し両辺に同じ正規化を当てる

## 事象

Issue #148（同梱スクリプトがシンボリックリンク経由でサイレント no-op）の修正で、CLI エントリ判定を
`import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href` に直した。通常のリンク起動では
期待どおり動いたが、`--preserve-symlinks-main`（NODE_OPTIONS 経由でも付く）では `import.meta.url` 側も
リンクパスのままになるため条件が偽になり、直そうとしていた無出力・exit 0 に戻る。レビュー指摘を受けて
実測で再現し、両辺 realpath 比較へ修正した。

## 根本原因

`.kaizen/2026-06-03-esm-cli-entrypoint-detection.md`（applied）で「エントリ判定は pathToFileURL で
正規化する」を一般化ルールとして確立したとき、正規化の軸を URL 表記（相対パス・エスケープ差）だけで
捉え、シンボリックリンク解決という別軸が両辺で非対称に効くことを見落とした。そのパターンが正しいものと
して配布スキル 4 本へ複製され #148 として顕在化した。今回の修正でも同じ捉え方が残り、片側だけに
realpath を足して症状が消えた時点で確定した。＝ 比較の両辺がどの軸でズレうるかを列挙せず、正規化を
1 つ足して終える進め方が根本原因。

## 提案

等値比較を「正規化」で直すときは、両辺がズレうる軸をすべて列挙し、同じ正規化を両辺に当てる。片側だけ・
一軸だけの正規化は、別軸や別オプションが効いた瞬間に同じ故障へ戻る。正規化に失敗したときの
フォールバックを、直そうとしている故障モード（サイレント成功）に倒さない。

- 基底ドキュメント（`AGENTS.md`）の「ワークフロー」節に 1 項追加する
- 横断スコープ: 非配布の `scripts/lint-pagination.js:252` / `scripts/check-skill-frontmatter.js:152` に
  片側正規化が残る（リンク起動しないため実害は無いが、複製元として誤読される）
- 配布スキル側の再発は `scripts/skill-script-cli-entry.test.js` が決定論的に防ぐ

## 反映

`AGENTS.md`「ワークフロー」節に検証規律として追加した（2026-07-29）。
