# 網羅プロファイル（coverage profile）

UI 部品ごとに確かめる軸を宣言するファイルの置き場所。取り決めは [`../../references/coverage-profiles.md`](../../references/coverage-profiles.md) で、
形式は [`profile-schema.json`](profile-schema.json) で定義する。

`scripts/coverage-expand.mjs` は、このディレクトリからプロファイルを読む。
プロファイルは配布スキルの中に同梱するので、インストール先に外部のファイルを求めない。

## 追加手順

1. `<id>.json` を作り、`profile-schema.json` の形式で `axes` / `enumeration` / `candidate_rules` /
   `required_rules` / `equivalence` を宣言する。`id` はファイル名（拡張子を除く）と一致させる。
   各ルールには `visual_states` も書く。値は、その操作で現れる見た目の状態（`opens-container` / `hover` / `focus` / `active` / `disabled` / `after-operation`）である。
   空の配列にするなら、`no_visual_state_reason` に理由を書く。キーを省くと、「見た目が変わらない」と「考えていない」を区別できないので、検査が失敗にする
2. `references/coverage-profiles.md` の「同梱プロファイル」の表に 1 行を足す
3. `scripts/coverage-expand.mjs` と `references/coverage-profiles.md` の取り決めの部分は変えない。
   変える必要が出たら、共通の処理の抽象が足りていない。部品に固有の条件分岐を、共通の処理に入れない

読み込めるプロファイルは、`scripts/coverage-expand.mjs --list-profiles` で一覧にできる。
形式の誤ったプロファイルは、警告なしに読み飛ばさず、その場で失敗にする。

## 軸の設計

- `element` 軸は、インスタンスごとに列挙が要る軸に使う。列やメニューの項目のように、画面ごとに数と内容が変わるものである。
  `flags` には、その軸の要素が持ちうる真偽のフラグを宣言する。`candidate_rules[].guard` は、ここに宣言したフラグしか使えない。
  フラグの名前を書き誤ったときに、候補が 0 件のまま検査を通らないようにするためである
- `enum` 軸は、部品で共通の固定の軸に使う。ソートの向きのように、どのインスタンスでも同じ値を取るものである。値は `values` に列挙する
- `required_rules` には、列挙されないと警告なしに 0 件になるルールを入れる。
  そのルールが候補を 1 件も作らなかったら、検査は失敗にする。「その部品には無い」と主張するなら、
  列挙の側の `enumeration.justified_absences` に、軸の範囲での根拠を残す。
  この逃げ道が無いと、フラグを偽って `true` にする以外に検査を通す方法が無くなる。
  同じ要求を排他な `guard` で分けたルールは、どれにも同じ `requirement` を書く。そのうえで、ルールの id の配列（代わりになる組）を 1 つの要素として書く。どれか 1 つが候補を作れば、要求を満たす
- `equivalence.reducible_axes` には、描画が同じになりうる軸だけを入れる。
  向き・対象・条件のように描画が変わる軸を入れると、代表の 1 件だけを採るので差分が見えなくなる
