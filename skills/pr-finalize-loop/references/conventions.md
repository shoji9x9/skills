# ブランチ運用・commit 規約の参照

ブランチ運用・commit 規約はリポジトリごとに異なるため、次の順で解決する。既定の規約は埋め込まない。

1. **設定ファイル**: `.config/skills/shoji9x9/skills.yml` に `skills.common.conventions_doc` があり、指定先が**実在する**なら、そのドキュメントの該当規約に従う（指定先が存在しなければ 2 以降にフォールバックする）。
2. **標準ドキュメント探索**: 無ければ `AGENTS.md` / `CLAUDE.md` / `.github/copilot-instructions.md` / `CONTRIBUTING.md` を探し、規約が書かれていればそれに従う。
3. **解決できなければユーザーに確認**: どのドキュメント・規約に従うかを確認する。確認後、「`.config/skills/shoji9x9/skills.yml` の `skills.common.conventions_doc` に記録すれば次回以降そのドキュメントを参照する」旨を伝え、了承を得たら下記要領で非破壊に追記する。

## 設定ファイル（`.config/skills/shoji9x9/skills.yml`）

`shoji9x9/skills` 配布物がインストール先で参照するプロジェクト設定。人手で編集でき、`gh skill update` は skill ディレクトリ外のこのファイルに触れないため設定は保持される。

```yaml
version: 1
skills:
  common:
    # 導入先に実在する規約ドキュメントを指定（例: AGENTS.md / CLAUDE.md / CONTRIBUTING.md）。
    # 無ければこのキー自体を書かず、探索／ユーザー確認に任せる。
    conventions_doc: AGENTS.md
```

- **作成・追記は非破壊**: ファイルが無ければ `.config/skills/shoji9x9/` ごと作成し、このスキルが使うキー（`skills.common.conventions_doc`）だけを書く。指定値は**探索またはユーザー確認で得た実在ドキュメント**にする（上の `AGENTS.md` は例なので、そのまま盲目コピーしない）。
  既にあれば欠けたキーだけを該当セクション（無ければ親も）に追記し、既存のキー・値・コメントは変更しない。値が既にあれば尊重し上書きしない。
