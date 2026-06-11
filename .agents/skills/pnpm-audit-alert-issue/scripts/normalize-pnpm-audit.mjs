#!/usr/bin/env node
import { readFileSync, writeFileSync } from "node:fs";

const [, , inputPath, outputPath] = process.argv;

if (!inputPath || !outputPath) {
  console.error("Usage: normalize-pnpm-audit.mjs <pnpm-audit.json> <findings.json>");
  process.exit(2);
}

function asArray(value) {
  if (!value) return [];
  return Array.isArray(value) ? value : [value];
}

function uniq(values) {
  return [...new Set(values.filter((value) => value !== undefined && value !== null && value !== ""))];
}

function firstString(...values) {
  for (const value of values) {
    if (typeof value === "string" && value.length > 0) return value;
  }
  return "";
}

function isUrl(value) {
  return typeof value === "string" && /^https?:\/\//.test(value);
}

function ghsaFrom(value) {
  if (typeof value !== "string") return "";
  const match = value.match(/GHSA-[0-9a-z]{4}-[0-9a-z]{4}-[0-9a-z]{4}/i);
  return match ? match[0].toUpperCase() : "";
}

function normalizeGhsa(value) {
  return ghsaFrom(value) || firstString(value);
}

function patchedFrom(range) {
  if (typeof range !== "string") return "";
  const match = range.match(/>=\s*([0-9][^\s|,]*)/);
  return match ? match[1] : "";
}

function normalizeSeverity(value) {
  const severity = String(value || "unknown").toLowerCase();
  return ["critical", "high", "moderate", "medium", "low"].includes(severity) ? severity : "unknown";
}

function findingKey(finding) {
  return [finding.package, finding.ghsa || finding.advisory_url || finding.title].join("\0");
}

function mergeStringValue(left, right) {
  const values = uniq(
    [left, right].flatMap((value) => (typeof value === "string" ? value.split(/\s*;\s*/) : [])),
  );
  return values.join("; ");
}

function mergeFinding(target, source) {
  target.current_versions = uniq([...target.current_versions, ...source.current_versions]);
  target.dependency_paths = uniq([...target.dependency_paths, ...source.dependency_paths]);
  target.vulnerable_versions = mergeStringValue(target.vulnerable_versions, source.vulnerable_versions);
  target.patched_versions = mergeStringValue(target.patched_versions, source.patched_versions);
  if (!target.patched && source.patched) target.patched = source.patched;
  if (!target.ghsa && source.ghsa) target.ghsa = source.ghsa;
  if (!target.advisory_url && source.advisory_url) target.advisory_url = source.advisory_url;
}

function advisoryFromVia(via) {
  if (typeof via === "object" && via) return via;
  if (typeof via !== "string") return {};

  const ghsa = ghsaFrom(via);
  if (!ghsa && !isUrl(via)) return {};

  return {
    ghsa,
    url: isUrl(via) ? via : "",
    title: ghsa || via,
  };
}

function currentVersionsFrom(packageName, vulnerability, packages) {
  const versions = [];
  for (const node of asArray(vulnerability.nodes)) {
    versions.push(packages?.[node]?.version);
  }
  versions.push(
    vulnerability.version,
    packages?.[packageName]?.version,
    packages?.[`node_modules/${packageName}`]?.version,
  );
  return uniq(versions);
}

function fromAdvisory(advisory) {
  const ghsa = firstString(
    normalizeGhsa(advisory.ghsa),
    normalizeGhsa(advisory.ghsa_id),
    normalizeGhsa(advisory.github_advisory_id),
    ghsaFrom(advisory.url),
    ghsaFrom(advisory.source),
    ghsaFrom(advisory.title),
  );
  const advisoryUrl = firstString(advisory.url, ghsa ? `https://github.com/advisories/${ghsa}` : "");
  const patchedVersions = firstString(advisory.patched_versions, advisory.patchedVersions);
  return {
    package: firstString(advisory.module_name, advisory.name, advisory.dependency),
    ecosystem: "npm",
    severity: normalizeSeverity(advisory.severity),
    ghsa,
    advisory_url: advisoryUrl,
    title: firstString(advisory.title, advisory.overview),
    vulnerable_versions: firstString(advisory.vulnerable_versions, advisory.range, advisory.versions),
    patched_versions: patchedVersions,
    patched: patchedFrom(patchedVersions),
    current_versions: uniq(asArray(advisory.findings).flatMap((finding) => asArray(finding.version))),
    dependency_paths: uniq(asArray(advisory.findings).flatMap((finding) => asArray(finding.paths))),
    manifest: "pnpm-lock.yaml",
    scope: "unknown",
  };
}

function fromVulnerability(packageName, vulnerability, via, packages) {
  const advisory = advisoryFromVia(via);
  const fix = typeof vulnerability.fixAvailable === "object" && vulnerability.fixAvailable ? vulnerability.fixAvailable : {};
  const ghsa = firstString(
    normalizeGhsa(advisory.ghsa),
    normalizeGhsa(advisory.ghsa_id),
    normalizeGhsa(advisory.github_advisory_id),
    ghsaFrom(advisory.url),
    ghsaFrom(advisory.source),
    ghsaFrom(advisory.title),
  );
  const patched = firstString(fix.version);
  const patchedVersions = firstString(advisory.patched_versions, advisory.patchedVersions, patched ? `>=${patched}` : "");
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

const raw = JSON.parse(readFileSync(inputPath, "utf8"));
const findings = [];

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

const merged = new Map();
for (const finding of findings.filter((item) => item.package)) {
  const key = findingKey(finding);
  if (merged.has(key)) mergeFinding(merged.get(key), finding);
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
