# 回帰テスト

`dependabot-alert-issue` スキルの動作をテストケースで検証する手順。

## ファイル構成

```text
/
├── skills/dependabot-alert-issue/
│   └── evals/
│       ├── evals.json              ← テスト定義（プロンプト + アサーション）
│       └── README.md               ← この文書
└── tests/dependabot-alert-issue/
    └── iteration-N/
        ├── benchmark.json          ← 結果サマリー（eval_id → アサーション合否）
        └── benchmark.md            ← 人間向けサマリー
```

`benchmark.json` の `eval_id` は `evals.json` の `id` に対応する。

## 前提条件

- **Python 3.8+** — 集計スクリプトの実行に必要
- **skill-creator スキル** — テスト実行・評価に必要（`~/.claude/skills/skill-creator/` または `.claude/skills/skill-creator/` にインストール済みであること）

```bash
python --version
```

## 回帰テストの実行手順

### 1. 新しい iteration ディレクトリを用意する

前回の番号に +1 した番号で作成する（例: 前回が `iteration-1` なら `iteration-2`）。

```bash
mkdir -p tests/dependabot-alert-issue/iteration-N
```

### 2. skill-creator を使ってテストを実行する

AI エージェント（Claude Code, Codex, GitHub Copilot 等）で以下を指示する。Claude Code の場合は `/skill-creator` でスキルを呼び出せる。

```text
skill-creator を使って skills/dependabot-alert-issue のスキルを検証したい。
スキルの場所は skills/dependabot-alert-issue/SKILL.md。
evals/evals.json のテストケースを使って回帰テストを実行したい。
結果は tests/dependabot-alert-issue/iteration-N/ に保存すること。
```

### 3. 結果を集計する

```bash
# skill-creator のインストール先を自動検索（ユーザーレベル・プロジェクトレベルの両方を探索）
SKILL_CREATOR=$(find ~/.claude/skills .claude/skills .agents/skills -maxdepth 1 -name skill-creator -type d 2>/dev/null | head -1)

cd "$SKILL_CREATOR"
python -m scripts.aggregate_benchmark \
  /path/to/tests/dependabot-alert-issue/iteration-N \
  --skill-name dependabot-alert-issue \
  --skill-path '<repo>/skills/dependabot-alert-issue'
```

### 4. 前回との比較

```bash
# benchmark.md でサマリーを確認
cat tests/dependabot-alert-issue/iteration-N/benchmark.md

# 前回との差分
diff tests/dependabot-alert-issue/iteration-<前回>/benchmark.md \
     tests/dependabot-alert-issue/iteration-N/benchmark.md
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
