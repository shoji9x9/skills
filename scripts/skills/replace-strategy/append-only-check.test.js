// replace-strategy の追記専用チェッカ（append-only-check.mjs）の回帰テスト（Issue #310）。
//
// スキル群は決定を積み上げる成果物への書き込みを「非破壊追記」と定めているが、追記であることを
// 確かめるツールが無いと、積み上げた文書を丸ごと書き直しても現在の内容が整合していれば全部通る。
// 失われるのは過去の決定（なぜ許容したか・いつ誰が承認したか）で、収束の判定は現在の状態しか見ない。
//
// 追記だけなら exit 0 になり、整形だけでは落ちないことも確かめる。これが無いと「常に落とす」実装と区別できない。
// 併せて、原本が明示的に求めるその場の更新（状態列の 未→済・Issue 列の 未起票→番号・版の +1・
// 空配列への最初の追記）を、誤って縮小と判定しないことも測る。誤検出するチェックは収束を止めるだけで、
// 決定を 1 つも守らない。

import { test, expect } from "vitest";
import {
  flowItems,
  stripYamlBlocks,
} from "../../../skills/replace-strategy/scripts/append-only-check.mjs";
import { appendFileSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { makeTempDirFactory } from "../../lib/test-tmpdir.js";
import { spawnAsync } from "../../lib/spawn-async.js";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const script = join(repoRoot, "skills/replace-strategy/scripts/append-only-check.mjs");

// **テストは `test.concurrent` で並べて実行する**（Issue #590）。どのテストも git とチェックの子プロセスの終了を待つだけなので、
// 並べた分だけ 1 回の実行が縮み、ミューテーションテストでは変異の数だけ反映される。
// そのため、テストの間で状態を共有しない。fixture はテストごとに別の一時ディレクトリに作る（`tempDir`）。
const tempDir = makeTempDirFactory("append-only-check-");

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
  "| ロゴ | `logo.png` | 実体をコピーする | - | 有効 | 2026-09-01・setup | 再配布可を確認済み |",
  "| 本文の書体 | `body.woff2` | 実体をコピーする | - | 有効 | 2026-09-01・setup | 字形を一致させるため |",
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
async function makeRepo(opts = {}) {
  const root = tempDir("append-only-");
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
    const r = await spawnAsync("git", ["-C", root, ...args]);
    if (r.status !== 0) throw new Error(`git ${args.join(" ")} failed: ${r.stderr}`);
  }
  return root;
}

/**
 * @param {string} root
 * @param {string[]} [extra]
 */
async function run(root, extra = []) {
  const r = await spawnAsync(process.execPath, [script, "--root", root, ...extra]);
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

test.concurrent("誤検知しないことの確認: 追記だけなら exit 0", async () => {
  const root = await makeRepo();
  appendFileSync(join(root, ".replace/features.md"), "| order-detail | 注文詳細 | 未 | 未起票 |\n");
  const r = await run(root);
  expect(r.stdout).toMatch(/^ok: /m);
  expect(r.status).toBe(0);
  rmSync(root, { recursive: true, force: true });
});

test.concurrent("行を消して書き直すと落ちる", async () => {
  const root = await makeRepo();
  writeFileSync(
    join(root, ".replace/features.md"),
    FEATURES.replace("| order-edit | 注文編集 | 未 | 未起票 |\n", ""),
  );
  const r = await run(root);
  expect(r.stdout).toMatch(/1 件（unit: markdown-structure）が失われている/);
  expect(r.stdout).toMatch(/order-edit/);
  expect(r.status).toBe(1);
  rmSync(root, { recursive: true, force: true });
});

test.concurrent("台帳ごと消すと落ちる", async () => {
  const root = await makeRepo();
  rmSync(join(root, ".replace/parity/order-list/gaps.md"));
  const r = await run(root);
  expect(r.stdout).toMatch(/追記専用の成果物が消えている.*gaps\.md/);
  expect(r.status).toBe(1);
  rmSync(root, { recursive: true, force: true });
});

test.concurrent("表の桁を詰め直しただけでは落ちない（空白を畳んで突き合わせる）", async () => {
  const root = await makeRepo();
  writeFileSync(
    join(root, ".replace/features.md"),
    FEATURES.replace(
      "| order-list | 注文一覧 | 済 | #11 |",
      "|   order-list |  注文一覧  |  済 |  #11   |",
    ),
  );
  const r = await run(root);
  expect(r.status).toBe(0);
  rmSync(root, { recursive: true, force: true });
});

test.concurrent("同じ行が 2 回在ったのが 1 回に減っても落ちる（多重度を見る）", async () => {
  const root = await makeRepo();
  const path = join(root, ".replace/features.md");
  appendFileSync(path, "| order-list | 注文一覧（別ページ） | 済 | #12 |\n");
  await spawnAsync("git", ["-C", root, "commit", "-qam", "dup"]);
  writeFileSync(path, FEATURES);
  const r = await run(root);
  expect(r.stdout).toMatch(/1 件（unit: markdown-structure）が失われている/);
  expect(r.status).toBe(1);
  rmSync(root, { recursive: true, force: true });
});

test.concurrent("追記専用の成果物が 1 件も無ければ合格として扱わない（exit 2）", async () => {
  const root = tempDir("append-only-empty-");
  writeFileSync(join(root, "README.md"), "x\n");
  for (const args of [
    ["init", "-q", "."],
    ["config", "user.email", "test@example.com"],
    ["config", "user.name", "test"],
    ["add", "-A"],
    ["commit", "-qm", "init"],
  ]) {
    await spawnAsync("git", ["-C", root, ...args]);
  }
  const r = await run(root);
  expect(r.stderr).toMatch(/対象 0 件を合格として扱わない/);
  expect(r.status).toBe(2);
  rmSync(root, { recursive: true, force: true });
});

test.concurrent("git リポジトリでなければ合格として扱わない（exit 2）", async () => {
  const root = tempDir("append-only-nogit-");
  const r = await run(root);
  expect(r.stderr).toMatch(/git リポジトリではない/);
  expect(r.status).toBe(2);
  rmSync(root, { recursive: true, force: true });
});

test.concurrent("比較元に無い新規ファイルは縮んでいないものとして扱う", async () => {
  const root = await makeRepo();
  writeFileSync(join(root, ".replace/components.md"), "# 共通部品\n\n| slug | 部品 |\n|---|---|\n");
  const r = await run(root);
  expect(r.stdout).toMatch(/新規（比較元 HEAD に無い）: \.replace\/components\.md/);
  expect(r.status).toBe(0);
  rmSync(root, { recursive: true, force: true });
});

test.concurrent("リポジトリの一階層下を --root に渡しても突き合わせが成立する", async () => {
  // ls-tree の既定は cwd 相対、`git show <rev>:<path>` はトップレベル起点。揃えないと全件が
  // 誤って「比較元に無い＝新規」と判定され、行を消しても「比較元に在る成果物が 0 件」で落ちる（原因が別物に見える）。
  const repo = tempDir("append-only-subdir-");
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
    const r = await spawnAsync("git", ["-C", repo, ...args]);
    if (r.status !== 0) throw new Error(`git ${args.join(" ")} failed: ${r.stderr}`);
  }
  const root = join(repo, "app");

  // 誤検知しないことの確認: 追記だけなら通る（「常に落とす」実装と区別する）。
  appendFileSync(join(root, ".replace/features.md"), "| order-detail | 注文詳細 | 未 | 未起票 |\n");
  const ok = await run(root);
  expect(ok.stdout).toMatch(/比較元にも在る 2 件を突き合わせた/);
  expect(ok.status).toBe(0);

  // 行を消せば落ちる（突き合わせが実際に成立している）。
  writeFileSync(
    join(root, ".replace/features.md"),
    FEATURES.replace("| order-edit | 注文編集 | 未 | 未起票 |\n", ""),
  );
  const ng = await run(root);
  expect(ng.stdout).toMatch(/1 件（unit: markdown-structure）が失われている/);
  expect(ng.stdout).toMatch(/order-edit/);
  expect(ng.status).toBe(1);
  rmSync(repo, { recursive: true, force: true });
});

test.concurrent("比較元に在る追記専用の成果物が 0 件なら合格として扱わない（突き合わせが成立していない）", async () => {
  const root = tempDir("append-only-uncommitted-");
  writeFileSync(join(root, "README.md"), "x\n");
  for (const args of [
    ["init", "-q", "."],
    ["config", "user.email", "test@example.com"],
    ["config", "user.name", "test"],
    ["add", "README.md"],
    ["commit", "-qm", "init"],
  ]) {
    await spawnAsync("git", ["-C", root, ...args]);
  }
  // 成果物は作業ツリーにあるが 1 度もコミットされていない（比較元 HEAD に無い）。
  mkdirSync(join(root, ".replace"), { recursive: true });
  writeFileSync(join(root, ".replace/features.md"), FEATURES);
  const r = await run(root);
  expect(r.stdout).toMatch(/比較元 HEAD に在る追記専用の成果物が 0 件/);
  expect(r.status).toBe(1);
  rmSync(root, { recursive: true, force: true });
});

test.concurrent("原本が求めるその場の更新（状態列 未→済・Issue 列 未起票→番号・最終更新）は縮小にしない", async () => {
  const root = await makeRepo();
  writeFileSync(
    join(root, ".replace/features.md"),
    FEATURES.replace(
      "| order-edit | 注文編集 | 未 | 未起票 |",
      "| order-edit | 注文編集 | 済 | #42 |",
    ).replace("- 最終更新: 2026-09-01T00:00:00Z", "- 最終更新: 2026-09-17T00:00:00Z"),
  );
  const r = await run(root);
  expect(r.stdout).toMatch(/^ok: /m);
  expect(r.status).toBe(0);
  rmSync(root, { recursive: true, force: true });
});

test.concurrent("列を足す非破壊更新は縮小にしない（区切り行の桁も変わる）", async () => {
  const root = await makeRepo();
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
  const r = await run(root);
  expect(r.status).toBe(0);
  rmSync(root, { recursive: true, force: true });
});

test.concurrent("列を消すと落ちる（markdown-structure でも列は守る）", async () => {
  const root = await makeRepo();
  writeFileSync(
    join(root, ".replace/features.md"),
    FEATURES.replace("| slug | 名前 | 状態 | Issue |", "| slug | 名前 | 状態 |"),
  );
  const r = await run(root);
  expect(r.stdout).toMatch(/Issue/);
  expect(r.status).toBe(1);
  rmSync(root, { recursive: true, force: true });
});

test.concurrent("見出しを消すと落ちる（節に属する単位もまとめて失われる）", async () => {
  const root = await makeRepo();
  writeFileSync(join(root, ".replace/features.md"), FEATURES.replace("# 機能一覧\n", ""));
  const r = await run(root);
  expect(r.stdout).toMatch(/H:機能一覧/);
  expect(r.stdout).toMatch(/（unit: markdown-structure）が失われている/);
  expect(r.status).toBe(1);
  rmSync(root, { recursive: true, force: true });
});

test.concurrent("dataset の version を上げて changes を追記しても縮小にしない（json-arrays）", async () => {
  const root = await makeRepo();
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
  const r = await run(root);
  expect(r.stdout).toMatch(/^ok: /m);
  expect(r.status).toBe(0);
  rmSync(root, { recursive: true, force: true });
});

test.concurrent("dataset の過去の changes 要素を書き換えると落ちる（json-arrays で検出されることの確認）", async () => {
  const root = await makeRepo();
  writeFileSync(
    join(root, ".replace/dataset/metadata.json"),
    `${JSON.stringify({ version: 2, changes: [{ version: 2, affects: ["invoices"] }] }, null, 2)}\n`,
  );
  const r = await run(root);
  expect(r.stdout).toMatch(/1 件（unit: json-arrays）が失われている/);
  expect(r.stdout).toMatch(/changes\|/);
  expect(r.status).toBe(1);
  rmSync(root, { recursive: true, force: true });
});

test.concurrent("空の例外台帳へ最初の承認を追記しても縮小にしない", async () => {
  const root = await makeRepo({ emptyExceptions: true });
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
  const r = await run(root);
  expect(r.stdout).toMatch(/^ok: /m);
  expect(r.status).toBe(0);
  rmSync(root, { recursive: true, force: true });
});

test.concurrent("一覧の unit が語彙外なら合格として扱わない（exit 2）", async () => {
  const root = await makeRepo();
  const manifest = writeManifest(root, [
    { id: "features", pattern: ".replace/features.md", unit: "diff" },
  ]);
  const r = await run(root, ["--manifest", manifest]);
  expect(r.stderr).toMatch(/unit が語彙外/);
  expect(r.status).toBe(2);
  rmSync(root, { recursive: true, force: true });
});

test.concurrent("unit が json-arrays なのに arrays が空なら合格として扱わない（exit 2）", async () => {
  const root = await makeRepo();
  const manifest = writeManifest(root, [
    { id: "dataset", pattern: ".replace/dataset/metadata.json", unit: "json-arrays", arrays: [] },
  ]);
  const r = await run(root, ["--manifest", manifest]);
  expect(r.stderr).toMatch(/json-arrays なのに arrays が空/);
  expect(r.status).toBe(2);
  rmSync(root, { recursive: true, force: true });
});

test.concurrent("同じファイルに突き合わせ方の違う項目が当たれば合格として扱わない（exit 2）", async () => {
  const root = await makeRepo();
  const manifest = writeManifest(root, [
    { id: "features-lines", pattern: ".replace/features.md", unit: "lines" },
    { id: "features-structure", pattern: ".replace/*.md", unit: "markdown-structure" },
  ]);
  const r = await run(root, ["--manifest", manifest]);
  expect(r.stderr).toMatch(/突き合わせ方の違う一覧の項目が当たっている/);
  expect(r.status).toBe(2);
  rmSync(root, { recursive: true, force: true });
});

test.concurrent("json-arrays の対象が JSON として不正なら合格として扱わない（exit 2）", async () => {
  const root = await makeRepo();
  writeFileSync(join(root, ".replace/dataset/metadata.json"), "{ broken\n");
  const r = await run(root);
  expect(r.stderr).toMatch(/JSON として読めない/);
  expect(r.status).toBe(2);
  rmSync(root, { recursive: true, force: true });
});

test.concurrent("unit を持たない旧い一覧は lines として読む（後方互換）", async () => {
  const root = await makeRepo();
  const manifest = writeManifest(root, [{ id: "features", pattern: ".replace/features.md" }]);
  // 状態列のその場の更新は lines では縮小になる（unit 既定が lines であることの証拠）。
  writeFileSync(
    join(root, ".replace/features.md"),
    FEATURES.replace(
      "| order-edit | 注文編集 | 未 | 未起票 |",
      "| order-edit | 注文編集 | 済 | #42 |",
    ),
  );
  const r = await run(root, ["--manifest", manifest]);
  expect(r.stdout).toMatch(/1 件（unit: lines）が失われている/);
  expect(r.status).toBe(1);
  rmSync(root, { recursive: true, force: true });
});

test.concurrent("比較元の木に在るのに内容を取り出せなければ合格として扱わない（exit 2）", async () => {
  // gitlink（サブモジュール相当）は ls-tree に名前が出るのに `git show <rev>:<path>` が失敗する。
  // これを「比較元に無い＝新規」として扱うと、一部だけ取り出せないときに縮小が数えられないまま素通りする。
  const root = await makeRepo();
  /** @param {string[]} args */
  const g = async (args) => await spawnAsync("git", ["-C", root, ...args]);
  await g([
    "update-index",
    "--add",
    "--cacheinfo",
    "160000,0000000000000000000000000000000000000001,.replace/parity/sub/gaps.md",
  ]);
  const tree = (await g(["write-tree"])).stdout.trim();
  const head = (await g(["rev-parse", "HEAD"])).stdout.trim();
  const commit = (await g(["commit-tree", tree, "-p", head, "-m", "link"])).stdout.trim();
  expect(commit).toMatch(/^[0-9a-f]{40}$/);
  await g(["update-ref", "HEAD", commit]);
  const r = await run(root);
  expect(r.stderr).toMatch(/木に在るのに内容を取り出せない/);
  expect(r.status).toBe(2);
  rmSync(root, { recursive: true, force: true });
});

test.concurrent("例外の間で承認記録を入れ替えると落ちる（要素の同一性は深い等価で取る）", async () => {
  // 行の多重集合では approved_at の 2 行が保たれて素通りする。どの例外を誰がいつ承認したかが入れ替わる。
  const root = await makeRepo();
  const path = join(root, ".replace/parity/order-list/component-diff-exceptions.json");
  const doc = JSON.parse(readFileSync(path, "utf8"));
  const [a, b] = doc.component_diff_exceptions;
  [a.approved_at, b.approved_at] = [b.approved_at, a.approved_at];
  writeFileSync(path, `${JSON.stringify(doc, null, 2)}\n`);
  const r = await run(root);
  expect(r.stdout).toMatch(/2 件（unit: json-arrays）が失われている/);
  expect(r.status).toBe(1);
  rmSync(root, { recursive: true, force: true });
});

test.concurrent("未測定の項目を消すと落ちる（gaps.md を触らなくても捕まる）", async () => {
  const root = await makeRepo();
  const path = join(root, ".replace/parity/order-list/metadata.json");
  const doc = JSON.parse(readFileSync(path, "utf8"));
  doc.unmeasured.entries = doc.unmeasured.entries.filter((e) => e.item !== "モバイル幅");
  writeFileSync(path, `${JSON.stringify(doc, null, 2)}\n`);
  const r = await run(root);
  expect(r.stdout).toMatch(
    /unmeasured\.entries の要素が失われている（item=モバイル幅: 比較元 1 件 → 現在 0 件）/,
  );
  expect(r.status).toBe(1);
  rmSync(root, { recursive: true, force: true });
});

test.concurrent("未測定の blocking → accepted（承認の追記）は正規の遷移なので通す", async () => {
  const root = await makeRepo();
  const path = join(root, ".replace/parity/order-list/metadata.json");
  const doc = JSON.parse(readFileSync(path, "utf8"));
  const entry = doc.unmeasured.entries[1];
  entry.disposition = "accepted";
  entry.approved_by = "user";
  entry.approved_at = "2026-09-17T00:00:00Z";
  writeFileSync(path, `${JSON.stringify(doc, null, 2)}\n`);
  const r = await run(root);
  expect(r.stdout).toMatch(/^ok: /m);
  expect(r.status).toBe(0);
  rmSync(root, { recursive: true, force: true });
});

test.concurrent("key を宣言した配列の要素に鍵が無ければ合格として扱わない（exit 2）", async () => {
  const root = await makeRepo();
  const path = join(root, ".replace/parity/order-list/metadata.json");
  const doc = JSON.parse(readFileSync(path, "utf8"));
  doc.unmeasured.entries[0].item = "";
  writeFileSync(path, `${JSON.stringify(doc, null, 2)}\n`);
  const r = await run(root);
  expect(r.stderr).toMatch(/空でない文字列の item が無い/);
  expect(r.status).toBe(2);
  rmSync(root, { recursive: true, force: true });
});

test.concurrent("unit が json-arrays でないのに key があれば合格として扱わない（exit 2）", async () => {
  const root = await makeRepo();
  const manifest = writeManifest(root, [
    { id: "features", pattern: ".replace/features.md", unit: "markdown-structure", key: "item" },
  ]);
  const r = await run(root, ["--manifest", manifest]);
  expect(r.stderr).toMatch(/unit が markdown-structure なのに key がある/);
  expect(r.status).toBe(2);
  rmSync(root, { recursive: true, force: true });
});

test.concurrent("決定行の非鍵セルを書き換えると落ちる（鍵だけを残す書き換えを通さない）", async () => {
  const root = await makeRepo();
  writeFileSync(
    join(root, ".replace/assets.md"),
    ASSETS.replace(
      "| ロゴ | `logo.png` | 実体をコピーする | - | 有効 | 2026-09-01・setup | 再配布可を確認済み |",
      "| ロゴ | `logo.svg` | 同等物を作る | - | 有効 | 2026-09-17・order | 再配布不可のため |",
    ),
  );
  const r = await run(root);
  expect(r.stdout).toMatch(/（unit: markdown-structure）が失われている/);
  expect(r.stdout).toMatch(/ロゴ@0\|/);
  expect(r.status).toBe(1);
  rmSync(root, { recursive: true, force: true });
});

test.concurrent("assets.md の 状態 列は原本が更新を定めているので通す（mutable_columns）", async () => {
  const root = await makeRepo();
  writeFileSync(
    join(root, ".replace/assets.md"),
    ASSETS.replace(
      "| ロゴ | `logo.png` | 実体をコピーする | 有効 |",
      "| ロゴ | `logo.png` | 実体をコピーする | 取り消し済み（2026-09-17 → 下の行） |",
    ),
  );
  const r = await run(root);
  expect(r.stdout).toMatch(/^ok: /m);
  expect(r.status).toBe(0);
  rmSync(root, { recursive: true, force: true });
});

test.concurrent("承認済みの未測定項目の承認日時を差し替えると落ちる（fill_only は空 → 非空だけ）", async () => {
  const root = await makeRepo();
  const path = join(root, ".replace/parity/order-list/metadata.json");
  const doc = JSON.parse(readFileSync(path, "utf8"));
  const entry = doc.unmeasured.entries[1];
  entry.disposition = "accepted";
  entry.approved_by = "user";
  entry.approved_at = "2026-09-17T00:00:00Z";
  writeFileSync(path, `${JSON.stringify(doc, null, 2)}\n`);
  const g = async (args) => await spawnAsync("git", ["-C", root, ...args]);
  await g(["commit", "-qam", "approve"]);
  // ここまでが正規の遷移。以降は承認記録の差し替え。
  entry.approved_by = "someone-else";
  entry.approved_at = "2026-01-01T00:00:00Z";
  writeFileSync(path, `${JSON.stringify(doc, null, 2)}\n`);
  const r = await run(root);
  expect(r.stdout).toMatch(/approved_by が空でない値から書き換えられている/);
  expect(r.stdout).toMatch(/approved_at が空でない値から書き換えられている/);
  expect(r.status).toBe(1);
  rmSync(root, { recursive: true, force: true });
});

test.concurrent("未測定項目の理由を書き換えると落ちる（鍵以外はデフォルトで不変）", async () => {
  const root = await makeRepo();
  const path = join(root, ".replace/parity/order-list/metadata.json");
  const doc = JSON.parse(readFileSync(path, "utf8"));
  doc.unmeasured.entries[0].reason = "別の理由に差し替えた";
  writeFileSync(path, `${JSON.stringify(doc, null, 2)}\n`);
  const r = await run(root);
  expect(r.stdout).toMatch(/reason が書き換えられている/);
  expect(r.status).toBe(1);
  rmSync(root, { recursive: true, force: true });
});

test.concurrent("宣言に無い disposition の遷移は落ちる", async () => {
  const root = await makeRepo();
  const path = join(root, ".replace/parity/order-list/metadata.json");
  const doc = JSON.parse(readFileSync(path, "utf8"));
  doc.unmeasured.entries[0].disposition = "measured";
  writeFileSync(path, `${JSON.stringify(doc, null, 2)}\n`);
  const r = await run(root);
  expect(r.stdout).toMatch(/disposition が宣言に無い遷移で書き換えられている/);
  expect(r.status).toBe(1);
  rmSync(root, { recursive: true, force: true });
});

test.concurrent("transitions の表記が <変更前>-><変更後> でなければ合格として扱わない（exit 2）", async () => {
  const root = await makeRepo();
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
  const r = await run(root, ["--manifest", manifest]);
  expect(r.stderr).toMatch(/<変更前>-><変更後> の形でない/);
  expect(r.status).toBe(2);
  rmSync(root, { recursive: true, force: true });
});

test.concurrent("key が無いのに fill_only を宣言したら合格として扱わない（exit 2）", async () => {
  const root = await makeRepo();
  const manifest = writeManifest(root, [
    {
      id: "dataset",
      pattern: ".replace/dataset/metadata.json",
      unit: "json-arrays",
      arrays: ["changes"],
      fill_only: ["affects"],
    },
  ]);
  const r = await run(root, ["--manifest", manifest]);
  expect(r.stderr).toMatch(/key が無いのに fill_only がある/);
  expect(r.status).toBe(2);
  rmSync(root, { recursive: true, force: true });
});

test.concurrent("同じ鍵の 2 行の間でセルを入れ替えると落ちる（重複鍵で対応を失わない）", async () => {
  // assets.md は方針を覆した行と現在の行が同じ「種類」で 2 行並ぶ（原本が想定する形）。
  const root = await makeRepo();
  const rowA =
    "| ロゴ | `logo.png` | 実体をコピーする | - | 有効 | 2026-09-01・setup | 再配布可を確認済み |";
  const rowB =
    "| ロゴ | `logo.svg` | 同等物を作る | - | 有効 | 2026-09-10・order | 再配布不可のため |";
  const base = ASSETS.replace(
    "| 本文の書体 | `body.woff2` | 実体をコピーする | - | 有効 | 2026-09-01・setup | 字形を一致させるため |",
    rowB,
  );
  writeFileSync(join(root, ".replace/assets.md"), base);
  await spawnAsync("git", ["-C", root, "commit", "-qam", "two-logo-rows"]);
  // 行の中身だけを入れ替える（どちらの行も「ロゴ」のまま＝鍵は不変、決定の帰属だけが変わる）。
  const swapped = base.split("\n");
  const a = swapped.indexOf(rowA);
  const b = swapped.indexOf(rowB);
  expect(a).toBeGreaterThan(-1);
  expect(b).toBeGreaterThan(-1);
  swapped[a] = rowB;
  swapped[b] = rowA;
  writeFileSync(join(root, ".replace/assets.md"), swapped.join("\n"));
  const r = await run(root);
  expect(r.stdout).toMatch(/（unit: markdown-structure）が失われている/);
  expect(r.status).toBe(1);
  rmSync(root, { recursive: true, force: true });
});

test.concurrent("方針を覆す正規の手順（状態・宣言・理由を更新して新しい行を追記）は通す", async () => {
  // 原本: replace-strategy の references/static-assets.md「覆したときの手順」。
  const root = await makeRepo();
  const old =
    "| ロゴ | `logo.png` | 実体をコピーする | - | 有効 | 2026-09-01・setup | 再配布可を確認済み |";
  const revoked =
    "| ロゴ | `logo.png` | 実体をコピーする | 取り消し済み | 取り消し済み（2026-09-18 → 下の行） | 2026-09-01・setup | 再配布の可否を確認できず方針を覆した |";
  const appended =
    "| ロゴ | `logo.svg` | 同等物を作る | ロゴを図形で描き直す（縁と曲線の差は残る） | 有効 | 2026-09-18・order | 再配布不可のため |";
  writeFileSync(join(root, ".replace/assets.md"), ASSETS.replace(old, `${revoked}\n${appended}`));
  const r = await run(root);
  expect(r.stdout).toMatch(/^ok: /m);
  expect(r.status).toBe(0);
  rmSync(root, { recursive: true, force: true });
});

test.concurrent("決定の中身にあたる箇条書きの値を書き換えると落ちる", async () => {
  const root = await makeRepo();
  writeFileSync(
    join(root, ".replace/dependencies.md"),
    DEPENDENCIES.replace("- ライセンス: MIT", "- ライセンス: GPL"),
  );
  const r = await run(root);
  expect(r.stdout).toMatch(/（unit: markdown-structure）が失われている/);
  expect(r.stdout).toMatch(/ライセンス/);
  expect(r.status).toBe(1);
  rmSync(root, { recursive: true, force: true });
});

test.concurrent("原本が更新を定めている箇条書き（最終更新・方針の所在）は通す", async () => {
  const root = await makeRepo();
  writeFileSync(
    join(root, ".replace/dependencies.md"),
    DEPENDENCIES.replace(
      "- 最終更新: 2026-09-01T00:00:00Z",
      "- 最終更新: 2026-09-18T00:00:00Z",
    ).replace("- 方針の所在: 未確認", "- 方針の所在: 無し（ユーザー確認済み・2026-09-18）"),
  );
  const r = await run(root);
  expect(r.stdout).toMatch(/^ok: /m);
  expect(r.status).toBe(0);
  rmSync(root, { recursive: true, force: true });
});

test.concurrent("unit が json-arrays なのに mutable_bullets があれば合格として扱わない（exit 2）", async () => {
  const root = await makeRepo();
  const manifest = writeManifest(root, [
    {
      id: "dataset",
      pattern: ".replace/dataset/metadata.json",
      unit: "json-arrays",
      arrays: ["changes"],
      mutable_bullets: ["最終更新"],
    },
  ]);
  const r = await run(root, ["--manifest", manifest]);
  expect(r.stderr).toMatch(
    /json-arrays なのに mutable_columns \/ fill_only_columns \/ mutable_bullets \/ mutable_blocks \/ growable_containers \/ registry_groups がある/,
  );
  expect(r.status).toBe(2);
  rmSync(root, { recursive: true, force: true });
});

test.concurrent("unit が lines なのに mutable_bullets があれば合格として扱わない（exit 2）", async () => {
  const root = await makeRepo();
  const manifest = writeManifest(root, [
    {
      id: "project-config",
      pattern: ".config/skills/*/skills.yml",
      unit: "lines",
      mutable_bullets: ["最終更新"],
    },
  ]);
  const r = await run(root, ["--manifest", manifest]);
  expect(r.stderr).toMatch(/unit が lines なのに mutable_bullets がある/);
  expect(r.status).toBe(2);
  rmSync(root, { recursive: true, force: true });
});

// Issue #404: 同じ id を持つ項目が同じファイルに当たると、突き合わせ方が割れていても
// 先勝ちで無音に決まっていた（`assign` の id 一致による早期 return が整合性検査を飛ばしていた）。
test.concurrent("一覧の id が重複していれば合格として扱わない（exit 2）", async () => {
  const root = await makeRepo();
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
  const r = await run(root, ["--manifest", manifest]);
  expect(r.stderr).toMatch(/artifacts\[1\] の id が一覧の中で重複している: shared/);
  expect(r.status).toBe(2);
  rmSync(root, { recursive: true, force: true });
});

test.concurrent("id が違えば突き合わせ方の食い違いは従来どおり落ちる（対照）", async () => {
  const root = await makeRepo();
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
  const r = await run(root, ["--manifest", manifest]);
  expect(r.stderr).toMatch(/同じファイルに突き合わせ方の違う一覧の項目が当たっている/);
  expect(r.status).toBe(2);
  rmSync(root, { recursive: true, force: true });
});

test.concurrent("id が一意で突き合わせ方も同じなら、同じファイルに 2 項目が当たっても通る（誤検知しないことの確認）", async () => {
  const root = await makeRepo();
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
  const r = await run(root, ["--manifest", manifest]);
  expect(r.stdout).toMatch(/^ok: /m);
  expect(r.status).toBe(0);
  rmSync(root, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// 設定ファイル（project-config）の可変領域（Issue #426）
//
// intentional_diffs.pending は設定ファイル上で唯一スキルが追記する記録で、棚卸しで人が
// keep / may_change へ文言を移す。行の多重集合で見ると、この正規の運用が誤って「行が失われた」と判定され、
// 指示どおり復元すると記録した保留が消える（データを失う方向へ誘導される）。
// 緩和の範囲が広すぎないことも、検出できることの確認で測る。キーごと消す・keep の要素を落とす・
// 要素を別物へ差し替える、はいずれも落ちなければならない。
// ---------------------------------------------------------------------------

// **実在する設定ファイルの入れ子で測る**（`skills.<スキル名>.…`。原本は replace-strategy の
// references/project-config.md）。mutable_blocks はルートからの完全なパスで探すので、
// 平らな YAML の fixture では「外せているか」を一度も実証できない。平らな fixture では
// パスが一致せず、検査が厳しい側と判定されるだけなので、緩和のテストが全部素通りする。
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
async function commit(root, message) {
  for (const args of [
    ["add", "-A"],
    ["commit", "-qm", message],
  ]) {
    const r = await spawnAsync("git", ["-C", root, ...args]);
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
async function makeConfigRepo(text = CONFIG) {
  const root = await makeRepo();
  mkdirSync(join(root, ".config/skills/acme"), { recursive: true });
  writeConfig(root, text);
  await commit(root, "config");
  return root;
}

/** pending に 1 件積んだ状態を比較元にする。 */
async function makeConfigRepoWithPending() {
  const root = await makeConfigRepo();
  writeConfig(
    root,
    readConfig(root).replace("      pending: [] # 保留（測定結果で決める）\n", PENDING_BLOCK),
  );
  await commit(root, "pending に 1 件");
  return root;
}

test.concurrent("空リストのキーへ最初の要素をブロック形式で足しても縮小に数えない（Issue #426）", async () => {
  const root = await makeConfigRepo();
  writeConfig(
    root,
    readConfig(root).replace("      pending: [] # 保留（測定結果で決める）\n", PENDING_BLOCK),
  );
  const r = await run(root);
  expect(r.stdout).toMatch(/^ok: /m);
  expect(r.status).toBe(0);
  rmSync(root, { recursive: true, force: true });
});

test.concurrent("フロー形式のコンテナへ要素を足した行の書き換えは縮小に数えない（Issue #426）", async () => {
  const root = await makeConfigRepo();
  writeConfig(
    root,
    readConfig(root).replace(
      "      may_change: [] # 変えてよい（例: ディレクトリ・ファイル名）",
      '      may_change: ["新しい宣言"] # 変えてよい（例: ディレクトリ・ファイル名）',
    ),
  );
  const r = await run(root);
  expect(r.stdout).toMatch(/^ok: /m);
  expect(r.status).toBe(0);
  rmSync(root, { recursive: true, force: true });
});

test.concurrent("棚卸しで pending の要素を keep へ移しても縮小に数えない（Issue #426）", async () => {
  const root = await makeConfigRepoWithPending();
  writeConfig(
    root,
    readConfig(root)
      .replace(
        '      keep: ["テーブル名を保つ"] # 変えない（例: テーブル名、項目名）',
        '      keep: ["テーブル名を保つ", "一覧の並び順が変わる"] # 変えない（例: テーブル名、項目名）',
      )
      .replace(PENDING_BLOCK, "      pending: [] # 保留（測定結果で決める）\n"),
  );
  const r = await run(root);
  expect(r.stdout).toMatch(/^ok: /m);
  expect(r.status).toBe(0);
  rmSync(root, { recursive: true, force: true });
});

test.concurrent("pending の要素の中身を書き換えても通る（配下は単位から外れている）", async () => {
  const root = await makeConfigRepoWithPending();
  writeConfig(
    root,
    readConfig(root).replace("added_by: replace-strategy", "added_by: parity-suite"),
  );
  const r = await run(root);
  expect(r.stdout).toMatch(/^ok: /m);
  expect(r.status).toBe(0);
  rmSync(root, { recursive: true, force: true });
});

test.concurrent("pending をキーごと消せば落ちる（鍵の存在は別の単位で守る）", async () => {
  const root = await makeConfigRepoWithPending();
  writeConfig(root, readConfig(root).replace(PENDING_BLOCK, ""));
  const r = await run(root);
  expect(r.stdout).toMatch(/<registry: skills\.replace-strategy\.intentional_diffs\.pending>/);
  expect(r.status).toBe(1);
  rmSync(root, { recursive: true, force: true });
});

test.concurrent("棚卸しを経ずに pending の要素を消せば落ちる（削除の検出主体を検査が持つ）", async () => {
  // 配下を単位から外すだけだと、keep へ移さず丸ごと消した編集が通る。
  // pending-triage-check.mjs は「現在の pending」を母集合にするので、消えた要素は対象にならない。
  const root = await makeConfigRepoWithPending();
  writeConfig(
    root,
    readConfig(root).replace(PENDING_BLOCK, "      pending: [] # 保留（測定結果で決める）\n"),
  );
  const r = await run(root);
  expect(r.stdout).toMatch(/<registry-item: intentional-diffs> 一覧の並び順が変わる/);
  expect(r.status).toBe(1);
  rmSync(root, { recursive: true, force: true });
});

// --- 照合キー（match）を持つ要素（Issue #496）---
// keep / may_change / pending の要素は { item, match } のオブジェクトでも書ける。単位は item なので、
// match を書き足す・pending から match ごと移すのは通り、要素を消せば落ちる。

const MATCH_PENDING_BLOCK = [
  "      pending: # 保留（測定結果で決める）",
  "        - item: 見出しの border-style が現行 none・新側 solid。幅は両側 0px",
  "          match:",
  "            element: heading",
  "            property: border-*-style",
  "          slug: cross-cutting",
  "          added_by: replace-strategy",
  '          added_at: "2026-09-27"',
  "",
].join("\n");

test.concurrent("match を持つ pending の要素を match ごと may_change へ移しても縮小に数えない", async () => {
  const root = await makeConfigRepo();
  writeConfig(
    root,
    readConfig(root).replace("      pending: [] # 保留（測定結果で決める）\n", MATCH_PENDING_BLOCK),
  );
  await commit(root, "match 付きの pending");
  writeConfig(
    root,
    readConfig(root)
      .replace(
        "      may_change: [] # 変えてよい（例: ディレクトリ・ファイル名）\n",
        [
          "      may_change: # 変えてよい（例: ディレクトリ・ファイル名）",
          "        - item: 見出しの border-style が現行 none・新側 solid。幅は両側 0px",
          "          match: { element: heading, property: border-*-style }",
          "",
        ].join("\n"),
      )
      .replace(MATCH_PENDING_BLOCK, "      pending: [] # 保留（測定結果で決める）\n"),
  );
  const r = await run(root);
  expect(r.stdout).toMatch(/^ok: /m);
  expect(r.status).toBe(0);
  rmSync(root, { recursive: true, force: true });
});

test.concurrent("散文だけの keep の要素に match を書き足しても縮小に数えない（単位は item）", async () => {
  const root = await makeConfigRepo();
  writeConfig(
    root,
    readConfig(root).replace(
      '      keep: ["テーブル名を保つ"] # 変えない（例: テーブル名、項目名）\n',
      [
        "      keep: # 変えない（例: テーブル名、項目名）",
        "        - item: テーブル名を保つ",
        "          match: { element: order-table, property: data-table-name }",
        "",
      ].join("\n"),
    ),
  );
  const r = await run(root);
  expect(r.stdout).toMatch(/^ok: /m);
  expect(r.status).toBe(0);
  rmSync(root, { recursive: true, force: true });
});

test.concurrent("警告に従って match の値を書き直しても縮小に数えない（ブロック形式の複数行）", async () => {
  const root = await makeConfigRepo();
  writeConfig(
    root,
    readConfig(root).replace("      pending: [] # 保留（測定結果で決める）\n", MATCH_PENDING_BLOCK),
  );
  await commit(root, "match 付きの pending");
  writeConfig(
    root,
    readConfig(root).replace(
      "            property: border-*-style\n",
      "            property: border-top-style\n            page: order-list\n",
    ),
  );
  const r = await run(root);
  expect(r.stdout).toMatch(/^ok: /m);
  expect(r.status).toBe(0);
  rmSync(root, { recursive: true, force: true });
});

test.concurrent("match を持つ要素を棚卸しを経ずに消せば落ちる", async () => {
  const root = await makeConfigRepo();
  writeConfig(
    root,
    readConfig(root).replace("      pending: [] # 保留（測定結果で決める）\n", MATCH_PENDING_BLOCK),
  );
  await commit(root, "match 付きの pending");
  writeConfig(
    root,
    readConfig(root).replace(MATCH_PENDING_BLOCK, "      pending: [] # 保留（測定結果で決める）\n"),
  );
  const r = await run(root);
  expect(r.stdout).toMatch(
    /<registry-item: intentional-diffs> 見出しの border-style が現行 none・新側 solid。幅は両側 0px/,
  );
  expect(r.status).toBe(1);
  rmSync(root, { recursive: true, force: true });
});

test.concurrent("keep の既存要素を消せば落ちる（コンテナが育ったときだけ緩める）", async () => {
  const root = await makeConfigRepo();
  writeConfig(
    root,
    readConfig(root).replace(
      '      keep: ["テーブル名を保つ"] # 変えない（例: テーブル名、項目名）',
      "      keep: [] # 変えない（例: テーブル名、項目名）",
    ),
  );
  const r = await run(root);
  expect(r.stdout).toMatch(/失われている/);
  expect(r.status).toBe(1);
  rmSync(root, { recursive: true, force: true });
});

test.concurrent("keep の要素を別物へ差し替えれば落ちる", async () => {
  const root = await makeConfigRepo();
  writeConfig(
    root,
    readConfig(root).replace(
      '      keep: ["テーブル名を保つ"] # 変えない（例: テーブル名、項目名）',
      '      keep: ["別の宣言"] # 変えない（例: テーブル名、項目名）',
    ),
  );
  const r = await run(root);
  expect(r.stdout).toMatch(/失われている/);
  expect(r.status).toBe(1);
  rmSync(root, { recursive: true, force: true });
});

test.concurrent("外した領域の後ろに続くコメントを消せば落ちる（守るのはキーと注記）", async () => {
  const root = await makeConfigRepo();
  writeConfig(
    root,
    readConfig(root).replace(
      "      # ↑ 外した領域の後ろに続く注記（構造行ではないのでブロックを閉じない）\n",
      "",
    ),
  );
  const r = await run(root);
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

test.concurrent("同じ鍵のコンテナが片方だけ育っても、もう片方の要素の削除は落ちる", async () => {
  const root = await makeConfigRepo(TWO_TARGETS);
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
  const r = await run(root);
  expect(r.stdout).toMatch(/失われている/);
  expect(r.status).toBe(1);
  rmSync(root, { recursive: true, force: true });
});

test.concurrent("名指ししていない鍵は、同名の兄弟が両方とも育っても落ちる", async () => {
  // 緩和は growable_containers に挙げた鍵だけに適用される。行の多重集合は同名の兄弟を 1 つの鍵へ畳むので、
  // 名指しせずに「育った」を判定すると、兄弟の間で要素が移動しただけの編集まで通ってしまう。
  const root = await makeConfigRepo(TWO_TARGETS);
  writeConfig(
    root,
    readConfig(root).replaceAll(
      "forbidden_actions: [delete]",
      "forbidden_actions: [delete, update]",
    ),
  );
  const r = await run(root);
  expect(r.stdout).toMatch(/失われている/);
  expect(r.status).toBe(1);
  rmSync(root, { recursive: true, force: true });
});

test.concurrent("mutable_blocks がキーパスの形でなければ合格として扱わない（exit 2）", async () => {
  const root = await makeConfigRepo();
  const manifest = writeManifest(root, [
    {
      id: "project-config",
      pattern: ".config/skills/*/skills.yml",
      unit: "lines",
      mutable_blocks: ["intentional_diffs."],
    },
  ]);
  const r = await run(root, ["--manifest", manifest]);
  expect(r.stderr).toMatch(/mutable_blocks の要素がキーパスの形でない/);
  expect(r.status).toBe(2);
  rmSync(root, { recursive: true, force: true });
});

test.concurrent("unit が markdown-structure なのに mutable_blocks があれば合格として扱わない（exit 2）", async () => {
  const root = await makeConfigRepo();
  const manifest = writeManifest(root, [
    {
      id: "features",
      pattern: ".replace/features.md",
      unit: "markdown-structure",
      mutable_blocks: ["intentional_diffs.pending"],
    },
  ]);
  const r = await run(root, ["--manifest", manifest]);
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
async function makeDependencyRepo() {
  const root = await makeRepo();
  writeFileSync(join(root, ".replace/dependencies.md"), DEPENDENCY_TABLE);
  await commit(root, "dependencies 台帳");
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

test.concurrent("決定を覆すとき状態列の更新 ＋ 新しい行の追記なら通る（Issue #428）", async () => {
  const root = await makeDependencyRepo();
  writeDependencies(
    root,
    readDependencies(root).replace(
      "| 確認ダイアログ | 未確認 | — | — | 有効 | setup | 削除ボタンでしか出せず現行 target で削除が禁止されている |",
      `${OVERTURNED_ROW}\n| 確認ダイアログ | 自前実装 | — | 全機能 | 有効 | order-list の実装前 | 承認を得て現行で確かめ在ることを確認した |`,
    ),
  );
  const r = await run(root);
  expect(r.stdout).toMatch(/^ok: /m);
  expect(r.status).toBe(0);
  rmSync(root, { recursive: true, force: true });
});

test.concurrent("覆った行を消せば落ちる（状態列を取り消し済みにして残す取り決め）", async () => {
  const root = await makeDependencyRepo();
  writeDependencies(
    root,
    readDependencies(root).replace(
      "| 確認ダイアログ | 未確認 | — | — | 有効 | setup | 削除ボタンでしか出せず現行 target で削除が禁止されている |\n",
      "",
    ),
  );
  const r = await run(root);
  expect(r.stdout).toMatch(/失われている/);
  expect(r.status).toBe(1);
  rmSync(root, { recursive: true, force: true });
});

test.concurrent("決定列をその場で書き換えれば落ちる（mutable なのは状態列だけ）", async () => {
  const root = await makeDependencyRepo();
  writeDependencies(
    root,
    readDependencies(root).replace("| 確認ダイアログ | 未確認 |", "| 確認ダイアログ | 自前実装 |"),
  );
  const r = await run(root);
  expect(r.stdout).toMatch(/決定=未確認/);
  expect(r.status).toBe(1);
  rmSync(root, { recursive: true, force: true });
});

test.concurrent("理由・引き取り手列をその場で書き換えれば落ちる", async () => {
  const root = await makeDependencyRepo();
  writeDependencies(
    root,
    readDependencies(root).replace(
      "削除ボタンでしか出せず現行 target で削除が禁止されている",
      "別の理由に差し替えた",
    ),
  );
  const r = await run(root);
  expect(r.stdout).toMatch(/失われている/);
  expect(r.status).toBe(1);
  rmSync(root, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// 行末コメントと兄弟コンテナ（PR #429 のレビュー指摘）
//
// 原本の設定ファイルは `keep: [] # 変えない（…）` のようにコメント付きで書く。
// 行末が `]` であることを要求すると、実プロジェクトでは緩和が一度も発動せず、
// 合否がコメントの有無で割れる。コメント自体も取り決めの対象（「既存のキー・値・コメントは変更しない」）。
// 兄弟コンテナは中身が違うと別の正規化行になるため、失われた行ごとに独立へ判定すると
// 同じ 1 件の育ったコンテナを複数の兄弟が根拠にできる。
// ---------------------------------------------------------------------------

test.concurrent("行末コメント付きの空コンテナへ最初の要素を足しても縮小に数えない", async () => {
  const root = await makeConfigRepo();
  writeConfig(
    root,
    readConfig(root).replace(
      "      may_change: [] # 変えてよい（例: ディレクトリ・ファイル名）",
      '      may_change: ["HTML の id"] # 変えてよい（例: ディレクトリ・ファイル名）',
    ),
  );
  const r = await run(root);
  expect(r.stdout).toMatch(/^ok: /m);
  expect(r.status).toBe(0);
  rmSync(root, { recursive: true, force: true });
});

test.concurrent("growable_containers に挙げていないキーは、要素を足しただけでも落ちる", async () => {
  // 緩和は鍵を名指ししたものだけに適用される（名指ししないと、同名の兄弟の間で要素が移動しただけの
  // 編集まで通る）。名指ししていないキーは一覧の requirement どおり「値を変更しない」が掛かる。
  const root = await makeConfigRepo();
  writeConfig(root, readConfig(root).replace("    bare_list: []", '    bare_list: ["x"]'));
  const r = await run(root);
  expect(r.stdout).toMatch(/失われている/);
  expect(r.status).toBe(1);
  rmSync(root, { recursive: true, force: true });
});

test.concurrent("要素を足すついでに行末コメントを消せば落ちる（コメントも単位）", async () => {
  const root = await makeConfigRepo();
  writeConfig(
    root,
    readConfig(root).replace(
      "      may_change: [] # 変えてよい（例: ディレクトリ・ファイル名）",
      '      may_change: ["HTML の id"]',
    ),
  );
  const r = await run(root);
  expect(r.stdout).toMatch(/失われている/);
  expect(r.status).toBe(1);
  rmSync(root, { recursive: true, force: true });
});

test.concurrent("mutable_blocks で外したキー行の行末コメントを消せば落ちる", async () => {
  const root = await makeConfigRepo();
  writeConfig(
    root,
    readConfig(root).replace("      pending: [] # 保留（測定結果で決める）", "      pending: []"),
  );
  const r = await run(root);
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

test.concurrent("中身の違う兄弟でも、育った側を根拠に別の兄弟から要素を消せない", async () => {
  const root = await makeConfigRepo(TWO_TARGETS_DIFFERENT);
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
  const r = await run(root);
  expect(r.stdout).toMatch(/失われている/);
  expect(r.status).toBe(1);
  rmSync(root, { recursive: true, force: true });
});

test.concurrent("兄弟の間で要素が移動しただけの編集も落ちる（PR #429 の退行の回帰）", async () => {
  // current-test を空にして new-dev へ移す。鍵ごとの多重集合で判定すると、その鍵の下には
  // 要素が残っているので通ってしまう（現行環境の禁止操作の宣言を、警告なしに空にできる）。
  const root = await makeConfigRepo(TWO_TARGETS_DIFFERENT);
  writeConfig(
    root,
    readConfig(root)
      .replace("        forbidden_actions: [delete]\n", "        forbidden_actions: []\n")
      .replace(
        "        forbidden_actions: [delete, update]\n    intentional_diffs:",
        "        forbidden_actions: [delete, update, create]\n    intentional_diffs:",
      ),
  );
  const r = await run(root);
  expect(r.stdout).toMatch(/失われている/);
  expect(r.status).toBe(1);
  rmSync(root, { recursive: true, force: true });
});

test.concurrent("同じ鍵の空コンテナが 2 つあり片方を消せば落ちる（件数も見る）", async () => {
  const root = await makeConfigRepo(
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
  const r = await run(root);
  expect(r.stdout).toMatch(/失われている/);
  expect(r.status).toBe(1);
  rmSync(root, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// 一覧の突き合わせ方の食い違い・パス解決の抜け（PR #429 のレビュー指摘・2 巡目）
// ---------------------------------------------------------------------------

test.concurrent("同じファイルに当たる 2 項目で mutable_blocks だけ違えば合格として扱わない（exit 2）", async () => {
  // 比較に入っていないと、一覧の並び順で外す範囲が変わる。判定できないときに失敗するはずのチェックが、並び順次第で合格を返す。
  const root = await makeConfigRepo();
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
  const r = await run(root, ["--manifest", manifest]);
  expect(r.stderr).toMatch(/突き合わせ方の違う一覧の項目が当たっている/);
  expect(r.status).toBe(2);
  rmSync(root, { recursive: true, force: true });
});

test.concurrent("同じファイルに当たる 2 項目で growable_containers だけ違えば合格として扱わない（exit 2）", async () => {
  const root = await makeConfigRepo();
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
  const r = await run(root, ["--manifest", manifest]);
  expect(r.stderr).toMatch(/突き合わせ方の違う一覧の項目が当たっている/);
  expect(r.status).toBe(2);
  rmSync(root, { recursive: true, force: true });
});

test.concurrent("growable_containers がキーパスの形でなければ合格として扱わない（exit 2）", async () => {
  const root = await makeConfigRepo();
  const manifest = writeManifest(root, [
    {
      id: "project-config",
      pattern: ".config/skills/*/skills.yml",
      unit: "lines",
      growable_containers: ["intentional_diffs..keep"],
    },
  ]);
  const r = await run(root, ["--manifest", manifest]);
  expect(r.stderr).toMatch(/growable_containers の要素がキーパスの形でない/);
  expect(r.status).toBe(2);
  rmSync(root, { recursive: true, force: true });
});

test.concurrent("リスト要素の配下にある同名キーは外れない（パスが親を継がない）", async () => {
  const root = await makeConfigRepo(
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
  const r = await run(root);
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

test.concurrent("プレーンスカラーのアポストロフィがあっても要素を足せる（引用符として読まない）", async () => {
  // YAML では `[don't rename]` のアポストロフィは引用符ではない。開き引用符として読むと行末まで
  // 閉じず、コメントも値も読めないまま緩和が無音で外れ、正しい追記が「決定が失われている」になる。
  const root = await makeConfigRepo(PLAIN_APOSTROPHE);
  writeConfig(
    root,
    readConfig(root).replace(
      "      keep: [don't rename tables] #",
      "      keep: [don't rename tables, keep api paths] #",
    ),
  );
  const r = await run(root);
  expect(r.stdout).toMatch(/^ok: /m);
  expect(r.status).toBe(0);
  rmSync(root, { recursive: true, force: true });
});

test.concurrent("アポストロフィ入りの要素を消せば落ちる（緩めすぎていない）", async () => {
  const root = await makeConfigRepo(PLAIN_APOSTROPHE);
  writeConfig(
    root,
    readConfig(root).replace("      keep: [don't rename tables] #", "      keep: [] #"),
  );
  const r = await run(root);
  expect(r.stdout).toMatch(/失われている/);
  expect(r.status).toBe(1);
  rmSync(root, { recursive: true, force: true });
});

test.concurrent("引用符つきの値の中のカンマで要素を分割しない", async () => {
  const root = await makeConfigRepo(PLAIN_APOSTROPHE);
  writeConfig(
    root,
    readConfig(root).replace(
      "      keep: [don't rename tables] #",
      '      keep: [don\'t rename tables, "a, b"] #',
    ),
  );
  const r = await run(root);
  expect(r.stdout).toMatch(/^ok: /m);
  expect(r.status).toBe(0);
  rmSync(root, { recursive: true, force: true });
});

test.concurrent("growable の鍵の注記を上の行へ移しても通る（mutable_blocks 側と対称）", async () => {
  const root = await makeConfigRepo(PLAIN_APOSTROPHE);
  writeConfig(
    root,
    readConfig(root).replace(
      "    component_diffs: [] # コンポーネント系統差レジストリ\n",
      "    # コンポーネント系統差レジストリ\n    component_diffs: []\n",
    ),
  );
  const r = await run(root);
  expect(r.stdout).toMatch(/^ok: /m);
  expect(r.status).toBe(0);
  rmSync(root, { recursive: true, force: true });
});

test.concurrent("growable の鍵の注記を消せば落ちる", async () => {
  const root = await makeConfigRepo(PLAIN_APOSTROPHE);
  writeConfig(
    root,
    readConfig(root).replace(
      "    component_diffs: [] # コンポーネント系統差レジストリ\n",
      "    component_diffs: []\n",
    ),
  );
  const r = await run(root);
  expect(r.stdout).toMatch(/失われている/);
  expect(r.status).toBe(1);
  rmSync(root, { recursive: true, force: true });
});

test.concurrent("キーパスに `-` だけのセグメントを書けば合格として扱わない（exit 2）", async () => {
  // `-` は stripYamlBlocks がリスト要素へ積むマーカーと同じ綴り。名指しできると全リスト要素が
  // 同じ鍵を共有し、兄弟を区別できなくなる（片方から要素を消しても通る抜けが、設定次第で戻る）。
  const root = await makeConfigRepo();
  const manifest = writeManifest(root, [
    {
      id: "project-config",
      pattern: ".config/skills/*/skills.yml",
      unit: "lines",
      growable_containers: ["skills.replace-strategy.targets.-.forbidden_actions"],
    },
  ]);
  const r = await run(root, ["--manifest", manifest]);
  expect(r.stderr).toMatch(/growable_containers の要素がキーパスの形でない/);
  expect(r.status).toBe(2);
  rmSync(root, { recursive: true, force: true });
});

test.concurrent("引用符つきの要素がある行へ、引用符の無い要素を足しても通る", async () => {
  // 引用符を「閉じなければ無視して読み直す」形にすると、同じ値でも同じ行の別の要素次第で
  // 読み方が変わり、比較元と現在で別モードが選ばれる（要素を足しただけで縮小に見える）。
  const root = await makeConfigRepo(
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
  const r = await run(root);
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

test.concurrent("照合キーが 1 行目に無い要素も棚卸しで移せる（要素の全行から探す）", async () => {
  const root = await makeConfigRepo(KEY_ORDER_PENDING);
  writeConfig(
    root,
    readConfig(root)
      .replace(KEY_ORDER_ITEM, "")
      .replace("keep: [] #", 'keep: ["キー順が違う要素"] #'),
  );
  const r = await run(root);
  expect(r.stdout).toMatch(/^ok: /m);
  expect(r.status).toBe(0);
  rmSync(root, { recursive: true, force: true });
});

test.concurrent("照合キーが 1 行目に無い要素の文言を差し替えれば落ちる", async () => {
  const root = await makeConfigRepo(KEY_ORDER_PENDING);
  writeConfig(
    root,
    readConfig(root).replace(
      "          item: 先頭が added_at の要素",
      "          item: 別物へ差し替えた",
    ),
  );
  const r = await run(root);
  expect(r.stdout).toMatch(/失われている/);
  expect(r.status).toBe(1);
  rmSync(root, { recursive: true, force: true });
});

test.concurrent("registry の鍵の配下がリストでなければ行のまま守る（解釈できないものを捨てない）", async () => {
  const root = await makeConfigRepo(
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
  const r = await run(root);
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
async function makeConfigRepoWithFlowPending() {
  const root = await makeConfigRepo();
  writeConfig(
    root,
    readConfig(root).replace("      pending: [] # 保留（測定結果で決める）\n", FLOW_PENDING),
  );
  await commit(root, "pending にフロー形式で 1 件");
  return root;
}

test.concurrent("フロー形式のマッピング要素も照合キーで棚卸しできる（追随フィールドを単位にしない）", async () => {
  const root = await makeConfigRepoWithFlowPending();
  writeConfig(
    root,
    readConfig(root)
      .replace(FLOW_PENDING, "      pending: [] # 保留（測定結果で決める）\n")
      .replace("      may_change: [] #", "      may_change: [合計の丸め] #"),
  );
  const r = await run(root);
  expect(r.stdout).toMatch(/^ok: /m);
  expect(r.status).toBe(0);
  rmSync(root, { recursive: true, force: true });
});

test.concurrent("フロー形式のマッピング要素を棚卸しせず消せば落ちる", async () => {
  const root = await makeConfigRepoWithFlowPending();
  writeConfig(
    root,
    readConfig(root).replace(FLOW_PENDING, "      pending: [] # 保留（測定結果で決める）\n"),
  );
  const r = await run(root);
  expect(r.stdout).toMatch(/<registry-item: intentional-diffs> 合計の丸め/);
  expect(r.status).toBe(1);
  rmSync(root, { recursive: true, force: true });
});

test.concurrent("フロー形式で照合キーの値を差し替えれば落ちる", async () => {
  const root = await makeConfigRepoWithFlowPending();
  writeConfig(root, readConfig(root).replace("item: 合計の丸め", "item: 別物へ差し替えた"));
  const r = await run(root);
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
async function makeConfigRepoWithMultilinePending() {
  const root = await makeConfigRepo();
  writeConfig(
    root,
    readConfig(root).replace("      pending: [] # 保留（測定結果で決める）\n", MULTILINE_PENDING),
  );
  await commit(root, "pending に 1 行に収まらない値の要素");
  return root;
}

test.concurrent("プレーン多行スカラーの要素を丸ごと消せば落ちる（畳んで単位ゼロにしない）", async () => {
  const root = await makeConfigRepoWithMultilinePending();
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
  const r = await run(root);
  expect(r.stdout).toMatch(/失われている/);
  expect(r.status).toBe(1);
  rmSync(root, { recursive: true, force: true });
});

test.concurrent("ブロックスカラーの本文を差し替えれば落ちる（本文を単位から落とさない）", async () => {
  const root = await makeConfigRepoWithMultilinePending();
  writeConfig(
    root,
    readConfig(root).replace("確認ダイアログを出さない", "確認ダイアログを必ず出す"),
  );
  const r = await run(root);
  expect(r.stdout).toMatch(/失われている/);
  expect(r.status).toBe(1);
  rmSync(root, { recursive: true, force: true });
});

test.concurrent("閉じない引用符の値の続きの行も単位から落とさない", async () => {
  const root = await makeConfigRepo();
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
  await commit(root, "pending に閉じない引用符");
  // 畳むと単位は `"閉じていない` だけになり、続きの行は kept へ戻らないので差し替えが無音で通る。
  writeConfig(root, readConfig(root).replace("引用符の続きの行", "別物へ差し替えた"));
  const r = await run(root);
  expect(r.stdout).toMatch(/失われている/);
  expect(r.status).toBe(1);
  rmSync(root, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
const QUOTED_COMMA_PENDING =
  '      pending: [{item: "順序は id, 名前の順", slug: cross-cutting}] # 保留（測定結果で決める）\n';

/** 引用符の中にカンマを持つフロー形式のマッピング要素を比較元にする。 */
async function makeConfigRepoWithQuotedFlowPending() {
  const root = await makeConfigRepo();
  writeConfig(
    root,
    readConfig(root).replace(
      "      pending: [] # 保留（測定結果で決める）\n",
      QUOTED_COMMA_PENDING,
    ),
  );
  await commit(root, "pending に引用符つきカンマを含む要素");
  return root;
}

test.concurrent("マッピングの値の引用符も開く（値の中のカンマでペアを割らない）", async () => {
  const root = await makeConfigRepoWithQuotedFlowPending();
  writeConfig(
    root,
    readConfig(root)
      .replace(QUOTED_COMMA_PENDING, "      pending: [] # 保留（測定結果で決める）\n")
      .replace(
        'keep: ["テーブル名を保つ"] #',
        'keep: ["テーブル名を保つ", "順序は id, 名前の順"] #',
      ),
  );
  const r = await run(root);
  expect(r.stdout).toMatch(/^ok: /m);
  expect(r.status).toBe(0);
  rmSync(root, { recursive: true, force: true });
});

test.concurrent("引用符の中にカンマを持つ文言の差し替えは無音で通らない", async () => {
  const root = await makeConfigRepoWithQuotedFlowPending();
  writeConfig(root, readConfig(root).replace("名前の順", "逆順に変更"));
  const r = await run(root);
  expect(r.stdout).toMatch(/<registry-item: intentional-diffs> 順序は id, 名前の順/);
  expect(r.status).toBe(1);
  rmSync(root, { recursive: true, force: true });
});

test.concurrent("入れ子になったキーパスを 2 つのオプションに書けば合格として扱わない（祖先が配下を丸ごと外す）", async () => {
  const root = await makeConfigRepo();
  const manifest = writeManifest(root, [
    {
      id: "project-config",
      pattern: ".config/skills/*/skills.yml",
      unit: "lines",
      mutable_blocks: ["skills.replace-strategy.intentional_diffs"],
      growable_containers: ["skills.replace-strategy.intentional_diffs.keep"],
    },
  ]);
  const r = await run(root, ["--manifest", manifest]);
  expect(r.stderr).toMatch(/入れ子になったキーパスが .+ と .+ の両方にある/);
  expect(r.status).toBe(2);
  rmSync(root, { recursive: true, force: true });
});

test.concurrent("接頭辞が重なるだけの兄弟キーは入れ子と数えない（a.b と a.bc）", async () => {
  const root = await makeConfigRepo();
  const manifest = writeManifest(root, [
    {
      id: "project-config",
      pattern: ".config/skills/*/skills.yml",
      unit: "lines",
      mutable_blocks: ["skills.replace-strategy.bare_list"],
      growable_containers: ["skills.replace-strategy.bare_listing"],
    },
  ]);
  const r = await run(root, ["--manifest", manifest]);
  expect(r.stdout).toMatch(/^ok: /m);
  expect(r.status).toBe(0);
  rmSync(root, { recursive: true, force: true });
});

test.concurrent("同じキーパスを 2 つのオプションに書けば合格として扱わない（exit 2）", async () => {
  const root = await makeConfigRepo();
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
  const r = await run(root, ["--manifest", manifest]);
  expect(r.stderr).toMatch(/同じキーパスが .+ と .+ の両方にある/);
  expect(r.status).toBe(2);
  rmSync(root, { recursive: true, force: true });
});

// --- 1 行で閉じないフロー形式のコンテナ（#430） ---
//
// `flowItems` は `raw.slice(1, -1)` で末尾 1 文字を閉じ括弧と決め打ちしていたため、折り返された
// コンテナを「読めた」ことにしていた（`[` は空、`[ "a",` は要素 1 件）。読めたことにすると
// 折り返しの中身が空に見え、要素を足しただけの編集が誤って縮小と判定される。

test.concurrent("1 行で閉じないフロー形式のコンテナは読めたことにしない（null）", () => {
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

test.concurrent("誤検知しないことの確認: 1 行で閉じるコンテナは今までどおり読める", () => {
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
async function makeWrappedConfigRepo() {
  return await makeConfigRepo(
    CONFIG.replace(
      '      keep: ["テーブル名を保つ"] # 変えない（例: テーブル名、項目名）',
      WRAPPED_KEEP,
    ),
  );
}

test.concurrent("折り返したコンテナへ追記しただけなら通る（#430 の再現手順）", async () => {
  const root = await makeWrappedConfigRepo();
  writeConfig(
    root,
    readConfig(root).replace(
      '        "項目名を保つ"\n',
      '        "項目名を保つ",\n        "並び順を保つ"\n',
    ),
  );
  const r = await run(root);
  expect(r.stdout).toMatch(/^ok: /m);
  expect(r.status).toBe(0);
  rmSync(root, { recursive: true, force: true });
});

test.concurrent("折り返したコンテナを 1 行へ書き直せば、要素を足していても通る", async () => {
  const root = await makeWrappedConfigRepo();
  writeConfig(
    root,
    readConfig(root).replace(
      WRAPPED_KEEP,
      '      keep: ["テーブル名を保つ", "項目名を保つ", "並び順を保つ"] # 変えない（例: テーブル名、項目名）',
    ),
  );
  const r = await run(root);
  expect(r.stdout).toMatch(/^ok: /m);
  expect(r.status).toBe(0);
  rmSync(root, { recursive: true, force: true });
});

test.concurrent("折り返したコンテナから要素を消せば、1 行へ書き直しても落ちる", async () => {
  const root = await makeWrappedConfigRepo();
  writeConfig(
    root,
    readConfig(root).replace(
      WRAPPED_KEEP,
      '      keep: ["テーブル名を保つ"] # 変えない（例: テーブル名、項目名）',
    ),
  );
  const r = await run(root);
  expect(r.stdout).toMatch(/項目名を保つ/);
  expect(r.status).toBe(1);
  rmSync(root, { recursive: true, force: true });
});

test.concurrent("1 行のコンテナを折り返しても通る（折り返し ⇄ 1 行の相互変換）", async () => {
  const root = await makeConfigRepo();
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
  const r = await run(root);
  expect(r.stdout).toMatch(/^ok: /m);
  expect(r.status).toBe(0);
  rmSync(root, { recursive: true, force: true });
});

test.concurrent("連結しても閉じないコンテナは読めたことにせず、表記を直すよう案内する", async () => {
  const root = await makeConfigRepo();
  // 閉じ括弧が無いまま次の鍵へ出る。連結は鍵のブロックを抜けた時点で打ち切り、読めなかったものとして扱う。
  writeConfig(
    root,
    readConfig(root).replace(
      '      keep: ["テーブル名を保つ"] # 変えない（例: テーブル名、項目名）',
      "      keep: [",
    ),
  );
  const r = await run(root);
  expect(r.status).toBe(1);
  expect(r.stdout).toMatch(
    /閉じていないフロー形式のコンテナがある: skills\.replace-strategy\.intentional_diffs\.keep/,
  );
  rmSync(root, { recursive: true, force: true });
});

test.concurrent("区別: 折り返しが無ければ案内を出さない", async () => {
  const root = await makeConfigRepo();
  // 1 行のコンテナから要素を消す（同じ「縮小」でも折り返しは関係しない）。
  writeConfig(root, readConfig(root).replace('"テーブル名を保つ"', ""));
  const r = await run(root);
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

test.concurrent("折り返しの連結: 鍵のブロック内で閉じていれば読む（閉じ括弧のインデントは問わない）", () => {
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

test.concurrent("折り返しの連結: 開き括弧が次の行にあっても読む（フォーマッタが畳む形）", () => {
  // YAML のフォーマッタは 1 行に収まらないコンテナを `key:` と `[` に分けて畳む。ブロック形式として
  // 扱うと中身が行のまま単位になり、要素を足しただけの編集が誤って縮小と判定される（#430 と同じ害）。
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
  // 区別できることの確認: 要素を落とせば単位が減る。
  expect(keepUnits('a:\n  keep:\n    [\n      "x"\n    ] # c\n')).not.toContain("<item: a.keep> y");
  // 次の行が開き括弧でなければ今までどおりブロック形式として扱う（行のまま残す）。
  expect(keepUnits('a:\n  keep:\n    - "x"\n')).toEqual(["a:", "<container: a.keep>", '    - "x"']);
});

test.concurrent("折り返しの連結: 途中の空行・コメント行を挟んでも読む（同じ軸の内側）", () => {
  // ここで打ち切ると、比較元の折り返し行がそのまま単位になり、案内どおり 1 行へ書き直しても落ちる。
  expect(keepUnits('a:\n  keep: [\n\n    "x"\n  ] # c\n')).toEqual([
    "a:",
    "<container: a.keep>",
    "# c",
    "<item: a.keep> x",
  ]);
  // コメント行は単位として残す（警告なしに消せるようにしない）。
  expect(keepUnits('a:\n  keep: [\n    # note\n    "x"\n  ] # c\n')).toEqual([
    "a:",
    "<container: a.keep>",
    "# note",
    "# c",
    "<item: a.keep> x",
  ]);
});

test.concurrent("折り返しの連結: 読めない形は行のまま突き合わせる（読めない形を連結の対象にしない）", () => {
  // 閉じないまま文書が終わる。
  expect(keepUnits('a:\n  keep: [\n    "x"\n')).toEqual(["a:", "  keep: [", '    "x"']);
  // 閉じないまま鍵のブロックを抜ける（続きの行を飲み込まない）。
  expect(keepUnits("a:\n  keep: [\n  other: 1\n")).toEqual(["a:", "  keep: [", "  other: 1"]);
});

test.concurrent("空行を挟んだ折り返しでも、追記と 1 行への書き直しが通る", async () => {
  const wrapped = [
    "      keep: [",
    "",
    '        "テーブル名を保つ"',
    "      ] # 変えない（例: テーブル名、項目名）",
  ].join("\n");
  const root = await makeConfigRepo(
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
  const added = await run(root);
  expect(added.stdout).toMatch(/^ok: /m);
  expect(added.status).toBe(0);
  // 1 行へ書き直す（keep は要素行の注記を単位にしないので、畳んでも単位は減らない）。
  writeConfig(
    root,
    readConfig(root).replace(
      wrapped,
      '      keep: ["テーブル名を保つ"] # 変えない（例: テーブル名、項目名）',
    ),
  );
  const rewritten = await run(root);
  expect(rewritten.stdout).toMatch(/^ok: /m);
  expect(rewritten.status).toBe(0);
  rmSync(root, { recursive: true, force: true });
});

// 案内はファイル単位で出さない。読めないコンテナと無関係な鍵の削除に「復元せず閉じ括弧を補う」が付くと、
// 記録した決定を消させないというツールの目的と逆向きの指示になる。
/** 閉じないコンテナ（比較元・現在で不変）と、別の鍵の育つコンテナを持つ設定。 */
const UNREADABLE_CONFIG = CONFIG.replace(
  "    component_diffs: []",
  "    component_diffs: [{component: grid, property: color}]",
).replace('      keep: ["テーブル名を保つ"] # 変えない（例: テーブル名、項目名）', "      keep: [");

test.concurrent("読めないコンテナがあっても、無関係な鍵の削除には案内を出さない", async () => {
  const root = await makeConfigRepo(UNREADABLE_CONFIG);
  writeConfig(
    root,
    readConfig(root).replace(
      "    component_diffs: [{component: grid, property: color}]",
      "    component_diffs: []",
    ),
  );
  const r = await run(root);
  expect(r.status).toBe(1);
  expect(r.stdout).toMatch(/component_diffs/);
  expect(r.stdout).not.toMatch(/閉じていないフロー形式のコンテナがある/);
  rmSync(root, { recursive: true, force: true });
});

test.concurrent("検出されることの確認: 読めないコンテナ由来の消失には案内を出す", async () => {
  const root = await makeConfigRepo(UNREADABLE_CONFIG);
  writeConfig(root, readConfig(root).replace("      keep: [\n", ""));
  const r = await run(root);
  expect(r.status).toBe(1);
  expect(r.stdout).toMatch(
    /閉じていないフロー形式のコンテナがある: skills\.replace-strategy\.intentional_diffs\.keep/,
  );
  rmSync(root, { recursive: true, force: true });
});

test.concurrent("連結を打ち切らせた行（コンテナの外）の削除には案内を出さない", async () => {
  // 打ち切らせた行を帰属材料に入れると、コンテナの外にある行を消しただけで案内が付く。
  const root = await makeConfigRepo(
    UNREADABLE_CONFIG.replace("      keep: [\n", "      keep: [\n      note_line: 無関係なメモ\n"),
  );
  writeConfig(root, readConfig(root).replace("      note_line: 無関係なメモ\n", ""));
  const r = await run(root);
  expect(r.status).toBe(1);
  expect(r.stdout).toMatch(/note_line/);
  expect(r.stdout).not.toMatch(/閉じていないフロー形式のコンテナがある/);
  rmSync(root, { recursive: true, force: true });
});

test.concurrent("registry のグループ共通の単位が消えても、別の鍵の読めないコンテナに帰属させない", async () => {
  // <registry-item: <グループ id>> は鍵をまたぐ移動を許すためグループ共通で、鍵を区別できない。
  const root = await makeConfigRepo(
    UNREADABLE_CONFIG.replace("      pending: [] # 保留（測定結果で決める）\n", PENDING_BLOCK),
  );
  writeConfig(
    root,
    readConfig(root).replace(PENDING_BLOCK, "      pending: [] # 保留（測定結果で決める）\n"),
  );
  const r = await run(root);
  expect(r.status).toBe(1);
  expect(r.stdout).toMatch(/一覧の並び順が変わる/);
  expect(r.stdout).not.toMatch(/閉じていないフロー形式のコンテナがある/);
  rmSync(root, { recursive: true, force: true });
});

test.concurrent("鍵と開き括弧の間に空行・コメント行があっても読む（joinWrappedFlow と対称）", async () => {
  const wrapped = [
    "      keep:",
    "        # 注記",
    "        [",
    '          "テーブル名を保つ"',
    "        ] # 変えない（例: テーブル名、項目名）",
  ].join("\n");
  const root = await makeConfigRepo(
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
  const r = await run(root);
  expect(r.stdout).toMatch(/^ok: /m);
  expect(r.status).toBe(0);
  rmSync(root, { recursive: true, force: true });
});

test.concurrent("読めないコンテナの後ろにあるコメント行の削除には案内を出さない", async () => {
  // 連結が失敗したときは閉じ括弧が無く、その注記が内にあったか外にあったかを区別できない。
  const root = await makeConfigRepo(
    UNREADABLE_CONFIG.replace("      keep: [\n", "      keep: [\n      # 無関係な注記\n"),
  );
  writeConfig(root, readConfig(root).replace("      # 無関係な注記\n", ""));
  const r = await run(root);
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

test.concurrent("折り返した registry の要素行の注記は単位にしない（棚卸しが表記で割れない）", async () => {
  const root = await makeConfigRepo(
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
  const r = await run(root);
  expect(r.stdout).toMatch(/^ok: /m);
  expect(r.status).toBe(0);
  rmSync(root, { recursive: true, force: true });
});

test.concurrent("折り返した registry でも、閉じる行の注記（鍵の注記）を消せば落ちる", async () => {
  const root = await makeConfigRepo(
    CONFIG.replace("      pending: [] # 保留（測定結果で決める）", WRAPPED_PENDING),
  );
  writeConfig(root, readConfig(root).replace("      ] # 保留（測定結果で決める）", "      ]"));
  const r = await run(root);
  expect(r.status).toBe(1);
  expect(r.stdout).toMatch(/保留（測定結果で決める）/);
  rmSync(root, { recursive: true, force: true });
});

test.concurrent("区別: 育つコンテナは折り返した要素行の注記も単位に残す（行末コメントの削除を落とす要求）", async () => {
  const wrapped = [
    "    component_diffs: [",
    "      {component: grid, property: color}, # 注記",
    "    ]",
  ].join("\n");
  const root = await makeConfigRepo(CONFIG.replace("    component_diffs: []", wrapped));
  writeConfig(root, readConfig(root).replace(", property: color}, # 注記", ", property: color},"));
  const r = await run(root);
  expect(r.status).toBe(1);
  expect(r.stdout).toMatch(/注記/);
  rmSync(root, { recursive: true, force: true });
});

test.concurrent("折り返したコンテナの中の独立したコメント行は、registry でも単位に残す", async () => {
  // 要素に付いた注記と違って移動先の問題が無い。落とすと中の注記だけ警告なしに消せる（main では落ちていた）。
  const wrapped = [
    "      pending: [",
    "        # 大事な注記",
    "        {item: 一覧の並び順が変わる, slug: cross-cutting},",
    "      ] # 保留（測定結果で決める）",
  ].join("\n");
  const root = await makeConfigRepo(
    CONFIG.replace("      pending: [] # 保留（測定結果で決める）", wrapped),
  );
  writeConfig(root, readConfig(root).replace("        # 大事な注記\n", ""));
  const r = await run(root);
  expect(r.stdout).toMatch(/大事な注記/);
  expect(r.status).toBe(1);
  rmSync(root, { recursive: true, force: true });
});

test.concurrent("要素が鍵と同じインデントに並ぶ折り返しも読む（js-yaml で妥当な YAML）", async () => {
  const wrapped = [
    "      keep: [",
    '      "テーブル名を保つ"',
    "      ] # 変えない（例: テーブル名、項目名）",
  ].join("\n");
  const root = await makeConfigRepo(
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
  const r = await run(root);
  expect(r.stdout).toMatch(/^ok: /m);
  expect(r.status).toBe(0);
  rmSync(root, { recursive: true, force: true });
});

test.concurrent("比較元に読めないコンテナがあるときは「直せば通る」と案内しない", async () => {
  // 比較元の行がそのまま単位なので、どの編集でも exit 0 に到達しない。実行できない指示を出さない。
  const root = await makeConfigRepo(UNREADABLE_CONFIG);
  writeConfig(
    root,
    readConfig(root).replace("      keep: [\n", '      keep: ["テーブル名を保つ"] # 変えない\n'),
  );
  const r = await run(root);
  expect(r.status).toBe(1);
  expect(r.stdout).toMatch(/比較元 .+ に閉じていないフロー形式のコンテナがある/);
  expect(r.stdout).toMatch(/判定できない/);
  expect(r.stdout).not.toMatch(/閉じ括弧を補う/);
  rmSync(root, { recursive: true, force: true });
});

test.concurrent("現在側だけが読めないときは閉じ括弧を補うよう案内する", async () => {
  const root = await makeConfigRepo();
  writeConfig(
    root,
    readConfig(root).replace(
      '      keep: ["テーブル名を保つ"] # 変えない（例: テーブル名、項目名）',
      "      keep: [",
    ),
  );
  const r = await run(root);
  expect(r.status).toBe(1);
  expect(r.stdout).toMatch(/復元せず閉じ括弧を補う/);
  // 1 行へ畳むは示さない（growable_containers では要素行の注記の単位が消えて落ちる）。
  expect(r.stdout).not.toMatch(/同じ行で閉じる/);
  expect(r.stdout).not.toMatch(/判定できない/);
  rmSync(root, { recursive: true, force: true });
});

// 案内が示す直し方で exit 0 に届くことを、成果物の種別ごとに測る（#432）。
// 「1 行へ畳む」は growable_containers では届かない（要素行の注記も単位なので、畳むとその単位が消える）。
// 案内はどの種別でも届く「閉じ括弧を補う」だけを示す。mutable_blocks は案内を出さない側として扱ってあり、
// 例に出た注記を戻せば届く（原本は assets/append-only-manifest.json の _note）。
const HINT_BASE = [
  "a:",
  "  keep: [",
  '    "x", # なぜ x か',
  '    "y"',
  "  ] # 鍵",
  "  next: 1",
  "",
].join("\n");
/** 要素を足したが閉じ括弧を書き忘れた。 */
const HINT_UNCLOSED = HINT_BASE.replace('    "y"\n  ] # 鍵\n', '    "y",\n    "z"\n');
/** 案内どおり閉じ括弧を補った。 */
const HINT_CLOSED = HINT_BASE.replace('    "y"\n', '    "y",\n    "z"\n');
/** 1 行へ畳んだ（要素行の注記の置き場所が無い）。 */
const HINT_FOLDED = 'a:\n  keep: ["x", "y", "z"] # 鍵\n  next: 1\n';

/**
 * @param {Record<string, unknown>} option
 * @param {string} before
 */
async function makeHintRepo(option, before) {
  const root = await makeConfigRepo(before);
  const manifest = writeManifest(root, [
    { id: "c", pattern: ".config/skills/*/skills.yml", unit: "lines", ...option },
  ]);
  return { root, manifest };
}

for (const [kind, option] of [
  ["growable_containers", { growable_containers: ["a.keep"] }],
  ["registry_groups", { registry_groups: [{ id: "g", item_key: "item", paths: ["a.keep"] }] }],
]) {
  test.concurrent(`${kind}: 閉じ忘れには閉じ括弧を補う案内が出て、そのとおり直せば exit 0`, async () => {
    const { root, manifest } = await makeHintRepo(option, HINT_BASE);
    writeConfig(root, HINT_UNCLOSED);
    const r = await run(root, ["--manifest", manifest]);
    expect(r.status).toBe(1);
    expect(r.stdout).toMatch(
      /閉じていないフロー形式のコンテナがある: a\.keep — 復元せず閉じ括弧を補う/,
    );
    writeConfig(root, HINT_CLOSED);
    const fixed = await run(root, ["--manifest", manifest]);
    expect(fixed.stdout).toMatch(/^ok: /m);
    expect(fixed.status).toBe(0);
    rmSync(root, { recursive: true, force: true });
  });
}

test.concurrent("growable_containers: 1 行へ畳むと要素行の注記が失われて落ちる（だから案内に出さない）", async () => {
  const { root, manifest } = await makeHintRepo({ growable_containers: ["a.keep"] }, HINT_BASE);
  writeConfig(root, HINT_FOLDED);
  const r = await run(root, ["--manifest", manifest]);
  expect(r.status).toBe(1);
  expect(r.stdout).toMatch(/1 件.*# なぜ x か/);
  rmSync(root, { recursive: true, force: true });
});

test.concurrent("mutable_blocks: 閉じ忘れで鍵の注記が失われても案内は出さず、注記を戻せば exit 0", async () => {
  const { root, manifest } = await makeHintRepo({ mutable_blocks: ["a.keep"] }, HINT_BASE);
  writeConfig(root, HINT_UNCLOSED);
  const r = await run(root, ["--manifest", manifest]);
  expect(r.status).toBe(1);
  expect(r.stdout).toMatch(/1 件.*# 鍵/);
  expect(r.stdout).not.toMatch(/閉じていないフロー形式のコンテナがある/);
  // 配下は単位から外れるので、閉じなくても注記を独立した行で戻せば届く。
  writeConfig(root, HINT_UNCLOSED.replace("  next: 1\n", "  # 鍵\n  next: 1\n"));
  const fixed = await run(root, ["--manifest", manifest]);
  expect(fixed.stdout).toMatch(/^ok: /m);
  expect(fixed.status).toBe(0);
  rmSync(root, { recursive: true, force: true });
});

test.concurrent("mutable_blocks: 比較元が閉じていなくても判定は成り立ち、案内を出さない（注記を戻せば exit 0）", async () => {
  // growable_containers では同じ編集に「判定できない」が出る（読めない鍵の行がそのまま単位になる）。
  // mutable_blocks は鍵の行を鍵だけの単位へ畳み注記を独立させるので、比較元が読めなくても直せる。
  const before = 'a:\n  keep: [ # 鍵\n    "x"\n  next: 1\n';
  const { root, manifest } = await makeHintRepo({ mutable_blocks: ["a.keep"] }, before);
  writeConfig(root, 'a:\n  keep: [\n    "x"\n  next: 1\n');
  const r = await run(root, ["--manifest", manifest]);
  expect(r.status).toBe(1);
  expect(r.stdout).toMatch(/1 件.*# 鍵/);
  expect(r.stdout).not.toMatch(/閉じていないフロー形式のコンテナがある/);
  writeConfig(root, 'a:\n  keep: [ # 鍵\n    "x",\n    "y"\n  ]\n  next: 1\n');
  const fixed = await run(root, ["--manifest", manifest]);
  expect(fixed.stdout).toMatch(/^ok: /m);
  expect(fixed.status).toBe(0);
  rmSync(root, { recursive: true, force: true });
});

test.concurrent("mutable_blocks: 鍵と同じインデントの要素行が失われたときだけ案内が出る", async () => {
  // 除外は鍵と同じインデントの行で閉じるので、その要素行は行のまま単位になり、読みに行った行として帰属できる。
  const before = 'a:\n  keep: [ # 鍵\n  "x",\n  "y"\n  next: 1\n';
  const { root, manifest } = await makeHintRepo({ mutable_blocks: ["a.keep"] }, before);
  writeConfig(root, 'a:\n  keep: [ # 鍵\n  "x",\n  "y",\n  "z"\n  next: 1\n');
  const r = await run(root, ["--manifest", manifest]);
  expect(r.status).toBe(1);
  expect(r.stdout).toMatch(/比較元 .+ に閉じていないフロー形式のコンテナがある: a\.keep/);
  rmSync(root, { recursive: true, force: true });
});

test.concurrent("比較元側と現在側の両方に読めないコンテナがあると、現在側のキーパスも名指しする", async () => {
  // 比較元側の案内で現在側を抑止すると、閉じ直せば通る a.comp が一度も案内されない。
  const option = { growable_containers: ["a.keep", "a.comp"] };
  const before = 'a:\n  keep: [\n    "x"\n  comp: ["p"] # c\n  next: 1\n';
  const { root, manifest } = await makeHintRepo(option, before);
  writeConfig(root, 'a:\n  keep: [\n    "x",\n    "y"\n  comp: [\n    "p", "q"\n  next: 1\n');
  const r = await run(root, ["--manifest", manifest]);
  expect(r.status).toBe(1);
  expect(r.stdout).toMatch(
    /閉じていないフロー形式のコンテナがある: a\.comp — 復元せず閉じ括弧を補う/,
  );
  expect(r.stdout).toMatch(/比較元 .+ に閉じていないフロー形式のコンテナがある: a\.keep/);
  // 案内どおり a.comp を閉じると、残るのは比較元側（人の確認で通す）だけになる。
  writeConfig(
    root,
    'a:\n  keep: [\n    "x",\n    "y"\n  comp: [\n    "p", "q"\n  ] # c\n  next: 1\n',
  );
  const partly = await run(root, ["--manifest", manifest]);
  expect(partly.status).toBe(1);
  expect(partly.stdout).not.toMatch(/a\.comp/);
  expect(partly.stdout).toMatch(/比較元 .+ に閉じていないフロー形式のコンテナがある: a\.keep/);
  rmSync(root, { recursive: true, force: true });
});

test.concurrent("同じ鍵が比較元側と現在側の両方に帰属したら、比較元側の案内だけを出す", async () => {
  // 閉じ直しても比較元の行は戻らないので、「閉じ括弧を補う」は実行できない指示になる。
  const before = 'a:\n  keep: [\n    "x",\n    "x",\n  next: 1\n';
  const { root, manifest } = await makeHintRepo({ growable_containers: ["a.keep"] }, before);
  writeConfig(root, 'a:\n  keep: [\n    "x",\n  next: 1\n');
  const r = await run(root, ["--manifest", manifest]);
  expect(r.status).toBe(1);
  expect(r.stdout).toMatch(/比較元 .+ に閉じていないフロー形式のコンテナがある: a\.keep/);
  expect(r.stdout).not.toMatch(/閉じ括弧を補う/);
  rmSync(root, { recursive: true, force: true });
});

/** 読めないコンテナとして記録されたキーパス（案内の材料）。 */
function wrappedPathsOf(src) {
  /** @type {{ path: string }[]} */
  const out = [];
  stripYamlBlocks(src, [], ["a.keep"], [], out);
  return out.map((w) => w.path);
}

test.concurrent("閉じた後に余りがある形は「閉じていない」と案内しない", () => {
  // `[a] b` は**閉じてはいる**。1 行へ畳んでも同じく読めないので、その案内は指示にならない。
  expect(wrappedPathsOf('a:\n  keep: [\n    "x"\n  ],\n')).toEqual([]);
  // 検出できることの確認: 閉じないまま兄弟のキーへ出る形は記録する。
  expect(wrappedPathsOf("a:\n  keep: [\n  other: 1\n")).toEqual(["a.keep"]);
});

test.concurrent("mutable_blocks の折り返しも配下ごと消費する（1 行への畳み込みで単位が消えない）", async () => {
  const wrapped = ["      keep: [", '        "テーブル名を保つ"', "      ] # 変えない"].join("\n");
  const root = await makeConfigRepo(
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
  const r = await run(root, ["--manifest", manifest]);
  expect(r.stdout).toMatch(/^ok: /m);
  expect(r.status).toBe(0);
  rmSync(root, { recursive: true, force: true });
});

test.concurrent("mutable_blocks の折り返しでも、キーごと消せば落ちる（外しすぎていない）", async () => {
  const wrapped = ["      keep: [", '        "テーブル名を保つ"', "      ] # 変えない"].join("\n");
  const root = await makeConfigRepo(
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
  const r = await run(root, ["--manifest", manifest]);
  expect(r.stdout).toMatch(/mutable-block/);
  expect(r.status).toBe(1);
  rmSync(root, { recursive: true, force: true });
});

test.concurrent("mutable_blocks でも、開き括弧が次の行にある形を消費する（値の形で門番しない）", async () => {
  const wrapped = [
    "      keep:",
    "      [",
    '        "テーブル名を保つ"',
    "      ] # 変えない",
  ].join("\n");
  const root = await makeConfigRepo(
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
  const r = await run(root, ["--manifest", manifest]);
  expect(r.stdout).toMatch(/^ok: /m);
  expect(r.status).toBe(0);
  rmSync(root, { recursive: true, force: true });
});

test.concurrent("mutable_blocks のブロック形式は今までどおり配下を外す（消費として扱われていない）", async () => {
  const root = await makeConfigRepo(
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
  const r = await run(root, ["--manifest", manifest]);
  expect(r.stdout).toMatch(/^ok: /m);
  expect(r.status).toBe(0);
  rmSync(root, { recursive: true, force: true });
});

test.concurrent("入れ子の要素自身を折り返しても単位は変わらない（整形だけでは落ちない）", async () => {
  // 要素の折り返しで末尾カンマ・余分な空白が入っても、正規形へ組み直すので 1 行の形と同じ単位になる。
  const root = await makeConfigRepo(
    CONFIG.replace(
      "    component_diffs: []",
      '    component_diffs: [{component: "grid", property: "color"}]',
    ),
  );
  writeConfig(
    root,
    readConfig(root).replace(
      '    component_diffs: [{component: "grid", property: "color"}]',
      [
        "    component_diffs: [",
        "      {",
        '        component: "grid",',
        '        property: "color",',
        "      },",
        "    ]",
      ].join("\n"),
    ),
  );
  const r = await run(root);
  expect(r.stdout).toMatch(/^ok: /m);
  expect(r.status).toBe(0);
  rmSync(root, { recursive: true, force: true });
});

test.concurrent("区別: 入れ子の要素の中身を差し替えれば落ちる", async () => {
  const root = await makeConfigRepo(
    CONFIG.replace(
      "    component_diffs: []",
      '    component_diffs: [{component: "grid", property: "color"}]',
    ),
  );
  writeConfig(root, readConfig(root).replace('property: "color"', 'property: "font"'));
  const r = await run(root);
  expect(r.stdout).toMatch(/grid/);
  expect(r.status).toBe(1);
  rmSync(root, { recursive: true, force: true });
});

test.concurrent("mutable_blocks で鍵を丸ごと消しても「人が確認して通す」とは案内しない", async () => {
  // mutable_blocks は配下を外すので、鍵の単位が失われるのは鍵ごと消したときだけ。破壊に案内を付けない。
  const root = await makeConfigRepo(UNREADABLE_CONFIG);
  const manifest = writeManifest(root, [
    {
      id: "project-config",
      pattern: ".config/skills/*/skills.yml",
      unit: "lines",
      mutable_blocks: ["skills.replace-strategy.intentional_diffs.keep"],
    },
  ]);
  writeConfig(root, readConfig(root).replace("      keep: [\n", ""));
  const r = await run(root, ["--manifest", manifest]);
  expect(r.status).toBe(1);
  expect(r.stdout).toMatch(/mutable-block/);
  expect(r.stdout).not.toMatch(/内容を人が確認して通す/);
  rmSync(root, { recursive: true, force: true });
});

// ---- --exclude（利用者の pre-commit・CI へ組み込むとき、設定ファイルを外す。#540）----

/** 設定ファイルの既存の値を書き換えた作業ツリー（他スキルの設定を直す正当な編集に当たる）。 */
async function makeConfigRepoWithEditedValue() {
  const root = await makeConfigRepo();
  writeConfig(root, readConfig(root).replace("stack: [typescript]", "stack: [javascript]"));
  return root;
}

test.concurrent("対照: --exclude なしでは設定ファイルの既存の値の書き換えを縮小として落とす", async () => {
  const root = await makeConfigRepoWithEditedValue();
  const r = await run(root);
  expect(r.stdout).toMatch(/skills\.yml/);
  expect(r.status).toBe(1);
  rmSync(root, { recursive: true, force: true });
});

test.concurrent("--exclude project-config なら設定ファイルの書き換えを通し、外した id を出力に出す", async () => {
  const root = await makeConfigRepoWithEditedValue();
  const r = await run(root, ["--exclude", "project-config"]);
  expect(r.stdout).toMatch(/^note: 一覧から外した項目（突き合わせない）: project-config$/m);
  expect(r.stdout).toMatch(/^ok: /m);
  expect(r.status).toBe(0);
  rmSync(root, { recursive: true, force: true });
});

test.concurrent("--exclude project-config でも残りの項目（features.md の行の削除）は落とす", async () => {
  const root = await makeConfigRepoWithEditedValue();
  writeFileSync(
    join(root, ".replace/features.md"),
    FEATURES.replace("| order-edit | 注文編集 | 未 | 未起票 |\n", ""),
  );
  const r = await run(root, ["--exclude", "project-config"]);
  expect(r.stdout).toMatch(/order-edit/);
  expect(r.stdout).not.toMatch(/skills\.yml/);
  expect(r.status).toBe(1);
  rmSync(root, { recursive: true, force: true });
});

test.concurrent("--exclude に一覧に無い id を渡したら合格として扱わない（exit 2。綴りを誤ったまま、警告なしに何も外さずに進まない）", async () => {
  const root = await makeConfigRepoWithEditedValue();
  const r = await run(root, ["--exclude", "project-cofig"]);
  expect(r.stderr).toMatch(/--exclude の id が一覧に無い: project-cofig/);
  expect(r.status).toBe(2);
  rmSync(root, { recursive: true, force: true });
});

test.concurrent("--exclude で一覧の項目がすべて外れたら合格として扱わない（exit 2）", async () => {
  const root = await makeRepo();
  const manifest = writeManifest(root, [
    { id: "features", pattern: ".replace/features.md", unit: "markdown-structure" },
  ]);
  const r = await run(root, ["--manifest", manifest, "--exclude", "features"]);
  expect(r.stderr).toMatch(/すべて外れた/);
  expect(r.status).toBe(2);
  rmSync(root, { recursive: true, force: true });
});

test.concurrent.each([
  ["値が無い", ["--exclude"], /--exclude に値が無い/],
  ["値が空", ["--exclude", " "], /--exclude に値が無い/],
  ["重複", ["--exclude", "gaps", "--exclude", "gaps"], /--exclude の id が重複している: gaps/],
])("--exclude の使い方の誤り（%s）は exit 2", async (_name, extra, message) => {
  const root = await makeRepo();
  const r = await run(root, extra);
  expect(r.stderr).toMatch(message);
  expect(r.status).toBe(2);
  rmSync(root, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// 表の列の「空 → 非空だけ」（fill_only_columns。Issue #527）
//
// 空欄で追記し後で人が決定を埋める列は、mutable_columns に置くと決めた値の書き換えまで通り、
// どちらにも置かないと、空欄を埋めるだけの正規の編集が誤って縮小と判定される。
// 通す側（埋める）と落とす側（差し替え・消去）を両方測る。
// 台帳は同梱の一覧（デフォルトの --manifest）で測る。一覧の列名がテンプレートの列名と食い違うと、緩和が一度も適用されない。
// ---------------------------------------------------------------------------

const WEAKNESS_HEADER =
  "| 弱点 | 分類 | 攻撃の流れ | 基準（1 / 2 / 3） | 仕分け | 宣言 | 扱う設計作業 | 露出を広げた差異 | 状態 | 決定日・決めた工程 | 根拠 |";
const WEAKNESS_DECIDED =
  "| CSRF | A01 | `POST /api/orders` | 満 / 満 / 否 | 引き継ぐ | 書き込みの API は text/plain を受け付ける | #123 | - | 有効 | 2026-09-01・setup | 現行ソースのハンドラ |";
const WEAKNESS_BLANK =
  "| IDOR | A01 | `GET /api/orders/:id` | 満 / 満 / 満 |  |  |  | - | 有効 |  | 現行ソースのハンドラ |";
const WEAKNESS_UNCONFIRMED =
  "| XSS | A03 | `GET /settings` | 満 / 未確認 / 満 |  |  |  | - | 有効 |  | 保存した値を描画へ使う |";
const WEAKNESS_NONE =
  "| 該当なし（A04） | A04 | - | - | 該当なし | - | - | - | 有効 | 2026-09-01・setup | 探した場所 |";

/** 弱点台帳と方針空欄の行を持つ資産台帳を比較元に持つプロジェクトを作る。 */
async function makeFillOnlyRepo() {
  const root = await makeRepo();
  writeFileSync(
    join(root, ".replace/weaknesses.md"),
    [
      "# 現行の弱点の仕分け（weaknesses）",
      "",
      "- 最終更新: 2026-09-01T00:00:00Z",
      "",
      "## 仕分け",
      "",
      WEAKNESS_HEADER,
      "|---|---|---|---|---|---|---|---|---|---|---|",
      WEAKNESS_DECIDED,
      WEAKNESS_BLANK,
      WEAKNESS_UNCONFIRMED,
      WEAKNESS_NONE,
      "",
    ].join("\n"),
  );
  writeFileSync(
    join(root, ".replace/assets.md"),
    [
      "# 移行元の静的資産の台帳（assets）",
      "",
      "- 最終更新: 2026-09-01T00:00:00Z",
      "",
      "## 方針",
      "",
      "| 種類 | ファイル・出どころ | 描き方と使われるページ | 方針 | 再配布の可否（根拠） | 同等物で残る差 | 宣言 | 状態 | 決定日・決めた工程 | 理由 |",
      "|---|---|---|---|---|---|---|---|---|---|",
      "| ロゴ | `logo.png` | `img`、ヘッダー | 実体をコピーする | 可（ライセンス・2026-09-01） | - | - | 有効 | 2026-09-01・setup | 字形を一致させるため |",
      "| 状態アイコン | `close.png` | `::before` のグリフ、/orders |  | 未確認 |  |  | 有効 |  | 再配布の可否を確認中 |",
      "",
    ].join("\n"),
  );
  await commit(root, "fill-only 台帳");
  return root;
}

/**
 * @param {string} root
 * @param {string} file
 * @param {string} from
 * @param {string} to
 */
function replaceIn(root, file, from, to) {
  const path = join(root, file);
  const text = readFileSync(path, "utf8");
  if (!text.includes(from)) throw new Error(`置換元が無い: ${from}`);
  writeFileSync(path, text.replace(from, to));
}

test.concurrent("weaknesses.md の仕分け空欄の行の決定の列（空セル）をその場で埋めると通る（fill_only_columns）", async () => {
  const root = await makeFillOnlyRepo();
  replaceIn(
    root,
    ".replace/weaknesses.md",
    WEAKNESS_BLANK,
    "| IDOR | A01 | `GET /api/orders/:id` | 満 / 満 / 満 | 直す | 注文の詳細 API は所有者以外に 404 を返す | #200 | - | 有効 | 2026-09-20・order-detail | 現行ソースのハンドラ |",
  );
  const r = await run(root);
  expect(r.stdout).toMatch(/^ok: /m);
  expect(r.status).toBe(0);
  rmSync(root, { recursive: true, force: true });
});

test.concurrent("weaknesses.md の決めた仕分けを書き換えると落ちる（引き継ぐ → 直す）", async () => {
  const root = await makeFillOnlyRepo();
  replaceIn(root, ".replace/weaknesses.md", "/ 否 | 引き継ぐ |", "/ 否 | 直す |");
  const r = await run(root);
  expect(r.stdout).toMatch(/CSRF@0\|仕分け=引き継ぐ/);
  expect(r.status).toBe(1);
  rmSync(root, { recursive: true, force: true });
});

test.concurrent("weaknesses.md の入っている値を未記入（-）へ戻すと落ちる", async () => {
  const root = await makeFillOnlyRepo();
  replaceIn(root, ".replace/weaknesses.md", "| #123 |", "| - |");
  const r = await run(root);
  expect(r.stdout).toMatch(/CSRF@0\|扱う設計作業=#123/);
  expect(r.status).toBe(1);
  rmSync(root, { recursive: true, force: true });
});

test.concurrent("weaknesses.md の基準の 未確認 は未記入とみなさない（書き換えると落ちる）", async () => {
  const root = await makeFillOnlyRepo();
  replaceIn(root, ".replace/weaknesses.md", "| 満 / 未確認 / 満 |", "| 満 / 満 / 満 |");
  const r = await run(root);
  expect(r.stdout).toMatch(/XSS@0\|基準（1 \/ 2 \/ 3）=満 \/ 未確認 \/ 満/);
  expect(r.status).toBe(1);
  rmSync(root, { recursive: true, force: true });
});

test.concurrent("weaknesses.md の決めた「該当なし」（-）を値へ書き換えると落ちる（- は未記入ではない）", async () => {
  const root = await makeFillOnlyRepo();
  replaceIn(
    root,
    ".replace/weaknesses.md",
    WEAKNESS_NONE,
    "| 該当なし（A04） | A04 | - | - | 該当なし | パスワードは平文で保存する | - | - | 有効 | 2026-09-01・setup | 探した場所 |",
  );
  const r = await run(root);
  expect(r.stdout).toMatch(/該当なし（A04）@0\|宣言=-/);
  expect(r.status).toBe(1);
  rmSync(root, { recursive: true, force: true });
});

test.concurrent("assets.md の決めた行の同等物で残る差（-）を値へ書き換えると落ちる（- は未記入ではない）", async () => {
  const root = await makeFillOnlyRepo();
  replaceIn(
    root,
    ".replace/assets.md",
    "| 可（ライセンス・2026-09-01） | - |",
    "| 可（ライセンス・2026-09-01） | 字形が違う |",
  );
  const r = await run(root);
  expect(r.stdout).toMatch(/ロゴ@0\|同等物で残る差=-/);
  expect(r.status).toBe(1);
  rmSync(root, { recursive: true, force: true });
});

test.concurrent("assets.md の方針空欄の行を後から埋めると通る（fill_only_columns）", async () => {
  const root = await makeFillOnlyRepo();
  replaceIn(
    root,
    ".replace/assets.md",
    "| 状態アイコン | `close.png` | `::before` のグリフ、/orders |  | 未確認 |  |  | 有効 |  | 再配布の可否を確認中 |",
    "| 状態アイコン | `close.png` | `::before` のグリフ、/orders | コピーしない | 未確認 | - | - | 有効 | 2026-09-20・order-list | 描いているのは書体のグリフ |",
  );
  const r = await run(root);
  expect(r.stdout).toMatch(/^ok: /m);
  expect(r.status).toBe(0);
  rmSync(root, { recursive: true, force: true });
});

test.concurrent("assets.md の入っている方針を差し替えると落ちる", async () => {
  const root = await makeFillOnlyRepo();
  replaceIn(root, ".replace/assets.md", "| 実体をコピーする | 可", "| 同等物を作る | 可");
  const r = await run(root);
  expect(r.stdout).toMatch(/ロゴ@0\|方針=実体をコピーする/);
  expect(r.status).toBe(1);
  rmSync(root, { recursive: true, force: true });
});

test.concurrent.each([
  [
    "同じ列が両方にある",
    { mutable_columns: ["状態"], fill_only_columns: ["状態"] },
    /同じ列が mutable_columns と fill_only_columns の両方にある: 状態/,
  ],
  [
    "mutable_columns が * で fill_only_columns がある",
    { mutable_columns: ["*"], fill_only_columns: ["Issue"] },
    /同じ列が mutable_columns と fill_only_columns の両方にある: Issue/,
  ],
  ["fill_only_columns に *", { fill_only_columns: ["*"] }, /fill_only_columns に "\*" がある/],
  [
    "fill_only_columns が配列でない",
    { fill_only_columns: "Issue" },
    /fill_only_columns が配列でない/,
  ],
  [
    "fill_only_columns に空の要素",
    { fill_only_columns: [" "] },
    /fill_only_columns に空の要素がある/,
  ],
])("fill_only_columns の宣言の誤り（%s）は exit 2", async (_name, extra, message) => {
  const root = await makeRepo();
  const manifest = writeManifest(root, [
    { id: "features", pattern: ".replace/features.md", unit: "markdown-structure", ...extra },
  ]);
  const r = await run(root, ["--manifest", manifest]);
  expect(r.stderr).toMatch(message);
  expect(r.status).toBe(2);
  rmSync(root, { recursive: true, force: true });
});

test.concurrent("unit が lines なのに fill_only_columns があれば合格として扱わない（exit 2）", async () => {
  const root = await makeRepo();
  const manifest = writeManifest(root, [
    {
      id: "features",
      pattern: ".replace/features.md",
      unit: "lines",
      fill_only_columns: ["Issue"],
    },
  ]);
  const r = await run(root, ["--manifest", manifest]);
  expect(r.stderr).toMatch(/unit が lines なのに fill_only_columns がある/);
  expect(r.status).toBe(2);
  rmSync(root, { recursive: true, force: true });
});

test.concurrent("unit が json-arrays なのに fill_only_columns があれば合格として扱わない（exit 2）", async () => {
  const root = await makeRepo();
  const manifest = writeManifest(root, [
    {
      id: "dataset",
      pattern: ".replace/dataset/metadata.json",
      unit: "json-arrays",
      arrays: ["changes"],
      fill_only_columns: ["Issue"],
    },
  ]);
  const r = await run(root, ["--manifest", manifest]);
  expect(r.stderr).toMatch(/json-arrays なのに mutable_columns \/ fill_only_columns \//);
  expect(r.status).toBe(2);
  rmSync(root, { recursive: true, force: true });
});

test.concurrent("同じファイルに fill_only_columns の違う項目が当たれば合格として扱わない（exit 2）", async () => {
  const root = await makeRepo();
  const manifest = writeManifest(root, [
    {
      id: "a",
      pattern: ".replace/features.md",
      unit: "markdown-structure",
      fill_only_columns: ["Issue"],
    },
    { id: "b", pattern: ".replace/features.md", unit: "markdown-structure" },
  ]);
  const r = await run(root, ["--manifest", manifest]);
  expect(r.stderr).toMatch(/同じファイルに突き合わせ方の違う一覧の項目が当たっている/);
  expect(r.status).toBe(2);
  rmSync(root, { recursive: true, force: true });
});

// pinned_values（Issue #582）。性能の許容幅の下限は利用者の決定で、採取から導けない。
// 手で緩めると本物の回帰が許容幅の中に入るので、履歴（floor_history）を追記しない変更を落とす。
// 落とす入力（追記なしの変更・記録と合わない追記・履歴の削除と書き換え）と同じ数だけ、通る入力
// （履歴を追記した変更・初めて書く・下限を変えない採り直し・他の項目だけの変更）を置く。

const FLOORS = { lcp: 100, cls: 0.01, tbt: 50, ttfb: 50 };
const RELATIVE_FLOORS = { lcp: 0.2, cls: 0, tbt: 0.2, ttfb: 0.2 };

/** 履歴の 1 件（perf-stats.mjs summarize --write が書く形）。 */
const historyEntry = (floors = FLOORS, relativeFloors = RELATIVE_FLOORS, sha = "a".repeat(64)) => ({
  floors,
  relative_floors: relativeFloors,
  samples_sha256: sha,
  measured_at: "2026-10-08T00:00:00.000Z",
});

/**
 * performance を持つ parity の metadata.json を commit したプロジェクトを作る。
 * @param {Record<string, unknown> | undefined} performance
 */
async function makePerfRepo(performance) {
  const root = await makeRepo();
  const path = join(root, ".replace/parity/order-list/metadata.json");
  const doc = JSON.parse(readFileSync(path, "utf8"));
  if (performance !== undefined) doc.performance = performance;
  writeFileSync(path, `${JSON.stringify(doc, null, 2)}\n`);
  const r = await spawnAsync("git", ["-C", root, "commit", "-qam", "perf"]);
  if (r.status !== 0 && performance !== undefined) throw new Error(r.stderr);
  /** @param {(perf: Record<string, unknown>, doc: Record<string, unknown>) => void} edit */
  const edit = (edit) => {
    const now = JSON.parse(readFileSync(path, "utf8"));
    edit(now.performance, now);
    writeFileSync(path, `${JSON.stringify(now, null, 2)}\n`);
  };
  return { root, edit };
}

const seededPerformance = () => ({
  declared: true,
  floors: { ...FLOORS },
  relative_floors: { ...RELATIVE_FLOORS },
  floor_history: [historyEntry()],
});

test.concurrent("履歴を追記せずに floors を緩めると落ちる", async () => {
  const { root, edit } = await makePerfRepo(seededPerformance());
  edit((perf) => {
    perf.floors.lcp = 1000;
  });
  const r = await run(root);
  expect(r.stdout).toMatch(
    /performance\.floors が performance\.floor_history への追記なしに書き換えられている/,
  );
  expect(r.stdout).not.toMatch(/relative_floors が/);
  expect(r.status).toBe(1);
  rmSync(root, { recursive: true, force: true });
});

test.concurrent("履歴を追記せずに relative_floors を緩めると落ちる", async () => {
  const { root, edit } = await makePerfRepo(seededPerformance());
  edit((perf) => {
    perf.relative_floors.lcp = 0.9;
  });
  const r = await run(root);
  expect(r.stdout).toMatch(
    /performance\.relative_floors が performance\.floor_history への追記なしに/,
  );
  expect(r.status).toBe(1);
  rmSync(root, { recursive: true, force: true });
});

test.concurrent("履歴を持たない前の版の基準で floors を変えても、追記しなければ落ちる", async () => {
  const { floor_history: _, ...legacy } = seededPerformance();
  const { root, edit } = await makePerfRepo(legacy);
  edit((perf) => {
    perf.floors.tbt = 500;
  });
  const r = await run(root);
  expect(r.stdout).toMatch(/performance\.floors が performance\.floor_history への追記なしに/);
  expect(r.status).toBe(1);
  rmSync(root, { recursive: true, force: true });
});

test.concurrent("floors を消しても、追記しなければ落ちる", async () => {
  const { root, edit } = await makePerfRepo(seededPerformance());
  edit((perf) => {
    delete perf.floors;
  });
  const r = await run(root);
  expect(r.stdout).toMatch(/performance\.floors が performance\.floor_history への追記なしに/);
  expect(r.status).toBe(1);
  rmSync(root, { recursive: true, force: true });
});

test.concurrent("誤検知しないことの確認: 履歴に今の値を追記して floors を変えれば通る", async () => {
  const { root, edit } = await makePerfRepo(seededPerformance());
  edit((perf) => {
    perf.floors.lcp = 150;
    perf.floor_history.push(historyEntry(perf.floors, perf.relative_floors, "b".repeat(64)));
  });
  const r = await run(root);
  expect(r.stdout).toMatch(/^ok: /m);
  expect(r.status).toBe(0);
  rmSync(root, { recursive: true, force: true });
});

test.concurrent("誤検知しないことの確認: 初めて書く performance は、履歴を 1 件持てば通る", async () => {
  const { root, edit } = await makePerfRepo(undefined);
  edit((_, doc) => {
    doc.performance = seededPerformance();
  });
  const r = await run(root);
  expect(r.stdout).toMatch(/^ok: /m);
  expect(r.status).toBe(0);
  rmSync(root, { recursive: true, force: true });
});

test.concurrent("初めて書く performance でも、履歴が無ければ落ちる", async () => {
  const { root, edit } = await makePerfRepo(undefined);
  edit((_, doc) => {
    const { floor_history: _h, ...perf } = seededPerformance();
    doc.performance = perf;
  });
  const r = await run(root);
  expect(r.stdout).toMatch(/performance\.floors が performance\.floor_history への追記なしに/);
  expect(r.status).toBe(1);
  rmSync(root, { recursive: true, force: true });
});

test.concurrent("誤検知しないことの確認: 下限を変えない採り直し（他の項目だけの変更）は通る", async () => {
  const { root, edit } = await makePerfRepo(seededPerformance());
  edit((perf) => {
    perf.samples_sha256 = "c".repeat(64);
    perf.pairs = [{ page: "top", viewport: "desktop", metrics: {} }];
  });
  const r = await run(root);
  expect(r.stdout).toMatch(/^ok: /m);
  expect(r.status).toBe(0);
  rmSync(root, { recursive: true, force: true });
});

test.concurrent("履歴だけを追記して、最後の要素が今の値と合わなければ落ちる", async () => {
  const { root, edit } = await makePerfRepo(seededPerformance());
  edit((perf) => {
    perf.floors.lcp = 1000;
    perf.floor_history.push(historyEntry({ ...FLOORS, lcp: 150 }));
  });
  const r = await run(root);
  expect(r.stdout).toMatch(
    /performance\.floor_history の最後の要素の floors が performance\.floors の今の値と合わない/,
  );
  expect(r.stdout).not.toMatch(/最後の要素の relative_floors/);
  expect(r.status).toBe(1);
  rmSync(root, { recursive: true, force: true });
});

test.concurrent("履歴の最後の要素がオブジェクトでなければ落ちる", async () => {
  const { root, edit } = await makePerfRepo(seededPerformance());
  edit((perf) => {
    perf.floors.lcp = 150;
    perf.floor_history.push("lcp を 150 にした");
  });
  const r = await run(root);
  expect(r.stdout).toMatch(/performance\.floor_history の最後の要素がオブジェクトでない/);
  expect(r.status).toBe(1);
  rmSync(root, { recursive: true, force: true });
});

test.concurrent("同じ変更で追記した途中の要素がオブジェクトでなければ落ちる", async () => {
  const { root, edit } = await makePerfRepo(seededPerformance());
  edit((perf) => {
    perf.floors.lcp = 150;
    perf.floor_history.push("junk", historyEntry(perf.floors, perf.relative_floors));
  });
  const r = await run(root);
  expect(r.stdout).toMatch(
    /performance\.floor_history に追記した 1 番目の要素がオブジェクトでない/,
  );
  expect(r.status).toBe(1);
  rmSync(root, { recursive: true, force: true });
});

test.concurrent("履歴の既存の要素を消すと落ちる（下限を変えないときも）", async () => {
  const perf = seededPerformance();
  perf.floor_history.push(historyEntry(FLOORS, RELATIVE_FLOORS, "b".repeat(64)));
  const { root, edit } = await makePerfRepo(perf);
  edit((now) => {
    now.floor_history.shift();
  });
  const r = await run(root);
  expect(r.stdout).toMatch(
    /performance\.floor_history の要素が失われている（比較元 2 件 → 現在 1 件）/,
  );
  expect(r.status).toBe(1);
  rmSync(root, { recursive: true, force: true });
});

test.concurrent("履歴の既存の要素を書き換えると落ちる", async () => {
  const { root, edit } = await makePerfRepo(seededPerformance());
  edit((perf) => {
    perf.floor_history[0].floors.lcp = 999;
  });
  const r = await run(root);
  expect(r.stdout).toMatch(/performance\.floor_history の 0 番目の要素が書き換えられている/);
  expect(r.status).toBe(1);
  rmSync(root, { recursive: true, force: true });
});

test.concurrent("履歴が配列でなければ合格として扱わない（exit 2）", async () => {
  const { root, edit } = await makePerfRepo(seededPerformance());
  edit((perf) => {
    perf.floor_history = { 0: historyEntry() };
  });
  const r = await run(root);
  expect(r.stderr).toMatch(/履歴と宣言した performance\.floor_history が配列でない/);
  expect(r.status).toBe(2);
  rmSync(root, { recursive: true, force: true });
});

test.concurrent("key を持たない json-arrays でも pinned_values で単独の値を固定できる", async () => {
  const root = await makeRepo();
  const manifest = writeManifest(root, [
    {
      id: "dataset-metadata",
      pattern: ".replace/dataset/metadata.json",
      unit: "json-arrays",
      arrays: ["changes"],
      pinned_values: [{ paths: ["version"], history: "version_history" }],
    },
  ]);
  const path = join(root, ".replace/dataset/metadata.json");
  const doc = JSON.parse(readFileSync(path, "utf8"));
  doc.version = 2;
  writeFileSync(path, `${JSON.stringify(doc, null, 2)}\n`);
  const lost = await run(root, ["--manifest", manifest]);
  expect(lost.stdout).toMatch(
    /version が version_history への追記なしに書き換えられている（1 → 2）/,
  );
  expect(lost.status).toBe(1);
  doc.version_history = [{ version: 2 }];
  writeFileSync(path, `${JSON.stringify(doc, null, 2)}\n`);
  const ok = await run(root, ["--manifest", manifest]);
  expect(ok.stdout).toMatch(/^ok: /m);
  expect(ok.status).toBe(0);
  rmSync(root, { recursive: true, force: true });
});

/** parity の metadata.json に当てる一覧の項目（pinned_values だけを差し替える）。 */
const pinnedArtifact = (pinned) => ({
  id: "parity-unmeasured",
  pattern: ".replace/parity/*/metadata.json",
  unit: "json-arrays",
  arrays: ["unmeasured.entries"],
  key: "item",
  pinned_values: pinned,
});

test.concurrent.each([
  ["空の配列", []],
  ["配列でない", { paths: ["a"], history: "h" }],
  ["paths が空", [{ paths: [], history: "h" }]],
  ["history が無い", [{ paths: ["a"] }]],
  ["paths の要素がキーパスの形でない", [{ paths: ["a..b"], history: "h" }]],
  ["paths と history が同じ", [{ paths: ["a"], history: "a" }]],
  ["history が paths の子孫", [{ paths: ["a"], history: "a.history" }]],
  [
    "paths が別のグループの paths と重なる",
    [
      { paths: ["a"], history: "h" },
      { paths: ["a.b"], history: "i" },
    ],
  ],
  ["同じグループで最後のセグメントが重なる", [{ paths: ["x.floors", "y.floors"], history: "h" }]],
  ["history が arrays と同じ", [{ paths: ["a"], history: "unmeasured.entries" }]],
  ["paths が arrays の祖先", [{ paths: ["unmeasured"], history: "h" }]],
])("pinned_values の書き方が誤っていれば合格として扱わない（exit 2）: %s", async (_, pinned) => {
  const root = await makeRepo();
  const manifest = writeManifest(root, [pinnedArtifact(pinned)]);
  const r = await run(root, ["--manifest", manifest]);
  expect(r.stderr).toMatch(/pinned_values/);
  expect(r.status).toBe(2);
  rmSync(root, { recursive: true, force: true });
});

test.concurrent("unit が json-arrays でないのに pinned_values があれば合格として扱わない（exit 2）", async () => {
  const root = await makeRepo();
  const manifest = writeManifest(root, [
    {
      id: "features",
      pattern: ".replace/features.md",
      unit: "markdown-structure",
      pinned_values: [{ paths: ["a"], history: "h" }],
    },
  ]);
  const r = await run(root, ["--manifest", manifest]);
  expect(r.stderr).toMatch(/unit が markdown-structure なのに pinned_values がある/);
  expect(r.status).toBe(2);
  rmSync(root, { recursive: true, force: true });
});

test.concurrent("同じファイルに当たる 2 項目で pinned_values だけ違えば合格として扱わない（exit 2）", async () => {
  const root = await makeRepo();
  const manifest = writeManifest(root, [
    pinnedArtifact([{ paths: ["performance.floors"], history: "performance.floor_history" }]),
    { ...pinnedArtifact([{ paths: ["performance.relative_floors"], history: "h" }]), id: "other" },
  ]);
  const r = await run(root, ["--manifest", manifest]);
  expect(r.stderr).toMatch(/突き合わせ方の違う一覧の項目が当たっている/);
  expect(r.status).toBe(2);
  rmSync(root, { recursive: true, force: true });
});
