// 配布スキル同梱スクリプトが「シンボリックリンク経由の起動」でも CLI として動くことの回帰テスト。
//
// multiagent-setup はスキル実体を .agents/skills/<name>/ に置き .claude/skills/<name> を
// そこへのシンボリックリンクにするため、SKILL.md が案内する実行パスは常にリンク経由になる。
// CLI エントリ判定を `import.meta.url === pathToFileURL(process.argv[1]).href` で書くと、
// 左辺だけがリンク解決済みのため条件が偽になり、main() が呼ばれず無出力・exit 0 で終わる
// （サイレント no-op）。両辺を実パスに揃えていればここで検出できる。

import { test, expect } from "vitest";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, readdirSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const skillsDir = join(repoRoot, "skills");

/**
 * skills/ 配下（scripts/ に限らず assets/ 等も含む）の *.mjs のうち、
 * `import.meta.url` による CLI エントリ判定を持つものを列挙する。
 * 判定を持たない素の CLI スクリプトはシンボリックリンクの影響を受けないので対象外にする。
 */
function findCliScripts(dir = skillsDir, found = []) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      findCliScripts(path, found);
      continue;
    }
    if (!entry.isFile() || !entry.name.endsWith(".mjs")) continue;
    const src = readFileSync(path, "utf8");
    if (src.includes("import.meta.url") && src.includes("process.argv[1]")) found.push(path);
  }
  return found;
}

const cliScripts = findCliScripts();

test("CLI エントリを持つ同梱スクリプトを検出できている", () => {
  // 探索条件の変化でテスト対象が空になり、素通りするのを防ぐ。
  expect(cliScripts.length).toBeGreaterThanOrEqual(4);
});

test.each(cliScripts.map((p) => [p.slice(repoRoot.length + 1), p]))(
  "%s: シンボリックリンク経由でも引数不足を usage と exit 2 で知らせる",
  (_label, scriptPath) => {
    const linkDir = mkdtempSync(join(tmpdir(), "cli-entry-"));
    const link = join(linkDir, basename(scriptPath));
    symlinkSync(scriptPath, link);

    const viaLink = spawnSync(process.execPath, [link], { encoding: "utf8" });
    const viaReal = spawnSync(process.execPath, [scriptPath], { encoding: "utf8" });
    // --preserve-symlinks-main（NODE_OPTIONS 経由でも付く）では import.meta.url も未解決になる。
    // 片側だけ実パスに解決していると、この起動でサイレント no-op に戻る。
    const viaLinkPreserve = spawnSync(process.execPath, ["--preserve-symlinks-main", link], {
      encoding: "utf8",
    });

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
