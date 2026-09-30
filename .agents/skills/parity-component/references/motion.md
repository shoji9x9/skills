# 動きの列挙と時系列の突き合わせ

見た目の照合は `animations: "disabled"` で止めて撮るので、**部品が持つ動き（出し入れ・開閉のアニメーション）はどの採取物にも写らない**。
操作の突き合わせも「出た・消えた」の結果だけを見て「どう出たか」を見ない。新側が即時に出る実装のまま、部品の照合・スイート・`parity-diff` がすべて緑になる。
一般論の「アニメーションは対象外」（`replace-strategy` の `references/scope.md`）は**画素の差分比較の手法の話**で、部品の動きを写さない理由にはならない。

そこで `capture` が部品に掛かる動きを数えて時系列を採り、`build` がカタログの見本で同じ遷移を採って、**遷移 × インスタンス**ごとに数値で比べる。
採るのは同梱の [`../scripts/motion-probe.mjs`](../scripts/motion-probe.mjs)（探針）、比べるのは [`../scripts/motion-compare.mjs`](../scripts/motion-compare.mjs)（コピーせずスキル配下から実行する）。

## 動きを数える（capture）

**ソースと実機の両方で数える。** 片方だけでは、市販部品の内部の動き（ソースに呼び出しが無い）や、条件付きでしか掛からない動き（実機で通らない経路）を取りこぼす。

- **ソース**: 現行の部品の JavaScript で、動きを起こす呼び出し（jQuery の `animate`、長さや効果を渡した `show` / `hide` / `toggle`、`slide*` / `fade*`、jQuery UI の効果）を、
  CSS では採取した `css-rules.json` の `matched` に現れる `transition` / `animation` 系の宣言と、それが参照する `@keyframes` を数える。
  見つけた箇所を `metadata.json` の `capture.motions.source_scan` に書く
- **実機**: 部品の状態の間の遷移（出る・消える・開く・閉じる・展開する）と、`capture.operations` のうち見た目が変わる操作に、探針を 1 回ずつ当てる。
  長さが 0 でなければ動きがある。**ソースで見つからなくても実機で動いたら遷移として数える**
- 数えた遷移を `capture.motions.transitions[]` に `id` / `description` / `trigger`（見本でも同じに再生できる手順）/ `declared`（ソースが宣言する長さ・緩急・移動量）で書く。
  **遷移の集合は全インスタンスで共通にする。** そのインスタンスで起こせない遷移だけを `instances[].unreachable_motions` に理由付きで宣言し、同じ内容を `gaps.md` に残す
- **遷移に入れるのは、探針が採れる動き（要素の矩形か実効の不透明度が変わるもの）だけにする。** 色・背景・影だけが移り変わる動き（`transition: color .2s` 等）は
  探針に写らないので、遷移に入れると現行の時系列が必ず「動かない」になり、`declared` があると `motion-baseline-static` で落ちる。
  そうした動きは `source_scan` に残し、遷移には入れず、部品ごとに `gaps.md` へ「探針の射程外の動き」として残す（下記「射程」）
- **探針で比べる動きが無い部品は `transitions` を空にし、`none_reason` に何を数えて無かったか（または射程外の動きしか無かったこと）を書く**（理由の無い空は検査が型崩れとして落とす）
- **既定値を決める前に、現行でその動きを出す全経路を数える**（規律の正本は [`amend.md`](amend.md)「現行に合わせ直す修正」の手順 2）。
  全経路が同じ動きなら既定をその動きにし、一部だけなら引数にする

## 時系列を採る

- motion-probe.mjs は Playwright のスペックから import するので、`parity-suite` 同梱ツールと同じく `<parity_suite_dir>/parity/lib/tools/vendor/` へコピーして使う
  （コピー元は**本スキルの** `scripts/motion-probe.mjs`。無ければそのままコピー、在ればバイト列で一致を確かめ、違えば上書きせず停止する。
  コピーと一致確認の規律は [`capture.md`](capture.md)「`parity-suite` 同梱ツールの用意」の手順 2・3 と同じ）。
  コピー先を `capture.tools.motion_probe` に、`VERSION` を `motion_probe_version` に、コピーしたファイルから読んで記録する
- **探針のあいだはアニメーションを止めない。** 見た目の採取の「ページ側でまとめて止める」仕掛けを外して開き直す。止めたまま採ると、動きのある部品も長さ 0 に記録される
- **各遷移は同じ初期状態から始め、同じ条件で 2 回採る。** 最初の 2 回の差が揺れ（フレームの刻み・操作が届くまでの遅れ）で、許容差はここから決まる（3 回目以降は使わない）。
  揺れが上限を超えた組（例: 1 回目は 600ms 動き 2 回目は即時）は許容差を広げず `motion-baseline-unstable` で落ちるので、遷移の手順か初期状態を揃えて採り直す。
  `declared` に動きの宣言があるのに現行が一度も変化しなかった時系列も `motion-baseline-static` で落ちる（止めたまま採った・別の要素を引いた疑い）
  結果は `baseline/<instance>/motions.json` の `results[].runs` に積む（様式の正本: [`../assets/motions-template.json`](../assets/motions-template.json)）

  ```ts
  // import 先はスペックの置き場所から見た <parity_suite_dir>/parity/lib/tools/vendor/ のコピー
  import { probeMotion } from "<vendor>/motion-probe.mjs";

  const timeline = await probeMotion(page, {
    selector: ".feedback-message", // 動く要素。片側の実装に固有でよい（比べない）
    trigger: () => page.getByRole("button", { name: "保存" }).click(),
  });
  ```

- セレクタは CSS で書く（出る動きでは操作の前に要素が無く、ロケータを先に解決できないため）。その文書で高々 1 件に当たること（複数なら探針が失敗する）。
  iframe の中の部品は、要素が居る `Frame` を `page` の代わりに渡す
- **自動で閉じる部品の表示時間も探針で測る。** 出た後の状態から、何もしない `trigger` で閉じる遷移を採る（`timeoutMs` を表示時間より長くする）。
  遅れは探針を始めた時点から測るので、タイマーが始まってから探針を始めるまでの時間のぶん表示時間より短く出る。
  **両側で同じ前置き（出る遷移の探針が返った直後に始める等）にする**——カタログの見本が最初から出た状態で描かれ、描いた時点でタイマーが始まる形だと、
  前置きが違うだけで遅れが割れる。表示時間を操作の観測値（`behaviors.json`）に書かない——時間の値は揺れるので、完全一致で比べる操作の突き合わせでは永久に落ちる

## 動きの完了で始まる処理

**完了後にフォーカスを移す・自動で閉じるタイマーを始める・閉じる操作を受け付け始める**、といった処理は見た目の動きではなく操作の順序なので、対象外の一般論に含めない。

- その処理を `capture.operations` に操作として足し（観測項目はフォーカスの位置・開いているか等の状態の値）、遷移の `on_complete` にその操作の id を書く
  （列挙に無い id を書くと検査が型崩れとして落とす）。突き合わせは [`behavior.md`](behavior.md) の検査が行う
- 観測は、動きが終わった後の決まった時点で取る。途中の時点を観測に選ぶと、揺れで結果が割れる

## 突き合わせ（build）

- カタログで、その遷移の初期状態の見本（`build-metadata.json` の `catalog.stories` にある見本）を開き、**同じ `trigger` を同じ版の探針で**採る（1 回でよい。揺れは現行の 2 回から測る）。
  結果と見本の識別子を `new/<target>/motion-comparison.json` に書く（検査は識別子が空でないことしか見ないので、`catalog.stories` の見本を書くのは手順側の規律。順番の検査用の見本〈[`lifecycle.md`](lifecycle.md)〉を書かない）（様式の正本: [`../assets/motion-comparison-template.json`](../assets/motion-comparison-template.json)）
- 検査を通す:

  ```bash
  node <skill>/scripts/motion-compare.mjs \
    --baseline .replace/components/<slug>/ \
    --comparison .replace/components/<slug>/new/<target>/motion-comparison.json \
    --target <target>
  ```

  exit 0 ＝ 母集合の全組み合わせで一致（または承認済み。動きの無い部品と宣言した場合は判定しない）、1 ＝ 不一致・未突合・記録の不備が残る、2 ＝ 使い方の誤り・型崩れ。
  比べる量（在るか・遅れ・長さ・基準の矩形からのずれと不透明度の軌跡）と許容差（現行の揺れの倍率と下限）の正本は motion-compare.mjs の冒頭で、ここへ転記しない。
  結果の件数を `build-metadata.json` の `motion` に写す
- **不一致は要対応として手順 4 へ戻す**（見た目の要対応と同じ往復）。動きを引き継がないことは仕様変更なので、自分で決めずに利用者へ上げ、
  承認されたら行を `disposition: accepted` ＋ `reason` / `approved_by` / `approved_at` にする
- **実装を変えたら取り直す。** この検査は記録の鮮度を見ない

## 射程（完了報告に書くこと）

探針が採るのは**1 つの要素の矩形と実効の不透明度**だけで、色の移り変わり・子要素の個別の動き・スクロール位置は見ない。
在るか・無いかは操作の前と落ち着いた後でだけ比べ、途中で消えて出直すような動きの違いは、長さが同じなら軌跡の比較に現れない。
それらが部品の動きの主体なら、別の要素を引く遷移を足して採る。採れないものは部品ごとに `gaps.md` に残し、完了報告で収束と並べて示す。
承認して残した遷移（`accepted`）と到達できない遷移（`unreachable_motions`）も同じく示す。
