// replace-strategy の追記専用チェッカ（append-only-check.mjs）の回帰テスト（Issue #310）。
//
// スキル群は決定を積み上げる成果物への書き込みを「非破壊追記」と定めているが、追記であることを
// 確かめる道具が無いと、積み上げた文書を丸ごと書き直しても現在の内容が整合していれば全部通る。
// 失われるのは過去の決定（なぜ許容したか・いつ誰が承認したか）で、収束の判定は現在の状態しか見ない。
//
// 陽性コントロール（追記だけなら exit 0、整形だけでは落ちない）を置く——これが無いと「常に落とす」実装と区別できない。
// 併せて、正本が明示的に求めるその場の更新（状態列の 未→済・Issue 列の 未起票→番号・版の +1・
// 空配列への最初の追記）を縮小に化けさせないことも測る——誤検出するゲートは収束を止めるだけで、
// 決定を 1 つも守らない。

import { test, expect } from "vitest";
import { spawnSync } from "node:child_process";
import {
  appendFileSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const script = join(repoRoot, "skills/replace-strategy/scripts/append-only-check.mjs");

const FEATURES = [
  "# 機能一覧",
  "",
  "- 最終更新: 2026-09-01T00:00:00Z",
  "",
  "| slug | 名前 | 状態 | Issue |",
  "|---|---|---|---|",
  "| order-list | 注文一覧 | 済 | #11 |",
  "| order-edit | 注文編集 | 未 | 未起票 |",
  "",
].join("\n");

const DATASET = `${JSON.stringify({ version: 1, changes: [{ version: 1, affects: ["orders"] }] }, null, 2)}\n`;

const EXCEPTIONS = `${JSON.stringify(
  {
    version: 1,
    slug: "order-list",
    component_diff_exception_causes: [
      {
        id: "font-subset",
        reason: "サブセット差",
        evidence: "component-diff-exceptions.md#font-subset",
      },
    ],
    component_diff_exceptions: [
      {
        slug: "order-list",
        page: "/orders",
        element: "grid",
        cause: "font-subset",
        approved_at: "2026-09-01T00:00:00Z",
      },
      {
        slug: "order-list",
        page: "/users",
        element: "grid",
        cause: "font-subset",
        approved_at: "2026-09-10T00:00:00Z",
      },
    ],
  },
  null,
  2,
)}\n`;

const PARITY_METADATA = `${JSON.stringify(
  {
    slug: "order-list",
    unmeasured: {
      declared: true,
      entries: [
        {
          item: "一覧の空状態",
          reason: "シードが無い",
          disposition: "blocking",
          approved_by: null,
          approved_at: null,
        },
        {
          item: "モバイル幅",
          reason: "撮っていない",
          disposition: "blocking",
          approved_by: null,
          approved_at: null,
        },
      ],
      reason: null,
    },
  },
  null,
  2,
)}\n`;

const ASSETS = [
  "# 移行元の静的資産の台帳（assets）",
  "",
  "- 最終更新: 2026-09-01T00:00:00Z",
  "",
  "## 方針",
  "",
  "| 種類 | ファイル・出どころ | 方針 | 状態 | 決定日・決めた工程 | 理由 |",
  "|---|---|---|---|---|---|",
  "| ロゴ | `logo.png` | 実体を写す | 有効 | 2026-09-01・setup | 再配布可を確認済み |",
  "| 本文の書体 | `body.woff2` | 実体を写す | 有効 | 2026-09-01・setup | 字形を一致させるため |",
  "",
].join("\n");

const GAPS = [
  "# 未検証領域",
  "",
  "| 箇所 | 種別 | 理由 |",
  "|---|---|---|",
  "| 一覧の空状態 | データ不足 | シードが無い |",
  "",
].join("\n");

const EMPTY_EXCEPTIONS = `${JSON.stringify(
  {
    version: 1,
    slug: "order-list",
    component_diff_exception_causes: [],
    component_diff_exceptions: [],
  },
  null,
  2,
)}\n`;

/**
 * git が使えるコミット済みのプロジェクトを作る。
 * @param {{ emptyExceptions?: boolean }} [opts]
 */
function makeRepo(opts = {}) {
  const root = mkdtempSync(join(tmpdir(), "append-only-"));
  mkdirSync(join(root, ".replace/parity/order-list"), { recursive: true });
  mkdirSync(join(root, ".replace/dataset"), { recursive: true });
  writeFileSync(join(root, ".replace/features.md"), FEATURES);
  writeFileSync(join(root, ".replace/parity/order-list/gaps.md"), GAPS);
  writeFileSync(join(root, ".replace/assets.md"), ASSETS);
  writeFileSync(join(root, ".replace/dataset/metadata.json"), DATASET);
  writeFileSync(
    join(root, ".replace/parity/order-list/component-diff-exceptions.json"),
    opts.emptyExceptions === true ? EMPTY_EXCEPTIONS : EXCEPTIONS,
  );
  writeFileSync(join(root, ".replace/parity/order-list/metadata.json"), PARITY_METADATA);
  for (const args of [
    ["init", "-q", "."],
    ["config", "user.email", "test@example.com"],
    ["config", "user.name", "test"],
    ["add", "-A"],
    ["commit", "-qm", "seed"],
  ]) {
    const r = spawnSync("git", ["-C", root, ...args], { encoding: "utf8" });
    if (r.status !== 0) throw new Error(`git ${args.join(" ")} failed: ${r.stderr}`);
  }
  return root;
}

/**
 * @param {string} root
 * @param {string[]} [extra]
 */
function run(root, extra = []) {
  const r = spawnSync(process.execPath, [script, "--root", root, ...extra], { encoding: "utf8" });
  return { status: r.status, stdout: r.stdout, stderr: r.stderr };
}

/**
 * 一覧を差し替える（unit の語彙・組み合わせを測るため）。
 * @param {string} root
 * @param {unknown[]} artifacts
 * @returns {string}
 */
function writeManifest(root, artifacts) {
  const path = join(root, "manifest.json");
  writeFileSync(path, JSON.stringify({ version: "2", artifacts }));
  return path;
}

test("陽性コントロール: 追記だけなら exit 0", () => {
  const root = makeRepo();
  appendFileSync(join(root, ".replace/features.md"), "| order-detail | 注文詳細 | 未 | 未起票 |\n");
  const r = run(root);
  expect(r.stdout).toMatch(/^ok: /m);
  expect(r.status).toBe(0);
  rmSync(root, { recursive: true, force: true });
});

test("行を消して書き直すと落ちる", () => {
  const root = makeRepo();
  writeFileSync(
    join(root, ".replace/features.md"),
    FEATURES.replace("| order-edit | 注文編集 | 未 | 未起票 |\n", ""),
  );
  const r = run(root);
  expect(r.stdout).toMatch(/1 件（unit: markdown-structure）が失われている/);
  expect(r.stdout).toMatch(/order-edit/);
  expect(r.status).toBe(1);
  rmSync(root, { recursive: true, force: true });
});

test("台帳ごと消すと落ちる", () => {
  const root = makeRepo();
  rmSync(join(root, ".replace/parity/order-list/gaps.md"));
  const r = run(root);
  expect(r.stdout).toMatch(/追記専用の成果物が消えている.*gaps\.md/);
  expect(r.status).toBe(1);
  rmSync(root, { recursive: true, force: true });
});

test("表の桁を詰め直しただけでは落ちない（空白を畳んで突き合わせる）", () => {
  const root = makeRepo();
  writeFileSync(
    join(root, ".replace/features.md"),
    FEATURES.replace(
      "| order-list | 注文一覧 | 済 | #11 |",
      "|   order-list |  注文一覧  |  済 |  #11   |",
    ),
  );
  const r = run(root);
  expect(r.status).toBe(0);
  rmSync(root, { recursive: true, force: true });
});

test("同じ行が 2 回在ったのが 1 回に減っても落ちる（多重度を見る）", () => {
  const root = makeRepo();
  const path = join(root, ".replace/features.md");
  appendFileSync(path, "| order-list | 注文一覧（別ページ） | 済 | #12 |\n");
  spawnSync("git", ["-C", root, "commit", "-qam", "dup"], { encoding: "utf8" });
  writeFileSync(path, FEATURES);
  const r = run(root);
  expect(r.stdout).toMatch(/1 件（unit: markdown-structure）が失われている/);
  expect(r.status).toBe(1);
  rmSync(root, { recursive: true, force: true });
});

test("追記専用の成果物が 1 件も無ければ合格に倒さない（exit 2）", () => {
  const root = mkdtempSync(join(tmpdir(), "append-only-empty-"));
  writeFileSync(join(root, "README.md"), "x\n");
  for (const args of [
    ["init", "-q", "."],
    ["config", "user.email", "test@example.com"],
    ["config", "user.name", "test"],
    ["add", "-A"],
    ["commit", "-qm", "init"],
  ]) {
    spawnSync("git", ["-C", root, ...args], { encoding: "utf8" });
  }
  const r = run(root);
  expect(r.stderr).toMatch(/対象 0 件を合格に倒さない/);
  expect(r.status).toBe(2);
  rmSync(root, { recursive: true, force: true });
});

test("git リポジトリでなければ合格に倒さない（exit 2）", () => {
  const root = mkdtempSync(join(tmpdir(), "append-only-nogit-"));
  const r = run(root);
  expect(r.stderr).toMatch(/git リポジトリではない/);
  expect(r.status).toBe(2);
  rmSync(root, { recursive: true, force: true });
});

test("比較元に無い新規ファイルは縮んでいないものとして扱う", () => {
  const root = makeRepo();
  writeFileSync(join(root, ".replace/components.md"), "# 共通部品\n\n| slug | 部品 |\n|---|---|\n");
  const r = run(root);
  expect(r.stdout).toMatch(/新規（比較元 HEAD に無い）: \.replace\/components\.md/);
  expect(r.status).toBe(0);
  rmSync(root, { recursive: true, force: true });
});

test("リポジトリの一階層下を --root に渡しても突き合わせが成立する", () => {
  // ls-tree の既定は cwd 相対、`git show <rev>:<path>` はトップレベル起点。揃えないと全件が
  // 「比較元に無い＝新規」に化け、行を消しても「比較元に在る成果物が 0 件」で落ちる（原因が別物に見える）。
  const repo = mkdtempSync(join(tmpdir(), "append-only-subdir-"));
  mkdirSync(join(repo, "app/.replace/parity/order-list"), { recursive: true });
  writeFileSync(join(repo, "README.md"), "x\n");
  writeFileSync(join(repo, "app/.replace/features.md"), FEATURES);
  writeFileSync(join(repo, "app/.replace/parity/order-list/gaps.md"), GAPS);
  for (const args of [
    ["init", "-q", "."],
    ["config", "user.email", "test@example.com"],
    ["config", "user.name", "test"],
    ["add", "-A"],
    ["commit", "-qm", "seed"],
  ]) {
    const r = spawnSync("git", ["-C", repo, ...args], { encoding: "utf8" });
    if (r.status !== 0) throw new Error(`git ${args.join(" ")} failed: ${r.stderr}`);
  }
  const root = join(repo, "app");

  // 陽性コントロール: 追記だけなら通る（「常に落とす」実装と区別する）。
  appendFileSync(join(root, ".replace/features.md"), "| order-detail | 注文詳細 | 未 | 未起票 |\n");
  const ok = run(root);
  expect(ok.stdout).toMatch(/比較元にも在る 2 件を突き合わせた/);
  expect(ok.status).toBe(0);

  // 行を消せば落ちる（突き合わせが実際に成立している）。
  writeFileSync(
    join(root, ".replace/features.md"),
    FEATURES.replace("| order-edit | 注文編集 | 未 | 未起票 |\n", ""),
  );
  const ng = run(root);
  expect(ng.stdout).toMatch(/1 件（unit: markdown-structure）が失われている/);
  expect(ng.stdout).toMatch(/order-edit/);
  expect(ng.status).toBe(1);
  rmSync(repo, { recursive: true, force: true });
});

test("比較元に在る追記専用の成果物が 0 件なら合格に倒さない（突き合わせが成立していない）", () => {
  const root = mkdtempSync(join(tmpdir(), "append-only-uncommitted-"));
  writeFileSync(join(root, "README.md"), "x\n");
  for (const args of [
    ["init", "-q", "."],
    ["config", "user.email", "test@example.com"],
    ["config", "user.name", "test"],
    ["add", "README.md"],
    ["commit", "-qm", "init"],
  ]) {
    spawnSync("git", ["-C", root, ...args], { encoding: "utf8" });
  }
  // 成果物は作業ツリーにあるが 1 度もコミットされていない（比較元 HEAD に無い）。
  mkdirSync(join(root, ".replace"), { recursive: true });
  writeFileSync(join(root, ".replace/features.md"), FEATURES);
  const r = run(root);
  expect(r.stdout).toMatch(/比較元 HEAD に在る追記専用の成果物が 0 件/);
  expect(r.status).toBe(1);
  rmSync(root, { recursive: true, force: true });
});

test("正本が求めるその場の更新（状態列 未→済・Issue 列 未起票→番号・最終更新）は縮小にしない", () => {
  const root = makeRepo();
  writeFileSync(
    join(root, ".replace/features.md"),
    FEATURES.replace(
      "| order-edit | 注文編集 | 未 | 未起票 |",
      "| order-edit | 注文編集 | 済 | #42 |",
    ).replace("- 最終更新: 2026-09-01T00:00:00Z", "- 最終更新: 2026-09-17T00:00:00Z"),
  );
  const r = run(root);
  expect(r.stdout).toMatch(/^ok: /m);
  expect(r.status).toBe(0);
  rmSync(root, { recursive: true, force: true });
});

test("列を足す非破壊更新は縮小にしない（区切り行の桁も変わる）", () => {
  const root = makeRepo();
  writeFileSync(
    join(root, ".replace/features.md"),
    FEATURES.replace(
      "| slug | 名前 | 状態 | Issue |",
      "| slug | 名前 | 状態 | Issue | 受け入れ条件 |",
    )
      .replace("|---|---|---|---|", "|---|---|---|---|---|")
      .replace("| order-list | 注文一覧 | 済 | #11 |", "| order-list | 注文一覧 | 済 | #11 | 済 |")
      .replace(
        "| order-edit | 注文編集 | 未 | 未起票 |",
        "| order-edit | 注文編集 | 未 | 未起票 | |",
      ),
  );
  const r = run(root);
  expect(r.status).toBe(0);
  rmSync(root, { recursive: true, force: true });
});

test("列を消すと落ちる（markdown-structure でも列は守る）", () => {
  const root = makeRepo();
  writeFileSync(
    join(root, ".replace/features.md"),
    FEATURES.replace("| slug | 名前 | 状態 | Issue |", "| slug | 名前 | 状態 |"),
  );
  const r = run(root);
  expect(r.stdout).toMatch(/Issue/);
  expect(r.status).toBe(1);
  rmSync(root, { recursive: true, force: true });
});

test("見出しを消すと落ちる（節に属する単位もまとめて失われる）", () => {
  const root = makeRepo();
  writeFileSync(join(root, ".replace/features.md"), FEATURES.replace("# 機能一覧\n", ""));
  const r = run(root);
  expect(r.stdout).toMatch(/H:機能一覧/);
  expect(r.stdout).toMatch(/（unit: markdown-structure）が失われている/);
  expect(r.status).toBe(1);
  rmSync(root, { recursive: true, force: true });
});

test("dataset の version を上げて changes を追記しても縮小にしない（json-arrays）", () => {
  const root = makeRepo();
  writeFileSync(
    join(root, ".replace/dataset/metadata.json"),
    `${JSON.stringify(
      {
        version: 2,
        changes: [
          { version: 1, affects: ["orders"] },
          { version: 2, affects: ["invoices"] },
        ],
      },
      null,
      2,
    )}\n`,
  );
  const r = run(root);
  expect(r.stdout).toMatch(/^ok: /m);
  expect(r.status).toBe(0);
  rmSync(root, { recursive: true, force: true });
});

test("dataset の過去の changes 要素を書き換えると落ちる（json-arrays の陽性コントロール）", () => {
  const root = makeRepo();
  writeFileSync(
    join(root, ".replace/dataset/metadata.json"),
    `${JSON.stringify({ version: 2, changes: [{ version: 2, affects: ["invoices"] }] }, null, 2)}\n`,
  );
  const r = run(root);
  expect(r.stdout).toMatch(/1 件（unit: json-arrays）が失われている/);
  expect(r.stdout).toMatch(/changes\|/);
  expect(r.status).toBe(1);
  rmSync(root, { recursive: true, force: true });
});

test("空の例外台帳へ最初の承認を追記しても縮小にしない", () => {
  const root = makeRepo({ emptyExceptions: true });
  writeFileSync(
    join(root, ".replace/parity/order-list/component-diff-exceptions.json"),
    `${JSON.stringify(
      {
        version: 1,
        slug: "order-list",
        component_diff_exception_causes: [
          {
            id: "font-subset",
            reason: "サブセット差",
            evidence: "component-diff-exceptions.md#font-subset",
          },
        ],
        component_diff_exceptions: [
          {
            slug: "order-list",
            page: "/orders",
            element: "none",
            viewport: "desktop",
            cause: "font-subset",
          },
        ],
      },
      null,
      2,
    )}\n`,
  );
  const r = run(root);
  expect(r.stdout).toMatch(/^ok: /m);
  expect(r.status).toBe(0);
  rmSync(root, { recursive: true, force: true });
});

test("一覧の unit が語彙外なら合格に倒さない（exit 2）", () => {
  const root = makeRepo();
  const manifest = writeManifest(root, [
    { id: "features", pattern: ".replace/features.md", unit: "diff" },
  ]);
  const r = run(root, ["--manifest", manifest]);
  expect(r.stderr).toMatch(/unit が語彙外/);
  expect(r.status).toBe(2);
  rmSync(root, { recursive: true, force: true });
});

test("unit が json-arrays なのに arrays が空なら合格に倒さない（exit 2）", () => {
  const root = makeRepo();
  const manifest = writeManifest(root, [
    { id: "dataset", pattern: ".replace/dataset/metadata.json", unit: "json-arrays", arrays: [] },
  ]);
  const r = run(root, ["--manifest", manifest]);
  expect(r.stderr).toMatch(/json-arrays なのに arrays が空/);
  expect(r.status).toBe(2);
  rmSync(root, { recursive: true, force: true });
});

test("同じファイルに突き合わせ方の違う項目が当たれば合格に倒さない（exit 2）", () => {
  const root = makeRepo();
  const manifest = writeManifest(root, [
    { id: "features-lines", pattern: ".replace/features.md", unit: "lines" },
    { id: "features-structure", pattern: ".replace/*.md", unit: "markdown-structure" },
  ]);
  const r = run(root, ["--manifest", manifest]);
  expect(r.stderr).toMatch(/突き合わせ方の違う一覧の項目が当たっている/);
  expect(r.status).toBe(2);
  rmSync(root, { recursive: true, force: true });
});

test("json-arrays の対象が JSON として壊れていれば合格に倒さない（exit 2）", () => {
  const root = makeRepo();
  writeFileSync(join(root, ".replace/dataset/metadata.json"), "{ broken\n");
  const r = run(root);
  expect(r.stderr).toMatch(/JSON として読めない/);
  expect(r.status).toBe(2);
  rmSync(root, { recursive: true, force: true });
});

test("unit を持たない旧い一覧は lines として読む（後方互換）", () => {
  const root = makeRepo();
  const manifest = writeManifest(root, [{ id: "features", pattern: ".replace/features.md" }]);
  // 状態列のその場の更新は lines では縮小になる（unit 既定が lines であることの証拠）。
  writeFileSync(
    join(root, ".replace/features.md"),
    FEATURES.replace(
      "| order-edit | 注文編集 | 未 | 未起票 |",
      "| order-edit | 注文編集 | 済 | #42 |",
    ),
  );
  const r = run(root, ["--manifest", manifest]);
  expect(r.stdout).toMatch(/1 件（unit: lines）が失われている/);
  expect(r.status).toBe(1);
  rmSync(root, { recursive: true, force: true });
});

test("比較元の木に在るのに内容を取り出せなければ合格に倒さない（exit 2）", () => {
  // gitlink（サブモジュール相当）は ls-tree に名前が出るのに `git show <rev>:<path>` が失敗する。
  // これを「比較元に無い＝新規」に倒すと、一部だけ取り出せないときに縮小が数えられないまま素通りする。
  const root = makeRepo();
  /** @param {string[]} args */
  const g = (args) => spawnSync("git", ["-C", root, ...args], { encoding: "utf8" });
  g([
    "update-index",
    "--add",
    "--cacheinfo",
    "160000,0000000000000000000000000000000000000001,.replace/parity/sub/gaps.md",
  ]);
  const tree = g(["write-tree"]).stdout.trim();
  const head = g(["rev-parse", "HEAD"]).stdout.trim();
  const commit = g(["commit-tree", tree, "-p", head, "-m", "link"]).stdout.trim();
  expect(commit).toMatch(/^[0-9a-f]{40}$/);
  g(["update-ref", "HEAD", commit]);
  const r = run(root);
  expect(r.stderr).toMatch(/木に在るのに内容を取り出せない/);
  expect(r.status).toBe(2);
  rmSync(root, { recursive: true, force: true });
});

test("例外の間で承認記録を入れ替えると落ちる（要素の同一性は深い等価で取る）", () => {
  // 行の多重集合では approved_at の 2 行が保たれて素通りする。どの例外を誰がいつ承認したかが入れ替わる。
  const root = makeRepo();
  const path = join(root, ".replace/parity/order-list/component-diff-exceptions.json");
  const doc = JSON.parse(readFileSync(path, "utf8"));
  const [a, b] = doc.component_diff_exceptions;
  [a.approved_at, b.approved_at] = [b.approved_at, a.approved_at];
  writeFileSync(path, `${JSON.stringify(doc, null, 2)}\n`);
  const r = run(root);
  expect(r.stdout).toMatch(/2 件（unit: json-arrays）が失われている/);
  expect(r.status).toBe(1);
  rmSync(root, { recursive: true, force: true });
});

test("未測定の項目を消すと落ちる（gaps.md を触らなくても捕まる）", () => {
  const root = makeRepo();
  const path = join(root, ".replace/parity/order-list/metadata.json");
  const doc = JSON.parse(readFileSync(path, "utf8"));
  doc.unmeasured.entries = doc.unmeasured.entries.filter((e) => e.item !== "モバイル幅");
  writeFileSync(path, `${JSON.stringify(doc, null, 2)}\n`);
  const r = run(root);
  expect(r.stdout).toMatch(
    /unmeasured\.entries の要素が失われている（item=モバイル幅: 比較元 1 件 → 現在 0 件）/,
  );
  expect(r.status).toBe(1);
  rmSync(root, { recursive: true, force: true });
});

test("未測定の blocking → accepted（承認の追記）は正規の遷移なので通す", () => {
  const root = makeRepo();
  const path = join(root, ".replace/parity/order-list/metadata.json");
  const doc = JSON.parse(readFileSync(path, "utf8"));
  const entry = doc.unmeasured.entries[1];
  entry.disposition = "accepted";
  entry.approved_by = "user";
  entry.approved_at = "2026-09-17T00:00:00Z";
  writeFileSync(path, `${JSON.stringify(doc, null, 2)}\n`);
  const r = run(root);
  expect(r.stdout).toMatch(/^ok: /m);
  expect(r.status).toBe(0);
  rmSync(root, { recursive: true, force: true });
});

test("key を宣言した配列の要素に鍵が無ければ合格に倒さない（exit 2）", () => {
  const root = makeRepo();
  const path = join(root, ".replace/parity/order-list/metadata.json");
  const doc = JSON.parse(readFileSync(path, "utf8"));
  doc.unmeasured.entries[0].item = "";
  writeFileSync(path, `${JSON.stringify(doc, null, 2)}\n`);
  const r = run(root);
  expect(r.stderr).toMatch(/空でない文字列の item が無い/);
  expect(r.status).toBe(2);
  rmSync(root, { recursive: true, force: true });
});

test("unit が json-arrays でないのに key があれば合格に倒さない（exit 2）", () => {
  const root = makeRepo();
  const manifest = writeManifest(root, [
    { id: "features", pattern: ".replace/features.md", unit: "markdown-structure", key: "item" },
  ]);
  const r = run(root, ["--manifest", manifest]);
  expect(r.stderr).toMatch(/unit が markdown-structure なのに key がある/);
  expect(r.status).toBe(2);
  rmSync(root, { recursive: true, force: true });
});

test("決定行の非鍵セルを書き換えると落ちる（鍵だけを残す書き換えを通さない）", () => {
  const root = makeRepo();
  writeFileSync(
    join(root, ".replace/assets.md"),
    ASSETS.replace(
      "| ロゴ | `logo.png` | 実体を写す | 有効 | 2026-09-01・setup | 再配布可を確認済み |",
      "| ロゴ | `logo.svg` | 同等物を作る | 有効 | 2026-09-17・order | 再配布不可のため |",
    ),
  );
  const r = run(root);
  expect(r.stdout).toMatch(/（unit: markdown-structure）が失われている/);
  expect(r.stdout).toMatch(/ロゴ@0\|/);
  expect(r.status).toBe(1);
  rmSync(root, { recursive: true, force: true });
});

test("assets.md の 状態 列は正本が更新を定めているので通す（mutable_columns）", () => {
  const root = makeRepo();
  writeFileSync(
    join(root, ".replace/assets.md"),
    ASSETS.replace(
      "| ロゴ | `logo.png` | 実体を写す | 有効 |",
      "| ロゴ | `logo.png` | 実体を写す | 取り消し済み（2026-09-17 → 下の行） |",
    ),
  );
  const r = run(root);
  expect(r.stdout).toMatch(/^ok: /m);
  expect(r.status).toBe(0);
  rmSync(root, { recursive: true, force: true });
});

test("承認済みの未測定項目の承認日時を差し替えると落ちる（fill_only は空 → 非空だけ）", () => {
  const root = makeRepo();
  const path = join(root, ".replace/parity/order-list/metadata.json");
  const doc = JSON.parse(readFileSync(path, "utf8"));
  const entry = doc.unmeasured.entries[1];
  entry.disposition = "accepted";
  entry.approved_by = "user";
  entry.approved_at = "2026-09-17T00:00:00Z";
  writeFileSync(path, `${JSON.stringify(doc, null, 2)}\n`);
  const g = (args) => spawnSync("git", ["-C", root, ...args], { encoding: "utf8" });
  g(["commit", "-qam", "approve"]);
  // ここまでが正規の遷移。以降は承認記録の差し替え。
  entry.approved_by = "someone-else";
  entry.approved_at = "2026-01-01T00:00:00Z";
  writeFileSync(path, `${JSON.stringify(doc, null, 2)}\n`);
  const r = run(root);
  expect(r.stdout).toMatch(/approved_by が空でない値から書き換えられている/);
  expect(r.stdout).toMatch(/approved_at が空でない値から書き換えられている/);
  expect(r.status).toBe(1);
  rmSync(root, { recursive: true, force: true });
});

test("未測定項目の理由を書き換えると落ちる（鍵以外は既定で不変）", () => {
  const root = makeRepo();
  const path = join(root, ".replace/parity/order-list/metadata.json");
  const doc = JSON.parse(readFileSync(path, "utf8"));
  doc.unmeasured.entries[0].reason = "別の理由に差し替えた";
  writeFileSync(path, `${JSON.stringify(doc, null, 2)}\n`);
  const r = run(root);
  expect(r.stdout).toMatch(/reason が書き換えられている/);
  expect(r.status).toBe(1);
  rmSync(root, { recursive: true, force: true });
});

test("宣言に無い disposition の遷移は落ちる", () => {
  const root = makeRepo();
  const path = join(root, ".replace/parity/order-list/metadata.json");
  const doc = JSON.parse(readFileSync(path, "utf8"));
  doc.unmeasured.entries[0].disposition = "measured";
  writeFileSync(path, `${JSON.stringify(doc, null, 2)}\n`);
  const r = run(root);
  expect(r.stdout).toMatch(/disposition が宣言に無い遷移で書き換えられている/);
  expect(r.status).toBe(1);
  rmSync(root, { recursive: true, force: true });
});

test("transitions の表記が <変更前>-><変更後> でなければ合格に倒さない（exit 2）", () => {
  const root = makeRepo();
  const manifest = writeManifest(root, [
    {
      id: "parity-unmeasured",
      pattern: ".replace/parity/*/metadata.json",
      unit: "json-arrays",
      arrays: ["unmeasured.entries"],
      key: "item",
      transitions: { disposition: ["blocking accepted"] },
    },
  ]);
  const r = run(root, ["--manifest", manifest]);
  expect(r.stderr).toMatch(/<変更前>-><変更後> の形でない/);
  expect(r.status).toBe(2);
  rmSync(root, { recursive: true, force: true });
});

test("key が無いのに fill_only を宣言したら合格に倒さない（exit 2）", () => {
  const root = makeRepo();
  const manifest = writeManifest(root, [
    {
      id: "dataset",
      pattern: ".replace/dataset/metadata.json",
      unit: "json-arrays",
      arrays: ["changes"],
      fill_only: ["affects"],
    },
  ]);
  const r = run(root, ["--manifest", manifest]);
  expect(r.stderr).toMatch(/key が無いのに fill_only がある/);
  expect(r.status).toBe(2);
  rmSync(root, { recursive: true, force: true });
});

test("同じ鍵の 2 行の間でセルを入れ替えると落ちる（重複鍵で対応を失わない）", () => {
  // assets.md は方針を覆した行と現在の行が同じ「種類」で 2 行並ぶ（正本が想定する形）。
  const root = makeRepo();
  const rowA = "| ロゴ | `logo.png` | 実体を写す | 有効 | 2026-09-01・setup | 再配布可を確認済み |";
  const rowB = "| ロゴ | `logo.svg` | 同等物を作る | 有効 | 2026-09-10・order | 再配布不可のため |";
  const base = ASSETS.replace(
    "| 本文の書体 | `body.woff2` | 実体を写す | 有効 | 2026-09-01・setup | 字形を一致させるため |",
    rowB,
  );
  writeFileSync(join(root, ".replace/assets.md"), base);
  spawnSync("git", ["-C", root, "commit", "-qam", "two-logo-rows"], { encoding: "utf8" });
  // 行の中身だけを入れ替える（どちらの行も「ロゴ」のまま＝鍵は不変、決定の帰属だけが変わる）。
  const swapped = base.split("\n");
  const a = swapped.indexOf(rowA);
  const b = swapped.indexOf(rowB);
  expect(a).toBeGreaterThan(-1);
  expect(b).toBeGreaterThan(-1);
  swapped[a] = rowB;
  swapped[b] = rowA;
  writeFileSync(join(root, ".replace/assets.md"), swapped.join("\n"));
  const r = run(root);
  expect(r.stdout).toMatch(/（unit: markdown-structure）が失われている/);
  expect(r.status).toBe(1);
  rmSync(root, { recursive: true, force: true });
});
