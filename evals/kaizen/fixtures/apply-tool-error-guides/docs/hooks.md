# エージェントの Hook

## ツールの失敗の案内

`tools/hooks/tool-error-guide.mjs` は、Claude Code の PostToolUseFailure の Hook である。
ツールの呼び出しが失敗したか拒否されたとき、エラーの文を `tools/hooks/tool-error-guides.json` の行と照らし、一致した行の案内を次の応答の前にエージェントへ渡す。

Hook が呼ばれるのは、実行を始めたツールが失敗したとき（Bash の 0 以外の終了コードを含む）と、ハーネスが実行を拒否したときである。
入力の検証で返されたエラー（Edit の置換元が見つからないなど）と、PreToolUse の Hook による拒否では呼ばれない。

一覧の行には、次のキーを書く。

| キー | 書くこと |
| --- | --- |
| `id` | 行を見分ける名前 |
| `error` | エラーの文に当てる正規表現 |
| `guide` | エージェントに渡す案内 |
| `rule` | 案内の元の規約の場所（`<パス>「<見出し>」`） |
| `examples` | `error` に一致するエラーの文の例（1 件以上） |
