# 回帰テスト

`aws-architecture-diagram` スキルの動作をテストケースで検証する手順。

## ファイル構成

```text
/
├── skills/aws-architecture-diagram/
│   └── evals/
│       ├── evals.json              ← テスト定義（プロンプト + アサーション）
│       └── README.md               ← この文書
└── tests/aws-architecture-diagram/
    └── iteration-N/
        ├── benchmark.json          ← 結果サマリー（eval_id → アサーション合否）
        └── benchmark.md            ← 人間向けサマリー
```

`benchmark.json` の `eval_id` は `evals.json` の `id` に対応する。

## evals.json が検証する観点

- IaC（CDK / Terraform 等）や説明から spec（nodes / edges / groups）を起こせるか
- 環境（prod / local など）ごとに出し分けできるか
- 作図ルール（交差最小・直交配線・軸整列・ラベル可読）に沿って崩れを直せるか

## 前提条件

- **Node.js 18+** — 描画・取得スクリプト（`assets/engine/*.mjs`）の実行に必要。
  `fetch-aws-icons.mjs` がグローバル `fetch` を使うため 18 未満は不可
- **Chrome / Chromium**（headless）— SVG→PNG 変換（`preview-diagram.mjs`）に必要。無い場合は
  `PUPPETEER_EXECUTABLE_PATH` / `CHROME_PATH` を設定する
- **skill-creator スキル** — テスト実行・評価に必要（`~/.claude/skills/skill-creator/`・
  `.claude/skills/skill-creator/`・`.agents/skills/skill-creator/` のいずれかにインストール済みであること）
- **Python 3.8+** — 集計スクリプトの実行に必要

```bash
node --version
python --version
```

## 回帰テストの実行手順

### 1. 新しい iteration ディレクトリを用意する

前回の番号に +1 した番号で作成する（例: 前回が `iteration-1` なら `iteration-2`）。

```bash
mkdir -p tests/aws-architecture-diagram/iteration-N
```

### 2. skill-creator を使ってテストを実行する

AI エージェント（Claude Code, Codex, GitHub Copilot 等）で以下を指示する。Claude Code の場合は
`/skill-creator` でスキルを呼び出せる。

```text
skill-creator を使って skills/aws-architecture-diagram のスキルを検証したい。
スキルの場所は skills/aws-architecture-diagram/SKILL.md。
evals/evals.json のテストケースを使って回帰テストを実行したい。
結果は tests/aws-architecture-diagram/iteration-N/ に保存すること。
```

### 3. 結果を集計する

```bash
# skill-creator のインストール先を自動検索（ユーザーレベル・プロジェクトレベルの両方を探索）
SKILL_CREATOR=$(find ~/.claude/skills .claude/skills .agents/skills -maxdepth 1 -name skill-creator -type d 2>/dev/null | head -1)

cd "$SKILL_CREATOR"
python -m scripts.aggregate_benchmark \
  /path/to/tests/aws-architecture-diagram/iteration-N \
  --skill-name aws-architecture-diagram \
  --skill-path '<repo>/skills/aws-architecture-diagram'
```

### 4. 前回との比較

```bash
cat tests/aws-architecture-diagram/iteration-N/benchmark.md
diff tests/aws-architecture-diagram/iteration-<前回>/benchmark.md \
     tests/aws-architecture-diagram/iteration-N/benchmark.md
```

## Git 管理方針

| パス | 管理 | 理由 |
|------|------|------|
| `evals/evals.json` | 追跡 | テスト定義はスキルと一緒にバージョン管理 |
| `tests/*/iteration-N/benchmark.json` | 追跡 | 回帰比較のためサマリーを保持 |
| `tests/*/iteration-N/benchmark.md` | 追跡 | 人間向けサマリー |
| `tests/*/iteration-N/eval-*/` | 除外 | 詳細な実行ログは肥大化するため除外 |
