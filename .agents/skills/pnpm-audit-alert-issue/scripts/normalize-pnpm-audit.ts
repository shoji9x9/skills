#!/usr/bin/env node
import { readFileSync, writeFileSync } from "node:fs";

const [, , inputPath, outputPath] = process.argv;

// pnpm audit の JSON は版で形が変わるので、各フィールドは unknown として読み、使うところで確かめる。
type AuditRecord = Record<string, unknown>;
type Packages = Record<string, { version?: unknown } | undefined>;
type AuditJson = {
  advisories?: Record<string, AuditRecord>;
  vulnerabilities?: Record<string, AuditRecord>;
  packages?: Packages;
};

/** 出力する 1 件の finding（dependabot-alert-issue の外部 audit findings の形）。 */
type Finding = {
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

if (!inputPath || !outputPath) {
  console.error("Usage: normalize-pnpm-audit.ts <pnpm-audit.json> <findings.json>");
  process.exit(2);
}

/**
 * JSON の文字列を、`T` の形として読む（形は検証しない）。private skill はスキルの中で完結させるので、
 * `scripts/lib/parse-as.ts` を import せず、同じ helper をここに持つ。
 */
function parseJsonAs<T>(text: string): T {
  const value: unknown = JSON.parse(text);
  // oxlint-disable-next-line typescript/consistent-type-assertions -- 外部の入力の形を宣言する。欄は使うところで確かめる
  return value as T;
}

function loadJson(path: string): AuditJson {
  let text: string;
  try {
    text = readFileSync(path, "utf8");
  } catch (err) {
    console.error(
      `Failed to read pnpm audit JSON: ${path}: ${err instanceof Error ? err.message : String(err)}`,
    );
    process.exit(1);
  }

  if (text.trim() === "") {
    console.error(`Failed to parse pnpm audit JSON: ${path} is empty`);
    process.exit(1);
  }

  try {
    return parseJsonAs<AuditJson>(text);
  } catch (err) {
    console.error(
      `Failed to parse pnpm audit JSON: ${path}: ${err instanceof Error ? err.message : String(err)}`,
    );
    process.exit(1);
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
  return Array.isArray(value) ? value : [value];
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

function ghsaFrom(value: unknown): string {
  if (typeof value !== "string") return "";
  const match = value.match(/GHSA-[0-9a-z]{4}-[0-9a-z]{4}-[0-9a-z]{4}/i);
  return match ? match[0].toUpperCase() : "";
}

function normalizeGhsa(value: unknown): string {
  return ghsaFrom(value) || firstString(value);
}

function patchedFrom(range: unknown): string {
  if (typeof range !== "string") return "";
  const match = range.match(/>=\s*([0-9][^\s|,]*)/);
  return match ? match[1] : "";
}

function normalizeSeverity(value: unknown): string {
  const severity = String(value || "unknown").toLowerCase();
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

  const ghsa = ghsaFrom(via);
  if (!ghsa && !isUrl(via)) return {};

  return {
    ghsa,
    url: isUrl(via) ? via : "",
    title: ghsa || via,
  };
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
    versions.push(packages?.[String(node)]?.version);
  }
  versions.push(
    vulnerability.version,
    packages?.[packageName]?.version,
    packages?.[`node_modules/${packageName}`]?.version,
  );
  return uniq(versions);
}

function fromAdvisory(advisory: AuditRecord): Finding {
  const ghsa = firstString(
    normalizeGhsa(advisory.ghsa),
    normalizeGhsa(advisory.ghsa_id),
    normalizeGhsa(advisory.github_advisory_id),
    ghsaFrom(advisory.url),
    ghsaFrom(advisory.source),
    ghsaFrom(advisory.title),
  );
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

function fromVulnerability(
  packageName: string,
  vulnerability: AuditRecord,
  via: unknown,
  packages: Packages | undefined,
): Finding {
  const advisory = advisoryFromVia(via);
  const fix: AuditRecord = isObjectLike(vulnerability.fixAvailable)
    ? vulnerability.fixAvailable
    : {};
  const ghsa = firstString(
    normalizeGhsa(advisory.ghsa),
    normalizeGhsa(advisory.ghsa_id),
    normalizeGhsa(advisory.github_advisory_id),
    ghsaFrom(advisory.url),
    ghsaFrom(advisory.source),
    ghsaFrom(advisory.title),
  );
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

const raw = loadJson(inputPath);
const findings: Finding[] = [];

if (raw.advisories && typeof raw.advisories === "object") {
  for (const advisory of Object.values(raw.advisories)) {
    findings.push(fromAdvisory(advisory));
  }
}

if (raw.vulnerabilities && typeof raw.vulnerabilities === "object") {
  for (const [packageName, vulnerability] of Object.entries(raw.vulnerabilities)) {
    const advisories = asArray(vulnerability.via).filter((via) => {
      if (typeof via === "object" && via) return true;
      return typeof via === "string" && (ghsaFrom(via) || isUrl(via));
    });
    if (advisories.length === 0) {
      findings.push(fromVulnerability(packageName, vulnerability, {}, raw.packages));
    } else {
      for (const advisory of advisories) {
        findings.push(fromVulnerability(packageName, vulnerability, advisory, raw.packages));
      }
    }
  }
}

const merged = new Map<string, Finding>();
for (const finding of findings.filter((item) => item.package)) {
  const key = findingKey(finding);
  const existing = merged.get(key);
  if (existing) mergeFinding(existing, finding);
  else merged.set(key, finding);
}

writeFileSync(
  outputPath,
  `${JSON.stringify(
    {
      source: "pnpm-audit",
      generated_at: new Date().toISOString(),
      findings: [...merged.values()],
    },
    null,
    2,
  )}\n`,
);
