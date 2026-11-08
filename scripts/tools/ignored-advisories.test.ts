// ignored-advisories.ts（無視した advisory を見直す時期の検出）のテスト。
//
// | 軸 | 値 |
// | --- | --- |
// | 書いた一覧（pnpm-workspace.yaml） | auditConfig が無い / ignoreGhsas が無い・null・空・1 件 / 配列でない / GHSA の形でない / 文書がマッピングでない / 重複 |
// | pnpm が読んだ一覧 | 空の出力 / null / ignore が null / ignore が 1 件 / オブジェクトでない / GHSA の形でない |
// | 許可する依存元の一覧 | 正しい / advisories が無い / キーが GHSA でない / package が無い / dependents が空 / 要素に depField が無い |
// | 一覧の突き合わせ | 一致 / 書いたが読まれていない / 読まれたが書いていない / 許可の一覧に無い / 許可の一覧にだけある |
// | advisory | 修正版あり・なし / 取り下げあり・なし / vulnerabilities が無い / 型が違う |
// | 依存元 | 許可の内 / 許可の外（名前・depField が違う）/ 無い（使わなくなった）/ deduped の節 |
// | 外部コマンド | 成功 / 失敗 |
import { describe, expect, test } from "vitest";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  advisoryStatus,
  collect,
  declaredGhsas,
  directDependents,
  evaluate,
  formatBody,
  listMismatches,
  loadedGhsas,
  main,
  parseAllowlist,
  type AllowEntry,
  type Runner,
} from "./ignored-advisories.ts";
import { makeTempDir } from "../lib/testing/test-tmpdir.ts";

const A = "GHSA-vfj7-8cjw-p6xm";
const B = "GHSA-2g4f-4pwh-qvx6";
const allowBraces: AllowEntry = {
  package: "braces",
  dependents: [{ name: "markdownlint-cli2", depField: "devDependencies" }],
};
const allowJson = (entries: Record<string, unknown>) => JSON.stringify({ advisories: entries });

describe("書いた一覧", () => {
  test.each([
    ["auditConfig が無い", "minimumReleaseAge: 1\n", []],
    ["ignoreGhsas が無い", "auditConfig: {}\n", []],
    ["ignoreGhsas が null", "auditConfig:\n  ignoreGhsas:\n", []],
    ["ignoreGhsas が空", "auditConfig:\n  ignoreGhsas: []\n", []],
    ["1 件", `auditConfig:\n  ignoreGhsas:\n    - ${A}\n`, [A]],
  ])("%s", (_name, yaml, expected) => {
    expect(declaredGhsas(yaml)).toEqual(expected);
  });

  test.each([
    ["文書がマッピングでない", "- a\n", "マッピングでない"],
    ["auditConfig がマッピングでない", "auditConfig: 1\n", "auditConfig がマッピングでない"],
    ["配列でない", "auditConfig:\n  ignoreGhsas: GHSA-x\n", "配列でない"],
    ["GHSA の形でない", "auditConfig:\n  ignoreGhsas: [CVE-2024-1]\n", "GHSA の形でない"],
  ])("%s は例外にする", (_name, yaml, message) => {
    expect(() => declaredGhsas(yaml)).toThrow(message);
  });
});

describe("pnpm が読んだ一覧", () => {
  test.each([
    ["空の出力", "", []],
    ["null", "null\n", []],
    ["ignore が null", '{"ignore": null}', []],
    ["ignore が無い", "{}", []],
    ["1 件", `{"ignore": ["${A}"]}`, [A]],
  ])("%s", (_name, output, expected) => {
    expect(loadedGhsas(output)).toEqual(expected);
  });

  test.each([
    ["オブジェクトでない", "[]", "オブジェクトでない"],
    ["GHSA の形でない", '{"ignore": [1]}', "GHSA の形でない"],
  ])("%s は例外にする", (_name, output, message) => {
    expect(() => loadedGhsas(output)).toThrow(message);
  });
});

describe("許可する依存元の一覧", () => {
  test("正しい一覧を読む", () => {
    expect(parseAllowlist(allowJson({ [A]: allowBraces })).get(A)).toEqual(allowBraces);
  });

  test("実リポジトリの一覧は読める", () => {
    const text = readFileSync(
      join(import.meta.dirname, "ignored-advisories-dependents.json"),
      "utf8",
    );
    expect(() => parseAllowlist(text)).not.toThrow();
  });

  test.each([
    ["advisories が無い", "{}", "advisories"],
    ["キーが GHSA でない", allowJson({ x: allowBraces }), "GHSA の形でない"],
    [
      "package が無い",
      allowJson({ [A]: { dependents: allowBraces.dependents } }),
      "package と dependents",
    ],
    [
      "dependents が空",
      allowJson({ [A]: { package: "braces", dependents: [] } }),
      "dependents が空",
    ],
    [
      "要素に depField が無い",
      allowJson({ [A]: { package: "braces", dependents: [{ name: "x" }] } }),
      "depField",
    ],
  ])("%s は例外にする", (_name, text, message) => {
    expect(() => parseAllowlist(text)).toThrow(message);
  });
});

describe("一覧の突き合わせ", () => {
  const allow = new Map([[A, allowBraces]]);

  test("3 つが一致すれば食い違いは無い", () => {
    expect(listMismatches([A], [A], allow)).toEqual([]);
  });

  test("空の一覧どうしも一致する", () => {
    expect(listMismatches([], [], new Map())).toEqual([]);
  });

  test.each([
    {
      name: "書いたが pnpm が読んでいない",
      declared: [A],
      loaded: [],
      message: "pnpm が読んでいない",
    },
    {
      name: "pnpm が読んだが書いていない",
      declared: [A],
      loaded: [A, B],
      message: `${B} は pnpm が読んだが`,
    },
    {
      name: "許可の一覧に無い",
      declared: [A, B],
      loaded: [A, B],
      message: `${B} の許可する依存元が`,
    },
    { name: "許可の一覧にだけある", declared: [], loaded: [], message: "ignoreGhsas に無い" },
    { name: "書いた一覧の重複", declared: [A, A], loaded: [A], message: "重複" },
  ])("$name", ({ declared, loaded, message }) => {
    expect(listMismatches(declared, loaded, allow).join("\n")).toContain(message);
  });
});

describe("advisory の状態", () => {
  const vuln = (fixed: unknown, name = "braces", ecosystem = "npm") => ({
    package: { ecosystem, name },
    first_patched_version: fixed,
  });

  test("修正版も取り下げも無い", () => {
    expect(
      advisoryStatus({ vulnerabilities: [vuln(null)], withdrawn_at: null }, A, "braces"),
    ).toEqual({
      patched: [],
      withdrawn: null,
    });
  });

  test("修正版と取り下げを取る", () => {
    const value = {
      vulnerabilities: [vuln("3.0.4"), vuln(null)],
      withdrawn_at: "2026-10-23T12:53:02Z",
    };
    expect(advisoryStatus(value, A, "braces")).toEqual({
      patched: ["braces@3.0.4"],
      withdrawn: "2026-10-23T12:53:02Z",
    });
  });

  test("別のパッケージや別のエコシステムの修正版は取らない", () => {
    const value = {
      vulnerabilities: [vuln("1.0.0", "other"), vuln("3.0.4", "braces", "pip"), vuln(null)],
      withdrawn_at: null,
    };
    expect(advisoryStatus(value, A, "braces")).toEqual({ patched: [], withdrawn: null });
  });

  test.each([
    ["vulnerabilities が無い", {}, "vulnerabilities が無い"],
    ["package が無い", { vulnerabilities: [{}] }, "package が無い"],
    [
      "first_patched_version が文字列でない",
      { vulnerabilities: [vuln(1)] },
      "first_patched_version",
    ],
    ["withdrawn_at が文字列でない", { vulnerabilities: [], withdrawn_at: 1 }, "withdrawn_at"],
  ])("%s は例外にする", (_name, value, message) => {
    expect(() => advisoryStatus(value, A, "braces")).toThrow(message);
  });
});

describe("直接の依存", () => {
  // pnpm why braces --json の実測の形を縮めたもの。importer（depField を持つ節）を dependents に持つ節が直接の依存。
  const importer = { name: "skills", version: "0.0.0", depField: "devDependencies" };
  const why = [
    {
      name: "braces",
      version: "3.0.3",
      dependents: [
        {
          name: "micromatch",
          dependents: [
            { name: "markdownlint-cli2", deduped: true },
            { name: "globby", dependents: [{ name: "markdownlint-cli2", dependents: [importer] }] },
            { name: "semantic-release", dependents: [importer, { name: "x", circular: true }] },
          ],
        },
      ],
    },
  ];

  test("importer に直接つながる節を、重複なく名前の順に返す", () => {
    expect(directDependents(why)).toEqual([
      { name: "markdownlint-cli2", depField: "devDependencies" },
      { name: "semantic-release", depField: "devDependencies" },
    ]);
  });

  test("パッケージが無いときは空", () => {
    expect(directDependents([])).toEqual([]);
  });

  test("配列でなければ例外にする", () => {
    expect(() => directDependents({})).toThrow("配列でない");
  });
});

describe("見直す時期の判定", () => {
  const none = { patched: [], withdrawn: null };
  const dev = (name: string) => ({ name, depField: "devDependencies" });

  test("許可の内だけで変化が無ければ何も挙げない", () => {
    expect(
      evaluate({ id: A, status: none, allow: allowBraces, dependents: [dev("markdownlint-cli2")] }),
    ).toEqual([]);
  });

  test("修正版・取り下げ・許可の外を挙げる", () => {
    const status = { patched: ["braces@3.0.4"], withdrawn: "2026-10-23T12:53:02Z" };
    expect(
      evaluate({
        id: A,
        status,
        allow: allowBraces,
        dependents: [dev("markdownlint-cli2"), dev("semantic-release")],
      }),
    ).toEqual([
      { id: A, kind: "patched", detail: ["braces@3.0.4"] },
      { id: A, kind: "withdrawn", detail: "2026-10-23T12:53:02Z" },
      { id: A, kind: "new-dependent", detail: [dev("semantic-release")] },
    ]);
  });

  test("同じ名前でも depField が違えば許可の外", () => {
    const prod = { name: "markdownlint-cli2", depField: "dependencies" };
    expect(evaluate({ id: A, status: none, allow: allowBraces, dependents: [prod] })).toEqual([
      { id: A, kind: "new-dependent", detail: [prod] },
    ]);
  });

  test("依存元が無ければ、使わなくなったとして挙げる", () => {
    expect(evaluate({ id: A, status: none, allow: allowBraces, dependents: [] })).toEqual([
      { id: A, kind: "unused", detail: "braces" },
    ]);
  });
});

describe("Issue の本文", () => {
  test("0 件は件数だけを書く", () => {
    const body = formatBody([], 0);
    expect(body).toContain("確かめた advisory: 0 件、見直すもの: 0 件");
    expect(body).not.toContain("| advisory |");
  });

  test("検出したものを表にする", () => {
    const body = formatBody(
      [
        { id: A, kind: "unused", detail: "braces" },
        { id: A, kind: "new-dependent", detail: [{ name: "x", depField: "dependencies" }] },
      ],
      1,
    );
    expect(body).toContain(
      `| [${A}](https://github.com/advisories/${A}) | どの依存元も使わなくなった | braces |`,
    );
    expect(body).toContain("| 許可した依存元の外が使い始めた | x（dependencies） |");
  });
});

describe("まとめて確かめる", () => {
  const yaml = `auditConfig:\n  ignoreGhsas:\n    - ${A}\n`;
  const fakeRun =
    (overrides: Record<string, string | Error> = {}): Runner =>
    (command, args) => {
      const key = `${command} ${args.join(" ")}`;
      const value =
        overrides[key] ??
        {
          "pnpm config get audit --json": `{"ignore":["${A}"]}`,
          [`gh api /advisories/${A}`]: JSON.stringify({
            vulnerabilities: [],
            withdrawn_at: "2026-10-23T12:53:02Z",
          }),
          "pnpm why braces --json": "[]",
        }[key];
      if (value === undefined) throw new Error(`想定していない呼び出し: ${key}`);
      if (value instanceof Error) throw value;
      return value;
    };

  test("advisory と依存元を取得して判定する", () => {
    expect(collect(fakeRun(), yaml, allowJson({ [A]: allowBraces }))).toEqual({
      checked: 1,
      findings: [
        { id: A, kind: "withdrawn", detail: "2026-10-23T12:53:02Z" },
        { id: A, kind: "unused", detail: "braces" },
      ],
    });
  });

  test("一覧が食い違えば例外にする", () => {
    const run = fakeRun({ "pnpm config get audit --json": "null" });
    expect(() => collect(run, yaml, allowJson({ [A]: allowBraces }))).toThrow(
      "pnpm が読んでいない",
    );
  });

  test("API の失敗は変化なしとして扱わない", () => {
    const run = fakeRun({ [`gh api /advisories/${A}`]: new Error("HTTP 502") });
    expect(() => collect(run, yaml, allowJson({ [A]: allowBraces }))).toThrow("HTTP 502");
  });
});

describe("CLI", () => {
  const nullRun: Runner = () => "null";

  test("引数が違えば 2", () => {
    expect(main([], nullRun)).toBe(2);
    expect(main(["--out"], nullRun)).toBe(2);
  });

  test("無視が無ければ due=0 と本文を書く", () => {
    const dir = makeTempDir("ignored-advisories-");
    writeFileSync(join(dir, "pnpm-workspace.yaml"), "auditConfig:\n  ignoreGhsas: []\n");
    const allowlist = join(dir, "dependents.json");
    writeFileSync(allowlist, allowJson({}));
    const out = join(dir, "body.md");
    expect(
      main(["--out", out], nullRun, {
        workspaceYaml: join(dir, "pnpm-workspace.yaml"),
        allowlist,
      }),
    ).toBe(0);
    expect(readFileSync(out, "utf8")).toContain("見直すもの: 0 件");
  });

  test("確かめられなければ 1", () => {
    const dir = makeTempDir("ignored-advisories-");
    expect(
      main(["--out", join(dir, "body.md")], nullRun, {
        workspaceYaml: join(dir, "pnpm-workspace.yaml"),
      }),
    ).toBe(1);
  });
});
