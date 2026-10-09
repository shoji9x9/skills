// parity-suite の perf-stats.mjs summarize --write は、下限の履歴を書く。
// その変更を replace-strategy の append-only-check.mjs が正規の変更として通すかを、
// 両方の CLI を同じ git リポジトリに当てて確かめる（Issue #582）。
//
// 書き手（summarize）と読み手（append-only の一覧の pinned_values）は別のスキルにあり、履歴のキーパスや
// 要素の項目名（floors・relative_floors）がどちらか片方だけ変わると、正規の採り直しが落ちるか、手で緩めた下限が通る。
// 片方のテストだけでは、この食い違いを検出できない。
import { test, expect } from "vitest";
import { spawnSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { makeTempDir } from "../../lib/test-tmpdir.js";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const perfStats = join(repoRoot, "skills/parity-suite/scripts/perf-stats.mjs");
const appendOnly = join(repoRoot, "skills/replace-strategy/scripts/append-only-check.mjs");

const META = ".replace/parity/demo/metadata.json";
const SAMPLES = ".replace/parity/demo/perf-samples.json";

const capture = {
  pages: [{ name: "top", path: "" }],
  viewports: [{ label: "desktop", width: 1280, height: 800 }],
};

const metadata = {
  slug: "demo",
  mode: "feature",
  capture_conditions: capture,
  unmeasured: { declared: true, entries: [], reason: null },
};

/** perf-capture.spec.template.ts が書く形の採取（1 組 × 5 回）。 */
const samples = {
  version: "1",
  side: "current",
  slug: "demo",
  target: null,
  measured_at: "2026-10-08T00:00:00.000Z",
  environment: {
    browser_name: "chromium",
    browser_version: "153.0.8010.12",
    channel: null,
    headless: true,
    runner: { platform: "linux", arch: "x64", cpu_model: "cpu", cpu_count: 8 },
    target_placement: "loopback",
    context_options: {},
    launch_options: {},
  },
  settings: { runs: 5, warmup: 1, settle_ms: 1000, cache: "cold", workers: 1 },
  capture,
  samples: [500, 510, 520, 530, 540].map((lcp, i) => ({
    page: "top",
    viewport: "desktop",
    run: i + 1,
    lcp,
    cls: 0,
    tbt: 0,
    ttfb: 10,
  })),
};

/**
 * @param {string} root
 * @param {string[]} args
 */
function git(root, args) {
  const r = spawnSync("git", ["-C", root, ...args], { encoding: "utf8" });
  if (r.status !== 0) throw new Error(`git ${args.join(" ")} failed: ${r.stderr}`);
}

/**
 * @param {string} root
 * @param {string[]} floors
 */
function summarize(root, floors = []) {
  const r = spawnSync(
    process.execPath,
    [perfStats, "summarize", "--metadata", META, "--samples", SAMPLES, "--write", ...floors],
    { cwd: root, encoding: "utf8" },
  );
  expect(r.stderr).toBe("");
  expect(r.status).toBe(0);
}

/** @param {string} root */
function appendOnlyCheck(root) {
  const r = spawnSync(process.execPath, [appendOnly, "--root", root], { encoding: "utf8" });
  return { status: r.status, stdout: r.stdout, stderr: r.stderr };
}

/** 集計済みの基準を commit したリポジトリを作る。 */
function makeRepo() {
  const root = makeTempDir("perf-floor-history-");
  mkdirSync(join(root, ".replace/parity/demo"), { recursive: true });
  writeFileSync(join(root, META), `${JSON.stringify(metadata, null, 2)}\n`);
  writeFileSync(join(root, SAMPLES), `${JSON.stringify(samples, null, 2)}\n`);
  git(root, ["init", "-q", "."]);
  git(root, ["config", "user.email", "test@example.com"]);
  git(root, ["config", "user.name", "test"]);
  summarize(root);
  git(root, ["add", "-A"]);
  git(root, ["commit", "-qm", "baseline"]);
  return root;
}

test("同梱の一覧の pinned_values は、parity-suite の metadata の雛形に実在するパスを指す", () => {
  // 一覧のパスを綴り違えると、比較元も現在も undefined になって固定が警告なしに無効になる。
  // 書き手の原本（雛形）の形に当たることを確かめる
  const manifest = JSON.parse(
    readFileSync(
      join(repoRoot, "skills/replace-strategy/assets/append-only-manifest.json"),
      "utf8",
    ),
  );
  const template = JSON.parse(
    readFileSync(join(repoRoot, "skills/parity-suite/assets/metadata-template.json"), "utf8"),
  );
  const at = (doc, path) =>
    path.split(".").reduce((v, k) => (v !== null && typeof v === "object" ? v[k] : undefined), doc);
  const groups = manifest.artifacts
    .filter((a) => a.pattern === ".replace/parity/*/metadata.json")
    .flatMap((a) => a.pinned_values ?? []);
  expect(groups.length).toBeGreaterThan(0);
  for (const group of groups) {
    for (const path of group.paths) expect(at(template, path), path).toBeDefined();
    expect(Array.isArray(at(template, group.history)), group.history).toBe(true);
  }
});

test("summarize --write で下限を変えた採り直しは、append-only チェックを通る", () => {
  const root = makeRepo();
  summarize(root, ["--floor", "lcp=150", "--relative-floor", "ttfb=0.3"]);
  const r = appendOnlyCheck(root);
  expect(r.stdout).toMatch(/^ok: /m);
  expect(r.status).toBe(0);
  const perf = JSON.parse(readFileSync(join(root, META), "utf8")).performance;
  expect(perf.floor_history).toHaveLength(2);
});

test("summarize --write で下限を変えない採り直しも通る", () => {
  const root = makeRepo();
  summarize(root);
  const r = appendOnlyCheck(root);
  expect(r.stdout).toMatch(/^ok: /m);
  expect(r.status).toBe(0);
});

test("手で書き換えた下限に、同じ値で summarize --write を通し直せば通る", () => {
  // 書き手が作業ツリーの前の値と比べると追記されず、正規の書き手でチェックを通せない状態が残る
  const root = makeRepo();
  const doc = JSON.parse(readFileSync(join(root, META), "utf8"));
  doc.performance.floors.lcp = 150;
  writeFileSync(join(root, META), `${JSON.stringify(doc, null, 2)}\n`);
  expect(appendOnlyCheck(root).status).toBe(1);
  summarize(root, ["--floor", "lcp=150"]);
  const r = appendOnlyCheck(root);
  expect(r.stdout).toMatch(/^ok: /m);
  expect(r.status).toBe(0);
});

test("--floor を省いて採り直しても、前に決めた下限は変わらない", () => {
  const root = makeRepo();
  summarize(root, ["--floor", "lcp=50"]);
  git(root, ["commit", "-qam", "tighten"]);
  summarize(root);
  const perf = JSON.parse(readFileSync(join(root, META), "utf8")).performance;
  expect(perf.floors.lcp).toBe(50);
  expect(appendOnlyCheck(root).status).toBe(0);
});

test("summarize を通さずに下限を手で緩めた変更は、append-only チェックが exit 1 にする", () => {
  const root = makeRepo();
  const doc = JSON.parse(readFileSync(join(root, META), "utf8"));
  doc.performance.floors.lcp = 1000;
  writeFileSync(join(root, META), `${JSON.stringify(doc, null, 2)}\n`);
  const r = appendOnlyCheck(root);
  expect(r.stdout).toMatch(/performance\.floors が performance\.floor_history への追記なしに/);
  expect(r.status).toBe(1);
});
