// pnpm audit で無視した advisory（pnpm-workspace.yaml の auditConfig.ignoreGhsas）を見直す時期を検出する。
// 週次のワークフロー（.github/workflows/ignored-advisories.yml）が実行し、検出したものを追跡 Issue に載せる。
// 無視した advisory は pnpm audit にも Dependabot alerts にも出ないので、外す時期を知らせる方法はこのスクリプトだけである。
//
// 検出するのは次の 4 つで、どれも無視の設定を外すか、判断し直す時期を示す。
// - 修正版が公開された（advisory の vulnerabilities[].first_patched_version が空でない）
// - advisory が取り下げられた（withdrawn_at が空でない）。修正版が出ないまま取り下げられることがある
// - 許可した依存元の外のパッケージが、無視したパッケージを使い始めた（影響を受けないという判断の前提が変わった）
// - どの依存元もそのパッケージを使わなくなった
//
// 確かめられなかったものを「変化なし」として扱わない。次のときは exit 1 で止まる。
// pnpm が読んだ無視の一覧と、pnpm-workspace.yaml に書いた一覧が食い違う（設定のキーや形が変わり、一覧が空として読まれた場合など）。
// 許可する依存元の一覧（ignored-advisories-dependents.json）と無視の一覧が食い違う。外部コマンドや API が失敗するか、想定外の形を返す。
//
// 使い方: node scripts/tools/ignored-advisories.ts --out <本文のパス> --comment-out <コメントのパス> [--previous <前回の本文のパス>]
// 標準出力の最後の行に `due=<件数>` を出す。件数が 0 のときも本文とコメントのファイルは書く。
// 前回の本文を渡すと、前回との差分（新規・継続・解消）を本文とコメントに書く（#508 の追跡 Issue の更新規則）。
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "../lib/cli/args.ts";
import { isCliEntry } from "../lib/cli/entry.ts";
import { errorMessage } from "../lib/errors.ts";
import { isNonBlankString, isRecord } from "../lib/guards.ts";
import { isArray } from "../lib/is-array.ts";
import { loadYaml } from "../lib/text/yaml-as.ts";

const GHSA = /^GHSA-[0-9a-z]{4}-[0-9a-z]{4}-[0-9a-z]{4}$/;
const ALLOWLIST = join(
  dirname(fileURLToPath(import.meta.url)),
  "ignored-advisories-dependents.json",
);

export type Dependent = { name: string; depField: string };
export type AllowEntry = { package: string; dependents: Dependent[] };
export type Finding =
  | { id: string; kind: "patched"; detail: string[] }
  | { id: string; kind: "withdrawn"; detail: string }
  | { id: string; kind: "new-dependent"; detail: Dependent[] }
  | { id: string; kind: "unused"; detail: string };

/** 依存元を照合するキー。許可の一覧と pnpm why の結果を同じ形で比べる。 */
const dependentKey = (d: Dependent): string => `${d.depField}\u0000${d.name}`;

function assertGhsaList(value: unknown, where: string): string[] {
  if (!isArray(value)) throw new Error(`${where} が配列でない`);
  const ids: string[] = [];
  for (const item of value) {
    if (typeof item !== "string" || !GHSA.test(item)) {
      throw new Error(`${where} に GHSA の形でない要素がある: ${JSON.stringify(item)}`);
    }
    ids.push(item);
  }
  return ids;
}

/** pnpm-workspace.yaml に書いた auditConfig.ignoreGhsas。キーが無ければ空の一覧。 */
export function declaredGhsas(yamlText: string): string[] {
  const doc = loadYaml(yamlText);
  if (!isRecord(doc)) throw new Error("pnpm-workspace.yaml がマッピングでない");
  const audit = doc["auditConfig"];
  if (audit === undefined) return [];
  if (!isRecord(audit)) throw new Error("auditConfig がマッピングでない");
  const ids = audit["ignoreGhsas"];
  if (ids === undefined || ids === null) return [];
  return assertGhsaList(ids, "auditConfig.ignoreGhsas");
}

/** `pnpm config get audit --json` の出力から、pnpm が実際に読んだ無視の一覧を取る。 */
export function loadedGhsas(output: string): string[] {
  const text = output.trim();
  // 一覧が空のときやキーが無いとき、pnpm は空の出力か `null` を返す（実測）。
  if (text === "" || text === "null") return [];
  const value: unknown = JSON.parse(text);
  if (!isRecord(value))
    throw new Error(`pnpm config get audit の出力がオブジェクトでない: ${text}`);
  const ids = value["ignore"];
  if (ids === undefined || ids === null) return [];
  return assertGhsaList(ids, "pnpm config get audit の ignore");
}

function parseDependent(value: unknown, where: string): Dependent {
  if (
    !isRecord(value) ||
    !isNonBlankString(value["name"]) ||
    !isNonBlankString(value["depField"])
  ) {
    throw new Error(`${where} の要素に name と depField が無い: ${JSON.stringify(value)}`);
  }
  return { name: value["name"], depField: value["depField"] };
}

/** 許可する依存元の一覧（GHSA ごとに、無視したパッケージと、使ってよい直接の依存）。 */
export function parseAllowlist(jsonText: string): Map<string, AllowEntry> {
  const value: unknown = JSON.parse(jsonText);
  if (!isRecord(value) || !isRecord(value["advisories"])) {
    throw new Error("許可する依存元の一覧に advisories のオブジェクトが無い");
  }
  const entries = new Map<string, AllowEntry>();
  for (const [id, entry] of Object.entries(value["advisories"])) {
    if (!GHSA.test(id)) throw new Error(`許可する依存元の一覧のキーが GHSA の形でない: ${id}`);
    if (!isRecord(entry) || !isNonBlankString(entry["package"]) || !isArray(entry["dependents"])) {
      throw new Error(`${id} に package と dependents が無い`);
    }
    const dependents = entry["dependents"].map((d) => parseDependent(d, id));
    if (dependents.length === 0) throw new Error(`${id} の dependents が空`);
    entries.set(id, { package: entry["package"], dependents });
  }
  return entries;
}

/** 3 つの一覧（書いた一覧・pnpm が読んだ一覧・許可する依存元の一覧）が同じ GHSA の集合かを確かめる。 */
export function listMismatches(
  declared: readonly string[],
  loaded: readonly string[],
  allowlist: ReadonlyMap<string, AllowEntry>,
): string[] {
  const errors: string[] = [];
  const decl = new Set(declared);
  if (decl.size !== declared.length) errors.push("pnpm-workspace.yaml の ignoreGhsas に重複がある");
  const diff = (a: Iterable<string>, b: ReadonlySet<string> | ReadonlyMap<string, unknown>) =>
    [...a].filter((x) => !b.has(x));
  const loadedSet = new Set(loaded);
  for (const id of diff(decl, loadedSet))
    errors.push(`${id} は pnpm-workspace.yaml にあるが、pnpm が読んでいない`);
  for (const id of diff(loadedSet, decl))
    errors.push(`${id} は pnpm が読んだが、pnpm-workspace.yaml に無い`);
  for (const id of diff(decl, allowlist))
    errors.push(`${id} の許可する依存元が、ignored-advisories-dependents.json に無い`);
  for (const id of diff(allowlist.keys(), decl)) {
    errors.push(
      `${id} は ignored-advisories-dependents.json にあるが、ignoreGhsas に無い（無視を外したら一覧からも消す）`,
    );
  }
  return errors;
}

/**
 * vulnerabilities の要素の package が、無視したパッケージ（npm の `pkg`）かを返す。
 * package と package.name は null になりうる（GitHub の global advisories API）。null の要素は `pkg` に当たらない。
 * キーが無い・型が違う要素は、API の形が変わった可能性があるので例外にする。読み飛ばすと、修正版を見逃したまま追跡 Issue を閉じる。
 */
function isIgnoredPackage(v: Record<string, unknown>, id: string, pkg: string): boolean {
  const target = v["package"];
  if (target === null) return false;
  if (!isRecord(target) || !("name" in target)) {
    throw new Error(`${id} の vulnerabilities の要素に package.name が無い`);
  }
  if (target["name"] === null) return false;
  if (typeof target["name"] !== "string") throw new Error(`${id} の package.name が文字列でない`);
  return target["ecosystem"] === "npm" && target["name"] === pkg;
}

/**
 * vulnerabilities の 1 要素から、無視したパッケージ（npm の `pkg`）の修正版を取る。当たらなければ空の配列を返す。
 * 修正版には、それがある脆弱な範囲を添える。使っているバージョンがその範囲にあるかは、人が確かめる。
 */
function patchedVersion(v: unknown, id: string, pkg: string): string[] {
  if (!isRecord(v)) throw new Error(`${id} の vulnerabilities の要素がオブジェクトでない`);
  if (!isIgnoredPackage(v, id, pkg)) return [];
  const fixed = v["first_patched_version"];
  if (fixed === null || fixed === undefined) return [];
  if (typeof fixed !== "string") throw new Error(`${id} の first_patched_version が文字列でない`);
  const range = v["vulnerable_version_range"];
  return [typeof range === "string" ? `${pkg}@${fixed}（${range} の修正版）` : `${pkg}@${fixed}`];
}

/**
 * `gh api /advisories/<GHSA>` の応答から、修正版と取り下げを取る。
 * 修正版は、無視したパッケージ（npm の `pkg`）の範囲だけから取る。
 * 同じ advisory が別のパッケージや別のエコシステムを挙げていても、そちらの修正版では外す時期にならない。
 */
export function advisoryStatus(
  value: unknown,
  id: string,
  pkg: string,
): { patched: string[]; withdrawn: string | null } {
  if (!isRecord(value) || !isArray(value["vulnerabilities"])) {
    throw new Error(`${id} の advisory に vulnerabilities が無い`);
  }
  const patched = value["vulnerabilities"].flatMap((v) => patchedVersion(v, id, pkg));
  const withdrawn = value["withdrawn_at"];
  if (withdrawn !== null && withdrawn !== undefined && typeof withdrawn !== "string") {
    throw new Error(`${id} の withdrawn_at が文字列でない`);
  }
  return { patched, withdrawn: withdrawn ?? null };
}

/**
 * `pnpm why <パッケージ> --json` の出力から、そのパッケージに至る直接の依存を取る。
 * 出力は依存元へ向かう木で、`depField` を持つ節がリポジトリ自身（importer）である。
 * importer を dependents に持つ節が、直接の依存になる（実測）。
 */
export function directDependents(value: unknown): Dependent[] {
  if (!isArray(value)) throw new Error("pnpm why の出力が配列でない");
  const found = new Map<string, Dependent>();
  const walk = (node: unknown): void => {
    if (!isRecord(node) || !isArray(node["dependents"])) return;
    for (const parent of node["dependents"]) {
      if (
        isRecord(parent) &&
        typeof parent["depField"] === "string" &&
        typeof node["name"] === "string"
      ) {
        const d = { name: node["name"], depField: parent["depField"] };
        found.set(dependentKey(d), d);
      }
      walk(parent);
    }
  };
  value.forEach(walk);
  return [...found.values()].sort(
    (a, b) => a.name.localeCompare(b.name) || a.depField.localeCompare(b.depField),
  );
}

/** 1 つの GHSA について、見直す時期に当たるものを挙げる。 */
export function evaluate(input: {
  id: string;
  status: { patched: readonly string[]; withdrawn: string | null };
  allow: AllowEntry;
  dependents: readonly Dependent[];
}): Finding[] {
  const { id, status, allow, dependents } = input;
  const findings: Finding[] = [];
  if (status.patched.length > 0)
    findings.push({ id, kind: "patched", detail: [...status.patched] });
  if (status.withdrawn !== null) findings.push({ id, kind: "withdrawn", detail: status.withdrawn });
  if (dependents.length === 0) {
    findings.push({ id, kind: "unused", detail: allow.package });
  } else {
    const allowed = new Set(allow.dependents.map(dependentKey));
    const outside = dependents.filter((d) => !allowed.has(dependentKey(d)));
    if (outside.length > 0) findings.push({ id, kind: "new-dependent", detail: outside });
  }
  return findings;
}

const KIND_LABEL: Record<Finding["kind"], string> = {
  patched: "修正版が公開された",
  withdrawn: "advisory が取り下げられた",
  "new-dependent": "許可した依存元の外が使い始めた",
  unused: "どの依存元も使わなくなった",
};

function describe(f: Finding): string {
  switch (f.kind) {
    case "patched":
      return f.detail.join(", ");
    case "withdrawn":
      return f.detail;
    case "new-dependent":
      return f.detail.map((d) => `${d.name}（${d.depField}）`).join(", ");
    case "unused":
      return f.detail;
  }
}

/**
 * 前回との差分に使う、検出したことの識別子（advisory・種別・内容）。
 * 内容を含めるので、許可の外の依存元が増えたときや、別の修正版が出たときは、前回の識別子が「解消」、今回の識別子が「新規」になる。
 */
const findingKey = (f: Finding): string => `${f.id} ${f.kind}: ${describe(f)}`;

const KEYS_MARKER = /^<!-- ignored-advisories:keys (.*) -->$/mu;
const KEY_FORM =
  /^GHSA-[0-9a-z]{4}-[0-9a-z]{4}-[0-9a-z]{4} (patched|withdrawn|new-dependent|unused): \S/u;

function parseKeys(json: string): string[] {
  const value: unknown = JSON.parse(json);
  if (!isArray(value)) throw new Error("識別子の一覧が配列でない");
  const keys: string[] = [];
  for (const key of value) {
    if (typeof key !== "string" || !KEY_FORM.test(key)) {
      throw new Error(`識別子の形でないものがある: ${JSON.stringify(key)}`);
    }
    if (keys.includes(key)) throw new Error(`識別子が重複している: ${key}`);
    keys.push(key);
  }
  return keys;
}

/**
 * 前回の本文に埋めた識別子の一覧を読む。目印が無ければ（初めての作成や、人が本文を書き換えた後）空の一覧にする。
 * 目印があって読めないときは、差分を誤らないように例外にする。メッセージには直し方を書く。
 */
export function previousKeys(body: string): string[] {
  const match = KEYS_MARKER.exec(body);
  if (match === null) return [];
  try {
    return parseKeys(match[1] ?? "");
  } catch (error) {
    throw new Error(
      `前回の本文の識別子を読めない（${errorMessage(error)}）。追跡 Issue の本文から \`<!-- ignored-advisories:keys\` で始まる行を消すと、すべて新規として読み直す`,
      { cause: error },
    );
  }
}

/** 今回の検出を、前回の識別子と比べて新規・継続に分け、前回にだけあったもの（解消）を挙げる。 */
export function diffFindings(
  findings: readonly Finding[],
  previous: readonly string[],
): { added: string[]; kept: string[]; resolved: string[] } {
  const before = new Set(previous);
  const now = findings.map(findingKey);
  const nowSet = new Set(now);
  return {
    added: now.filter((k) => !before.has(k)),
    kept: now.filter((k) => before.has(k)),
    resolved: [...before].filter((k) => !nowSet.has(k)),
  };
}

/** 追跡 Issue の本文。最後の行に、次の実行が差分に使う識別子の一覧を埋める。 */
export function formatBody(
  findings: readonly Finding[],
  checked: number,
  previous: readonly string[] = [],
): string {
  const { kept, resolved } = diffFindings(findings, previous);
  const keptSet = new Set(kept);
  const lines = [
    "`pnpm-workspace.yaml` の `auditConfig.ignoreGhsas` で無視している advisory のうち、見直す時期に当たるものの一覧です。",
    "この Issue は `Ignored advisories` ワークフローが作成・更新・クローズします。",
    "",
    `確かめた advisory: ${checked} 件、見直すもの: ${findings.length} 件`,
    "",
  ];
  if (findings.length > 0) {
    lines.push("| advisory | 検出したこと | 内容 | 前回から |", "| --- | --- | --- | --- |");
    for (const f of findings) {
      const state = keptSet.has(findingKey(f)) ? "継続" : "新規";
      lines.push(
        `| [${f.id}](https://github.com/advisories/${f.id}) | ${KIND_LABEL[f.kind]} | ${describe(f)} | ${state} |`,
      );
    }
    lines.push(
      "",
      "それぞれの扱いは `docs/vulnerability-handling.md` の「無視する advisory」にあります。",
    );
  }
  if (resolved.length > 0) lines.push("", `前回から解消したもの: ${resolved.join("、")}`);
  lines.push("", `<!-- ignored-advisories:keys ${JSON.stringify(findings.map(findingKey))} -->`);
  return `${lines.join("\n")}\n`;
}

/** 追跡 Issue に足すコメント。本文の更新だけでは通知が届かないので、差分をコメントにも書く。 */
export function formatComment(findings: readonly Finding[], previous: readonly string[]): string {
  const { added, kept, resolved } = diffFindings(findings, previous);
  const lines = [
    `見直すもの: ${findings.length} 件（新規 ${added.length} 件・継続 ${kept.length} 件・前回から解消 ${resolved.length} 件）`,
  ];
  if (added.length > 0) lines.push("", `新規: ${added.join("、")}`);
  if (resolved.length > 0) lines.push("", `解消: ${resolved.join("、")}`);
  return `${lines.join("\n")}\n`;
}

export type Runner = (command: string, args: readonly string[]) => string;

const defaultRunner: Runner = (command, args) =>
  execFileSync(command, args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });

/** 確かめた件数と、見直す時期に当たるものを返す。確かめられなければ例外を投げる。 */
export function collect(
  run: Runner,
  workspaceYaml: string,
  allowlistJson: string,
): { checked: number; findings: Finding[] } {
  const declared = declaredGhsas(workspaceYaml);
  const loaded = loadedGhsas(run("pnpm", ["config", "get", "audit", "--json"]));
  const allowlist = parseAllowlist(allowlistJson);
  const errors = listMismatches(declared, loaded, allowlist);
  if (errors.length > 0) throw new Error(errors.join("\n"));
  const findings: Finding[] = [];
  for (const id of declared) {
    const allow = allowlist.get(id);
    if (allow === undefined) throw new Error(`${id} の許可する依存元が無い`);
    const status = advisoryStatus(
      JSON.parse(run("gh", ["api", `/advisories/${id}`])),
      id,
      allow.package,
    );
    const dependents = directDependents(JSON.parse(run("pnpm", ["why", allow.package, "--json"])));
    findings.push(...evaluate({ id, status, allow, dependents }));
  }
  return { checked: declared.length, findings };
}

type CliOptions = { out: string; commentOut: string; previous: string | undefined };
const CLI_NAMES = new Set(["out", "comment-out", "previous"]);

/** 引数を読む。足りない・未知・同じオプションが 2 回・値が無いときは null（重複と値の無いものは共通の parseArgs が例外にする）。 */
function parseCli(args: readonly string[]): CliOptions | null {
  let values: Record<string, string>;
  try {
    values = parseArgs([...args]);
  } catch {
    return null;
  }
  if (Object.keys(values).some((name) => !CLI_NAMES.has(name))) return null;
  const { out, "comment-out": commentOut, previous } = values;
  if (!isNonBlankString(out) || !isNonBlankString(commentOut)) return null;
  return { out, commentOut, previous };
}

/** `paths` はテストが一時ディレクトリを渡すためにある。ワークフローはデフォルト（リポジトリの直下と同梱の一覧）で呼ぶ。 */
export function main(
  args: readonly string[],
  run: Runner = defaultRunner,
  paths: { workspaceYaml?: string; allowlist?: string } = {},
): number {
  const options = parseCli(args);
  if (options === null) {
    console.error(
      "使い方: node scripts/tools/ignored-advisories.ts --out <本文のパス> --comment-out <コメントのパス> [--previous <前回の本文のパス>]",
    );
    return 2;
  }
  try {
    const previous =
      options.previous === undefined ? [] : previousKeys(readFileSync(options.previous, "utf8"));
    const result = collect(
      run,
      readFileSync(paths.workspaceYaml ?? "pnpm-workspace.yaml", "utf8"),
      readFileSync(paths.allowlist ?? ALLOWLIST, "utf8"),
    );
    writeFileSync(options.out, formatBody(result.findings, result.checked, previous));
    writeFileSync(options.commentOut, formatComment(result.findings, previous));
    console.log(`due=${result.findings.length}`);
    return 0;
  } catch (error) {
    console.error(`ignored-advisories: 確かめられない: ${errorMessage(error)}`);
    return 1;
  }
}

if (isCliEntry(import.meta.url)) process.exit(main(process.argv.slice(2)));
