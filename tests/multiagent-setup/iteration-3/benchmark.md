# Skill Benchmark: multiagent-setup

**Model**: Codex default
**Date**: 2026-08-30
**Evals**: 5, 6, 7（各構成 1 run）

## Summary

| Metric | Without Skill | With Skill | Delta |
|---|---:|---:|---:|
| Pass Rate | 73% | 100% | +27pt |
| Time | 78.0s | 62.1s | -15.9s |
| Tokens | 220517 | 233176 | +12659 |

主要な説明・判断依頼の4方針は baseline も満たしたため、これらは後退検知として扱う。弁別差は、with-skill が共通方針を基底ドキュメントへ集約し、エージェント固有ファイルへの複製や追加ガイドを作らなかった点に現れた。

既存プロジェクトについては、方針が無い状態と同等方針が既にある状態を fixture で実測した。with-skill はどちらも既存情報を保持し、不足時だけ一組の方針を追加した。同等方針がある場合は重複追加しなかった。
