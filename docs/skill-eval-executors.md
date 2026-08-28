# スキル評価 executor 契約

`scripts/run-skill-eval.sh` は同じ `skills/<name>/evals/evals.json` を Claude Code と Codex で実行し、executor 固有の出力を共通 artifact へ正規化する。
Anthropic 版 `skill-creator` と既存の集計・viewer は変更しない。

## Executor の選択

`--executor claude-code|codex` で選ぶ。既定は後方互換のため `claude-code`。
比較可能性を保つため、1 つの iteration に異なる executor・model・reasoning effort を混在させない。
各 run の `result.json` と `timing.json` に executor、model、reasoning effort、CLI version、harness version を記録する。

```bash
scripts/run-skill-eval.sh \
  --skill <name> \
  --executor codex \
  --model <model> \
  --reasoning-effort <effort> \
  --eval-id <id> \
  --prompt '<evals.json の prompt>' \
  --config with_skill \
  --out tests/<name>/iteration-N/eval-<id>/with_skill/run-1
```

`--fixture`、`with_skill|without_skill`、`--model` の既存契約は両 executor で共通。`--eval-id` を渡すと `evals.json` の assertion を読み、canonical な `eval-<id>/eval_metadata.json` と viewer 後方互換用の run 配下コピーを生成する。

Codex-only の run は `codex exec` だけを起動し、Claude Code CLI や Anthropic API を呼ばない。
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
    │   ├── raw/<executor>.<json|jsonl>
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

- `schema_version`: 現在は `1`
- `executor.{name,model,reasoning_effort,cli_version,harness_version}`
- `status`: `succeeded|failed`
- `exit_code`
- `result`: 最終アシスタントメッセージ
- `usage.{input_tokens,cached_input_tokens,cache_write_input_tokens,output_tokens,reasoning_output_tokens,total_tokens}`
- `raw_trace`: run からの相対パス

`timing.json` は同じ `executor` と、`total_tokens`、開始・終了時刻、ミリ秒・秒の実測時間を持つ。
`scripts/normalize-skill-eval-result.js` とそのテストが両 executor の必須フィールドと token 正規化を強制する。
`outputs/metrics.json` の `tool_calls` / `total_tool_calls` は raw trace から測れる executor だけに置く。Claude Code の final JSON から復元できない値を `0` で埋めない。
`files_created` は run 前の fixture file manifest と、run 後に `project-files/` へ保存できた artifact の差分で生成する。既存 fixture、size cap 等で保存されなかったファイルは含めない。

raw trace は調査・deterministic grading 用であり、集計・viewer は raw の vendor 固有 schema に依存しない。
Codex の `item.type=error` / `turn.failed`、Claude Code の `is_error`、raw の parse 失敗、final response 不在は、CLI exit が 0 でも正規化を fail-closed にして runner を非 0 終了させる。

`grading.json` は executor に依存しない既存 schema を使う。必須フィールドは `summary.{pass_rate,passed,failed,total}` と `expectations[].{text,passed,evidence}`。
採点後は既存 skill-creator の `aggregate_benchmark.py` と `eval-viewer/generate_review.py` をそのまま使う。

## Native skill と隔離

- Claude Code: `with_skill` だけ使い捨て project の `.claude/skills/<name>` に bundle をコピーする。
- Codex: `with_skill` だけ `.agents/skills/<name>` にコピーする。`SKILL.md` 本文の prompt 注入はしない。
- `without_skill`: どちらも bundle をコピーしない。

Codex は `--ephemeral --ignore-user-config --ignore-rules` で実行する。
Bubblewrap は既定の `~/.codex` と、`CODEX_HOME` が指定する canonical state root の user config・履歴・global skills を隠す。選択した state root の read-only `bin/` と `auth.json` だけを戻す。
Codex はファイル操作で sibling の `codex-code-mode-host` を起動するため、単一 executable ではなく `bin/` 全体が必要。
内側の Codex `workspace-write` sandbox も有効に保つ。
`/tmp` の scratch から隔離 namespace 内だけに一時 `/etc/codex/requirements.toml` を重ね、`permissions.filesystem.deny_read` で CLI 起動用の `auth.json` を agent shell command から保護する。
host の `/etc` は変更しない。

この境界は、eval run 内で agent が発行する shell command から内容を読み出す probe で実測する。`cat "$CODEX_HOME/auth.json" >/dev/null` は非 0 でなければならない（エラー文言はバージョン差があるため固定しない）。
同じ run の fixture と `.agents/skills/<name>/SKILL.md` は読取り成功しなければならない。
deny-read の公式仕様と system requirements の配置は [OpenAI: Managed configuration](https://learn.chatgpt.com/docs/enterprise/managed-configuration) を参照する。

汚染判定は正規化済み final response、project snapshot、raw trace を走査する。
各 directory root に陽性コントロールを植えて検出能力を実証し、raw 不在・空・読取り不能も `CHECK-BROKEN` とする。

## Codex の trigger 回帰

Codex は skill を明示と暗黙の 2 経路で選ぶ。回帰では次の 3 ケースを別々に実測する。

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

2026-08-27 に NVIDIA SkillEvaluator `0.2.1`、commit `009aa300be7925c7ba75760592baeb941cc29ba8` を一時 venv へ導入し、次を実測した。

```text
skillevaluator doctor --agents codex --env-mode local
CLI package: pass
Harbor agents (codex): pass
local prerequisite: pass
Public LLM provider: fail
```

今回は採用しない。Codex CLI と local sandbox の認識は通るが、Tier 3 には Codex の既存認証とは別の evaluator provider credential が必要で、Python 3.12–3.13、Harbor と大きな依存集合、独自 results schema も追加される。
既存 skill-creator artifact へ戻す adapter が別途必要になり、Codex-only で既存資産を再利用する目的に対して層が増えるためである。

fallback は OpenAI 公式 `plugin-eval` と eval guide の設計を採る。実 `codex exec --json` を一時 workspace で動かし、raw trace を保持しながら本リポジトリの共通 schema へ正規化する。

- [NVIDIA SkillEvaluator](https://github.com/NVIDIA/SkillEvaluator)
- [OpenAI plugin-eval](https://github.com/openai/plugins/tree/main/plugins/plugin-eval)
