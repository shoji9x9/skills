// parity-suite の操作中のエラーの集計と比較（runtime-errors.mjs）の回帰テスト（Issue #929）。
//
// 起こりうる不具合は「新側だけのエラーを通す」「現行にもあったエラーを差分にする」「判定できない入力を合格にする」の 3 つ。
// わざとエラーと失敗したリクエストを起こした記録（新側だけ・両側・回によって出る・別のテスト）を fixture にし、
// 落とす入力と同じ数だけ通る入力を置く。
// main は子プロセスを起動せず、メモリ上のファイルで直接呼ぶ（ミューテーションテストの 1 変異あたりの時間を抑える）。
// spec-parity は同じ中身の runtime-errors.mjs を同梱するので（Issue #565。一致は identical-copies.json の組が確かめる）、
// 同じテストを両方のコピーで実行する。runtime-errors.mutations.json の expect_failing は、parity-suite のコピーのテストの名前を指す。

import { describe, expect, test } from "vitest";
import * as paritySuite from "../../../../skills/parity-suite/scripts/runtime-errors.mjs";
import * as specParity from "../../../../skills/spec-parity/scripts/runtime-errors.mjs";
import { parseJsonAs } from "../../../lib/parse-as.ts";

const COPIES = [
  { skill: "parity-suite", lib: paritySuite },
  { skill: "spec-parity", lib: specParity },
];

describe.each(COPIES)("$skill の runtime-errors.mjs", ({ lib }) => {
  const { main, normalizeText, normalizeUrl, signatureOf } = lib;

  type Event = {
    kind: string;
    page: string;
    text: string;
    method?: string;
    url?: string;
    status?: number;
  };

  type Record_ = {
    test: string;
    status?: string;
    events: Event[];
    side?: string;
    slug?: string;
    target?: string | null;
    run?: number;
    version?: string;
  };

  type Signature = {
    test: string;
    id: string;
    kind: string;
    page: string;
    url: string | null;
    text: string;
    seen_runs: number;
    state?: string;
    classification?: string | null;
    reason?: string | null;
    approved_at?: string | null;
    evidence?: string | null;
  };

  type Written = {
    runtime_errors: {
      ok?: boolean;
      signatures: Signature[];
      new_signatures: Signature[];
      tests: { test: string; skipped: boolean }[];
      counts: Record<string, number>;
      missing_tests: string[];
      failed_tests: string[];
      extra_tests: string[];
      skipped_tests: string[];
      current_skipped_tests: string[];
      [key: string]: unknown;
    };
  };

  const META = ".replace/parity/demo/metadata.json";
  const DIFF = ".replace/parity/demo/new/stg/diff-metadata.json";
  const curRun = (n: number) => `.replace/parity/demo/runtime-errors/run-${n}`;
  const newRun = (n: number) => `.replace/parity/demo/new/stg/runtime-errors/run-${n}`;

  const LIST = "orders.spec.ts › 一覧を開く";
  const EDIT = "orders.spec.ts › 編集する";

  // 現行にもある不具合。新側はホスト・ポート・クエリ・採番した数字が違っても同じ署名になる
  const commonOn = (origin: string, id: number): Event[] => [
    {
      kind: "pageerror",
      page: `${origin}/orders/${id}`,
      text: "TypeError: x is undefined at line 12",
    },
    {
      kind: "http-error",
      page: `${origin}/orders/${id}`,
      text: "Not Found",
      method: "get",
      url: `${origin}/api/orders/${id}?t=${id * 7}`,
      status: 404,
    },
    {
      kind: "console-error",
      page: `${origin}/orders/${id}`,
      text: `Failed to load resource: ${origin}/api/orders/${id}?x=1 404`,
    },
  ];

  // わざと起こす新側だけの不具合（4 種類）
  const NEW_ONLY: Event[] = [
    {
      kind: "pageerror",
      page: "http://new:8080/orders/1",
      text: "ReferenceError: foo is not defined",
    },
    { kind: "console-error", page: "http://new:8080/orders/1", text: "new-only console error" },
    {
      kind: "requestfailed",
      page: "http://new:8080/orders/1",
      text: "net::ERR_FAILED",
      method: "POST",
      url: "http://new:8080/api/save",
    },
    {
      kind: "http-error",
      page: "http://new:8080/orders/1",
      text: "Internal Server Error",
      method: "GET",
      url: "http://new:8080/api/summary",
      status: 500,
    },
  ];

  // 記録のファイル名。テスト名を 16 進にする（日本語のテスト名どうしで同じ名前にしない）
  const fileOf = (test: string) => `${Buffer.from(test).toString("hex")}.json`;

  /** 記録を置く実行（ディレクトリ・回・側） */
  type At = { dir: string; run: number; side: "current" | "new" };
  const cur = (n: number): At => ({ dir: curRun(n), run: n, side: "current" });
  const neu = (n: number): At => ({ dir: newRun(n), run: n, side: "new" });

  class Fs {
    files = new Map<string, string>();
    writes: string[] = [];
    put(path: string, value: unknown) {
      this.files.set(path, typeof value === "string" ? value : JSON.stringify(value));
    }
    record({ dir, run, side }: At, r: Record_) {
      this.put(`${dir}/${fileOf(r.test)}`, {
        version: "1",
        side,
        slug: "demo",
        target: side === "new" ? "stg" : null,
        run,
        status: "passed",
        ...r,
      });
    }
    read<T>(path: string): T {
      const text = this.files.get(path);
      if (text === undefined) throw new Error(`no file ${path}`);
      return parseJsonAs<T>(text);
    }
    run(argv: string[]) {
      let stderr = "";
      let stdout = "";
      const code = main(argv, {
        cwd: "/repo",
        readFile: (p) => {
          const text = this.files.get(p.replace(/^\/repo\//, ""));
          if (text === undefined) throw new Error(`ENOENT ${p}`);
          return text;
        },
        writeFile: (p, s) => {
          const path = p.replace(/^\/repo\//, "");
          this.writes.push(path);
          this.files.set(path, s);
        },
        readDir: (p) => {
          const dir = `${p.replace(/^\/repo\//, "")}/`;
          const names = [...this.files.keys()]
            .filter((k) => k.startsWith(dir) && !k.slice(dir.length).includes("/"))
            .map((k) => k.slice(dir.length));
          if (names.length === 0 && ![...this.files.keys()].some((k) => k.startsWith(dir)))
            throw new Error(`ENOENT ${p}`);
          return names;
        },
        stdout: (s) => {
          stdout += s;
        },
        stderr: (s) => {
          stderr += s;
        },
      });
      return { code, stderr, stdout };
    }
  }

  /** 現側を 2 回記録して summarize を通した状態を作る。flaky は 1 回目だけに出る */
  function withBaseline(opts: { flaky?: Event[]; skippedEdit?: boolean } = {}): Fs {
    const fs = new Fs();
    fs.put(META, { slug: "demo", mode: "feature" });
    fs.put(DIFF, { slug: "demo" });
    for (const n of [1, 2]) {
      const events = [
        ...commonOn("http://current", 100 + n),
        ...(n === 1 ? (opts.flaky ?? []) : []),
      ];
      fs.record(cur(n), { test: LIST, events });
      fs.record(cur(n), {
        test: EDIT,
        events: [],
        status: opts.skippedEdit ? "skipped" : "passed",
      });
    }
    const r = fs.run([
      "summarize",
      "--metadata",
      META,
      "--run",
      curRun(1),
      "--run",
      curRun(2),
      "--write",
    ]);
    expect(r.stderr).toBe("");
    expect(r.code).toBe(0);
    return fs;
  }

  /** 新側を 2 回記録する */
  function recordNew(fs: Fs, perRun: (n: number) => Record_[]) {
    for (const n of [1, 2]) for (const r of perRun(n)) fs.record(neu(n), r);
  }

  function compare(fs: Fs, extra: string[] = ["--write", DIFF]) {
    return fs.run([
      "compare",
      "--metadata",
      META,
      "--target",
      "stg",
      "--run",
      newRun(1),
      "--run",
      newRun(2),
      ...extra,
    ]);
  }

  const byText = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

  const errorsOf = (fs: Fs) => fs.read<Written>(DIFF).runtime_errors;

  describe("正規化", () => {
    test("オリジン・クエリ・フラグメントを捨て、数字の連なりを <n> にする", () => {
      expect(normalizeUrl("http://a.example:8080/api/orders/123?x=1#h")).toBe("/api/orders/<n>");
      expect(normalizeUrl("/api/x?y")).toBe("/api/x");
      expect(normalizeText("Failed  http://h:1/a/22?q=9 code 404\n at x")).toBe(
        "Failed /a/<n> code <n> at x",
      );
    });

    test("種類・path・状態コード・本文のどれかが違えば、別の署名になる", () => {
      const base = {
        kind: "http-error",
        page: "/p",
        text: "x",
        method: "GET",
        url: "/a",
        status: 404,
      };
      const id = signatureOf(base).id;
      expect(signatureOf({ ...base, kind: "requestfailed" }).id).not.toBe(id);
      expect(signatureOf({ ...base, url: "/b" }).id).not.toBe(id);
      expect(signatureOf({ ...base, page: "/q" }).id).not.toBe(id);
      expect(signatureOf({ ...base, status: 500 }).id).not.toBe(id);
      expect(signatureOf({ ...base, text: "y" }).id).not.toBe(id);
      expect(signatureOf({ ...base, method: "get" }).id).toBe(id);
    });
  });

  const SUMMARIZE_USAGE_CASES: [string, (fs: Fs) => void, string[]?][] = [
    ["1 回だけ", () => {}, ["--run", curRun(1)]],
    ["同じ回", () => {}, ["--run", curRun(1), "--run", `./${curRun(1)}`]],
    ["絶対パス", () => {}, ["--run", "/x/run-1", "--run", curRun(2)]],
    ["..", () => {}, ["--run", "../run-1", "--run", curRun(2)]],
    ["名前", () => {}, ["--run", ".replace/parity/demo/runtime-errors/first", "--run", curRun(2)]],
    ["空の実行", (fs) => fs.files.delete(`${curRun(2)}/${fileOf(LIST)}`)],
    ["side", (fs) => fs.record(cur(2), { test: LIST, events: [], side: "new" })],
    ["slug", (fs) => fs.record(cur(2), { test: LIST, events: [], slug: "other" })],
    ["target", (fs) => fs.record(cur(2), { test: LIST, events: [], target: "stg" })],
    ["run", (fs) => fs.record(cur(2), { test: LIST, events: [], run: 1 })],
    ["version", (fs) => fs.record(cur(2), { test: LIST, events: [], version: "0" })],
    ["status", (fs) => fs.record(cur(2), { test: LIST, events: [], status: "ok" })],
    ["test", (fs) => fs.record(cur(2), { test: " ", events: [] })],
    [
      "kind",
      (fs) => fs.record(cur(2), { test: LIST, events: [{ kind: "warn", page: "/", text: "" }] }),
    ],
    [
      "url",
      (fs) =>
        fs.record(cur(2), {
          test: LIST,
          events: [{ kind: "requestfailed", page: "/", text: "", method: "GET" }],
        }),
    ],
    [
      "status 範囲",
      (fs) =>
        fs.record(cur(2), {
          test: LIST,
          events: [
            { kind: "http-error", page: "/", text: "", method: "GET", url: "/a", status: 302 },
          ],
        }),
    ],
    [
      "同じテスト 2 件",
      (fs) => fs.put(`${curRun(2)}/dup.json`, fs.files.get(`${curRun(2)}/${fileOf(LIST)}`)),
    ],
    ["JSON でない", (fs) => fs.put(`${curRun(2)}/bad.json`, "{")],
  ];

  describe("summarize", () => {
    test("テストごとの署名と、出た回数を metadata.json に書く", () => {
      const fs = withBaseline({
        flaky: [{ kind: "console-error", page: "http://current/orders/1", text: "flaky" }],
      });
      const base = fs.read<Written>(META).runtime_errors;
      expect(base.tests).toEqual(
        [
          { test: LIST, skipped: false },
          { test: EDIT, skipped: false },
        ].sort((a, b) => (a.test < b.test ? -1 : 1)),
      );
      expect(base.signatures.map((s) => [s.kind, s.seen_runs].join(":")).sort(byText)).toEqual(
        ["console-error:1", "console-error:2", "http-error:2", "pageerror:2"].sort(byText),
      );
    });

    test("--write が無ければ metadata.json を書かない", () => {
      const fs = new Fs();
      fs.put(META, { slug: "demo" });
      for (const n of [1, 2]) fs.record(cur(n), { test: LIST, events: [] });
      const r = fs.run(["summarize", "--metadata", META, "--run", curRun(1), "--run", curRun(2)]);
      expect(r.code).toBe(0);
      expect(fs.writes).toEqual([]);
    });

    test("現側で通らなかったテスト・一部の実行にしか無いテスト・回でスキップが変わるテストは exit 1", () => {
      const cases: [string, (fs: Fs) => void][] = [
        [
          "failed",
          (fs) => {
            for (const n of [1, 2]) fs.record(cur(n), { test: EDIT, events: [], status: "failed" });
          },
        ],
        ["一部", (fs) => fs.files.delete(`${curRun(2)}/${fileOf(EDIT)}`)],
        ["skip", (fs) => fs.record(cur(2), { test: EDIT, events: [], status: "skipped" })],
      ];
      for (const [label, mutate] of cases) {
        const fs = new Fs();
        fs.put(META, { slug: "demo" });
        for (const n of [1, 2]) {
          fs.record(cur(n), { test: LIST, events: [] });
          fs.record(cur(n), { test: EDIT, events: [] });
        }
        mutate(fs);
        const r = fs.run([
          "summarize",
          "--metadata",
          META,
          "--run",
          curRun(1),
          "--run",
          curRun(2),
          "--write",
        ]);
        expect(r.code, label).toBe(1);
        expect(fs.writes, label).toEqual([]);
      }
    });

    test.each(SUMMARIZE_USAGE_CASES)(
      "%s（回数・ディレクトリ・記録の形の誤り）は exit 2",
      (label, mutate, runs) => {
        const valid = (fs: Fs) => {
          fs.put(META, { slug: "demo" });
          for (const n of [1, 2]) fs.record(cur(n), { test: LIST, events: [] });
        };
        const fs = new Fs();
        valid(fs);
        mutate(fs);
        const r = fs.run([
          "summarize",
          "--metadata",
          META,
          ...(runs ?? ["--run", curRun(1), "--run", curRun(2)]),
          "--write",
        ]);
        expect(r.code, label).toBe(2);
        expect(fs.writes, label).toEqual([]);
      },
    );
  });

  const COMPARE_USAGE_CASES: [string, (fs: Fs) => void, string[]?][] = [
    ["基準なし", (fs) => fs.put(META, { slug: "demo" })],
    [
      "declared false",
      (fs) =>
        fs.put(META, {
          slug: "demo",
          runtime_errors: { ...fs.read<Written>(META).runtime_errors, declared: false },
        }),
    ],
    [
      "id の書き換え",
      (fs) => {
        const doc = fs.read<Written>(META);
        const first = doc.runtime_errors.signatures[0];
        if (first) first.text = "書き換えた本文";
        fs.put(META, doc);
      },
    ],
    [
      "tests に無い test",
      (fs) => {
        const doc = fs.read<Written>(META);
        const first = doc.runtime_errors.signatures[0];
        if (first) first.test = "無い.spec.ts › x";
        fs.put(META, doc);
      },
    ],
    [
      "tool_version の違い",
      (fs) =>
        fs.put(META, {
          slug: "demo",
          runtime_errors: { ...fs.read<Written>(META).runtime_errors, tool_version: "0" },
        }),
    ],
    [
      "runs が 1",
      (fs) =>
        fs.put(META, {
          slug: "demo",
          runtime_errors: { ...fs.read<Written>(META).runtime_errors, runs: 1 },
        }),
    ],
    ["target 違い", () => {}, ["--target", "prod"]],
    ["target 無し", () => {}, ["--target", ""]],
    [
      "側の違い",
      (fs) => fs.record(neu(2), { test: LIST, events: [], side: "current", target: "stg" }),
    ],
    ["diff-metadata なし", (fs) => fs.files.delete(DIFF)],
  ];

  describe("compare", () => {
    test("新側だけに出たエラーと失敗したリクエストを、4 種類とも差分として検出し exit 1", () => {
      const fs = withBaseline();
      recordNew(fs, (n) => [
        { test: LIST, events: [...commonOn("http://new:8080", 200 + n), ...NEW_ONLY] },
        { test: EDIT, events: [] },
      ]);
      const r = compare(fs);
      expect(r.code).toBe(1);
      const res = errorsOf(fs);
      expect(res.ok).toBe(false);
      expect(res.new_signatures.map((s) => s.kind).sort(byText)).toEqual([
        "console-error",
        "http-error",
        "pageerror",
        "requestfailed",
      ]);
      expect(
        res.new_signatures.every(
          (s) => s.test === LIST && s.seen_runs === 2 && s.state === "unexplained",
        ),
      ).toBe(true);
      expect(res.counts).toEqual({
        new_signatures: 4,
        actionable: 0,
        explained: 0,
        unexplained: 4,
      });
    });

    test("現行にも出ていたエラーは、ホスト・クエリ・数字が違っても差分にしない", () => {
      const fs = withBaseline();
      recordNew(fs, (n) => [
        { test: LIST, events: commonOn("https://new.example:8443", 900 + n) },
        { test: EDIT, events: [] },
      ]);
      const r = compare(fs);
      expect(r.stderr).toBe("");
      expect(r.code).toBe(0);
      expect(errorsOf(fs).new_signatures).toEqual([]);
      expect(errorsOf(fs).ok).toBe(true);
    });

    test("正規化を 2 回当てると値が変わる署名（blob: の URL・上限で切った本文）も、基準と突き合わせられる", () => {
      const tricky: Event[] = [
        {
          kind: "requestfailed",
          page: "http://current/orders/1",
          text: "net::ERR_FILE_NOT_FOUND",
          method: "GET",
          url: "blob:https://example.com/550e8400-e29b-41d4",
        },
        { kind: "console-error", page: "http://current/orders/1", text: `${"a".repeat(299)} b` },
      ];
      const fs = withBaseline({ flaky: tricky });
      recordNew(fs, (n) => [
        { test: LIST, events: [...commonOn("http://new:8080", 200 + n), ...tricky] },
        { test: EDIT, events: [] },
      ]);
      const r = compare(fs);
      expect(r.stderr).toBe("");
      expect(r.code).toBe(0);
      expect(errorsOf(fs).new_signatures).toEqual([]);
    });

    test("現側の 1 回にだけ出たエラーは、新側で出ても差分にしない", () => {
      const flaky = { kind: "console-error", page: "http://current/orders/1", text: "flaky 3" };
      const fs = withBaseline({ flaky: [flaky] });
      recordNew(fs, () => [
        {
          test: LIST,
          events: [...commonOn("http://new", 5), { ...flaky, page: "http://new/orders/2" }],
        },
        { test: EDIT, events: [] },
      ]);
      expect(compare(fs).code).toBe(0);
    });

    test("新側の 1 回にだけ出たエラーも差分にする（出た回数を残す）", () => {
      const fs = withBaseline();
      recordNew(fs, (n) => [
        { test: LIST, events: [...commonOn("http://new", 5), ...(n === 2 ? [NEW_ONLY[1]] : [])] },
        { test: EDIT, events: [] },
      ]);
      expect(compare(fs).code).toBe(1);
      expect(errorsOf(fs).new_signatures.map((s) => s.seen_runs)).toEqual([1]);
    });

    test("現側では別のテストに出ていたエラーは、そのテストでは差分にする", () => {
      const fs = withBaseline();
      recordNew(fs, () => [
        { test: LIST, events: commonOn("http://new", 5) },
        { test: EDIT, events: [commonOn("http://new", 5)[0]] },
      ]);
      expect(compare(fs).code).toBe(1);
      expect(errorsOf(fs).new_signatures.map((s) => [s.test, s.kind])).toEqual([
        [EDIT, "pageerror"],
      ]);
    });

    /** 新側だけのエラーの署名に分類を書いて compare を通し直し、終了コードと state を確かめる。 */
    const expectClassified = (cases: [Record<string, string>, number, string][]) => {
      const fs = withBaseline();
      recordNew(fs, () => [
        { test: LIST, events: [...commonOn("http://new", 5), NEW_ONLY[0]] },
        { test: EDIT, events: [] },
      ]);
      expect(compare(fs).code).toBe(1);
      const classify = (c: Record<string, string>) => {
        const doc = fs.read<Written>(DIFF);
        doc.runtime_errors.new_signatures = doc.runtime_errors.new_signatures.map((s) => ({
          ...s,
          ...c,
        }));
        fs.put(DIFF, doc);
        return compare(fs).code;
      };
      for (const [c, code, state] of cases) {
        const doc = fs.read<Written>(DIFF);
        doc.runtime_errors.new_signatures = doc.runtime_errors.new_signatures.map((s) => ({
          ...s,
          classification: null,
          reason: null,
          approved_at: null,
          evidence: null,
        }));
        fs.put(DIFF, doc);
        expect(classify(c), JSON.stringify(c)).toBe(code);
        expect(errorsOf(fs).new_signatures[0]?.state, JSON.stringify(c)).toBe(state);
        // compare --write は、書いた値を読み方で変えずに書き戻す（空の文字列は書いていないものとして null）
        const written: Record<string, unknown> = { ...errorsOf(fs).new_signatures[0] };
        for (const [k, v] of Object.entries(c)) expect(written[k], k).toBe(v === "" ? null : v);
      }
    };

    test("分類は同じテスト × 署名へ持ち越し、説明になる分類だけで収束する", () => {
      expectClassified([
        [{ classification: "許容", reason: "現行の不具合を直した結果" }, 1, "unexplained"],
        [{ classification: "許容", reason: "", approved_at: "2026-11-08" }, 1, "unexplained"],
        [{ classification: "許容", reason: "理由", approved_at: "2026-11-08" }, 0, "explained"],
        [{ classification: "環境ノイズ", evidence: "" }, 1, "unexplained"],
        [
          { classification: "環境ノイズ", evidence: "新側の CDN の一時的な失敗。2 回目は出ない" },
          0,
          "explained",
        ],
        [{ classification: "要対応", reason: "新側の不具合" }, 1, "actionable"],
        [{ classification: "不明" }, 1, "unexplained"],
      ]);
    });

    // Issue #1003
    test("雛形のプレースホルダ（<...>）のままの分類の欄は、書いていないものとして読む", () => {
      expectClassified([
        [
          { classification: "許容", reason: "<許容する理由>", approved_at: "2026-11-08" },
          1,
          "unexplained",
        ],
        [
          { classification: "許容", reason: "理由", approved_at: "<承認した日時>" },
          1,
          "unexplained",
        ],
        [{ classification: "環境ノイズ", evidence: "<出る条件と出ない条件>" }, 1, "unexplained"],
      ]);
    });

    test("新側で記録が欠けた・通らなかった・基準に無いテストは exit 1", () => {
      const cases: [string, (n: number) => Record_[], keyof Written["runtime_errors"]][] = [
        ["欠け", () => [{ test: LIST, events: commonOn("http://new", 1) }], "missing_tests"],
        [
          "1 回だけ",
          (n) => [{ test: LIST, events: [] }, ...(n === 1 ? [{ test: EDIT, events: [] }] : [])],
          "missing_tests",
        ],
        [
          "failed",
          () => [
            { test: LIST, events: [] },
            { test: EDIT, events: [], status: "timedOut" },
          ],
          "failed_tests",
        ],
        [
          "余分",
          () => [
            { test: LIST, events: [] },
            { test: EDIT, events: [] },
            { test: "x.spec.ts › 新", events: [] },
          ],
          "extra_tests",
        ],
      ];
      for (const [label, perRun, key] of cases) {
        const fs = withBaseline();
        recordNew(fs, perRun);
        expect(compare(fs).code, label).toBe(1);
        expect(errorsOf(fs)[key], label).not.toEqual([]);
        expect(errorsOf(fs).ok, label).toBe(false);
      }
    });

    test("新側でスキップしたテストは一覧に残して止めない。現側でスキップしたテストのエラーは比べない", () => {
      const fs = withBaseline({ skippedEdit: true });
      recordNew(fs, () => [
        { test: LIST, events: commonOn("http://new", 1), status: "skipped" },
        { test: EDIT, events: NEW_ONLY },
      ]);
      expect(compare(fs).code).toBe(0);
      expect(errorsOf(fs).skipped_tests).toEqual([LIST]);
      expect(errorsOf(fs).current_skipped_tests).toEqual([EDIT]);
      expect(errorsOf(fs).new_signatures).toEqual([]);
    });

    test("新側でスキップした試行のイベントは比べない。同じテストの通った回のイベントは比べる", () => {
      const fs = withBaseline();
      recordNew(fs, (n) => [
        { test: LIST, events: NEW_ONLY, status: n === 1 ? "skipped" : "passed" },
        { test: EDIT, events: NEW_ONLY, status: "skipped" },
      ]);
      expect(compare(fs).code).toBe(1);
      const errors = errorsOf(fs);
      expect(errors.skipped_tests).toEqual([EDIT, LIST].sort());
      expect(new Set(errors.new_signatures.map((s) => s.test))).toEqual(new Set([LIST]));
      expect(errors.new_signatures.every((s) => s.seen_runs === 1)).toBe(true);
    });

    test("--write が無ければ diff-metadata.json を書かない", () => {
      const fs = withBaseline();
      fs.writes = [];
      recordNew(fs, () => [
        { test: LIST, events: NEW_ONLY },
        { test: EDIT, events: [] },
      ]);
      const r = compare(fs, []);
      expect(r.code).toBe(1);
      expect(fs.writes).toEqual([]);
      expect(r.stdout).toContain('"unexplained": 4');
    });

    test.each(COMPARE_USAGE_CASES)(
      "%s（基準・引数・新側の記録の誤り）は exit 2",
      (label, mutate, override) => {
        const fs = withBaseline();
        recordNew(fs, () => [
          { test: LIST, events: [] },
          { test: EDIT, events: [] },
        ]);
        mutate(fs);
        fs.writes = [];
        const args = override ?? ["--target", "stg"];
        const r = fs.run([
          "compare",
          "--metadata",
          META,
          ...args,
          "--run",
          newRun(1),
          "--run",
          newRun(2),
          "--write",
          DIFF,
        ]);
        expect(r.code, label).toBe(2);
        expect(fs.writes, label).toEqual([]);
      },
    );

    test("新側の実行が 1 回だけなら exit 2", () => {
      const fs = withBaseline();
      recordNew(fs, () => [
        { test: LIST, events: [] },
        { test: EDIT, events: [] },
      ]);
      const r = fs.run(["compare", "--metadata", META, "--target", "stg", "--run", newRun(1)]);
      expect(r.code).toBe(2);
    });

    test("サブコマンドが無ければ exit 2", () => {
      expect(new Fs().run(["check"]).code).toBe(2);
    });
  });
});
