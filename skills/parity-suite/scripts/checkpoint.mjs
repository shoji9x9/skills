// parity-suite の実行フローの区切り（成果物で引き継げる境目）を記録し、再開の前に照合する（正本）。
// 正本は parity-suite にあり、スキルディレクトリ内から直接実行する（プロジェクトへコピーしない）。
//
// なぜ要るか（Issue #468）: 実行フロー 1〜9 を 1 つの文脈で最後まで回すと、読んだ参照・書いた成果物が
// 文脈に積まれ続け、費用がターン数の 2 乗で増える。区切りで止めて新しい文脈から再開するには、
// 「どこまで済んだか」と「止めた後に成果物が動いていないか」を成果物の側で確かめられなければならない。
// 文脈の記憶で「手順 6 まで済んだ」と判断すると、途中まで進んだ採り直しや手で直した表を済んだものとして引き継ぐ。
//
// 何をするか:
//   record --at <区切り>: 区切りに達した時点の成果物（slug のディレクトリと --include のパス）の指紋を
//     .replace/parity/<slug>/checkpoints.json へ残す。前の区切りが記録済みでなければ止める（順に進める）
//   verify --at <区切り>: 最後に記録した区切りがそれであること、記録後に成果物が足し引き・書き換えされていないことを確かめる
//
// 区切りの語彙と順序: authored（手順 5 の後）→ captured（手順 6 の後）→ gated（手順 7 の後）。
//   前の区切りに戻って記録し直すと、それより後の区切りの記録は消える（採り直した成果物の上に古い記録を残さない）。
//
// 指紋から外すもの（区切りの後に正規に変わるもの）: checkpoints.json 自身、pending-decisions.json（利用者の回答が区切りの間に入る）、
//   noise-pass2/（基準値を記録したら消す一時物）、new/（parity-replace / parity-diff の新側の成果物）。
//
// fail-closed: 指紋の対象が 0 件・--include が存在しない・区切りの順序違反・記録の型崩れは合格に倒さない。
// 終了コード: 0 ＝ 記録した・照合が通った、1 ＝ 照合の不一致（再開してはいけない）、2 ＝ 使い方の誤り・記録の不備。
//
// 決定論的: 指紋にも出力にも時刻を入れない。TypeScript 構文は使わない（型は JSDoc）。

import { createHash } from "node:crypto";
import {
  existsSync,
  readdirSync,
  readFileSync,
  realpathSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * ツールのバージョン（正本）。指紋の取り方・記録の形を変えたら上げる。版が違う記録は verify で落ちる。
 * @type {string}
 */
export const VERSION = "1";

/** 区切りの語彙（順序付き）と、区切りの次に進む手順の番号。 */
export const CHECKPOINTS = [
  { at: "authored", next_step: 6 },
  { at: "captured", next_step: 7 },
  { at: "gated", next_step: 8 },
];

/** 記録ファイル名（slug のディレクトリ直下）。 */
const RECORD_NAME = "checkpoints.json";

/** slug のディレクトリ直下で指紋から外す名前（区切りの後に正規に変わるもの）。 */
const EXCLUDED_IN_DIR = new Set([RECORD_NAME, "pending-decisions.json", "noise-pass2", "new"]);

/** どこでも辿らないディレクトリ名。 */
const SKIP_DIRS = new Set([".git", "node_modules"]);

class UsageError extends Error {}

/**
 * @param {unknown} v
 * @returns {v is Record<string, unknown>}
 */
function isPlainObject(v) {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/**
 * パスを cwd 基準の / 区切りの相対パスにする（記録を別の環境で読んでも同じ文字列になるように）。
 * @param {string} cwd
 * @param {string} p
 */
function toRel(cwd, p) {
  const rel = relative(cwd, resolve(cwd, p));
  return rel === "" ? "." : rel.split(sep).join("/");
}

/**
 * 根の下のファイルの指紋を集める。
 * @param {string} cwd
 * @param {string[]} roots - cwd 基準の相対パス（先頭は slug のディレクトリ）
 * @param {string} slugDir - cwd 基準の相対パス
 * @param {{ allowMissing?: boolean }} [opts] - verify では記録後に消えた根を「その下のファイルが全て削除された」として数える
 *   （使い方の誤り〈exit 2〉に倒すと、成果物の不一致〈exit 1〉と区別できなくなる）
 * @returns {Record<string, string>} 相対パス → sha256
 */
export function fingerprintFiles(cwd, roots, slugDir, opts = {}) {
  /** @type {Record<string, string>} */
  const files = {};
  const slugAbs = resolve(cwd, slugDir);
  const visit = (abs) => {
    const st = statSync(abs);
    if (st.isDirectory()) {
      for (const name of readdirSync(abs).sort()) {
        if (SKIP_DIRS.has(name)) continue;
        if (abs === slugAbs && EXCLUDED_IN_DIR.has(name)) continue;
        visit(join(abs, name));
      }
    } else if (st.isFile()) {
      const rel = toRel(cwd, abs);
      files[rel] = createHash("sha256").update(readFileSync(abs)).digest("hex");
    }
  };
  for (const r of roots) {
    const abs = resolve(cwd, r);
    if (!existsSync(abs)) {
      if (opts.allowMissing) continue;
      throw new UsageError(`指紋の対象が存在しない: ${r}`);
    }
    visit(abs);
  }
  return files;
}

/**
 * 記録ファイルを読む。無ければ空の記録を返す。
 * @param {string} path
 * @returns {{ tool: string, version: string, checkpoints: Record<string, unknown>[] }}
 */
function readRecord(path) {
  if (!existsSync(path)) return { tool: "checkpoint", version: VERSION, checkpoints: [] };
  let rec;
  try {
    rec = JSON.parse(readFileSync(path, "utf8"));
  } catch (e) {
    throw new UsageError(`${RECORD_NAME} を読めない（${e instanceof Error ? e.message : e}）`);
  }
  if (!isPlainObject(rec) || !Array.isArray(rec.checkpoints)) {
    throw new UsageError(`${RECORD_NAME} の形が崩れている（checkpoints が配列でない）`);
  }
  if (rec.version !== VERSION) {
    throw new UsageError(
      `${RECORD_NAME} の version（${String(rec.version)}）が ${VERSION} でない（区切りを記録し直す）`,
    );
  }
  for (const c of rec.checkpoints) {
    if (
      !isPlainObject(c) ||
      !CHECKPOINTS.some((k) => k.at === c.at) ||
      !Array.isArray(c.roots) ||
      !isPlainObject(c.files)
    ) {
      throw new UsageError(`${RECORD_NAME} の区切りの記録の形が崩れている`);
    }
    // 対象 0 件の記録は照合しても空同士で一致し、何も確かめないまま再開を通す（record も 0 件を拒否する）
    if (
      c.roots.length === 0 ||
      !c.roots.every((r) => typeof r === "string" && r !== "") ||
      Object.keys(c.files).length === 0 ||
      !Object.values(c.files).every((h) => typeof h === "string" && /^[0-9a-f]{64}$/.test(h))
    ) {
      throw new UsageError(
        `${RECORD_NAME} の区切り ${String(c.at)} の roots / files が空・型崩れ（指紋の対象が無い記録では照合できない）`,
      );
    }
  }
  // record が作る形だけを受ける: 区切りは語彙の順の先頭から欠けずに並び、各区切りはスイートの根（2 つ目以降）を持ち、
  // 前の区切りの根を引き継ぐ。前段を欠いた記録（手で直した・壊れた）を通すと、前段の成果物を確かめないまま再開する
  for (const [i, c] of rec.checkpoints.entries()) {
    if (c.at !== CHECKPOINTS[i]?.at || c.next_step !== CHECKPOINTS[i]?.next_step) {
      throw new UsageError(
        `${RECORD_NAME} の区切りが ${CHECKPOINTS.map((k) => k.at).join(" → ")} の順の先頭から並んでいない、または next_step が定義と違う（${i + 1} 番目が ${String(c.at)}）`,
      );
    }
    const roots = /** @type {string[]} */ (c.roots);
    if (roots.length < 2) {
      throw new UsageError(
        `${RECORD_NAME} の区切り ${String(c.at)} にスイートの根が無い（authored の --include が記録されていない）`,
      );
    }
    const prev = i > 0 ? /** @type {string[]} */ (rec.checkpoints[i - 1].roots) : null;
    if (prev && (roots[0] !== prev[0] || !prev.every((r) => roots.includes(r)))) {
      throw new UsageError(
        `${RECORD_NAME} の区切り ${String(c.at)} の roots が前の区切りの roots を引き継いでいない`,
      );
    }
  }
  return /** @type {{ tool: string, version: string, checkpoints: Record<string, unknown>[] }} */ (
    rec
  );
}

/**
 * @param {string[]} argv - process.argv.slice(2)
 * @param {{ cwd?: string }} [deps]
 * @returns {number}
 */
export function main(argv, deps = {}) {
  const cwd = deps.cwd ?? process.cwd();
  const vocab = CHECKPOINTS.map((c) => c.at).join(" | ");
  const usage = [
    `usage: checkpoint.mjs record --dir .replace/parity/<slug> --at <${vocab}> [--include <パス>]...`,
    `       checkpoint.mjs verify --dir .replace/parity/<slug> --at <${vocab}>`,
    "  cwd は対象プロジェクトのルート（record と verify で同じにする）",
  ].join("\n");
  const [command, ...rest] = argv;
  if (command !== "record" && command !== "verify") {
    process.stderr.write(`error: サブコマンドが無い・不明: ${command ?? ""}\n${usage}\n`);
    return 2;
  }
  let dir = null;
  let at = null;
  /** @type {string[]} */
  const includes = [];
  for (let i = 0; i < rest.length; i += 1) {
    const a = rest[i];
    const v = rest[i + 1];
    if (a !== "--dir" && a !== "--at" && a !== "--include") {
      process.stderr.write(`error: 不明な引数 ${a}\n${usage}\n`);
      return 2;
    }
    if (v === undefined || v === "" || v.startsWith("--")) {
      process.stderr.write(`error: ${a} に値が無い\n${usage}\n`);
      return 2;
    }
    // --include 以外を重ねると後勝ちで黙って別の区切り・別の slug を扱うので止める
    if ((a === "--dir" && dir !== null) || (a === "--at" && at !== null)) {
      process.stderr.write(`error: ${a} が重複している\n${usage}\n`);
      return 2;
    }
    if (a === "--dir") dir = v;
    else if (a === "--at") at = v;
    else includes.push(v);
    i += 1;
  }
  try {
    if (dir === null || at === null) throw new UsageError("--dir と --at が要る");
    const pos = CHECKPOINTS.findIndex((c) => c.at === at);
    if (pos < 0) throw new UsageError(`--at が語彙（${vocab}）に無い: ${at}`);
    if (command === "verify" && includes.length > 0) {
      throw new UsageError("verify に --include は渡さない（記録した根をそのまま使う）");
    }
    const slugDir = toRel(cwd, dir);
    const slugAbs = resolve(cwd, slugDir);
    if (!existsSync(slugAbs) || !statSync(slugAbs).isDirectory()) {
      throw new UsageError(`--dir がディレクトリでない: ${dir}`);
    }
    const recordPath = join(slugAbs, RECORD_NAME);
    const record = readRecord(recordPath);

    if (command === "verify") {
      const last = record.checkpoints[record.checkpoints.length - 1];
      if (last === undefined) {
        process.stderr.write(`error: 区切りが 1 つも記録されていない（${at} から再開できない）\n`);
        return 1;
      }
      if (last.at !== at) {
        process.stderr.write(
          `error: 最後に記録した区切りは ${String(last.at)}（${at} ではない）。${String(last.at)} から再開するか、${at} までの手順をやり直す\n`,
        );
        return 1;
      }
      // 根の先頭は slug のディレクトリ（record がそう書く）。別の場所を指す記録では、この slug の成果物を照合していない
      if (/** @type {string[]} */ (last.roots)[0] !== slugDir) {
        throw new UsageError(
          `${RECORD_NAME} の roots の先頭（${String(/** @type {string[]} */ (last.roots)[0])}）が --dir（${slugDir}）でない`,
        );
      }
      const recorded = /** @type {Record<string, string>} */ (last.files);
      // gated は strength.md（強度ゲートの結果）を持つ時点でしか記録されない。持たない記録から手順 8 を始めさせない
      if (at === "gated" && !Object.hasOwn(recorded, `${slugDir}/strength.md`)) {
        throw new UsageError(`${RECORD_NAME} の gated の指紋に strength.md が無い`);
      }
      const now = fingerprintFiles(cwd, /** @type {string[]} */ (last.roots), slugDir, {
        allowMissing: true,
      });
      const added = Object.keys(now).filter((f) => !Object.hasOwn(recorded, f));
      const removed = Object.keys(recorded).filter((f) => !Object.hasOwn(now, f));
      const changed = Object.keys(now).filter(
        (f) => Object.hasOwn(recorded, f) && recorded[f] !== now[f],
      );
      const ok = added.length + removed.length + changed.length === 0;
      process.stdout.write(
        `${JSON.stringify({ tool: "checkpoint", version: VERSION, at, ok, next_step: last.next_step, files: Object.keys(now).length, added, removed, changed }, null, 2)}\n`,
      );
      if (!ok) {
        process.stderr.write(
          `error: ${at} を記録した後に成果物が変わっている（追加 ${added.length}・削除 ${removed.length}・変更 ${changed.length}）。` +
            "区切りの後の手順が途中まで進んだか、手で直した。どこまで済んだかを成果物から決められないので、区切りの次の手順をやり直してから record し直す\n",
        );
        return 1;
      }
      return 0;
    }

    // record
    /** @type {string[]} */
    let inherited = [];
    if (pos > 0) {
      const prevAt = CHECKPOINTS[pos - 1].at;
      const prevIndex = record.checkpoints.findIndex((c) => c.at === prevAt);
      if (prevIndex < 0) {
        throw new UsageError(`前の区切り ${prevAt} が記録されていない（区切りは順に記録する）`);
      }
      record.checkpoints = record.checkpoints.slice(0, prevIndex + 1);
      inherited = /** @type {string[]} */ (record.checkpoints[prevIndex].roots).slice(1);
    } else {
      record.checkpoints = [];
    }
    for (const inc of includes) {
      const rel = toRel(cwd, inc);
      const abs = resolve(cwd, rel);
      if (!existsSync(abs)) throw new UsageError(`--include が存在しない: ${inc}`);
      const fromSlug = relative(slugAbs, abs);
      if (fromSlug === "" || !(fromSlug === ".." || fromSlug.startsWith(`..${sep}`))) {
        throw new UsageError(`--include が --dir の中を指す（既に指紋の対象）: ${inc}`);
      }
      if (!inherited.includes(rel)) inherited.push(rel);
    }
    // スイートは authored の主な成果物。slug のディレクトリだけの指紋では、スイートを書き換えた再開を見逃す
    if (pos === 0 && inherited.length === 0) {
      throw new UsageError(
        "authored には --include でスイートの置き場所（<parity_suite_dir>/parity/ 等）を渡す",
      );
    }
    // gated の結果は手順 7 の中で strength.md に書く。書いていなければ、新しい文脈から手順 8 へ進んでも強度ゲートの結果が無い
    if (at === "gated" && !existsSync(join(slugAbs, "strength.md"))) {
      throw new UsageError("gated の前に strength.md（故障カタログと結果）を書く");
    }
    const roots = [slugDir, ...inherited];
    const files = fingerprintFiles(cwd, roots, slugDir);
    if (Object.keys(files).length === 0) {
      throw new UsageError("指紋の対象ファイルが 0 件（区切りに達した成果物が無い）");
    }
    // スイートの根（--include）が空なら、区切りの主な成果物が消えている（削除だけで進んだように見せない）
    const emptyRoots = inherited.filter(
      (r) => !Object.keys(files).some((f) => f === r || f.startsWith(`${r}/`)),
    );
    if (emptyRoots.length > 0) {
      throw new UsageError(`--include の根にファイルが無い: ${emptyRoots.join(", ")}`);
    }
    // 前の区切りから成果物が足されも書き換えられもしていないなら、その間の手順は何も作っていない（採取・強度ゲートを飛ばした記録になる）。
    // 削除だけは進んだ証拠にしない——前段の成果物が消えただけでも指紋は変わる
    if (pos > 0) {
      const prevFiles = /** @type {Record<string, string>} */ (
        record.checkpoints[record.checkpoints.length - 1].files
      );
      const moved = Object.keys(files).some((f) => prevFiles[f] !== files[f]);
      if (!moved) {
        throw new UsageError(
          `前の区切り ${CHECKPOINTS[pos - 1].at} から成果物が 1 つも変わっていない（手順 ${CHECKPOINTS[pos - 1].next_step} の成果物が無いまま ${at} を記録しない）`,
        );
      }
    }
    const entry = { at, next_step: CHECKPOINTS[pos].next_step, roots, files };
    record.checkpoints.push(entry);
    writeFileSync(
      recordPath,
      `${JSON.stringify({ tool: "checkpoint", version: VERSION, checkpoints: record.checkpoints }, null, 2)}\n`,
    );
    process.stdout.write(
      `${JSON.stringify({ tool: "checkpoint", version: VERSION, at, recorded: true, next_step: entry.next_step, roots, files: Object.keys(files).length })}\n`,
    );
    return 0;
  } catch (e) {
    process.stderr.write(`error: ${e instanceof Error ? e.message : e}\n${usage}\n`);
    return 2;
  }
}

// CLI エントリ判定は両辺を実パスに解決してから突き合わせる（シンボリックリンク経由の起動でサイレント no-op にしない）。
const invokedAsCli = (() => {
  const entry = process.argv[1];
  if (!entry) return false;
  const self = fileURLToPath(import.meta.url);
  try {
    return realpathSync(entry) === realpathSync(self);
  } catch {
    return entry === self;
  }
})();

if (invokedAsCli) {
  process.exit(main(process.argv.slice(2)));
}
