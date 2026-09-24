// 証跡の持ち越し（skills/parity-suite/scripts/evidence-carry.mjs）のテスト fixture（Issue #454）。
//
// evidence-carry.test.js・artifact-health-check.test.js・component-comparison-check.test.js が共有する。
// git の差分を実物で取るため、一時ディレクトリに本物の git リポジトリを作ってコミットを積む（git を模さない）。
// 変更宣言・部品 metadata・機能 metadata は同梱テンプレートを読んで値だけ埋める（切り詰めた形を固定しない）。
// amend-verify の記録は pngjs を入れないため手で書くが、amend-verify.mjs の main が書く 1 組の形
// （pair / pass / outside_identical / … / inputs.{prev_new,new,current}.{path,sha256} / reasons）をそのまま持たせる。

import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");

/** @param {string} path */
const readTemplate = (path) => JSON.parse(readFileSync(join(repoRoot, path), "utf8"));

/** 機能 slug（artifact-health-check.test.js の makeProject と同じ）。 */
export const FEATURE = "order-list";
/** 新側 target。 */
export const TARGET = "local-dev";
/** 変更宣言の id。 */
export const CHANGE_ID = "hover-shadow";
/** 影響する組。 */
export const AFFECTED_PAIR = "list|hover|desktop";
/** 描画入力（git pathspec）。 */
export const RENDER_INPUTS = ["src/pages/orders.tsx", "src/components/**", "src/theme.css"];

/**
 * git を stdin を閉じて起動する。コミットの作者は -c で渡す（利用者の設定に依らない）。
 * @param {string} repo
 * @param {string[]} args
 * @returns {string}
 */
export function git(repo, args) {
  return execFileSync(
    "git",
    [
      "-C",
      repo,
      "-c",
      "user.name=fixture",
      "-c",
      "user.email=fixture@example.invalid",
      "-c",
      "commit.gpgsign=false",
      ...args,
    ],
    { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
  ).trim();
}

/**
 * ファイルを書いてコミットし、完全 SHA を返す。
 * @param {string} repo
 * @param {Record<string, string>} files リポジトリ相対パス → 中身
 * @param {string} message
 * @returns {string}
 */
export function commit(repo, files, message) {
  for (const [path, body] of Object.entries(files)) {
    mkdirSync(dirname(join(repo, path)), { recursive: true });
    writeFileSync(join(repo, path), body);
  }
  git(repo, ["add", "-A"]);
  git(repo, ["commit", "-q", "-m", message]);
  return git(repo, ["rev-parse", "HEAD"]);
}

/**
 * @param {string} path
 * @param {unknown} value
 */
export function writeJson(path, value) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`);
}

/**
 * 機能 metadata（parity-suite の雛形から）。
 * @param {[string, string, string][]} scope
 * @returns {Record<string, any>}
 */
export function featureMetadata(scope) {
  const metadata = readTemplate("skills/parity-suite/assets/metadata-template.json");
  metadata.slug = FEATURE;
  metadata.mode = "feature";
  const conditions = metadata.capture_conditions;
  conditions.pages = [{ ...conditions.pages[0], name: "list", path: "/orders" }];
  conditions.states = ["default", "hover"];
  const shape = conditions.capture_scope[0];
  conditions.capture_scope = scope.map(([page, state, viewport]) => ({
    ...structuredClone(shape),
    page,
    state,
    viewport,
  }));
  return metadata;
}

/**
 * 部品 metadata（parity-component の雛形から）。インスタンスの page は target の baseURL からの相対パス
 * （雛形の語彙どおり。機能の capture_conditions.pages[].path と完全一致で照合する）。
 * @returns {Record<string, any>}
 */
export function componentMetadata() {
  const metadata = readTemplate("skills/parity-component/assets/metadata-template.json");
  metadata.slug = "button";
  const shape = metadata.instances[0];
  metadata.instances = [
    { id: "pager-next", page: "/orders", locator: "button: 次へ" },
    { id: "search-submit", page: "/search", locator: "button: 検索" },
  ].map((instance) => ({ ...structuredClone(shape), ...instance }));
  // 部品が採った状態の語彙（変更宣言の states はこの中から書く）
  metadata.capture.states = ["default", "hover"];
  return metadata;
}

/**
 * 変更宣言（parity-component の雛形から）。
 * @param {{ before: string, after: string, id?: string, files?: string[] }} options
 * @returns {Record<string, any>}
 */
export function changeDeclaration(options) {
  const change = readTemplate("skills/parity-component/assets/component-change-template.json");
  delete change._note;
  return Object.assign(change, {
    id: options.id ?? CHANGE_ID,
    slug: "button",
    kind: "align-to-current",
    reason: "hover の外周の影を現行に合わせた",
    instances: ["pager-next"],
    variants: ["fill-orange"],
    states: ["hover"],
    properties: ["box-shadow"],
    usages: ["/orders"],
    usages_source: "grep -rl 'components/Button' src/pages",
    files: options.files ?? ["src/components/Button.tsx"],
    commits: { before: options.before, after: options.after },
    margin_px: 4,
    cross_measurement: {
      record: ".replace/components/button/cross.json",
      instances: 2,
      states: ["hover"],
    },
    catalog_verification: {
      record: ".replace/components/button/parity.md#hover-shadow",
      outside_scope_identical: true,
      inside_matches_current: true,
    },
  });
}

/**
 * amend-verify の記録の 1 組。画像を書き、パスはプロジェクトルート相対で記録する
 * （amend-verify.mjs をプロジェクトルートで実行したときの記録と同じ）。
 * @param {string} root プロジェクトルート
 * @param {string} pair
 * @param {{ pass?: boolean }} [options]
 */
export function amendVerifyPair(root, pair, options = {}) {
  /** @type {Record<string, {path:string, sha256:string}>} */
  const inputs = {};
  for (const key of ["prev_new", "new", "current"]) {
    // 撮り直した新側（inputs.new）は採取の組のディレクトリの screenshot.png。隣の traits.json から領域を突き合わせる
    // 役割ごとの置き場所（evidence-carry.mjs の checkProvenance が突き合わせる）
    const at = pair.replaceAll("|", "/");
    const path = {
      new: `.replace/parity/${FEATURE}/new/${TARGET}/baseline-new/${at}/screenshot.png`,
      prev_new: `.replace/parity/${FEATURE}/new/${TARGET}/pre-change/${CHANGE_ID}/${at}/screenshot.png`,
      current: `.replace/parity/${FEATURE}/baseline/${at}/screenshot.png`,
    }[key];
    const body = `PNG ${pair} ${key}\n`;
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), body);
    inputs[key] = { path, sha256: createHash("sha256").update(body).digest("hex") };
    if (key === "new") {
      writeFileSync(
        join(root, dirname(path), "traits.json"),
        `${JSON.stringify([{ name: "button: 次へ", rect: { x: 10, y: 10, width: 80, height: 24 } }])}\n`,
      );
    }
  }
  const pass = options.pass ?? true;
  return {
    pair,
    pass,
    outside_identical: pass,
    outside_diff_pixels: pass ? 0 : 12,
    inside_diff_before: 40,
    inside_diff_after: pass ? 0 : 40,
    margin: 4,
    declared_regions: [{ x: 10, y: 10, width: 80, height: 24 }],
    regions: [{ x: 6, y: 6, width: 88, height: 32 }],
    inputs,
    reasons: pass ? [] : ["outside the declared region differs from the previous new capture"],
  };
}

/**
 * 持ち越しの fixture 一式を作る。
 *
 * 新側リポジトリ（<root>/app）の履歴: base（初期）→ component（Button.tsx を宣言どおり直す）。以降のコミットは各テストが積む。
 * 変更宣言 hover-shadow は base → component。記録の版 base・今の版 component が既定。
 * `root` を渡すと既存のプロジェクト（artifact-health-check.test.js の makeProject 等）へ足し、
 * 機能の metadata.json は書かない（呼び出し側が featureMetadata の capture_conditions を写す）。
 * @param {{ scope?: [string, string, string][], root?: string }} [options]
 */
export function makeCarryProject(options = {}) {
  const root = options.root ?? mkdtempSync(join(tmpdir(), "evidence-carry-"));
  const repo = join(root, "app");
  mkdirSync(repo, { recursive: true });
  git(repo, ["init", "-q"]);
  const base = commit(
    repo,
    {
      "src/pages/orders.tsx": "export const Orders = () => <Button />;\n",
      "src/components/Button.tsx": "export const Button = () => <button />;\n",
      "src/theme.css": ":root { --accent: orange; }\n",
      "README.md": "app\n",
    },
    "base",
  );
  const component = commit(
    repo,
    { "src/components/Button.tsx": "export const Button = () => <button className='shadow' />;\n" },
    "button hover shadow",
  );
  const replaceRoot = join(root, ".replace");
  const slugDir = join(replaceRoot, "parity", FEATURE);
  const stageDir = join(slugDir, "new", TARGET);
  const changePath = ".replace/components/button/changes/hover-shadow.json";
  const recordPath = `.replace/parity/${FEATURE}/new/${TARGET}/amend-verify.json`;
  const scope = options.scope ?? [
    ["list", "default", "desktop"],
    ["list", "hover", "desktop"],
  ];
  if (options.root === undefined) writeJson(join(slugDir, "metadata.json"), featureMetadata(scope));
  writeJson(join(replaceRoot, "components/button/metadata.json"), componentMetadata());
  writeJson(join(root, changePath), changeDeclaration({ before: base, after: component }));
  writeJson(join(root, recordPath), {
    tool: "amend-verify",
    version: "1",
    change_id: CHANGE_ID,
    pairs: [amendVerifyPair(root, AFFECTED_PAIR)],
  });
  const evidenceCarryPath = join(stageDir, "evidence-carry.json");
  writeJson(evidenceCarryPath, { carries: [{ change: changePath, amend_verify: recordPath }] });
  return {
    root,
    repo,
    replaceRoot,
    slugDir,
    stageDir,
    changePath,
    recordPath,
    evidenceCarryPath,
    commits: { base, component },
  };
}
