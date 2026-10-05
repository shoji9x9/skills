# 動きの列挙と時系列の突き合わせ

見た目の照合は `animations: "disabled"` で動きを止めて撮るので、部品が持つ動き（出し入れ・開閉のアニメーション）は、どの採取物にも記録されない。
操作の突き合わせも、「出た・消えた」の結果だけを見て、「どう出たか」を見ない。
そのため、新側が即時に出る実装のままでも、部品の照合・スイート・`parity-diff` がすべて緑になる。
一般論の「アニメーションは対象外」（`replace-strategy` の `references/scope.md`）は、画素の差分を比べる手法についての話である。部品の動きを引き継がない理由にはならない。

そこで、`capture` が部品にかかる動きを数えて時系列を採り、`build` がカタログの見本で同じ遷移を採って、遷移 × インスタンスごとに数値で比べる。
採るのは同梱の [`../scripts/motion-probe.mjs`](../scripts/motion-probe.mjs)（プローブ）で、比べるのは [`../scripts/motion-compare.mjs`](../scripts/motion-compare.mjs) である（どちらもコピーせずに、スキル配下から実行する）。

## 動きを数える（capture）

ソースと実機の両方で数える。片方だけでは、市販部品の内部の動き（ソースに呼び出しが無い）や、条件付きでしかかからない動き（実機で通らない処理）を取りこぼす。

- ソース: 次の 2 つを数え、見つけた箇所を `metadata.json` の `capture.motions.source_scan` に書く
  - 現行の部品の JavaScript で、動きを起こす呼び出し（jQuery の `animate`、長さや効果を渡した `show` / `hide` / `toggle`、`slide*` / `fade*`、jQuery UI の効果）
  - CSS で、採取した `css-rules.json` の `matched` に現れる `transition` / `animation` 系の宣言と、それが参照する `@keyframes`
- 実機: 部品の状態の間の遷移（出る・消える・開く・閉じる・展開する）と、`capture.operations` のうち見た目が変わる操作に、プローブを 1 回ずつ当てる。
  長さが 0 でなければ、動きがある。**ソースで見つからなくても、実機で動いたら遷移として数える**
- 数えた遷移を、`capture.motions.transitions[]` に書く。項目は `id` / `description` / `trigger`（見本でも同じに再生できる手順）/ `declared`（ソースが宣言する長さ・緩急・移動量）である。
  遷移の集合は、すべてのインスタンスで共通にする。
  そのインスタンスで起こせない遷移だけを、`instances[].unreachable_motions` に理由と一緒に宣言し、同じ内容を `gaps.md` に残す
- 遷移に入れるのは、プローブで採れる動き（要素の矩形か、実効の不透明度が変わるもの）だけにする。
  色・背景・影だけが移り変わる動き（`transition: color .2s` など）は、プローブで記録できない。
  遷移に入れると、現行の時系列が必ず「動かない」になり、`motion-baseline-static` で失敗する。
  そうした動きは `source_scan` に残し、遷移には入れず、部品ごとに `gaps.md` へ「プローブの射程外の動き」として残す（後述の「射程」）
- プローブで比べる動きが無い部品は、`transitions` を空にする。`none_reason` には、何を数えて無かったか（または、射程外の動きしか無かったこと）を書く。
  理由の無い空は、検査が形の誤りとして失敗にする
- 既定値を決める前に、現行でその動きを出す箇所をすべて数える（規律の原本は [`amend.md`](amend.md)「現行に合わせ直す修正」の手順 2）。
  すべての箇所で同じ動きなら既定値をその動きにし、一部だけなら引数にする

## 時系列を採る

- motion-probe.mjs は Playwright のスペックから import する。
  そのため、`parity-suite` 同梱のツールと同じく、`<parity_suite_dir>/parity/lib/tools/vendor/` へコピーして使う。
  コピー元は、このスキルの `scripts/motion-probe.mjs` である。
  無ければそのままコピーし、在ればバイト列で一致を確かめ、違えば上書きせずに止まる
  （コピーと一致の確認の規律は、[`capture.md`](capture.md)「`parity-suite` 同梱ツールの用意」の手順 2・3 と同じ）。
  コピー先を `capture.tools.motion_probe` に、`VERSION` を `motion_probe_version` に、コピーしたファイルから読んで記録する
- **プローブで採る間は、アニメーションを止めない。** 見た目の採取の「ページ側でまとめて止める」仕組みを外して、開き直す。
  止めたまま採ると、動きのある部品も長さ 0 として記録される
- 各遷移は同じ初期状態から始め、同じ条件で 2 回採る。最初の 2 回の差が揺れ（フレームの刻み・操作が届くまでの遅れ）で、許容差はここから決まる（3 回目以降は使わない）。
  揺れが上限を超えた組（例: 1 回目は 600ms 動き、2 回目は即時）は、許容差を広げず、`motion-baseline-unstable` で失敗する。遷移の手順か初期状態をそろえて採り直す。
  現行が一度も変化しなかった時系列も、ソースの宣言の有無に関わらず、`motion-baseline-static` で失敗する（止めたまま採った、または別の要素を指定した疑いがある）。
  結果は、`baseline/<instance>/motions.json` の `results[].runs` に積む（形の原本: [`../assets/motions-template.json`](../assets/motions-template.json)）

  ```ts
  // import 先はスペックの置き場所から見た <parity_suite_dir>/parity/lib/tools/vendor/ のコピー
  import { probeMotion } from "<vendor>/motion-probe.mjs";

  const timeline = await probeMotion(page, {
    selector: ".feedback-message", // 動く要素。片側の実装に固有でよい（比べない）
    trigger: () => page.getByRole("button", { name: "保存" }).click(),
  });
  ```

- セレクタは CSS で書く。出る動きでは、操作の前に要素が無く、ロケータを先に解決できないためである。
  セレクタは、その文書で多くても 1 件に当たるようにする（複数に当たると、プローブが失敗する）。
  iframe の中の部品では、要素が居る `Frame` を `page` の代わりに渡す
- 自動で閉じる部品の表示時間も、プローブで測る。出た後の状態から、何もしない `trigger` で、閉じる遷移を採る（`timeoutMs` を表示時間より長くする）。
  遅れはプローブを始めた時点から測るので、タイマーが始まってからプローブを始めるまでの時間のぶん、表示時間より短く出る。
  両側で同じ前置きにする（出る遷移のプローブが返った直後に始める、など）。
  カタログの見本が最初から出た状態で描かれ、描いた時点でタイマーが始まる形だと、前置きが違うだけで遅れが食い違う。
  表示時間を、操作の観測値（`behaviors.json`）に書かない。時間の値は揺れるので、完全一致で比べる操作の突き合わせでは、いつまでも失敗する

## 動きの完了で始まる処理

完了の後にフォーカスを移す・自動で閉じるタイマーを始める・閉じる操作を受け付け始める、といった処理は、見た目の動きではなく操作の順序である。
そのため、「アニメーションは対象外」という一般論に含めない。

- その処理を、`capture.operations` に操作として足す（観測項目は、フォーカスの位置や、開いているかなどの状態の値）。遷移の `on_complete` に、その操作の id を書く。
  列挙に無い id を書くと、検査が形の誤りとして失敗にする。突き合わせは、[`behavior.md`](behavior.md) の検査が行う
- 観測は、動きが終わった後の決まった時点で取る。途中の時点を観測に選ぶと、揺れで結果が食い違う

## 突き合わせ（build）

- カタログで、その遷移の初期状態の見本（`build-metadata.json` の `catalog.stories` にある見本）を開き、同じ `trigger` を同じ版のプローブで採る（1 回でよい。揺れは現行の 2 回から測る）。
  結果と見本の識別子を、`new/<target>/motion-comparison.json` に書く（形の原本: [`../assets/motion-comparison-template.json`](../assets/motion-comparison-template.json)）。
  検査は識別子が空でないことしか見ないので、`catalog.stories` の見本を書くのは、手順の側の規律である。
  順番を検査するための見本（[`lifecycle.md`](lifecycle.md)）は書かない
- 次のコマンドで検査する

  ```bash
  node <skill>/scripts/motion-compare.mjs \
    --baseline .replace/components/<slug>/ \
    --comparison .replace/components/<slug>/new/<target>/motion-comparison.json \
    --target <target>
  ```

  終了コードの意味は次のとおりである。
  - exit 0: 母集合のすべての組み合わせで一致した（または承認済み）。動きの無い部品と宣言した場合は判定しない
  - exit 1: 不一致・突き合わせていない組み合わせ・記録の不備が残る
  - exit 2: 使い方の誤りか、形の誤り

  比べる量（在るか・遅れ・長さ・基準の矩形からのずれと、不透明度の軌跡）と許容差（現行の揺れの倍率と下限）の原本は motion-compare.mjs の冒頭で、ここへ転記しない。
  結果の件数を、`build-metadata.json` の `motion` に転記する
- 不一致は要対応として、手順 4 へ戻す（見た目の要対応と同じ往復）。動きを引き継がないことは仕様の変更なので、自分で決めずに利用者へ上げる。
  承認されたら、その行を `disposition: accepted` にし、`reason` / `approved_by` / `approved_at` を書く
- 実装を変えたら、採り直す。この検査は、記録が古くなっていないかを見ない

## 射程（完了報告に書くこと）

プローブが採るのは、1 つの要素の矩形と実効の不透明度だけである。色の移り変わり・子要素の個別の動き・スクロールの位置は見ない。
在るか無いかは、操作の前と落ち着いた後でだけ比べる。途中で消えて出直すような動きの違いは、長さが同じなら軌跡の比較に現れない。
それらが部品の動きの中心なら、別の要素を指定する遷移を足して採る。採れないものは部品ごとに `gaps.md` に残し、完了報告で収束と並べて示す。
承認して残した遷移（`accepted`）と、到達できない遷移（`unreachable_motions`）も、同じように示す。
