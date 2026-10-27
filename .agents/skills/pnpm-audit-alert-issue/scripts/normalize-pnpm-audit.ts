#!/usr/bin/env node
import { readFileSync, realpathSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { errorMessage } from "../../../../scripts/lib/errors.ts";
import { isRecord } from "../../../../scripts/lib/guards.ts";
import { isArray } from "../../../../scripts/lib/is-array.ts";
import { parseJsonAs } from "../../../../scripts/lib/parse-as.ts";

// pnpm audit の JSON は版で形が変わるので、各フィールドは unknown として読み、使うところで確かめる。
export type AuditRecord = Record<string, unknown>;
export type Packages = Record<string, { version?: unknown } | undefined>;
export type AuditJson = {
  advisories?: Record<string, AuditRecord>;
  vulnerabilities?: Record<string, AuditRecord>;
  packages?: Packages;
};

/** 出力する 1 件の finding（dependabot-alert-issue の外部 audit findings の形）。 */
export type Finding = {
  package: string;
  ecosystem: string;
  severity: string;
  ghsa: string;
  advisory_url: string;
  title: string;
  vulnerable_versions: string;
  patched_versions: string;
  patched: string;
  current_versions: unknown[];
  dependency_paths: unknown[];
  manifest: string;
  scope: string;
};

/**
 * 読めないか解析できなければ、理由を stderr に出して undefined を返す。
 * JSON の null は解析できた値なので、失敗の印には使わない（null は後の読み取りで TypeError になる）。
 */
function loadJson(path: string): AuditJson | undefined {
  let text: string;
  try {
    text = readFileSync(path, "utf8");
  } catch (err) {
    console.error(`Failed to read pnpm audit JSON: ${path}: ${errorMessage(err)}`);
    return undefined;
  }

  if (text.trim() === "") {
    console.error(`Failed to parse pnpm audit JSON: ${path} is empty`);
    return undefined;
  }

  try {
    return parseJsonAs<AuditJson>(text);
  } catch (err) {
    console.error(`Failed to parse pnpm audit JSON: ${path}: ${errorMessage(err)}`);
    return undefined;
  }
}

/** null でないオブジェクト（配列を含む）。欄は使うところで確かめる。 */
function isObjectLike(value: unknown): value is AuditRecord {
  return typeof value === "object" && value !== null;
}

/**
 * advisory.findings の 1 要素の欄を読むための形。スカラーは欄を持たないので空の欄として扱う。
 * null と undefined は、元の JavaScript と同じく欄を読めずに止める。
 */
function findingFields(finding: unknown): AuditRecord {
  if (finding === null || finding === undefined) {
    throw new TypeError(`advisory.findings の要素が ${finding} で、欄を読めない`);
  }
  return isObjectLike(finding) ? finding : {};
}

function asArray(value: unknown): unknown[] {
  if (!value) return [];
  return isArray(value) ? value : [value];
}

function uniq<T>(values: T[]): T[] {
  return [
    ...new Set(values.filter((value) => value !== undefined && value !== null && value !== "")),
  ];
}

function firstString(...values: unknown[]): string {
  for (const value of values) {
    if (typeof value === "string" && value.length > 0) return value;
  }
  return "";
}

function isUrl(value: unknown): boolean {
  return typeof value === "string" && /^https?:\/\//.test(value);
}

/**
 * GHSA の id を GitHub と同じ表記（接頭辞の `GHSA` だけが大文字で、本体は小文字）にそろえる。
 * dependabot-alert-issue は findings の `ghsa` を、却下のルールの `ghsa`（GitHub の表記で書く）と文字列で照合する。
 * 既存の Issue・PR の検索（GitHub の search API）は大文字と小文字を区別しない。
 * 検索で見つけた Issue との比べ方と、却下のルールとの照合は、dependabot-alert-issue の SKILL.md が大文字と小文字の扱いを決めていない。
 * そのため、findings の側で、Dependabot alerts の ghsa_id と同じ表記にそろえる。
 *
 * id は、前後に識別子の文字（ASCII の英字・数字・`_`・`-`）が付かない 1 語のときだけ取り出す。
 * ASCII の外の文字（`é`・全角の英数字と記号・かな・漢字）は、すべて区切りとして扱う。
 * pnpm audit の id と URL は ASCII で書かれるので、ASCII の外の文字の種類ごとには扱いを分けない。
 * 前後のどちらかに付く文字列（`XGHSA-...`・`npm-GHSA-...`・`GHSA-abcd-efgh-ijkl-mnop`・`GHSA-..._x`）は、もっと長い識別子の一部として扱う。
 * 前と後ろで同じ文字の集合を使う。片側だけを変えると前後の扱いが食い違うので、変えるときは両方を変える。
 * 空白・`/`・`:`・`.`・`?`・`#` などの記号と、文字列の端は区切りとして扱う（URL の `/advisories/GHSA-...` を含む）。
 * `\b` を使わないのは、`\b` が `-` の前後でも成り立つからである。
 */
const GHSA_BODY = "[0-9A-Za-z]{4}-[0-9A-Za-z]{4}-[0-9A-Za-z]{4}";
const GHSA_IN_TEXT = new RegExp(`(?<![0-9a-z_-])GHSA-(${GHSA_BODY})(?![0-9a-z_-])`, "i");
// 接頭辞は大文字だけを受け付ける。新しく登録できる npm のパッケージ名は小文字だけなので、
// ghsa-xxxx-xxxx-xxxx という名前のパッケージを id として読まない。大文字の GHSA- で始まるパッケージ名は確かめていない。
const GHSA_WHOLE = new RegExp(`^GHSA-(${GHSA_BODY})$`);

function ghsaFrom(value: unknown): string {
  if (typeof value !== "string") return "";
  const match = value.match(GHSA_IN_TEXT);
  return match ? `GHSA-${match[1].toLowerCase()}` : "";
}

/**
 * `via` の文字列は、advisory の id・URL か、依存を指すパッケージ名（`@scope/name` を含む）である。
 * パッケージ名は `-` や `/` の後ろに `ghsa-xxxx-xxxx-xxxx` の形を含みうるので、全体が id のときか URL のときだけ advisory として読む。
 * filter と advisoryFromVia の両方がこの判定を使う。
 */
function isAdvisoryViaString(via: string): boolean {
  return isUrl(via) || GHSA_WHOLE.test(via);
}

/**
 * advisory の欄から GHSA の id を取り出す。順は、id の欄（ghsa・ghsa_id・github_advisory_id）、url、
 * id の欄に入っていた文字列そのもの（id の形でない識別子を残すため）、source と title（自由記述）である。
 * 生の文字列を url より後にするのは、advisory_url が url を先に使うからである。url に id があるのに生の文字列を ghsa にすると、ghsa と advisory_url が食い違う。
 * 生の文字列を source と title より先にするのは、自由記述の中の別の id（`Superseded by GHSA-...` など）より、id の欄の値を信じるからである。
 */
function ghsaOf(advisory: AuditRecord): string {
  return firstString(
    ghsaFrom(advisory.ghsa),
    ghsaFrom(advisory.ghsa_id),
    ghsaFrom(advisory.github_advisory_id),
    ghsaFrom(advisory.url),
    firstString(advisory.ghsa, advisory.ghsa_id, advisory.github_advisory_id),
    ghsaFrom(advisory.source),
    ghsaFrom(advisory.title),
  );
}

function patchedFrom(range: unknown): string {
  if (typeof range !== "string") return "";
  const match = range.match(/>=\s*([0-9][^\s|,]*)/);
  return match ? match[1] : "";
}

function normalizeSeverity(value: unknown): string {
  const severity = typeof value === "string" ? value.toLowerCase() : "unknown";
  return ["critical", "high", "moderate", "medium", "low"].includes(severity)
    ? severity
    : "unknown";
}

function findingKey(finding: Finding): string {
  return [finding.package, finding.ghsa || finding.advisory_url || finding.title].join("\0");
}

function mergeStringValue(left: string, right: string): string {
  const values = uniq(
    [left, right].flatMap((value) => (typeof value === "string" ? value.split(/\s*;\s*/) : [])),
  );
  return values.join("; ");
}

function mergeFinding(target: Finding, source: Finding): void {
  target.current_versions = uniq([...target.current_versions, ...source.current_versions]);
  target.dependency_paths = uniq([...target.dependency_paths, ...source.dependency_paths]);
  target.vulnerable_versions = mergeStringValue(
    target.vulnerable_versions,
    source.vulnerable_versions,
  );
  target.patched_versions = mergeStringValue(target.patched_versions, source.patched_versions);
  if (!target.patched && source.patched) target.patched = source.patched;
  if (!target.ghsa && source.ghsa) target.ghsa = source.ghsa;
  if (!target.advisory_url && source.advisory_url) target.advisory_url = source.advisory_url;
}

function advisoryFromVia(via: unknown): AuditRecord {
  if (isObjectLike(via)) return via;
  if (typeof via !== "string") return {};

  if (!isAdvisoryViaString(via)) return {};
  // isAdvisoryViaString を通った文字列は、全体が id か URL なので、ほかの欄と同じく中の id を探す。
  const ghsa = ghsaFrom(via);

  return {
    ghsa,
    url: isUrl(via) ? via : "",
    title: ghsa || via,
  };
}

/**
 * packages から 1 つの項目の版を読む。項目が無い（null を含む）なら undefined。
 * 読む項目が object でなければ、今の版が警告なしに抜けるので、どの項目かを書いた Error を投げる。
 * 読まない項目（どの vulnerability も指さないもの）の形は確かめない。
 */
function packageVersion(packages: Packages | undefined, key: string): unknown {
  const entry: unknown = packages?.[key];
  if (entry === undefined || entry === null) return undefined;
  if (!isRecord(entry)) throw new Error(`packages.${key} が object でない`);
  return entry.version;
}

function currentVersionsFrom(
  packageName: string,
  vulnerability: AuditRecord,
  packages: Packages | undefined,
): unknown[] {
  const versions: unknown[] = [];
  for (const node of asArray(vulnerability.nodes)) {
    // nodes の要素はパッケージのパス（文字列）。それ以外の値は、元の JavaScript と同じくキーとして文字列に直して引く
    // （JSON の値では、String() とプロパティのキーへの変換が同じ文字列になる）。
    versions.push(packageVersion(packages, String(node)));
  }
  versions.push(
    vulnerability.version,
    packageVersion(packages, packageName),
    packageVersion(packages, `node_modules/${packageName}`),
  );
  return uniq(versions);
}

/** 古い形（`advisories` の 1 件）から finding を作る。 */
export function fromAdvisory(advisory: AuditRecord): Finding {
  const ghsa = ghsaOf(advisory);
  const advisoryUrl = firstString(
    advisory.url,
    ghsa ? `https://github.com/advisories/${ghsa}` : "",
  );
  const patchedVersions = firstString(advisory.patched_versions, advisory.patchedVersions);
  return {
    package: firstString(advisory.module_name, advisory.name, advisory.dependency),
    ecosystem: "npm",
    severity: normalizeSeverity(advisory.severity),
    ghsa,
    advisory_url: advisoryUrl,
    title: firstString(advisory.title, advisory.overview),
    vulnerable_versions: firstString(
      advisory.vulnerable_versions,
      advisory.range,
      advisory.versions,
    ),
    patched_versions: patchedVersions,
    patched: patchedFrom(patchedVersions),
    current_versions: uniq(
      asArray(advisory.findings).flatMap((finding) => asArray(findingFields(finding).version)),
    ),
    dependency_paths: uniq(
      asArray(advisory.findings).flatMap((finding) => asArray(findingFields(finding).paths)),
    ),
    manifest: "pnpm-lock.yaml",
    scope: "unknown",
  };
}

/** `fromVulnerability` が受け取る、パッケージの名前・vulnerabilities の 1 件・advisory を表す `via`・packages の欄。 */
interface VulnerabilitySource {
  packageName: string;
  vulnerability: AuditRecord;
  via: unknown;
  packages: Packages | undefined;
}

function fromVulnerability({
  packageName,
  vulnerability,
  via,
  packages,
}: VulnerabilitySource): Finding {
  const advisory = advisoryFromVia(via);
  const fix: AuditRecord = isObjectLike(vulnerability.fixAvailable)
    ? vulnerability.fixAvailable
    : {};
  const ghsa = ghsaOf(advisory);
  const patched = firstString(fix.version);
  const patchedVersions = firstString(
    advisory.patched_versions,
    advisory.patchedVersions,
    patched ? `>=${patched}` : "",
  );
  return {
    package: firstString(advisory.dependency, advisory.name, packageName),
    ecosystem: "npm",
    severity: normalizeSeverity(advisory.severity || vulnerability.severity),
    ghsa,
    advisory_url: firstString(advisory.url, ghsa ? `https://github.com/advisories/${ghsa}` : ""),
    title: firstString(advisory.title),
    vulnerable_versions: firstString(advisory.range, vulnerability.range),
    patched_versions: patchedVersions,
    patched: patched || patchedFrom(patchedVersions),
    current_versions: currentVersionsFrom(packageName, vulnerability, packages),
    dependency_paths: uniq(asArray(vulnerability.nodes)),
    manifest: "pnpm-lock.yaml",
    scope: "unknown",
  };
}

/**
 * 新しい形（`vulnerabilities` の 1 件）から finding を作る。advisory を表す `via` ごとに 1 件にし、
 * advisory を表す `via` が無ければ、パッケージの欄だけで 1 件にする。
 */
export function findingsFromVulnerability(
  packageName: string,
  vulnerability: AuditRecord,
  packages: Packages | undefined,
): Finding[] {
  const advisories = asArray(vulnerability.via).filter((via) => {
    if (typeof via === "object" && via) return true;
    return typeof via === "string" && isAdvisoryViaString(via);
  });
  if (advisories.length === 0) {
    return [fromVulnerability({ packageName, vulnerability, via: {}, packages })];
  }
  return advisories.map((via) => fromVulnerability({ packageName, vulnerability, via, packages }));
}

/** advisories・vulnerabilities・packages の欄の項目。欄が無い（null を含む）なら 0 件、object でなければ Error にする。 */
function entriesOf(value: unknown, name: string): [string, unknown][] {
  if (value === undefined || value === null) return [];
  if (!isRecord(value)) throw new Error(`${name} が object でない`);
  return Object.entries(value);
}

/**
 * 解析した JSON 全体から findings を作る。`package` の無いものは除き、同じ package と advisory の組はまとめる。
 * 形が違う入力は、読み飛ばすと advisory を警告なしに落とすので、どこが違うかを書いた Error を投げる（main が exit 1 にする）。
 * Error にするのは、object でない全体・欄（advisories・vulnerabilities・packages）・advisory・vulnerability と、
 * 読む packages の項目が object でないものである。
 */
export function normalizeAudit(raw: unknown): Finding[] {
  if (!isRecord(raw)) throw new Error("全体が object でない");
  const audit: AuditJson = raw;
  // packages は今の版を読むためだけに使う。欄の形はここで確かめ、項目の形は読むとき（packageVersion）に確かめる。
  entriesOf(audit.packages, "packages");
  const findings: Finding[] = [];

  for (const [id, advisory] of entriesOf(audit.advisories, "advisories")) {
    if (!isRecord(advisory)) throw new Error(`advisories.${id} が object でない`);
    findings.push(fromAdvisory(advisory));
  }

  for (const [packageName, vulnerability] of entriesOf(audit.vulnerabilities, "vulnerabilities")) {
    if (!isRecord(vulnerability))
      throw new Error(`vulnerabilities.${packageName} が object でない`);
    findings.push(...findingsFromVulnerability(packageName, vulnerability, audit.packages));
  }

  const merged = new Map<string, Finding>();
  for (const finding of findings.filter((item) => item.package)) {
    const key = findingKey(finding);
    const existing = merged.get(key);
    if (existing) mergeFinding(existing, finding);
    else merged.set(key, finding);
  }
  return [...merged.values()];
}

/** 引数が足りなければ 2、入力を読めないか形が違えば 1、書き出したら 0 を返す。 */
function main(argv: string[]): number {
  const [inputPath, outputPath] = argv;
  if (!inputPath || !outputPath) {
    console.error("Usage: normalize-pnpm-audit.ts <pnpm-audit.json> <findings.json>");
    return 2;
  }

  const raw = loadJson(inputPath);
  if (raw === undefined) return 1;

  let findings: Finding[];
  try {
    findings = normalizeAudit(raw);
  } catch (err) {
    console.error(`Failed to normalize pnpm audit JSON: ${inputPath}: ${errorMessage(err)}`);
    return 1;
  }
  writeFileSync(
    outputPath,
    `${JSON.stringify(
      {
        source: "pnpm-audit",
        generated_at: new Date().toISOString(),
        findings,
      },
      null,
      2,
    )}\n`,
  );
  return 0;
}

function isCliEntry(): boolean {
  if (!process.argv[1]) return false;
  try {
    return realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url));
  } catch (error) {
    console.error(`normalize-pnpm-audit: 起動パスを正規化できない: ${errorMessage(error)}`);
    process.exit(2);
  }
}

if (isCliEntry()) process.exit(main(process.argv.slice(2)));
