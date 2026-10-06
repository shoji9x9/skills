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
- 作図ルール（交差の最小化・線の直交・軸の整列・ラベルの読みやすさ）に沿って崩れを直せるか

## 前提条件

- Node.js 18 以上（描画・取得スクリプト `assets/engine/*.mjs` の実行に使う）。
  `fetch-aws-icons.mjs` がグローバルの `fetch` を使うので、18 未満では動かない
- Chrome か Chromium（headless。SVG→PNG 変換 `preview-diagram.mjs` に使う）。見つからない場合は
  `PUPPETEER_EXECUTABLE_PATH` か `CHROME_PATH` を設定する
- skill-creator スキル（テストの実行と評価に使う）。`~/.claude/skills/skill-creator/`・
  `.claude/skills/skill-creator/`・`.agents/skills/skill-creator/` のどれかにインストールしておく
- Python 3.8 以上（集計スクリプトの実行に使う）

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
node scripts/eval/build-skill-eval-benchmark.js tests/aws-architecture-diagram/iteration-N \
  --skill-name aws-architecture-diagram \
  --skill-path '<repo>/skills/aws-architecture-diagram' \
  --executor-model <model-id> \
  --analyzer-model <model-id>
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
