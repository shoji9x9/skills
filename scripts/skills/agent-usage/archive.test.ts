// 古い行を records/ の外へ移す archive と、移した境界（records/.archived-before）を collect と report が扱うことを確かめる。
//
// 入力の軸（runArchive）:
//   行の時刻         end がある／end が無く start だけ／どちらも無く observed_at だけ／どれも時刻でない（止める）。
//   境界との関係     前（移す）／ちょうど境界（残す）／後（残す）。
//   ファイル         すべての行を移す（消す）／一部を移す（書き直す）／移す行が無い（触らない）／見出しだけ。
//   行の形           知らない種類の行・知らない列（落とさずに移す）。
//   移した先         無い（作る）／同じ行が既にある（重ねない）。
//   境界のファイル   無い／前の境界と同じ（そのまま）／前の境界より前（止める）／中身が時刻でない（止める）。
//   --before・--out  暦に無い日付・今日より後・records/ の中（止める）。
// 入力の軸（collect・report）:
//   境界             無い／ある（境界より前に終わった行を、新しい clone でも書かない）。
//   --archive        渡さない（境界があれば案内を出す）／渡す（records/ と合わせて読む）／無いディレクトリ・空のディレクトリ（止める）。
//   recordWindowDays デフォルト（60 日）／短くした（その範囲より古いファイルを読まない）／範囲の外の値（止める）。

import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";
import { describe, expect, test } from "vitest";
import {
  archivedNote,
  readArchivedBefore,
  rowEndTime,
  runArchive,
} from "../../../skills/agent-usage/scripts/lib/archive.mjs";
import { parseRepoConfig } from "../../../skills/agent-usage/scripts/lib/config.mjs";
import { parseCsv, toCsv } from "../../../skills/agent-usage/scripts/lib/csv.mjs";
import { COLUMNS } from "../../../skills/agent-usage/scripts/lib/rows.mjs";
import { githubSince } from "../../../skills/agent-usage/scripts/lib/run-collect.mjs";
import { makeTempDirFactory } from "../../lib/testing/test-tmpdir.ts";
import { collectedOnBranch, recordDirs, repoConfigOf } from "./cli-helpers.ts";

const newTempDir = makeTempDirFactory("agent-usage-archive-");
const NOW = Date.parse("2026-10-03T00:00:00Z");
const DAY = 86400000;

type Row = Record<string, string>;

function row(key: string, times: Partial<Record<"start" | "end" | "observed_at", string>>): Row {
  return {
    key,
    kind: "run",
    observed_at: "2026-10-02T12:00:00.000Z",
    person: "p-0123abcd",
    ...times,
  };
}

/** records/ と、移した先（records/ の外）を作る。 */
function dirs() {
  const tmp = newTempDir("a-");
  const records = join(tmp, "records");
  mkdirSync(join(records, "p-0123abcd", "branches"), { recursive: true });
  return { tmp, records, out: join(tmp, "archive") };
}

function writeRecords(path: string, rows: readonly Row[], columns: readonly string[] = COLUMNS) {
  mkdirSync(join(path, ".."), { recursive: true });
  writeFileSync(path, toCsv(columns, rows));
}

function archive(o: { records: string; out: string }, before: string, dryRun = false) {
  return runArchive({ recordsDir: o.records, now: NOW, before, out: o.out, dryRun });
}

describe.concurrent("runArchive", () => {
  test("終わりの時刻が境界より前の行だけを、終わりの UTC の年月のファイルへ移し、境界を書く", () => {
    const d = dirs();
    const f = join(d.records, "p-0123abcd", "branches", "20260901T000000Z-feature-1.csv");
    const rows = [
      row("old-end", { start: "2026-08-31T23:00:00.000Z", end: "2026-09-01T01:00:00.000Z" }),
      row("old-aug", { start: "2026-08-20T00:00:00.000Z", end: "2026-08-20T01:00:00.000Z" }),
      // 始まりは境界より前でも、終わりが境界の後なら残す
      row("spans", { start: "2026-09-30T23:00:00.000Z", end: "2026-10-01T01:00:00.000Z" }),
      // ちょうど境界に終わる行は残す
      row("at", { start: "2026-09-30T23:00:00.000Z", end: "2026-10-01T00:00:00.000Z" }),
    ];
    writeRecords(f, rows);
    const r = archive(d, "2026-10-01");
    expect(r.movedRows).toBe(2);
    expect(r.rewritten).toEqual([f]);
    expect(r.removed).toEqual([]);
    expect(readFileSync(join(d.records, ".archived-before"), "utf8")).toBe(
      "2026-10-01T00:00:00.000Z\n",
    );
    expect(readArchivedBefore(d.records)).toBe(Date.parse("2026-10-01T00:00:00Z"));
    expect(readdirSync(d.out).sort()).toEqual(["2026-08.csv", "2026-09.csv"]);
    expect(parseCsv(readFileSync(join(d.out, "2026-09.csv"), "utf8")).map((x) => x.key)).toEqual([
      "old-end",
    ]);
    expect(parseCsv(readFileSync(join(d.out, "2026-08.csv"), "utf8")).map((x) => x.key)).toEqual([
      "old-aug",
    ]);
    // 残した行は、元の見出しのまま書き直す
    expect(readFileSync(f, "utf8")).toBe(toCsv(COLUMNS, rows.slice(2)));
  });

  test("end が無ければ start、それも無ければ observed_at で移すかを決め、どれも時刻でない行があれば何も書かずに止める", () => {
    expect(rowEndTime({ start: "2026-09-01T00:00:00Z", observed_at: "2026-10-02T00:00:00Z" })).toBe(
      Date.parse("2026-09-01T00:00:00Z"),
    );
    expect(rowEndTime({ observed_at: "2026-09-02T00:00:00Z" })).toBe(
      Date.parse("2026-09-02T00:00:00Z"),
    );
    const d = dirs();
    const f = join(d.records, "p-0123abcd", "branches", "20260901T000000Z-x.csv");
    writeRecords(f, [
      row("prompt", { start: "2026-09-10T00:00:00.000Z" }),
      row("observed", { observed_at: "2026-09-11T00:00:00.000Z" }),
      row("new-start", { start: "2026-10-02T00:00:00.000Z" }),
    ]);
    expect(archive(d, "2026-10-01").movedRows).toBe(2);
    expect(parseCsv(readFileSync(f, "utf8")).map((x) => x.key)).toEqual(["new-start"]);

    const bad = dirs();
    const g = join(bad.records, "p-0123abcd", "branches", "20260901T000000Z-x.csv");
    writeRecords(g, [
      row("old", { end: "2026-09-01T00:00:00.000Z" }),
      row("no-time", { observed_at: "x" }),
    ]);
    expect(() => archive(bad, "2026-10-01")).toThrow(
      /:3: end・start・observed_at のどれも時刻でない/,
    );
    expect(existsSync(join(bad.records, ".archived-before"))).toBe(false);
    expect(existsSync(bad.out)).toBe(false);
  });

  test("すべての行を移したファイルは消し、移す行の無いファイルと見出しだけのファイルは触らない", () => {
    const d = dirs();
    const gone = join(d.records, "_github", "p-0123abcd", "20260801T000000Z-a.csv");
    const keep = join(d.records, "p-0123abcd", "branches", "20261001T000000Z-b.csv");
    const empty = join(d.records, "p-0123abcd", "branches", "20261001T000000Z-c.csv");
    writeRecords(gone, [row("g", { end: "2026-08-01T00:00:00.000Z" })]);
    // CRLF のファイルも、移す行が無ければ書き直さない
    writeFileSync(
      keep,
      toCsv(COLUMNS, [row("k", { end: "2026-10-02T00:00:00.000Z" })]).replace(/\n/g, "\r\n"),
    );
    writeFileSync(empty, `${COLUMNS.join(",")}\n`);
    const before = { keep: readFileSync(keep, "utf8"), empty: readFileSync(empty, "utf8") };
    const r = archive(d, "2026-10-01");
    expect(r.removed).toEqual([gone]);
    expect(r.rewritten).toEqual([]);
    expect(existsSync(gone)).toBe(false);
    expect(readFileSync(keep, "utf8")).toBe(before.keep);
    expect(readFileSync(empty, "utf8")).toBe(before.empty);
  });

  test("知らない種類の行と知らない列の値を落とさずに移し、CRLF のファイルは CRLF のまま書き直す", () => {
    const d = dirs();
    const f = join(d.records, "p-0123abcd", "branches", "20260901T000000Z-x.csv");
    const columns = [...COLUMNS, "future_col"];
    const text = toCsv(columns, [
      {
        ...row("future", { end: "2026-09-01T00:00:00.000Z" }),
        kind: "future-kind",
        future_col: "v",
      },
      { ...row("stay", { end: "2026-10-02T00:00:00.000Z" }), future_col: "w" },
    ]).replace(/\n/g, "\r\n");
    writeFileSync(f, text);
    expect(archive(d, "2026-10-01").movedRows).toBe(1);
    const [moved] = parseCsv(readFileSync(join(d.out, "2026-09.csv"), "utf8"));
    expect(moved).toMatchObject({ key: "future", kind: "future-kind", future_col: "v" });
    const rest = readFileSync(f, "utf8");
    expect(rest.split("\r\n")[0]).toBe(columns.join(","));
    expect(parseCsv(rest)).toEqual([expect.objectContaining({ key: "stay", future_col: "w" })]);
    expect(rest.replace(/\r\n/g, "")).not.toMatch(/\n/);
  });

  test("移した先のファイルが既にあれば後ろに足し、全列が同じ行は重ねない（途中で止まった後に実行し直した場合）", () => {
    const d = dirs();
    const f = join(d.records, "p-0123abcd", "branches", "20260901T000000Z-x.csv");
    const a = row("a", { end: "2026-09-01T00:00:00.000Z" });
    const b = row("b", { end: "2026-09-02T00:00:00.000Z" });
    writeRecords(join(d.out, "2026-09.csv"), [a]);
    // a は移した先に書いた後、records/ を書き直す前に止まった行
    writeRecords(f, [a, b]);
    expect(archive(d, "2026-10-01").movedRows).toBe(2);
    expect(parseCsv(readFileSync(join(d.out, "2026-09.csv"), "utf8")).map((x) => x.key)).toEqual([
      "a",
      "b",
    ]);
    // 内容が違う同じ key の行（後で書き直した行）は、両方を残す（report が observed_at の新しい方を使う）
    writeRecords(f, [{ ...b, observed_at: "2026-10-02T13:00:00.000Z" }]);
    archive(d, "2026-10-01");
    expect(parseCsv(readFileSync(join(d.out, "2026-09.csv"), "utf8")).map((x) => x.key)).toEqual([
      "a",
      "b",
      "b",
    ]);
  });

  test("--dry-run は移す行を数えるだけで、境界・移した先・records/ のどれも書かない", () => {
    const d = dirs();
    const f = join(d.records, "p-0123abcd", "branches", "20260901T000000Z-x.csv");
    writeRecords(f, [row("a", { end: "2026-09-01T00:00:00.000Z" })]);
    const text = readFileSync(f, "utf8");
    const r = archive(d, "2026-10-01", true);
    expect(r).toMatchObject({ movedRows: 1, removed: [f], outFiles: [join(d.out, "2026-09.csv")] });
    expect(readFileSync(f, "utf8")).toBe(text);
    expect(existsSync(join(d.records, ".archived-before"))).toBe(false);
    expect(existsSync(d.out)).toBe(false);
  });

  test("境界は進めるか同じにだけでき、前より前の日付・暦に無い日付・今日より後の日付・records/ の中の --out は止める", () => {
    const d = dirs();
    archive(d, "2026-09-15");
    expect(archive(d, "2026-09-15").movedRows).toBe(0);
    expect(archive(d, "2026-10-01").previous).toBe(Date.parse("2026-09-15T00:00:00Z"));
    expect(() => archive(d, "2026-09-30")).toThrow(/境界は戻せない/);
    expect(() => archive(d, "2026-02-30")).toThrow(/暦に在る日付/);
    expect(() => archive(d, "2026/10/01")).toThrow(/暦に在る日付/);
    // 今日（NOW の日）の 0 時は今より前なので書ける。明日は書けない
    expect(() => archive(d, "2026-10-04")).toThrow(/今日より後/);
    expect(archive(d, "2026-10-03").boundary).toBe(NOW);
    for (const out of [d.records, join(d.records, "old")])
      expect(() =>
        runArchive({ recordsDir: d.records, now: NOW, before: "2026-10-03", out, dryRun: true }),
      ).toThrow(/records\/ の中/);
    // records と名前の前方が同じだけのディレクトリは外である
    expect(
      runArchive({
        recordsDir: d.records,
        now: NOW,
        before: "2026-10-03",
        out: `${d.records}-old`,
        dryRun: true,
      }).movedRows,
    ).toBe(0);
  });

  test("records/ を含むディレクトリ（records/ の親）の --out は止める", () => {
    const d = dirs();
    for (const out of [dirname(d.records), dirname(dirname(d.records))])
      expect(() =>
        runArchive({ recordsDir: d.records, now: NOW, before: "2026-10-03", out, dryRun: true }),
      ).toThrow(/records\/ を含むディレクトリ/);
  });

  test("シンボリックリンクを通して records/ と重なる --out も、実体のパスで比べて止める", () => {
    const d = dirs();
    const toRecords = join(d.tmp, "link-to-records");
    const toParent = join(d.tmp, "link-to-parent");
    symlinkSync(d.records, toRecords);
    symlinkSync(d.tmp, toParent);
    // records/ を指すリンク・その下のまだ無いディレクトリ・records/ の親を指すリンク
    for (const out of [toRecords, join(toRecords, "old", "x"), join(toParent, "records")])
      expect(() =>
        runArchive({ recordsDir: d.records, now: NOW, before: "2026-10-03", out, dryRun: true }),
      ).toThrow(/records\/ の中/);
    expect(() =>
      runArchive({
        recordsDir: d.records,
        now: NOW,
        before: "2026-10-03",
        out: toParent,
        dryRun: true,
      }),
    ).toThrow(/records\/ を含むディレクトリ/);
    // records/ と重ならない場所を指すリンクは書ける
    mkdirSync(join(d.tmp, "elsewhere"));
    symlinkSync(join(d.tmp, "elsewhere"), join(d.tmp, "link-to-elsewhere"));
    expect(
      runArchive({
        recordsDir: d.records,
        now: NOW,
        before: "2026-10-03",
        out: join(d.tmp, "link-to-elsewhere"),
        dryRun: true,
      }).movedRows,
    ).toBe(0);
  });

  test("境界のファイルの中身が時刻でなければ、境界が無いとして扱わずに止める", () => {
    const d = dirs();
    expect(readArchivedBefore(d.records)).toBe(null);
    for (const text of ["", "2026-10-01", "2026-10-01T00:00:00+09:00", "not a time"]) {
      writeFileSync(join(d.records, ".archived-before"), text);
      expect(() => readArchivedBefore(d.records)).toThrow(/移した境界の時刻/);
      expect(() => archive(d, "2026-10-01")).toThrow(/移した境界の時刻/);
    }
    writeFileSync(join(d.records, ".archived-before"), "2026-10-01T00:00:00Z\r\n");
    expect(readArchivedBefore(d.records)).toBe(Date.parse("2026-10-01T00:00:00Z"));
  });
});

describe("parseRepoConfig の recordWindowDays", () => {
  test("1〜60 の整数だけを受け付け、省くと 60 にする", () => {
    expect(parseRepoConfig({}).recordWindowDays).toBe(60);
    for (const v of [1, 7, 60])
      expect(parseRepoConfig({ recordWindowDays: v }).recordWindowDays).toBe(v);
    for (const v of [0, 61, 1.5, "7", null])
      expect(() => parseRepoConfig({ recordWindowDays: v }), JSON.stringify(v)).toThrow(
        /recordWindowDays/,
      );
  });
});

describe("archivedNote", () => {
  test("境界があり --archive を渡していないときだけ、案内を返す", () => {
    expect(archivedNote(null, 0)).toBe("");
    expect(archivedNote(NOW, 1)).toBe("");
    expect(archivedNote(NOW, 0)).toMatch(
      /2026-10-03T00:00:00.000Z より前に終わった行は records\/ に無い/,
    );
  });
});

describe("githubSince", () => {
  const base = { existing: new Map(), localRows: [], now: NOW, person: "p-0123abcd" };
  const coverage = (end: string) =>
    new Map([["c", { key: "c", kind: "coverage", detail: "ok", person: "p-0123abcd", end }]]);

  test("取り始める時刻は、範囲（lookbackMs）と移した境界の遅い方より前に戻らない", () => {
    const localRows = [{ start: "2026-06-01T00:00:00.000Z" }];
    expect(githubSince({ ...base, localRows, lookbackMs: 60 * DAY, archivedBefore: null })).toBe(
      NOW - 60 * DAY,
    );
    expect(githubSince({ ...base, localRows, lookbackMs: 7 * DAY, archivedBefore: null })).toBe(
      NOW - 7 * DAY,
    );
    const archivedBefore = NOW - 2 * DAY;
    expect(githubSince({ ...base, localRows, lookbackMs: 60 * DAY, archivedBefore })).toBe(
      archivedBefore,
    );
    // 前回の取得の終わりの 1 日前が下限より後なら、そこから取る
    const existing = coverage("2026-10-02T12:00:00.000Z");
    expect(githubSince({ ...base, existing, lookbackMs: 60 * DAY, archivedBefore })).toBe(
      Date.parse("2026-10-01T12:00:00Z"),
    );
  });
});

describe.concurrent("archive・collect・report のコマンド", () => {
  /** 記録した後、日付を進めて境界より前に移せるようにした状態。report は同じ時刻で比べる。 */
  async function archivedSetup() {
    const s = await collectedOnBranch();
    // 人の commit の行（activity）の時刻は、使い捨てのリポジトリで commit した実際の時刻なので、日付を決められない。
    // 境界より前に移せる行だけにするため、その行を除く（ログから作る行の日付は setup が決める）
    const [name] = readdirSync(s.branches);
    const file = join(s.branches, name ?? "");
    const rows = parseCsv(readFileSync(file, "utf8"));
    expect(rows.some((r) => r.kind === "activity")).toBe(true);
    writeFileSync(
      file,
      toCsv(
        COLUMNS,
        rows.filter((r) => r.kind !== "activity"),
      ),
    );
    const later = { AGENT_USAGE_NOW: "2026-10-03T00:00:00Z" };
    const report = async (...args: string[]) => {
      const out = join(s.tmp, `report-${Math.random().toString(36).slice(2)}`);
      const r = await s.cliWith(later, "report", "--out", out, ...args);
      return { r, usage: r.status === 0 ? readFileSync(join(out, "usage.csv"), "utf8") : "" };
    };
    const archive = (before: string, out: string, ...extra: string[]) =>
      s.cliWith(later, "archive", "--before", before, "--out", out, ...extra);
    return { ...s, later, report, archive, archiveDir: join(s.tmp, "moved") };
  }

  test("archive で移した行を、新しい clone の collect は書き直さず、report は --archive を渡すと同じ集計を出す", async () => {
    const s = await archivedSetup();
    const baseline = await s.report();
    expect(baseline.r.status).toBe(0);
    expect(baseline.usage).toMatch(/claude-opus-5-5/);

    const dry = await s.archive("2026-10-02", s.archiveDir, "--dry-run");
    expect(dry.status).toBe(0);
    expect(dry.stdout).toMatch(/移す（--dry-run なので何も書いていない）行: [1-9]/);
    expect(existsSync(s.archiveDir)).toBe(false);

    const moved = await s.archive("2026-10-02", s.archiveDir);
    expect(moved.status, moved.stderr).toBe(0);
    expect(moved.stdout).toMatch(
      /境界: 2026-10-02T00:00:00.000Z（前の境界: 無し） \/ 移した行: [1-9]/,
    );
    expect(readdirSync(s.archiveDir)).toEqual(["2026-10.csv"]);
    expect(readdirSync(s.branches)).toEqual([]);

    // 新しい clone と同じく、この clone で最後に collect した時刻を消す（記録をすべて読み、ログの行をすべて書こうとする）
    rmSync(join(s.repo, ".git", "agent-usage", "last-collect.json"));
    const again = await s.cliWith(s.later, "collect");
    expect(again.status, again.stderr).toBe(0);
    expect(again.stdout).toMatch(
      /移した境界（2026-10-02T00:00:00.000Z）より前に終わったので書かなかった行: [1-9]/,
    );
    // 書くのは、境界より後の人の commit の行（準備で除いた行）だけで、ログから作る行は書き直さない
    const written = readdirSync(s.branches).flatMap((n) =>
      parseCsv(readFileSync(join(s.branches, n), "utf8")).map((r) => r.kind),
    );
    expect([...new Set(written)]).toEqual(["activity"]);
    rmSync(s.branches, { recursive: true });

    // records/ に CSV が無いので、--archive を渡さなければ止まる
    expect((await s.report()).r.status).toBe(1);
    const withArchive = await s.report("--archive", s.archiveDir);
    expect(withArchive.r.status, withArchive.r.stderr).toBe(0);
    expect(withArchive.r.stdout).not.toMatch(/注意: /);
    expect(withArchive.usage).toBe(baseline.usage);
  });

  test("一部を移した後、--archive を渡さない report は records/ に無い期間を案内し、--archive は繰り返し渡せる", async () => {
    const s = await archivedSetup();
    const [name] = readdirSync(s.branches);
    const text = readFileSync(join(s.branches, name ?? ""), "utf8");
    // 同じ行を、key と時刻を変えて 9 月の行として別のファイルにも置く（9 月の分だけが境界より前）
    const old = text.replaceAll("2026-10-01", "2026-09-01").replaceAll(":s1:", ":s9:");
    writeFileSync(join(s.records, s.person, "branches", "20260901T000000Z-feature-4-old.csv"), old);
    const baseline = await s.report();
    expect((await s.archive("2026-09-15", join(s.archiveDir, "a"))).status).toBe(0);
    expect(readdirSync(s.branches)).toEqual([name]);
    const without = await s.report();
    expect(without.r.status).toBe(0);
    expect(without.r.stdout).toMatch(
      /注意: records\/.archived-before があり、2026-09-15T00:00:00.000Z より前に終わった行は records\/ に無い/,
    );
    expect(without.usage).not.toBe(baseline.usage);
    // 9 月の分を 2 つのディレクトリに分けて渡しても、重複は key で除くので同じ集計になる
    const copy = join(s.archiveDir, "b");
    mkdirSync(copy);
    writeFileSync(
      join(copy, "2026-09.csv"),
      readFileSync(join(s.archiveDir, "a", "2026-09.csv"), "utf8"),
    );
    const both = await s.report("--archive", join(s.archiveDir, "a"), "--archive", copy);
    expect(both.r.status, both.r.stderr).toBe(0);
    expect(both.usage).toBe(baseline.usage);
  });

  test("境界より前の行が records/ に残っていても、collect はその行を打ち消さない（境界が無ければ打ち消す）", async () => {
    const s = await collectedOnBranch();
    const [name] = readdirSync(s.branches);
    const file = join(s.branches, name ?? "");
    const rows = parseCsv(readFileSync(file, "utf8"));
    const prompt = rows.find((r) => r.kind === "prompt");
    expect(prompt, "collect が指示の行を書いていない").toBeDefined();
    // 同じセッションの、ログからはもう作らない古い指示の行（archive が途中で止まって残った行にあたる）
    const old = "2026-09-01T00:00:00.000Z";
    const stale = { ...prompt, key: `prompt:claude-code:s1:${old}`, start: old, end: old };
    writeFileSync(file, toCsv(COLUMNS, [...rows, stale]));
    const retractedKeys = () =>
      parseCsv(readFileSync(file, "utf8"))
        .filter((r) => r.retracted === "1")
        .map((r) => r.key);
    writeFileSync(join(s.records, ".archived-before"), "2026-09-15T00:00:00.000Z\n");
    const kept = await s.cli("collect");
    expect(kept.status, kept.stderr).toBe(0);
    expect(retractedKeys()).toEqual([]);
    expect(kept.stdout).toMatch(/より前に終わったので書かなかった行: 1/);
    // 境界が無ければ、同じ行を打ち消す（上の状態が打ち消しの分岐に届いていることの確認）
    rmSync(join(s.records, ".archived-before"));
    expect((await s.cli("collect")).status).toBe(0);
    expect(retractedKeys()).toEqual([stale.key]);
  });

  test("archive と report --archive の引数の誤りと、読めない境界を止める", async () => {
    const s = await archivedSetup();
    expect((await s.cliWith(s.later, "archive", "--out", s.archiveDir)).status).toBe(2);
    expect((await s.cliWith(s.later, "archive", "--before", "2026-10-02")).status).toBe(2);
    const missing = await s.report("--archive", join(s.tmp, "none"));
    expect(missing.r.status).toBe(1);
    expect(missing.r.stderr).toMatch(/--archive のディレクトリが無い/);
    mkdirSync(join(s.tmp, "empty"));
    expect((await s.report("--archive", join(s.tmp, "empty"))).r.stderr).toMatch(
      /記録（\*\.csv）が無い/,
    );
    writeFileSync(join(s.records, ".archived-before"), "2026-10-02\n");
    const collect = await s.cliWith(s.later, "collect");
    expect(collect.status).toBe(1);
    expect(collect.stderr).toMatch(/移した境界の時刻/);
    expect((await s.report()).r.status).toBe(1);
  });

  test("recordWindowDays を短くすると、その範囲より古いファイルを読まず、範囲の外の値は止める", async () => {
    const s = await collectedOnBranch();
    const [name] = readdirSync(s.branches);
    const text = readFileSync(join(s.branches, name ?? ""), "utf8");
    rmSync(s.branches, { recursive: true });
    // 16 日前に書いた古い形のファイル（60 日の範囲の中、7 日の範囲の外）
    writeFileSync(
      join(s.records, s.person, "20260915T000000Z-5.csv"),
      text.replaceAll("2026-10-01T12:00:00.000Z", "2026-09-15T00:00:00.000Z"),
    );
    const wide = await s.cli("collect");
    expect(wide.stdout).not.toMatch(/範囲より古いので読まなかった記録のファイル/);
    expect(existsSync(s.branches)).toBe(false);
    const config = repoConfigOf(s.repo);
    writeFileSync(config, JSON.stringify({ recordWindowDays: 7 }));
    const narrow = await s.cli("collect");
    expect(narrow.status, narrow.stderr).toBe(0);
    expect(narrow.stdout).toMatch(/範囲より古いので読まなかった記録のファイル: 1/);
    expect(recordDirs(s.repo).person).toBe(s.person);
    // 範囲の外の値の種類ごとの扱いは parseRepoConfig のテストで確かめる。ここでは collect が止まることだけを見る
    writeFileSync(config, JSON.stringify({ recordWindowDays: 61 }));
    const bad = await s.cli("collect");
    expect(bad.status).toBe(1);
    expect(bad.stderr).toMatch(/recordWindowDays/);
  });
});
