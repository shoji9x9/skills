#!/usr/bin/env node
// 文書の参照をチェックする（lefthook pre-commit + CI）。
//
// 走査対象と階層は scripts/gates/docs/doc-scan-files.ts で決める（Tier 4 と eval の入力は読まない）。
// 規則:
// - link: Markdown のリンク `[...](相対パス)` の先が在る。コードフェンスとインラインコードの中は読まない。
// - section: バッククォートかリンクで書いたパス（.md）の直後の「節名」と、「`<スキル>` の」を前に付けた形の節名が、参照先の
//   見出し・太字の項目・表のセルのどれかと一致する。比べる前に両辺からバッククォートを除き、空白を 1 つにまとめる。
//   参照先は、リンクなら書いたファイルからの相対パス、バッククォートなら書いたファイルのディレクトリ・ルート・
//   スキルのディレクトリ・スキルの references/ の順に探す。見つからないときは、導入先で生成するファイルとして
//   scripts/gates/docs/doc-refs.json の generated に宣言したテンプレートで確かめる。宣言も無ければ違反にする。
// - tier-down: Tier 1・2 の文書（配布スキルを除く）が、Tier 4（学び・eval の結果・このリポジトリの Issue と PR）を参照しない。
// - dist-kaizen・dist-issue・dist-repo-path: 配布スキル（skills/）は導入先で単独で動くので、このリポジトリの
//   学び・Issue と PR・スキルの外のファイル（docs/、.agents/rules/、scripts/ など）を参照しない。
//   Markdown のリンクは、スキルのディレクトリの外（他のスキルを含む）を指したら dist-repo-path にする。
//   パスを書かずにファイル名だけで書いた参照も、doc-refs.json の repo_files.sources の下にしか無い名前なら
//   dist-repo-path にする（導入先にも一般に在る名前は、repo_files.allowed に理由付きで許可する）。
//   Tier 3（コメント）にも当てる。
// Issue と PR の番号は、例の行（scripts/lib/doc-scan.ts の EXAMPLE_LINE_RE）では読まない。
//
// 違反の形だが正しい記述は、scripts/gates/docs/doc-allowed.json に理由付きで許可する（使われていない許可は失敗にする）。
// 対象ファイル 0 件・設定の形の誤りは exit 2。違反・使われていない許可は exit 1。
import { existsSync, readFileSync } from "node:fs";
import { basename, dirname, join, normalize } from "node:path";
import { TEXT_EXTENSIONS } from "../code/check-control-chars.ts";
import { listSources } from "../tooling/run-on-sources.ts";
import {
  applyAllowed,
  blankInlineCode,
  distributedSkillDir,
  EXAMPLE_LINE_RE,
  fencedLines,
  loadAllowed,
} from "../../lib/doc-scan.ts";
import { scannedFiles, type ScannedFile } from "./doc-scan-files.ts";
import { errorMessage } from "../../lib/errors.ts";
import { isRecord } from "../../lib/guards.ts";
import { isArray } from "../../lib/is-array.ts";
import { isCliEntry } from "../../lib/cli/entry.ts";

export const CONFIG_PATH = "scripts/gates/docs/doc-refs.json";
export const RULES = [
  "link",
  "section",
  "tier-down",
  "dist-kaizen",
  "dist-issue",
  "dist-repo-path",
];
// このチェック自身のテストとミューテーションテストの定義は、違反の fixture を本文に持つので読まない。
const SELF_FIXTURES = [
  "scripts/gates/docs/check-doc-refs.test.ts",
  "scripts/gates/docs/check-doc-refs.mutations.json",
  CONFIG_PATH,
];

type GeneratedEntry = { ref: string; template: string; skills?: string[] };
type AllowedName = { name: string; reason: string };
type RepoFilesConfig = { sources: string[]; allowed: AllowedName[] };
type DocRefsConfig = { repo: string; generated: GeneratedEntry[]; repo_files: RepoFilesConfig };
type Finding = { line: number; rule: string; text: string; message?: string };
type SectionKind = "skill" | "link" | "code";

/** doc-refs.json を読む。形の誤りは例外にする。 */
function loadConfig(root: string): DocRefsConfig {
  const path = join(root, CONFIG_PATH);
  if (!existsSync(path)) throw new Error(`${CONFIG_PATH} が無い`);
  const data: unknown = JSON.parse(readFileSync(path, "utf8"));
  if (!isRecord(data) || typeof data.repo !== "string" || !/^[\w.-]+\/[\w.-]+$/.test(data.repo))
    throw new Error(`${CONFIG_PATH}: repo は "<owner>/<name>" の形にする`);
  const ok = (e: unknown): e is GeneratedEntry =>
    isRecord(e) &&
    typeof e.ref === "string" &&
    typeof e.template === "string" &&
    (e.skills === undefined ||
      (isArray(e.skills) && e.skills.every((s: unknown) => typeof s === "string")));
  const { generated } = data;
  if (!isArray(generated) || !generated.every(ok))
    throw new Error(`${CONFIG_PATH}: generated は { ref, template, skills? } の配列にする`);
  for (const g of generated) {
    if (!existsSync(join(root, g.template)))
      throw new Error(`${CONFIG_PATH}: ${g.ref} のテンプレート ${g.template} が無い`);
  }
  return { ...data, repo: data.repo, generated, repo_files: loadRepoFiles(data.repo_files) };
}

/** doc-refs.json の repo_files を読む。sources は `/` で終わるディレクトリ、allowed は名前ごとの許可。 */
function loadRepoFiles(value: unknown): RepoFilesConfig {
  const text = (v: unknown): v is string => typeof v === "string" && v.trim() !== "";
  const { sources, allowed } = isRecord(value) ? value : {};
  if (
    !isArray(sources) ||
    sources.length === 0 ||
    !sources.every((s) => text(s) && s.endsWith("/"))
  )
    throw new Error(`${CONFIG_PATH}: repo_files.sources は / で終わるディレクトリの配列にする`);
  const ok = (e: unknown): e is AllowedName => isRecord(e) && text(e.name) && text(e.reason);
  if (!isArray(allowed) || !allowed.every(ok))
    throw new Error(`${CONFIG_PATH}: repo_files.allowed は { name, reason } の配列にする`);
  const names = allowed.map((e) => e.name);
  const dup = names.find((n, i) => names.indexOf(n) !== i);
  if (dup !== undefined)
    throw new Error(`${CONFIG_PATH}: repo_files.allowed の ${dup} が重複している`);
  return { sources: sources.filter(text), allowed };
}

// ---- 参照先の節名 ----

// 比べる前に次の正規化をする。バッククォートを除く。『』を「」に揃える。空白を 1 つにまとめる。末尾の句点を除く。
const norm = (s: string) =>
  s
    .replace(/`/g, "")
    .replace(/『/g, "「")
    .replace(/』/g, "」")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/。$/, "");

/** Markdown の本文から、節名として参照できる文字列（見出し・太字の項目・表のセル）を集める。 */
function anchorsOf(text: string): Set<string> {
  const names = new Set<string>();
  const lines = text.split(/\r?\n/);
  const fenced = fencedLines(lines);
  lines.forEach((line: string, i: number) => {
    if (fenced[i]) return;
    const h = /^#{1,6}\s+(.*?)\s*#*\s*$/.exec(line);
    if (h) {
      names.add(norm(h[1]));
      // 番号付きの見出し（「7. 定期実行」）は、番号を除いた名前でも参照できる。
      names.add(norm(h[1].replace(/^\d+[a-z]?(?:\.\d+[a-z]?)*\.?\s+/, "")));
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
export function hasAnchor(names: Set<string>, name: string) {
  const n = norm(name);
  if (names.has(n)) return true;
  for (const a of names)
    if (a.startsWith(`${n}（`) || a.startsWith(`${n}(`) || a.startsWith(`${n} (`)) return true;
  return false;
}

// 節名。中に「」を 1 段だけ含んでよい（「機能の在否は「コンテナと文言がある」…」）。
const NAME = "「((?:[^「」]|「[^「」]*」)+)」";

// パスと節名の間に挟んでよい語。パスの後に「の」「の、」や空白を挟んで節名を書く形も参照として照合する
// （挟む形を外すと、書き換えで「の」を足しただけの参照が確かめられなくなる）。
// 節名ではない語句を引用するときは、間に名詞を挟んで書く（例: の分類「許容」）。
const SEP = "(?:\\s*の[、,]?\\s*|\\s+)?";

const SECTION_PATTERNS: { re: RegExp; kind: SectionKind }[] = [
  // スキル名を前に付けた形（バッククォートのスキル名・「の」・バッククォートのパス・節名）
  {
    re: new RegExp(`\`([a-z0-9-]+)\` の \`([^\`\\s]+\\.md)\`${SEP}${NAME}`, "g"),
    kind: "skill",
  },
  // リンクの後の節名
  {
    re: new RegExp(`\\]\\(([^)\\s#]+\\.md)(?:#[^)\\s]*)?\\)${SEP}${NAME}`, "g"),
    kind: "link",
  },
  // バッククォートのパスの後の節名
  { re: new RegExp(`(?<!\` の )\`([^\`\\s]+\\.md)\`${SEP}${NAME}`, "g"), kind: "code" },
];

/** スキルのディレクトリ（配布スキル・private skill・eval の対象スキル）。 */
function skillDirOf(root: string, file: string): string | null {
  const d = distributedSkillDir(file);
  if (d) return d;
  const p = /^\.agents\/skills\/[^/]+(?=\/)/.exec(file)?.[0];
  if (p) return p;
  const e = /^evals\/([^/]+)\//.exec(file);
  return e && existsSync(join(root, "skills", e[1])) ? `skills/${e[1]}` : null;
}

/** 参照先のファイル（リポジトリ相対）。見つからなければ null。 */
/**
 * Markdown のリンク先をリポジトリ相対のパスにする。アンカーとクエリを除き、`%` の符号化を戻し、
 * `/` で始まるものはルートから読む。link 規則と section 規則が同じ解決を使う。
 */
function linkPath(file: string, target: string) {
  const raw = target.replace(/[#?].*$/, "");
  let path = raw;
  try {
    path = decodeURIComponent(raw);
  } catch {
    // 符号化として読めない `%`（`100%.md`）は、書いた文字のままのパスとして確かめる。
  }
  return normalize(path.startsWith("/") ? path.slice(1) : join(dirname(file), path));
}

/** 節名の参照 1 件。kind が "skill" のときだけ skill にスキル名が入る。 */
type SectionRef = {
  root: string;
  file: string;
  kind: SectionKind;
  path: string;
  skill: string | null;
};

function resolveSectionTarget({ root, file, kind, path, skill }: SectionRef): string | null {
  if (kind === "skill") {
    for (const base of [`skills/${skill}`, `.agents/skills/${skill}`]) {
      if (existsSync(join(root, base, path))) return normalize(join(base, path));
    }
    return null;
  }
  if (kind === "link") {
    const p = linkPath(file, path);
    return existsSync(join(root, p)) ? p : null;
  }
  const sk = skillDirOf(root, file);
  const cands = [join(dirname(file), path), path];
  if (sk) cands.push(join(sk, path), join(sk, "references", path));
  const hit = cands.map((c) => normalize(c)).find((c) => existsSync(join(root, c)));
  return hit ?? null;
}

function generatedTemplate(
  config: DocRefsConfig,
  { root, file, path, skill }: SectionRef,
): string | null {
  const sk = skill ?? skillDirOf(root, file)?.split("/").pop();
  // 同じ生成ファイルを `gaps.md`・`.replace/parity/<slug>/gaps.md` のように書くので、宣言した名前で終わるパスも当てる。
  const hit = config.generated.find(
    (g) =>
      (g.ref === path || path.endsWith(`/${g.ref}`)) &&
      (g.skills === undefined || (sk && g.skills.includes(sk))),
  );
  return hit?.template ?? null;
}

// ---- Tier 4 と配布スキルの外への参照 ----

// 学び（日付で始まる名前）。`.kaizen/archive/INDEX.md` は学びではなく kaizen スキルが作る索引なので当てない。
const KAIZEN_RE =
  /(?<![\w./-])\.kaizen\/(?:archive\/(?!INDEX\.md)[A-Za-z0-9_-]+\.md|\d{4}-\d{2}-\d{2}-[A-Za-z0-9_-]+\.md)/g;
const TESTS_RE = /(?<![\w./-])tests\/[\w-]+\/iteration-\d+/g;
const issueRes = (repo: string) => [
  // 「#123」。前が単語・`/`・`.`・`-`・`&`・`{` のもの（owner/repo#123、文字参照の &#123;、シェルの ${#1}）は
  // 他のリポジトリか番号ではない。
  /(?<![\w/.&{-])#\d+\b/g,
  new RegExp(`github\\.com/${repo.replace(/[.]/g, "\\.")}/(?:issues|pull)/\\d+`, "g"),
];
const REPO_PATH_RE = /(?<![\w./-])((?:docs|\.agents\/rules|scripts|evals|tests)\/[\w./-]*[\w])/g;

/** 1 ファイルを読む間、どの行でも変わらない値。 */
type FileContext = {
  root: string;
  config: DocRefsConfig;
  file: string;
  tier: number;
  /** 配布スキルのディレクトリ。配布スキルの外のファイルなら null。 */
  dist: string | null;
  /** 参照先のファイルの節名の一覧を返す（読んだ結果はキャッシュする）。 */
  anchors: (target: string) => Set<string>;
  repoNames: RepoNames;
};

/** 1 行を読む間の値。at は、この行の違反を 1 件記録する。 */
type LineContext = FileContext & {
  line: string;
  at: (rule: string, t: string, message?: string) => void;
};

/**
 * Markdown のリンク `[...](相対パス)` の先が在るかと、配布スキルの外を指していないかを確かめる（link 規則）。
 * 確かめたリンク先の範囲を返し、checkRepoFileNames がリンク先の名前を重ねて報告しないようにする。
 */
function checkLinks({ root, file, dist, line, at }: LineContext): [number, number][] {
  const spans: [number, number][] = [];
  for (const m of blankInlineCode(line).matchAll(/\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g)) {
    const target = m[1];
    spans.push([m.index, m.index + m[0].length]);
    if (/^[a-z][a-z0-9+.-]*:/i.test(target) || target.startsWith("#") || target.startsWith("<"))
      continue;
    const rel = linkPath(file, target);
    if (!existsSync(join(root, rel))) at("link", target, `リンク先 ${target} が無い`);
    // 配布スキルのリンクは、スキルのディレクトリの中だけを指す（他のスキルも導入先に在るとは限らない）。
    else if (dist && !rel.startsWith(`${dist}/`))
      at("dist-repo-path", target, `スキルの外 ${rel} へのリンク`);
  }
  return spans;
}

/** パスの直後に書いた「節名」1 件が、参照先の見出しなどに在るかを確かめる（section 規則）。 */
function checkSection(ctx: LineContext, kind: SectionKind, m: RegExpMatchArray) {
  const { root, config, file, anchors, at } = ctx;
  const [skill, path, name] = kind === "skill" ? [m[1], m[2], m[3]] : [null, m[1], m[2]];
  const shown = `${skill ? `${skill}/` : ""}${path}「${name}」`;
  const ref = { root, file, kind, path, skill };
  let target = resolveSectionTarget(ref);
  if (target === null && kind === "link") return; // リンク切れは link で報告する
  target ??= generatedTemplate(config, ref);
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

/** Tier 4（学び・eval の結果・Issue と PR）と、配布スキルの外のファイルへの参照を確かめる。 */
function checkTierRefs(ctx: LineContext, linkSpans: [number, number][]) {
  const { tier, dist, line, at } = ctx;
  const toTier4 = tier <= 2 && !dist;
  if (!toTier4 && !dist) return;
  for (const m of line.matchAll(KAIZEN_RE))
    at(dist ? "dist-kaizen" : "tier-down", m[0], `学び ${m[0]} を参照している`);
  if (!dist)
    for (const m of line.matchAll(TESTS_RE))
      at("tier-down", m[0], `eval の結果 ${m[0]} を参照している`);
  if (!EXAMPLE_LINE_RE.test(line)) checkIssueRefs(ctx);
  if (dist) checkRepoFileNames(ctx, [...linkSpans, ...checkRepoPathRefs(ctx, dist)]);
}

/** 行が Issue・PR を参照していないかを確かめる。 */
function checkIssueRefs({ config, dist, line, at }: LineContext) {
  const rule = dist ? "dist-issue" : "tier-down";
  for (const re of issueRes(config.repo)) {
    // インラインコードの中は例として読まない（「`#1` のように書かない」）。
    for (const m of blankInlineCode(line).matchAll(re))
      at(rule, m[0], `Issue・PR ${m[0]} を参照している`);
  }
}

/**
 * 配布スキル（dist）の行が、スキルの中に無いリポジトリのファイルを参照していないかを確かめる。
 * 報告したパスの範囲を返し、checkRepoFileNames が同じパスの末尾の名前を重ねて報告しないようにする。
 */
function checkRepoPathRefs({ root, line, at }: LineContext, dist: string): [number, number][] {
  const spans: [number, number][] = [];
  for (const m of line.matchAll(REPO_PATH_RE)) {
    const p = m[1];
    if (existsSync(join(root, p)) && !existsSync(join(root, dist, p))) {
      at("dist-repo-path", p, `スキルの外のファイル ${p} を参照している`);
      spans.push([m.index, m.index + p.length]);
    }
  }
  return spans;
}

// ファイル名を 1 つのトークンとして読む。前が `/` のもの（パスの末尾）も当てる。
// 前後に名前の文字が続くもの（`my-outdated.yml`・`outdated.yml.bak`）は別の名前なので当てない。
const FILE_NAME_RE = /(?<![\w.-])([\w.-]+\.[A-Za-z0-9]+)(?![\w-]|\.[A-Za-z0-9])/g;

/** このリポジトリにしか無いファイルの名前を、配布スキル（dist）の行が書いていないかを確かめる。 */
function checkRepoFileNames({ line, repoNames, at }: LineContext, reported: [number, number][]) {
  for (const m of line.matchAll(FILE_NAME_RE)) {
    const name = m[1];
    const origin = repoNames.names.get(name);
    if (origin === undefined || reported.some(([s, e]) => m.index >= s && m.index < e)) continue;
    if (repoNames.allowed.has(name)) repoNames.used.add(name);
    else at("dist-repo-path", name, `このリポジトリの ${origin} を名前で参照している`);
  }
}

/** 名前で書くと誤りになるファイルの名前（repo_files）と、名前ごとの許可が使われたか。 */
type RepoNames = { names: Map<string, string>; allowed: Set<string>; used: Set<string> };

/**
 * repo_files.sources の下のファイルの名前と、その在りか。skills/ に同じ名前のファイルがあるもの・拡張子の無いものは除く。
 * 追跡ファイルが 1 件も無い sources は、宣言が古いので例外にする。
 */
function repoFileNames(root: string, { sources, allowed }: RepoFilesConfig): RepoNames {
  const files = listSources(root, TEXT_EXTENSIONS);
  const inSkills = new Set(files.filter((f) => f.startsWith("skills/")).map((f) => basename(f)));
  const names = new Map<string, string>();
  for (const s of sources) {
    const under = files.filter((f) => f.startsWith(s));
    if (under.length === 0)
      throw new Error(`${CONFIG_PATH}: repo_files.sources の ${s} にファイルが無い`);
    for (const f of under) {
      const n = basename(f);
      if (/\.[A-Za-z0-9]+$/.test(n) && !inSkills.has(n) && !names.has(n)) names.set(n, f);
    }
  }
  return { names, allowed: new Set(allowed.map((e) => e.name)), used: new Set() };
}

/**
 * 1 ファイルの違反を列挙する。
 * @returns {{ line: number, rule: string, text: string, message?: string }[]}
 */
function findInFile({
  root,
  config,
  scanned: { file, tier, markdown },
  text,
  anchorCache = new Map(),
  repoNames,
}: {
  root: string;
  config: DocRefsConfig;
  scanned: ScannedFile;
  text: string;
  anchorCache?: Map<string, Set<string>>;
  repoNames: RepoNames;
}): Finding[] {
  const out: Finding[] = [];
  const lines = text.split(/\r?\n/);
  const fenced = markdown ? fencedLines(lines) : lines.map(() => false);
  const anchors = (target: string) => {
    const cached = anchorCache.get(target);
    if (cached) return cached;
    const found = anchorsOf(readFileSync(join(root, target), "utf8"));
    anchorCache.set(target, found);
    return found;
  };
  const ctx: FileContext = {
    root,
    config,
    file,
    tier,
    dist: distributedSkillDir(file),
    anchors,
    repoNames,
  };

  lines.forEach((line: string, i: number) => {
    const at = (rule: string, t: string, message?: string) =>
      out.push({ line: i + 1, rule, text: t, message });
    const lc = { ...ctx, line, at };
    const linkSpans = markdown && !fenced[i] ? checkLinks(lc) : [];
    if (!fenced[i]) {
      for (const { re, kind } of SECTION_PATTERNS) {
        for (const m of line.matchAll(re)) checkSection(lc, kind, m);
      }
    }
    checkTierRefs(lc, linkSpans);
  });
  return out;
}

/** repo_files.allowed のうち、どの行にも当たらなかった名前の許可。 */
function unusedNameAllowances({ allowed, used }: RepoNames): string[] {
  const out: string[] = [];
  for (const name of allowed) {
    if (used.has(name)) continue;
    out.push(
      `使われていない許可: ${CONFIG_PATH} の repo_files.allowed の ${name}（記述が消えたなら許可も消す）`,
    );
  }
  return out;
}

/**
 * @param {string} root
 * @returns {{ files: number, found: object[], failures: string[] }}
 */
export function checkDocRefs(root: string) {
  const config = loadConfig(root);
  const repoNames = repoFileNames(root, config.repo_files);
  const result = scanDocRefs(root, config, repoNames);
  return { ...result, failures: [...result.failures, ...unusedNameAllowances(repoNames)] };
}

/** 走査するファイルを読み、違反と、許可を当てた後の失敗を集める。repoNames の used はここで埋まる。 */
function scanDocRefs(root: string, config: DocRefsConfig, repoNames: RepoNames) {
  const list = loadAllowed(root);
  const files = scannedFiles(root, { exclude: SELF_FIXTURES });
  const cache = new Map();
  const found: (Finding & { file: string })[] = [];
  for (const f of files) {
    const text = readFileSync(join(root, f.file), "utf8");
    for (const v of findInFile({ root, config, scanned: f, text, anchorCache: cache, repoNames }))
      found.push({ file: f.file, ...v });
  }
  return { files: files.length, found, ...applyAllowed(found, list, RULES) };
}

export function main(argv: string[]) {
  const args = argv.filter((a) => a !== "--");
  const root = args.find((a) => !a.startsWith("--")) ?? process.cwd();
  let result;
  try {
    result = checkDocRefs(root);
  } catch (error) {
    console.error(`doc-refs: チェックできない: ${errorMessage(error)}`);
    return 2;
  }
  const { files, failures } = result;
  if (files === 0) {
    console.error("doc-refs: 対象ファイルが 0 件。列挙できていない");
    return 2;
  }
  if (failures.length) {
    console.error(`doc-refs: ${files} 件を走査し、${failures.length} 件の不備:`);
    for (const f of failures) console.error(`  - ${f}`);
    console.error(
      "Fix: 参照先を直す。正しい記述だけを scripts/gates/docs/doc-allowed.json の allowed に理由付きで書く。" +
        "導入先にも在るファイル名は scripts/gates/docs/doc-refs.json の repo_files.allowed に書く。",
    );
    return 1;
  }
  console.log(`doc-refs: OK（${files} 件）`);
  return 0;
}

if (isCliEntry(import.meta.url)) process.exit(main(process.argv.slice(2)));
