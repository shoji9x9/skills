# 横のはみ出し

`style_policy: free` では、現行と新側の画面を比べない。見た目が自由になった分、現行が表示できていた幅で新側が横にはみ出してスクロールするようになっても、スイートは緑のまま通る。
そこで、現行が保証している幅（ビューポート）を `suite` で記録し、`verify` で新側だけを同じ幅で測る。現行と新側の測定値は比べない。

判定は、同梱の [`../scripts/overflow-check.mjs`](../scripts/overflow-check.mjs) が行う。測るのは、利用者のプロジェクトにコピーした `tests/<slug>/overflow.e2e.ts`（雛形は `assets/overflow.e2e.template.ts`）である。
このテストは、e2e の `browser.setViewport`（<https://e2e.com/docs/reference/web#setviewport>）で幅を変え、`browser.evaluate`（<https://e2e.com/docs/reference/web#evaluate>）で値を読む。

## 判定の規則

- はみ出しは、`document.documentElement` の `scrollWidth` が `clientWidth` を超えることである。許容の幅は持たず、1px でも超えれば数える。
- 期待する組は、`metadata.json` の `capture_conditions.pages`（ページ）× `capture_conditions.viewports`（幅と高さ）である。測定の記録からは作らない。
- 宣言した組の測定が無い（`missing`）・`window.innerWidth` が宣言の幅と違う（`width_mismatch`）・宣言に無い組を測った（`extra`）ときも、合格にしない。
- 測定の記録が読めない・宣言が空・形の誤りは、判定せずに exit 2 にする。

測らないもの: 内部でスクロールするコンテナの中のはみ出し、`overflow: hidden` で切れた内容、操作で開くメニューやダイアログの中。
機能にこれらがあれば、状態を作る操作を足した測り方を別に書くか、`gaps.md` と `verify-metadata.json` の `unverified` に残す。

## 現行が保証する幅を決める（suite）

1. 測るページを `capture_conditions.pages` に書く。機能の画面のうち、横に長くなりうるもの（表・フォーム・一覧）を入れる。
2. 候補の幅を `capture_conditions.viewports` に書く。候補は、`replace-strategy` の戦略書が対象にした端末と、現行の CSS のブレークポイントから選ぶ。
   どちらも分からなければ、375×800（スマートフォン）・768×1024（タブレット）・1280×720（デスクトップ）を候補にし、選んだ理由を `gaps.md` に書く。
3. 現行で測り、`--side current` で判定する。

   ```bash
   E2E_TELEMETRY_DISABLED=1 DO_NOT_TRACK=1 E2E_UPDATE_CHECK_DISABLED=1 \
   PARITY_OVERFLOW_CAPTURE=1 PARITY_SLUG=<slug> PARITY_CURRENT_TARGET=<current の target> PARITY_COMMIT=<現行のバージョン> \
   PARITY_CURRENT_UI_URL=<現行の UI の URL> npx e2e run tests/<slug>/overflow.e2e.ts --target=current </dev/null
   node <spec-parity>/scripts/overflow-check.mjs --metadata .replace/parity/<slug>/metadata.json \
     --measurements .replace/parity/<slug>/overflow-current.json --target <current の target> --side current
   ```

4. exit 1 で、現行もはみ出した幅があれば、その幅は現行が保証していない。利用者に確かめてから、その幅を `viewports` から `excluded_viewports` へ移し、理由（はみ出したページと `scrollWidth`）を `gaps.md` にも書く。
   exit 0 になるまで測り直す。exit 0 になった `viewports` が、現行が保証している幅である。

## 新側を判定する（verify）

```bash
E2E_TELEMETRY_DISABLED=1 DO_NOT_TRACK=1 E2E_UPDATE_CHECK_DISABLED=1 \
PARITY_OVERFLOW_CAPTURE=1 PARITY_SLUG=<slug> PARITY_NEW_TARGET=<target> PARITY_COMMIT=<new.commit> \
PARITY_NEW_UI_URL=<新側の UI の URL> npx e2e run tests/<slug>/overflow.e2e.ts --target=new </dev/null
node <spec-parity>/scripts/overflow-check.mjs --metadata .replace/parity/<slug>/metadata.json \
  --measurements .replace/parity/<slug>/new/<target>/overflow.json --target <target> \
  --write .replace/parity/<slug>/new/<target>/verify-metadata.json
```

- `PARITY_COMMIT` には、`verify-metadata.json` の `new.commit` と同じ値を渡す。違うバージョンの測定は、収束の判定で古い記録として数える。
- exit 1 で `overflowing` に挙がった組は、要対応として `parity-replace` へ差し戻す。`missing`・`width_mismatch`・`extra` は、測り直す（`extra` は、宣言か測定のどちらかが古い）。
- 収束の判定（`convergence-check.mjs`）は、`verify-metadata.json` の `overflow` を信じず、測定の記録（`overflow.json`）から判定し直す。
