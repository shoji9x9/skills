---
paths:
  - "skills/**"
applyTo: "skills/**"
---

# 配布スキルの成果物は同梱する

配布対象スキル（`skills/<name>/`、`gh skill publish` の対象）が実行時に参照する成果物（テンプレート・設定ファイル・スクリプト等）は、必ずスキル内（`assets/` / `scripts/` / `references/`）に正本として同梱する。

配布されるのは `skills/<name>/` 配下のみで、リポジトリ直下や `.github/` に置いたファイルはインストール先プロジェクトに付いて行かず、参照先が無くなるため。

- インストール先リポジトリに同種のファイルが既にある場合はそれを優先・尊重し、無いときだけ同梱物を使う／（ユーザー確認の上）コピー導入する。既存ファイルは上書きしない
- スキル本体（`SKILL.md` 等）から参照するパスは、リポジトリ固有の場所ではなくスキル内の同梱物を起点にする
- ユーザープロジェクトへコピーして使わせるファイル（テンプレート）は最小限にする。実行ロジック（エンジン・共通スクリプト）はコピーせずスキル側に置いて実行させる（`gh skill update` で自動更新され、上書き衝突・更新取りこぼしを避けられる）
- **同梱物を実行時に探す条件は、ソース側の属性ではなくインストール済みコピーで実測して決める。** `gh skill install` が配るコピーは
  `100644` なので、`[ -x "$dir/<script>.sh" ]` のような実行ビット判定は**配布先で必ず外れる**（ソースは 755 なので手元では通る）。
  読めれば足りるなら `-r` にし、起動は `bash <path>` にする。分岐の陽性コントロールは 644 の installed copy を置いて取る。
- コピーされるファイルは自己完結させる。スキル内の `references/` 等への相対リンク／相対パスを張らない（コピー先の階層やユーザープロジェクトでは解決不能）。出典はスキル名で言及するか内容をインラインに書く

## 開発専用の成果物は `skills/<name>/` に置かない

逆向きも成立させる。`gh skill install` はスキルディレクトリの git tree を再帰取得して**全 blob を配る**（除外の仕組みは無い。
`.skillignore` 等も読まない。cli/cli の `internal/skills/discovery/discovery.go` の `DiscoverSkillFiles`、gh v2.93.0 で確認:
<https://github.com/cli/cli/blob/v2.93.0/internal/skills/discovery/discovery.go>。ローカルからの install も `installer.go` が全ファイルを WalkDir で写す）。
置いた物はすべて下流へ配られるので、このリポジトリでしか意味を持たない物はスキルの外に置く。

- **回帰 eval（`evals.json`・`README.md`・fixture）は `evals/<name>/` に置く**（#438 で `skills/<name>/evals/` から移設）。
  下流は eval を実行せず、手順もこのリポジトリのハーネス（`scripts/run-skill-eval.sh` 等）を前提にするため、配っても使えない。
  配布スキル側の文書から `evals/` を参照しない（配布先に存在しない）
- 強制点: `scripts/check-eval-reachability.js` の全走査（CI の `Lint` ジョブ）が `skills/<name>/evals/` の残存を違反にする
