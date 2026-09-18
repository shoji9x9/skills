import { test, expect } from "vitest";
import { spawnSync } from "node:child_process";
import {
  chmodSync,
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

// kaizen-forget.sh は **SessionStart フックから無人で走り、追跡ファイルを書き換える**
// （Issue #339）。判定が緩むと、まだ適用したい学びが黙って注入から消える——消えたことは
// 出力にも終了コードにも現れないので、閾値の各軸を決定論的に固定する。
// 逆に厳しすぎると 1 件も忘れず注入が肥大し続けるため、候補側も陽性コントロールで押さえる。
//
// 状態空間（候補判定の軸。各セルに 1 検体）:
//
// | 軸        | 候補になる     | 候補にならない                                   |
// |-----------|----------------|--------------------------------------------------|
// | status    | pending        | applied / rejected / forgotten                   |
// | priority  | 閾値以下（既定 medium。low / medium） | high / 未知の値 / 未設定    |
// | date      | 閾値以上（既定 30 日） | 閾値未満 / 不正な形式 / 未設定             |
//
// **読めない材料は候補にしない**（忘れない側へ倒す）。忘却は「消える側」の操作なので、
// priority や date を書き忘れただけの学びが自動で忘れられてはならない。
//
// 設定（`.kaizen/config`）の軸: forget_auto / forget_after_days / forget_max_priority、
// および各キーの不正値（既定へ倒し、倒したことを stderr に出す）。
//
// モードの軸: `--list`（変更しない） / `--auto`（閾値で掃引） / 明示（閾値に関わらず忘却）。
//
// 変異による検出能力の実証（このファイルを書いた時点で 4 通り実施し、いずれも赤くなることを実測した）:
//   1. `[ "${rank}" -ge "${forget_max_rank}" ] || return 1` を削る → 3 件 fail（high が候補に入る）
//   2. `[ "${age}" -ge "${forget_after_days}" ] || return 1` を削る → 3 件 fail（新しいノートが候補に入る）
//   3. `[ "${status}" = "pending" ] || return 1` を削る → 4 件 fail
//      （applied / rejected が候補に入り、status-check との整合検査も落ちる＝下流への影響まで測れている）
//   4. `priority_rank` の `*) return 1 ;;` を `*) printf '2' ;;` に → 3 件 fail（priority 未設定・未知が候補に入る）
const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const script = join(repoRoot, "skills/kaizen/scripts/kaizen-forget.sh");

// 日付はテストの実行日から作る。固定日を書くと、時間が経つだけで「閾値未満」の検体が
// 閾値以上へ育ち、境界の検査が静かに無意味になる。
function daysAgo(n) {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - n);
  return d.toISOString().slice(0, 10);
}

function note({ date = daysAgo(200), priority = "low", status = "pending", appliedTo = "[]" }) {
  const lines = ["---"];
  if (date !== null) lines.push(`date: ${date}`);
  lines.push("type: doc");
  if (priority !== null) lines.push(`priority: ${priority}`);
  lines.push(
    `status: ${status}`,
    `applied-to: ${appliedTo}`,
    "---",
    "",
    "## 事象",
    "",
    "本文。",
    "",
  );
  return lines.join("\n");
}

function makeProject(notes, config) {
  const dir = mkdtempSync(join(tmpdir(), "kaizen-forget-"));
  mkdirSync(join(dir, ".kaizen"), { recursive: true });
  for (const [name, content] of Object.entries(notes)) {
    writeFileSync(join(dir, ".kaizen", `${name}.md`), content);
  }
  if (config !== undefined) writeFileSync(join(dir, ".kaizen", "config"), config);
  return dir;
}

function run(dir, args) {
  const result = spawnSync("bash", [script, ...args], {
    cwd: dir,
    env: { ...process.env, CLAUDE_PROJECT_DIR: dir },
    encoding: "utf8",
  });
  return { status: result.status, stdout: result.stdout ?? "", stderr: result.stderr ?? "" };
}

// `.kaizen/*.md` の全文を名前 → 内容で返す（書き換えの有無を全文で突き合わせるため）。
function snapshot(dir) {
  const out = {};
  for (const name of readdirSync(join(dir, ".kaizen"))) {
    if (!name.endsWith(".md")) continue;
    out[name] = readFileSync(join(dir, ".kaizen", name), "utf8");
  }
  return out;
}

function statusOf(dir, name) {
  const body = readFileSync(join(dir, ".kaizen", `${name}.md`), "utf8");
  return /^status: (.*)$/m.exec(body)?.[1] ?? "";
}

// 候補になる検体（陽性コントロール）と、ならない検体（陰性コントロール）。
// 片側だけだと「常に忘れる」「1 件も忘れない」のどちらへ退化しても気づけない。
const CANDIDATES = {
  "old-low": note({}),
  "old-medium": note({ priority: "medium" }),
};
const NON_CANDIDATES = {
  "old-high": note({ priority: "high" }),
  "old-unknown-priority": note({ priority: "urgent" }),
  "old-no-priority": note({ priority: null }),
  "recent-low": note({ date: daysAgo(3) }),
  "bad-date": note({ date: "2026/06/10" }),
  "no-date": note({ date: null }),
  "old-applied": note({ status: "applied", appliedTo: '["a.md"]' }),
  "old-rejected": note({ status: "rejected", appliedTo: '["rejected: 見送る"]' }),
  "old-forgotten": note({ status: "forgotten" }),
};

test("候補側と非候補側の両方の検体を持つ", () => {
  expect(Object.keys(CANDIDATES).length).toBeGreaterThan(0);
  expect(Object.keys(NON_CANDIDATES).length).toBeGreaterThan(0);
});

test("--list は候補だけを挙げ、何も書き換えない", () => {
  const dir = makeProject({ ...CANDIDATES, ...NON_CANDIDATES });
  try {
    const before = snapshot(dir);
    const { status, stdout } = run(dir, ["--list"]);
    expect(status).toBe(0);
    const listed = stdout
      .trim()
      .split("\n")
      .filter(Boolean)
      .map((line) => line.split("\t")[0]);
    expect(listed.sort()).toEqual([".kaizen/old-low.md", ".kaizen/old-medium.md"]);
    // 一覧は判断材料（日付・優先度・経過日数）を添える。ファイル名だけだと承認できない。
    expect(stdout).toMatch(/\t\d{4}-\d{2}-\d{2}\t(low|medium)\t\d+$/m);
    // 何も書き換えていないことは、実行前後の全文を突き合わせて確かめる
    // （status だけを見ると、本文を壊す変更を見逃す）。
    expect(snapshot(dir)).toEqual(before);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("--auto は候補だけを forgotten にし、他は触らない", () => {
  const dir = makeProject({ ...CANDIDATES, ...NON_CANDIDATES });
  try {
    const { status, stdout, stderr } = run(dir, ["--auto"]);
    expect(status).toBe(0);
    expect(stdout.trim().split("\n").sort()).toEqual([
      ".kaizen/old-low.md",
      ".kaizen/old-medium.md",
    ]);
    expect(stderr).toContain("forgot 2 note(s)");
    expect(statusOf(dir, "old-low")).toBe("forgotten");
    expect(statusOf(dir, "old-medium")).toBe("forgotten");
    expect(statusOf(dir, "old-high")).toBe("pending");
    expect(statusOf(dir, "old-unknown-priority")).toBe("pending");
    expect(statusOf(dir, "old-no-priority")).toBe("pending");
    expect(statusOf(dir, "recent-low")).toBe("pending");
    expect(statusOf(dir, "bad-date")).toBe("pending");
    expect(statusOf(dir, "no-date")).toBe("pending");
    expect(statusOf(dir, "old-applied")).toBe("applied");
    expect(statusOf(dir, "old-rejected")).toBe("rejected");
    expect(statusOf(dir, "old-forgotten")).toBe("forgotten");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("--auto は冪等（2 回目は 0 件）", () => {
  // SessionStart のたびに走るので、同じノートを何度も「忘れた」と報告してはならない。
  const dir = makeProject(CANDIDATES);
  try {
    expect(run(dir, ["--auto"]).stderr).toContain("forgot 2 note(s)");
    const second = run(dir, ["--auto"]);
    expect(second.stdout.trim()).toBe("");
    expect(second.stderr).toContain("forgot 0 note(s)");
    expect(second.status).toBe(0);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("本文の status: 行を書き換えない（frontmatter 限定）", () => {
  const body = `---
date: ${daysAgo(200)}
type: doc
priority: low
status: pending
applied-to: []
---

## 事象

ノートの中で status: pending という文字列に言及している。

    status: pending
`;
  const dir = makeProject({ "with-body-mention": body });
  try {
    run(dir, ["--auto"]);
    const after = readFileSync(join(dir, ".kaizen", "with-body-mention.md"), "utf8");
    // frontmatter の 1 行だけが変わる。本文の 2 箇所はそのまま。
    expect(after).toContain("status: forgotten\n");
    expect(after.match(/status: pending/g)).toHaveLength(2);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("frontmatter に status 行が無いノートは触らずスキップする", () => {
  // 書き換えると「忘却した」と「status を持たない旧形式」が区別できなくなる。
  const body = `---
date: ${daysAgo(200)}
priority: low
---

## 事象

本文。
`;
  const dir = makeProject({ legacy: body });
  try {
    const { stderr } = run(dir, ["--auto"]);
    expect(stderr).toContain("forgot 0 note(s)");
    expect(readFileSync(join(dir, ".kaizen", "legacy.md"), "utf8")).toBe(body);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// --- 設定（.kaizen/config） -------------------------------------------------
test("forget_auto=off で自動忘却を止める", () => {
  const dir = makeProject(CANDIDATES, "forget_auto=off\n");
  try {
    const { status, stderr } = run(dir, ["--auto"]);
    expect(status).toBe(0);
    expect(stderr).toContain("forget_auto=off");
    expect(statusOf(dir, "old-low")).toBe("pending");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("forget_after_days で閾値を変えられる", () => {
  const dir = makeProject({ "mid-low": note({ date: daysAgo(20) }) });
  try {
    // 既定 30 日では候補にならない（陰性コントロール。設定で動いたと言えるようにする）。
    expect(run(dir, ["--list"]).stdout.trim()).toBe("");
    writeFileSync(join(dir, ".kaizen", "config"), "forget_after_days = 10\n");
    expect(run(dir, ["--list"]).stdout).toContain(".kaizen/mid-low.md");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("forget_max_priority で対象の優先度を広げられる", () => {
  const dir = makeProject({ "old-high": note({ priority: "high" }) });
  try {
    // 既定 medium では high は候補にならない（陰性コントロール）。
    expect(run(dir, ["--list"]).stdout.trim()).toBe("");
    // high まで広げると high も対象に入る（境界の向きを固定する）。
    writeFileSync(join(dir, ".kaizen", "config"), "forget_max_priority = high\n");
    expect(run(dir, ["--list"]).stdout).toContain(".kaizen/old-high.md");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

const BAD_CONFIGS = [
  { name: "forget_auto", config: "forget_auto = yes\n", message: "forget_auto が不正です" },
  {
    name: "forget_after_days",
    config: "forget_after_days = soon\n",
    message: "forget_after_days が不正です",
  },
  {
    name: "forget_max_priority",
    config: "forget_max_priority = urgent\n",
    message: "forget_max_priority が不正です",
  },
];

test.each(BAD_CONFIGS)(
  "不正な設定値は既定へ倒し、倒したことを出す: $name",
  ({ config, message }) => {
    // 黙って倒すと「設定したつもりの閾値で動いている」と読めてしまう。
    const dir = makeProject(CANDIDATES, config);
    try {
      const { status, stderr } = run(dir, ["--auto"]);
      expect(stderr).toContain(message);
      expect(status).toBe(0);
      // 既定へ倒った結果、既定の閾値での判定は通常どおり行われる。
      expect(statusOf(dir, "old-low")).toBe("forgotten");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  },
);

// --- 明示指示 ---------------------------------------------------------------
test("明示指示は閾値に関わらず pending を忘却する", () => {
  const dir = makeProject({ "recent-high": note({ date: daysAgo(1), priority: "high" }) });
  try {
    const { status, stdout } = run(dir, [".kaizen/recent-high.md"]);
    expect(status).toBe(0);
    expect(stdout).toContain("recent-high.md");
    expect(statusOf(dir, "recent-high")).toBe("forgotten");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

const NON_PENDING = [
  {
    name: "applied",
    note: note({ status: "applied", appliedTo: '["a.md"]' }),
    expected: "applied",
  },
  {
    name: "rejected",
    note: note({ status: "rejected", appliedTo: '["rejected: 見送る"]' }),
    expected: "rejected",
  },
];

test.each(NON_PENDING)(
  "明示指示でも pending 以外は忘却しない: $name",
  ({ note: body, expected }) => {
    // forgotten は適用先を持たない状態なので、applied-to を持つノートを書き換えると
    // kaizen-status-check.sh が exit 2 で落ちる（コミット前ゲートが commit を止める）。
    const dir = makeProject({ target: body });
    try {
      const { status, stderr } = run(dir, [".kaizen/target.md"]);
      expect(stderr).toContain("use kaizen archive instead");
      expect(status).toBe(0);
      expect(statusOf(dir, "target")).toBe(expected);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  },
);

test("引数なしは usage を出して exit 2（既定で何かを忘れない）", () => {
  const dir = makeProject(CANDIDATES);
  try {
    const { status, stderr } = run(dir, []);
    expect(stderr).toContain("usage:");
    expect(status).toBe(2);
    expect(statusOf(dir, "old-low")).toBe("pending");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("--list / --auto にファイル引数を混ぜたら受け付けない", () => {
  // 受理すると「一覧するつもりが掃引していた」「指定したつもりが全件だった」が起きる。
  const dir = makeProject(CANDIDATES);
  try {
    for (const mode of ["--list", "--auto"]) {
      const { status, stderr } = run(dir, [mode, ".kaizen/old-low.md"]);
      expect(stderr).toContain("takes no file arguments");
      expect(status).toBe(2);
    }
    expect(statusOf(dir, "old-low")).toBe("pending");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("忘却したノートは kaizen-status-check.sh を通る", () => {
  // 自動で走る以上、掃引の結果がコミット前ゲートを止めてはならない。
  const statusCheck = join(repoRoot, "skills/kaizen/scripts/kaizen-status-check.sh");
  const dir = makeProject({ ...CANDIDATES, ...NON_CANDIDATES });
  try {
    run(dir, ["--auto"]);
    const result = spawnSync("bash", [statusCheck], {
      cwd: dir,
      env: { ...process.env, CLAUDE_PROJECT_DIR: dir },
      encoding: "utf8",
    });
    expect(result.stderr ?? "").not.toContain("unknown status");
    expect(result.status).toBe(0);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// --- レビューで新設した分岐（未知フラグ / 書き戻し失敗 / ライブラリ欠落） ---
//
// いずれも「何もしていないのに成功に見える」形なので、終了コードと診断の両方を固定する。
// 終了コードだけだと理由が分からず、診断だけだと呼び出し側（SessionStart フック・人）が
// 失敗を拾えない。
//
// 変異による検出能力の実証（3 通り実施し、いずれも赤くなることを実測した）:
//   1. `-*)` の分岐を削る → 「未知のフラグ」が fail（ファイル名として飲み込まれ exit 0 になる）
//   2. `rewrite_status` の `return 2` を `return 0` に → 「書き戻せないノート」が fail
//   3. `require_today_days` の `return 1` を `return 0` に → 「ライブラリ欠落」が fail
test("未知のフラグはファイル名として飲み込まず exit 2 で拒否する", () => {
  // 飲み込むと `--dry-run` のような打ち間違いが「skip (not a file)」＋ exit 0 になり、
  // 1 件も忘却していないのに成功として返る。
  const dir = makeProject(CANDIDATES);
  try {
    const { status, stderr } = run(dir, ["--dry-run"]);
    expect(stderr).toContain("unknown option: --dry-run");
    expect(stderr).toContain("usage:");
    expect(status).toBe(2);
    expect(statusOf(dir, "old-low")).toBe("pending");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("書き戻せないノートは忘却済みとして報告しない", () => {
  // `rewrite_status` は `if` から呼ばれるため関数本文で set -e が効かない。書き込み失敗を
  // 握り潰すと、status が pending のままなのに stdout へ忘却済みとして出る。
  const dir = makeProject(CANDIDATES);
  try {
    chmodSync(join(dir, ".kaizen", "old-low.md"), 0o444);
    const { status, stdout, stderr } = run(dir, ["--auto"]);
    expect(stderr).toContain("could not write the note");
    // 理由を「status 行が無い」と混同しない（書き込み権限の問題が旧形式と案内されると直せない）。
    expect(stderr).not.toContain("no status line");
    expect(stdout).not.toContain("old-low.md");
    expect(statusOf(dir, "old-low")).toBe("pending");
    // 書けない 1 件で SessionStart フックを落とさない（他の候補は処理される）。
    expect(statusOf(dir, "old-medium")).toBe("forgotten");
    expect(status).toBe(0);
  } finally {
    chmodSync(join(dir, ".kaizen", "old-low.md"), 0o644);
    rmSync(dir, { recursive: true, force: true });
  }
});

test.each(["--list", "--auto"])(
  "共通ライブラリを読めないときは 0 件と区別して止まる: %s",
  (mode) => {
    // 日付を日数へ変換できないと全件が「材料を読めない」で外れ、閾値で 0 件だったときと
    // 同じ出力になる。縮退したことを終了コードと診断で区別できるようにする。
    const dir = makeProject(CANDIDATES);
    const lonely = mkdtempSync(join(tmpdir(), "kaizen-forget-nolib-"));
    try {
      copyFileSync(script, join(lonely, "kaizen-forget.sh"));
      const result = spawnSync("bash", [join(lonely, "kaizen-forget.sh"), mode], {
        cwd: dir,
        env: { ...process.env, CLAUDE_PROJECT_DIR: dir },
        encoding: "utf8",
      });
      expect(result.stderr ?? "").toContain("共通ライブラリ kaizen-hook-common.sh");
      // 「忘却候補はありません」に倒さない（検査できなかったことが消える）。
      expect(result.stderr ?? "").not.toContain("忘却候補はありません");
      expect(result.status).toBe(1);
      expect(statusOf(dir, "old-low")).toBe("pending");
    } finally {
      rmSync(lonely, { recursive: true, force: true });
      rmSync(dir, { recursive: true, force: true });
    }
  },
);
