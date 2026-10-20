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

- Python 3.8 以上（集計スクリプトの実行に使う）
- skill-creator スキル（テストの実行と評価に使う）。`~/.claude/skills/skill-creator/`・`.claude/skills/skill-creator/`・`.agents/skills/skill-creator/` のどれかにインストールしておく
- テスト用の PR。`evals.json` の `prompt` は、実在する PR の URL を前提にする。
  CI の失敗と未解決のレビュースレッドを含む検証用の PR を用意し、必要なら `prompt` の URL を差し替える。
  破壊的な操作を避けるため、本番の PR ではなく使い捨ての検証用の PR を使う

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
node scripts/eval/build-skill-eval-benchmark.ts tests/pr-finalize-loop/iteration-N \
  --skill-name pr-finalize-loop \
  --skill-path '<repo>/skills/pr-finalize-loop' \
  --executor-model <model-id> \
  --analyzer-model <model-id>
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

## 区別できない eval

- eval 20（`--defer-decisions`）のうち、確認を送らない・解決せずに残す・判断待ちとして報告する assertion は、フラグの名前から推測できるので without_skill も pass する。これらは判断待ちの扱いが消えたり食い違ったりした後退を検出するために置く。
- eval 21（最後の反復で規約の指摘を扱う）のうち、最後の反復であることを見送る理由にしない・返信してから解決する・push した HEAD が未レビューであると報告する・実行はせず説明に留める、の 4 本は、場面の説明から推測できるので without_skill も pass する。それぞれ、反復の残りを理由に指摘を見送る扱いへ戻った後退、返信と解決の順序が消えた後退、報告から未レビューの記述が消えた後退、説明に留める指示が消えた後退を検出するために置く。
- eval 22（影響と覆せるかで判断待ちを分け、effort を下げて反復を足す）のうち、次の 3 本は without_skill も pass する。
  影響の小さいスレッド A を推奨の案で解決する・影響と覆せるかで分ける・実行はせず説明に留める、である。
  前の 2 本は、prompt の場面（利用者に見えない、CI が新しく失敗する）から推測できる。それぞれ、影響の小さい指摘を判断待ちにする扱いに戻った後退、2 つの軸が消えた後退を検出するために置く。
  2 つの軸そのものは、判断待ちの印（`<!-- pr-finalize-loop:deferred -->`）を残す assertion と組み合わせたときだけ区別できる。
