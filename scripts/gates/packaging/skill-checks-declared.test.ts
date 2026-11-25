// scripts/ の直下に *-check.* を持つ配布スキルが、checks.json（利用者の pre-commit・CI に組み込むチェックの宣言）を持つかを確かめる。
//
// 取り決めの原本は AGENTS.md「ディレクトリ構造」の checks.json の行である。
// 宣言が無いと、取り込む側は「組み込まないと決めた」と「宣言を忘れた」を見分けられない。組み込まないなら "wire": [] を置く。
// browser-test の宣言が欠けたまま配られた（Issue #1147）ので、配る前にここで止める。
//
// 状態空間の軸と、各セルに置いた入力:
//
// | 軸 | 値 |
// | --- | --- |
// | scripts/ の直下の *-check.* | ある / テスト（*.test.*）だけ / サブディレクトリにだけある / その名前のディレクトリだけ / scripts/ が無い |
// | checks.json | ある（skill がディレクトリの名前と同じ） / 無い / JSON として読めない / オブジェクトでない / skill が違う / wire が配列でない |
import { existsSync, mkdirSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { expect, test } from "vitest";
import { isRecord } from "../../lib/guards.ts";
import { isArray } from "../../lib/is-array.ts";
import { REPO_ROOT, write } from "../../lib/testing/repo-file.ts";
import { makeTempDir } from "../../lib/testing/test-tmpdir.ts";

// -check. の後に拡張子が 1 つだけ続く名前に当てる。テスト（a-check.test.ts）は拡張子の前に .test を持つので当たらない
const CHECK_SCRIPT = /-check\.[^.]+$/;

/** 宣言の誤りを `<スキル>: <理由>` の形で返す。誤りが無ければ空の配列。 */
function findings(root: string): string[] {
  const skillsDir = join(root, "skills");
  return readdirSync(skillsDir, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => d.name)
    .sort()
    .flatMap((skill) => {
      const scripts = join(skillsDir, skill, "scripts");
      if (!existsSync(scripts)) return [];
      const checks = readdirSync(scripts, { withFileTypes: true }).filter(
        (f) => f.isFile() && CHECK_SCRIPT.test(f.name),
      );
      if (checks.length === 0) return [];
      const declPath = join(skillsDir, skill, "checks.json");
      if (!existsSync(declPath)) return [`${skill}: checks.json が無い`];
      let decl: unknown;
      try {
        decl = JSON.parse(readFileSync(declPath, "utf8"));
      } catch {
        return [`${skill}: checks.json を JSON として読めない`];
      }
      if (!isRecord(decl)) return [`${skill}: checks.json がオブジェクトでない`];
      const out: string[] = [];
      if (decl.skill !== skill) out.push(`${skill}: checks.json の skill が ${String(decl.skill)}`);
      if (!isArray(decl.wire)) out.push(`${skill}: checks.json の wire が配列でない`);
      return out;
    });
}

function makeRepo(): { root: string; put: (rel: string, text?: string) => void } {
  const root = makeTempDir("skill-checks-declared-");
  mkdirSync(join(root, "skills"));
  const put = (rel: string, text = "") => write(root, rel, text);
  return { root, put };
}

const decl = (skill: unknown, wire: unknown = []) => JSON.stringify({ version: 1, skill, wire });

test("実リポジトリの配布スキルは、*-check.* を持つならすべて checks.json を持つ", () => {
  expect(findings(REPO_ROOT)).toEqual([]);
});

test("*-check.* を持つのに checks.json が無いスキルを挙げる", () => {
  const { root, put } = makeRepo();
  put("skills/missing/scripts/feature-check.mjs");
  put("skills/declared/scripts/a-check.sh");
  put("skills/declared/checks.json", decl("declared"));
  expect(findings(root)).toEqual(["missing: checks.json が無い"]);
});

test("テストだけ・サブディレクトリにだけ・*-check.* の名前のディレクトリだけ・scripts/ が無いスキルには、宣言を求めない", () => {
  const { root, put } = makeRepo();
  put("skills/test-only/scripts/a-check.test.ts");
  put("skills/nested/scripts/page/a-check.page.mjs");
  put("skills/dir-only/scripts/lib-check.d/a.mjs");
  put("skills/no-scripts/SKILL.md");
  expect(findings(root)).toEqual([]);
});

test("checks.json の skill がディレクトリの名前と違うときと、wire が配列でないときを挙げる", () => {
  const { root, put } = makeRepo();
  put("skills/copied/scripts/a-check.mjs");
  put("skills/copied/checks.json", decl("spec-parity"));
  put("skills/no-wire/scripts/a-check.mjs");
  put("skills/no-wire/checks.json", decl("no-wire", null));
  expect(findings(root)).toEqual([
    "copied: checks.json の skill が spec-parity",
    "no-wire: checks.json の wire が配列でない",
  ]);
});

test("checks.json がオブジェクトでないときと、JSON として読めないときを挙げる", () => {
  const { root, put } = makeRepo();
  put("skills/list/scripts/a-check.mjs");
  put("skills/list/checks.json", "[]");
  put("skills/broken/scripts/a-check.mjs");
  put("skills/broken/checks.json", "{");
  expect(findings(root)).toEqual([
    "broken: checks.json を JSON として読めない",
    "list: checks.json がオブジェクトでない",
  ]);
});
