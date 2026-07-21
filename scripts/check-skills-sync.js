#!/usr/bin/env node
// Guard against drift between the distributed source `skills/<name>/` and the
// in-repo installed copy `.agents/skills/<name>/` (which Codex/Copilot read and
// `.claude/skills/<name>` symlinks to). Editing a skill without re-running
// `scripts/reinstall-skill.sh <name>` leaves the installed copy stale; this check
// (lefthook pre-commit + CI) fails loudly when that happens. The source of truth
// is `skills/`; extra entries under `.agents/skills/` must be explicitly marked
// with `.private-skill` so removed/renamed distributed skills do not linger.
//
// `gh skill install` normalizes SKILL.md frontmatter (reorders keys, drops the
// blank line after the closing `---`, and may inject `metadata.local-path`), so
// SKILL.md is compared by parsed-frontmatter (order-independent, local-path
// ignored) + trimmed body. Every other file must be byte-identical.
import { readFileSync, readdirSync, existsSync, lstatSync, readlinkSync } from "node:fs";
import { join, relative } from "node:path";
import yaml from "js-yaml";
import { splitFrontmatter } from "./lib/frontmatter.js";

const SRC_ROOT = "skills";
const INSTALLED_ROOT = ".agents/skills";
const CLAUDE_ROOT = ".claude/skills";
const PRIVATE_SKILL_MARKER = ".private-skill";

function listFiles(dir) {
  const out = [];
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) out.push(...listFiles(p));
    else out.push(p);
  }
  return out;
}

function sortKeys(value) {
  if (Array.isArray(value)) return value.map(sortKeys);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((k) => [k, sortKeys(value[k])]),
    );
  }
  return value;
}

// frontmatter を切り出す。共通ヘルパー（BOM/CRLF 対応）に委譲し、frontmatter が
// 無い場合は従来どおり { fm: "", body: text } を返して比較ロジックの挙動を保つ。
function frontmatterOf(text) {
  return splitFrontmatter(text) ?? { fm: "", body: text };
}

function normFrontmatter(fmText, source) {
  let obj;
  try {
    obj = yaml.load(fmText) || {};
  } catch (err) {
    console.error(`skills-sync: invalid YAML frontmatter in ${source}: ${err.message}`);
    process.exit(2);
  }
  if (obj.metadata && typeof obj.metadata === "object") {
    delete obj.metadata["local-path"];
    if (Object.keys(obj.metadata).length === 0) delete obj.metadata;
  }
  return JSON.stringify(sortKeys(obj));
}

function checkClaudeSymlink(name, drifts) {
  const claudeLink = join(CLAUDE_ROOT, name);
  try {
    const stat = lstatSync(claudeLink);
    if (!stat.isSymbolicLink()) {
      drifts.push(`${name}: ${claudeLink} is not a symlink`);
      return;
    }

    const target = readlinkSync(claudeLink);
    const expected = `../../${INSTALLED_ROOT}/${name}`;
    if (target !== expected) {
      drifts.push(`${name}: ${claudeLink} points to ${target}, expected ${expected}`);
    }
  } catch (err) {
    if (err.code === "ENOENT") {
      drifts.push(`${name}: missing Claude symlink under ${CLAUDE_ROOT}/`);
    } else {
      drifts.push(`${name}: cannot inspect ${claudeLink}: ${err.message}`);
    }
  }
}

const drifts = [];
for (const e of readdirSync(SRC_ROOT, { withFileTypes: true })) {
  if (!e.isDirectory()) continue;
  const name = e.name;
  const srcDir = join(SRC_ROOT, name);
  const instDir = join(INSTALLED_ROOT, name);
  if (!existsSync(instDir)) {
    drifts.push(`${name}: missing installed copy under ${INSTALLED_ROOT}/`);
    continue;
  }

  checkClaudeSymlink(name, drifts);

  const instLeft = new Set(listFiles(instDir).map((f) => relative(instDir, f)));
  for (const abs of listFiles(srcDir)) {
    const rel = relative(srcDir, abs);
    if (!instLeft.delete(rel)) {
      drifts.push(`${name}: ${rel} missing in installed copy`);
      continue;
    }
    const a = readFileSync(abs);
    const b = readFileSync(join(instDir, rel));
    if (rel === "SKILL.md") {
      const A = frontmatterOf(a.toString("utf8"));
      const B = frontmatterOf(b.toString("utf8"));
      const fmA = normFrontmatter(A.fm, join(srcDir, "SKILL.md"));
      const fmB = normFrontmatter(B.fm, join(instDir, "SKILL.md"));
      if (fmA !== fmB || A.body.trim() !== B.body.trim()) {
        drifts.push(`${name}: SKILL.md content differs`);
      }
    } else if (!a.equals(b)) {
      drifts.push(`${name}: ${rel} differs`);
    }
  }
  for (const extra of instLeft)
    drifts.push(`${name}: ${extra} exists only in installed copy (stale)`);
}

const srcNames = new Set(
  readdirSync(SRC_ROOT, { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((e) => e.name),
);
if (existsSync(INSTALLED_ROOT)) {
  for (const e of readdirSync(INSTALLED_ROOT, { withFileTypes: true })) {
    if (!e.isDirectory() || srcNames.has(e.name)) continue;
    const marker = join(INSTALLED_ROOT, e.name, PRIVATE_SKILL_MARKER);
    if (!existsSync(marker)) {
      drifts.push(
        `${e.name}: exists under ${INSTALLED_ROOT}/ but not ${SRC_ROOT}/; add ${PRIVATE_SKILL_MARKER} if this is a private skill`,
      );
    } else {
      checkClaudeSymlink(e.name, drifts);
    }
  }
}

if (drifts.length) {
  console.error("skills-sync: DRIFT between skills/ and .agents/skills/:");
  for (const d of drifts) console.error(`  - ${d}`);
  console.error(
    "Fix: run `scripts/reinstall-skill.sh <name>` (or --all), then commit the .agents/.claude changes.",
  );
  process.exit(1);
}
console.log("skills-sync: OK");
