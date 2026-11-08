# 週次のセルフ点検の手順

週次のワークフロー `self-review.yml` が起動するエージェントは、この手順に従って点検し、結果を JSON に書く。
決定論的なチェック（textlint・`check-doc-refs.ts`・`check-time-sensitive-prose.ts`・fallow・jscpd）では判定できないものを探す。
運用（資格情報・一時停止・追跡 Issue の読み方）は [`self-review.md`](self-review.md) にある。

## 守ること

- ファイルを読むだけにする。点検の結果のファイル（下の「結果の書き方」）のほかは、作成も変更もしない。
- 使えるのは、ファイルを読む・探すツールと、結果を書くツールだけである。git の履歴とファイルの一覧は、下の「入力」のファイルを読む。
  Issue と PR の状態は確かめられないので、それを根拠にする指摘（「Issue #N が閉じている」など）は書かず、`notes` に回す。
- 点検の仕組みのファイル（`docs/self-review.md`・`.github/workflows/self-review.yml`・`scripts/weekly/self-review-issue.*`）は、点検の前に作業ツリーから外してある。
  これらが無いことや、これらへの参照が切れていることは指摘しない。
- 1 件の指摘には、確かめた根拠を付ける。根拠は、読んだファイルのパスと行、または検索した語と結果である。推測だけの指摘は書かない。
- 判断に迷うものは、指摘にせず `notes` に書く。指摘は人が直すかを決める入力なので、誤検知を減らすほうを優先する。
- 指摘は 40 件までにする。超えるときは、直したときの効果が大きいものを残す。
- 次のものは対象にしない。過去の記録（`.kaizen/archive/`・`tests/`）、インストール済みのスキルのコピー（`.agents/skills/<name>/` のうち `skills/<name>/` と同じもの）と `.claude/`、`node_modules/`。

## 入力

作業ディレクトリの次のファイルがあれば読む。無ければ、その入力を使う項目は入力なしで点検し、`notes` にそう書く。

- `self-review-input/cost-metrics.md`: 費用の指標の追跡 Issue（`check-cost-metrics.yml` が書く）の本文。空の一覧・修正の PR が多いチェック・遅くなったジョブの表がある
- `self-review-input/files.txt`: 点検の対象のファイルの一覧（`git ls-files` と同じ形）
- `self-review-input/commits.txt`: マージを除いた commit の件名（新しい順。1 行に短い SHA・日付・件名）

## 点検の項目

項目ごとに `category` の値を決めてある。値は結果の JSON にそのまま書く。

### 1. 不要物（`unused`）

- どこからも参照・起動されないファイル。JavaScript・TypeScript は fallow が見るので、Markdown・シェル・設定ファイル・fixture を対象にする。
  参照は、ほかのファイルに書かれたパス・ファイル名・`@` の取り込み・ワークフローとスクリプトからの起動で探す
- 期限や前提が過ぎた記述。日付や「現状は」以外の形で時点に依存する記述（前提にしたファイルやツールが無くなっている、など）

### 2. 文書の間の食い違いと重複（`inconsistency`）

- 文書に書いたスクリプト・ファイル・ジョブ・コマンドの名前が、実在するものと合わない
- `AGENTS.md` の参照スキルガイドと各 `SKILL.md` の `description` の食い違い
- 上位と下位の Tier（`.agents/rules/doc-altitude.md`）で同じ事実を書いた 2 か所の内容の食い違い。食い違ったら上位を正として、下位を指摘する
- 改善を繰り返すうちに増えた、同じ規則の重複と矛盾

### 3. やりすぎな記述（`overdoc`）

- 何もしない指示。書かなくてもモデルが既にそうする指示
- 環境から分かることを、そのまま繰り返した記述（`package.json` のスクリプト・設定ファイル・`--help` の出力）
- そこまで書かなくても守れる記述

### 4. やりすぎなチェック（`overcheck`）

- チェックを足した後に、そのチェックが誤りを捕まえた記録が無い（`commits.txt` の件名・`.kaizen/` の学び・文書から探す）
- チェックが無くてもエージェントが守れる
- 入力の費用の指標（修正の PR が多いチェック・空の一覧）を根拠に使う。廃止するかは人が決めるので、指摘には根拠だけを書く

### 5. 回帰 eval の妥当性（`eval`）

- `evals/*/evals.json` の prompt と assertion が、`.agents/rules/eval-assertion-discrimination.md` の基準を満たすか

### 6. 効果の無い GitHub Actions（`actions`）

- 何も検出しないジョブ、ほかのジョブと同じことを確かめるジョブ。入力の費用の指標（遅くなったジョブ）を根拠に使う

### 7. 分かりにくい語と、文字列リテラルの中の旧称（`wording`）

- 使わない語の一覧（`.textlint/word-list.md`）に無い比喩や造語
- 利用者に表示するメッセージ・テスト名・`evals/*/evals.json` の assertion の中の旧称（今は別の名前になったスキル・ファイル・用語）

## 結果の書き方

作業ディレクトリの `self-review-report.json` に、次の形の JSON を書く。ほかの形式（Markdown など）にしない。

```json
{
  "findings": [
    {
      "category": "inconsistency",
      "path": "docs/tooling.md",
      "summary": "存在しないスクリプト scripts/tools/x.ts を起動するよう書いている",
      "evidence": "docs/tooling.md:120 に scripts/tools/x.ts とある。self-review-input/files.txt に無い",
      "suggestion": "今の名前 scripts/tools/y.ts に直す"
    }
  ],
  "notes": ["判断に迷ったものや、読めなかった入力"]
}
```

- `category` は、上の項目の値のどれかにする
- `path` は、直す対象のファイルのリポジトリのルートからのパスにする。ディレクトリ全体が対象なら、末尾に `/` を付ける。
  前回との差分は `category` と `path` の組で数えるので、同じ対象には毎週同じパスを書く
- 同じ `category` と `path` の指摘が複数あれば、1 件にまとめて `summary` に並べる
- `summary`・`evidence`・`suggestion` は日本語で、1 件 300 字以内にする
- 指摘が無ければ `"findings": []` にする
