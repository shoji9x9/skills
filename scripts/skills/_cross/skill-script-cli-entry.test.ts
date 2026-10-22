// 配布スキル同梱スクリプトが「シンボリックリンク経由の起動」でも CLI として動くことの回帰テスト。
//
// multiagent-setup はスキル実体を .agents/skills/<name>/ に置き .claude/skills/<name> を
// そこへのシンボリックリンクにするため、SKILL.md が案内する実行パスは常にリンク経由になる。
// CLI エントリ判定を `import.meta.url === pathToFileURL(process.argv[1]).href` で書くと、
// 左辺だけがリンク解決済みのため条件が偽になり、main() が呼ばれず無出力・exit 0 で終わる
// （サイレント no-op）。両辺を実パスに揃えていればここで検出できる。
// リンクは実際の配置と同じく、スキルのディレクトリに張る。スクリプトのファイルだけを指すリンクは実際には作られず、
// それを --preserve-symlinks-main で起動すると、隣のファイル（scripts/lib/ など）の静的な import をリンク側で探して失敗する。

import { test, expect } from "vitest";
import { spawnSync } from "node:child_process";
import { readFileSync, readdirSync, symlinkSync } from "node:fs";
import { dirname, join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { makeTempDir } from "../../lib/testing/test-tmpdir.ts";
import { CHILD_TIMEOUT_MS } from "../../lib/testing/child-timeout.ts";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const skillsDir = join(repoRoot, "skills");

/**
 * skills/ 配下（scripts/ に限らず assets/ 等も含む）の *.mjs のうち、
 * `import.meta.url` による CLI エントリ判定を持つものを列挙する。
 * 判定は、ファイルの中に持つ形（`import.meta.url` と `process.argv[1]` を比べる）と、
 * スキルの `scripts/lib/cli.mjs` の `isCliEntry(import.meta.url)` を呼ぶ形の 2 通りがある。
 * `lib/cli.mjs` 自身は呼び出し元の URL を引数で受けるので `import.meta.url` を含まず、対象にならない。
 * 判定を持たない素の CLI スクリプトはシンボリックリンクの影響を受けないので対象外にする。
 */
function findCliScripts(dir: string = skillsDir, found: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      findCliScripts(path, found);
      continue;
    }
    if (!entry.isFile() || !entry.name.endsWith(".mjs")) continue;
    const src = readFileSync(path, "utf8");
    const inline = src.includes("import.meta.url") && src.includes("process.argv[1]");
    if (inline || src.includes("isCliEntry(import.meta.url)")) found.push(path);
  }
  return found;
}

const allCliScripts = findCliScripts();

/**
 * 引数を取らず、起動すると stdout に結果を出して exit 0 で終わる CLI（repo からの相対パス）。
 * 引数不足の usage が無いので、stdout が空でないことと、起動のしかたで出力が変わらないことで確かめる。
 */
const NO_ARG_CLIS = new Set([
  "skills/replace-strategy/scripts/asset-probe.mjs",
  "skills/replace-strategy/scripts/role-probe.mjs",
]);

const relPath = (p: string): string => relative(repoRoot, p).split(sep).join("/");
const cliScripts = allCliScripts.filter((p) => !NO_ARG_CLIS.has(relPath(p)));
const noArgScripts = allCliScripts.filter((p) => NO_ARG_CLIS.has(relPath(p)));

/**
 * スクリプトを、実パス・スキルのディレクトリへのリンク・リンクと --preserve-symlinks-main の 3 通りで起動する。
 * @param scriptPath 起動するスクリプトの実パス
 */
function launchThreeWays(scriptPath: string) {
  const skillName = relative(skillsDir, scriptPath).split(sep)[0];
  const linkDir = makeTempDir("cli-entry-");
  symlinkSync(join(skillsDir, skillName), join(linkDir, skillName));
  const link = join(linkDir, skillName, relative(join(skillsDir, skillName), scriptPath));
  const run = (args: string[]) =>
    spawnSync(process.execPath, args, { timeout: CHILD_TIMEOUT_MS, encoding: "utf8" });
  return {
    viaLink: run([link]),
    viaReal: run([scriptPath]),
    // --preserve-symlinks-main（NODE_OPTIONS 経由でも付く）では import.meta.url も未解決になる。
    // 片側だけ実パスに解決していると、この起動でサイレント no-op に戻る。
    viaLinkPreserve: run(["--preserve-symlinks-main", link]),
  };
}

test("CLI エントリを持つ同梱スクリプトを検出できている", () => {
  // 探索条件の変化でテスト対象が空になり、素通りするのを防ぐ。
  expect(cliScripts.length).toBeGreaterThanOrEqual(4);
  // 許可リストの名前が実在のスクリプトを指していること（改名で対象から外れるのを防ぐ）。
  expect(noArgScripts.map(relPath).sort()).toEqual([...NO_ARG_CLIS].sort());
});

test.each(cliScripts.map((p) => [relPath(p), p]))(
  "%s: シンボリックリンク経由でも引数不足を usage と exit 2 で知らせる",
  (_label, scriptPath) => {
    const { viaLink, viaReal, viaLinkPreserve } = launchThreeWays(scriptPath);

    // サイレント no-op（無出力・exit 0）になっていないこと。
    expect(viaLink.status).toBe(2);
    expect(viaLink.stderr).toMatch(/^usage: /m);
    // 実パス起動と挙動が一致すること。
    expect(viaLink.status).toBe(viaReal.status);
    expect(viaLink.stderr).toBe(viaReal.stderr);
    expect(viaLinkPreserve.status).toBe(viaReal.status);
    expect(viaLinkPreserve.stderr).toBe(viaReal.stderr);
  },
);

test.each(noArgScripts.map((p) => [relPath(p), p]))(
  "%s: シンボリックリンク経由でも引数なしの起動で結果を出す",
  (_label, scriptPath) => {
    const { viaLink, viaReal, viaLinkPreserve } = launchThreeWays(scriptPath);

    // サイレント no-op（無出力・exit 0）になっていないこと。
    expect(viaLink.status).toBe(0);
    expect(viaLink.stdout.trim()).not.toBe("");
    // 実パス起動と出力が一致すること。
    expect(viaLink.stdout).toBe(viaReal.stdout);
    expect(viaLinkPreserve.status).toBe(0);
    expect(viaLinkPreserve.stdout).toBe(viaReal.stdout);
  },
);
