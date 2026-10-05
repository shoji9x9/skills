---
date: 2026-10-05
type: doc
priority: low
status: pending
session: claude-code
---

# 既存の JSON を加工する使い捨てのスクリプトは、キーを読んでから書く

## 事象

同じセッションで、既存の JSON のキーを推測した使い捨てのスクリプトが 2 回失敗した。

- 受け入れ条件の表（`acceptance.json`）の行を `rows` で読もうとした。実際のキーは `items` だった。
- `.textlint/words.json` のすべての項目に `term` があるとみなした。`term` を持たない項目（同じ語の別の形）があり、`KeyError` になった。

どちらもその場で直したが、ツールのエラーが 2 件残った。

## 根本原因

- 誤った理由: キーを記憶と推測で書き、ファイルの構造を確かめずに実行した。
- 確かめなかった理由: 前に扱ったファイルなので、構造を知っていると思い込んだ。
- その理由: 規約の「識別子は原本を読んで転記する」は、ID・スクリプト名などを例にしている。データのキーには当てはめなかった。

## 提案

既存の JSON を加工する使い捨てのスクリプトは、先に最上位のキーと、項目ごとのキーの集合を出力して構造を確かめてから書く。

- 確かめ方の例は `node -e 'const d=require(f);console.log(Object.keys(d),[...new Set(d.entries.flatMap(Object.keys))])'`。
- 関連する学びは `2026-10-05-adhoc-script-labels-unverified`（使い捨てのスクリプトの出力を既知の入力で確かめる）。
