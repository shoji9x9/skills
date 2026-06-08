#!/usr/bin/env node
// Guard against drift between the distributed source `skills/<name>/` and the
// in-repo installed copy `.agents/skills/<name>/` (which Codex/Copilot read and
// `.claude/skills/<name>` symlinks to). Editing a skill without re-running
// `scripts/reinstall-skill.sh <name>` leaves the installed copy stale; this check
// (lefthook pre-commit + CI) fails loudly when that happens.
//
// `gh skill install` normalizes SKILL.md frontmatter (reorders keys, drops the
// blank line after the closing `---`, and may inject `metadata.local-path`), so
// SKILL.md is compared by parsed-frontmatter (order-independent, local-path
// ignored) + trimmed body. Every other file must be byte-identical.
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join, relative } from "node:path";
import yaml from "js-yaml";

const SRC_ROOT = "skills";
const INSTALLED_ROOT = ".agents/skills";

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

function splitFrontmatter(text) {
  if (!text.startsWith("---")) return { fm: "", body: text };
  const close = text.indexOf("\n---", 3);
  if (close === -1) return { fm: "", body: text };
  return { fm: text.slice(text.indexOf("\n") + 1, close), body: text.slice(close + 4) };
}

function normFrontmatter(fmText) {
  const obj = yaml.load(fmText) || {};
  if (obj.metadata && typeof obj.metadata === "object") {
    delete obj.metadata["local-path"];
    if (Object.keys(obj.metadata).length === 0) delete obj.metadata;
  }
  return JSON.stringify(sortKeys(obj));
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
      const A = splitFrontmatter(a.toString("utf8"));
      const B = splitFrontmatter(b.toString("utf8"));
      if (normFrontmatter(A.fm) !== normFrontmatter(B.fm) || A.body.trim() !== B.body.trim()) {
        drifts.push(`${name}: SKILL.md content differs`);
      }
    } else if (!a.equals(b)) {
      drifts.push(`${name}: ${rel} differs`);
    }
  }
  for (const extra of instLeft) drifts.push(`${name}: ${extra} exists only in installed copy (stale)`);
}

// Reverse direction: an installed copy with no source (e.g. a skill removed or
// renamed under skills/ while .agents/skills/ kept the old dir) is also drift.
if (existsSync(INSTALLED_ROOT)) {
  const srcNames = new Set(
    readdirSync(SRC_ROOT, { withFileTypes: true })
      .filter((e) => e.isDirectory())
      .map((e) => e.name),
  );
  for (const e of readdirSync(INSTALLED_ROOT, { withFileTypes: true })) {
    if (e.isDirectory() && !srcNames.has(e.name)) {
      drifts.push(`${e.name}: exists under ${INSTALLED_ROOT}/ but not ${SRC_ROOT}/ (orphaned installed copy)`);
    }
  }
}

if (drifts.length) {
  console.error("skills-sync: DRIFT between skills/ and .agents/skills/:");
  for (const d of drifts) console.error(`  - ${d}`);
  console.error("Fix: run `scripts/reinstall-skill.sh <name>` (or --all), then commit the .agents/.claude changes.");
  process.exit(1);
}
console.log("skills-sync: OK");
