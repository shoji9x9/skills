# Skill Benchmark: kaizen

**Model**: claude-opus-5
**Date**: 2026-08-08T11:05:20Z
**Evals**: 10 (3 runs each per configuration)

## Summary

| Metric | With Skill | Without Skill | Delta |
|--------|------------|---------------|-------|
| Pass Rate | 100% ± 0% | 0% ± 0% | +1.00 |
| Time | 94.7s ± 9.7s | 561.3s ± 77.4s | -466.6s |
| Tokens | 6593 ± 637 | 37358 ± 4044 | -30765 |

## Notes

- 6アサーションすべてが完全に弁別した。with_skill は各項目3/3、without_skill は各項目0/3で、run間の判定揺れはない。
- 今回追加した信頼手順も with_skill 3/3・without_skill 0/3。baseline も初回の信頼には触れたが、信頼前のスキップ相当・定義変更・再レビューの全要素を揃えたrunはなかった。
- without_skill は3runとも kaizen が無い状態から別実装を作ろうとし、プロジェクトローカルの `.codex/hooks.json` を生成しなかった。with_skill は3runとも同ファイルに Stop / PreToolUse / SessionStart を現行構造で生成した。
- with_skill は平均94.7秒・6593 output tokens、without_skill は平均561.3秒・37358 output tokensで、スキル利用時は平均466.6秒・30765 tokens少なかった。
- このevalは非対話の隔離環境なので、`/hooks` での人間による信頼操作と、その後のCodex実プロセスでの発火自体は検証対象外。生成設定とユーザーへの信頼案内を評価している。
