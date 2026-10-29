#!/usr/bin/env node
// 拡張子で選んだ実体のファイルを引数にして、lint のコマンドを実行する（CI）。
//
// 使い方: node scripts/gates/tooling/run-on-sources.ts --ext sh[,json] -- <コマンド> [引数...]
//
// 対象は、git が管理する、または ignore されていない未追跡のファイルのうち、拡張子が一致するもの。
// エージェント用のコピーとリンク（scripts/lib/source-scope.ts）、node_modules/、シンボリックリンクは除く。
// 以前の CI は `find` で `.agents` を丸ごと除いていたので、rule と private skill の実体が lint されていなかった。
//
// 対象が 0 件なら、コマンドを実行せずに exit 2 にする（列挙できていないことを合格として扱わない）。
// それ以外は、コマンドの終了コードを返す。
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, lstatSync } from "node:fs";
import { join } from "node:path";
import { isAgentCopy } from "../../lib/source-scope.ts";
import { isCliEntry } from "../../lib/cli/entry.ts";

/** root の下で、拡張子が exts のいずれかに一致する実体のファイル（リポジトリ相対、昇順）。 */
export function listSources(root: string, exts: string[]): string[] {
  return listFiles(root, (rel) => exts.some((e: string) => rel.endsWith(`.${e}`)));
}

/** root の下の実体のファイル（拡張子を問わない。リポジトリ相対、昇順）。 */
export function listAllSources(root: string): string[] {
  return listFiles(root, () => true);
}

function listFiles(root: string, keep: (rel: string) => boolean): string[] {
  const out = execFileSync(
    "git",
    ["ls-files", "-z", "--cached", "--others", "--exclude-standard"],
    {
      cwd: root,
      encoding: "utf8",
      maxBuffer: 1 << 28,
    },
  );
  const files = out
    .split("\0")
    .filter((rel) => rel && keep(rel))
    .filter((rel) => !rel.startsWith("node_modules/") && !isAgentCopy(root, rel))
    .filter((rel) => {
      const abs = join(root, rel);
      // `--cached` は作業ツリーで消した追跡ファイルも返す。
      return existsSync(abs) && !lstatSync(abs).isSymbolicLink();
    });
  return [...new Set(files)].sort();
}

function parseArgs(argv: string[]): { exts: string[]; command: string[] } {
  const sep = argv.indexOf("--");
  const own = sep >= 0 ? argv.slice(0, sep) : argv;
  const command = sep >= 0 ? argv.slice(sep + 1) : [];
  const i = own.indexOf("--ext");
  const exts = i >= 0 && own[i + 1] ? own[i + 1].split(",").filter(Boolean) : [];
  return { exts, command };
}

export function main(argv: string[], root: string = process.cwd()): number {
  const { exts, command } = parseArgs(argv);
  if (exts.length === 0 || command.length === 0) {
    console.error("run-on-sources: --ext <拡張子[,拡張子]> -- <コマンド> の形で指定する");
    return 2;
  }
  const files = listSources(root, exts);
  if (files.length === 0) {
    console.error(`run-on-sources: 対象（.${exts.join(", .")}）が 0 件。列挙できていない`);
    return 2;
  }
  console.error(`run-on-sources: ${files.length} 件を ${command[0]} に渡す`);
  const r = spawnSync(command[0], [...command.slice(1), ...files], { cwd: root, stdio: "inherit" });
  if (r.error) {
    console.error(`run-on-sources: ${command[0]} を起動できない: ${r.error.message}`);
    return 2;
  }
  return r.status ?? 1;
}

if (isCliEntry(import.meta.url)) process.exit(main(process.argv.slice(2)));
