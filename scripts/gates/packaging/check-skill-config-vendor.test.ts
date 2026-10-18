// 配布スキルに同梱する設定の読み取りのチェック（check-skill-config-vendor.ts）のテスト。
//
// 状態空間の軸と、各セルに置いた入力:
//
// | 軸 | 値 |
// | --- | --- |
// | スキーマを持つスキル | 0 件 / 1 件 / 複数 |
// | 読み取り（skill-config.mjs） | ある / 無い / スキーマが無いのにある |
// | vendor/ の 3 つ | 生成した内容と同じ / 無い / 中身が違う |
// | --fix | 無し（報告だけ）/ 有り（作り直す。読み取りは作らない） |
// | 引数 | 無し / --fix / 知らない引数 |
import { mkdirSync, readFileSync, symlinkSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, test, vi } from "vitest";
import { makeTempDir } from "../../lib/testing/test-tmpdir.ts";
import {
  READER,
  VENDOR_DIR,
  VENDOR_FILES,
  check,
  jsoncParserPackage,
  main,
  renderVendor,
} from "./check-skill-config-vendor.ts";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");

/** jsonc-parser を解決できる一時リポジトリ（node_modules は実リポジトリへのリンク）。 */
function makeRepo() {
  const root = makeTempDir("skill-config-vendor-");
  writeFileSync(join(root, "package.json"), "{}\n");
  symlinkSync(join(repoRoot, "node_modules"), join(root, "node_modules"));
  mkdirSync(join(root, "skills"));
  const put = (rel: string, text = "") => {
    mkdirSync(dirname(join(root, rel)), { recursive: true });
    writeFileSync(join(root, rel), text);
  };
  return { root, put };
}

/** stdout と stderr を集めて main を呼ぶ。 */
async function runMain(argv: string[], root: string) {
  let out = "";
  let err = "";
  const o = vi.spyOn(process.stdout, "write").mockImplementation((s) => {
    out += String(s);
    return true;
  });
  const e = vi.spyOn(process.stderr, "write").mockImplementation((s) => {
    err += String(s);
    return true;
  });
  try {
    return { code: await main(argv, root), out, err };
  } finally {
    o.mockRestore();
    e.mockRestore();
  }
}

describe("check", () => {
  test("スキーマを持つスキルが 0 件なら、判定できないとして例外にする", async () => {
    const { root } = makeRepo();
    await expect(check(root, false)).rejects.toThrow(/config-schemas\/ を持つスキルが 0 件/);
  });

  test("スキーマを持つスキルの、読み取りと vendor/ の欠けをすべて挙げる", async () => {
    const { root, put } = makeRepo();
    put("skills/a/config-schemas/a.schema.json", "{}");
    const findings = await check(root, false);
    expect(findings).toEqual([
      { path: `skills/a/${READER}`, message: "無い（他のスキルの skill-config.mjs をコピーする）" },
      ...VENDOR_FILES.map((f) => ({ path: `skills/a/${VENDOR_DIR}/${f}`, message: "無い" })),
    ]);
  });

  test("--fix は vendor/ を作り直し、読み取りは作らない。作り直した後は vendor/ の指摘が無い", async () => {
    const { root, put } = makeRepo();
    put("skills/a/config-schemas/a.schema.json", "{}");
    expect(await check(root, true)).toEqual([
      { path: `skills/a/${READER}`, message: "無い（他のスキルの skill-config.mjs をコピーする）" },
    ]);
    const expected = await renderVendor(root);
    for (const f of VENDOR_FILES) {
      expect(readFileSync(join(root, "skills/a", VENDOR_DIR, f), "utf8")).toBe(expected[f]);
    }
    put(`skills/a/${READER}`);
    expect(await check(root, false)).toEqual([]);
  });

  test("vendor/ の中身が生成した内容と 1 バイトでも違えば挙げる", async () => {
    const { root, put } = makeRepo();
    put("skills/a/config-schemas/a.schema.json", "{}");
    put(`skills/a/${READER}`);
    await check(root, true);
    const path = join(root, "skills/a", VENDOR_DIR, "jsonc-parser.mjs");
    writeFileSync(path, `${readFileSync(path, "utf8")} `);
    expect(await check(root, false)).toEqual([
      {
        path: `skills/a/${VENDOR_DIR}/jsonc-parser.mjs`,
        message: "devDependency の jsonc-parser から作った内容と一致しない",
      },
    ]);
  });

  test("スキーマが無いのに scripts/skill-config/ を持つスキルを挙げる", async () => {
    const { root, put } = makeRepo();
    put("skills/a/config-schemas/a.schema.json", "{}");
    put(`skills/a/${READER}`);
    put(`skills/b/${READER}`);
    await check(root, true);
    expect(await check(root, false)).toEqual([
      {
        path: "skills/b/scripts/skill-config",
        message: "config-schemas/ が無いのに同梱している（設定を読まないなら消す）",
      },
    ]);
  });
});

describe("renderVendor", () => {
  test("生成物の先頭に版を書き、型とライセンスは jsonc-parser のファイルそのものにする", async () => {
    const { dir, version } = jsoncParserPackage(repoRoot);
    const v = await renderVendor(repoRoot);
    expect(v["jsonc-parser.mjs"].split("\n")[0]).toContain(`jsonc-parser ${version}（MIT`);
    expect(v["jsonc-parser.mjs"]).toMatch(/export \{[\s\S]*parseTree[\s\S]*\}/);
    expect(v["jsonc-parser.d.mts"]).toBe(readFileSync(join(dir, "lib/esm/main.d.ts"), "utf8"));
    expect(v["LICENSE.md"]).toBe(readFileSync(join(dir, "LICENSE.md"), "utf8"));
  });
});

describe("main", () => {
  test("食い違いがあれば exit 1 で、--fix で作り直すよう案内する", async () => {
    const { root, put } = makeRepo();
    put("skills/a/config-schemas/a.schema.json", "{}");
    const r = await runMain([], root);
    expect(r.code).toBe(1);
    expect(r.err).toContain("vendor/ は --fix で作り直す");
  });

  test("食い違いが無ければ exit 0 で、スキルの数と版を出す", async () => {
    const { root, put } = makeRepo();
    put("skills/a/config-schemas/a.schema.json", "{}");
    put(`skills/a/${READER}`);
    const fixed = await runMain(["--fix"], root);
    expect(fixed.code).toBe(0);
    expect(fixed.out).toMatch(/OK（1 スキル、jsonc-parser [0-9.]+、vendor\/ を作り直した）/);
    expect((await runMain([], root)).out).toMatch(/OK（1 スキル、jsonc-parser [0-9.]+）\n$/);
  });

  test("判定できないときは exit 2、知らない引数も exit 2", async () => {
    const { root } = makeRepo();
    expect((await runMain([], root)).code).toBe(2);
    const r = await runMain(["--check"], root);
    expect(r).toMatchObject({ code: 2, err: expect.stringContaining("知らない引数: --check") });
  });

  test("実リポジトリ: 同梱物は devDependency の版と一致している", async () => {
    expect((await runMain([], repoRoot)).code).toBe(0);
  });
});
