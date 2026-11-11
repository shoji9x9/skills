# 操作中のエラーの記録

スイートを操作している間に出たコンソールのエラーと失敗したリクエストを、現行で採って基準にし、新側で増えていないかを比べる。
新側で画面が仕様どおりに動いても、裏で例外やリクエストの失敗が起きていれば、スイートの assertion には表れない。
現行にも同じエラーが出ていることはあるので、0 件を基準にはできない。基準にするのは「現行から増えていないか」である。

集計と比較は、同梱の [`../scripts/runtime-errors.mjs`](../scripts/runtime-errors.mjs) が行う。
このスクリプトは `parity-suite` のものと同じ中身で、署名の作り方・基準・分類の規則の原本は `parity-suite` の `references/baseline.md`「操作中のエラーのベースライン」である（ここへ転記しない）。
`spec-parity` が違うのは、記録の作り方（Playwright の fixture ではなく、e2e の init script と reporter）と、比べた結果の書き込み先（`verify-metadata.json`）だけである。
Playwright の記録と e2e の記録は本文が違うので、基準と比較は同じランナー（e2e）で採る。`parity-suite` の基準と混ぜない。

## 記録のしくみ

e2e には console と pageerror のイベントが無く、`afterEach` と fixture はテストの名前と状態を受け取らない。そこで、次の 3 つで記録する（e2e 0.23.0 で確かめた）。

1. init script（`tests/parity/runtime-errors-init.js`）が、ページの中でエラーを捕まえ、`sessionStorage` に並べる。採る種類と採らないものは、雛形の冒頭のコメントで定義する
2. スイートの基（`tests/parity/test.ts`）の fixture が、テストの後始末で記録を取り出し、標準出力へ 1 行で書く
3. reporter（`tests/parity/runtime-errors-reporter.ts`）が、その行と `test-finished` の結果を突き合わせ、テストごとの記録のファイルを書く

- reporter は、e2e の結果の状態を `runtime-errors.mjs` の語彙に読み替える（`timed-out` → `timedOut`、`flaky` → `passed`）。読み替えずに書いた記録は、`runtime-errors.mjs` が exit 2 で読まない。
- img と script の 404 は、要素の `error` と Resource Timing の両方に現れる。init script は、状態コードが取れたものを `http-error` の 1 件にし、取れないもの（接続の失敗・別オリジンの応答）だけを `requestfailed` にする。
- 記録を取り出せなかったテスト（ページが閉じた・別オリジンへ移った・後始末が動かなかった）は、reporter が記録のファイルを作らない。比較は、そのテストを「記録が欠けたテスト」として止める。0 件の記録として通さない。

## 現行で基準を採る（suite）

スイートを `PARITY_RUNTIME_CAPTURE=1` と `PARITY_RUNTIME_RUN=<回>` を付けて `--target current` で 2 回以上実行し、`summarize` で `metadata.json` の `runtime_errors` に書く。

```bash
rm -rf .replace/parity/<slug>/runtime-errors
for n in 1 2; do
  E2E_TELEMETRY_DISABLED=1 DO_NOT_TRACK=1 E2E_UPDATE_CHECK_DISABLED=1 \
  PARITY_RUNTIME_CAPTURE=1 PARITY_RUNTIME_RUN=$n PARITY_SLUG=<slug> \
  PARITY_CURRENT_UI_URL=<現行の UI の URL> npx e2e run --target=current </dev/null
done
node <spec-parity>/scripts/runtime-errors.mjs summarize \
  --metadata .replace/parity/<slug>/metadata.json \
  --run .replace/parity/<slug>/runtime-errors/run-1 \
  --run .replace/parity/<slug>/runtime-errors/run-2 --write
```

- リポジトリのルートで実行し、`--run` はルートからの相対パスで渡す。終了コードの意味は `parity-suite` の `references/baseline.md`「操作中のエラーのベースライン」にある。
- 記録できない事情（init script を入れられないなど）があるときだけ、`runtime_errors` に `declared: false` と `reason` を書き、`gaps.md` にも同じ文言を残す。
  そのときは、`verify` の `unverified` に `runtime_errors` を同じ理由で書く（書かないと収束しない）。

## 新側で比べる（verify）

同じスイートを `--target new` で 2 回以上実行し、`compare` の結果を `verify-metadata.json` に書く。

```bash
rm -rf .replace/parity/<slug>/new/<target>/runtime-errors
for n in 1 2; do
  E2E_TELEMETRY_DISABLED=1 DO_NOT_TRACK=1 E2E_UPDATE_CHECK_DISABLED=1 \
  PARITY_RUNTIME_CAPTURE=1 PARITY_RUNTIME_RUN=$n PARITY_SLUG=<slug> PARITY_NEW_TARGET=<target> \
  PARITY_NEW_UI_URL=<新側の UI の URL> npx e2e run --target=new </dev/null
done
node <spec-parity>/scripts/runtime-errors.mjs compare \
  --metadata .replace/parity/<slug>/metadata.json --target <target> \
  --run .replace/parity/<slug>/new/<target>/runtime-errors/run-1 \
  --run .replace/parity/<slug>/new/<target>/runtime-errors/run-2 \
  --write .replace/parity/<slug>/new/<target>/verify-metadata.json
```

- `compare` が exit 1 で挙げた、現行に無かった署名（`new_signatures`）は、1 件ずつ要対応・許容・環境ノイズの 3 値に分類する。
  分類は `verify-metadata.json` の `runtime_errors.new_signatures[]` の `classification` に書き、`compare` を通し直す。前の分類は、同じテスト × 署名へ持ち越される。
- 許容は、利用者の承認（`approved_at` と `reason`）で確定する。承認の前は説明の付いていない署名として数える。環境ノイズには根拠（`evidence`）が要る。
- 要対応と、新側で通らなかったテストは、`parity-replace` へ差し戻す。記録が欠けたテストと、基準に無いテストは、採り直す。
- `compare` のエラーの本文には `parity-suite` の名前が出るが、`spec-parity` では `spec-parity suite` の `summarize` と読み替える（スクリプトは同じ中身で持つので、本文を変えない）。
