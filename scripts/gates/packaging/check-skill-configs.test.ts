// このリポジトリのスキルの設定のチェック（check-skill-configs.ts）のテスト。
//
// 状態空間の軸と、各セルに置いた入力:
//
// | 軸 | 値 |
// | --- | --- |
// | スキーマのファイル | 正しい / 名前が <名前>.schema.json でない / 読めない（x-layers が無い） |
// | 設定ファイルの名前 | <名前>.jsonc / <名前>.local.jsonc / 旧い skills.yml / スキーマを持つスキルが無い名前 |
// | 設定ファイルの中身 | スキーマに合う / 知らないキー / その層に置けないキー |
// | 件数 | 設定ファイル 0 件 / スキーマ 0 件 / どちらも 1 件以上 |
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test, vi } from "vitest";
import { makeTempDir } from "../../lib/testing/test-tmpdir.ts";
import { check, main, schemaDirs } from "./check-skill-configs.ts";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const SCHEMA = JSON.stringify({
  properties: {
    a: { type: "string", "x-layers": ["repo"] },
    b: { type: "string", "x-layers": ["local"] },
  },
});

function makeRepo() {
  const root = makeTempDir("skill-configs-");
  mkdirSync(join(root, "skills"));
  const put = (rel: string, text: string) => {
    mkdirSync(dirname(join(root, rel)), { recursive: true });
    writeFileSync(join(root, rel), text);
  };
  return { root, put };
}

function runMain(root: string) {
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
    return { code: main(root), out, err };
  } finally {
    o.mockRestore();
    e.mockRestore();
  }
}

test("設定の名前ごとに、スキーマを持つ最初のスキルのディレクトリを返す", () => {
  const { root, put } = makeRepo();
  put("skills/a/config-schemas/x.schema.json", SCHEMA);
  put("skills/b/config-schemas/x.schema.json", SCHEMA);
  put("skills/b/config-schemas/y.schema.json", SCHEMA);
  expect(Object.fromEntries(schemaDirs(root))).toEqual({
    x: join(root, "skills/a/config-schemas"),
    y: join(root, "skills/b/config-schemas"),
  });
});

test("スキーマと設定ファイルが合えば違反 0 件で、件数を数える", () => {
  const { root, put } = makeRepo();
  put("skills/a/config-schemas/x.schema.json", SCHEMA);
  put(".config/skills/shoji9x9/x.jsonc", '{ "a": "1" } // c');
  put(".config/skills/shoji9x9/x.local.jsonc", '{ "b": "1" }');
  expect(check(root)).toEqual({ findings: [], files: 2, schemas: 1 });
});

test("名前の形でないスキーマと、読めないスキーマを挙げる", () => {
  const { root, put } = makeRepo();
  put("skills/a/config-schemas/x.json", "{}");
  put("skills/a/config-schemas/y.schema.json", JSON.stringify({ properties: { a: {} } }));
  const { findings } = check(root);
  expect(findings.map((f) => f.path)).toEqual([
    "skills/a/config-schemas/x.json",
    "skills/a/config-schemas/y.schema.json",
  ]);
  expect(findings[0].message).toBe("<名前>.schema.json の形でない");
  expect(findings[1].message).toMatch(/x-layers/);
});

test("旧い skills.yml・スキーマの無い名前・スキーマに合わない中身・置けない層のキーを挙げる", () => {
  const { root, put } = makeRepo();
  put("skills/a/config-schemas/x.schema.json", SCHEMA);
  put(".config/skills/shoji9x9/skills.yml", "version: 1\n");
  put(".config/skills/shoji9x9/z.jsonc", "{}");
  put(".config/skills/shoji9x9/x.jsonc", '{ "typo": 1 }');
  put(".config/skills/shoji9x9/x.local.jsonc", '{ "a": "1" }');
  const { findings } = check(root);
  expect(findings.map((f) => f.path)).toEqual([
    ".config/skills/shoji9x9/skills.yml",
    ".config/skills/shoji9x9/x.jsonc",
    ".config/skills/shoji9x9/x.local.jsonc",
    ".config/skills/shoji9x9/z.jsonc",
  ]);
  expect(findings[0].message).toMatch(/旧い skills\.yml なら、スキルごとの \.jsonc に移して消す/);
  expect(findings[1].message).toMatch(/知らないキー "typo"/);
  expect(findings[2].message).toMatch(/a は 人ごと・リポジトリ限定/);
  expect(findings[3].message).toMatch(/z のスキーマを持つスキルが無い/);
});

test("main は違反があれば exit 1、0 件の対象は exit 2、合えば exit 0", () => {
  const empty = makeRepo();
  expect(runMain(empty.root)).toMatchObject({
    code: 2,
    err: expect.stringContaining("設定ファイル 0 件・スキーマ 0 件"),
  });
  const bad = makeRepo();
  bad.put("skills/a/config-schemas/x.schema.json", SCHEMA);
  bad.put(".config/skills/shoji9x9/x.jsonc", '{ "typo": 1 }');
  expect(runMain(bad.root).code).toBe(1);
  const ok = makeRepo();
  ok.put("skills/a/config-schemas/x.schema.json", SCHEMA);
  ok.put(".config/skills/shoji9x9/x.jsonc", '{ "a": "1" }');
  expect(runMain(ok.root)).toMatchObject({
    code: 0,
    out: "check-skill-configs: OK（設定ファイル 1 件・スキーマ 1 件）\n",
  });
});

test("skills/ を読めなければ exit 2", () => {
  const root = makeTempDir("skill-configs-none-");
  expect(runMain(root).code).toBe(2);
});

test("実リポジトリ: このリポジトリの設定はスキーマに合う", () => {
  expect(runMain(repoRoot).code).toBe(0);
});
