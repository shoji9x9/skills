# 10. リポジトリの工夫

伝えること: エージェントによる自律的な開発、品質を保つ仕組み、セキュリティ。

## スライド

1. リポジトリの規模。本体・テスト・fixture のファイル数と行数を並べ、テストと fixture の行数が本体に近いことを示す。
   数えていないもの（インストール済みのコピー・記録・生成物と設定）と、スキルごとの内訳の置き場所（`docs/slides/repo-size.md`）を添える。
   数えた commit は、第 1 章の表紙に書いた commit と同じにする。
   根拠: `scripts/tools/repo-size.ts` の出力
2. 自律的な開発。このリポジトリ自身を、第 4 章のスキルで開発している。起票（issue-create）→ 実装（issue-start・issue-batch）→ 収束（pr-finalize-loop）→ 必須チェックが成功してから merge。
   根拠: `AGENTS.md`「ワークフロー」「ブランチ運用」
3. 確率的な挙動に頼らない。エージェントの挙動は確率的なので、守らせたいことは指示だけで済ませず、ツールの決定論的な挙動にできるだけ寄せる。
   例として、規約は CI と pre-commit のチェックで確かめる。使わない語は textlint と応答の Hook で検出する。学びの抽出は commit の前の Hook で促す。
   新旧の差分は決定論的なツールで検出し、構成図はエンジンで描く。
   根拠: `skills/kaizen/SKILL.md`「基本原則」、`AGENTS.md`「確かめ方」、`docs/tooling.md`「文章のチェック」、`skills/parity-diff/SKILL.md` の冒頭、`skills/aws-architecture-diagram/SKILL.md` の冒頭
4. 失敗から学ぶ。kaizen が失敗から学びを抽出し、根本原因に対策する。反映先は、3 の考え方に従って、決定論的なチェック（リンター・Hook・スクリプト）を優先する。学びは `.kaizen/` に置き、どのエージェントも読む。
   根拠: `skills/kaizen/SKILL.md`「基本原則」、`.kaizen/`
5. 複数のエージェントで共有する。Claude Code・Codex・GitHub Copilot が、同じスキル・ルール・ドキュメントを読む（第 2 章の構成を、このリポジトリにも当てている）。
   根拠: `AGENTS.md` の冒頭と「ディレクトリ構造」
6. 品質: テスト。スキルごとの回帰 eval、ミューテーションテスト、ファイルごとのカバレッジの閾値で、テストがスキルとスクリプトの誤りを検出できることを確かめる。期待値は仕様から決める。
   根拠: `docs/skill-development.md`「回帰テストを実行する」、`docs/testing.md`「期待値は仕様から決める」「カバレッジ」「ミューテーションテスト」
7. 品質: 横断のチェック。文書の階層と参照、時間がたつと正しくなくなる記述、インストール済みのコピーとの一致、スキルの索引、ディレクトリの構成を、pre-commit と CI でチェックする。
   根拠: `.github/workflows/ci.yml` の `Lint` ジョブ、`lefthook.yml`、`docs/tooling.md`
8. 品質: 文章。文章の規約を、文書は textlint で、人への応答は Stop の Hook でチェックする（第 3 章の規則を、このリポジトリにも当てている）。意味から来る規則は lint にせず、人が確かめる。
   根拠: `docs/tooling.md`「文章のチェック」、`docs/writing-style.md`
9. セキュリティ。gitleaks でシークレットを走査し、pinact で GitHub Actions を SHA に固定し、ghalint と actionlint でワークフローをチェックする。
   lockfile とレジストリの署名を確かめ、依存の脆弱性は第 5 章のスキルで Issue にする。`main` はルールセットで守り、必須チェックの成功を merge の条件にする。
   根拠: `.github/workflows/ci.yml`、`lefthook.yml`、`AGENTS.md`「ブランチ運用」「脆弱性対応」
10. まとめ。第 1 章のスキル群の構成に戻り、各章を並べる。公開するときは、各章の箱からその章のスライドへリンクする。
