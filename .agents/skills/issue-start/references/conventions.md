# ブランチ運用・commit 規約の参照

ブランチ運用と commit の規約はリポジトリごとに違うので、次の順で決める。スキルの中にデフォルトの規約は持たない。

1. 設定を見る。`common` の `conventions_doc` を、このスキルの中の読み取りで取得する（Node.js が要る）。

   ```bash
   node <このスキルのディレクトリ>/scripts/skill-config/skill-config.mjs get common conventions_doc --raw
   ```

   exit 0 で出力したパスのファイルが実在すれば、その文書の規約に従う。
   exit 3（設定が無い）か、指定先のファイルが無ければ、2 に進む。
   exit 1（設定の誤りか、旧い場所の設定が残っている）なら、エラーの内容を利用者に示して止まる。
   設定ファイル（`.config/skills/shoji9x9/common.jsonc` など、[`config-files.md`](config-files.md)「層と置き場所」の 3 つ）がどれも無く、Node.js も無いときは、2 に進む。
   設定ファイルがあって Node.js が無ければ、設定を読めないとして止まる。
2. よく使われる文書を探す。`AGENTS.md`・`CLAUDE.md`・`.github/copilot-instructions.md`・`CONTRIBUTING.md` を探し、規約が書かれていればそれに従う。
3. 決められなければ、どの文書と規約に従うかを利用者に確かめる。
   確かめた後、「`.config/skills/shoji9x9/common.jsonc` の `conventions_doc` に記録すれば、次回からその文書を参照する」と伝える。
   了承を得たら、次の節の方法で記録する。

## 設定（`common` の `conventions_doc`）

`conventions_doc` は、リポジトリの全員が同じ値を使うので、リポジトリの層（`.config/skills/shoji9x9/common.jsonc`）だけに置ける。
`gh skill update` はスキルのディレクトリの外にあるこのファイルに触れないので、設定は残る。

```jsonc
{
  // 導入先に実在する規約の文書を指定する（例: AGENTS.md / CLAUDE.md / CONTRIBUTING.md）。
  // 無ければこのキー自体を書かず、探索と利用者への確認に任せる。
  "conventions_doc": "AGENTS.md"
}
```

記録は、読み取りの `set` で行う。キーが既にあれば、値を変えずに止まる（[`config-files.md`](config-files.md)「書き込みの決まり」）。

```bash
node <このスキルのディレクトリ>/scripts/skill-config/skill-config.mjs set common conventions_doc '"<文書のパス>"' --layer repo
```

値には、探索か利用者への確認で得た、実在する文書を書く。上の `AGENTS.md` は例なので、確かめずにそのまま書かない。
