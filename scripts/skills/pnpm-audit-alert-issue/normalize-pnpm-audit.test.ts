// pnpm audit の JSON を、dependabot-alert-issue の外部 audit findings の形に正規化するスクリプトのテスト。
//
// 期待値は次の仕様から決める。
// - `.agents/skills/pnpm-audit-alert-issue/SKILL.md` の「正規化 JSON」の例
//   （ecosystem は npm、manifest は pnpm-lock.yaml、scope は unknown、advisory_url は GHSA の URL）
// - `skills/dependabot-alert-issue/SKILL.md` の「外部 audit findings 入力」
//   同じ package と ghsa の組はまとめ、current_versions と dependency_paths の重複を除く。
//   patched_versions を 1 つの版に変えられなければ、patched を空にする。
//
// pnpm audit の JSON は版で形が変わる。古い形は `advisories`（id ごとの advisory と findings）、
// 新しい形は `vulnerabilities`（パッケージごとの via・nodes・fixAvailable）を持つ。
// 分岐の組み合わせは関数の粒度で確かめ、CLI の粒度は引数・終了コード・出力ファイルのつなぎだけに絞る。
import { describe, expect, test } from "vitest";
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, symlinkSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  type AuditJson,
  type Finding,
  findingsFromVulnerability,
  fromAdvisory,
  normalizeAudit,
} from "../../../.agents/skills/pnpm-audit-alert-issue/scripts/normalize-pnpm-audit.ts";
import { parseJsonAs } from "../../lib/parse-as.ts";
import { coverageEnv } from "../../lib/testing/coverage-env.ts";
import { makeTempDir } from "../../lib/testing/test-tmpdir.ts";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const skillDir = join(repoRoot, ".agents/skills/pnpm-audit-alert-issue");
const script = join(skillDir, "scripts/normalize-pnpm-audit.ts");

// 大文字と小文字の扱いを分けて確かめるため、ほとんどのテストは数字だけの id を使う。
const GHSA = "GHSA-2345-6789-2345";
const GHSA_URL = `https://github.com/advisories/${GHSA}`;

/** 型の合わない入力（audit の JSON は形を確かめずに読む）を、CLI と同じ読み方で作る。 */
function auditJson(value: unknown): AuditJson {
  return parseJsonAs<AuditJson>(JSON.stringify(value));
}

/** 仕様の例と同じ固定の欄を持つ finding。 */
function finding(fields: Partial<Finding>): Finding {
  return {
    package: "",
    ecosystem: "npm",
    severity: "unknown",
    ghsa: "",
    advisory_url: "",
    title: "",
    vulnerable_versions: "",
    patched_versions: "",
    patched: "",
    current_versions: [],
    dependency_paths: [],
    manifest: "pnpm-lock.yaml",
    scope: "unknown",
    ...fields,
  };
}

describe("fromAdvisory（古い形の advisories の 1 件）", () => {
  test("advisory の欄から finding を作り、findings の版とパスを重複なく集める", () => {
    expect(
      fromAdvisory({
        module_name: "example",
        severity: "high",
        github_advisory_id: GHSA,
        url: GHSA_URL,
        title: "Advisory title",
        vulnerable_versions: "<1.2.3",
        patched_versions: ">=1.2.3",
        findings: [
          { version: "1.0.0", paths: ["project>example"] },
          { version: "1.0.0", paths: ["project>parent>example", "project>example"] },
        ],
      }),
    ).toEqual(
      finding({
        package: "example",
        severity: "high",
        ghsa: GHSA,
        advisory_url: GHSA_URL,
        title: "Advisory title",
        vulnerable_versions: "<1.2.3",
        patched_versions: ">=1.2.3",
        patched: "1.2.3",
        current_versions: ["1.0.0"],
        dependency_paths: ["project>example", "project>parent>example"],
      }),
    );
  });

  test("advisory の URL が無ければ、GHSA から GitHub の advisory の URL を作る", () => {
    const result = fromAdvisory({ module_name: "example", github_advisory_id: GHSA });
    expect(result.advisory_url).toBe(GHSA_URL);
  });

  // GitHub の advisory の id は、接頭辞の GHSA だけが大文字で、本体は小文字である（#662）。
  // Dependabot alerts の ghsa_id と、却下のルールの例（dependabot-alert-issue の SKILL.md）も、この表記である。
  test.each([
    ["小文字", "ghsa-238p-pmpm-9mq7"],
    ["大文字", "GHSA-238P-PMPM-9MQ7"],
    ["GitHub の表記", "GHSA-238p-pmpm-9mq7"],
  ])("GHSA の id は、%sでも GitHub の表記にそろえる", (_label, id) => {
    expect(fromAdvisory({ module_name: "x", ghsa_id: id }).ghsa).toBe("GHSA-238p-pmpm-9mq7");
  });

  test("advisory の URL から取った GHSA の id も、GitHub の表記にそろえる", () => {
    const url = "https://github.com/advisories/GHSA-238P-PMPM-9MQ7";
    expect(fromAdvisory({ module_name: "x", url }).ghsa).toBe("GHSA-238p-pmpm-9mq7");
  });

  test.each([
    ["最後のかたまりが 5 文字", "GHSA-abcd-efgh-ijklm"],
    ["最後のかたまりに数字が続く", "GHSA-2345-6789-23456"],
    ["前に英字が付く", "XGHSA-abcd-efgh-ijkl"],
    ["前に数字が付く", "1GHSA-2345-6789-2345"],
    ["後ろに - で続く", "GHSA-abcd-efgh-ijkl-mnop"],
  ])("GHSA の形に収まらない id（%s）からは、切り詰めた id を取り出さない", (_label, id) => {
    expect(fromAdvisory({ module_name: "x", title: id }).ghsa).toBe("");
  });

  test.each([
    ["前に _ が付く", "github_GHSA-abcd-efgh-2345"],
    ["後ろに _ が続く", "GHSA-abcd-efgh-2345_x"],
  ])("%s GHSA の id は取り出す（_ は英数字として扱わない）", (_label, id) => {
    expect(fromAdvisory({ module_name: "x", title: id }).ghsa).toBe("GHSA-abcd-efgh-2345");
  });

  test.each([
    ["title", { title: "npm-GHSA-238P-PMPM-9MQ7" }],
    ["ghsa_id", { ghsa_id: "npm-GHSA-238P-PMPM-9MQ7" }],
  ])(
    "前に - で語が付いた GHSA の id も、%s から取り出して GitHub の表記にそろえる",
    (_label, fields) => {
      expect(fromAdvisory({ module_name: "x", ...fields }).ghsa).toBe("GHSA-238p-pmpm-9mq7");
    },
  );

  test.each([
    ["url", { url: GHSA_URL }],
    ["source", { source: `github ${GHSA}` }],
    ["title", { title: `${GHSA}: prototype pollution` }],
  ])("GHSA の id の欄が無ければ、%s の中の GHSA を使う", (_label, fields) => {
    expect(fromAdvisory({ module_name: "x", ...fields }).ghsa).toBe(GHSA);
  });

  test("GHSA がどこにも無く URL も無ければ、ghsa と advisory_url は空にする", () => {
    const result = fromAdvisory({ module_name: "x", title: "no id" });
    expect(result.ghsa).toBe("");
    expect(result.advisory_url).toBe("");
  });

  test.each([
    ["high", "high"],
    ["CRITICAL", "critical"],
    ["moderate", "moderate"],
    ["medium", "medium"],
    ["low", "low"],
    ["info", "unknown"],
    [undefined, "unknown"],
    [3, "unknown"],
  ])("severity %s は %s にする", (severity, expected) => {
    expect(fromAdvisory({ module_name: "x", severity }).severity).toBe(expected);
  });

  test.each([
    [">=1.2.3", "1.2.3"],
    [">= 2.0.1", "2.0.1"],
    [">=4.17.21 || >=5.0.0", "4.17.21"],
    // 修正版の無い advisory（npm は <0.0.0 で表す）は、1 つの版に変えられないので patched を空にする。
    ["<0.0.0", ""],
    ["", ""],
  ])("patched_versions %j から patched %j を作る", (range, expected) => {
    const result = fromAdvisory({ module_name: "x", patched_versions: range });
    expect(result.patched_versions).toBe(range);
    expect(result.patched).toBe(expected);
  });

  test("別名の欄（name・patchedVersions・range・overview）からも読む", () => {
    expect(
      fromAdvisory({
        name: "example",
        patchedVersions: ">=1.2.3",
        range: "<1.2.3",
        overview: "Overview text",
      }),
    ).toEqual(
      finding({
        package: "example",
        title: "Overview text",
        vulnerable_versions: "<1.2.3",
        patched_versions: ">=1.2.3",
        patched: "1.2.3",
      }),
    );
  });

  test("文字列でない欄は空として扱う", () => {
    const result = fromAdvisory({ module_name: 1, title: ["t"], patched_versions: 2 });
    expect(result.package).toBe("");
    expect(result.title).toBe("");
    expect(result.patched).toBe("");
  });

  test("findings の要素が配列でない単独の値でも、版とパスを読む", () => {
    const result = fromAdvisory({
      module_name: "x",
      findings: { version: "1.0.0", paths: "project>x" },
    });
    expect(result.current_versions).toEqual(["1.0.0"]);
    expect(result.dependency_paths).toEqual(["project>x"]);
  });

  test("findings のスカラーの要素と空の版は読まずに飛ばす", () => {
    const result = fromAdvisory({
      module_name: "x",
      findings: ["text", 3, { version: "", paths: [] }, { version: "2.0.0" }],
    });
    expect(result.current_versions).toEqual(["2.0.0"]);
    expect(result.dependency_paths).toEqual([]);
  });

  test("findings の要素が null なら、欄を読めないので例外にする", () => {
    expect(() => fromAdvisory({ module_name: "x", findings: [null] })).toThrow(TypeError);
  });
});

describe("findingsFromVulnerability（新しい形の vulnerabilities の 1 件）", () => {
  test("via の advisory と fixAvailable と packages から finding を作る", () => {
    expect(
      findingsFromVulnerability(
        "example",
        {
          severity: "high",
          range: "<1.2.3",
          nodes: ["node_modules/example"],
          via: [
            {
              source: 1096,
              name: "example",
              dependency: "example",
              title: "Advisory title",
              url: GHSA_URL,
              severity: "moderate",
              range: "<1.2.3",
            },
          ],
          fixAvailable: { name: "example", version: "1.2.3", isSemVerMajor: false },
        },
        { "node_modules/example": { version: "1.0.0" } },
      ),
    ).toEqual([
      finding({
        package: "example",
        severity: "moderate",
        ghsa: GHSA,
        advisory_url: GHSA_URL,
        title: "Advisory title",
        vulnerable_versions: "<1.2.3",
        patched_versions: ">=1.2.3",
        patched: "1.2.3",
        current_versions: ["1.0.0"],
        dependency_paths: ["node_modules/example"],
      }),
    ]);
  });

  test("via の文字列の GHSA の前に - で語が付いていても、advisory として読む", () => {
    const [result] = findingsFromVulnerability(
      "x",
      { via: ["advisory-GHSA-238P-PMPM-9MQ7"] },
      undefined,
    );
    expect(result.ghsa).toBe("GHSA-238p-pmpm-9mq7");
  });

  test("via の advisory に severity が無ければ、パッケージの severity を使う", () => {
    const [result] = findingsFromVulnerability(
      "x",
      { severity: "critical", via: [{ url: GHSA_URL }] },
      undefined,
    );
    expect(result.severity).toBe("critical");
  });

  test("advisory の patched_versions があれば、fixAvailable の版より patched_versions を書く", () => {
    const [result] = findingsFromVulnerability(
      "x",
      { via: [{ url: GHSA_URL, patched_versions: ">=2.0.0" }], fixAvailable: { version: "3.0.0" } },
      undefined,
    );
    expect(result.patched_versions).toBe(">=2.0.0");
    expect(result.patched).toBe("3.0.0");
  });

  test("fixAvailable が true だけで版を持たなければ、patched は advisory の範囲から作る", () => {
    const [result] = findingsFromVulnerability(
      "x",
      { via: [{ url: GHSA_URL, patched_versions: ">=2.0.0" }], fixAvailable: true },
      undefined,
    );
    expect(result.patched).toBe("2.0.0");
  });

  test("修正版が無ければ、patched_versions と patched を空にする", () => {
    const [result] = findingsFromVulnerability(
      "x",
      { via: [{ url: GHSA_URL }], fixAvailable: false },
      undefined,
    );
    expect(result.patched_versions).toBe("");
    expect(result.patched).toBe("");
  });

  test("via が GHSA の文字列なら、GHSA から advisory の URL と title を作る", () => {
    const [result] = findingsFromVulnerability("x", { via: [GHSA] }, undefined);
    expect(result.ghsa).toBe(GHSA);
    expect(result.advisory_url).toBe(GHSA_URL);
    expect(result.title).toBe(GHSA);
  });

  test("via が GHSA を含まない URL なら、その URL を advisory_url と title にする", () => {
    const url = "https://example.test/advisory/42";
    const [result] = findingsFromVulnerability("x", { via: url }, undefined);
    expect(result.ghsa).toBe("");
    expect(result.advisory_url).toBe(url);
    expect(result.title).toBe(url);
  });

  test("via がパッケージ名だけ（推移的な脆弱性）なら、パッケージの欄だけで 1 件にする", () => {
    expect(
      findingsFromVulnerability(
        "parent",
        {
          severity: "high",
          range: "1.0.0 - 1.4.0",
          via: ["child"],
          nodes: ["node_modules/parent"],
        },
        { "node_modules/parent": { version: "1.3.0" } },
      ),
    ).toEqual([
      finding({
        package: "parent",
        severity: "high",
        vulnerable_versions: "1.0.0 - 1.4.0",
        current_versions: ["1.3.0"],
        dependency_paths: ["node_modules/parent"],
      }),
    ]);
  });

  test("via が無ければ、パッケージの欄だけで 1 件にする", () => {
    const result = findingsFromVulnerability("x", {}, undefined);
    expect(result).toEqual([finding({ package: "x" })]);
  });

  test("advisory を表す via が複数あれば、via ごとに 1 件にする", () => {
    const other = "GHSA-3456-7892-3456";
    const result = findingsFromVulnerability(
      "x",
      { via: [{ url: GHSA_URL }, "child", { github_advisory_id: other }] },
      undefined,
    );
    expect(result.map((item) => item.ghsa)).toEqual([GHSA, other]);
  });

  test("via の advisory の dependency と name を、キーのパッケージ名より優先する", () => {
    const [byDependency] = findingsFromVulnerability(
      "key",
      { via: [{ dependency: "dep", name: "named", url: GHSA_URL }] },
      undefined,
    );
    const [byName] = findingsFromVulnerability(
      "key",
      { via: [{ name: "named", url: GHSA_URL }] },
      undefined,
    );
    expect(byDependency.package).toBe("dep");
    expect(byName.package).toBe("named");
  });

  test("今の版を、nodes・version・パッケージ名・node_modules のパスから重複なく集める", () => {
    const result = findingsFromVulnerability(
      "x",
      { version: "1.0.0", nodes: ["node_modules/a/node_modules/x", "node_modules/x"] },
      {
        "node_modules/a/node_modules/x": { version: "0.9.0" },
        "node_modules/x": { version: "1.0.0" },
        x: { version: "1.1.0" },
      },
    );
    expect(result[0].current_versions.toSorted()).toEqual(["0.9.0", "1.0.0", "1.1.0"]);
  });

  test("packages に無い nodes の版は書かない", () => {
    const [result] = findingsFromVulnerability("x", { nodes: ["node_modules/x"] }, {});
    expect(result.current_versions).toEqual([]);
    expect(result.dependency_paths).toEqual(["node_modules/x"]);
  });
});

describe("normalizeAudit（audit の JSON 全体）", () => {
  test("advisories も vulnerabilities も無ければ、findings は 0 件", () => {
    expect(normalizeAudit({})).toEqual([]);
  });

  test("packages の項目が null なら版は無いものとして読み、どの vulnerability も読まない項目の形は確かめない", () => {
    const result = normalizeAudit(
      auditJson({
        vulnerabilities: { x: { severity: "high" } },
        packages: { "node_modules/x": null, "node_modules/unrelated": "link:../y" },
      }),
    );
    expect(result).toHaveLength(1);
    expect(result[0]?.current_versions).toEqual([]);
  });

  test("advisories・vulnerabilities・packages が null なら、その欄は無いものとして読む", () => {
    expect(
      normalizeAudit(auditJson({ advisories: null, vulnerabilities: null, packages: null })),
    ).toEqual([]);
  });

  // 形が違う要素を読み飛ばすと、その advisory を警告なしに落とす。どこが違うかを書いた Error で止める。
  test.each([
    ["全体が null", null, /全体が object でない/],
    ["全体が配列", [], /全体が object でない/],
    ["advisories の値が null", { advisories: { "7": null } }, /advisories\.7 が object でない/],
    [
      "vulnerabilities の値が null",
      { vulnerabilities: { x: null } },
      /vulnerabilities\.x が object でない/,
    ],
    ["advisories の値が配列", { advisories: { "7": [] } }, /advisories\.7 が object でない/],
    [
      "vulnerabilities の値が配列",
      { vulnerabilities: { x: [] } },
      /vulnerabilities\.x が object でない/,
    ],
    ["advisories が文字列", { advisories: "x" }, /advisories が object でない/],
    ["advisories が配列", { advisories: [] }, /advisories が object でない/],
    ["vulnerabilities が数", { vulnerabilities: 1 }, /vulnerabilities が object でない/],
    ["packages が配列", { packages: [] }, /packages が object でない/],
    ["packages が文字列", { packages: "x" }, /packages が object でない/],
    [
      "読む packages の項目が文字列",
      { vulnerabilities: { x: { severity: "high" } }, packages: { "node_modules/x": "1.2.3" } },
      /packages\.node_modules\/x が object でない/,
    ],
    [
      "読む packages の項目が配列",
      { vulnerabilities: { x: { severity: "high" } }, packages: { "node_modules/x": [] } },
      /packages\.node_modules\/x が object でない/,
    ],
  ])("%s なら、どこが違うかを書いた Error を投げる", (_label, raw, message) => {
    expect(() => normalizeAudit(raw)).toThrow(message);
  });

  test("古い形と新しい形の両方を読む", () => {
    const result = normalizeAudit(
      auditJson({
        advisories: { "1": { module_name: "old", github_advisory_id: GHSA } },
        vulnerabilities: { new: { severity: "low", via: [] } },
      }),
    );
    expect(result.map((item) => item.package).toSorted()).toEqual(["new", "old"]);
  });

  test("package を決められない finding は出力しない", () => {
    expect(normalizeAudit(auditJson({ advisories: { "1": { title: "no package" } } }))).toEqual([]);
  });

  test("同じ package と ghsa の組は 1 件にまとめ、版・パス・範囲の重複を除く", () => {
    const result = normalizeAudit(
      auditJson({
        advisories: {
          "1": {
            module_name: "example",
            github_advisory_id: GHSA,
            vulnerable_versions: "<1.2.3",
            findings: [{ version: "1.0.0", paths: ["project>a>example"] }],
          },
          "2": {
            module_name: "example",
            github_advisory_id: GHSA,
            vulnerable_versions: ">=2.0.0 <2.0.5; <1.2.3",
            patched_versions: ">=1.2.3",
            findings: [
              { version: "1.0.0", paths: ["project>b>example"] },
              { version: "2.0.1", paths: ["project>a>example"] },
            ],
          },
        },
      }),
    );
    expect(result).toHaveLength(1);
    expect(result[0].current_versions).toEqual(["1.0.0", "2.0.1"]);
    expect(result[0].dependency_paths).toEqual(["project>a>example", "project>b>example"]);
    expect(result[0].vulnerable_versions).toBe("<1.2.3; >=2.0.0 <2.0.5");
    expect(result[0].patched_versions).toBe(">=1.2.3");
    expect(result[0].patched).toBe("1.2.3");
  });

  test("古い形と新しい形に同じ組があれば、欠けた欄を後の finding で補う", () => {
    const result = normalizeAudit(
      auditJson({
        advisories: {
          "1": {
            module_name: "example",
            github_advisory_id: GHSA,
            findings: [{ version: "1.0.0" }],
          },
        },
        vulnerabilities: {
          example: {
            via: [{ github_advisory_id: GHSA, url: "https://example.test/a" }],
            fixAvailable: { version: "1.2.3" },
            version: "1.1.0",
          },
        },
      }),
    );
    expect(result).toHaveLength(1);
    expect(result[0].current_versions).toEqual(["1.0.0", "1.1.0"]);
    expect(result[0].patched).toBe("1.2.3");
    expect(result[0].patched_versions).toBe(">=1.2.3");
    // 前の finding が GHSA から作った URL を持つので、後の finding の URL では上書きしない。
    expect(result[0].advisory_url).toBe(GHSA_URL);
  });

  test("ghsa と URL の無い finding は、package と title の組でまとめる", () => {
    const result = normalizeAudit(
      auditJson({
        advisories: {
          "1": { module_name: "x", title: "same", findings: [{ version: "1.0.0" }] },
          "2": { module_name: "x", title: "same", findings: [{ version: "1.1.0" }] },
          "3": { module_name: "x", title: "other" },
        },
      }),
    );
    expect(result.map((item) => [item.title, item.current_versions])).toEqual([
      ["same", ["1.0.0", "1.1.0"]],
      ["other", []],
    ]);
  });

  test("advisory の URL が同じでも、ghsa の有無が違えば別の finding にする", () => {
    const url = "https://example.test/advisory/7";
    const result = normalizeAudit(
      auditJson({
        advisories: {
          "1": { module_name: "x", url },
          "2": { module_name: "x", url, ghsa: GHSA },
        },
      }),
    );
    expect(result.map((item) => item.ghsa)).toEqual(["", GHSA]);
  });

  test("package が同じでも ghsa が違えば別の finding にする", () => {
    const result = normalizeAudit(
      auditJson({
        advisories: {
          "1": { module_name: "x", github_advisory_id: GHSA },
          "2": { module_name: "x", github_advisory_id: "GHSA-3456-7892-3456" },
        },
      }),
    );
    expect(result).toHaveLength(2);
  });

  test("ghsa が同じでも package が違えば別の finding にする", () => {
    const result = normalizeAudit(
      auditJson({
        advisories: {
          "1": { module_name: "x", github_advisory_id: GHSA },
          "2": { module_name: "y", github_advisory_id: GHSA },
        },
      }),
    );
    expect(result).toHaveLength(2);
  });
});

describe("CLI", () => {
  function run(args: string[]) {
    return spawnSync(process.execPath, [script, ...args], {
      encoding: "utf8",
      env: { PATH: process.env.PATH ?? "", ...coverageEnv() },
      timeout: 20_000,
    });
  }

  test("audit の JSON を読み、外部 audit findings の JSON を書いて exit 0", () => {
    const dir = makeTempDir("normalize-pnpm-audit-");
    const input = join(dir, "audit.json");
    const output = join(dir, "findings.json");
    writeFileSync(
      input,
      JSON.stringify({
        advisories: {
          "1": {
            module_name: "example",
            severity: "high",
            github_advisory_id: GHSA,
            patched_versions: ">=1.2.3",
          },
        },
      }),
    );

    const result = run([input, output]);

    expect(result.status).toBe(0);
    const written = parseJsonAs<{ source: unknown; generated_at: string; findings: unknown }>(
      readFileSync(output, "utf8"),
    );
    expect(written.source).toBe("pnpm-audit");
    expect(new Date(written.generated_at).toISOString()).toBe(written.generated_at);
    expect(written.findings).toEqual([
      finding({
        package: "example",
        severity: "high",
        ghsa: GHSA,
        advisory_url: GHSA_URL,
        patched_versions: ">=1.2.3",
        patched: "1.2.3",
      }),
    ]);
  });

  test("引数が 1 つなら Usage を出して exit 2、出力を書かない", () => {
    const dir = makeTempDir("normalize-pnpm-audit-");
    const input = join(dir, "audit.json");
    writeFileSync(input, "{}");

    const result = run([input]);

    expect(result.status).toBe(2);
    expect(result.stderr).toMatch(/^Usage: normalize-pnpm-audit\.ts /m);
  });

  test.each([
    ["無いファイル", null, /Failed to read pnpm audit JSON/],
    ["空のファイル", " \n", /Failed to parse pnpm audit JSON: .* is empty/],
    ["JSON でないファイル", "{not json", /Failed to parse pnpm audit JSON/],
    [
      "全体が null の JSON",
      "null",
      /Failed to normalize pnpm audit JSON: .*: 全体が object でない/,
    ],
    [
      "findings の要素が null の JSON",
      JSON.stringify({ advisories: { "1": { module_name: "x", findings: [null] } } }),
      /Failed to normalize pnpm audit JSON: .*: advisory\.findings の要素が null で、欄を読めない/,
    ],
  ])("%s は理由を出して exit 1、出力を書かない", (_label, content, message) => {
    const dir = makeTempDir("normalize-pnpm-audit-");
    const input = join(dir, "audit.json");
    const output = join(dir, "findings.json");
    if (content !== null) writeFileSync(input, content);

    const result = run([input, output]);

    expect(result.status).toBe(1);
    expect(result.stderr).toMatch(message);
    expect(existsSync(output)).toBe(false);
  });

  test("スキルのディレクトリへのシンボリックリンクから起動しても、引数の不足を exit 2 で知らせる", () => {
    const dir = makeTempDir("normalize-pnpm-audit-");
    symlinkSync(skillDir, join(dir, "pnpm-audit-alert-issue"));
    const viaLink = join(dir, "pnpm-audit-alert-issue/scripts/normalize-pnpm-audit.ts");

    const result = spawnSync(process.execPath, [viaLink], {
      encoding: "utf8",
      env: { PATH: process.env.PATH ?? "", ...coverageEnv() },
      timeout: 20_000,
    });

    expect(result.status).toBe(2);
    expect(result.stderr).toMatch(/^Usage: /m);
  });
});
