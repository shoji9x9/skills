// 配布スキルに同梱する外部のパッケージのチェック（check-vendor.ts）のテスト。
//
// 状態空間の軸と、各セルに置いた入力:
//
// | 軸 | 値 |
// | --- | --- |
// | スキーマを持つスキル | 0 件 / 1 件 / 複数 |
// | 読み取り（skill-config.mjs） | ある / 無い / スキーマが無いのにある |
// | 宣言した同梱物のファイル | 生成した内容と同じ / 無い / 中身が違う |
// | 宣言の置き場所 | 宣言のファイルだけ / 宣言に無いファイルがある / 宣言の対象でないスキルにある |
// | 宣言の置き場所の除外 | VENDORED_GLOBS に入る / 入らない |
// | config-files.md | ある / 無い |
// | --fix | 無し（報告だけ）/ 有り（作り直す。読み取りは作らない） |
// | --fix の書き込み先 | 通常のファイル / ファイルがシンボリックリンク / 途中のディレクトリがシンボリックリンク |
// | まとめたパッケージ | node_modules の中 / 外 / ライセンスが MIT でない |
// | 引数 | 無し / --fix / 知らない引数 |
import { mkdirSync, readFileSync, symlinkSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, test, vi } from "vitest";
import { makeTempDir } from "../../lib/testing/test-tmpdir.ts";
import { parseJsonAs } from "../../lib/parse-as.ts";
import { loadYamlAs } from "../../lib/text/yaml-as.ts";
import {
  BUNDLES,
  JSONC_PARSER,
  MDAST_GFM,
  MDAST_GFM_PACKAGES,
  READER,
  SHARED_DOC,
  VENDORED_PACKAGES,
  type VendorBundle,
  bundledPackages,
  check,
  main,
  packageInfo,
  withoutDirectives,
} from "./check-vendor.ts";

type DependabotConfig = {
  updates: {
    "package-ecosystem": string;
    groups: Record<string, { patterns?: string[]; "exclude-patterns"?: string[] }>;
  }[];
};

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const JSONC = [JSONC_PARSER];
const VENDOR_DIR = JSONC_PARSER.dir;
const VENDOR_FILES = JSONC_PARSER.files;

/** devDependency を解決できる一時リポジトリ（node_modules は実リポジトリへのリンク）。 */
function makeRepo() {
  const root = makeTempDir("vendor-");
  writeFileSync(join(root, "package.json"), "{}\n");
  symlinkSync(join(repoRoot, "node_modules"), join(root, "node_modules"));
  mkdirSync(join(root, "skills"));
  const put = (rel: string, text = "") => {
    mkdirSync(dirname(join(root, rel)), { recursive: true });
    writeFileSync(join(root, rel), text);
  };
  return { root, put };
}

/** 設定を読むスキル a を、読み取りと共有の文書付きで置いた一時リポジトリ。 */
function makeConfigRepo() {
  const repo = makeRepo();
  repo.put("skills/a/config-schemas/a.schema.json", "{}");
  repo.put(`skills/a/${READER}`);
  repo.put(`skills/a/${SHARED_DOC}`);
  return repo;
}

/** stdout と stderr を集めて main を呼ぶ。 */
async function runMain(argv: string[], root: string, bundles: readonly VendorBundle[] = JSONC) {
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
    return { code: await main(argv, root, bundles), out, err };
  } finally {
    o.mockRestore();
    e.mockRestore();
  }
}

describe("check", () => {
  test("スキーマを持つスキルが 0 件なら、判定できないとして例外にする", async () => {
    const { root } = makeRepo();
    await expect(check(root, false, JSONC)).rejects.toThrow(/config-schemas\/ を持つスキルが 0 件/);
  });

  test("スキーマを持つスキルの、読み取りと vendor/ の欠けをすべて挙げる", async () => {
    const { root, put } = makeRepo();
    put("skills/a/config-schemas/a.schema.json", "{}");
    const findings = await check(root, false, JSONC);
    expect(findings).toEqual([
      { path: `skills/a/${READER}`, message: "無い（他のスキルの skill-config.mjs をコピーする）" },
      {
        path: `skills/a/${SHARED_DOC}`,
        message: "無い（他のスキルの config-files.md をコピーする）",
      },
      ...VENDOR_FILES.map((f) => ({ path: `skills/a/${VENDOR_DIR}/${f}`, message: "無い" })),
    ]);
  });

  test("--fix は vendor/ を作り直し、読み取りは作らない。作り直した後は vendor/ の指摘が無い", async () => {
    const { root, put } = makeRepo();
    put("skills/a/config-schemas/a.schema.json", "{}");
    put(`skills/a/${SHARED_DOC}`);
    expect(await check(root, true, JSONC)).toEqual([
      { path: `skills/a/${READER}`, message: "無い（他のスキルの skill-config.mjs をコピーする）" },
    ]);
    const expected = await JSONC_PARSER.render(root);
    for (const f of VENDOR_FILES) {
      expect(readFileSync(join(root, "skills/a", VENDOR_DIR, f), "utf8")).toBe(expected[f]);
    }
    put(`skills/a/${READER}`);
    expect(await check(root, false, JSONC)).toEqual([]);
  });

  test.each([
    ["ファイル", (dir: string) => `${dir}/${VENDOR_FILES[0]}`],
    ["途中のディレクトリ", (dir: string) => dir],
  ])(
    "--fix は、書き込み先の%sがシンボリックリンクなら、リンク先を書き換えずに挙げる",
    async (_name, linkOf) => {
      const { root } = makeConfigRepo();
      const outside = makeTempDir("vendor-outside-");
      writeFileSync(join(outside, VENDOR_FILES[0]), "outside\n");
      const dir = `skills/a/${VENDOR_DIR}`;
      const link = linkOf(dir);
      mkdirSync(dirname(join(root, link)), { recursive: true });
      symlinkSync(link === dir ? outside : join(outside, VENDOR_FILES[0]), join(root, link));
      const findings = await check(root, true, JSONC);
      expect(findings).toContainEqual({
        path: `${dir}/${VENDOR_FILES[0]}`,
        message: `${link} がシンボリックリンクなので --fix で書かない`,
      });
      expect(readFileSync(join(outside, VENDOR_FILES[0]), "utf8")).toBe("outside\n");
    },
  );

  test("vendor/ の中身が生成した内容と 1 バイトでも違えば挙げる", async () => {
    const { root } = makeConfigRepo();
    await check(root, true, JSONC);
    const path = join(root, "skills/a", VENDOR_DIR, "jsonc-parser.mjs");
    writeFileSync(path, `${readFileSync(path, "utf8")} `);
    expect(await check(root, false, JSONC)).toEqual([
      {
        path: `skills/a/${VENDOR_DIR}/jsonc-parser.mjs`,
        message: `devDependency の jsonc-parser ${packageInfo(root, "jsonc-parser").version} から作った内容と一致しない`,
      },
    ]);
  });

  test("スキーマが無いのに scripts/skill-config/ を持つスキルを挙げる", async () => {
    const { root, put } = makeConfigRepo();
    put(`skills/b/${READER}`);
    put(`skills/b/${VENDOR_DIR}/jsonc-parser.mjs`);
    await check(root, true, JSONC);
    expect(await check(root, false, JSONC)).toEqual([
      {
        path: "skills/b/scripts/skill-config",
        message: "config-schemas/ が無いのに同梱している（設定を読まないなら消す）",
      },
      {
        path: `skills/b/${VENDOR_DIR}`,
        message: "jsonc-parser を同梱する宣言の対象でないのに置いている（使わないなら消す）",
      },
    ]);
  });

  test("宣言の置き場所にある、宣言に無いファイルを挙げる", async () => {
    const { root, put } = makeConfigRepo();
    await check(root, true, JSONC);
    put(`skills/a/${VENDOR_DIR}/old-parser.mjs`, "export {};\n");
    expect(await check(root, false, JSONC)).toEqual([
      {
        path: `skills/a/${VENDOR_DIR}/old-parser.mjs`,
        message: "jsonc-parser の宣言に無いファイル",
      },
    ]);
  });

  test("lint・整形の除外（VENDORED_GLOBS）に入らない置き場所の宣言を挙げる", async () => {
    const { root } = makeConfigRepo();
    const outsideScope: VendorBundle = {
      name: "x",
      dir: "scripts/lib/third-party",
      files: ["x.mjs"],
      targets: () => [],
      render: async () => ({ "x.mjs": "" }),
      versions: () => "x 1.0.0",
    };
    expect(await check(root, false, [outsideScope])).toEqual([
      {
        path: "skills/*/scripts/lib/third-party",
        message: "scripts/lib/source-scope.ts の VENDORED_GLOBS と isVendored に入っていない",
      },
    ]);
  });

  test("mdast-gfm は replace-strategy にだけ同梱し、--fix で作った後は指摘が無い", async () => {
    const { root, put } = makeConfigRepo();
    put("skills/replace-strategy/SKILL.md");
    expect(await check(root, false, [MDAST_GFM])).toEqual(
      MDAST_GFM.files.map((f) => ({
        path: `skills/replace-strategy/scripts/vendor/${f}`,
        message: "無い",
      })),
    );
    await check(root, true, [MDAST_GFM]);
    expect(await check(root, false, [MDAST_GFM])).toEqual([]);
  });
});

describe("render", () => {
  test("jsonc-parser: 生成物の先頭にバージョンを書き、型とライセンスは jsonc-parser のファイルそのものにする", async () => {
    const { dir, version } = packageInfo(repoRoot, "jsonc-parser");
    const v = await JSONC_PARSER.render(repoRoot);
    expect(v["jsonc-parser.mjs"].split("\n")[0]).toContain(`jsonc-parser ${version}（MIT`);
    expect(v["jsonc-parser.mjs"]).toMatch(/export \{[\s\S]*parseTree[\s\S]*\}/);
    expect(v["jsonc-parser.d.mts"]).toBe(readFileSync(join(dir, "lib/esm/main.d.ts"), "utf8"));
    expect(v["LICENSE.md"]).toBe(readFileSync(join(dir, "LICENSE.md"), "utf8"));
  });

  test("mdast-gfm: 先頭に直接使うパッケージのバージョンを書き、まとめた全パッケージのライセンス文を NOTICE.md に載せる", async () => {
    const v = await MDAST_GFM.render(repoRoot);
    const head = v["mdast-gfm.mjs"].split("\n")[0];
    for (const name of MDAST_GFM_PACKAGES) {
      expect(head).toContain(`${name} ${packageInfo(repoRoot, name).version}`);
      expect(v["NOTICE.md"]).toContain(`${name} ${packageInfo(repoRoot, name).version}`);
    }
    expect(v["mdast-gfm.mjs"]).toMatch(/export \{\s*parseGfm\s*\}/);
    // esbuild がまとめたパッケージ（出所のコメント）は、すべて NOTICE.md に載る
    const bundled = new Set(
      [
        ...v["mdast-gfm.mjs"].matchAll(
          /^\/\/ node_modules\/.*node_modules\/((?:@[^/]+\/)?[^/]+)\//gmu,
        ),
      ].map((m) => m[1]),
    );
    expect(bundled.size).toBeGreaterThan(MDAST_GFM_PACKAGES.length);
    for (const name of bundled)
      expect(v["NOTICE.md"]).toMatch(new RegExp(`(?:## |・)${name} `, "u"));
    expect(v["NOTICE.md"]).toContain("Permission is hereby granted");
    expect(v["mdast-gfm.d.mts"]).toContain("export function parseGfm(text: string): Node;");
  });

  test("mdast-gfm: 作り直すとバイト単位で同じ内容になる", async () => {
    expect(await MDAST_GFM.render(repoRoot)).toEqual(await MDAST_GFM.render(repoRoot));
  });
});

describe("withoutDirectives", () => {
  test("抑止のコメントだけをコメントごと取り除き、文字列の中の同じ字面と他のコメントは残す", () => {
    const source = [
      "const a = {",
      "  // @ts-expect-error: 後で足す",
      "  end: void 0,",
      "};",
      "const b = x || /* eslint-disable no-bitwise */ y;",
      'const c = "// @ts-expect-error は文字列";',
      "// 普通のコメント",
      "",
    ].join("\n");
    const out = withoutDirectives(source);
    expect(out).not.toMatch(/\/\/ @ts-expect-error: 後で足す|eslint-disable/u);
    expect(out).toContain('const c = "// @ts-expect-error は文字列";');
    expect(out).toContain("// 普通のコメント");
    expect(out).toContain("const b = x ||  y;");
  });
});

describe("bundledPackages", () => {
  test("node_modules の外のファイルをまとめていたら、判定できないとして例外にする", () => {
    expect(() =>
      bundledPackages(
        {
          inputs: { "<stdin>": { bytes: 0, imports: [] }, "src/a.js": { bytes: 0, imports: [] } },
          outputs: {},
        },
        repoRoot,
      ),
    ).toThrow(/src\/a\.js: node_modules の外/);
  });

  test("ライセンスが MIT でないパッケージをまとめていたら、例外にする", () => {
    const root = makeTempDir("vendor-license-");
    const dir = join(root, "node_modules/gpl-pkg");
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "package.json"), '{"version":"1.0.0","license":"GPL-3.0"}');
    writeFileSync(join(dir, "LICENSE"), "GPL");
    expect(() =>
      bundledPackages(
        { inputs: { "node_modules/gpl-pkg/index.js": { bytes: 0, imports: [] } }, outputs: {} },
        root,
      ),
    ).toThrow(/gpl-pkg: ライセンスが MIT でない/);
  });
});

describe("VENDORED_PACKAGES", () => {
  test("同梱物を作るのに使う devDependency を、すべて含む", () => {
    for (const name of [...MDAST_GFM_PACKAGES, "jsonc-parser", "esbuild", "micromark"]) {
      expect(VENDORED_PACKAGES).toContain(name);
    }
  });

  test("実リポジトリ: dependabot.yml の vendored グループと、自動マージのワークフローの一覧が同じ名前を持つ", () => {
    const expected = [...VENDORED_PACKAGES].sort();
    const config = loadYamlAs<DependabotConfig>(
      readFileSync(join(repoRoot, ".github/dependabot.yml"), "utf8"),
    );
    const npm = config.updates.find((u) => u["package-ecosystem"] === "npm");
    expect([...(npm?.groups.vendored?.patterns ?? [])].sort()).toEqual(expected);
    // catch-all のグループにも入ると、自動マージするグループの PR に含まれるので、catch-all から外す
    for (const name of expected)
      expect(npm?.groups["npm-misc"]?.["exclude-patterns"]).toContain(name);
    const workflow = readFileSync(
      join(repoRoot, ".github/workflows/dependabot-automerge.yml"),
      "utf8",
    );
    const listed = /VENDORED_PACKAGES: '(\[[^']*\])'/u.exec(workflow)?.[1];
    expect(listed).toBeDefined();
    expect(parseJsonAs<string[]>(listed ?? "[]").sort()).toEqual(expected);
  });
});

describe("main", () => {
  test("食い違いがあれば exit 1 で、--fix で作り直すよう案内する", async () => {
    const { root, put } = makeRepo();
    put("skills/a/config-schemas/a.schema.json", "{}");
    const r = await runMain([], root);
    expect(r.code).toBe(1);
    expect(r.err).toContain("同梱物は --fix で作り直す");
  });

  test("食い違いが無ければ exit 0 で、宣言ごとのスキルの数とバージョンを出す", async () => {
    const { root } = makeConfigRepo();
    const fixed = await runMain(["--fix"], root);
    expect(fixed.code).toBe(0);
    expect(fixed.out).toMatch(
      /OK（jsonc-parser: 1 スキル、jsonc-parser [0-9.]+。同梱物を作り直した）/,
    );
    expect((await runMain([], root)).out).toMatch(
      /OK（jsonc-parser: 1 スキル、jsonc-parser [0-9.]+）\n$/,
    );
  });

  test("判定できないときは exit 2、知らない引数も exit 2", async () => {
    const { root } = makeRepo();
    expect((await runMain([], root)).code).toBe(2);
    const r = await runMain(["--check"], root);
    expect(r).toMatchObject({ code: 2, err: expect.stringContaining("知らない引数: --check") });
  });

  test("実リポジトリ: 同梱物は devDependency のバージョンと一致している", async () => {
    expect((await runMain([], repoRoot, BUNDLES)).code).toBe(0);
  });
});
