#!/usr/bin/env node
// 文書の参照をチェックする（lefthook pre-commit + CI）。
//
// 走査対象と階層は scripts/lib/doc-scan.js で決める（Tier 4 と eval の入力は読まない）。
// 規則:
// - link: Markdown のリンク `[...](相対パス)` の先が在る。コードフェンスとインラインコードの中は読まない。
// - section: バッククォートかリンクで書いたパス（.md）の直後の「節名」と、「`<スキル>` の」を前に付けた形の節名が、参照先の
//   見出し・太字の項目・表のセルのどれかと一致する。比べる前に両辺からバッククォートを除き、空白を 1 つにまとめる。
//   参照先は、リンクなら書いたファイルからの相対パス、バッククォートなら書いたファイルのディレクトリ・ルート・
//   スキルのディレクトリ・スキルの references/ の順に探す。見つからないときは、導入先で生成するファイルとして
//   scripts/gates/doc-refs.json の generated に宣言したテンプレートで確かめる。宣言も無ければ違反にする。
// - tier-down: Tier 1・2 の文書（配布スキルを除く）が、Tier 4（学び・eval の結果・このリポジトリの Issue と PR）を参照しない。
// - dist-kaizen・dist-issue・dist-repo-path: 配布スキル（skills/）は導入先で単独で動くので、このリポジトリの
//   学び・Issue と PR・スキルの外のファイル（docs/、.agents/rules/、scripts/ など）を参照しない。
//   Markdown のリンクは、スキルのディレクトリの外（他のスキルを含む）を指したら dist-repo-path にする。
//   Tier 3（コメント）にも当てる。
// Issue と PR の番号は、例の行（scripts/lib/doc-scan.js の EXAMPLE_LINE_RE）では読まない。
//
// 今ある違反は scripts/gates/doc-pending.json に保留として持ち、直したら消す（古い保留は失敗にする）。
// 対象ファイル 0 件・設定の形の誤りは exit 2。違反・古い保留は exit 1。
import { existsSync, readFileSync, realpathSync } from "node:fs";
import { dirname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";
import {
  applyPending,
  blankInlineCode,
  distributedSkillDir,
  EXAMPLE_LINE_RE,
  fencedLines,
  loadPending,
  prunePending,
  scannedFiles,
} from "../lib/doc-scan.js";

export const CONFIG_PATH = "scripts/gates/doc-refs.json";
export const RULES = [
  "link",
  "section",
  "tier-down",
  "dist-kaizen",
  "dist-issue",
  "dist-repo-path",
];
// このチェック自身のテストとミューテーションテストの定義は、違反の fixture を本文に持つので読まない。
export const SELF_FIXTURES = [
  "scripts/gates/check-doc-refs.test.js",
  "scripts/gates/check-doc-refs.mutations.json",
  CONFIG_PATH,
];

/** doc-refs.json を読む。形の誤りは例外にする。 */
export function loadConfig(root) {
  const path = join(root, CONFIG_PATH);
  if (!existsSync(path)) throw new Error(`${CONFIG_PATH} が無い`);
  const data = JSON.parse(readFileSync(path, "utf8"));
  if (typeof data?.repo !== "string" || !/^[\w.-]+\/[\w.-]+$/.test(data.repo))
    throw new Error(`${CONFIG_PATH}: repo は "<owner>/<name>" の形にする`);
  const ok = (e) =>
    typeof e?.ref === "string" &&
    typeof e?.template === "string" &&
    (e.skills === undefined ||
      (Array.isArray(e.skills) && e.skills.every((s) => typeof s === "string")));
  if (!Array.isArray(data.generated) || !data.generated.every(ok))
    throw new Error(`${CONFIG_PATH}: generated は { ref, template, skills? } の配列にする`);
  for (const g of data.generated) {
    if (!existsSync(join(root, g.template)))
      throw new Error(`${CONFIG_PATH}: ${g.ref} のテンプレート ${g.template} が無い`);
  }
  return data;
}

// ---- 参照先の節名 ----

// 比べる前に、バッククォートを除き、『』を「」に揃え、空白を 1 つにまとめ、末尾の句点を除く。
const norm = (s) =>
  s
    .replace(/`/g, "")
    .replace(/『/g, "「")
    .replace(/』/g, "」")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/。$/, "");

/** Markdown の本文から、節名として参照できる文字列（見出し・太字の項目・表のセル）を集める。 */
export function anchorsOf(text) {
  const names = new Set();
  const lines = text.split(/\r?\n/);
  const fenced = fencedLines(lines);
  lines.forEach((line, i) => {
    if (fenced[i]) return;
    const h = /^#{1,6}\s+(.*?)\s*#*\s*$/.exec(line);
    if (h) {
      names.add(norm(h[1]));
      // 番号付きの見出し（「7. 定期実行」）は、番号を除いた名前でも参照できる。
      names.add(norm(h[1].replace(/^\d+(?:\.\d+)*\.?\s+/, "")));
    }
    for (const m of line.matchAll(/\*\*(.+?)\*\*/g)) names.add(norm(m[1]));
    if (/^\s*\|/.test(line)) {
      for (const cell of line.split("|").slice(1, -1)) names.add(norm(cell.replace(/\*\*/g, "")));
    }
  });
  names.delete("");
  return names;
}

/**
 * 節名 name が参照先にあるか。見出しの末尾の括弧書き（「名前（補足）」）は省いて参照してよい。
 */
export function hasAnchor(names, name) {
  const n = norm(name);
  if (names.has(n)) return true;
  for (const a of names)
    if (a.startsWith(`${n}（`) || a.startsWith(`${n}(`) || a.startsWith(`${n} (`)) return true;
  return false;
}

// 節名。中に「」を 1 段だけ含んでよい（「機能の在否は「器と文言がある」…」）。
const NAME = "「((?:[^「」]|「[^「」]*」)+)」";

const SECTION_PATTERNS = [
  // スキル名を前に付けた形（バッククォートのスキル名・「の」・バッククォートのパス・節名）
  { re: new RegExp(`\`([a-z0-9-]+)\` の \`([^\`\\s]+\\.md)\`${NAME}`, "g"), kind: "skill" },
  // リンクの直後の節名
  { re: new RegExp(`\\]\\(([^)\\s#]+\\.md)(?:#[^)\\s]*)?\\)${NAME}`, "g"), kind: "link" },
  // バッククォートのパスの直後の節名
  { re: new RegExp(`(?<!\` の )\`([^\`\\s]+\\.md)\`${NAME}`, "g"), kind: "code" },
];

/** スキルのディレクトリ（配布スキル・private skill・eval の対象スキル）。 */
function skillDirOf(root, file) {
  const d = distributedSkillDir(file);
  if (d) return d;
  const p = /^\.agents\/skills\/[^/]+(?=\/)/.exec(file)?.[0];
  if (p) return p;
  const e = /^evals\/([^/]+)\//.exec(file);
  return e && existsSync(join(root, "skills", e[1])) ? `skills/${e[1]}` : null;
}

/** 参照先のファイル（リポジトリ相対）。見つからなければ null。 */
export function resolveSectionTarget(root, file, kind, path, skill) {
  if (kind === "skill") {
    for (const base of [`skills/${skill}`, `.agents/skills/${skill}`]) {
      if (existsSync(join(root, base, path))) return normalize(join(base, path));
    }
    return null;
  }
  if (kind === "link") {
    const p = normalize(join(dirname(file), path));
    return existsSync(join(root, p)) ? p : null;
  }
  const sk = skillDirOf(root, file);
  const cands = [join(dirname(file), path), path];
  if (sk) cands.push(join(sk, path), join(sk, "references", path));
  const hit = cands.map((c) => normalize(c)).find((c) => existsSync(join(root, c)));
  return hit ?? null;
}

function generatedTemplate(config, root, file, path, skill) {
  const sk = skill ?? skillDirOf(root, file)?.split("/").pop();
  const hit = config.generated.find(
    (g) => g.ref === path && (g.skills === undefined || (sk && g.skills.includes(sk))),
  );
  return hit?.template ?? null;
}

// ---- Tier 4 と配布スキルの外への参照 ----

// 学び（日付で始まる名前）。`.kaizen/archive/INDEX.md` は学びではなく kaizen スキルが作る索引なので当てない。
const KAIZEN_RE =
  /(?<![\w./-])\.kaizen\/(?:archive\/(?!INDEX\.md)[A-Za-z0-9_-]+\.md|\d{4}-\d{2}-\d{2}-[A-Za-z0-9_-]+\.md)/g;
const TESTS_RE = /(?<![\w./-])tests\/[\w-]+\/iteration-\d+/g;
const issueRes = (repo) => [
  // 「#123」。前が単語・`/`・`.`・`-`・`&`・`{` のもの（owner/repo#123、文字参照の &#123;、シェルの ${#1}）は
  // 他のリポジトリか番号ではない。
  /(?<![\w/.&{-])#\d+\b/g,
  new RegExp(`github\\.com/${repo.replace(/[.]/g, "\\.")}/(?:issues|pull)/\\d+`, "g"),
];
const REPO_PATH_RE = /(?<![\w./-])((?:docs|\.agents\/rules|scripts|evals|tests)\/[\w./-]*[\w])/g;

/**
 * 1 ファイルの違反を列挙する。
 * @returns {{ line: number, rule: string, text: string, message?: string }[]}
 */
export function findInFile(root, config, { file, tier, markdown }, text, anchorCache = new Map()) {
  const out = [];
  const lines = text.split(/\r?\n/);
  const fenced = markdown ? fencedLines(lines) : lines.map(() => false);
  const dist = distributedSkillDir(file);
  const anchors = (target) => {
    if (!anchorCache.has(target))
      anchorCache.set(target, anchorsOf(readFileSync(join(root, target), "utf8")));
    return anchorCache.get(target);
  };

  lines.forEach((line, i) => {
    const at = (rule, t, message) => out.push({ line: i + 1, rule, text: t, message });
    const isExample = EXAMPLE_LINE_RE.test(line);

    if (markdown && !fenced[i]) {
      for (const m of blankInlineCode(line).matchAll(/\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g)) {
        const target = m[1];
        if (/^[a-z][a-z0-9+.-]*:/i.test(target) || target.startsWith("#") || target.startsWith("<"))
          continue;
        const raw = target.replace(/[#?].*$/, "");
        let path = raw;
        try {
          path = decodeURIComponent(raw);
        } catch {
          // 符号化として読めない `%`（`100%.md`）は、書いた文字のままのパスとして確かめる。
        }
        const rel = normalize(path.startsWith("/") ? path.slice(1) : join(dirname(file), path));
        if (!existsSync(join(root, rel))) at("link", target, `リンク先 ${target} が無い`);
        // 配布スキルのリンクは、スキルのディレクトリの中だけを指す（他のスキルも導入先に在るとは限らない）。
        else if (dist && !rel.startsWith(`${dist}/`))
          at("dist-repo-path", target, `スキルの外 ${rel} へのリンク`);
      }
    }

    if (!fenced[i]) {
      for (const { re, kind } of SECTION_PATTERNS) {
        for (const m of line.matchAll(re)) {
          const [skill, path, name] = kind === "skill" ? [m[1], m[2], m[3]] : [null, m[1], m[2]];
          const shown = `${skill ? `${skill}/` : ""}${path}「${name}」`;
          let target = resolveSectionTarget(root, file, kind, path, skill);
          if (target === null && kind === "link") continue; // リンク切れは link で報告する
          target ??= generatedTemplate(config, root, file, path, skill);
          if (target === null) {
            at(
              "section",
              shown,
              `${shown} の参照先が見つからない（導入先で生成するなら ${CONFIG_PATH} の generated に宣言する）`,
            );
          } else if (!hasAnchor(anchors(target), name)) {
            at("section", shown, `${shown} の節名が ${target} に無い`);
          }
        }
      }
    }

    const toTier4 = tier <= 2 && !dist;
    if (!toTier4 && !dist) return;
    for (const m of line.matchAll(KAIZEN_RE))
      at(dist ? "dist-kaizen" : "tier-down", m[0], `学び ${m[0]} を参照している`);
    if (!dist)
      for (const m of line.matchAll(TESTS_RE))
        at("tier-down", m[0], `eval の結果 ${m[0]} を参照している`);
    if (!isExample) {
      for (const re of issueRes(config.repo)) {
        // インラインコードの中は例として読まない（「`#1` のように書かない」）。
        for (const m of blankInlineCode(line).matchAll(re))
          at(dist ? "dist-issue" : "tier-down", m[0], `Issue・PR ${m[0]} を参照している`);
      }
    }
    if (dist) {
      for (const m of line.matchAll(REPO_PATH_RE)) {
        const p = m[1];
        if (existsSync(join(root, p)) && !existsSync(join(root, dist, p)))
          at("dist-repo-path", p, `スキルの外のファイル ${p} を参照している`);
      }
    }
  });
  return out;
}

/**
 * @param {string} root
 * @returns {{ files: number, found: object[], failures: string[], pendingCount: number, stale: object[] }}
 */
export function checkDocRefs(root) {
  const config = loadConfig(root);
  const list = loadPending(root);
  const files = scannedFiles(root, { exclude: SELF_FIXTURES });
  const cache = new Map();
  const found = [];
  for (const f of files) {
    const text = readFileSync(join(root, f.file), "utf8");
    for (const v of findInFile(root, config, f, text, cache)) found.push({ file: f.file, ...v });
  }
  return { files: files.length, found, ...applyPending(found, list, RULES) };
}

export function main(argv) {
  const args = argv.filter((a) => a !== "--");
  const prune = args.includes("--prune");
  const root = args.find((a) => !a.startsWith("--")) ?? process.cwd();
  let result;
  try {
    result = checkDocRefs(root);
  } catch (error) {
    console.error(`doc-refs: チェックできない: ${error.message}`);
    return 2;
  }
  const { files, failures, pendingCount, stale } = result;
  if (files === 0) {
    console.error("doc-refs: 対象ファイルが 0 件。列挙できていない");
    return 2;
  }
  if (prune && stale.length) {
    // 古い保留の失敗は、消したので数えない。
    const n = prunePending(root, stale);
    console.log(`doc-refs: 古い保留を ${n} 件消した`);
    const rest = failures.filter((f) => !f.startsWith("古い保留: "));
    failures.length = 0;
    failures.push(...rest);
  }
  if (failures.length) {
    console.error(`doc-refs: ${files} 件を走査し、${failures.length} 件の不備:`);
    for (const f of failures) console.error(`  - ${f}`);
    console.error(
      "Fix: 参照先を直す。後の段階で直すものだけを scripts/gates/doc-pending.json の pending に、" +
        "正しい記述は allowed に理由付きで書く。",
    );
    return 1;
  }
  console.log(`doc-refs: OK（${files} 件。保留 ${pendingCount} 件）`);
  return 0;
}

// CLI エントリ判定は両辺を実パスへ揃える（片側だけの解決は symlink 経由の起動で何もせずに終わる）。
function isCliEntry() {
  if (!process.argv[1]) return false;
  try {
    return realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url));
  } catch (error) {
    console.error(`doc-refs: 起動パスを正規化できない: ${error.message}`);
    process.exit(1);
  }
}

if (isCliEntry()) process.exit(main(process.argv.slice(2)));
