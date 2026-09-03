# 被覆プロファイル

UI 部品ごとの確認軸を宣言するファイル群。契約は [`../../references/coverage-profiles.md`](../../references/coverage-profiles.md)、
形式の正本は [`profile-schema.json`](profile-schema.json)。

`scripts/coverage-expand.mjs` はこのディレクトリからプロファイルを読む
（**配布スキル内に同梱され、インストール先へ外部参照を要求しない**）。

## 追加手順

1. `<id>.json` を作り、`profile-schema.json` の形式で `axes` / `enumeration` / `candidate_rules` /
   `required_rules` / `equivalence` を宣言する。`id` はファイル名（拡張子を除く）と一致させる
2. `references/coverage-profiles.md`「同梱プロファイル」の表に 1 行足す
3. `scripts/coverage-expand.mjs` と `references/coverage-profiles.md` の**契約部分は変更しない**。
   変更が要るなら共通処理の抽象が足りていない（部品固有の条件分岐を共通処理へ入れない）

`scripts/coverage-expand.mjs --list-profiles` で読み込めるプロファイルを列挙できる。
形式が壊れたプロファイルは静かに無視せず、その場で落ちる。

## 軸の設計

- **`element` 軸はインスタンスごとに列挙が要る軸**（列・メニュー項目のように、画面ごとに数と内容が変わるもの）。
  `flags` に、その軸の要素が持ちうる真偽フラグを宣言する。`candidate_rules[].guard` はここに宣言した
  フラグしか使えない（誤記したフラグ名が候補ゼロで通らないようにするため）
- **`enum` 軸は部品共通で固定の軸**（ソート方向のように、どのインスタンスでも同じ値を取るもの）。`values` に列挙する
- **`required_rules` には「列挙されないと静かに 0 件になるルール」を入れる。**
  そのルールが候補を生まなかったら失敗する。「その部品には無い」を主張したいなら、
  列挙側の `enumeration.justified_absences` に軸スコープの根拠を残す
  （逃げ道が無いと、フラグを偽って `true` にする以外に収束できなくなる）
- **`equivalence.reducible_axes` には、描画が同じになりうる軸だけを入れる。**
  方向・対象・条件のように描画が変わる軸を入れると、代表 1 件の採取で差分が見えなくなる
