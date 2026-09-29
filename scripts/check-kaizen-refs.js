#!/usr/bin/env node
// kaizen の学び（`.kaizen/<YYYY-MM-DD>-<slug>.md` / `.kaizen/archive/<name>.md`）への参照が実在するか検査する
// （lefthook pre-commit + CI）。
//
// なぜ要るか: 学びは適用・忘却のたびに `.kaizen/` 直下から `.kaizen/archive/` へ移る。移動は参照側を
// 書き換えないので、コメントや文書に書いた根拠のリンクが黙って切れる。切れた参照は読み手が
// 「根拠がある」と受け取ったまま辿れない。
//
// 判定規則:
// - 対象は追跡ファイルと、ignore されていない未追跡ファイル（add 前の新規ファイルを手元で見落とさない。
//   commit の前後で走査集合が変わらない）のうち、テキスト拡張子のもの（`check-control-chars.js` と同じ集合）。
//   配布スキルのインストール済みコピー（`.agents/skills/<name>/` のうち `skills/<name>/` に正本があるもの）、
//   エージェント用リンク（`.claude/`）、テスト結果（`tests/`）、学び自身（`.kaizen/`。学びは書かれた時点の記録で、
//   参照先が後で archive/ へ移って現存しなくても不整合ではない〈kaizen スキルの references/extract.md の規定〉。
//   ここで落とすと archive のたびに過去の記録を書き換えることになる）、`node_modules/` を除く。`.agents/` のそれ以外は正本なので走査する——
//   private skill（`skills/` に無い `.agents/skills/<name>/`）と rule（`.agents/rules/`）。
//   シンボリックリンクは読まない（`.github/instructions/` → `.agents/rules/` のようなリンクは、リンク先の正本を
//   走査するので、辿ると同じ本文を二重に数える）。
//   eval の入力（`evals/<name>/evals.json` と `evals/<name>/fixtures/`）は、eval が想定する別リポジトリの状態を
//   書いたもので、このリポジトリの学びを指さない（prompt 中の仮のパスは意図的な非実在）ので除く。
//   `evals/<name>/README.md` のような文書は対象に残す。この検査自身のテストと変異宣言（切れた参照の fixture を持つ）も除く。
// - 拾う参照は `.kaizen/<YYYY-MM-DD>-<slug>.md` と `.kaizen/archive/<name>.md`。プレースホルダ
//   （`${base}` / `*` / `<slug>`）は名前の文字集合に入らないので拾わない。
// - `.md` の直後がパスの続き（名前の文字 `[A-Za-z0-9_-]`、`/`、または `.` の直後に `[A-Za-z0-9_]`。例: `.md.bak` /
//   `.md-old` / `.mdx` / `.md/subpath` / `.md/`）なら、書かれた文字どおりのパスは学びではない。`.md` までを参照として拾うと、
//   実在する学びを指して合格になるので、判定不能を合格に倒さず違反にする（1 つのパスとして書くよう求める）。
//   文末の `.`（直後が空白・行末・約物）や `)` `）` `、` `。` `` ` `` `"` などの約物は参照の終わりとして受け入れる。
//   URL のアンカー（`.md#L10`）も参照の終わりとして受け入れる（指すファイルは変わらない）。
//   折り返した参照をつないだ後にも同じ規則を当てる。位置はリポジトリルート基準で解決する
//   （`.kaizen/` はルートに 1 つしか無いので、`../.kaizen/...` のような相対リンクも同じ実体を指す）。
// - 参照先は**追跡されていて、かつ作業ツリーに在る**こと。CI は追跡ファイルしか持たないので、
//   作業ツリーにだけ在る未追跡の学びは手元でだけ通る。
// - 行末で折り返された参照（例: `// ... .kaizen/archive/2026-09-19-length-limit-` の次行が
//   `// measured-by-proxy-not-enforcer.md`）は、次行の先頭（コメント記号・引用記号・空白を除いた位置）の
//   名前の続きとつないで 1 件として検査する。つないでも参照の形にならない折り返しは、
//   判定不能を合格に倒さず違反にする（1 行に収めるよう求める）。切れ目が日付の途中・`.kaizen/` や
//   `.kaizen/archive/` の直後でも同じく扱う。ただし名前を 1 文字も持たない切れ目は、つないで参照に
//   ならなければディレクトリへの言及として通す。
// - 意図的な非実在（テストが一時ディレクトリに作る fixture のパス）は、走査するリポジトリの
//   `scripts/kaizen-refs-exemptions.json`（`[{ file, ref, reason }]`）に理由付きで宣言する。
//   免除はデータとして走査対象と一緒に持つ（コードに埋めると、別のリポジトリを走査したとき「使われていない免除」になる）。
//   ファイルが無ければ免除 0 件。使われなくなった免除も違反にする（免除が残ると、同じ参照を後から本物として書いても素通りする）。
//
// 対象ファイル 0 件・参照 0 件は成功に倒さない（走査できていないことと違反が無いことを区別する）。
import { execFileSync } from "node:child_process";
import { existsSync, lstatSync, readFileSync, realpathSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { isTextPath } from "./check-control-chars.js";

const EXCLUDED_PREFIXES = [".claude/", "tests/", ".kaizen/", "node_modules/"];
const AGENTS_SKILL_RE = /^\.agents\/skills\/([^/]+)\//;
const SKILL_RE = /^skills\/([^/]+)\//;
const EVAL_INPUT_RE = /^evals\/[^/]+\/(?:evals\.json$|fixtures\/)/;

// 免除の宣言ファイルは、実在しない参照を並べるのが役目なので走査しない。
export const EXEMPTIONS_PATH = "scripts/kaizen-refs-exemptions.json";
// この検査自身のテストと変異宣言は、切れた参照の fixture を本文に持つのが役目なので走査しない
// （参照ごとに免除を宣言すると、ケースを足すたびに免除が要る）。閉じた集合として名指しする。
export const SELF_FIXTURES = [
  "scripts/check-kaizen-refs.test.js",
  "scripts/check-kaizen-refs.mutations.json",
];

/** 配布スキルのインストール済みコピーか（正本 `skills/<name>/` が一覧に在る名前だけ）。 */
export const isInstalledCopy = (path, distributed) => {
  const m = AGENTS_SKILL_RE.exec(path);
  return Boolean(m) && distributed.has(m[1]);
};

/** 一覧のうち `skills/<name>/` 配下にファイルを持つ名前（配布スキルの正本）。 */
export const distributedSkills = (paths) =>
  new Set(paths.map((f) => SKILL_RE.exec(f)?.[1]).filter(Boolean));

export const isScanned = (path, distributed = new Set()) =>
  isTextPath(path) &&
  !isInstalledCopy(path, distributed) &&
  path !== EXEMPTIONS_PATH &&
  !SELF_FIXTURES.includes(path) &&
  !EXCLUDED_PREFIXES.some((p) => path.startsWith(p)) &&
  !EVAL_INPUT_RE.test(path);

/** 免除の宣言を読む。無ければ 0 件、形が崩れていれば例外（判定不能を免除 0 件に倒さない）。 */
export function loadExemptions(root) {
  const path = join(root, EXEMPTIONS_PATH);
  if (!existsSync(path)) return [];
  const data = JSON.parse(readFileSync(path, "utf8"));
  const list = data?.exemptions;
  const ok = (e) => ["file", "ref", "reason"].every((k) => typeof e?.[k] === "string");
  if (!Array.isArray(list) || !list.every(ok)) {
    throw new Error(
      `${EXEMPTIONS_PATH}: exemptions は { file, ref, reason }（すべて文字列）の配列にする`,
    );
  }
  return list;
}

const NAME = "[A-Za-z0-9_-]+";
const DATED = `\\d{4}-\\d{2}-\\d{2}-${NAME}\\.md`;
const LEAD = "(?<![A-Za-z0-9_.-])";
const REF_RE = new RegExp(`${LEAD}\\.kaizen/(?:archive/${NAME}\\.md|${DATED})`, "g");
// `.md` の直後に続くパスの続き。空でなければ参照の形が崩れている（`.md.` の後ろが名前の文字でなければ文末の句点）。
// `/` も続き（`.md/subpath` `.md/` は `.md` をディレクトリとして書いたパス）。`#`（URL のアンカー `.md#L10`）は
// パスではなくファイル内の位置なので続きに含めない——指すファイルは `.md` までで確定している。
const PATH_TAIL_RE = /^(?:[A-Za-z0-9_-]|\/|\.(?=[A-Za-z0-9_]))*/;
const FULL_RE = new RegExp(`^\\.kaizen/(?:archive/${NAME}\\.md|${DATED})$`);
// 行末で切れた参照。切れ目は名前の途中に限らない——日付の途中（`2026-09-`）や、
// `.kaizen/` / `.kaizen/archive/` の直後でも切れうる。日付を丸ごと要求すると、それより手前で
// 切れた参照は「参照」とも「復元できない折り返し」とも判定されず黙って素通りする。
// 直下は日付で始まる名前だけを拾う（`.kaizen/config` のような制御ファイルへの言及を巻き込まない）。
const TRUNCATED_RE = new RegExp(
  `${LEAD}(\\.kaizen/(?:archive/${NAME}|archive/|\\d[A-Za-z0-9_-]*)?)$`,
);
// 名前を 1 文字も持たない切れ目（`.kaizen/` / `.kaizen/archive/`）はディレクトリへの言及と
// 区別できないので、次行とつないで参照になるときだけ参照として扱い、ならなければ通す。
const DIR_ONLY_RE = /^\.kaizen\/(?:archive\/)?$/;
// 折り返しの続き行の先頭から、コメント記号・引用記号・空白を除いて名前の続きを取る
// （`.kaizen/` の直後で切れた形は `archive/` から続く）。
const CONTINUATION_RE = new RegExp(`^\\s*(?:\\/\\/|#|\\*|>)?\\s*((?:archive/)?${NAME}\\.md)`);

/**
 * 1 ファイルの本文から参照を列挙する。`broken` は折り返しを復元できなかった行、
 * `malformed` は `.md` の後ろにパスが続く（書かれた文字どおりのパスが学びではない）参照。
 */
export function findRefs(text) {
  const refs = [];
  const broken = [];
  const malformed = [];
  // `rest` は参照の直後から行末まで。
  const take = (ref, rest, entry) => {
    const tail = PATH_TAIL_RE.exec(rest)[0];
    if (tail) malformed.push({ ...entry, text: ref + tail });
    else refs.push({ ref, ...entry });
  };
  const lines = text.split(/\r?\n/);
  lines.forEach((line, i) => {
    for (const m of line.matchAll(REF_RE)) {
      take(m[0], line.slice(m.index + m[0].length), { line: i + 1 });
    }
    const cut = TRUNCATED_RE.exec(line.trimEnd());
    if (!cut) return;
    const next = CONTINUATION_RE.exec(lines[i + 1] ?? "");
    const joined = next ? cut[1] + next[1] : null;
    if (joined && FULL_RE.test(joined)) {
      take(joined, lines[i + 1].slice(next[0].length), { line: i + 1, wrapped: true });
    } else if (DIR_ONLY_RE.test(cut[1])) return;
    else broken.push({ fragment: cut[1], line: i + 1 });
  });
  return { refs, broken, malformed };
}

/** `git ls-files` の一覧（NUL 区切りなので改行を含む名前も壊れない）。 */
export function gitFiles(root, ...args) {
  const out = execFileSync("git", ["ls-files", "-z", ...args], {
    cwd: root,
    maxBuffer: 1 << 28,
    stdio: ["ignore", "pipe", "pipe"],
  });
  return out.toString().split("\0").filter(Boolean);
}

/**
 * @param {string} root リポジトリルート（テストでは一時ディレクトリ）
 * @returns {{ files: string[], refs: number, violations: string[] }}
 */
export function checkKaizenRefs(root, { exemptions = loadExemptions(root) } = {}) {
  const tracked = gitFiles(root, "--cached");
  const trackedSet = new Set(tracked);
  const listed = [...tracked, ...gitFiles(root, "--others", "--exclude-standard")];
  const distributed = distributedSkills(listed);
  // 作業ツリーで消した（未ステージの削除）追跡ファイルと、シンボリックリンクは読まない。
  const files = listed.filter(
    (f) =>
      isScanned(f, distributed) &&
      existsSync(join(root, f)) &&
      !lstatSync(join(root, f)).isSymbolicLink(),
  );
  const violations = [];
  const usedExemptions = new Set();
  let refs = 0;

  for (const e of exemptions) {
    if (!e.reason?.trim()) violations.push(`免除に理由が無い: ${e.file} → ${e.ref}`);
  }

  for (const file of files) {
    let text;
    try {
      text = readFileSync(join(root, file), "utf8");
    } catch (error) {
      violations.push(`${file}: 読めないため走査できていない: ${error.code ?? error.message}`);
      continue;
    }
    const found = findRefs(text);
    for (const { fragment, line } of found.broken) {
      violations.push(
        `${file}:${line}: 行末で切れた参照を次行とつないで復元できない（${fragment}…）。1 行に収める`,
      );
    }
    // 形の崩れた参照も走査した参照に数える（それしか無いファイルを「参照 0 件」と取り違えない）。
    refs += found.malformed.length;
    for (const { text: shown, line, wrapped } of found.malformed) {
      violations.push(
        `${file}:${line}${wrapped ? "（折り返し）" : ""}: 参照の形が崩れている（${shown}）。` +
          "学びへのパスは .md で終わる 1 つのパスとして書く",
      );
    }
    for (const { ref, line, wrapped } of found.refs) {
      refs += 1;
      const where = `${file}:${line}${wrapped ? "（折り返し）" : ""}`;
      const exemption = exemptions.find((e) => e.file === file && e.ref === ref);
      if (exemption) {
        usedExemptions.add(exemption);
        continue;
      }
      if (!existsSync(join(root, ref))) {
        violations.push(`${where}: ${ref} が存在しない（archive/ へ移動したなら参照を直す）`);
      } else if (!trackedSet.has(ref)) {
        violations.push(`${where}: ${ref} が追跡されていない（CI には存在しない）`);
      }
    }
  }

  for (const e of exemptions) {
    if (!usedExemptions.has(e)) {
      violations.push(`使われていない免除: ${e.file} → ${e.ref}（参照が消えたなら免除も消す）`);
    }
  }

  return { files, refs, violations };
}

export function main(argv) {
  const root = argv.filter((a) => a !== "--")[0] ?? process.cwd();
  let result;
  try {
    result = checkKaizenRefs(root);
  } catch (error) {
    console.error(`kaizen-refs: 走査を始められない（${resolve(root)}）: ${error.message}`);
    return 2;
  }
  const { files, refs, violations } = result;

  if (files.length === 0 || refs === 0) {
    console.error(
      `kaizen-refs: 走査したファイル ${files.length} 件・参照 ${refs} 件（${resolve(root)}）。` +
        "0 件は「違反なし」ではない。対象を取り違えていないか確認する。",
    );
    return 1;
  }
  if (violations.length) {
    console.error(
      `kaizen-refs: ${files.length} 件のファイルで ${refs} 件の参照を走査し、${violations.length} 件の不備:`,
    );
    for (const v of violations) console.error(`  - ${v}`);
    console.error(
      "Fix: 学びを archive/ へ移したなら参照を .kaizen/archive/<name>.md へ直す。" +
        `意図的な非実在なら ${EXEMPTIONS_PATH} に理由付きで宣言する。`,
    );
    return 1;
  }
  console.log(`kaizen-refs: OK（${files.length} 件のファイル・${refs} 件の参照）`);
  return 0;
}

// CLI エントリ判定は両辺を実パスへ揃える（片側だけの解決は symlink 経由の起動でサイレント no-op になる）。
function isCliEntry() {
  if (!process.argv[1]) return false;
  try {
    return realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url));
  } catch (error) {
    console.error(`kaizen-refs: 起動パスを正規化できない: ${error.message}`);
    process.exit(1);
  }
}

if (isCliEntry()) process.exit(main(process.argv.slice(2)));
