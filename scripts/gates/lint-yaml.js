#!/usr/bin/env node
// YAML の構文検査（CI の Lint ジョブはリポジトリ全体、lefthook pre-commit はステージしたファイル）。
//
// 以前は 1 ファイルごとに `pnpm exec js-yaml <file>` を起動していた。起動が 1 回約 0.6 秒かかり（`pnpm exec` の起動コスト）、
// 66 ファイルで 44 秒を占めていた（Issue #507）。js-yaml の API で全ファイルを 1 プロセスで読む。
// 判定は js-yaml の CLI と同じにする: JSON として読めればよし、読めなければ `loadAll`（複数文書）で読む。
//
// 使い方:
//   node scripts/gates/lint-yaml.js                 # --root（既定はリポジトリ）配下の *.yml / *.yaml を全部
//   node scripts/gates/lint-yaml.js <file> ...      # 指定したファイルだけ（lefthook 用）
//   node scripts/gates/lint-yaml.js --root <dir>    # 走査の起点を変える（テスト用）
//
// **対象 0 件は成功に倒さない**（走査が空振りしただけの緑を根拠にしない）。検査した件数と起点を必ず出す。
// 終了コード: 0 = 全件読めた / 1 = 読めないファイルがある・対象 0 件 / 2 = 使い方の誤り
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import yaml from "js-yaml";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

// 起点直下のこれらは対象外（CI の旧 `find` の `-path "./<dir>" -prune` と同じ集合）。
// `.agents` / `.claude` はインストール済みコピーとエージェント用シンボリックリンク（AGENTS.md）。
export const PRUNED = ["node_modules", ".git", ".agents", ".claude"];
const YAML_RE = /\.ya?ml$/;

/**
 * 起点のリポジトリの YAML ファイルを列挙する。**列挙は git に任せる**（追跡済み＋未追跡のうち ignore されないもの）。
 * ディレクトリを素で走査すると、gitignore された手元の eval 出力（`tests/<スキル>/iteration-N/eval-N/` 配下）まで拾い、
 * CI の checkout には無いファイルで手元だけ赤くなる（実測）。git が失敗したら空配列に倒さず投げる。
 */
export function findYamlFiles(root) {
  const out = execFileSync(
    "git",
    ["ls-files", "-z", "--cached", "--others", "--exclude-standard"],
    {
      cwd: root,
      maxBuffer: 1 << 28,
    },
  ).toString();
  const found = out
    .split("\0")
    .filter((f) => f && YAML_RE.test(f) && !PRUNED.includes(f.split("/")[0]))
    .map((f) => join(root, f))
    // `--cached` は作業ツリーで消した（未ステージの削除）追跡ファイルも返す。読めない ENOENT で赤くしない。
    .filter((p) => existsSync(p));
  return [...new Set(found)].sort();
}

/** 1 ファイルを js-yaml の CLI と同じ判定で読む。読めなければ理由を返す。 */
export function lintFile(path) {
  let text;
  try {
    text = readFileSync(path, "utf8");
  } catch (err) {
    return err instanceof Error ? err.message : String(err);
  }
  try {
    JSON.parse(text);
    return null;
  } catch {
    /* JSON でなければ YAML として読む */
  }
  try {
    yaml.loadAll(text, () => {});
    return null;
  } catch (err) {
    return err instanceof Error ? err.message : String(err);
  }
}

/**
 * @param {string[]} argv
 * @param {{ out?: (s: string) => void, err?: (s: string) => void }} [io]
 * @returns {number}
 */
export function main(argv, io = {}) {
  const out = io.out ?? ((s) => process.stdout.write(s));
  const err = io.err ?? ((s) => process.stderr.write(s));
  const usage = "usage: node scripts/gates/lint-yaml.js [--root <dir>] [<file>...]";
  let root = repoRoot;
  const files = [];
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === "--root") {
      const v = argv[i + 1];
      if (!v || v.startsWith("--")) {
        err(`error: --root に値が無い\n${usage}\n`);
        return 2;
      }
      root = resolve(v);
      i += 1;
    } else if (a.startsWith("-")) {
      err(`error: 不明な引数 ${a}\n${usage}\n`);
      return 2;
    } else files.push(resolve(a));
  }
  let targets = files;
  if (files.length === 0) {
    try {
      targets = findYamlFiles(root);
    } catch (e) {
      err(`lint-yaml: YAML を列挙できない（${root}）: ${e instanceof Error ? e.message : e}\n`);
      return 2;
    }
  }
  if (targets.length === 0) {
    err(`lint-yaml: 対象の YAML が 0 件（${root}）。走査の起点と除外を確かめる\n`);
    return 1;
  }
  let broken = 0;
  for (const path of targets) {
    const problem = lintFile(path);
    if (problem !== null) {
      broken += 1;
      err(`${relative(root, path) || path}: ${problem}\n`);
    }
  }
  const scope = files.length > 0 ? "指定したファイル" : root;
  if (broken > 0) {
    err(`lint-yaml: ${targets.length} 件中 ${broken} 件を YAML として読めない（${scope}）\n`);
    return 1;
  }
  out(`lint-yaml: ${targets.length} 件を検査した（${scope}）\n`);
  return 0;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exit(main(process.argv.slice(2)));
}
