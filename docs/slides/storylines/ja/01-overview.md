# 1. リポジトリの概要

伝えること: 何を解決するスキル集か、スキル群の地図、導入のコマンド。

## スライド

1. 表紙。Claude Code・Codex・GitHub Copilot で使えるスキル集であることを示す。
   根拠: `README.md` の冒頭
2. 何を解決するか。エージェントに開発を任せると、手順がエージェントごとにばらつき、同じ失敗を繰り返す。
   そこで、Issue の起票から merge までの手順をスキルにして、どのエージェントでも同じ手順で進める。
   根拠: `README.md` の冒頭
3. スキル群の構成。全体に関わるスキル（multiagent-setup・writing-style）を最下段の基盤に置き、その上に 4 つの柱を同じ重みで並べる図にする。
   4 つの柱は、単独で使うスキル（browser-test・aws-architecture-diagram・box）、依存の更新、Issue から merge まで、仕様を変えないリプレイスである。
   根拠: `README.md`「利用可能なスキル」
4. 導入。前提は `gh` の v2.90.0 以上と `gh auth login`。`gh skill install shoji9x9/skills <名前>` で入れ、`gh skill update --all` で更新する。
   根拠: `README.md`「前提条件」「インストール」「スキルの更新」
5. 設定。スキルの設定は、3 つの層（リポジトリ・人ごとのリポジトリ限定・人ごと）のファイルに置く。
   根拠: `README.md`「スキルの設定」
6. 次に読むもの。第 2〜10 章へのリンクを、同じ重みで並べる。
