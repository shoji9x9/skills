#!/usr/bin/env node
// 次のリリースの version を、semantic-release の dry-run の結果（nextRelease.version）から取り、stdout に 1 行で出す。
// release.yml が `gh skill publish --tag v<version>` に渡す。手で実行すると、次の version を確かめられる（main 以外の branch では何も出さない）。
//
// semantic-release のログには、commit-analyzer が各 commit の message をそのまま書く（`Analyzing commit: <message>`）。
// ログから `next release version is X.Y.Z` を grep で探すと、その文言を書いた commit の message が version を決められる。
// そのため、ログは stderr に流して読むだけにし、version は API の戻り値から取る。
//
// 終了コード: 0 は判定できた（version を 1 行出すか、リリースする変更が無ければ何も出さない）、2 は判定できない（semantic-release の失敗・不正な version）。
// リリースが無いことを 0 以外の終了コードで表さない。Node は import の失敗などの捕まえていない例外で 1 を返すので、
// 1 をリリースが無いことに使うと、起動の失敗がリリースしない成功として扱われる。
import semanticRelease from "semantic-release";
import { errorMessage } from "../lib/errors.ts";
import { isCliEntry } from "../lib/cli/entry.ts";

const SEMVER = /^\d+\.\d+\.\d+$/u;

/**
 * semantic-release の戻り値から version を取る。リリースが無ければ null を返す。
 * プレリリースやビルドの付いた version はこのリポジトリのブランチの設定では出ないので、判定できないとして例外にする。
 */
export function versionOf(result: unknown): string | null {
  if (result === false) return null;
  const next =
    typeof result === "object" && result !== null ? Reflect.get(result, "nextRelease") : undefined;
  const version =
    typeof next === "object" && next !== null ? Reflect.get(next, "version") : undefined;
  if (typeof version !== "string" || !SEMVER.test(version))
    throw new Error(`nextRelease.version が X.Y.Z の形でない: ${String(version)}`);
  return version;
}

/** semantic-release のうち、ここで使う呼び出しの形。テストは偽物を渡す。 */
export type Release = (
  options: { dryRun: boolean },
  context: { stdout: NodeJS.WriteStream; stderr: NodeJS.WriteStream },
) => Promise<unknown>;

export async function main(run: Release = semanticRelease): Promise<number> {
  let version: string | null;
  try {
    // ログは人が読むために stderr へ流す。stdout には version だけを出す。
    const result = await run({ dryRun: true }, { stdout: process.stderr, stderr: process.stderr });
    version = versionOf(result);
  } catch (error) {
    console.error(`next-release-version: 判定できない: ${errorMessage(error)}`);
    return 2;
  }
  if (version !== null) process.stdout.write(`${version}\n`);
  return 0;
}

if (isCliEntry(import.meta.url)) process.exit(await main());
