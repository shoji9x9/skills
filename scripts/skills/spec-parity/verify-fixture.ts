// spec-parity verify の判定のテストが共有する、メモリ上のファイルと、収束する状態の成果物一式。
// 成果物の形は、同梱の雛形（skills/spec-parity/assets/ の metadata-template.json・verify-metadata-template.json）に合わせる。
// e2e の結果の JSON は、e2e 0.23.0 の `.e2e/report.json` で確かめた形（schemaVersion: report-1）に合わせる。

import { parseJsonAs } from "../../lib/parse-as.ts";

export const SLUG_DIR = ".replace/parity/orders";
export const NEW_DIR = `${SLUG_DIR}/new/stg`;
export const VERIFY = `${NEW_DIR}/verify-metadata.json`;
export const COMMIT = "0123456789abcdef0123456789abcdef01234567";

const NARROW = { width: 375, height: 800 };
const WIDE = { width: 1280, height: 720 };
const PAGES = ["/orders"];

export const LIST = "tests/orders/list.e2e.ts › 一覧を開く";
export const EDIT = "tests/orders/list.e2e.ts › 編集する";

type Io = {
  cwd: string;
  readFile: (p: string) => string;
  writeFile: (p: string, s: string) => void;
  exists: (p: string) => boolean;
  stdout: (s: string) => void;
  stderr: (s: string) => void;
};

/** メモリ上のファイル。パスは /repo からの相対で持つ。 */
export class Fs {
  files = new Map<string, string>();
  writes: string[] = [];
  put(path: string, value: unknown) {
    this.files.set(path, typeof value === "string" ? value : JSON.stringify(value));
  }
  json<T>(path: string): T {
    const v = this.files.get(path);
    if (v === undefined) throw new Error(`無い: ${path}`);
    return parseJsonAs<T>(v);
  }
  remove(path: string) {
    this.files.delete(path);
  }
  /** main に渡す入出力と、書かれた stdout・stderr。 */
  io(): { io: Io; out: { stdout: string; stderr: string } } {
    const out = { stdout: "", stderr: "" };
    const rel = (p: string) => p.replace(/^\/repo\//, "");
    const io: Io = {
      cwd: "/repo",
      readFile: (p) => {
        const v = this.files.get(rel(p));
        if (v === undefined) throw new Error(`ENOENT: ${p}`);
        return v;
      },
      writeFile: (p, s) => {
        this.writes.push(rel(p));
        this.files.set(rel(p), s);
      },
      exists: (p) => this.files.has(rel(p)),
      stdout: (s) => {
        out.stdout += s;
      },
      stderr: (s) => {
        out.stderr += s;
      },
    };
    return { io, out };
  }
}

type Result = { file: string; title: string; status: string; selected?: boolean };

/** e2e の結果の JSON。title は「›」で区切った describe からテストまでの名前。 */
export function report(targetId: string, results: Result[]) {
  return {
    schemaVersion: "report-1",
    run: {
      status: results.every((r) => r.status === "passed") ? "passed" : "failed",
      results: [
        // 選ばれなかった target の結果も、selected: false で入る
        {
          file: "tests/orders/list.e2e.ts",
          titlePath: ["一覧を開く"],
          targetId: "other",
          selected: false,
          status: "skipped",
        },
        ...results.map((r) => ({
          file: r.file,
          titlePath: r.title.split(" › "),
          targetId,
          selected: r.selected ?? true,
          status: r.status,
          attempts: [],
        })),
      ],
    },
  };
}

const passing = (targetId: string) =>
  report(targetId, [
    { file: "tests/orders/list.e2e.ts", title: "一覧を開く", status: "passed" },
    { file: "tests/orders/list.e2e.ts", title: "編集する", status: "passed" },
  ]);

/** 現側の操作中のエラーの基準（runtime-errors.mjs summarize が書く形の、署名が 0 件のもの）。 */
const runtimeBaseline = () => ({
  declared: true,
  tool_version: "1",
  runs: 2,
  run_dirs: [`${SLUG_DIR}/runtime-errors/run-1`, `${SLUG_DIR}/runtime-errors/run-2`],
  tests: [
    { test: LIST, skipped: false },
    { test: EDIT, skipped: false },
  ],
  signatures: [],
});

export const suiteMetadata = (over: Record<string, unknown> = {}) => ({
  slug: "orders",
  style_policy: "free",
  mode: "feature",
  suite: { runner: "e2e", current_green: true, dir: "tests/orders/" },
  strength: { validated: true },
  capture_conditions: { pages: PAGES, viewports: [NARROW, WIDE] },
  runtime_errors: runtimeBaseline(),
  ...over,
});

export const overflowRecords = (over: Record<string, unknown> = {}) => ({
  version: "1",
  side: "new",
  slug: "orders",
  target: "stg",
  commit: COMMIT,
  records: [NARROW, WIDE].map((viewport) => ({
    page: "/orders",
    viewport,
    inner_width: viewport.width,
    client_width: viewport.width,
    scroll_width: viewport.width,
  })),
  ...over,
});

/** compare が書く、通った比較の結果。 */
export const comparedOk = () => ({
  tool: "runtime-errors",
  version: "1",
  judged: true,
  ok: true,
  runs: 2,
  counts: { new_signatures: 0, actionable: 0, explained: 0, unexplained: 0 },
  missing_tests: [],
  failed_tests: [],
  extra_tests: [],
  skipped_tests: [],
  current_skipped_tests: [],
  new_signatures: [],
});

export const verifyMetadata = (over: Record<string, unknown> = {}) => ({
  slug: "orders",
  target: "stg",
  style_policy: "free",
  new: { commit: COMMIT },
  suite: { commit: COMMIT, report: `${NEW_DIR}/suite-report.json` },
  runtime_errors: comparedOk(),
  design_review: {
    source: "bundled",
    commit: COMMIT,
    completed_at: "2026-11-11T00:00:00Z",
    pages_reviewed: PAGES,
    findings: [
      {
        id: "dr-1",
        rule: "focus-visible",
        page: "/orders",
        summary: "焦点の輪が薄い",
        decision: "accept",
        approval: {
          approved_by: "owner",
          approved_at: "2026-11-11T01:00:00Z",
          reason: "社内の規定の色",
        },
      },
    ],
  },
  human_review: {
    commit: COMMIT,
    screens: [
      { page: "/orders", viewport: NARROW, screenshot: `${NEW_DIR}/review/orders-375.png` },
    ],
    approval: {
      verdict: "approved",
      approved_by: "owner",
      approved_at: "2026-11-11T02:00:00Z",
      notes: "",
    },
  },
  unverified: [
    { item: "performance", reason: "性能の比較は Playwright の採取を前提にしているので確かめない" },
  ],
  pending_decisions: [],
  run: { autonomous: false },
  converged: false,
  ...over,
});

/** 収束する状態の成果物一式を置く。 */
export function convergedFs(): Fs {
  const fs = new Fs();
  fs.put(`${SLUG_DIR}/metadata.json`, suiteMetadata());
  fs.put(`${SLUG_DIR}/suite-report.json`, passing("current"));
  fs.put(`${NEW_DIR}/replace-metadata.json`, {
    suite: { new_green: true },
    new: { target: "stg" },
  });
  fs.put(`${NEW_DIR}/suite-report.json`, passing("new"));
  fs.put(`${NEW_DIR}/overflow.json`, overflowRecords());
  fs.put(VERIFY, verifyMetadata());
  return fs;
}
