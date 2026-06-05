import { test, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import yaml from "js-yaml";
import { types } from "../commit-types.js";

// commit メッセージの type を決める設定は commit-types.js を単一の真実とする。
// commitlint.config.js（type-enum）と release.config.js（releaseRules）は
// commit-types.js を import しており構造的にドリフトしないため検査不要。
// 一方、.github/dependabot.yml の commit-message.prefix は「手書きの文字列」で
// コードに結合されておらず、conventional-commits の慣習（例: build(deps)）に
// 引きずられて許可外の type を書いても commitlint(commit-msg)/CI を通らない
// （Dependabot のコミットはローカルフックを通らない）。ここで決定論的に検査して
// 規約違反の prefix を PR 時点で弾く。将来 commit メッセージを生成する設定面が
// 増えたら、この配列に抽出関数を追加する。
const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");

function dependabotPrefixes() {
  const doc = yaml.load(readFileSync(join(repoRoot, ".github/dependabot.yml"), "utf8"));
  const out = [];
  for (const update of doc?.updates ?? []) {
    const cm = update["commit-message"];
    if (!cm) continue;
    for (const key of ["prefix", "prefix-development"]) {
      if (cm[key] != null) {
        out.push({
          source: `.github/dependabot.yml (${update["package-ecosystem"]}.commit-message.${key})`,
          value: cm[key],
        });
      }
    }
  }
  return out;
}

// 将来別の設定面が増えたら、ここに抽出関数を足す。
const prefixSources = [dependabotPrefixes];

test("commit メッセージ生成設定の prefix は commit-types.js の type に従う", () => {
  const prefixes = prefixSources.flatMap((fn) => fn());
  // 抽出ロジックが壊れて 0 件になり「素通り」するのを防ぐ回帰ガード。
  expect(prefixes.length).toBeGreaterThan(0);
  for (const { source, value } of prefixes) {
    expect(types, `${source} = "${value}" は commit-types.js の許可型に含まれること`).toContain(value);
  }
});
