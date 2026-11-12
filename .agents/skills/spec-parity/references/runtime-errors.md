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
- reporter は、テスト・agent・繰り返しの回ごとに別のファイルを書く。記録を採る実行で `--repeat-each` や複数の agent を使うと、同じテストの記録が 1 つの `run-<回>/` に 2 つでき、`runtime-errors.mjs` が exit 2 で止める。
  記録を採る実行では使わず、回を重ねるときは `PARITY_RUNTIME_RUN` を変えて実行し直す。
  この分け方は、雛形の `assets/runtime-errors-reporter.template.ts` から起こした reporter が行う。前にコピーした reporter はファイル名をテストの名前だけで決めるので、記録が上書きされても止まらない。
  前にコピーした reporter は、雛形からコピーし直す（コピーした雛形は `gh skill update` で更新されない）。

## 現行で基準を採る（suite）

スイートを `PARITY_RUNTIME_CAPTURE=1` と `PARITY_RUNTIME_RUN=<回>` を付けて `--target current` で 2 回以上実行し、`summarize` で `metadata.json` の `runtime_errors` に書く。

```bash
rm -rf .replace/parity/<slug>/runtime-errors
for n in 1 2; do
  E2E_TELEMETRY_DISABLED=1 DO_NOT_TRACK=1 E2E_UPDATE_CHECK_DISABLED=1 \
  PARITY_RUNTIME_CAPTURE=1 PARITY_RUNTIME_RUN=$n PARITY_SLUG=<slug> \
  PARITY_CURRENT_UI_URL=<現行の UI の URL> npx e2e run tests/<slug>/ --target=current </dev/null
done
node <spec-parity>/scripts/runtime-errors.mjs summarize \
  --metadata .replace/parity/<slug>/metadata.json \
  --run .replace/parity/<slug>/runtime-errors/run-1 \
  --run .replace/parity/<slug>/runtime-errors/run-2 --write
```

- `tests/<slug>/` は、`metadata.json` の `suite.dir` のスイートのパスである。パスを付けないと、ほかの機能のテストの記録も基準に入る。
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
  PARITY_NEW_UI_URL=<新側の UI の URL> npx e2e run tests/<slug>/ --target=new </dev/null
done
node <spec-parity>/scripts/runtime-errors.mjs compare \
  --metadata .replace/parity/<slug>/metadata.json --target <target> \
  --run .replace/parity/<slug>/new/<target>/runtime-errors/run-1 \
  --run .replace/parity/<slug>/new/<target>/runtime-errors/run-2 \
  --write .replace/parity/<slug>/new/<target>/verify-metadata.json \
  --tree <verify-metadata.json の new.tree>
```

- `--tree` には、記録を採った新側のバージョン（verify の手順 1 で書いた `verify-metadata.json` の `new.tree`）を渡す。
  記録（`run-<回>/` のファイル）はバージョンを持たないので、`compare` は渡した値が記録を採ったときの値かを確かめられない。記録のディレクトリを消してから採り直した直後に、その `new.tree` を渡す。`compare` は、渡した値を結果の `tree` に書く。
  収束の判定は、この `tree` が `new.tree` と違う比較の結果と、`tree` を持たない比較の結果を、古い記録として採り直させる。`none` と空の値は exit 2 で受けない。
- `compare` が exit 1 で挙げた、現行に無かった署名（`new_signatures`）は、1 件ずつ要対応・許容・環境ノイズの 3 値に分類する。
  分類は `verify-metadata.json` の `runtime_errors.new_signatures[]` の `classification` に書き、`compare` を通し直す。前の分類は、同じテスト × 署名へ持ち越される。
- 許容は、利用者の承認（`approved_at` と `reason`）で確定する。承認の前は説明の付いていない署名として数える。環境ノイズには根拠（`evidence`）が要る。
- 許容を承認したら、同じ値と承認した人（`approved_by`）を承認の記録（`verify-metadata.json` の `approvals[]`）にも追記する（[`design-review.md`](design-review.md)「承認の記録」）。
  収束の判定は、同じテスト × 署名・同じ新側のバージョン・同じ `approved_at` と `reason` の要素が無い許容を、承認として数えない。
  同じ原因の署名をまとめて 1 回承認したときも、`approvals[]` の要素は署名（テスト × 署名）ごとに 1 件ずつ足す。
- `compare` は、前の分類を新側のバージョンを見ずに持ち越す。新側を直して記録を採り直した後に持ち越した許容は、前のバージョンの承認なので、収束の判定が承認待ちにする。
  利用者に承認し直してもらい、承認の日時を `approved_at` に書き直して、新しいバージョンの要素を `approvals[]` に足す。前のバージョンの要素は消さない。
  `compare` の結果の `ok` と署名の `state` は承認の記録を見ないので、持ち越した許容も `explained` として数える。許容が収束の根拠になるかは、収束の判定の結果で決める。
- 要対応と、新側で通らなかったテストは、`parity-replace` へ差し戻す。記録が欠けたテストと、基準に無いテストは、採り直す。
- `compare` のエラーの本文には `parity-suite` の名前が出るが、`spec-parity` では `spec-parity suite` の `summarize` と読み替える（スクリプトは同じ中身で持つので、本文を変えない）。
