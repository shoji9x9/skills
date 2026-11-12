// spec-parity verify が、現行に無かった操作中のエラーを検出することの回帰テスト（Issue #565）。
//
// spec-parity は、parity-suite と同じ中身の runtime-errors.mjs を同梱し、e2e の init script と reporter の雛形が書く記録を読ませる。
// ここでは、その記録の形（e2e の結果の状態を Playwright の語彙に読み替えたもの・init script が採るイベントの形）で、
// 「エラーを足した新側を検出する」「現行にもあるエラーを検出しない」を確かめる。
// さらに、compare が書いた結果を convergence-check が読んで判定するまでをつなぐ。
// イベントの形は、e2e 0.23.0・@e2e-dev/web 0.15.5 の実測の記録（init script の 4 種類と、img と script の 404）から作った。

import { describe, expect, test } from "vitest";
import { main as convergence } from "../../../skills/spec-parity/scripts/convergence-check.mjs";
import { main as runtimeErrors } from "../../../skills/spec-parity/scripts/runtime-errors.mjs";
import { parseJsonAs } from "../../lib/parse-as.ts";
import { EDIT, Fs, LIST, NEW_DIR, SLUG_DIR, TREE, VERIFY, convergedFs } from "./verify-fixture.ts";

type Event = {
  kind: string;
  page: string;
  text: string;
  method?: string;
  url?: string;
  status?: number;
};

// 現行にもある不具合。新側はホスト・ポートが違っても同じ署名になる
const common = (origin: string): Event[] => [
  { page: `${origin}/orders`, kind: "console-error", text: "わざと出した console.error 42" },
  {
    page: `${origin}/orders`,
    kind: "http-error",
    text: "Not Found",
    method: "GET",
    url: `${origin}/api/missing/123`,
    status: 404,
  },
  // img の 404 は、init script が http-error の 1 件にまとめる（要素の error は状態コードが取れなかったときだけ requestfailed にする）
  {
    page: `${origin}/orders`,
    kind: "http-error",
    text: "",
    method: "GET",
    url: `${origin}/missing-99.png`,
    status: 404,
  },
];

const NEW_ONLY: Event[] = [
  { page: "http://127.0.0.1:4102/orders", kind: "pageerror", text: "わざと投げた例外 7" },
  {
    page: "http://127.0.0.1:4102/orders",
    kind: "requestfailed",
    text: "Failed to fetch",
    method: "GET",
    url: "http://127.0.0.1:1/api/x",
  },
];

const runDir = (side: "current" | "new", n: number) =>
  side === "current" ? `${SLUG_DIR}/runtime-errors/run-${n}` : `${NEW_DIR}/runtime-errors/run-${n}`;

// reporter の雛形が書く記録。雛形はテストの識別子のハッシュをファイル名にする（ここでは識別子を 16 進にした名前）
function putRecord(
  fs: Fs,
  at: { side: "current" | "new"; n: number },
  rec: { test: string; status: string; events: Event[] },
) {
  const { side, n } = at;
  fs.put(`${runDir(side, n)}/${Buffer.from(rec.test).toString("hex")}.json`, {
    version: "1",
    side,
    slug: "orders",
    target: side === "new" ? "stg" : null,
    run: n,
    test: rec.test,
    status: rec.status,
    retry: 0,
    events: rec.events,
  });
}

function withReadDir(fs: Fs) {
  const { io, out } = fs.io();
  const readDir = (p: string) => {
    const dir = `${p.replace(/^\/repo\//, "")}/`;
    return [...fs.files.keys()].filter((k) => k.startsWith(dir)).map((k) => k.slice(dir.length));
  };
  return { io: { ...io, readDir }, out };
}

/** 現側で 2 回記録し、summarize で metadata.json の runtime_errors を書く。 */
function baseline(): Fs {
  const fs = convergedFs();
  for (const n of [1, 2]) {
    putRecord(
      fs,
      { side: "current", n },
      {
        test: LIST,
        status: "passed",
        events: common("http://127.0.0.1:4101"),
      },
    );
    putRecord(fs, { side: "current", n }, { test: EDIT, status: "passed", events: [] });
  }
  const { io } = withReadDir(fs);
  const code = runtimeErrors(
    [
      "summarize",
      "--metadata",
      `${SLUG_DIR}/metadata.json`,
      "--run",
      runDir("current", 1),
      "--run",
      runDir("current", 2),
      "--write",
    ],
    io,
  );
  expect(code).toBe(0);
  return fs;
}

// tree は compare --tree で渡す、記録を採った新側のバージョン（null は渡さない）
function compareNew(
  fs: Fs,
  events: Event[],
  { status = "passed", tree = TREE }: { status?: string; tree?: string | null } = {},
) {
  for (const n of [1, 2]) {
    putRecord(fs, { side: "new", n }, { test: LIST, status, events });
    putRecord(fs, { side: "new", n }, { test: EDIT, status: "passed", events: [] });
  }
  const { io, out } = withReadDir(fs);
  const code = runtimeErrors(
    [
      "compare",
      "--metadata",
      `${SLUG_DIR}/metadata.json`,
      "--target",
      "stg",
      "--run",
      runDir("new", 1),
      "--run",
      runDir("new", 2),
      "--write",
      VERIFY,
      ...(tree === null ? [] : ["--tree", tree]),
    ],
    io,
  );
  return { code, out };
}

function converge(fs: Fs) {
  const { io, out } = fs.io();
  const code = convergence(["--slug-dir", SLUG_DIR, "--target", "stg"], io);
  return {
    code,
    reasons:
      code === 2
        ? []
        : parseJsonAs<{ reasons: { category: string; check: string }[] }>(out.stdout).reasons,
  };
}

type Compared = { runtime_errors: { new_signatures: { kind: string; text: string }[] } };

describe("e2e の記録での操作中のエラーの比較", () => {
  test("現行にもあるエラーだけなら、compare も収束の判定も通る（現行にもあるエラーを検出しない）", () => {
    const fs = baseline();
    const r = compareNew(fs, common("http://127.0.0.1:4102"));
    expect(r.code).toBe(0);
    expect(fs.json<Compared>(VERIFY).runtime_errors.new_signatures).toEqual([]);
    expect(converge(fs).code).toBe(0);
  });

  test("新側でエラーを足すと、足した 2 件だけを差分にし、収束させない（エラーを足した fixture を検出する）", () => {
    const fs = baseline();
    const r = compareNew(fs, [...common("http://127.0.0.1:4102"), ...NEW_ONLY]);
    expect(r.code).toBe(1);
    const sigs = fs.json<Compared>(VERIFY).runtime_errors.new_signatures;
    expect(sigs.map((s) => s.kind).sort()).toEqual(["pageerror", "requestfailed"]);
    const c = converge(fs);
    expect(c.code).toBe(1);
    expect(c.reasons.map((x) => [x.category, x.check])).toEqual([
      ["approval", "runtime_errors"],
      ["approval", "runtime_errors"],
    ]);
  });

  test("e2e の timed-out を読み替えた timedOut は、新側で通らなかったテストとして差し戻す", () => {
    const fs = baseline();
    const r = compareNew(fs, common("http://127.0.0.1:4102"), { status: "timedOut" });
    expect(r.code).toBe(1);
    expect(converge(fs).reasons).toContainEqual({
      category: "send-back",
      check: "runtime_errors",
      message: `failed_tests: ${LIST}`,
    });
  });

  test("e2e の状態の語彙のまま（timed-out）書いた記録は、compare が読まずに exit 2", () => {
    const fs = baseline();
    expect(compareNew(fs, [], { status: "timed-out" }).code).toBe(2);
  });

  // 項目 4（Issue #995）: 比較の結果を、記録を採った新側のバージョンと突き合わせる
  test.each([
    ["--tree を渡さずに書いた（バージョンを持たない）", null, "記録にバージョン（tree）が無い"],
    ["前のバージョンの新側で採った", "1".repeat(40), `が new.tree（${TREE}）と違う`],
  ])("%s比較の結果は、収束の根拠にせず採り直す", (_label, tree, message) => {
    const fs = baseline();
    expect(compareNew(fs, common("http://127.0.0.1:4102"), { tree }).code).toBe(0);
    const c = converge(fs);
    expect(c.code).toBe(1);
    expect(c.reasons).toEqual([
      { category: "remeasure", check: "runtime_errors", message: expect.stringContaining(message) },
    ]);
  });

  test("compare --tree の前後の空白は外して書く（貼り付けた値で new.tree と食い違わない）", () => {
    const fs = baseline();
    expect(compareNew(fs, common("http://127.0.0.1:4102"), { tree: ` ${TREE}\n` }).code).toBe(0);
    expect(fs.json<{ runtime_errors: { tree: string } }>(VERIFY).runtime_errors.tree).toBe(TREE);
    expect(converge(fs).code).toBe(0);
  });

  test("compare --tree に none や空の値を渡すと、書かずに exit 2", () => {
    for (const tree of ["none", " "]) {
      const fs = baseline();
      const before = fs.files.get(VERIFY);
      expect(compareNew(fs, common("http://127.0.0.1:4102"), { tree }).code).toBe(2);
      expect(fs.files.get(VERIFY)).toBe(before);
    }
  });
});
