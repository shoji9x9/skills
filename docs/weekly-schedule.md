# 週次の処理

GitHub Actions の `schedule` と Dependabot で毎週動く処理の、曜日・時刻・処理どうしの依存を一覧にする。
各ワークフローの cron の横のコメントは、この文書を参照する。
`kaizen-schedule.yml` だけは、配布するテンプレートと同じ内容に保つので、この文書を参照しない（「時刻を決めるときの決まり」）。

## 一覧

| 曜日 | JST（UTC） | 系統 | 処理 |
| --- | --- | --- | --- |
| 月 | 09:30（00:30） | 依存 | Dependabot（npm・github-actions）・`outdated.yml`・`ignored-advisories.yml` |
| 月 | 10:30（01:30） | 振り返り | `kaizen-schedule.yml` |
| 火 | 09:30（00:30） | セキュリティ・全件の測定 | `codeql.yml`・`mutation-proof.yml` |
| 火 | 09:30（00:30） | 点検 | `check-cost-metrics.yml` |
| 火 | 10:30（01:30） | 点検 | `self-review.yml` |
| 火 | 11:30（02:30） | セキュリティ | `security-audit.yml` |

月曜には、人の対応が要る依存の処理を集める。
`mutation-proof.yml` の全件の実行は、依存のバージョンを上げて検査が変わった宣言を確かめるためのものなので、月曜に依存の PR をマージした後の火曜に置く。

## 処理どうしの依存

`self-review.yml` は、`check-cost-metrics.yml` が書いた追跡 Issue（`Check cost metrics to review`）の本文を入力に使う。
そのため、`check-cost-metrics.yml` の 1 時間後に置く。終わるのを待つ仕組み（`workflow_run`）は使わず、時刻で順序を決める。
`check-cost-metrics.yml` は 2〜3 分で終わり、最も遅い場合も、起動の遅れ（:00 の起動で実測した最大 28 分）と timeout（30 分）の合計で 1 時間以内に終わる。
それでも遅れたときや失敗したときに前の週の本文を読まないよう、`self-review.yml` は追跡 Issue のタイトルの日付が今日（UTC）のときだけ本文を使い、そうでなければ入力なしで点検する。

ほかの処理は、結果をやり取りしない。

## 時刻を決めるときの決まり

週次の処理を足すときや時刻を変えるときは、次に従い、上の一覧も同じ変更で直す。

- JST の 09:00〜11:59（UTC の 00:00〜02:59）に置く。この時間帯なら UTC と JST で曜日が変わらないので、一覧と各ファイルのコメントを曜日 1 つで書ける。
  追跡 Issue を書くワークフローは、タイトルの日付を UTC で採り（`date -u +%F`）、JST でも同じ日付になることを前提にしている。
  当たるのは、`outdated.yml`・`kaizen-schedule.yml`・`ignored-advisories.yml`・`check-cost-metrics.yml`・`self-review.yml`・`security-audit.yml` である
- 分は :00 を避けて :30 にする。GitHub の[ドキュメント](https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows#schedule)は、`schedule` が毎時 0 分に混みあって遅れると書いている。
  このリポジトリでも、:00 の起動は 6〜28 分遅れた
- 同じ系統の処理は、同じ時刻か続けた時刻に置く。ほかの処理の結果を読む処理は、読む先が終わる時間を見込んで後ろに置き、上の「処理どうしの依存」に書く
- `kaizen-schedule.yml` は、配布するテンプレート `skills/kaizen/assets/kaizen-schedule.yml` とバイト単位で同じ内容に保つ。時刻を変えるときは、テンプレートも同じ時刻に変える（配布先の起動の時刻も変わる）
- Dependabot は、`.github/dependabot.yml` の `schedule` に `day`・`time`・`timezone` を書く。書かないと、`time` を Dependabot が決めるので、PR が作られる時刻が決まらない
