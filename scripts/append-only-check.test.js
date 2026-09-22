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
  flowItems,
  stripYamlBlocks,
} from "../skills/replace-strategy/scripts/append-only-check.mjs";
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
  "| 種類 | ファイル・出どころ | 方針 | 宣言 | 状態 | 決定日・決めた工程 | 理由 |",
  "|---|---|---|---|---|---|---|",
  "| ロゴ | `logo.png` | 実体を写す | - | 有効 | 2026-09-01・setup | 再配布可を確認済み |",
  "| 本文の書体 | `body.woff2` | 実体を写す | - | 有効 | 2026-09-01・setup | 字形を一致させるため |",
  "",
].join("\n");

const DEPENDENCIES = [
  "# 依存パッケージの決定記録（dependencies）",
  "",
  "- 最終更新: 2026-09-01T00:00:00Z",
  "- 方針の所在: 未確認",
  "",
  "## 本文フォント: example-font@1.2.3",
  "",
  "- 要件（現行と一致させる条件）: 版とヒンティング命令の有無が一致すること",
  "- ライセンス: MIT",
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
  writeFileSync(join(root, ".replace/dependencies.md"), DEPENDENCIES);
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
      "| ロゴ | `logo.png` | 実体を写す | - | 有効 | 2026-09-01・setup | 再配布可を確認済み |",
      "| ロゴ | `logo.svg` | 同等物を作る | - | 有効 | 2026-09-17・order | 再配布不可のため |",
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
  const rowA =
    "| ロゴ | `logo.png` | 実体を写す | - | 有効 | 2026-09-01・setup | 再配布可を確認済み |";
  const rowB =
    "| ロゴ | `logo.svg` | 同等物を作る | - | 有効 | 2026-09-10・order | 再配布不可のため |";
  const base = ASSETS.replace(
    "| 本文の書体 | `body.woff2` | 実体を写す | - | 有効 | 2026-09-01・setup | 字形を一致させるため |",
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

test("方針を覆す正規の手順（状態・宣言・理由を更新して新しい行を追記）は通す", () => {
  // 正本: replace-strategy の references/static-assets.md「覆したときの手順」。
  const root = makeRepo();
  const old =
    "| ロゴ | `logo.png` | 実体を写す | - | 有効 | 2026-09-01・setup | 再配布可を確認済み |";
  const revoked =
    "| ロゴ | `logo.png` | 実体を写す | 取り消し済み | 取り消し済み（2026-09-18 → 下の行） | 2026-09-01・setup | 再配布の可否を確認できず方針を覆した |";
  const appended =
    "| ロゴ | `logo.svg` | 同等物を作る | ロゴを図形で描き直す（縁と曲線の差は残る） | 有効 | 2026-09-18・order | 再配布不可のため |";
  writeFileSync(join(root, ".replace/assets.md"), ASSETS.replace(old, `${revoked}\n${appended}`));
  const r = run(root);
  expect(r.stdout).toMatch(/^ok: /m);
  expect(r.status).toBe(0);
  rmSync(root, { recursive: true, force: true });
});

test("決定の中身にあたる箇条書きの値を書き換えると落ちる", () => {
  const root = makeRepo();
  writeFileSync(
    join(root, ".replace/dependencies.md"),
    DEPENDENCIES.replace("- ライセンス: MIT", "- ライセンス: GPL"),
  );
  const r = run(root);
  expect(r.stdout).toMatch(/（unit: markdown-structure）が失われている/);
  expect(r.stdout).toMatch(/ライセンス/);
  expect(r.status).toBe(1);
  rmSync(root, { recursive: true, force: true });
});

test("正本が更新を定めている箇条書き（最終更新・方針の所在）は通す", () => {
  const root = makeRepo();
  writeFileSync(
    join(root, ".replace/dependencies.md"),
    DEPENDENCIES.replace(
      "- 最終更新: 2026-09-01T00:00:00Z",
      "- 最終更新: 2026-09-18T00:00:00Z",
    ).replace("- 方針の所在: 未確認", "- 方針の所在: 無し（ユーザー確認済み・2026-09-18）"),
  );
  const r = run(root);
  expect(r.stdout).toMatch(/^ok: /m);
  expect(r.status).toBe(0);
  rmSync(root, { recursive: true, force: true });
});

test("unit が json-arrays なのに mutable_bullets があれば合格に倒さない（exit 2）", () => {
  const root = makeRepo();
  const manifest = writeManifest(root, [
    {
      id: "dataset",
      pattern: ".replace/dataset/metadata.json",
      unit: "json-arrays",
      arrays: ["changes"],
      mutable_bullets: ["最終更新"],
    },
  ]);
  const r = run(root, ["--manifest", manifest]);
  expect(r.stderr).toMatch(
    /json-arrays なのに mutable_columns \/ mutable_bullets \/ mutable_blocks \/ growable_containers \/ registry_groups がある/,
  );
  expect(r.status).toBe(2);
  rmSync(root, { recursive: true, force: true });
});

test("unit が lines なのに mutable_bullets があれば合格に倒さない（exit 2）", () => {
  const root = makeRepo();
  const manifest = writeManifest(root, [
    {
      id: "project-config",
      pattern: ".config/skills/*/skills.yml",
      unit: "lines",
      mutable_bullets: ["最終更新"],
    },
  ]);
  const r = run(root, ["--manifest", manifest]);
  expect(r.stderr).toMatch(/unit が lines なのに mutable_bullets がある/);
  expect(r.status).toBe(2);
  rmSync(root, { recursive: true, force: true });
});

// Issue #404: 同じ id を持つ項目が同じファイルに当たると、突き合わせ方が割れていても
// 先勝ちで無音に決まっていた（`assign` の id 一致による早期 return が整合性検査を飛ばしていた）。
test("一覧の id が重複していれば合格に倒さない（exit 2）", () => {
  const root = makeRepo();
  const manifest = writeManifest(root, [
    // 緩い方（Issue 列を書き換えてよい）を先に置く。先勝ちだとこちらが無音で採られる。
    {
      id: "shared",
      pattern: ".replace/features.md",
      unit: "markdown-structure",
      mutable_columns: ["Issue"],
    },
    {
      id: "shared",
      pattern: ".replace/features.md",
      unit: "markdown-structure",
      mutable_columns: [],
    },
  ]);
  const r = run(root, ["--manifest", manifest]);
  expect(r.stderr).toMatch(/artifacts\[1\] の id が一覧の中で重複している: shared/);
  expect(r.status).toBe(2);
  rmSync(root, { recursive: true, force: true });
});

test("id が違えば突き合わせ方の食い違いは従来どおり落ちる（対照）", () => {
  const root = makeRepo();
  const manifest = writeManifest(root, [
    {
      id: "weak-rule",
      pattern: ".replace/features.md",
      unit: "markdown-structure",
      mutable_columns: ["Issue"],
    },
    {
      id: "strict-rule",
      pattern: ".replace/features.md",
      unit: "markdown-structure",
      mutable_columns: [],
    },
  ]);
  const r = run(root, ["--manifest", manifest]);
  expect(r.stderr).toMatch(/同じファイルに突き合わせ方の違う一覧の項目が当たっている/);
  expect(r.status).toBe(2);
  rmSync(root, { recursive: true, force: true });
});

test("id が一意で突き合わせ方も同じなら、同じファイルに 2 項目が当たっても通る（陽性コントロール）", () => {
  const root = makeRepo();
  const manifest = writeManifest(root, [
    {
      id: "features-a",
      pattern: ".replace/features.md",
      unit: "markdown-structure",
      mutable_columns: ["Issue"],
    },
    {
      id: "features-b",
      pattern: ".replace/*.md",
      unit: "markdown-structure",
      mutable_columns: ["Issue"],
    },
  ]);
  appendFileSync(join(root, ".replace/features.md"), "| order-detail | 注文詳細 | 未 | 未起票 |\n");
  const r = run(root, ["--manifest", manifest]);
  expect(r.stdout).toMatch(/^ok: /m);
  expect(r.status).toBe(0);
  rmSync(root, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// 設定ファイル（project-config）の可変領域（Issue #426）
//
// intentional_diffs.pending は設定ファイル上で唯一スキルが追記する記録で、棚卸しで人が
// keep / may_change へ文言を移す。行の多重集合で見ると、この正規の運用が「行が失われた」に化け、
// 指示どおり復元すると記録した保留が消える（データを失う方向へ誘導される）。
// 緩和が効きすぎていないことを陽性コントロールで測る——キーごと消す・keep の要素を落とす・
// 要素を別物へ差し替える、はいずれも落ちなければならない。
// ---------------------------------------------------------------------------

// **実在する設定ファイルの入れ子で測る**（`skills.<スキル名>.…`。正本は replace-strategy の
// references/project-config.md）——mutable_blocks はルートからの完全なパスで引くので、
// 平らな YAML の fixture では「外せているか」を一度も実証できない（平らな fixture では
// パスが一致せず検査が厳しい側へ倒れるだけなので、緩和のテストが全部素通りする）。
const CONFIG = [
  "skills:",
  "  replace-strategy:",
  "    new:",
  "      stack: [typescript]",
  "    intentional_diffs:",
  '      keep: ["テーブル名を保つ"] # 変えない（例: テーブル名、項目名）',
  "      may_change: [] # 変えてよい（例: ディレクトリ・ファイル名）",
  "      pending: [] # 保留（測定結果で決める）",
  "      # ↑ 外した領域の後ろに続く注記（構造行ではないのでブロックを閉じない）",
  "    component_diffs: []",
  "    bare_list: []",
  "",
].join("\n");

const PENDING_BLOCK = [
  "      pending: # 保留（測定結果で決める）",
  "        - item: 一覧の並び順が変わる",
  "          slug: cross-cutting",
  "          added_by: replace-strategy",
  '          added_at: "2026-09-21"',
  "",
].join("\n");

/**
 * @param {string} root
 * @param {string} message
 */
function commit(root, message) {
  for (const args of [
    ["add", "-A"],
    ["commit", "-qm", message],
  ]) {
    const r = spawnSync("git", ["-C", root, ...args], { encoding: "utf8" });
    if (r.status !== 0) throw new Error(`git ${args.join(" ")} failed: ${r.stderr}`);
  }
}

/** @param {string} root */
function configPath(root) {
  return join(root, ".config/skills/acme/skills.yml");
}

/** @param {string} root */
function readConfig(root) {
  return readFileSync(configPath(root), "utf8");
}

/**
 * @param {string} root
 * @param {string} text
 */
function writeConfig(root, text) {
  writeFileSync(configPath(root), text);
}

/**
 * 設定ファイルを持つプロジェクトを作る（比較元にも在る状態で commit 済み）。
 * @param {string} [text]
 */
function makeConfigRepo(text = CONFIG) {
  const root = makeRepo();
  mkdirSync(join(root, ".config/skills/acme"), { recursive: true });
  writeConfig(root, text);
  commit(root, "config");
  return root;
}

/** pending に 1 件積んだ状態を比較元にする。 */
function makeConfigRepoWithPending() {
  const root = makeConfigRepo();
  writeConfig(
    root,
    readConfig(root).replace("      pending: [] # 保留（測定結果で決める）\n", PENDING_BLOCK),
  );
  commit(root, "pending に 1 件");
  return root;
}

test("空リストのキーへ最初の要素をブロック形式で足しても縮小に数えない（Issue #426）", () => {
  const root = makeConfigRepo();
  writeConfig(
    root,
    readConfig(root).replace("      pending: [] # 保留（測定結果で決める）\n", PENDING_BLOCK),
  );
  const r = run(root);
  expect(r.stdout).toMatch(/^ok: /m);
  expect(r.status).toBe(0);
  rmSync(root, { recursive: true, force: true });
});

test("フロー形式のコンテナへ要素を足した行の書き換えは縮小に数えない（Issue #426）", () => {
  const root = makeConfigRepo();
  writeConfig(
    root,
    readConfig(root).replace(
      "      may_change: [] # 変えてよい（例: ディレクトリ・ファイル名）",
      '      may_change: ["新しい宣言"] # 変えてよい（例: ディレクトリ・ファイル名）',
    ),
  );
  const r = run(root);
  expect(r.stdout).toMatch(/^ok: /m);
  expect(r.status).toBe(0);
  rmSync(root, { recursive: true, force: true });
});

test("棚卸しで pending の要素を keep へ移しても縮小に数えない（Issue #426）", () => {
  const root = makeConfigRepoWithPending();
  writeConfig(
    root,
    readConfig(root)
      .replace(
        '      keep: ["テーブル名を保つ"] # 変えない（例: テーブル名、項目名）',
        '      keep: ["テーブル名を保つ", "一覧の並び順が変わる"] # 変えない（例: テーブル名、項目名）',
      )
      .replace(PENDING_BLOCK, "      pending: [] # 保留（測定結果で決める）\n"),
  );
  const r = run(root);
  expect(r.stdout).toMatch(/^ok: /m);
  expect(r.status).toBe(0);
  rmSync(root, { recursive: true, force: true });
});

test("pending の要素の中身を書き換えても通る（配下は単位から外れている）", () => {
  const root = makeConfigRepoWithPending();
  writeConfig(
    root,
    readConfig(root).replace("added_by: replace-strategy", "added_by: parity-suite"),
  );
  const r = run(root);
  expect(r.stdout).toMatch(/^ok: /m);
  expect(r.status).toBe(0);
  rmSync(root, { recursive: true, force: true });
});

test("pending をキーごと消せば落ちる（鍵の存在は別の単位で守る）", () => {
  const root = makeConfigRepoWithPending();
  writeConfig(root, readConfig(root).replace(PENDING_BLOCK, ""));
  const r = run(root);
  expect(r.stdout).toMatch(/<registry: skills\.replace-strategy\.intentional_diffs\.pending>/);
  expect(r.status).toBe(1);
  rmSync(root, { recursive: true, force: true });
});

test("棚卸しを経ずに pending の要素を消せば落ちる（削除の検出主体を検査が持つ）", () => {
  // 配下を単位から外すだけだと、keep へ移さず丸ごと消した編集が通る。
  // pending-triage-check.mjs は「現在の pending」を母集合にするので、消えた要素は対象にならない。
  const root = makeConfigRepoWithPending();
  writeConfig(
    root,
    readConfig(root).replace(PENDING_BLOCK, "      pending: [] # 保留（測定結果で決める）\n"),
  );
  const r = run(root);
  expect(r.stdout).toMatch(/<registry-item: intentional-diffs> 一覧の並び順が変わる/);
  expect(r.status).toBe(1);
  rmSync(root, { recursive: true, force: true });
});

test("keep の既存要素を消せば落ちる（コンテナが育ったときだけ緩める）", () => {
  const root = makeConfigRepo();
  writeConfig(
    root,
    readConfig(root).replace(
      '      keep: ["テーブル名を保つ"] # 変えない（例: テーブル名、項目名）',
      "      keep: [] # 変えない（例: テーブル名、項目名）",
    ),
  );
  const r = run(root);
  expect(r.stdout).toMatch(/失われている/);
  expect(r.status).toBe(1);
  rmSync(root, { recursive: true, force: true });
});

test("keep の要素を別物へ差し替えれば落ちる", () => {
  const root = makeConfigRepo();
  writeConfig(
    root,
    readConfig(root).replace(
      '      keep: ["テーブル名を保つ"] # 変えない（例: テーブル名、項目名）',
      '      keep: ["別の宣言"] # 変えない（例: テーブル名、項目名）',
    ),
  );
  const r = run(root);
  expect(r.stdout).toMatch(/失われている/);
  expect(r.status).toBe(1);
  rmSync(root, { recursive: true, force: true });
});

test("外した領域の後ろに続くコメントを消せば落ちる（守るのはキーと注記）", () => {
  const root = makeConfigRepo();
  writeConfig(
    root,
    readConfig(root).replace(
      "      # ↑ 外した領域の後ろに続く注記（構造行ではないのでブロックを閉じない）\n",
      "",
    ),
  );
  const r = run(root);
  expect(r.stdout).toMatch(/失われている/);
  expect(r.status).toBe(1);
  rmSync(root, { recursive: true, force: true });
});

// 行の単位はインデントを畳むので、同じ鍵のフロー形式のコンテナが複数あると 1 行に潰れる。
// 1 件でも育っていれば緩める形にすると、育った兄弟の陰で別の兄弟から要素を消せる。
const TWO_TARGETS = [
  "skills:",
  "  replace-strategy:",
  "    targets:",
  "      - name: current-test",
  "        forbidden_actions: [delete]",
  "      - name: new-dev",
  "        forbidden_actions: [delete]",
  "    intentional_diffs:",
  "      keep: []",
  "      may_change: []",
  "      pending: []",
  "",
].join("\n");

test("同じ鍵のコンテナが片方だけ育っても、もう片方の要素の削除は落ちる", () => {
  const root = makeConfigRepo(TWO_TARGETS);
  writeConfig(
    root,
    readConfig(root)
      .replace(
        "      - name: current-test\n        forbidden_actions: [delete]",
        "      - name: current-test\n        forbidden_actions: [delete, update]",
      )
      .replace(
        "      - name: new-dev\n        forbidden_actions: [delete]",
        "      - name: new-dev\n        forbidden_actions: []",
      ),
  );
  const r = run(root);
  expect(r.stdout).toMatch(/失われている/);
  expect(r.status).toBe(1);
  rmSync(root, { recursive: true, force: true });
});

test("名指ししていない鍵は、同名の兄弟が両方とも育っても落ちる", () => {
  // 緩和は growable_containers に挙げた鍵だけに効く。行の多重集合は同名の兄弟を 1 つの鍵へ畳むので、
  // 名指しせずに「育った」を判定すると、兄弟の間で要素が移動しただけの編集まで通ってしまう。
  const root = makeConfigRepo(TWO_TARGETS);
  writeConfig(
    root,
    readConfig(root).replaceAll(
      "forbidden_actions: [delete]",
      "forbidden_actions: [delete, update]",
    ),
  );
  const r = run(root);
  expect(r.stdout).toMatch(/失われている/);
  expect(r.status).toBe(1);
  rmSync(root, { recursive: true, force: true });
});

test("mutable_blocks がキーパスの形でなければ合格に倒さない（exit 2）", () => {
  const root = makeConfigRepo();
  const manifest = writeManifest(root, [
    {
      id: "project-config",
      pattern: ".config/skills/*/skills.yml",
      unit: "lines",
      mutable_blocks: ["intentional_diffs."],
    },
  ]);
  const r = run(root, ["--manifest", manifest]);
  expect(r.stderr).toMatch(/mutable_blocks の要素がキーパスの形でない/);
  expect(r.status).toBe(2);
  rmSync(root, { recursive: true, force: true });
});

test("unit が markdown-structure なのに mutable_blocks があれば合格に倒さない（exit 2）", () => {
  const root = makeConfigRepo();
  const manifest = writeManifest(root, [
    {
      id: "features",
      pattern: ".replace/features.md",
      unit: "markdown-structure",
      mutable_blocks: ["intentional_diffs.pending"],
    },
  ]);
  const r = run(root, ["--manifest", manifest]);
  expect(r.stderr).toMatch(/markdown-structure なのに mutable_blocks がある/);
  expect(r.status).toBe(2);
  rmSync(root, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// 依存台帳の決定を覆す（Issue #428）
//
// 決定が覆ったら行を消さず「状態」列を 取り消し済み にして新しい行を追記する。
// 状態列だけが mutable_columns なので、それ以外の列の書き換えと行の削除は落ちる。
// ---------------------------------------------------------------------------

const DEPENDENCY_TABLE = [
  "# 依存パッケージの決定記録（dependencies）",
  "",
  "- 最終更新: 2026-09-01T00:00:00Z",
  "- 方針の所在: 未確認",
  "",
  "## 一覧",
  "",
  "| 部品（用途） | 決定 | 採用したもの | 適用範囲 | 状態 | 決定時期 | 理由・引き取り手 |",
  "|---|---|---|---|---|---|---|",
  "| データグリッド | パッケージ採用 | example-grid@4.5.0 | 全機能 | 有効 | setup | - |",
  "| 確認ダイアログ | 未確認 | — | — | 有効 | setup | 削除ボタンでしか出せず現行 target で削除が禁止されている |",
  "",
].join("\n");

const OVERTURNED_ROW =
  "| 確認ダイアログ | 未確認 | — | — | 取り消し済み（2026-09-21 → 下の行） | setup | 削除ボタンでしか出せず現行 target で削除が禁止されている |";

/** 依存台帳（表つき）を比較元に持つプロジェクトを作る。 */
function makeDependencyRepo() {
  const root = makeRepo();
  writeFileSync(join(root, ".replace/dependencies.md"), DEPENDENCY_TABLE);
  commit(root, "dependencies 台帳");
  return root;
}

/** @param {string} root */
function readDependencies(root) {
  return readFileSync(join(root, ".replace/dependencies.md"), "utf8");
}

/**
 * @param {string} root
 * @param {string} text
 */
function writeDependencies(root, text) {
  writeFileSync(join(root, ".replace/dependencies.md"), text);
}

test("決定を覆すとき状態列の更新 ＋ 新しい行の追記なら通る（Issue #428）", () => {
  const root = makeDependencyRepo();
  writeDependencies(
    root,
    readDependencies(root).replace(
      "| 確認ダイアログ | 未確認 | — | — | 有効 | setup | 削除ボタンでしか出せず現行 target で削除が禁止されている |",
      `${OVERTURNED_ROW}\n| 確認ダイアログ | 自前実装 | — | 全機能 | 有効 | order-list の実装前 | 承認を得て現行で確かめ在ることを確認した |`,
    ),
  );
  const r = run(root);
  expect(r.stdout).toMatch(/^ok: /m);
  expect(r.status).toBe(0);
  rmSync(root, { recursive: true, force: true });
});

test("覆った行を消せば落ちる（状態列に倒して残す契約）", () => {
  const root = makeDependencyRepo();
  writeDependencies(
    root,
    readDependencies(root).replace(
      "| 確認ダイアログ | 未確認 | — | — | 有効 | setup | 削除ボタンでしか出せず現行 target で削除が禁止されている |\n",
      "",
    ),
  );
  const r = run(root);
  expect(r.stdout).toMatch(/失われている/);
  expect(r.status).toBe(1);
  rmSync(root, { recursive: true, force: true });
});

test("決定列をその場で書き換えれば落ちる（mutable なのは状態列だけ）", () => {
  const root = makeDependencyRepo();
  writeDependencies(
    root,
    readDependencies(root).replace("| 確認ダイアログ | 未確認 |", "| 確認ダイアログ | 自前実装 |"),
  );
  const r = run(root);
  expect(r.stdout).toMatch(/決定=未確認/);
  expect(r.status).toBe(1);
  rmSync(root, { recursive: true, force: true });
});

test("理由・引き取り手列をその場で書き換えれば落ちる", () => {
  const root = makeDependencyRepo();
  writeDependencies(
    root,
    readDependencies(root).replace(
      "削除ボタンでしか出せず現行 target で削除が禁止されている",
      "別の理由に差し替えた",
    ),
  );
  const r = run(root);
  expect(r.stdout).toMatch(/失われている/);
  expect(r.status).toBe(1);
  rmSync(root, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// 行末コメントと兄弟コンテナ（PR #429 のレビュー指摘）
//
// 正本の設定ファイルは `keep: [] # 変えない（…）` のようにコメント付きで書く。
// 行末が `]` であることを要求すると、実プロジェクトでは緩和が一度も発動せず、
// 合否がコメントの有無で割れる。コメント自体も契約の対象（「既存のキー・値・コメントは変更しない」）。
// 兄弟コンテナは中身が違うと別の正規化行になるため、失われた行ごとに独立へ判定すると
// 同じ 1 件の育ったコンテナを複数の兄弟が根拠にできる。
// ---------------------------------------------------------------------------

test("行末コメント付きの空コンテナへ最初の要素を足しても縮小に数えない", () => {
  const root = makeConfigRepo();
  writeConfig(
    root,
    readConfig(root).replace(
      "      may_change: [] # 変えてよい（例: ディレクトリ・ファイル名）",
      '      may_change: ["HTML の id"] # 変えてよい（例: ディレクトリ・ファイル名）',
    ),
  );
  const r = run(root);
  expect(r.stdout).toMatch(/^ok: /m);
  expect(r.status).toBe(0);
  rmSync(root, { recursive: true, force: true });
});

test("growable_containers に挙げていないキーは、要素を足しただけでも落ちる", () => {
  // 緩和は鍵を名指ししたものだけに効く（名指ししないと、同名の兄弟の間で要素が移動しただけの
  // 編集まで通る）。名指ししていないキーは一覧の requirement どおり「値を変更しない」が掛かる。
  const root = makeConfigRepo();
  writeConfig(root, readConfig(root).replace("    bare_list: []", '    bare_list: ["x"]'));
  const r = run(root);
  expect(r.stdout).toMatch(/失われている/);
  expect(r.status).toBe(1);
  rmSync(root, { recursive: true, force: true });
});

test("要素を足すついでに行末コメントを消せば落ちる（コメントも単位）", () => {
  const root = makeConfigRepo();
  writeConfig(
    root,
    readConfig(root).replace(
      "      may_change: [] # 変えてよい（例: ディレクトリ・ファイル名）",
      '      may_change: ["HTML の id"]',
    ),
  );
  const r = run(root);
  expect(r.stdout).toMatch(/失われている/);
  expect(r.status).toBe(1);
  rmSync(root, { recursive: true, force: true });
});

test("mutable_blocks で外したキー行の行末コメントを消せば落ちる", () => {
  const root = makeConfigRepo();
  writeConfig(
    root,
    readConfig(root).replace("      pending: [] # 保留（測定結果で決める）", "      pending: []"),
  );
  const r = run(root);
  expect(r.stdout).toMatch(/失われている/);
  expect(r.status).toBe(1);
  rmSync(root, { recursive: true, force: true });
});

const TWO_TARGETS_DIFFERENT = [
  "skills:",
  "  replace-strategy:",
  "    targets:",
  "      - name: current-test",
  "        forbidden_actions: [delete]",
  "      - name: current-staging",
  "        forbidden_actions: [delete, update]",
  "    intentional_diffs:",
  "      keep: []",
  "      may_change: []",
  "      pending: []",
  "",
].join("\n");

test("中身の違う兄弟でも、育った側を根拠に別の兄弟から要素を消せない", () => {
  const root = makeConfigRepo(TWO_TARGETS_DIFFERENT);
  // current-test が [delete, update] へ育ち、current-staging から delete が消える。
  writeConfig(
    root,
    readConfig(root)
      .replace("        forbidden_actions: [delete]", "        forbidden_actions: [delete, update]")
      .replace(
        "        forbidden_actions: [delete, update]\n    intentional_diffs:",
        "        forbidden_actions: [update]\n    intentional_diffs:",
      ),
  );
  const r = run(root);
  expect(r.stdout).toMatch(/失われている/);
  expect(r.status).toBe(1);
  rmSync(root, { recursive: true, force: true });
});

test("兄弟の間で要素が移動しただけの編集も落ちる（PR #429 の退行の回帰）", () => {
  // current-test を空にして new-dev へ移す。鍵ごとの多重集合で判定すると、その鍵の下には
  // 要素が残っているので通ってしまう（現行環境の禁止操作の宣言が黙って空にできる）。
  const root = makeConfigRepo(TWO_TARGETS_DIFFERENT);
  writeConfig(
    root,
    readConfig(root)
      .replace("        forbidden_actions: [delete]\n", "        forbidden_actions: []\n")
      .replace(
        "        forbidden_actions: [delete, update]\n    intentional_diffs:",
        "        forbidden_actions: [delete, update, create]\n    intentional_diffs:",
      ),
  );
  const r = run(root);
  expect(r.stdout).toMatch(/失われている/);
  expect(r.status).toBe(1);
  rmSync(root, { recursive: true, force: true });
});

test("同じ鍵の空コンテナが 2 つあり片方を消せば落ちる（件数も見る）", () => {
  const root = makeConfigRepo(
    [
      "skills:",
      "  replace-strategy:",
      "    targets:",
      "      - name: current-test",
      "        forbidden_actions: []",
      "      - name: current-staging",
      "        forbidden_actions: []",
      "    intentional_diffs:",
      "      keep: []",
      "      may_change: []",
      "      pending: []",
      "",
    ].join("\n"),
  );
  // 片方から禁止操作の宣言だけを消す（name 行は残すので、失われるのは forbidden_actions の行だけ）。
  // 要素の多重集合は空のまま等しいため、同じ鍵のコンテナ行の件数を見ないと通ってしまう。
  writeConfig(
    root,
    readConfig(root).replace(
      "      - name: current-staging\n        forbidden_actions: []\n",
      "      - name: current-staging\n        side: current\n",
    ),
  );
  const r = run(root);
  expect(r.stdout).toMatch(/失われている/);
  expect(r.status).toBe(1);
  rmSync(root, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// 一覧の突き合わせ方の食い違い・パス解決の穴（PR #429 のレビュー指摘・2 巡目）
// ---------------------------------------------------------------------------

test("同じファイルに当たる 2 項目で mutable_blocks だけ違えば合格に倒さない（exit 2）", () => {
  // 比較に入っていないと、一覧の並び順で外す範囲が変わる＝ fail-closed なゲートが並び順で fail-open する。
  const root = makeConfigRepo();
  const manifest = writeManifest(root, [
    {
      id: "project-config-a",
      pattern: ".config/skills/*/skills.yml",
      unit: "lines",
      mutable_blocks: ["skills.replace-strategy.intentional_diffs.pending"],
    },
    {
      id: "project-config-b",
      pattern: ".config/skills/acme/skills.yml",
      unit: "lines",
      mutable_blocks: ["skills.replace-strategy.intentional_diffs.keep"],
    },
  ]);
  const r = run(root, ["--manifest", manifest]);
  expect(r.stderr).toMatch(/突き合わせ方の違う一覧の項目が当たっている/);
  expect(r.status).toBe(2);
  rmSync(root, { recursive: true, force: true });
});

test("同じファイルに当たる 2 項目で growable_containers だけ違えば合格に倒さない（exit 2）", () => {
  const root = makeConfigRepo();
  const manifest = writeManifest(root, [
    {
      id: "project-config-a",
      pattern: ".config/skills/*/skills.yml",
      unit: "lines",
      growable_containers: ["skills.replace-strategy.intentional_diffs.keep"],
    },
    {
      id: "project-config-b",
      pattern: ".config/skills/acme/skills.yml",
      unit: "lines",
      growable_containers: ["skills.replace-strategy.intentional_diffs.may_change"],
    },
  ]);
  const r = run(root, ["--manifest", manifest]);
  expect(r.stderr).toMatch(/突き合わせ方の違う一覧の項目が当たっている/);
  expect(r.status).toBe(2);
  rmSync(root, { recursive: true, force: true });
});

test("growable_containers がキーパスの形でなければ合格に倒さない（exit 2）", () => {
  const root = makeConfigRepo();
  const manifest = writeManifest(root, [
    {
      id: "project-config",
      pattern: ".config/skills/*/skills.yml",
      unit: "lines",
      growable_containers: ["intentional_diffs..keep"],
    },
  ]);
  const r = run(root, ["--manifest", manifest]);
  expect(r.stderr).toMatch(/growable_containers の要素がキーパスの形でない/);
  expect(r.status).toBe(2);
  rmSync(root, { recursive: true, force: true });
});

test("リスト要素の配下にある同名キーは外れない（パスが親を継がない）", () => {
  const root = makeConfigRepo(
    [
      "skills:",
      "  replace-strategy:",
      "    intentional_diffs:",
      "      - name: a",
      "        pending:",
      "          - 消してはいけない記録",
      "      - name: b",
      "",
    ].join("\n"),
  );
  writeConfig(
    root,
    readConfig(root).replace(
      "        pending:\n          - 消してはいけない記録\n",
      "        pending:\n",
    ),
  );
  const r = run(root);
  expect(r.stdout).toMatch(/失われている/);
  expect(r.status).toBe(1);
  rmSync(root, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// プレーンスカラーの引用符・コメントの置き場所（PR #429 のレビュー指摘・3 巡目）
// ---------------------------------------------------------------------------

const PLAIN_APOSTROPHE = [
  "skills:",
  "  replace-strategy:",
  "    intentional_diffs:",
  "      keep: [don't rename tables] # 変えない（例: テーブル名、項目名）",
  "      may_change: []",
  "      pending: []",
  "    component_diffs: [] # コンポーネント系統差レジストリ",
  "",
].join("\n");

test("プレーンスカラーのアポストロフィがあっても要素を足せる（引用符として読まない）", () => {
  // YAML では `[don't rename]` のアポストロフィは引用符ではない。開き引用符として読むと行末まで
  // 閉じず、コメントも値も読めないまま緩和が無音で外れ、正しい追記が「決定が失われている」になる。
  const root = makeConfigRepo(PLAIN_APOSTROPHE);
  writeConfig(
    root,
    readConfig(root).replace(
      "      keep: [don't rename tables] #",
      "      keep: [don't rename tables, keep api paths] #",
    ),
  );
  const r = run(root);
  expect(r.stdout).toMatch(/^ok: /m);
  expect(r.status).toBe(0);
  rmSync(root, { recursive: true, force: true });
});

test("アポストロフィ入りの要素を消せば落ちる（緩めすぎていない）", () => {
  const root = makeConfigRepo(PLAIN_APOSTROPHE);
  writeConfig(
    root,
    readConfig(root).replace("      keep: [don't rename tables] #", "      keep: [] #"),
  );
  const r = run(root);
  expect(r.stdout).toMatch(/失われている/);
  expect(r.status).toBe(1);
  rmSync(root, { recursive: true, force: true });
});

test("引用符つきの値の中のカンマで要素を分割しない", () => {
  const root = makeConfigRepo(PLAIN_APOSTROPHE);
  writeConfig(
    root,
    readConfig(root).replace(
      "      keep: [don't rename tables] #",
      '      keep: [don\'t rename tables, "a, b"] #',
    ),
  );
  const r = run(root);
  expect(r.stdout).toMatch(/^ok: /m);
  expect(r.status).toBe(0);
  rmSync(root, { recursive: true, force: true });
});

test("growable の鍵の注記を上の行へ移しても通る（mutable_blocks 側と対称）", () => {
  const root = makeConfigRepo(PLAIN_APOSTROPHE);
  writeConfig(
    root,
    readConfig(root).replace(
      "    component_diffs: [] # コンポーネント系統差レジストリ\n",
      "    # コンポーネント系統差レジストリ\n    component_diffs: []\n",
    ),
  );
  const r = run(root);
  expect(r.stdout).toMatch(/^ok: /m);
  expect(r.status).toBe(0);
  rmSync(root, { recursive: true, force: true });
});

test("growable の鍵の注記を消せば落ちる", () => {
  const root = makeConfigRepo(PLAIN_APOSTROPHE);
  writeConfig(
    root,
    readConfig(root).replace(
      "    component_diffs: [] # コンポーネント系統差レジストリ\n",
      "    component_diffs: []\n",
    ),
  );
  const r = run(root);
  expect(r.stdout).toMatch(/失われている/);
  expect(r.status).toBe(1);
  rmSync(root, { recursive: true, force: true });
});

test("キーパスに `-` だけのセグメントを書けば合格に倒さない（exit 2）", () => {
  // `-` は stripYamlBlocks がリスト要素へ積むマーカーと同じ綴り。名指しできると全リスト要素が
  // 同じ鍵を共有し、兄弟を区別できなくなる（片方から要素を消しても通る穴が設定次第で戻る）。
  const root = makeConfigRepo();
  const manifest = writeManifest(root, [
    {
      id: "project-config",
      pattern: ".config/skills/*/skills.yml",
      unit: "lines",
      growable_containers: ["skills.replace-strategy.targets.-.forbidden_actions"],
    },
  ]);
  const r = run(root, ["--manifest", manifest]);
  expect(r.stderr).toMatch(/growable_containers の要素がキーパスの形でない/);
  expect(r.status).toBe(2);
  rmSync(root, { recursive: true, force: true });
});

test("引用符つきの要素がある行へ、引用符の無い要素を足しても通る", () => {
  // 引用符を「閉じなければ無視して取り直す」形にすると、同じ値でも同じ行の別の要素次第で
  // 読み方が変わり、比較元と現在で別モードが選ばれる（要素を足しただけで縮小に見える）。
  const root = makeConfigRepo(
    [
      "skills:",
      "  replace-strategy:",
      "    intentional_diffs:",
      '      keep: ["a, b"] # 変えない',
      "      may_change: []",
      "      pending: []",
      "",
    ].join("\n"),
  );
  writeConfig(
    root,
    readConfig(root).replace('      keep: ["a, b"] #', '      keep: ["a, b", don\'t] #'),
  );
  const r = run(root);
  expect(r.stdout).toMatch(/^ok: /m);
  expect(r.status).toBe(0);
  rmSync(root, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// registry 要素の読み取り（PR #429 のレビュー指摘・5 巡目）
// ---------------------------------------------------------------------------

const KEY_ORDER_PENDING = [
  "skills:",
  "  replace-strategy:",
  "    intentional_diffs:",
  "      keep: [] # 変えない",
  "      may_change: []",
  "      pending: # 保留",
  "        - slug: cross-cutting",
  "          item: キー順が違う要素",
  "          added_by: replace-strategy",
  '        - added_at: "2026-09-21"',
  "          added_by: parity-diff",
  "          item: 先頭が added_at の要素",
  "",
].join("\n");

const KEY_ORDER_ITEM = [
  "        - slug: cross-cutting",
  "          item: キー順が違う要素",
  "          added_by: replace-strategy",
  "",
].join("\n");

test("照合キーが 1 行目に無い要素も棚卸しで移せる（要素の全行から探す）", () => {
  const root = makeConfigRepo(KEY_ORDER_PENDING);
  writeConfig(
    root,
    readConfig(root)
      .replace(KEY_ORDER_ITEM, "")
      .replace("keep: [] #", 'keep: ["キー順が違う要素"] #'),
  );
  const r = run(root);
  expect(r.stdout).toMatch(/^ok: /m);
  expect(r.status).toBe(0);
  rmSync(root, { recursive: true, force: true });
});

test("照合キーが 1 行目に無い要素の文言を差し替えれば落ちる", () => {
  const root = makeConfigRepo(KEY_ORDER_PENDING);
  writeConfig(
    root,
    readConfig(root).replace(
      "          item: 先頭が added_at の要素",
      "          item: 別物へ差し替えた",
    ),
  );
  const r = run(root);
  expect(r.stdout).toMatch(/失われている/);
  expect(r.status).toBe(1);
  rmSync(root, { recursive: true, force: true });
});

test("registry の鍵の配下がリストでなければ行のまま守る（解釈できないものを捨てない）", () => {
  const root = makeConfigRepo(
    [
      "skills:",
      "  replace-strategy:",
      "    intentional_diffs:",
      "      keep: []",
      "      may_change: []",
      "      pending: # 保留",
      "        a: 1",
      "        b: 2",
      "",
    ].join("\n"),
  );
  writeConfig(root, readConfig(root).replace("        a: 1\n        b: 2\n", "        a: 1\n"));
  const r = run(root);
  expect(r.stdout).toMatch(/失われている/);
  expect(r.status).toBe(1);
  rmSync(root, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// フロー形式の registry 要素・オプション間の入れ子（PR #429 のレビュー指摘・6 巡目）
// ---------------------------------------------------------------------------

const FLOW_PENDING =
  "      pending: [{item: 合計の丸め, slug: cross-cutting, added_by: replace-strategy}] # 保留（測定結果で決める）\n";

/** pending にフロー形式のマッピング要素を 1 件積んだ状態を比較元にする。 */
function makeConfigRepoWithFlowPending() {
  const root = makeConfigRepo();
  writeConfig(
    root,
    readConfig(root).replace("      pending: [] # 保留（測定結果で決める）\n", FLOW_PENDING),
  );
  commit(root, "pending にフロー形式で 1 件");
  return root;
}

test("フロー形式のマッピング要素も照合キーで棚卸しできる（追随フィールドを単位にしない）", () => {
  const root = makeConfigRepoWithFlowPending();
  writeConfig(
    root,
    readConfig(root)
      .replace(FLOW_PENDING, "      pending: [] # 保留（測定結果で決める）\n")
      .replace("      may_change: [] #", "      may_change: [合計の丸め] #"),
  );
  const r = run(root);
  expect(r.stdout).toMatch(/^ok: /m);
  expect(r.status).toBe(0);
  rmSync(root, { recursive: true, force: true });
});

test("フロー形式のマッピング要素を棚卸しせず消せば落ちる", () => {
  const root = makeConfigRepoWithFlowPending();
  writeConfig(
    root,
    readConfig(root).replace(FLOW_PENDING, "      pending: [] # 保留（測定結果で決める）\n"),
  );
  const r = run(root);
  expect(r.stdout).toMatch(/<registry-item: intentional-diffs> 合計の丸め/);
  expect(r.status).toBe(1);
  rmSync(root, { recursive: true, force: true });
});

test("フロー形式で照合キーの値を差し替えれば落ちる", () => {
  const root = makeConfigRepoWithFlowPending();
  writeConfig(root, readConfig(root).replace("item: 合計の丸め", "item: 別物へ差し替えた"));
  const r = run(root);
  expect(r.stdout).toMatch(/失われている/);
  expect(r.status).toBe(1);
  rmSync(root, { recursive: true, force: true });
});

// 1 行に収まらない照合キーの値（PR #429 のレビュー指摘・8 巡目）
// ---------------------------------------------------------------------------

const MULTILINE_PENDING = [
  "      pending: # 保留（測定結果で決める）",
  "        - item:",
  "            合計の丸めが現行と違う",
  "          slug: cross-cutting",
  "          added_by: replace-strategy",
  "        - item: >-",
  "            確認ダイアログを出さない",
  "          slug: cross-cutting",
  "          added_by: parity-diff",
  "",
].join("\n");

/** 照合キーの値が 1 行に収まらない要素（プレーン多行スカラー・ブロックスカラー）を比較元にする。 */
function makeConfigRepoWithMultilinePending() {
  const root = makeConfigRepo();
  writeConfig(
    root,
    readConfig(root).replace("      pending: [] # 保留（測定結果で決める）\n", MULTILINE_PENDING),
  );
  commit(root, "pending に 1 行に収まらない値の要素");
  return root;
}

test("プレーン多行スカラーの要素を丸ごと消せば落ちる（畳んで単位ゼロにしない）", () => {
  const root = makeConfigRepoWithMultilinePending();
  writeConfig(
    root,
    readConfig(root).replace(
      [
        "        - item:",
        "            合計の丸めが現行と違う",
        "          slug: cross-cutting",
        "          added_by: replace-strategy",
        "",
      ].join("\n"),
      "",
    ),
  );
  const r = run(root);
  expect(r.stdout).toMatch(/失われている/);
  expect(r.status).toBe(1);
  rmSync(root, { recursive: true, force: true });
});

test("ブロックスカラーの本文を差し替えれば落ちる（本文を単位から落とさない）", () => {
  const root = makeConfigRepoWithMultilinePending();
  writeConfig(
    root,
    readConfig(root).replace("確認ダイアログを出さない", "確認ダイアログを必ず出す"),
  );
  const r = run(root);
  expect(r.stdout).toMatch(/失われている/);
  expect(r.status).toBe(1);
  rmSync(root, { recursive: true, force: true });
});

test("閉じない引用符の値の続きの行も単位から落とさない", () => {
  const root = makeConfigRepo();
  writeConfig(
    root,
    readConfig(root).replace(
      "      pending: [] # 保留（測定結果で決める）\n",
      [
        "      pending: # 保留（測定結果で決める）",
        '        - item: "閉じていない',
        "            引用符の続きの行",
        "          slug: cross-cutting",
        "",
      ].join("\n"),
    ),
  );
  commit(root, "pending に閉じない引用符");
  // 畳むと単位は `"閉じていない` だけになり、続きの行は kept へ戻らないので差し替えが無音で通る。
  writeConfig(root, readConfig(root).replace("引用符の続きの行", "別物へ差し替えた"));
  const r = run(root);
  expect(r.stdout).toMatch(/失われている/);
  expect(r.status).toBe(1);
  rmSync(root, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
const QUOTED_COMMA_PENDING =
  '      pending: [{item: "順序は id, 名前の順", slug: cross-cutting}] # 保留（測定結果で決める）\n';

/** 引用符の中にカンマを持つフロー形式のマッピング要素を比較元にする。 */
function makeConfigRepoWithQuotedFlowPending() {
  const root = makeConfigRepo();
  writeConfig(
    root,
    readConfig(root).replace(
      "      pending: [] # 保留（測定結果で決める）\n",
      QUOTED_COMMA_PENDING,
    ),
  );
  commit(root, "pending に引用符つきカンマを含む要素");
  return root;
}

test("マッピングの値の引用符も開く（値の中のカンマでペアを割らない）", () => {
  const root = makeConfigRepoWithQuotedFlowPending();
  writeConfig(
    root,
    readConfig(root)
      .replace(QUOTED_COMMA_PENDING, "      pending: [] # 保留（測定結果で決める）\n")
      .replace(
        'keep: ["テーブル名を保つ"] #',
        'keep: ["テーブル名を保つ", "順序は id, 名前の順"] #',
      ),
  );
  const r = run(root);
  expect(r.stdout).toMatch(/^ok: /m);
  expect(r.status).toBe(0);
  rmSync(root, { recursive: true, force: true });
});

test("引用符の中にカンマを持つ文言の差し替えは無音で通らない", () => {
  const root = makeConfigRepoWithQuotedFlowPending();
  writeConfig(root, readConfig(root).replace("名前の順", "逆順に変更"));
  const r = run(root);
  expect(r.stdout).toMatch(/<registry-item: intentional-diffs> 順序は id, 名前の順/);
  expect(r.status).toBe(1);
  rmSync(root, { recursive: true, force: true });
});

test("入れ子になったキーパスを 2 つのオプションに書けば合格に倒さない（祖先が配下を丸ごと外す）", () => {
  const root = makeConfigRepo();
  const manifest = writeManifest(root, [
    {
      id: "project-config",
      pattern: ".config/skills/*/skills.yml",
      unit: "lines",
      mutable_blocks: ["skills.replace-strategy.intentional_diffs"],
      growable_containers: ["skills.replace-strategy.intentional_diffs.keep"],
    },
  ]);
  const r = run(root, ["--manifest", manifest]);
  expect(r.stderr).toMatch(/入れ子になったキーパスが .+ と .+ の両方にある/);
  expect(r.status).toBe(2);
  rmSync(root, { recursive: true, force: true });
});

test("接頭辞が重なるだけの兄弟キーは入れ子と数えない（a.b と a.bc）", () => {
  const root = makeConfigRepo();
  const manifest = writeManifest(root, [
    {
      id: "project-config",
      pattern: ".config/skills/*/skills.yml",
      unit: "lines",
      mutable_blocks: ["skills.replace-strategy.bare_list"],
      growable_containers: ["skills.replace-strategy.bare_listing"],
    },
  ]);
  const r = run(root, ["--manifest", manifest]);
  expect(r.stdout).toMatch(/^ok: /m);
  expect(r.status).toBe(0);
  rmSync(root, { recursive: true, force: true });
});

test("同じキーパスを 2 つのオプションに書けば合格に倒さない（exit 2）", () => {
  const root = makeConfigRepo();
  const manifest = writeManifest(root, [
    {
      id: "project-config",
      pattern: ".config/skills/*/skills.yml",
      unit: "lines",
      mutable_blocks: ["skills.replace-strategy.intentional_diffs.pending"],
      registry_groups: [
        {
          id: "intentional-diffs",
          item_key: "item",
          paths: ["skills.replace-strategy.intentional_diffs.pending"],
        },
      ],
    },
  ]);
  const r = run(root, ["--manifest", manifest]);
  expect(r.stderr).toMatch(/同じキーパスが .+ と .+ の両方にある/);
  expect(r.status).toBe(2);
  rmSync(root, { recursive: true, force: true });
});

// --- 1 行で閉じないフロー形式のコンテナ（#430） ---
//
// `flowItems` は `raw.slice(1, -1)` で末尾 1 文字を閉じ括弧と決め打ちしていたため、折り返された
// コンテナを「読めた」ことにしていた（`[` は空、`[ "a",` は要素 1 件）。読めたことにすると
// 折り返しの中身が空に見え、要素を足しただけの編集が縮小に化ける。

test("1 行で閉じないフロー形式のコンテナは読めたことにしない（null）", () => {
  // 折り返しの各形。`[` を空コンテナ（`[]`）、`[ "a",` を要素 1 件と読んだのが #430 の直接の原因。
  expect(flowItems("[")).toBeNull();
  expect(flowItems("{")).toBeNull();
  expect(flowItems('[ "a",')).toBeNull();
  expect(flowItems("{item: a")).toBeNull();
  expect(flowItems('["a"')).toBeNull();
  // 開き括弧と閉じ方の種類が合わない。
  expect(flowItems("[a}")).toBeNull();
  // 閉じた後に余りがある。
  expect(flowItems('["a"] trailing')).toBeNull();
});

test("陽性コントロール: 1 行で閉じるコンテナは今までどおり読める", () => {
  expect(flowItems("[]")).toEqual([]);
  expect(flowItems("[ ]")).toEqual([]);
  expect(flowItems("{}")).toEqual([]);
  expect(flowItems('["a", "b"]')).toEqual(["a", "b"]);
  // 引用符の中のカンマは区切りにしない。入れ子の括弧は要素の一部として残す。
  expect(flowItems('["a, b", c]')).toEqual(["a, b", "c"]);
  expect(flowItems('[{item: "a"}]')).toEqual(['{item: "a"}']);
});

/** keep を折り返した形で書いた設定ファイル。 */
const WRAPPED_KEEP = [
  "      keep: [",
  '        "テーブル名を保つ",',
  '        "項目名を保つ"',
  "      ] # 変えない（例: テーブル名、項目名）",
].join("\n");

/** @param {string} root */
function makeWrappedConfigRepo() {
  return makeConfigRepo(
    CONFIG.replace(
      '      keep: ["テーブル名を保つ"] # 変えない（例: テーブル名、項目名）',
      WRAPPED_KEEP,
    ),
  );
}

test("折り返したコンテナへ追記しただけなら通る（#430 の再現手順）", () => {
  const root = makeWrappedConfigRepo();
  writeConfig(
    root,
    readConfig(root).replace(
      '        "項目名を保つ"\n',
      '        "項目名を保つ",\n        "並び順を保つ"\n',
    ),
  );
  const r = run(root);
  expect(r.stdout).toMatch(/^ok: /m);
  expect(r.status).toBe(0);
  rmSync(root, { recursive: true, force: true });
});

test("折り返したコンテナを 1 行へ書き直せば、要素を足していても通る", () => {
  const root = makeWrappedConfigRepo();
  writeConfig(
    root,
    readConfig(root).replace(
      WRAPPED_KEEP,
      '      keep: ["テーブル名を保つ", "項目名を保つ", "並び順を保つ"] # 変えない（例: テーブル名、項目名）',
    ),
  );
  const r = run(root);
  expect(r.stdout).toMatch(/^ok: /m);
  expect(r.status).toBe(0);
  rmSync(root, { recursive: true, force: true });
});

test("折り返したコンテナから要素を消せば、1 行へ書き直しても落ちる", () => {
  const root = makeWrappedConfigRepo();
  writeConfig(
    root,
    readConfig(root).replace(
      WRAPPED_KEEP,
      '      keep: ["テーブル名を保つ"] # 変えない（例: テーブル名、項目名）',
    ),
  );
  const r = run(root);
  expect(r.stdout).toMatch(/項目名を保つ/);
  expect(r.status).toBe(1);
  rmSync(root, { recursive: true, force: true });
});

test("1 行のコンテナを折り返しても通る（折り返し ⇄ 1 行の相互変換）", () => {
  const root = makeConfigRepo();
  writeConfig(
    root,
    readConfig(root).replace(
      '      keep: ["テーブル名を保つ"] # 変えない（例: テーブル名、項目名）',
      [
        "      keep: [",
        '        "テーブル名を保つ"',
        "      ] # 変えない（例: テーブル名、項目名）",
      ].join("\n"),
    ),
  );
  const r = run(root);
  expect(r.stdout).toMatch(/^ok: /m);
  expect(r.status).toBe(0);
  rmSync(root, { recursive: true, force: true });
});

test("連結しても閉じないコンテナは読めたことにせず、表記を直すよう案内する", () => {
  const root = makeConfigRepo();
  // 閉じ括弧が無いまま次の鍵へ出る。連結は鍵のブロックを抜けた時点で打ち切る（fail-closed）。
  writeConfig(
    root,
    readConfig(root).replace(
      '      keep: ["テーブル名を保つ"] # 変えない（例: テーブル名、項目名）',
      "      keep: [",
    ),
  );
  const r = run(root);
  expect(r.status).toBe(1);
  expect(r.stdout).toMatch(
    /閉じていないフロー形式のコンテナがある: skills\.replace-strategy\.intentional_diffs\.keep/,
  );
  rmSync(root, { recursive: true, force: true });
});

test("弁別: 折り返しが無ければ案内を出さない", () => {
  const root = makeConfigRepo();
  // 1 行のコンテナから要素を消す（同じ「縮小」でも折り返しは関係しない）。
  writeConfig(root, readConfig(root).replace('"テーブル名を保つ"', ""));
  const r = run(root);
  expect(r.status).toBe(1);
  // 実際に出る文言と同じ綴りで照合する（別の綴りにすると常に不一致になり、案内が出ていても通る）。
  expect(r.stdout).not.toMatch(/閉じていないフロー形式のコンテナがある/);
  rmSync(root, { recursive: true, force: true });
});

// 折り返しの連結は「名指しした鍵の値が何行に渡るか」の 1 軸だけを受理する。受理する側と
// 読めなかったことにする側を同じ数だけ並べ、境界（閉じ括弧の位置・途中の行の種類・文書の終わり）を固定する。
/** @param {string} src */
function keepUnits(src) {
  return stripYamlBlocks(src, [], ["a.keep"], [])
    .split("\n")
    .filter((l) => l.trim() !== "");
}

test("折り返しの連結: 鍵のブロック内で閉じていれば読む（閉じ括弧のインデントは問わない）", () => {
  expect(keepUnits('a:\n  keep: [\n    "x"\n  ] # c\n')).toEqual([
    "a:",
    "<container: a.keep>",
    "# c",
    "<item: a.keep> x",
  ]);
  // 閉じ括弧が鍵より深くても読む。
  expect(keepUnits('a:\n  keep: [\n    "x"\n    ] # c\n')).toContain("<item: a.keep> x");
  // 途中の行に付いた行末コメントも単位として残す（別行へ移しただけの編集を落とさない）。
  expect(keepUnits('a:\n  keep: [\n    "x", # 注記\n    "y"\n  ] # c\n')).toEqual([
    "a:",
    "<container: a.keep>",
    "# 注記",
    "# c",
    "<item: a.keep> x",
    "<item: a.keep> y",
  ]);
  // 入れ子のマッピングが複数行に渡っても 1 要素として読む。
  expect(keepUnits('a:\n  keep: [\n    {item: "x",\n     slug: s}\n  ] # c\n')).toContain(
    '<item: a.keep> {item: "x", slug: s}',
  );
});

test("折り返しの連結: 開き括弧が次の行にあっても読む（フォーマッタが畳む形）", () => {
  // YAML のフォーマッタは 1 行に収まらないコンテナを `key:` と `[` に分けて畳む。ブロック形式として
  // 扱うと中身が行のまま単位になり、要素を足しただけの編集が縮小に化ける（#430 と同じ害）。
  expect(keepUnits('a:\n  keep:\n    [\n      "x",\n      "y"\n    ] # c\n')).toEqual([
    "a:",
    "<container: a.keep>",
    "# c",
    "<item: a.keep> x",
    "<item: a.keep> y",
  ]);
  // 1 行の形と同じ単位になる（表記を変えただけの編集が通る）。
  expect(keepUnits('a:\n  keep:\n    [\n      "x",\n      "y"\n    ] # c\n')).toEqual(
    keepUnits('a:\n  keep: ["x", "y"] # c\n'),
  );
  // 弁別: 要素を落とせば単位が減る。
  expect(keepUnits('a:\n  keep:\n    [\n      "x"\n    ] # c\n')).not.toContain("<item: a.keep> y");
  // 次の行が開き括弧でなければ今までどおりブロック形式として扱う（行のまま残す）。
  expect(keepUnits('a:\n  keep:\n    - "x"\n')).toEqual(["a:", "<container: a.keep>", '    - "x"']);
});

test("折り返しの連結: 途中の空行・コメント行を挟んでも読む（同じ軸の内側）", () => {
  // ここで打ち切ると、比較元の折り返し行がそのまま単位になり、案内どおり 1 行へ書き直しても落ちる。
  expect(keepUnits('a:\n  keep: [\n\n    "x"\n  ] # c\n')).toEqual([
    "a:",
    "<container: a.keep>",
    "# c",
    "<item: a.keep> x",
  ]);
  // コメント行は単位として残す（黙って消せるようにしない）。
  expect(keepUnits('a:\n  keep: [\n    # note\n    "x"\n  ] # c\n')).toEqual([
    "a:",
    "<container: a.keep>",
    "# note",
    "# c",
    "<item: a.keep> x",
  ]);
});

test("折り返しの連結: 読めない形は行のまま突き合わせる（fail-closed）", () => {
  // 閉じないまま文書が終わる。
  expect(keepUnits('a:\n  keep: [\n    "x"\n')).toEqual(["a:", "  keep: [", '    "x"']);
  // 閉じないまま鍵のブロックを抜ける（続きの行を飲み込まない）。
  expect(keepUnits("a:\n  keep: [\n  other: 1\n")).toEqual(["a:", "  keep: [", "  other: 1"]);
});

test("空行を挟んだ折り返しでも、追記と 1 行への書き直しが通る（案内どおり直せば通る）", () => {
  const wrapped = [
    "      keep: [",
    "",
    '        "テーブル名を保つ"',
    "      ] # 変えない（例: テーブル名、項目名）",
  ].join("\n");
  const root = makeConfigRepo(
    CONFIG.replace(
      '      keep: ["テーブル名を保つ"] # 変えない（例: テーブル名、項目名）',
      wrapped,
    ),
  );
  // 追記だけ。
  writeConfig(
    root,
    readConfig(root).replace(
      '        "テーブル名を保つ"\n',
      '        "テーブル名を保つ",\n        "項目名を保つ"\n',
    ),
  );
  const added = run(root);
  expect(added.stdout).toMatch(/^ok: /m);
  expect(added.status).toBe(0);
  // 案内が指す「1 行へ書き直す」。
  writeConfig(
    root,
    readConfig(root).replace(
      wrapped,
      '      keep: ["テーブル名を保つ"] # 変えない（例: テーブル名、項目名）',
    ),
  );
  const rewritten = run(root);
  expect(rewritten.stdout).toMatch(/^ok: /m);
  expect(rewritten.status).toBe(0);
  rmSync(root, { recursive: true, force: true });
});

// 案内はファイル単位で出さない。読めないコンテナと無関係な鍵の削除に「復元せず表記を直す」が付くと、
// 記録した決定を消させないというツールの目的と逆向きの指示になる。
/** 閉じないコンテナ（比較元・現在で不変）と、別の鍵の育つコンテナを持つ設定。 */
const UNREADABLE_CONFIG = CONFIG.replace(
  "    component_diffs: []",
  "    component_diffs: [{component: grid, property: color}]",
).replace('      keep: ["テーブル名を保つ"] # 変えない（例: テーブル名、項目名）', "      keep: [");

test("読めないコンテナがあっても、無関係な鍵の削除には案内を出さない", () => {
  const root = makeConfigRepo(UNREADABLE_CONFIG);
  writeConfig(
    root,
    readConfig(root).replace(
      "    component_diffs: [{component: grid, property: color}]",
      "    component_diffs: []",
    ),
  );
  const r = run(root);
  expect(r.status).toBe(1);
  expect(r.stdout).toMatch(/component_diffs/);
  expect(r.stdout).not.toMatch(/閉じていないフロー形式のコンテナがある/);
  rmSync(root, { recursive: true, force: true });
});

test("陽性コントロール: 読めないコンテナ由来の消失には案内を出す", () => {
  const root = makeConfigRepo(UNREADABLE_CONFIG);
  writeConfig(root, readConfig(root).replace("      keep: [\n", ""));
  const r = run(root);
  expect(r.status).toBe(1);
  expect(r.stdout).toMatch(
    /閉じていないフロー形式のコンテナがある: skills\.replace-strategy\.intentional_diffs\.keep/,
  );
  rmSync(root, { recursive: true, force: true });
});

test("連結を打ち切らせた行（コンテナの外）の削除には案内を出さない", () => {
  // 打ち切らせた行を帰属材料に入れると、コンテナの外にある行を消しただけで案内が付く。
  const root = makeConfigRepo(
    UNREADABLE_CONFIG.replace("      keep: [\n", "      keep: [\n      note_line: 無関係なメモ\n"),
  );
  writeConfig(root, readConfig(root).replace("      note_line: 無関係なメモ\n", ""));
  const r = run(root);
  expect(r.status).toBe(1);
  expect(r.stdout).toMatch(/note_line/);
  expect(r.stdout).not.toMatch(/閉じていないフロー形式のコンテナがある/);
  rmSync(root, { recursive: true, force: true });
});

test("registry のグループ共通の単位が消えても、別の鍵の読めないコンテナに帰属させない", () => {
  // <registry-item: <グループ id>> は鍵をまたぐ移動を許すためグループ共通で、鍵を弁別できない。
  const root = makeConfigRepo(
    UNREADABLE_CONFIG.replace("      pending: [] # 保留（測定結果で決める）\n", PENDING_BLOCK),
  );
  writeConfig(
    root,
    readConfig(root).replace(PENDING_BLOCK, "      pending: [] # 保留（測定結果で決める）\n"),
  );
  const r = run(root);
  expect(r.status).toBe(1);
  expect(r.stdout).toMatch(/一覧の並び順が変わる/);
  expect(r.stdout).not.toMatch(/閉じていないフロー形式のコンテナがある/);
  rmSync(root, { recursive: true, force: true });
});

test("鍵と開き括弧の間に空行・コメント行があっても読む（joinWrappedFlow と対称）", () => {
  const wrapped = [
    "      keep:",
    "        # 注記",
    "        [",
    '          "テーブル名を保つ"',
    "        ] # 変えない（例: テーブル名、項目名）",
  ].join("\n");
  const root = makeConfigRepo(
    CONFIG.replace(
      '      keep: ["テーブル名を保つ"] # 変えない（例: テーブル名、項目名）',
      wrapped,
    ),
  );
  writeConfig(
    root,
    readConfig(root).replace(
      '          "テーブル名を保つ"\n',
      '          "テーブル名を保つ",\n          "項目名を保つ"\n',
    ),
  );
  const r = run(root);
  expect(r.stdout).toMatch(/^ok: /m);
  expect(r.status).toBe(0);
  rmSync(root, { recursive: true, force: true });
});

test("読めないコンテナの後ろにあるコメント行の削除には案内を出さない", () => {
  // 連結が失敗したときは閉じ括弧が無く、その注記が内にあったか外にあったかを区別できない。
  const root = makeConfigRepo(
    UNREADABLE_CONFIG.replace("      keep: [\n", "      keep: [\n      # 無関係な注記\n"),
  );
  writeConfig(root, readConfig(root).replace("      # 無関係な注記\n", ""));
  const r = run(root);
  expect(r.status).toBe(1);
  expect(r.stdout).toMatch(/無関係な注記/);
  expect(r.stdout).not.toMatch(/閉じていないフロー形式のコンテナがある/);
  rmSync(root, { recursive: true, force: true });
});

// registry は鍵をまたぐ移動（棚卸し）を許すので、要素行の注記は単位にしない（移動先に置き場所が無い。
// ブロック形式の flushRegistryItem と同じ判断）。閉じる行の注記は鍵の注記なので単位に残す。
const WRAPPED_PENDING = [
  "      pending: [",
  "        {item: 一覧の並び順が変わる, slug: cross-cutting}, # 注記",
  "      ] # 保留（測定結果で決める）",
].join("\n");

test("折り返した registry の要素行の注記は単位にしない（棚卸しが表記で割れない）", () => {
  const root = makeConfigRepo(
    CONFIG.replace("      pending: [] # 保留（測定結果で決める）", WRAPPED_PENDING),
  );
  // 正規の棚卸し: pending の文言を keep へ移す。
  writeConfig(
    root,
    readConfig(root)
      .replace(WRAPPED_PENDING, "      pending: [] # 保留（測定結果で決める）")
      .replace(
        '      keep: ["テーブル名を保つ"] #',
        '      keep: ["テーブル名を保つ", "一覧の並び順が変わる"] #',
      ),
  );
  const r = run(root);
  expect(r.stdout).toMatch(/^ok: /m);
  expect(r.status).toBe(0);
  rmSync(root, { recursive: true, force: true });
});

test("折り返した registry でも、閉じる行の注記（鍵の注記）を消せば落ちる", () => {
  const root = makeConfigRepo(
    CONFIG.replace("      pending: [] # 保留（測定結果で決める）", WRAPPED_PENDING),
  );
  writeConfig(root, readConfig(root).replace("      ] # 保留（測定結果で決める）", "      ]"));
  const r = run(root);
  expect(r.status).toBe(1);
  expect(r.stdout).toMatch(/保留（測定結果で決める）/);
  rmSync(root, { recursive: true, force: true });
});

test("弁別: 育つコンテナは折り返した要素行の注記も単位に残す（行末コメントの削除を落とす要求）", () => {
  const wrapped = [
    "    component_diffs: [",
    "      {component: grid, property: color}, # 注記",
    "    ]",
  ].join("\n");
  const root = makeConfigRepo(CONFIG.replace("    component_diffs: []", wrapped));
  writeConfig(root, readConfig(root).replace(", property: color}, # 注記", ", property: color},"));
  const r = run(root);
  expect(r.status).toBe(1);
  expect(r.stdout).toMatch(/注記/);
  rmSync(root, { recursive: true, force: true });
});

test("折り返したコンテナの中の独立したコメント行は、registry でも単位に残す", () => {
  // 要素に付いた注記と違って移動先の問題が無い。落とすと中の注記だけ黙って消せる（main では落ちていた）。
  const wrapped = [
    "      pending: [",
    "        # 大事な注記",
    "        {item: 一覧の並び順が変わる, slug: cross-cutting},",
    "      ] # 保留（測定結果で決める）",
  ].join("\n");
  const root = makeConfigRepo(
    CONFIG.replace("      pending: [] # 保留（測定結果で決める）", wrapped),
  );
  writeConfig(root, readConfig(root).replace("        # 大事な注記\n", ""));
  const r = run(root);
  expect(r.stdout).toMatch(/大事な注記/);
  expect(r.status).toBe(1);
  rmSync(root, { recursive: true, force: true });
});

test("要素が鍵と同じインデントに並ぶ折り返しも読む（js-yaml で妥当な YAML）", () => {
  const wrapped = [
    "      keep: [",
    '      "テーブル名を保つ"',
    "      ] # 変えない（例: テーブル名、項目名）",
  ].join("\n");
  const root = makeConfigRepo(
    CONFIG.replace(
      '      keep: ["テーブル名を保つ"] # 変えない（例: テーブル名、項目名）',
      wrapped,
    ),
  );
  writeConfig(
    root,
    readConfig(root).replace(
      '      "テーブル名を保つ"\n',
      '      "テーブル名を保つ",\n      "項目名を保つ"\n',
    ),
  );
  const r = run(root);
  expect(r.stdout).toMatch(/^ok: /m);
  expect(r.status).toBe(0);
  rmSync(root, { recursive: true, force: true });
});

test("比較元に読めないコンテナがあるときは「直せば通る」と案内しない", () => {
  // 比較元の行がそのまま単位なので、どの編集でも exit 0 に到達しない。実行できない指示を出さない。
  const root = makeConfigRepo(UNREADABLE_CONFIG);
  writeConfig(
    root,
    readConfig(root).replace("      keep: [\n", '      keep: ["テーブル名を保つ"] # 変えない\n'),
  );
  const r = run(root);
  expect(r.status).toBe(1);
  expect(r.stdout).toMatch(/比較元 .+ に閉じていないフロー形式のコンテナがある/);
  expect(r.stdout).toMatch(/判定できない/);
  rmSync(root, { recursive: true, force: true });
});

test("現在側だけが読めないときは 1 行への書き直しを案内する", () => {
  const root = makeConfigRepo();
  writeConfig(
    root,
    readConfig(root).replace(
      '      keep: ["テーブル名を保つ"] # 変えない（例: テーブル名、項目名）',
      "      keep: [",
    ),
  );
  const r = run(root);
  expect(r.status).toBe(1);
  expect(r.stdout).toMatch(/復元せず表記を直す/);
  expect(r.stdout).not.toMatch(/判定できない/);
  rmSync(root, { recursive: true, force: true });
});

/** 読めないコンテナとして記録されたキーパス（案内の材料）。 */
function wrappedPathsOf(src) {
  /** @type {{ path: string }[]} */
  const out = [];
  stripYamlBlocks(src, [], ["a.keep"], [], out);
  return out.map((w) => w.path);
}

test("閉じた後に余りがある形は「閉じていない」と案内しない", () => {
  // `[a] b` は**閉じてはいる**。1 行へ畳んでも同じく読めないので、その案内は指示にならない。
  expect(wrappedPathsOf('a:\n  keep: [\n    "x"\n  ],\n')).toEqual([]);
  // 陽性コントロール: 閉じないまま兄弟のキーへ出る形は記録する。
  expect(wrappedPathsOf("a:\n  keep: [\n  other: 1\n")).toEqual(["a.keep"]);
});

test("mutable_blocks の折り返しも配下ごと消費する（1 行への畳み込みで単位が消えない）", () => {
  const wrapped = ["      keep: [", '        "テーブル名を保つ"', "      ] # 変えない"].join("\n");
  const root = makeConfigRepo(
    CONFIG.replace(
      '      keep: ["テーブル名を保つ"] # 変えない（例: テーブル名、項目名）',
      wrapped,
    ),
  );
  const manifest = writeManifest(root, [
    {
      id: "project-config",
      pattern: ".config/skills/*/skills.yml",
      unit: "lines",
      mutable_blocks: ["skills.replace-strategy.intentional_diffs.keep"],
    },
  ]);
  writeConfig(
    root,
    readConfig(root).replace(
      wrapped,
      '      keep: ["テーブル名を保つ", "項目名を保つ"] # 変えない',
    ),
  );
  const r = run(root, ["--manifest", manifest]);
  expect(r.stdout).toMatch(/^ok: /m);
  expect(r.status).toBe(0);
  rmSync(root, { recursive: true, force: true });
});

test("mutable_blocks の折り返しでも、キーごと消せば落ちる（外しすぎていない）", () => {
  const wrapped = ["      keep: [", '        "テーブル名を保つ"', "      ] # 変えない"].join("\n");
  const root = makeConfigRepo(
    CONFIG.replace(
      '      keep: ["テーブル名を保つ"] # 変えない（例: テーブル名、項目名）',
      wrapped,
    ),
  );
  const manifest = writeManifest(root, [
    {
      id: "project-config",
      pattern: ".config/skills/*/skills.yml",
      unit: "lines",
      mutable_blocks: ["skills.replace-strategy.intentional_diffs.keep"],
    },
  ]);
  writeConfig(root, readConfig(root).replace(`${wrapped}\n`, ""));
  const r = run(root, ["--manifest", manifest]);
  expect(r.stdout).toMatch(/mutable-block/);
  expect(r.status).toBe(1);
  rmSync(root, { recursive: true, force: true });
});

test("mutable_blocks でも、開き括弧が次の行にある形を消費する（値の形で門番しない）", () => {
  const wrapped = [
    "      keep:",
    "      [",
    '        "テーブル名を保つ"',
    "      ] # 変えない",
  ].join("\n");
  const root = makeConfigRepo(
    CONFIG.replace(
      '      keep: ["テーブル名を保つ"] # 変えない（例: テーブル名、項目名）',
      wrapped,
    ),
  );
  const manifest = writeManifest(root, [
    {
      id: "project-config",
      pattern: ".config/skills/*/skills.yml",
      unit: "lines",
      mutable_blocks: ["skills.replace-strategy.intentional_diffs.keep"],
    },
  ]);
  writeConfig(
    root,
    readConfig(root).replace(
      wrapped,
      '      keep: ["テーブル名を保つ", "項目名を保つ"] # 変えない',
    ),
  );
  const r = run(root, ["--manifest", manifest]);
  expect(r.stdout).toMatch(/^ok: /m);
  expect(r.status).toBe(0);
  rmSync(root, { recursive: true, force: true });
});

test("mutable_blocks のブロック形式は今までどおり配下を外す（消費へ倒れていない）", () => {
  const root = makeConfigRepo(
    CONFIG.replace("      pending: [] # 保留（測定結果で決める）\n", PENDING_BLOCK),
  );
  const manifest = writeManifest(root, [
    {
      id: "project-config",
      pattern: ".config/skills/*/skills.yml",
      unit: "lines",
      mutable_blocks: ["skills.replace-strategy.intentional_diffs.pending"],
    },
  ]);
  // 配下の要素は単位から外れているので、消しても落ちない。
  writeConfig(
    root,
    readConfig(root).replace(PENDING_BLOCK, "      pending: # 保留（測定結果で決める）\n"),
  );
  const r = run(root, ["--manifest", manifest]);
  expect(r.stdout).toMatch(/^ok: /m);
  expect(r.status).toBe(0);
  rmSync(root, { recursive: true, force: true });
});
