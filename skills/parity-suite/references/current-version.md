# 現行のバージョンの記録と、現行が進んだときの扱い

ベースライン・特性化・ノイズの基準値を、現行のどのバージョンで採ったかを `metadata.json` に記録し、同じ機能を次に測る前に照合する。
取り方と照合の規則の原本は、`replace-strategy` の `references/project-config.md`「現行側のバージョンの記録」である。ここには、このスキルでの手順だけを書く。
その節を読めなければ、記録も照合もせずに止まる。

## 記録する

手順 8 で `metadata.json` を書くときに、同梱の [`../scripts/source-version.mjs`](../scripts/source-version.mjs) の出力の `commit`・`tree`・`dirty` を、`target.commit`・`target.tree`・`target.dirty` に書く。
`--repo` に `current.repo` を渡し、`--rev` を付けるかは手順 1 で確定した target で決める（決め方は上の原本）。
取れないときは、`target.commit` と `target.tree` を `none`、`target.dirty` を `false` にし、`target.version_unverified_reason` に理由を書いて、`gaps.md` にも同じ理由を残す。

## 測る前に照合する

手順 1 で target を確定した後、対象の slug に既存の `.replace/parity/<slug>/metadata.json` があれば、撮影とスイートの実行より先に照合する。
初めて測る機能（`metadata.json` が無い）では照合しない。

```bash
node <skill>/scripts/source-version.mjs --repo <current.repo> [--rev <commit>] \
  --compare .replace/parity/<slug>/metadata.json --at target
```

出力の `compare.result` が `same` なら、そのまま進む。`differs` と `rerecord` なら、いつもの撮影とスイートの実行には進まず、次の「現行が進んだときの扱い」に進む。
出力の `dirty`（今の値）が `true` なら、持ち越しにも再取得にも進まずに止まり、現行の変更を commit するか退避するかを利用者に確かめる。新しい記録を書けないからである。
`unverifiable` なら止めずに進み、確かめられなかったことを `target.version_unverified_reason` と完了報告に書く。終了コードが 2 なら止まる。
記録の後に撮り足す・スイートを直すなど、既存の記録に足す作業も、この照合を通してから行う。違う現行で採った成果物が 1 つの記録に混在するからである。

## 現行が進んだときの扱い

新しい現行に対して次の 2 つを確かめ、両方を満たせば記録を持ち越す。どちらかを満たさなければ、仕様の変更として再取得する。

1. スイートを新しい現行に当てて green になる。手順 8 の「スイートが現側に対して green」と同じ実行で確かめ、結果を `suite-report.json` に保存し直す。
   操作中のエラーのベースラインに無いエラーが出たら、green でも満たさないとして扱う。
2. 画面のある機能（`feature` モード）では、`capture_conditions` と同じ撮影条件で `.replace/parity/<slug>/current-recheck/` に撮り直し、既存の `baseline/` と比べる。
   比べ方はノイズの基準値の測定と同じで、画素の差分・`pixel-strict-count.mjs`・`trait-compare.mjs` を、ページ・状態・ビューポートの組ごとに当てる（[`baseline.md`](baseline.md)「ノイズ基準値」）。
   すべての組の値が、`noise_baseline` の同じ組の値以下なら満たす。1 組でも超えれば満たさない。`api-resource` と `batch` は、1 だけで判定する。

持ち越すときは、`metadata.json` を次のように直し、`current-recheck/` を削除する（ノイズの 2 回目と同じく、commit しない）。

- `target.commit`・`target.tree`・`target.dirty` を、新しい現行の値に書き換える。
- `target.carried` の配列に 1 件足す。要素は `from`（前の `commit` と `tree`）・`to`（新しい `commit` と `tree`）・`at`（ISO 8601）・`checks` を持つ。
  `checks` は `["suite", "recapture"]` で、`api-resource` と `batch` では `["suite"]` である。
- 反応の網羅表（`reactions.json`）の `feedback_calls` は、新しい commit で走査し直す。`reaction-check.mjs` は、`source.version` が `target.commit` と違うと失敗するからである。
  走査の結果（呼び出しの一覧と、操作ごとのハンドラ）が前と同じなら、`source.version` を新しい commit に書き換え、`reaction-check.mjs` を exit 0 まで通す。
  結果が違えば、利用者に見える副作用の呼び出しが変わったので、持ち越さずに再取得する。`source.version` が `none` の記録は、書き換えない。
- `run.finished_at`・`procedure_revision`・ベースラインの実体・`noise_baseline` は変えない。持ち越しは特性化のやり直しではないからである。
- 性能のベースラインは、持ち越しの判定に使わず、そのまま持ち越す。性能だけが変わったと疑うなら、利用者に再取得するかを確かめる。

持ち越せないときは、次のように扱う。

- 超えた組と、red になったテストの名前を完了報告に挙げ、その機能を手順 5〜9 で再取得する。`current-recheck/` は削除する。
- 再取得する前に、新側に同じ機能の green の証跡や差分の記録（`.replace/parity/<slug>/new/`）があれば、それらが古い現行に合わせたものになることを報告に書く。
- 再取得した後、新側への反映を Issue にするかを利用者に確かめる。起票するなら `issue-create` に任せ、変わった挙動（red のテスト・超えた組）と、記録の commit から今の commit までの変更を本文に書く。
- `--autonomous` では、再取得と起票の確認を `pending-decisions.json` に残して止まる（再取得すると前のベースラインが消えるので、利用者の判断なしに進めない）。
