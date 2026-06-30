# 回帰テスト

`pr-finalize-loop` スキルの動作をテストケースで検証する手順。

## ファイル構成

```text
/
├── skills/pr-finalize-loop/
│   └── evals/
│       ├── evals.json              ← テスト定義（プロンプト + アサーション）
│       └── README.md               ← この文書
└── tests/pr-finalize-loop/
    └── iteration-N/
        ├── benchmark.json          ← 結果サマリー（eval_id → アサーション合否）
        └── benchmark.md            ← 人間向けサマリー
```

`benchmark.json` の `eval_id` は `evals.json` の `id` に対応する。

## 前提条件

- **Python 3.8+** — 集計スクリプトの実行に必要
- **skill-creator スキル** — テスト実行・評価に必要（`~/.claude/skills/skill-creator/`・`.claude/skills/skill-creator/`・`.agents/skills/skill-creator/` のいずれかにインストール済みであること）
- **テスト用 PR** — `evals.json` の `prompt` は実在 PR URL を前提とする。CI 失敗・未解決レビュースレッドを含む検証用 PR を用意し、必要に応じて `prompt` の URL を差し替える（破壊的操作を避けるため、本物の本番 PR ではなく使い捨ての検証用 PR を使う）

```bash
python --version
```

## 回帰テストの実行手順

### 1. 新しい iteration ディレクトリを用意する

前回の番号に +1 した番号で作成する（例: 前回が `iteration-1` なら `iteration-2`）。

```bash
mkdir -p tests/pr-finalize-loop/iteration-N
```

### 2. skill-creator を使ってテストを実行する

AI エージェント（Claude Code, Codex, GitHub Copilot 等）で以下を指示する。Claude Code の場合は `/skill-creator` でスキルを呼び出せる。

```text
skill-creator を使って skills/pr-finalize-loop のスキルを検証したい。
スキルの場所は skills/pr-finalize-loop/SKILL.md。
evals/evals.json のテストケースを使って回帰テストを実行したい。
結果は tests/pr-finalize-loop/iteration-N/ に保存すること。
```

### 3. 結果を集計する

```bash
# skill-creator のインストール先を自動検索（ユーザーレベル・プロジェクトレベルの両方を探索）
SKILL_CREATOR=$(find ~/.claude/skills .claude/skills .agents/skills -maxdepth 1 -name skill-creator -type d 2>/dev/null | head -1)

cd "$SKILL_CREATOR"
python -m scripts.aggregate_benchmark \
  /path/to/tests/pr-finalize-loop/iteration-N \
  --skill-name pr-finalize-loop \
  --skill-path '<repo>/skills/pr-finalize-loop'
```

### 4. 前回との比較

```bash
# benchmark.md でサマリーを確認
cat tests/pr-finalize-loop/iteration-N/benchmark.md

# 前回との差分
diff tests/pr-finalize-loop/iteration-<前回>/benchmark.md \
     tests/pr-finalize-loop/iteration-N/benchmark.md
```

## Git 管理方針

| パス | 管理 | 理由 |
|------|------|------|
| `evals/evals.json` | 追跡 | テスト定義はスキルと一緒にバージョン管理 |
| `tests/*/iteration-N/benchmark.json` | 追跡 | 回帰比較のためサマリーを保持 |
| `tests/*/iteration-N/benchmark.md` | 追跡 | 人間向けサマリー |
| `tests/*/iteration-N/eval-*/` | 除外 | 詳細な実行ログは肥大化するため除外 |

## スキル修正後の確認フロー

1. `SKILL.md` またはコンポーネントファイルを修正する
2. 上記手順で新しい iteration を実行する
3. `benchmark.json` の pass_rate が前回以上であることを確認する
4. 問題があれば `benchmark.json` の `expectations` で失敗アサーションを特定する
