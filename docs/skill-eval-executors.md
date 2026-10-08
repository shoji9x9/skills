# スキル評価の executor の仕様

`scripts/eval/run-skill-eval.sh` は同じ `evals/<name>/evals.json` を Claude Code と Codex で実行し、executor 固有の出力を共通 artifact へ正規化する。
Anthropic 版 `skill-creator` と既存の集計・viewer は変更しない。

## Executor の選択

`--executor claude-code|codex` で選ぶ。エージェントが実行を始めるときは、その作業をしているエージェントと同じ executor を選ぶ。
Codex のセッションなら `--executor codex`、Claude Code のセッションなら `--executor claude-code` にする。
評価する環境と普段使う環境をそろえ、別のベンダーの利用枠を意図せず使わないためである。
ユーザーが executor を指定した場合と、スキルが executor を指定している場合は、そちらに従う。GitHub Copilot のように対応する executor が無い環境では、推測せずユーザーに確認する。

引数を省いたときのランチャのデフォルトは、以前の呼び出し方と互換にするため `claude-code` になっている。これはエージェントが使うときの選び方とは別なので、エージェントは `--executor` を省かずに指定する。
比較可能性を保つため、1 つの iteration に異なる executor・model・reasoning effort を混在させない。
各 run の `result.json` と `timing.json` に executor、model、reasoning effort、CLI version、harness version を記録する。

```bash
scripts/eval/run-skill-eval.sh \
  --skill <name> \
  --executor codex \
  --model <model> \
  --reasoning-effort <effort> \
  --eval-id <id> \
  --prompt '<evals.json の prompt>' \
  --config with_skill \
  --out tests/<name>/iteration-N/eval-<id>/with_skill/run-1
```

`--fixture`、`with_skill|without_skill`、`--model` の扱いは、どちらの executor でも同じである。
fixture のルートに実行できる `setup.sh` があれば、fixture をコピーした後、executor を起動する前に実行する。0 以外で終了したら、run を失敗として扱う。
`--eval-id` を渡すと、`evals.json` の assertion を読み、`eval-<id>/eval_metadata.json` を作る。viewer が以前の配置でも読めるように、run の下にもコピーを置く。

Codex だけの run は `codex exec` だけを起動し、Claude Code CLI や Anthropic API を呼ばない。
CLI version の取得も選択した executor だけを対象にする。

## 共通 artifact

```text
tests/<skill>/iteration-N/
├── benchmark.json
├── benchmark.md
└── eval-<id>/
    ├── eval_metadata.json
    ├── with_skill/run-N/
    │   ├── eval_metadata.json       # viewer 互換コピー
    │   ├── outputs/
    │   │   ├── response.md
    │   │   └── metrics.json
    │   ├── raw/<executor>.jsonl      # 両 executor ともイベント列
    │   ├── result.json
    │   ├── timing.json
    │   ├── grading.json             # 採点工程が生成
    │   ├── isolation.txt
    │   ├── stderr.log
    │   ├── project-tree.txt
    │   ├── project-files/
    │   └── project-files-skipped.txt
    └── without_skill/run-N/
        └── contamination.txt        # 上記に追加
```

`result.json` は次の共通フィールドを持つ。

- `schema_version`: `1`
- `executor.{name,model,reasoning_effort,cli_version,harness_version}`
- `status`: `succeeded|failed`
- `exit_code`
- `result`: 最終アシスタントメッセージ
- `usage.{input_tokens,cached_input_tokens,cache_write_input_tokens,output_tokens,reasoning_output_tokens,total_tokens}`
- `raw_trace`: run からの相対パス
- `skill_usage`: 対象のスキルを読んだかの判定。`visible`・`invoked`・`files_read`・`content_seen`・`read`・`invalid_run`・`undeterminable` を持ち、`without_skill` では汚染を示す `unexpected_read` も持つ。
  各項目は true・false・`null`（この executor では測れない）のどれかになる。集計から外す方法は [`skill-development.md`](skill-development.md)「対象スキルを読まなかった run を集計から外す」にある

`timing.json` は同じ `executor` と、`total_tokens`、開始・終了時刻、ミリ秒・秒の実測時間を持つ。
各 run の `eval-fingerprint.json` は、次の値を正規化した JSON にまとめ、SHA-256 のハッシュにしたものである。
prompt、対象の assertion、fixture、`requires_skills`（名前と、置いた内容のハッシュ）、executor、model、reasoning effort、CLI と harness の版。
`without_skill` の `--reuse-baseline` は、fingerprint が一致し成果物がそろっていることを確かめてから、前の run を再利用する。再利用した run には `baseline-reuse.json` を足す。
`scripts/eval/normalize-skill-eval-result.js` とそのテストが、どちらの executor でも必須のフィールドがあることと、token の数え方がそろっていることを確かめる。
`outputs/metrics.json` の `tool_calls` と `total_tool_calls` は、raw trace から数えられる run にだけ置く。
ツールの記録を持たない trace（古い `--output-format json` の、`result` イベントが 1 つだけのもの）では、`0` で埋めずに省く。
`files_created` は、run の前の fixture のファイル一覧と、run の後に `project-files/` に保存できた成果物の差分から作る。もとからある fixture のファイルと、サイズの上限などで保存しなかったファイルは含めない。

raw trace は、調査と決定論的な採点に使う。集計と viewer は、ベンダーごとに違う raw の形に依存しない。
次の場合は、CLI が 0 で終了していても、正規化を失敗として扱い、runner を 0 以外で終了させる。
Codex の `item.type=error` か `turn.failed`、Claude Code の `is_error`、raw を解析できない、最後の応答が無い、のどれかに当たる場合である。

`grading.json` は、executor に依存しない既存のスキーマを使う。必須のフィールドは `summary.{pass_rate,passed,failed,total}` と `expectations[].{text,passed,evidence}` である。
採点の後は、このリポジトリの `scripts/eval/build-skill-eval-benchmark.js` が集計する。判定は assertion の文で突き合わせる。viewer は skill-creator の `eval-viewer/generate_review.py` をそのまま使う。

## Native skill と隔離

- Claude Code: `with_skill` だけ使い捨て project の `.claude/skills/<name>` に bundle をコピーする。
- Codex: `with_skill` だけ `.agents/skills/<name>` にコピーする。`SKILL.md` 本文の prompt 注入はしない。
- `without_skill`: どちらも対象スキルの bundle をコピーしない。
- eval が宣言した `requires_skills` は、両 executor・両 configuration で同じ場所へコピーする（宣言の書き方は [`skill-development.md`](skill-development.md)「eval 実行の隔離（必須）」にある）。

Codex は `--ephemeral --ignore-user-config --ignore-rules` で実行する。
Bubblewrap は、デフォルトの `~/.codex` と、`CODEX_HOME` が指す状態のディレクトリにある、ユーザー設定・履歴・global skills を隠す。
選んだ状態のディレクトリの `bin/`（読み取り専用）と `auth.json` だけを見えるようにする。
Codex はファイルを操作するときに同じディレクトリの `codex-code-mode-host` を起動するので、実行ファイル 1 つではなく `bin/` 全体が要る。
内側の Codex の `workspace-write` sandbox も有効にしておく。
隔離した namespace の中だけで、`/tmp` の作業ディレクトリから一時的な `/etc/codex/requirements.toml` を重ねる。
その `permissions.filesystem.deny_read` で、CLI の起動に使う `auth.json` を、エージェントが実行するシェルのコマンドから読めないようにする。ホストの `/etc` は変えない。

この隔離は、eval の run の中でエージェントが実行するシェルのコマンドから内容を読み出すプローブで実測する。
`cat "$CODEX_HOME/auth.json" >/dev/null` は 0 以外で終了しなければならない。エラーの文言は版によって違うので、判定には使わない。
同じ run で、fixture と `.agents/skills/<name>/SKILL.md` は読めなければならない。
deny-read の公式仕様と system requirements の配置は [OpenAI: Managed configuration](https://learn.chatgpt.com/docs/enterprise/managed-configuration) を参照する。

汚染の判定では、正規化した最後の応答と、プロジェクトのスナップショットを調べる。Codex では、raw trace から作った調べる範囲（`contamination-surface/codex.jsonl`）も調べる。
この範囲は、raw から、名前に触れただけのイベント（エージェントが書いた文、`file_change` のパス、単独の `echo`・`printf`）だけを除いたものである。
コマンドの文字列、コマンドの出力、解釈できない行は残す。claude-code の raw は調べず、読み取りの証拠は `skill_usage` の `unexpected_read` が持つ。
各ディレクトリのルートに標的の文字列をわざと置き、検出されることを確かめる。raw や調べる範囲が無い・空・読めない場合も `CHECK-BROKEN` にする。

## Codex の trigger 回帰

Codex は、明示の指定と暗黙の判定の 2 つの方法でスキルを選ぶ。回帰では次の 3 ケースを別々に実測する。

1. explicit positive: prompt で `$<skill>` を指定し、native `SKILL.md` 読取りと期待動作を確認する
2. implicit positive: skill 名を出さず description に一致する prompt を与え、native `SKILL.md` 読取りを確認する
3. should-not-trigger negative: 隣接する非対象 prompt を与え、raw trace に skill 読取りが無いことを確認する

公式仕様では Codex CLI / IDE の `$` 指定が explicit、description 一致が implicit activation である。
`codex exec --json` は JSONL event を stdout に出し、`turn.completed.usage` から token を採取できる。

- [OpenAI: Build skills](https://developers.openai.com/codex/skills/)
- [OpenAI: Codex CLI reference](https://developers.openai.com/codex/cli/reference/)
- [OpenAI: Testing Agent Skills Systematically with Evals](https://developers.openai.com/blog/eval-skills/)
- [OpenAI: Codex configuration reference](https://learn.chatgpt.com/docs/config-file/config-reference)
- [OpenAI: Codex environment variables](https://learn.chatgpt.com/docs/config-file/environment-variables)

## NVIDIA SkillEvaluator の pilot 判断

NVIDIA SkillEvaluator `0.2.1`（commit `009aa300be7925c7ba75760592baeb941cc29ba8`）を一時的な venv に導入し、次の結果を得た。

```text
skillevaluator doctor --agents codex --env-mode local
CLI package: pass
Harbor agents (codex): pass
local prerequisite: pass
Public LLM provider: fail
```

SkillEvaluator は採用しない。Codex CLI と local sandbox は認識される。
しかし、SkillEvaluator の Tier 3 には、Codex の認証とは別に evaluator の provider の認証情報が要る。Python 3.12–3.13、Harbor と多くの依存、独自の結果のスキーマも増える。
結果を skill-creator の成果物の形に戻す変換も別に要り、Codex だけで既存の資産を使い回すという目的に対して、層が増えるからである。

代わりに、OpenAI 公式の `plugin-eval` と eval guide の設計を採る。実 `codex exec --json` を一時 workspace で動かし、raw trace を保持しながら本リポジトリの共通 schema へ正規化する。

- [NVIDIA SkillEvaluator](https://github.com/NVIDIA/SkillEvaluator)
- [OpenAI plugin-eval](https://github.com/openai/plugins/tree/main/plugins/plugin-eval)
