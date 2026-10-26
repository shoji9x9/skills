// 組み込みの `Array.isArray` を呼ぶ型ガード `isArray` を持つファイル（リポジトリのルートからのパス）。
//
// `oxlint.config.ts` は `Array.isArray` を禁じ、この一覧のファイルでだけ外す。
// 行の disable コメントで外さないのは、配布スキルの雛形と 1 ファイルだけコピーするツールが利用者のプロジェクトへ入るためである。
// 利用者のプロジェクトでは、このリポジトリの lint の設定を前提にしたコメントは何も抑えず、
// 使われない disable を error にする設定では lint が失敗する（`.agents/rules/distributed-skill-stack-independence.md`）。
// ファイル単位で外すので、この一覧のファイルでは、型ガードの外の `Array.isArray` も oxlint は検出しない。
import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";

/** `no-restricted-properties` で禁じる `Array.isArray`（`oxlint.config.ts` が使う）。 */
export const IS_ARRAY_RESTRICTION = {
  object: "Array",
  property: "isArray",
  message:
    "isArray（scripts/lib/is-array.ts、配布スキルは scripts/lib/is-array.mjs）を使う。Array.isArray は any[] に絞る",
};

// 設定の読み取り（scripts/skill-config/skill-config.mjs）は、設定を読むスキルがすべて同じ内容で持ち、1 ファイルで完結させるので isArray を持つ。
// スキルを足すたびにこの一覧を直さずに済むよう、在るものを数える。
const ROOT = join(import.meta.dirname, "..", "..");
const SKILL_CONFIG_READERS = readdirSync(join(ROOT, "skills"))
  .sort()
  .map((name) => `skills/${name}/scripts/skill-config/skill-config.mjs`)
  .filter((p) => existsSync(join(ROOT, p)));

export const IS_ARRAY_HOLDERS = [
  ...SKILL_CONFIG_READERS,
  "scripts/lib/is-array.ts",
  "scripts/mutation/check-mutation-proof.ts",
  "skills/golden-dataset/scripts/lib/is-array.mjs",
  "skills/issue-start/scripts/lib/is-array.mjs",
  "skills/agent-usage/scripts/lib/is-array.mjs",
  "skills/parity-component/scripts/lib/is-array.mjs",
  "skills/parity-diff/scripts/lib/is-array.mjs",
  "skills/parity-suite/scripts/lib/is-array.mjs",
  "skills/replace-strategy/scripts/lib/is-array.mjs",
  "skills/parity-suite/scripts/header-normalize.mjs",
  "skills/parity-suite/scripts/trait-compare.mjs",
  "skills/parity-diff/assets/capture-new.spec.template.ts",
  "skills/parity-suite/assets/perf-capture.spec.template.ts",
];
