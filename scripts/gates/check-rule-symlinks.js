#!/usr/bin/env node
// rule を各エージェントに読ませる symlink（3 点）を、決定論的にチェックする（lefthook pre-commit + CI）。
//
// 原本は `.agents/rules/<name>.md`。Claude Code は `.claude/rules/<name>.md`、
// GitHub Copilot は `.github/instructions/<name>.instructions.md` の symlink を通して、同じ実体を読む。
// symlink を作り忘れると、「ドキュメント上は適用されるのに、2 エージェントでは適用されない」状態になる。
// これは成功した作業と見分けが付かない（実例: eval-run-scope.md。レビューで指摘されるまで気付かなかった）。
//
// 期待する集合は、観測ではなく宣言から作る。`.agents/rules/*.md` の実在が原本で、symlink の側はその反映である。
// 逆向き（原本の無い孤児の symlink）も、同じ表から検出する。
// 対象 0 件は成功として扱わず、fail にする（走査できていないことと、違反が無いことを区別する）。
import { existsSync, lstatSync, readdirSync, readlinkSync, realpathSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const CANON_DIR = ".agents/rules";

// symlink を置く先の宣言。`suffix` は原本のベース名（拡張子なし）に付く。
export const WIRINGS = [
  { dir: ".claude/rules", suffix: ".md", agent: "Claude Code" },
  { dir: ".github/instructions", suffix: ".instructions.md", agent: "GitHub Copilot" },
];

const canonBase = (file) => file.replace(/\.md$/, "");

// symlink の名前 → 原本のベース名。対応しない名前は null（孤児判定に使う）。
const baseFromWiring = (name, suffix) =>
  name.endsWith(suffix) ? name.slice(0, -suffix.length) : null;

/**
 * @param {string} root リポジトリルート（テストでは一時ディレクトリ）
 * @returns {{ rules: string[], violations: string[] }} rules は走査した原本の絶対パス
 */
export function checkRuleSymlinks(root) {
  const violations = [];
  const canonDir = join(root, CANON_DIR);

  if (!existsSync(canonDir)) {
    return { rules: [], violations: [`${resolve(canonDir)}: 原本のディレクトリが無い`] };
  }

  const bases = readdirSync(canonDir)
    .filter((f) => f.endsWith(".md"))
    .map(canonBase)
    .sort();
  const rules = bases.map((b) => resolve(join(canonDir, `${b}.md`)));

  for (const { dir, suffix, agent } of WIRINGS) {
    const wiringDir = join(root, dir);
    if (!existsSync(wiringDir)) {
      violations.push(
        `${resolve(wiringDir)}: リンクのディレクトリが無い（${agent} は rule を読めない）`,
      );
      continue;
    }

    // 原本 → symlink（欠落・実ファイル・誤った指し先・リンク先の無い symlink）
    for (const base of bases) {
      const linkPath = join(wiringDir, `${base}${suffix}`);
      const expected = relative(wiringDir, join(canonDir, `${base}.md`));
      if (!lstatSafe(linkPath)) {
        violations.push(
          `${dir}/${base}${suffix}: 欠落（${agent} で自動適用されない）。期待する指し先: ${expected}`,
        );
        continue;
      }
      if (!lstatSync(linkPath).isSymbolicLink()) {
        violations.push(
          `${dir}/${base}${suffix}: symlink ではない（実体のコピーは原本と drift する）`,
        );
        continue;
      }
      const actual = readlinkSync(linkPath);
      if (actual !== expected) {
        violations.push(
          `${dir}/${base}${suffix}: 指し先が違う（実際: ${actual} / 期待: ${expected}）`,
        );
        continue;
      }
      if (!existsSync(linkPath)) {
        violations.push(`${dir}/${base}${suffix}: symlink の指し先が存在しない`);
        continue;
      }
      if (realpathSync(linkPath) !== realpathSync(join(canonDir, `${base}.md`))) {
        violations.push(`${dir}/${base}${suffix}: 解決先が原本と一致しない`);
      }
    }

    // symlink → 原本（孤児）
    for (const name of readdirSync(wiringDir)) {
      const base = baseFromWiring(name, suffix);
      if (base === null) {
        violations.push(`${dir}/${name}: 命名規則（<name>${suffix}）に合わない`);
        continue;
      }
      if (!bases.includes(base)) {
        violations.push(`${dir}/${name}: 対応する原本 ${CANON_DIR}/${base}.md が無い（孤児）`);
      }
    }
  }

  return { rules, violations };
}

function lstatSafe(p) {
  try {
    return lstatSync(p);
  } catch {
    return null;
  }
}

// CLI エントリ判定は、両辺を実パスに揃える（片側だけを解決すると、symlink を通した起動で何もせずに終わる）。
// 正規化に失敗したら「起動されていない」として扱わず、理由を出して非 0 で落とす。
function isCliEntry() {
  if (!process.argv[1]) return false;
  try {
    return realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url));
  } catch (error) {
    console.error(`rule-symlinks: 起動パスを正規化できない: ${error.message}`);
    process.exit(1);
  }
}

if (isCliEntry()) {
  const root = process.argv[2] ?? process.cwd();
  const { rules, violations } = checkRuleSymlinks(root);

  if (rules.length === 0) {
    console.error(`rule-symlinks: 走査した rule が 0 件（${resolve(join(root, CANON_DIR))}）。`);
    console.error("Fix: 対象を取り違えていないか確認する。0 件は「違反なし」ではない。");
    process.exit(1);
  }

  if (violations.length) {
    console.error(
      `rule-symlinks: ${rules.length} 件の rule を走査し、${violations.length} 件のリンクの不備:`,
    );
    for (const v of violations) console.error(`  - ${v}`);
    console.error(
      `Fix: 各 rule について ln -s ../../${CANON_DIR}/<name>.md .claude/rules/<name>.md と` +
        ` ln -s ../../${CANON_DIR}/<name>.md .github/instructions/<name>.instructions.md を作る。`,
    );
    process.exit(1);
  }

  console.log(`rule-symlinks: OK（${rules.length} 件）`);
  for (const r of rules) console.log(`  ${r}`);
}
