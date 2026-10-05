# ブランチ運用・commit 規約の参照

ブランチ運用と commit の規約はリポジトリごとに違うので、次の順で決める。スキルの中にデフォルトの規約は持たない。

1. 設定ファイルを見る。`.config/skills/shoji9x9/skills.yml` に `skills.common.conventions_doc` があり、指定先のファイルが実在すれば、その文書の規約に従う。
   指定先が無ければ、2 に進む。
2. よく使われる文書を探す。`AGENTS.md`・`CLAUDE.md`・`.github/copilot-instructions.md`・`CONTRIBUTING.md` を探し、規約が書かれていればそれに従う。
3. 決められなければ、どの文書と規約に従うかを利用者に確かめる。
   確かめた後、「`.config/skills/shoji9x9/skills.yml` の `skills.common.conventions_doc` に記録すれば、次回からその文書を参照する」と伝える。
   了承を得たら、次の節の方法で、既存の内容を変えずに追記する。

## 設定ファイル（`.config/skills/shoji9x9/skills.yml`）

`shoji9x9/skills` の配布物が、インストール先で参照するプロジェクトの設定である。
人が編集してよい。`gh skill update` はスキルのディレクトリの外にあるこのファイルに触れないので、設定は残る。

```yaml
version: 1
skills:
  common:
    # 導入先に実在する規約の文書を指定する（例: AGENTS.md / CLAUDE.md / CONTRIBUTING.md）。
    # 無ければこのキー自体を書かず、探索と利用者への確認に任せる。
    conventions_doc: AGENTS.md
```

ファイルを作るときと追記するときは、既存の内容を変えない。

- ファイルが無ければ `.config/skills/shoji9x9/` ごと作り、このスキルが使うキー（`skills.common.conventions_doc`）だけを書く。
- 値には、探索か利用者への確認で得た、実在する文書を書く。上の `AGENTS.md` は例なので、確かめずにそのまま書かない。
- ファイルが既にあれば、欠けているキーだけを該当する節に追記する。節が無ければ親の節も足す。
- 既存のキー・値・コメントは変えない。値が既にあればそれに従い、上書きしない。
