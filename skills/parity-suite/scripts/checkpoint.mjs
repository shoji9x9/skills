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
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
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
 * 実在する最も深い祖先まで `realpathSync` で解いてから、残りの区間を継ぎ足して実パスを組む。
 * verify では記録後に消えた根も数えるため、存在しないパスでも実パスで包含を判定できるようにする。
 * ENOENT 以外（ELOOP・EACCES 等）は「解けなかった」であって「外にある」ではないので null を返す（fail-closed）。
 * @param {string} p - 絶対パス
 * @returns {string | null}
 */
function realPathOf(p) {
  let current = resolve(p);
  /** @type {string[]} */
  const tail = [];
  for (;;) {
    try {
      const real = realpathSync(current);
      return tail.length === 0 ? real : join(real, ...tail);
    } catch (e) {
      if (/** @type {NodeJS.ErrnoException} */ (e).code !== "ENOENT") return null;
    }
    const parent = dirname(current);
    if (parent === current) return null;
    tail.unshift(basename(current));
    current = parent;
  }
}

/**
 * 実パス a が実パス b の中（b 自身を含む）にあるか。
 * @param {string} a
 * @param {string} b
 */
function realUnder(a, b) {
  const rel = relative(b, a);
  return rel === "" || !(rel === ".." || rel.startsWith(`..${sep}`) || isAbsolute(rel));
}

/**
 * スイートの根を実パスで確かめ、最初に見つけた問題を返す（無ければ null）。
 *
 * 字面の比較だけでは、slug のディレクトリの中を指すシンボリックリンク（`e2e/parity/share.spec.ts` →
 * `.replace/parity/share/reactions.json` 等）がスイートの根として通り、スイートを 1 つも照合しないまま
 * record と verify が通る（Issue #474）。根の重複も同じで、字面の違う 2 つの根が同じ実体を指すと 1 つの根として働く。
 * @param {string} cwd
 * @param {string} slugDir - cwd 基準の相対パス
 * @param {string[]} suiteRoots - cwd 基準の相対パス（slug のディレクトリを含まない）
 * @returns {string | null}
 */
function realRootProblem(cwd, slugDir, suiteRoots) {
  const slugReal = realPathOf(resolve(cwd, slugDir));
  if (slugReal === null) return `--dir（${slugDir}）の実パスを解決できない`;
  /** @type {Map<string, string>} 実パス → 最初に見た根 */
  const seen = new Map();
  for (const r of suiteRoots) {
    const real = realPathOf(resolve(cwd, r));
    if (real === null) return `スイートの根 ${r} の実パスを解決できない`;
    if (realUnder(real, slugReal)) {
      return `スイートの根 ${r} の実パス（${real}）が --dir の中を指す（シンボリックリンク経由でも slug のディレクトリの成果物はスイートにならない）`;
    }
    // 逆向き（根が slug のディレクトリを含む祖先）も止める。slug の成果物を二重に数え、別機能の slug の成果物まで指紋に混ざる。
    // 根の下の要素が slug のディレクトリの中を指す形は fingerprintFiles が辿りながら止める
    if (realUnder(slugReal, real)) {
      return `スイートの根 ${r} の実パス（${real}）が --dir を含む（slug のディレクトリの祖先はスイートの根にしない。別機能の成果物が指紋に混ざる）`;
    }
    const first = seen.get(real);
    if (first !== undefined) return `スイートの根 ${first} と ${r} が同じ実体（${real}）を指す`;
    seen.set(real, r);
  }
  return null;
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
  const slugReal = realPathOf(slugAbs);
  /** いま辿っている根（slug のディレクトリか、スイートの根か） */
  let r0 = slugDir;
  if (slugReal === null) throw new UsageError(`--dir（${slugDir}）の実パスを解決できない`);
  /**
   * @param {string} abs
   * @param {boolean} inSuite - スイートの根（--include）の下の要素か（根そのものは realRootProblem が確かめる）
   */
  const visit = (abs, inSuite) => {
    // スイートの根の中のシンボリックリンクが slug のディレクトリの中を指すと、スイートの指紋が slug の成果物の写しになり、
    // 書いたスイートを 1 つも照合しないまま通る（Codex レビュー、PR #475）。根の下で辿る要素をすべて実パスで確かめる
    if (inSuite) {
      const real = realPathOf(abs);
      if (real === null)
        throw new UsageError(`スイートの根の下の ${toRel(cwd, abs)} の実パスを解決できない`);
      if (realUnder(real, slugReal)) {
        throw new UsageError(
          `スイートの根の下の ${toRel(cwd, abs)} の実パス（${real}）が --dir の中を指す（slug のディレクトリの成果物はスイートにならない）`,
        );
      }
    }
    const st = statSync(abs);
    if (st.isDirectory()) {
      for (const name of readdirSync(abs).sort()) {
        if (SKIP_DIRS.has(name)) continue;
        if (abs === slugAbs && EXCLUDED_IN_DIR.has(name)) continue;
        visit(join(abs, name), r0 !== slugDir);
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
    r0 = r;
    visit(abs, false);
  }
  return files;
}

/**
 * 記録ファイルを読む（JSON として読めることだけを確かめる。形の検証は recordProblem）。無ければ空の記録を返す。
 * @param {string} path
 * @returns {unknown}
 */
function readRecord(path) {
  if (!existsSync(path)) return { tool: "checkpoint", version: VERSION, checkpoints: [] };
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch (e) {
    throw new UsageError(`${RECORD_NAME} を読めない（${e instanceof Error ? e.message : e}）`);
  }
}

/**
 * パス f が根 r の下（r 自身を含む）にあるか。
 * @param {string} f
 * @param {string} r
 */
function under(f, r) {
  return r === "." || f === r || f.startsWith(`${r}/`);
}

/** 記録の区切り 1 つが持つキー（record が書くもの。これ以外を持つ記録は record の出力ではない）。 */
const ENTRY_KEYS = ["at", "next_step", "roots", "files"];

/**
 * 記録が record の書く形かを検査し、最初に見つけた違反を返す（無ければ null）。
 *
 * 読み手の検証は「思いついた壊れ方」ではなく、書き手（下の main の record）が必ず満たす不変条件から作る。
 * 手で直した・壊れた記録も同じ経路で読まれ、--from の再開判定（fail-closed なゲート）になるため、
 * 書き手が作らない形を 1 つでも受けると、前段の成果物を確かめないまま再開できてしまう（Codex レビューで 7 巡指摘された形）。
 *
 * | # | 書き手が保証すること | 根拠（record の実装） |
 * |---|---|---|
 * | W1 | 最上位は { tool: "checkpoint", version: VERSION, checkpoints: [] } | 書き出しの JSON |
 * | W2 | 区切りは CHECKPOINTS の順に先頭から欠けずに並び、at / next_step は定義どおり | 前の区切りが無ければ止め、後ろを切り捨てて足す |
 * | W3 | 区切りのキーは at / next_step / roots / files だけ | entry の生成 |
 * | W4 | roots は重複の無い正規化済みの相対パスで、先頭が slug のディレクトリ、2 つ目以降（スイートの根）が 1 つ以上あり、どれも slug のディレクトリの外で、slug のディレクトリを含まない。包含と重複は実パスで成り立つ | toRel・--include の検査（realRootProblem）・authored の --include 必須 |
 * | W5 | 後の区切りの roots は前の区切りの roots で始まる | 前の根を引き継いで後ろに足す |
 * | W6 | files は空でなく、値は sha256、鍵はどれかの根の下で、slug のディレクトリ直下の除外名の下に無い | fingerprintFiles |
 * | W7 | スイートの根はそれぞれ 1 つ以上のファイルを持つ | 根が空なら止める |
 * | W8 | 2 つ目以降の区切りは、前の区切りから追加か書き換えを 1 つ以上持つ | 削除だけ・変化なしなら止める |
 * | W9 | gated の files は slug のディレクトリの strength.md を持つ | strength.md が無ければ止める |
 * @param {unknown} rec
 * @param {string} slugDir - cwd 基準の相対パス
 * @param {{ cwd: string }} opts - W4 の包含と重複を実パスで確かめる基準（対象プロジェクトのルート）
 * @returns {string | null}
 */
export function recordProblem(rec, slugDir, opts) {
  // W1
  if (!isPlainObject(rec) || rec.tool !== "checkpoint" || !Array.isArray(rec.checkpoints)) {
    return '最上位が { tool: "checkpoint", version, checkpoints: [] } の形でない';
  }
  if (rec.version !== VERSION) {
    return `version（${String(rec.version)}）が ${VERSION} でない（区切りを記録し直す）`;
  }
  const entries = rec.checkpoints;
  if (entries.length > CHECKPOINTS.length) return `区切りが ${CHECKPOINTS.length} 個を超える`;
  const hash = /^[0-9a-f]{64}$/;
  /** @type {string[] | null} */
  let prevRoots = null;
  /** @type {Record<string, string> | null} */
  let prevFiles = null;
  for (const [i, c] of entries.entries()) {
    const label = `${i + 1} 番目の区切り`;
    // W3
    if (!isPlainObject(c)) return `${label}がオブジェクトでない`;
    const keys = Object.keys(c).sort();
    if (JSON.stringify(keys) !== JSON.stringify([...ENTRY_KEYS].sort())) {
      return `${label}のキーが ${ENTRY_KEYS.join(" / ")} でない（${keys.join(", ")}）`;
    }
    // W2
    if (c.at !== CHECKPOINTS[i].at || c.next_step !== CHECKPOINTS[i].next_step) {
      return `区切りが ${CHECKPOINTS.map((k) => k.at).join(" → ")} の順の先頭から並んでいない、または next_step が定義と違う（${label}が ${String(c.at)}）`;
    }
    // W4
    const roots = c.roots;
    if (!Array.isArray(roots) || !roots.every((r) => typeof r === "string" && r !== "")) {
      return `${c.at} の roots が空でない文字列の配列でない`;
    }
    if (new Set(roots).size !== roots.length) return `${c.at} の roots に重複がある`;
    if (roots[0] !== slugDir) {
      return `${c.at} の roots の先頭（${String(roots[0])}）が --dir（${slugDir}）でない`;
    }
    if (roots.length < 2) {
      return `${c.at} にスイートの根が無い（authored の --include が記録されていない）`;
    }
    for (const r of roots.slice(1)) {
      if (r.startsWith("/") || r.split("/").some((seg) => seg === "" || seg === ".")) {
        return `${c.at} の roots に正規化されていないパスがある: ${r}`;
      }
    }
    // 包含と重複は字面でなく実パスで判定する（字面の包含は実パスの包含に含まれる。Issue #474）
    const real = realRootProblem(opts.cwd, slugDir, roots.slice(1));
    if (real !== null) return `${c.at} の ${real}`;
    // W5
    if (prevRoots && !prevRoots.every((r, k) => roots[k] === r)) {
      return `${c.at} の roots が前の区切りの roots を引き継いでいない`;
    }
    // W6
    const files = c.files;
    if (!isPlainObject(files) || Object.keys(files).length === 0) {
      return `${c.at} の files が空（指紋の対象が無い記録では照合できない）`;
    }
    for (const [f, h] of Object.entries(files)) {
      if (typeof h !== "string" || !hash.test(h)) return `${c.at} の ${f} の指紋が sha256 でない`;
      if (!roots.some((r) => under(f, r))) return `${c.at} の ${f} がどの根の下にも無い`;
      if ([...EXCLUDED_IN_DIR].some((n) => under(f, `${slugDir}/${n}`))) {
        return `${c.at} の ${f} は指紋から外す名前の下にある`;
      }
    }
    const fileKeys = Object.keys(files);
    // W7
    const emptyRoot = roots.slice(1).find((r) => !fileKeys.some((f) => under(f, r)));
    if (emptyRoot !== undefined)
      return `${c.at} のスイートの根 ${emptyRoot} がファイルを 1 つも持たない`;
    // W8
    if (prevFiles) {
      const p = prevFiles;
      if (!fileKeys.some((f) => p[f] !== files[f])) {
        return `${c.at} が前の区切りから追加・書き換えを 1 つも持たない`;
      }
    }
    // W9
    if (c.at === "gated" && !Object.hasOwn(files, `${slugDir}/strength.md`)) {
      return "gated の指紋に strength.md が無い";
    }
    prevRoots = roots;
    prevFiles = /** @type {Record<string, string>} */ (files);
  }
  return null;
}

/**
 * 出力先は差し込める（テストが子プロセスを起動せずに終了コード・stdout・stderr を受け取るため）。
 * @param {string[]} argv - process.argv.slice(2)
 * @param {{ cwd?: string, out?: (s: string) => void, err?: (s: string) => void }} [deps]
 * @returns {number}
 */
export function main(argv, deps = {}) {
  const cwd = deps.cwd ?? process.cwd();
  const out = deps.out ?? ((s) => process.stdout.write(s));
  const err = deps.err ?? ((s) => process.stderr.write(s));
  const vocab = CHECKPOINTS.map((c) => c.at).join(" | ");
  const usage = [
    `usage: checkpoint.mjs record --dir .replace/parity/<slug> --at <${vocab}> [--include <パス>]...`,
    `       checkpoint.mjs verify --dir .replace/parity/<slug> --at <${vocab}>`,
    "  cwd は対象プロジェクトのルート（record と verify で同じにする）",
  ].join("\n");
  const [command, ...rest] = argv;
  if (command !== "record" && command !== "verify") {
    err(`error: サブコマンドが無い・不明: ${command ?? ""}\n${usage}\n`);
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
      err(`error: 不明な引数 ${a}\n${usage}\n`);
      return 2;
    }
    if (v === undefined || v === "" || v.startsWith("--")) {
      err(`error: ${a} に値が無い\n${usage}\n`);
      return 2;
    }
    // --include 以外を重ねると後勝ちで黙って別の区切り・別の slug を扱うので止める
    if ((a === "--dir" && dir !== null) || (a === "--at" && at !== null)) {
      err(`error: ${a} が重複している\n${usage}\n`);
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
    // authored は記録を作り直すので、既存の記録（壊れていても）は読まない。それ以外は書き手の形であることを先に確かめる
    const raw =
      command === "record" && pos === 0
        ? { tool: "checkpoint", version: VERSION, checkpoints: [] }
        : readRecord(recordPath);
    const problem = recordProblem(raw, slugDir, { cwd });
    if (problem !== null) {
      throw new UsageError(
        `${RECORD_NAME} が record の書く形でない: ${problem}（手で直さず authored から記録し直す）`,
      );
    }
    const record = /** @type {{ checkpoints: Record<string, unknown>[] }} */ (raw);

    if (command === "verify") {
      const last = record.checkpoints[record.checkpoints.length - 1];
      if (last === undefined) {
        err(`error: 区切りが 1 つも記録されていない（${at} から再開できない）\n`);
        return 1;
      }
      if (last.at !== at) {
        err(
          `error: 最後に記録した区切りは ${String(last.at)}（${at} ではない）。${String(last.at)} から再開するか、${at} までの手順をやり直す\n`,
        );
        return 1;
      }
      const recorded = /** @type {Record<string, string>} */ (last.files);
      const now = fingerprintFiles(cwd, /** @type {string[]} */ (last.roots), slugDir, {
        allowMissing: true,
      });
      const added = Object.keys(now).filter((f) => !Object.hasOwn(recorded, f));
      const removed = Object.keys(recorded).filter((f) => !Object.hasOwn(now, f));
      const changed = Object.keys(now).filter(
        (f) => Object.hasOwn(recorded, f) && recorded[f] !== now[f],
      );
      const ok = added.length + removed.length + changed.length === 0;
      out(
        `${JSON.stringify({ tool: "checkpoint", version: VERSION, at, ok, next_step: last.next_step, files: Object.keys(now).length, added, removed, changed }, null, 2)}\n`,
      );
      if (!ok) {
        err(
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
    }
    for (const inc of includes) {
      const rel = toRel(cwd, inc);
      const abs = resolve(cwd, rel);
      if (!existsSync(abs)) throw new UsageError(`--include が存在しない: ${inc}`);
      if (!inherited.includes(rel)) inherited.push(rel);
    }
    // 包含（中を指す・祖先を指す）と重複は実パスで判定する。字面だけではシンボリックリンクで slug のディレクトリの中を指す根が通る（Issue #474）
    const realProblem = realRootProblem(cwd, slugDir, inherited);
    if (realProblem !== null) throw new UsageError(`--include の ${realProblem}`);
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
    out(
      `${JSON.stringify({ tool: "checkpoint", version: VERSION, at, recorded: true, next_step: entry.next_step, roots, files: Object.keys(files).length })}\n`,
    );
    return 0;
  } catch (e) {
    err(`error: ${e instanceof Error ? e.message : e}\n${usage}\n`);
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
