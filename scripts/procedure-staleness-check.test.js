// replace-strategy の旧手順で閉じた機能の検査（procedure-staleness-check.mjs）の回帰テスト（Issue #505）。
//
// 手順に確かめる軸を足しても、既に閉じた機能へ当て直す工程が無いと、前の機能は古い手順のまま収束扱いで残る。
// 検査は「変更より前に作られた成果物を持つ機能」ごとに当て直しの判断の記録を要求する。
//
// 陽性コントロール（最新の改訂で作った成果物・追加日より後に作った成果物・判断済みの組み合わせが exit 0）を置く——
// これが無いと「常に落とす」実装と区別できない。

import { mkdirSync, readFileSync, symlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { test, expect } from "vitest";
import {
  main,
  readLedger,
  readRevisions,
} from "../skills/replace-strategy/scripts/procedure-staleness-check.mjs";
import { makeTempDir } from "./lib/test-tmpdir.js";

const REVISIONS = {
  skill: "parity-suite",
  revision: 2,
  changes: [
    { revision: 1, axis: "導入点", affects: ["feature", "api-resource", "batch"] },
    { revision: 2, axis: "0 件の表示", affects: ["feature"] },
  ],
};

const CHANGE_HEADER =
  "| ID | 追加日 | 足した軸 | 由来 | 対象の種類 | 見直しの置き場 |\n|---|---|---|---|---|---|\n";
const RECORD_HEADER =
  "| 記録 ID | 変更 ID | slug | 判断 | 記録日 | 根拠・理由 |\n|---|---|---|---|---|---|\n";

/**
 * 台帳の本文を組み立てる。
 * @param {string[]} changes 「観点の追加」表の行
 * @param {string[]} records 「既に閉じた機能への当て直し」表の行
 */
function ledger(changes, records) {
  return (
    "# 台帳\n\n## 観点の追加\n\n" +
    CHANGE_HEADER +
    changes.map((row) => `${row}\n`).join("") +
    "\n## 既に閉じた機能への当て直し\n\n" +
    RECORD_HEADER +
    records.map((row) => `${row}\n`).join("")
  );
}

/**
 * 作業ディレクトリを作る。
 * @param {{ revisions?: unknown, ledger?: string, artifacts?: Record<string, unknown> }} spec
 */
function workspace(spec) {
  const work = makeTempDir("procedure-staleness-");
  writeFileSync(join(work, "revisions.json"), JSON.stringify(spec.revisions ?? REVISIONS));
  mkdirSync(join(work, ".replace", "parity"), { recursive: true });
  if (spec.ledger !== undefined)
    writeFileSync(join(work, ".replace", "procedure-changes.md"), spec.ledger);
  for (const [slug, meta] of Object.entries(spec.artifacts ?? {})) {
    mkdirSync(join(work, ".replace", "parity", slug), { recursive: true });
    if (meta !== null) {
      writeFileSync(
        join(work, ".replace", "parity", slug, "metadata.json"),
        typeof meta === "string"
          ? meta
          : JSON.stringify(Object.hasOwn(meta, "slug") ? meta : { slug, ...meta }),
      );
    }
  }
  return work;
}

/**
 * 成果物の metadata.json を組み立てる。
 * @param {Record<string, unknown>} run
 * @param {string} [mode]
 */
function meta(run, mode = "feature") {
  return { mode, run: { finished_at: "2026-09-10T00:00:00Z", ...run } };
}

/**
 * CLI を直接呼ぶ。
 * @param {string} work
 * @param {string[]} [extra]
 */
function run(work, extra = []) {
  let stdout = "";
  let stderr = "";
  const code = main(["--revisions", "revisions.json", ...extra], {
    cwd: work,
    stdout: (s) => {
      stdout += s;
    },
    stderr: (s) => {
      stderr += s;
    },
  });
  return { code, stdout, stderr, json: stdout ? JSON.parse(stdout) : null };
}

test("改訂番号を持たない成果物は、スキルのすべての改訂について未判断として落とす", () => {
  const work = workspace({ artifacts: { order: meta({}) } });
  const r = run(work);
  expect(r.code).toBe(1);
  expect(r.json.ledger_exists).toBe(false);
  expect(r.json.unresolved.map((u) => [u.change, u.slug, u.state])).toEqual([
    ["parity-suite#1", "order", "未判断"],
    ["parity-suite#2", "order", "未判断"],
  ]);
});

test("陰性コントロール: metadata.json の無い特性化中の slug は、中身があっても判定不能にしない", () => {
  // parity-suite は metadata.json を終盤で書くので、対応表・スペックだけがある形は特性化中の正常な状態。
  const work = workspace({
    artifacts: { order: meta({ procedure_revision: 2 }), draft: null },
  });
  writeFileSync(join(work, ".replace", "parity", "draft", "gaps.md"), "# gaps\n");
  const r = run(work);
  expect(r.code).toBe(0);
  expect(r.json.artifacts.map((a) => a.slug)).toEqual(["order"]);
});

test("成果物の改訂より新しい改訂だけが対象になり、affects に無い mode は対象にしない", () => {
  const work = workspace({
    artifacts: {
      order: meta({ procedure_revision: 1 }),
      export: meta({ procedure_revision: 1 }, "batch"),
    },
  });
  const r = run(work);
  expect(r.code).toBe(1);
  expect(r.json.unresolved.map((u) => [u.change, u.slug])).toEqual([["parity-suite#2", "order"]]);
});

test("陽性コントロール: 最新の改訂で作った成果物と、特性化前の slug は対象にしない", () => {
  const work = workspace({
    artifacts: { order: meta({ procedure_revision: 2 }), draft: null },
  });
  const r = run(work);
  expect(r.code).toBe(0);
  expect(r.json.unresolved).toEqual([]);
  expect(r.json.artifacts.map((a) => a.slug)).toEqual(["order"]);
});

test("プロジェクト側で足した軸は、追加日以前（同じ日を含む）に作った成果物を対象にし、後のものは対象にしない", () => {
  const work = workspace({
    ledger: ledger(
      [
        "| PC-001 | 2026-09-10 | 入力の重複 | project-rule: docs/axes.md | feature | この変更の完了条件 |",
      ],
      [],
    ),
    artifacts: {
      before: meta({ procedure_revision: 2, finished_at: "2026-09-09T23:00:00Z" }),
      same: meta({ procedure_revision: 2, finished_at: "2026-09-10T12:00:00Z" }),
      after: meta({ procedure_revision: 2, finished_at: "2026-09-11T00:00:00Z" }),
    },
  });
  const r = run(work);
  expect(r.code).toBe(1);
  expect(r.json.unresolved.map((u) => [u.change, u.slug, u.placement])).toEqual([
    ["PC-001", "before", "この変更の完了条件"],
    ["PC-001", "same", "この変更の完了条件"],
  ]);
});

test("当て直し済み・当てないの記録で解決し、見直し中は未解決のまま残す", () => {
  const work = workspace({
    ledger: ledger(
      ["| PC-001 | 2026-09-20 | 入力の重複 | kaizen: .kaizen/a.md | * | #12 |"],
      [
        "| R-001 | PC-001 | order | 当て直し済み | 2026-09-21 | PR #13 |",
        "| R-002 | PC-001 | export | 当てない | 2026-09-21 | 入力欄を持たない |",
        "| R-003 | PC-001 | user | 見直し中 | 2026-09-21 | #14 |",
      ],
    ),
    artifacts: {
      order: meta({ procedure_revision: 2 }),
      export: meta({ procedure_revision: 2 }, "batch"),
      user: meta({ procedure_revision: 2 }),
    },
  });
  const r = run(work);
  expect(r.code).toBe(1);
  expect(r.json.unresolved.map((u) => [u.slug, u.state, u.record])).toEqual([
    ["user", "見直し中", "R-003"],
  ]);
  expect(r.json.resolved.map((u) => [u.slug, u.state])).toEqual([
    ["export", "当てない"],
    ["order", "当て直し済み"],
  ]);
});

test("同じ組み合わせの記録は後の行を現在の判断として読む", () => {
  const rows = [
    "| R-001 | parity-suite#2 | order | 見直し中 | 2026-09-21 | #14 |",
    "| R-002 | parity-suite#2 | order | 当て直し済み | 2026-09-22 | PR #15 |",
  ];
  const settled = run(
    workspace({ ledger: ledger([], rows), artifacts: { order: meta({ procedure_revision: 1 }) } }),
  );
  expect(settled.code).toBe(0);
  const reopened = run(
    workspace({
      ledger: ledger([], [...rows].reverse()),
      artifacts: { order: meta({ procedure_revision: 1 }) },
    }),
  );
  expect(reopened.code).toBe(1);
  expect(reopened.json.unresolved[0].state).toBe("見直し中");
});

test("対象でない組み合わせへの記録は落とさず stray として見せる", () => {
  const work = workspace({
    ledger: ledger([], ["| R-001 | parity-suite#2 | ordre | 当てない | 2026-09-21 | 綴り違い |"]),
    artifacts: { order: meta({ procedure_revision: 2 }) },
  });
  const r = run(work);
  expect(r.code).toBe(0);
  expect(r.json.stray).toEqual([{ record: "R-001", change: "parity-suite#2", slug: "ordre" }]);
});

test("台帳の表の欠落・語彙外の値・実在しない変更 ID・空の根拠・重複 ID は exit 2 で落とす", () => {
  const cases = [
    ["# 台帳\n\n" + CHANGE_HEADER, "表が無い"],
    [ledger(["| PC-001 | 2026-09-20 | 軸 | 由来 | feature |  |"], []), "見直しの置き場"],
    [ledger(["| PC-001 | 2026-02-30 | 軸 | 由来 | feature | #1 |"], []), "追加日"],
    [ledger(["| PC-001 | 2026-09-20 | 軸 | 由来 | screen | #1 |"], []), "対象の種類"],
    [ledger(["| PC#1 | 2026-09-20 | 軸 | 由来 | feature | #1 |"], []), "# を使わない"],
    [
      ledger(
        [
          "| PC-001 | 2026-09-20 | 軸 | 由来 | feature | #1 |",
          "| PC-001 | 2026-09-21 | 軸 | 由来 | feature | #1 |",
        ],
        [],
      ),
      "ID が重複",
    ],
    [
      ledger([], ["| R-001 | PC-009 | order | 当てない | 2026-09-21 | 理由 |"]),
      "変更 ID が台帳にも改訂一覧にも無い",
    ],
    [ledger([], ["| R-001 | parity-suite#2 | order | 済み | 2026-09-21 | 理由 |"]), "判断が"],
    [
      ledger([], ["| R-001 | parity-suite#2 | order | 当てない | 2026-09-21 | - |"]),
      "根拠・理由が空",
    ],
    [
      ledger([], ["| R-001 | parity-suite#2 | order | 見直し中 | 2026-09-21 | 後で |"]),
      "#<Issue 番号> で始まらない",
    ],
    [
      ledger([], []).replace(
        "|---|---|---|---|---|---|\n\n## 既に",
        "|---|---|---|---|---|---|\n\n| PC-001 | 2026-09-20 | 軸 | 由来 | feature | #1 |\n\n## 既に",
      ),
      "表の外に表の行",
    ],
    // 外側の `|` を省いた表の行は `|` で始まらない。件数で差し引くと表の外の行を打ち消して通してしまう。
    [
      "# 台帳\n\n" +
        "ID | 追加日 | 足した軸 | 由来 | 対象の種類 | 見直しの置き場\n---|---|---|---|---|---\n" +
        "PC-001 | 2026-09-20 | 軸 | 由来 | feature | #1\n\n" +
        "| PC-002 | 2026-09-20 | 軸 | 由来 | feature | #1 |\n\n" +
        RECORD_HEADER,
      "表の外に表の行",
    ],
    // 列が 1 つ欠けた行（5 セル）が表の外に落ちても数える。
    [
      ledger([], []).replace(
        "|---|---|---|---|---|---|\n\n## 既に",
        "|---|---|---|---|---|---|\n\n| PC-001 | 2026-09-20 | 軸 | 由来 | feature |\n\n## 既に",
      ),
      "表の外に表の行",
    ],
    // 表の外に落ちた行自身が外側の `|` を省いた形でも数える。
    [
      ledger([], []).replace(
        "|---|---|---|---|---|---|\n\n## 既に",
        "|---|---|---|---|---|---|\n\nPC-001 | 2026-09-20 | 軸 | 由来 | feature | #1\n\n## 既に",
      ),
      "表の外に表の行",
    ],
  ];
  for (const [text, message] of cases) {
    const r = run(
      workspace({ ledger: text, artifacts: { order: meta({ procedure_revision: 2 }) } }),
    );
    expect(r.code, message).toBe(2);
    expect(r.json.errors.join("\n"), message).toContain(message);
  }
});

test("成果物を読めず対象かを決められない機能は合格に倒さず exit 3 にする", () => {
  const cases = [
    [meta({ procedure_revision: "1" }), "procedure_revision"],
    [meta({ procedure_revision: 3 }), "改訂一覧が古い"],
    [{ mode: "screen", run: { procedure_revision: 2 } }, "mode"],
    // 別の機能の成果物が置き場を取り違えて置かれている。
    [
      { slug: "order-edit", ...meta({ procedure_revision: 2 }) },
      "置き場の slug (order) と一致しない",
    ],
    [{ slug: null, ...meta({ procedure_revision: 2 }) }, "置き場の slug (order) と一致しない"],
    ["{", "読めない"],
  ];
  for (const [artifact, message] of cases) {
    const r = run(workspace({ artifacts: { order: artifact } }));
    expect(r.code, message).toBe(3);
    expect(r.json.undeterminable.map((u) => u.reason).join("\n"), message).toContain(message);
  }
  const placeholder = run(
    workspace({
      ledger: ledger(["| PC-001 | 2026-09-20 | 軸 | 由来 | feature | #1 |"], []),
      artifacts: { order: meta({ procedure_revision: 2, finished_at: "<ISO 8601 の終了日時>" }) },
    }),
  );
  expect(placeholder.code).toBe(3);
  expect(placeholder.json.undeterminable[0]).toMatchObject({ slug: "order", change: "PC-001" });
  // Date.parse が 03-02 へ繰り上げて受理する実在しない日付も、日時として読まない。
  const impossible = run(
    workspace({
      ledger: ledger(["| PC-001 | 2026-09-20 | 軸 | 由来 | feature | #1 |"], []),
      artifacts: { order: meta({ procedure_revision: 2, finished_at: "2026-02-30T00:00:00Z" }) },
    }),
  );
  expect(impossible.code).toBe(3);
  // UTC より遅れたオフセットの終了日時を換算して翌日に倒さない（同じ日の追加の対象に残す）。
  const behindUtc = run(
    workspace({
      ledger: ledger(["| PC-001 | 2026-09-28 | 軸 | 由来 | feature | #1 |"], []),
      artifacts: {
        order: meta({ procedure_revision: 2, finished_at: "2026-09-28T20:00:00-05:00" }),
      },
    }),
  );
  expect(behindUtc.code).toBe(1);
  expect(behindUtc.json.unresolved.map((u) => u.change)).toEqual(["PC-001"]);
  const broken = workspace({ artifacts: { order: meta({ procedure_revision: 2 }) } });
  symlinkSync(join(broken, "nowhere"), join(broken, ".replace", "parity", "dangling"));
  const dangling = run(broken);
  expect(dangling.code).toBe(3);
  expect(dangling.json.undeterminable[0].slug).toBe("dangling");
  // metadata.json 自体が壊れたリンクなら、特性化前として黙って外さず判定不能に残す。
  const brokenMeta = workspace({
    artifacts: { order: meta({ procedure_revision: 2 }), edit: null },
  });
  symlinkSync(
    join(brokenMeta, "gone.json"),
    join(brokenMeta, ".replace", "parity", "edit", "metadata.json"),
  );
  const brokenRun = run(brokenMeta);
  expect(brokenRun.code).toBe(3);
  expect(brokenRun.json.undeterminable.map((u) => u.slug)).toEqual(["edit"]);
  // slug の置き場がファイルに置き換わっていれば判定不能。ドットファイルは置き場の外の正当なファイルとして許す。
  const fileEntry = workspace({ artifacts: { order: meta({ procedure_revision: 2 }) } });
  writeFileSync(join(fileEntry, ".replace", "parity", "edit"), "{}");
  writeFileSync(join(fileEntry, ".replace", "parity", ".gitkeep"), "");
  const fileRun = run(fileEntry);
  expect(fileRun.code).toBe(3);
  expect(fileRun.json.undeterminable.map((u) => u.slug)).toEqual(["edit"]);
});

test("成果物の置き場・台帳を読めないときは合格にも未判断にも倒さず exit 2 にする", () => {
  const missing = workspace({ artifacts: {} });
  expect(run(missing, ["--parity-dir", "nope"]).code).toBe(2);
  writeFileSync(join(missing, "file"), "");
  expect(run(missing, ["--parity-dir", "file"]).code).toBe(2);
  mkdirSync(join(missing, "ledger-dir"));
  expect(run(missing, ["--ledger", "ledger-dir"]).code).toBe(2);
  // 台帳自体が壊れたリンクなら「台帳なし」に倒さない（成果物が最新でも exit 0 にしない）。
  const lostLedger = workspace({ artifacts: { order: meta({ procedure_revision: 2 }) } });
  symlinkSync(join(lostLedger, "gone.md"), join(lostLedger, ".replace", "procedure-changes.md"));
  expect(run(lostLedger).code).toBe(2);
  // 空の置き場（特性化前・別プロジェクトでの実行）は合格にせず対象外（exit 4）で区別する。
  const empty = run(missing);
  expect(empty.code).toBe(4);
  expect(empty.json.artifacts).toEqual([]);
});

test("明示した --ledger が無いときは「台帳なし」に倒さず exit 2 にする", () => {
  const work = workspace({ artifacts: { order: meta({ procedure_revision: 2 }) } });
  const typo = run(work, ["--ledger", ".replace/procedure-change.md"]);
  expect(typo.code).toBe(2);
  expect(typo.stderr).toContain("--ledger に渡した");
  // 陰性コントロール: 既定の置き場に台帳が無いのは「プロジェクト側で軸を足していない」なので通す。
  const absent = run(work);
  expect(absent.code).toBe(0);
  expect(absent.json.ledger_exists).toBe(false);
});

test("セル内の \\| は区切りにせず、値では | として読む", () => {
  const work = workspace({
    ledger: ledger(
      ["| PC-001 | 2026-09-20 | 0 件 \\| 1 件の表示 | issue: #12 | feature | この変更の完了条件 |"],
      ["| R-001 | PC-001 | order | 当てない | 2026-09-21 | 一覧 \\| 詳細のどちらも持たない |"],
    ),
    artifacts: { order: meta({ procedure_revision: 2 }), user: meta({ procedure_revision: 2 }) },
  });
  const r = run(work);
  expect(r.code).toBe(1);
  expect(r.json.unresolved.map((u) => [u.change, u.slug, u.axis])).toEqual([
    ["PC-001", "user", "0 件 | 1 件の表示"],
  ]);
  expect(r.json.resolved.map((u) => [u.slug, u.basis])).toEqual([
    ["order", "一覧 | 詳細のどちらも持たない"],
  ]);
});

test("--change は名指した変更だけで判定し、実在しない変更 ID は exit 2 で落とす", () => {
  const work = workspace({
    ledger: ledger(
      ["| PC-001 | 2026-09-20 | 軸 | 由来 | feature | #1 |"],
      ["| R-001 | PC-001 | order | 当て直し済み | 2026-09-21 | PR #2 |"],
    ),
    artifacts: { order: meta({}) },
  });
  expect(run(work).code).toBe(1);
  const scoped = run(work, ["--change", "PC-001"]);
  expect(scoped.code).toBe(0);
  expect(scoped.json.resolved.map((r) => r.change)).toEqual(["PC-001"]);
  expect(run(work, ["--change", "parity-suite#2"]).code).toBe(1);
  expect(run(work, ["--change", "PC-404"]).code).toBe(2);
});

test("--change では置き場の別 Issue へ回した見直し中を受け渡し済みとし、置き場と違う番号・未判断は残す", () => {
  const work = workspace({
    ledger: ledger(
      ["| PC-001 | 2026-09-20 | 軸 | issue: #10 | feature | #131 |"],
      [
        "| R-001 | PC-001 | order | 見直し中 | 2026-09-21 | #131 で当て直す |",
        "| R-002 | PC-001 | user | 見直し中 | 2026-09-21 | #1310 で当て直す |",
      ],
    ),
    artifacts: {
      order: meta({ procedure_revision: 2 }),
      user: meta({ procedure_revision: 2 }),
      export: meta({ procedure_revision: 2 }),
    },
  });
  const scoped = run(work, ["--change", "PC-001"]);
  expect(scoped.code).toBe(1);
  expect(scoped.json.handed_off.map((u) => u.slug)).toEqual(["order"]);
  expect(scoped.json.unresolved.map((u) => [u.slug, u.state])).toEqual([
    ["export", "未判断"],
    ["user", "見直し中"],
  ]);
  // 陽性コントロール: 全ての対象を置き場の番号で受け渡せば、この変更の工程は閉じられる。
  const done = workspace({
    ledger: ledger(
      ["| PC-001 | 2026-09-20 | 軸 | issue: #10 | feature | #131 |"],
      ["| R-001 | PC-001 | order | 見直し中 | 2026-09-21 | #131 |"],
    ),
    artifacts: { order: meta({ procedure_revision: 2 }) },
  });
  expect(run(done, ["--change", "PC-001"]).code).toBe(0);
  // --change なしの判定（status）は見直し中を未解決として数え続ける。
  const whole = run(done);
  expect(whole.code).toBe(1);
  expect(whole.json.handed_off).toEqual([]);
  // 置き場がこの変更の完了条件なら、見直し中は受け渡しにならない。
  const inChange = workspace({
    ledger: ledger(
      ["| PC-001 | 2026-09-20 | 軸 | issue: #10 | feature | この変更の完了条件 |"],
      ["| R-001 | PC-001 | order | 見直し中 | 2026-09-21 | #131 |"],
    ),
    artifacts: { order: meta({ procedure_revision: 2 }) },
  });
  expect(run(inChange, ["--change", "PC-001"]).code).toBe(1);
});

test("改訂一覧の revision に対応する改訂が無い・affects が語彙外なら exit 2 で落とす", () => {
  expect(
    readRevisions({ skill: "parity-suite", revision: 2, changes: [REVISIONS.changes[0]] }).ok,
  ).toBe(false);
  // 最新の番号はあっても途中の番号が抜けている一覧（1 と 3 だけ）を受理しない。
  const gap = readRevisions({
    skill: "parity-suite",
    revision: 3,
    changes: [REVISIONS.changes[0], { revision: 3, axis: "c", affects: ["feature"] }],
  });
  expect(gap.ok).toBe(false);
  expect(/** @type {any} */ (gap).errors.join("\n")).toContain("revision 2 に対応する");
  const bad = run(
    workspace({
      revisions: {
        skill: "parity-suite",
        revision: 1,
        changes: [{ revision: 1, axis: "a", affects: ["screen"] }],
      },
    }),
  );
  expect(bad.code).toBe(2);
  expect(bad.json.errors.join("\n")).toContain("語彙外の mode");
});

test("parity-suite 以外のスキルの改訂一覧は、番号が合っても exit 2 で落とす", () => {
  const other = { ...REVISIONS, skill: "parity-replace" };
  const bad = run(
    workspace({ revisions: other, artifacts: { order: meta({ procedure_revision: 2 }) } }),
  );
  expect(bad.code).toBe(2);
  expect(bad.json.errors.join("\n")).toContain("skill が parity-suite でない");
});

test("陰性コントロール: 複数行の HTML コメントの中の `|` を含む行は表の外の行に数えない", () => {
  const text = ledger(["| PC-001 | 2026-09-20 | 軸 | 由来 | feature | #1 |"], []).replace(
    "## 観点の追加",
    "<!--\n記入例: | PC-009 | 2026-09-01 | 軸 | 由来 | feature | #9 |\n-->\n\n## 観点の追加",
  );
  const r = readLedger(text, new Set());
  expect(r.ok).toBe(true);
});

test("HTML コメントの中の表は台帳として読まない（生きた表の代わりにも、重複にもならない）", () => {
  const retired = `<!--\n退役した表:\n${CHANGE_HEADER}| PC-900 | 2026-01-01 | 軸 | 由来 | * | #9 |\n-->\n\n`;
  const withLive = readLedger(
    retired + ledger(["| PC-001 | 2026-09-20 | 軸 | 由来 | feature | #1 |"], []),
    new Set(),
  );
  expect(withLive.ok).toBe(true);
  expect(/** @type {any} */ (withLive).changes.map((c) => c.id)).toEqual(["PC-001"]);
  const onlyRetired = readLedger(`# 台帳\n\n${retired}${RECORD_HEADER}`, new Set());
  expect(onlyRetired.ok).toBe(false);
  expect(/** @type {any} */ (onlyRetired).errors.join("\n")).toContain("「観点の追加」表が無い");
});

const LIVE = ledger(["| PC-001 | 2026-09-20 | 軸 | 由来 | feature | #1 |"], []);

test.each([
  [
    "散文の後ろで開いたコメントの中の表",
    `退役した表 <!--\n${CHANGE_HEADER}| PC-900 | 2026-01-01 | 軸 | 由来 | * | #9 |\n-->\n\n`,
  ],
  ["行の途中で閉じたコメント", "<!-- 説明 --> 後ろの散文\n\n"],
  ["1 行に 2 つのコメント", "<!-- a --> <!-- b -->\n\n"],
  ["終了行の後ろの散文", "<!--\n説明\n--> 続き\n\n"],
  ["コメントの中で開き直したコメント", "<!--\n説明 <!-- 入れ子\n-->\n\n"],
])("HTML コメントの記号が扱えない位置にある台帳は落とす: %s", (_name, prefix) => {
  const r = readLedger(prefix + LIVE, new Set());
  expect(r.ok).toBe(false);
  expect(/** @type {any} */ (r).errors.join("\n")).toContain("HTML コメントの記号が");
});

test("閉じない HTML コメントは、以降の表を読まずに合格させない", () => {
  const r = readLedger(`${LIVE}\n<!--\n説明\n`, new Set());
  expect(r.ok).toBe(false);
  expect(/** @type {any} */ (r).errors.join("\n")).toContain("HTML コメントが閉じていない");
});

test.each([
  ["1 行のコメント", "<!-- 説明 | a | b | -->\n\n"],
  ["開始行と終了行に分けたコメント", "<!--\n記入例: | a | b | c |\n-->\n\n"],
  ["字下げした終了行", "<!--\n  説明\n  -->\n\n"],
  ["コードフェンスの中の記号", "```text\n退役 <!-- 例 --> 続き\n```\n\n"],
  ["コメントの中のフェンス記号", "<!--\n```\n-->\n\n"],
])("陰性コントロール: 扱える位置の HTML コメントは通す: %s", (_name, prefix) => {
  const r = readLedger(prefix + LIVE, new Set());
  expect(r.ok).toBe(true);
  expect(/** @type {any} */ (r).changes.map((c) => c.id)).toEqual(["PC-001"]);
});

test("同梱の改訂一覧と台帳テンプレートは検査がそのまま読める", () => {
  const shipped = readRevisions(
    JSON.parse(readFileSync("skills/parity-suite/assets/procedure-revisions.json", "utf8")),
  );
  expect(shipped.ok).toBe(true);
  const template = readLedger(
    readFileSync("skills/replace-strategy/assets/procedure-changes-template.md", "utf8"),
    new Set(),
  );
  expect(template).toEqual({ ok: true, changes: [], records: [] });
  // 成果物のテンプレートが改訂番号の置き場を持つ（無いと parity-suite が書かず、全成果物が導入前として出続ける）。
  const metadata = JSON.parse(
    readFileSync("skills/parity-suite/assets/metadata-template.json", "utf8"),
  );
  expect(Object.hasOwn(metadata.run, "procedure_revision")).toBe(true);
});
