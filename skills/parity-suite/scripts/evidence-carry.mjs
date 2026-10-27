// 新側のコミットが変わった証跡を、ページの描画入力の差分で持ち越せるかを判定する（原本）。
//
// 何のためか: 証跡（diff-metadata.json の new.commit・component-comparison.json の new_implementation.commit）は
// 新側リポジトリ全体のコミット SHA に結びついている。共通部品を 1 行直すと、その部品を使うかどうかに関わらず
// 全ページの証跡が「古い」になる。ここでは SHA の不一致を即失効にせず、次を全部確かめられたときだけ持ち越す。
//   1. そのページの描画に影響するファイル（replace-metadata.json の new.render_inputs。git pathspec）の差分 D を取る。
//   2. D が空なら描画入力は変わっていないので、持ち越す。
//   3. D の各ファイルが、evidence-carry.json の carries が指す変更宣言（parity-component の
//      component-change.json）の files のどれかに含まれることを確かめる。
//      加えて、記録の版から今の版までのそのファイルの変化が、宣言した改修（commits.before → commits.after）の
//      連鎖で説明できることを確かめる（宣言の後に宣言外の編集が無い）。
//   4. 使った変更宣言ごとに、component-impact.mjs の computeImpact をこの機能で再計算する。
//      影響なしなら持ち越す。影響ありなら、amend-verify.mjs の記録が影響する組を全部覆い、全組が pass で、
//      記録した入力画像の sha256 が今のファイルと一致するときだけ持ち越す。判定不能なら持ち越さない。
//
// 呼び出し元: artifact-health-check.mjs の checkStage と component-comparison-check.mjs の
// comparison-implementation-stale。**2 つのチェックは同じ入力に同じ判定を出す**。どちらもこの関数だけで
// 持ち越しを決め、独自の緩和を足さない。
//
// 次のどれに当たっても持ち越さない。リポジトリが無い・git が失敗する・コミットが無い・変更宣言が読めない／不正・
// 影響が判定不能・amend-verify の記録が無い／読めない・組が覆われていない・pass でない・sha256 が一致しない。
// render_inputs が無い・空のときだけは判定せず、`legacy: true` を返す。呼び出し元は従来どおり SHA の不一致として不合格にする
// （後方互換。持ち越しは、描画入力を宣言した記録にだけ適用する）。
//
// パスの解決（原本）: evidence-carry.json の change / amend_verify と、amend-verify の記録の inputs.*.path は、
// 相対パスなら**プロジェクトルート（`.replace` の親ディレクトリ）**から解決する。amend-verify.mjs は
// パスを与えられたまま記録するので、プロジェクトルートを作業ディレクトリにして実行する（amend-verify.mjs の
// 冒頭の注記と対）。絶対パスはそのまま使う。
//
// git は `git -C <repo> ...` を execFileSync で起動し、stdin を閉じる（非対話で入力待ちにしない）。
// 決定論的: 乱数・現在時刻に依存しない。TypeScript 構文は使わない（型は JSDoc）。

import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readdirSync, readFileSync, realpathSync } from "node:fs";
import { dirname, isAbsolute, join, resolve, sep } from "node:path";
import { computeImpact, isChangeKind, validateChange } from "./component-impact.mjs";
import { isArray } from "./lib/is-array.mjs";
import { isFiniteNumber, isPlainObject, nonEmptyString } from "./lib/guards.mjs";

/**
 * ツールのバージョン（原本）。判定規則を変えたら上げる。
 * @type {string}
 */
export const VERSION = "1";

/** evidence-carry.json のファイル名（replace-metadata.json と同じディレクトリに置く）。 */
export const EVIDENCE_CARRY_FILE = "evidence-carry.json";

/** 記録を書いた amend-verify の `tool`。 */
const AMEND_VERIFY_TOOL = "amend-verify";

/**
 * render_inputs が無いときに呼び出し元が従来の失敗へ添える注記。
 * @type {string}
 */
export const LEGACY_HINT =
  "replace-metadata.json に new.render_inputs（ページの描画に影響するファイルの git pathspec）が無いので、証跡を描画入力の差分で持ち越せない（部品の改修で持ち越すなら parity-replace で render_inputs を記録する）";

/**
 * デフォルトの git の起動。stdin は閉じ、stdout を文字列で返す。失敗は例外にする（呼び出し側で、持ち越さないものとして扱う）。
 * @param {string} repo
 * @param {string[]} args
 * @returns {string}
 */
function defaultRunGit(repo, args) {
  return execFileSync("git", ["-C", repo, ...args], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    maxBuffer: 64 * 1024 * 1024,
  });
}

/**
 * 例外から読める理由を取り出す（git の stderr を優先）。
 * @param {unknown} e
 * @returns {string}
 */
function reasonOf(e) {
  /** @type {Record<string, unknown>} */
  const err = isPlainObject(e) ? e : {};
  const stderr =
    typeof err.stderr === "string"
      ? err.stderr
      : Buffer.isBuffer(err.stderr)
        ? err.stderr.toString("utf8")
        : "";
  const text = stderr.trim() !== "" ? stderr.trim() : String(err.message ?? e);
  return text.split("\n")[0];
}

/**
 * validateChange が確かめた変更宣言のうち、この判定が読む欄の形を確かめる型ガード。
 * @param {unknown} v
 * @returns {v is CarryChange}
 */
function isCarryChange(v) {
  return (
    isPlainObject(v) &&
    typeof v.id === "string" &&
    typeof v.slug === "string" &&
    isChangeKind(v.kind) &&
    isArray(v.files) &&
    v.files.every((f) => typeof f === "string") &&
    isPlainObject(v.commits) &&
    typeof v.commits.before === "string" &&
    typeof v.commits.after === "string" &&
    typeof v.margin_px === "number" &&
    isPlainObject(v.catalog_verification)
  );
}

/**
 * 影響する組の影響インスタンス（論理名）。
 * @param {{pair:string, instances?: {id:string, locator:unknown}[]}[]} pairs
 * @param {string} pair
 * @returns {{id:string, locator:unknown}[]}
 */
function pairInstances(pairs, pair) {
  return pairs.find((p) => p.pair === pair)?.instances ?? [];
}

/**
 * 矩形を比較用の文字列にする（順序に依らない集合比較のため）。
 * @param {unknown} r
 * @returns {string | null}
 */
function rectKey(r) {
  if (!isPlainObject(r)) return null;
  const v = r;
  const nums = [v.x, v.y, v.width, v.height];
  if (!nums.every(isFiniteNumber)) return null;
  return nums.join(",");
}

/**
 * validateChange（component-impact.mjs）を通った変更宣言のうち、この判定が読む欄。
 * @typedef {{
 *   id: string,
 *   slug: string,
 *   kind: import("./component-impact.mjs").ChangeKind,
 *   files: string[],
 *   commits: { before: string, after: string },
 *   margin_px: number,
 *   catalog_verification: Record<string, unknown>,
 * }} CarryChange
 */

/**
 * amend-verify の組の判定に使った幾何（margin と領域）が、変更宣言と新側の採取物に結びついているか。
 * 画像の sha256 は画像を認証するだけで、判定を弱める margin・領域（画面全体など）を認証しない。
 * margin は宣言の margin_px と一致し、領域（広げる前の declared_regions）は撮り直した新側の組の
 * traits.json（inputs.new と同じディレクトリ）にある影響インスタンスの論理名の rect と一致することを求める。
 * @param {Record<string, unknown>} entry amend-verify の記録の組 1 件
 * @param {CarryChange} change
 * @param {{ instances: {id:string, locator:unknown}[], fromProject: (p: string) => string, readBytes: (p: string) => Buffer }} where
 * @returns {string | null} 不合格の理由（合格なら null）
 */
function checkGeometry(entry, change, { instances, fromProject, readBytes }) {
  if (entry.margin !== change.margin_px) {
    return `margin ${JSON.stringify(entry.margin)} が変更宣言の margin_px ${JSON.stringify(change.margin_px)} と違う（判定を弱めた記録で持ち越さない）`;
  }
  if (instances.length === 0) return "影響インスタンスが無く、領域を採取物と突き合わせられない";
  const newInput = isPlainObject(entry.inputs) ? entry.inputs.new : undefined;
  const newPath = isPlainObject(newInput) ? newInput.path : undefined;
  if (!nonEmptyString(newPath)) return "inputs.new.path が無く、traits.json を引けない";
  const traitsPath = join(dirname(fromProject(newPath)), "traits.json");
  let traits;
  try {
    traits = JSON.parse(readBytes(traitsPath).toString("utf8"));
  } catch (e) {
    return `新側の traits.json を読めない（inputs.new には撮り直した組の screenshot.png を渡す）: ${traitsPath}（${reasonOf(e)}）`;
  }
  if (!isArray(traits)) return `新側の traits.json が配列でない: ${traitsPath}`;
  /** @type {string[]} */
  const expected = [];
  const traitObjects = traits.filter(isPlainObject);
  for (const { locator } of instances) {
    const found = traitObjects.filter((t) => t.name === locator);
    const key = found.length === 1 ? rectKey(found[0].rect) : null;
    if (key === null) {
      return `新側の traits.json に影響インスタンスの論理名 ${JSON.stringify(locator)} の rect が 1 件だけある形でない（${found.length} 件）: ${traitsPath}`;
    }
    expected.push(key);
  }
  const declared = isArray(entry.declared_regions) ? entry.declared_regions.map(rectKey) : [];
  if (!declared.every((k) => k !== null) || declared.length === 0) {
    return "declared_regions が矩形の配列でない";
  }
  const a = [...declared].sort().join(" | ");
  const b = [...expected].sort().join(" | ");
  if (a !== b) {
    return `declared_regions（${a}）が新側の traits.json の影響インスタンスの rect（${b}）と一致しない（領域は traits.json の rect をそのまま渡す）`;
  }
  return null;
}

/**
 * amend-verify の組の判定（pass）が、同じ記録の計数と食い違っていないか。記録の書き換え・部分的なマージ・
 * 別の書き手の記録で pass だけが true になっていても、合格の条件（領域の外は完全一致・領域の中の不一致は増えていない）を
 * 満たさない計数なら持ち越さない。
 * @param {Record<string, unknown>} entry amend-verify の記録の組 1 件
 * @returns {string | null} 不合格の理由（合格なら null）
 */
function checkVerdict(entry) {
  /**
   * @param {unknown} v
   * @returns {v is number & { readonly __count: true }}
   */
  const count = (v) => typeof v === "number" && Number.isInteger(v) && v >= 0;
  if (entry.outside_identical !== true || entry.outside_diff_pixels !== 0) {
    return `pass なのに領域の外が一致していない（outside_identical: ${JSON.stringify(entry.outside_identical)}、outside_diff_pixels: ${JSON.stringify(entry.outside_diff_pixels)}）`;
  }
  if (!count(entry.inside_diff_before) || !count(entry.inside_diff_after)) {
    return "inside_diff_before / inside_diff_after が 0 以上の整数でない";
  }
  if (entry.inside_diff_after > entry.inside_diff_before) {
    return `pass なのに領域の中の現行との不一致が増えている（${entry.inside_diff_before} → ${entry.inside_diff_after}）`;
  }
  return null;
}

/**
 * amend-verify の組の 3 つの入力が、それぞれの役割の採取物を指しているか。
 * 画像の sha256 は「そのパスのバイト」を認証するだけで、役割を認証しない（撮り直した新側を 3 つ全部に渡しても
 * 判定は合格し、ハッシュも一致する）。そこで、役割ごとに置き場所を固定して、次のように突き合わせる。
 * - new: `<stage>/baseline-new/<page>/<state>/<viewport>/screenshot.png`（撮り直した組そのもの）
 * - prev_new: `<stage>/pre-change/<change-id>/<page>/<state>/<viewport>/screenshot.png`（撮り直す前に撮った改修前の新側）
 * - current: `<replaceRoot>/parity/<slug>/baseline/` の下（現側の基準。その下の並びは採取スペックが決める）
 * `<stage>` は evidence-carry.json のあるディレクトリ（new/<target>/）。
 * @param {Record<string, unknown>} entry amend-verify の記録の組 1 件
 * @param {string} pair
 * @param {{ changeId: string, stageDir: string, currentRoot: string, fromProject: (p: string) => string }} where
 * @returns {string | null} 不合格の理由（合格なら null）
 */
function checkProvenance(entry, pair, where) {
  const [page, state, viewport] = pair.split("|");
  const inputs = isPlainObject(entry.inputs) ? entry.inputs : {};
  /** @param {string} key */
  const at = (key) => {
    const input = inputs[key];
    const path = isPlainObject(input) ? input.path : undefined;
    return nonEmptyString(path) ? where.fromProject(path) : null;
  };
  const expectedNew = join(where.stageDir, "baseline-new", page, state, viewport, "screenshot.png");
  const expectedPrev = join(
    where.stageDir,
    "pre-change",
    where.changeId,
    page,
    state,
    viewport,
    "screenshot.png",
  );
  if (at("new") !== expectedNew) {
    return `inputs.new が撮り直した組の採取物（${expectedNew}）でない: ${at("new")}`;
  }
  if (at("prev_new") !== expectedPrev) {
    return `inputs.prev_new が撮り直す前に撮った改修前の新側（${expectedPrev}）でない: ${at("prev_new")}`;
  }
  const current = at("current");
  if (current === null || !current.startsWith(where.currentRoot + sep)) {
    return `inputs.current が現側の基準（${where.currentRoot}${sep} の下）でない: ${current}`;
  }
  // 現側の基準の並び（<page>/<state>/<viewport>/screenshot.png、<page>.<state>.<viewport>.png など）は、採取スペックが決める。
  // そこで、基準の下のパスを `/` と `.` で区切った語に、組の page / state / viewport が全部あることを求める（別の組の基準を渡した記録を弾く）。
  // 語の有無だけでは軸の入れ替え（hover/list/desktop）を通すので、page → state → viewport の順に現れることを求める。
  const tokens = current.slice(where.currentRoot.length + 1).split(/[/\\.]/);
  let from = 0;
  const missing = [];
  for (const axis of [page, state, viewport]) {
    const found = tokens.indexOf(axis, from);
    if (found < 0) missing.push(axis);
    else from = found + 1;
  }
  if (missing.length > 0) {
    return `inputs.current が組 ${pair} の現側の基準でない（パスに ${[page, state, viewport].join(" → ")} の順で現れない。欠けた語: ${missing.join(", ")}）: ${current}`;
  }
  return null;
}

/**
 * render_inputs の pathspec を git へ渡す形にする。既に magic（`:` 始まり）を持つものはそのまま、
 * それ以外は `:(glob)` を付ける（`*` が `/` を跨がず、`**` だけが階層を跨ぐ）。
 * @param {string} spec
 * @returns {string}
 */
export function toPathspec(spec) {
  return spec.startsWith(":") ? spec : `:(glob)${spec}`;
}

/**
 * judgeCarry の途中で、持ち越さないと決まったことを知らせる。finding があれば findings の末尾に足す
 * （null なら、それまでに findings へ足した理由だけで返す）。
 */
class CarryStop extends Error {
  /** @param {string | null} finding */
  constructor(finding) {
    super(finding ?? "持ち越さない");
    this.finding = finding;
  }
}

/**
 * judgeCarry の判定の間で持ち回る、git・ファイルの読み取りと、集めた理由・注記。
 * @typedef {{ runGit: (repo: string, args: string[]) => string, readBytes: (path: string) => Buffer, findings: string[], notes: string[] }} CarryState
 */

/**
 * CarryState に、確かめた新側リポジトリを足したもの。renderInputDiff が `{ ...state, repo }` で作るので、
 * findings・notes は state と同じ配列である。judgeCarry は state の側から読むので、配列を置き換えずに push で足す。
 * @typedef {CarryState & { repo: string }} GitState
 */

/**
 * 記録の版と今の版（入力の字面と、git で解いた完全な SHA）。
 * @typedef {{ recorded: string, wanted: string, recordedFull: string, wantedFull: string }} CommitRange
 */

/**
 * JSON ファイルを読む。読めない・JSON でなければ理由を返す。
 * @param {(path: string) => Buffer} readBytes
 * @param {string} path
 * @param {string} label
 * @returns {{ ok: true, value: unknown } | { ok: false, message: string }}
 */
function readJsonVia(readBytes, path, label) {
  let text;
  try {
    text = readBytes(path).toString("utf8");
  } catch (e) {
    return { ok: false, message: `${label} を読めない: ${path}（${reasonOf(e)}）` };
  }
  try {
    return { ok: true, value: JSON.parse(text) };
  } catch (e) {
    return { ok: false, message: `${label} が JSON として不正: ${path}（${reasonOf(e)}）` };
  }
}

/**
 * 1. render_inputs を読む。無い・空なら null を返す（従来どおりの閉じた免除）。それ以外の形は読めない入力として止める。
 * @param {unknown} renderInputs
 * @returns {string[] | null}
 */
function renderInputsOf(renderInputs) {
  if (
    renderInputs === undefined ||
    renderInputs === null ||
    (isArray(renderInputs) && renderInputs.length === 0)
  ) {
    return null;
  }
  if (
    !isArray(renderInputs) ||
    !renderInputs.every(nonEmptyString) ||
    renderInputs.some((s) => /^\s*<[\s\S]*>\s*$/.test(s))
  ) {
    throw new CarryStop(
      `replace-metadata.json の new.render_inputs が空でない文字列（git pathspec）の配列でない（雛形のプレースホルダを含む）: ${JSON.stringify(renderInputs)}`,
    );
  }
  return renderInputs;
}

/**
 * 2. 新側リポジトリが渡され、その最上位であることを確かめる。
 * @param {unknown} repoArg
 * @param {CarryState} state
 * @returns {string} 解決したリポジトリのパス
 */
function openRepo(repoArg, state) {
  if (!nonEmptyString(repoArg)) {
    throw new CarryStop(
      "--new-repo（新側リポジトリ）が渡されていないので描画入力の差分を取れない（判定不能を合格にしない）",
    );
  }
  const repo = resolve(repoArg);
  let toplevel;
  try {
    toplevel = state.runGit(repo, ["rev-parse", "--show-toplevel"]).trim();
  } catch (e) {
    throw new CarryStop(`新側リポジトリ ${repo} で git を実行できない: ${reasonOf(e)}`);
  }
  let realRepo = repo;
  let realTop = toplevel;
  try {
    realRepo = realpathSync(repo);
    realTop = realpathSync(toplevel);
  } catch {
    // 解けないなら下の比較で落ちる。
  }
  if (realRepo !== realTop) {
    // pathspec は -C の位置から、--name-only と変更宣言の files はリポジトリ直下から数えるので、
    // 部分ディレクトリを渡すと両者の起点がずれる。
    throw new CarryStop(
      `--new-repo ${repo} がリポジトリの最上位（${toplevel}）でない（変更宣言の files はリポジトリ相対なので起点を揃える）`,
    );
  }
  return repo;
}

/**
 * コミットを解く。解けなければ findings に理由を足して null を返す。
 * @param {GitState} git
 * @param {string} sha
 * @param {string} label
 * @returns {string | null}
 */
function verifyCommit(git, sha, label) {
  // 16 進でない値を git の引数へ渡さない（`-` 始まりがオプションとして読まれる）。
  if (typeof sha !== "string" || !/^[0-9a-fA-F]{4,64}$/.test(sha)) {
    git.findings.push(`${label} ${JSON.stringify(sha)} がコミット SHA（16 進）でない`);
    return null;
  }
  try {
    return git.runGit(git.repo, ["rev-parse", "--verify", "--quiet", `${sha}^{commit}`]).trim();
  } catch {
    git.findings.push(`${label} のコミット ${sha} が新側リポジトリ ${git.repo} に無い`);
    return null;
  }
}

/**
 * pathspec 1 つが、どちらかの版で 1 つ以上のファイルに当たるか。
 * @param {GitState} git
 * @param {string} spec
 * @param {{ emptyTree: string, commits: string[] }} against
 * @returns {boolean}
 */
function specHits(git, spec, { emptyTree, commits }) {
  for (const commit of commits) {
    try {
      const out = git.runGit(git.repo, [
        "diff",
        "-z",
        "--no-renames",
        "--name-only",
        emptyTree,
        commit,
        "--",
        toPathspec(spec),
      ]);
      if (out.split("\0").some((name) => name !== "")) return true;
    } catch (e) {
      throw new CarryStop(
        `描画入力 ${spec} の対象ファイルを数えられない（git diff が失敗）: ${reasonOf(e)}`,
      );
    }
  }
  return false;
}

/**
 * 各 pathspec がどちらかの版で 1 つ以上のファイルに当たることを確かめる。当たらない pathspec（綴り違い・起点違い）は
 * 差分が常に空になり、描画入力が変わっても「差分なし」で持ち越してしまう。空の木からの差分で数える
 * （ls-tree は pathspec の magic を解さない）。
 * @param {GitState} git
 * @param {string[]} renderInputs
 * @param {CommitRange} range
 * @returns {void}
 */
function checkSpecsHit(git, renderInputs, range) {
  let emptyTree;
  try {
    emptyTree = git.runGit(git.repo, ["hash-object", "-t", "tree", "/dev/null"]).trim();
  } catch (e) {
    throw new CarryStop(
      `空の木のオブジェクト名を得られない（git hash-object が失敗）: ${reasonOf(e)}`,
    );
  }
  const commits = [range.wantedFull, range.recordedFull];
  const unmatchedSpecs = renderInputs.filter(
    (spec) => !specHits(git, spec, { emptyTree, commits }),
  );
  if (unmatchedSpecs.length > 0) {
    throw new CarryStop(
      `new.render_inputs の pathspec がどちらの版のファイルにも当たらない: ${unmatchedSpecs.join(", ")}（当たらない描画入力は差分が常に空になり、持ち越しの根拠にならない。新側リポジトリ最上位からの相対で書く）`,
    );
  }
}

/**
 * 3. 描画入力の差分 D。-z で名前を引用させず、--no-renames で移動元も数える。
 * @param {GitState} git
 * @param {string[]} renderInputs
 * @param {CommitRange} range
 * @returns {string[]}
 */
function renderDiff(git, renderInputs, range) {
  try {
    return git
      .runGit(git.repo, [
        "diff",
        "-z",
        "--no-renames",
        "--name-only",
        range.recordedFull,
        range.wantedFull,
        "--",
        ...renderInputs.map(toPathspec),
      ])
      .split("\0")
      .filter((name) => name !== "");
  } catch (e) {
    throw new CarryStop(`描画入力の差分を取れない（git diff が失敗）: ${reasonOf(e)}`);
  }
}

/**
 * evidence-carry.json の中身を carries の一覧にする。
 * @param {Buffer} carryBytes
 * @param {string} carryPath
 * @returns {{ change: string, amend_verify: string | null }[]}
 */
function parseCarries(carryBytes, carryPath) {
  let value;
  try {
    value = JSON.parse(carryBytes.toString("utf8"));
  } catch (e) {
    throw new CarryStop(
      `${EVIDENCE_CARRY_FILE} が JSON として不正: ${carryPath}（${reasonOf(e)}）`,
    );
  }
  if (!isPlainObject(value) || !isArray(value.carries)) {
    throw new CarryStop(
      `${EVIDENCE_CARRY_FILE} が carries 配列を持つオブジェクトでない: ${carryPath}`,
    );
  }
  /** @type {{ change: string, amend_verify: string | null }[]} */
  const carries = [];
  for (const [i, raw] of value.carries.entries()) {
    if (
      !isPlainObject(raw) ||
      !nonEmptyString(raw.change) ||
      !(raw.amend_verify === null || nonEmptyString(raw.amend_verify))
    ) {
      throw new CarryStop(
        `${EVIDENCE_CARRY_FILE} の carries[${i}] が { change: <パス>, amend_verify: <パス> | null } でない: ${JSON.stringify(raw)}`,
      );
    }
    carries.push({ change: raw.change, amend_verify: raw.amend_verify });
  }
  return carries;
}

/**
 * 4. evidence-carry.json を読む。無ければ空の一覧を返し、注記を残す。
 * @param {string} carryPath
 * @param {CarryState} state
 * @returns {{ change: string, amend_verify: string | null }[]}
 */
function readCarries(carryPath, state) {
  /** @type {Buffer} */
  let carryBytes;
  try {
    carryBytes = state.readBytes(carryPath);
  } catch (e) {
    // 無いのは「持ち越しの宣言が無い」。D が空でない以上、どのファイルも説明できずに下で落ちる。
    // 無い以外の読めなさ（権限等）は宣言の有無が分からないので落とす。
    if (!(e instanceof Error && "code" in e && e.code === "ENOENT")) {
      throw new CarryStop(`${EVIDENCE_CARRY_FILE} を読めない: ${carryPath}（${reasonOf(e)}）`);
    }
    state.notes.push(`${carryPath} が無い（持ち越しに使う変更宣言が無い）`);
    return [];
  }
  return parseCarries(carryBytes, carryPath);
}

/**
 * carries が指す変更宣言を読み、検証する。
 * @param {{ change: string, amend_verify: string | null }[]} carries
 * @param {(p: string) => string} fromProject
 * @param {CarryState} state
 * @returns {{ path: string, amendVerify: string | null, change: CarryChange }[]}
 */
function readDeclared(carries, fromProject, state) {
  /** @type {{ path: string, amendVerify: string | null, change: CarryChange }[]} */
  const declared = [];
  for (const carry of carries) {
    const path = fromProject(carry.change);
    const read = readJsonVia(state.readBytes, path, "変更宣言");
    if (!read.ok) throw new CarryStop(read.message);
    const errors = validateChange(read.value);
    if (errors.length > 0) {
      throw new CarryStop(`変更宣言 ${path} が不正: ${errors.join(" / ")}`);
    }
    const change = read.value;
    // validateChange が誤りを返さなかった宣言は、この形を必ず満たす（到達しない分岐）
    if (!isCarryChange(change)) throw new CarryStop(`変更宣言 ${path} が不正: 読む欄の形が違う`);
    declared.push({
      path,
      amendVerify: carry.amend_verify,
      change,
    });
  }
  return declared;
}

/**
 * D の各ファイルが、どれかの変更宣言の files に含まれることを確かめ、差分に触れる宣言を返す。
 * @param {string[]} changed
 * @param {{ path: string, amendVerify: string | null, change: CarryChange }[]} declared
 * @param {{ range: CommitRange, state: CarryState }} ctx
 * @returns {{ path: string, amendVerify: string | null, change: CarryChange }[]}
 */
function usedDeclarations(changed, declared, { range, state }) {
  const uncovered = changed.filter((file) => !declared.some((d) => d.change.files.includes(file)));
  if (uncovered.length > 0) {
    throw new CarryStop(
      `描画入力の差分（${range.recorded} → ${range.wanted}）に、どの変更宣言の files にも無いファイルがある: ${uncovered.join(", ")}（宣言外の変更は持ち越さない）`,
    );
  }
  const used = declared.filter((d) => d.change.files.some((file) => changed.includes(file)));
  for (const d of declared) {
    if (!used.includes(d))
      state.notes.push(`変更宣言 ${d.change.id} はこの差分に触れないので使わない: ${d.path}`);
  }
  return used;
}

/**
 * そのコミットでのファイルの blob（無ければ "absent"）。
 * @param {GitState} git
 * @param {string} commit
 * @param {string} file
 * @returns {string}
 */
function blobOf(git, commit, file) {
  try {
    return git.runGit(git.repo, ["rev-parse", "--verify", "--quiet", `${commit}:${file}`]).trim();
  } catch {
    // コミットは実在を確かめ済みなので、失敗はそのパスが無いこと。
    return "absent";
  }
}

/**
 * start から辺（from → to）を辿って goal に着けるか。
 * @param {string[][]} edges
 * @param {string} start
 * @param {string} goal
 * @returns {boolean}
 */
function reaches(edges, start, goal) {
  const reached = new Set([start]);
  let grew = true;
  while (grew && !reached.has(goal)) {
    grew = false;
    for (const [from, to] of edges) {
      if (reached.has(from) && !reached.has(to)) {
        reached.add(to);
        grew = true;
      }
    }
  }
  return reached.has(goal);
}

/**
 * 各ファイルの記録の版 → 今の版の変化が、宣言した改修（before → after の blob）の連鎖で辿れるか。
 * files に名前があるだけの古い宣言で、その後の宣言外の編集を持ち越さない。辿れないファイルは findings に足す。
 * @param {GitState} git
 * @param {{ changed: string[], used: { change: CarryChange }[], range: CommitRange }} diff
 * @returns {void}
 */
function checkChains(git, { changed, used, range }) {
  for (const file of changed) {
    const edges = used
      .filter((d) => d.change.files.includes(file))
      .map((d) => [
        blobOf(git, d.change.commits.before, file),
        blobOf(git, d.change.commits.after, file),
      ]);
    const start = blobOf(git, range.recordedFull, file);
    const goal = blobOf(git, range.wantedFull, file);
    if (!reaches(edges, start, goal)) {
      git.findings.push(
        `${file} の変化（${range.recorded} → ${range.wanted}）を変更宣言（${used
          .filter((d) => d.change.files.includes(file))
          .map((d) => d.change.id)
          .join(
            ", ",
          )}）の commits.before → after の連鎖で説明できない（宣言の前後に宣言外の編集がある）`,
      );
    }
  }
}

/**
 * 機能の metadata.json を決める。input.featureMetadata が無ければ replaceRoot から読む。
 * @param {{ featureSlug: string, featureMetadata?: unknown }} input
 * @param {string} replaceRoot
 * @param {CarryState} state
 * @returns {unknown}
 */
function featureMetadataOf(input, replaceRoot, state) {
  if (input.featureMetadata !== undefined) return input.featureMetadata;
  // slug が空だと join が .replace/parity/metadata.json に潰れ、読めない理由が別のパスを指す
  if (typeof input.featureSlug !== "string" || input.featureSlug.trim() === "") {
    throw new CarryStop(
      "機能の slug が分からない（--metadata を渡すか、component-coverage.json の slug を確かめる）",
    );
  }
  const path = join(replaceRoot, "parity", input.featureSlug, "metadata.json");
  const read = readJsonVia(state.readBytes, path, "機能の metadata.json");
  if (!read.ok) throw new CarryStop(read.message);
  return read.value;
}

/**
 * unmatched_instances の判定に使う全機能のページ（component-impact.mjs の --feature 実行と同じ扱い）。
 * 他の機能のページにある影響インスタンスを「どこにも一致しない」に数えない。読めない metadata は足さないだけ
 * （一致しないインスタンスが残れば、持ち越さないと判定される）。
 * @param {unknown} featureMetadata
 * @param {string} featureSlug
 * @param {{ replaceRoot: string, readBytes: (path: string) => Buffer }} where
 * @returns {unknown[]}
 */
function pageUniverseOf(featureMetadata, featureSlug, { replaceRoot, readBytes }) {
  /** @type {unknown[]} */
  const pageUniverse = [featureMetadata];
  const parityDir = join(replaceRoot, "parity");
  /** @type {string[]} */
  let featureDirs = [];
  try {
    featureDirs = readdirSync(parityDir, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .sort();
  } catch {
    // 読めなければこの機能のページだけで数える（一致しないものは、持ち越さないと判定される）。
  }
  for (const name of featureDirs) {
    if (name === featureSlug) continue;
    const read = readJsonVia(
      readBytes,
      join(parityDir, name, "metadata.json"),
      "機能の metadata.json",
    );
    if (read.ok) pageUniverse.push(read.value);
  }
  return pageUniverse;
}

/**
 * 5 の判定で、使う変更宣言ごとに共通に読む値。
 * @typedef {CarryState & {
 *   featureSlug: string,
 *   featureMetadata: unknown,
 *   pageUniverse: unknown[],
 *   replaceRoot: string,
 *   stageDir: string,
 *   fromProject: (p: string) => string,
 * }} ImpactContext
 */

/**
 * 使う変更宣言 1 つの影響を再計算し、この機能に影響する組を返す。影響しない・判定できないなら理由を残して null を返す。
 * @param {{ change: CarryChange }} d
 * @param {ImpactContext} ctx
 * @returns {{ pair: string, region_known: boolean, instances: {id:string, locator:unknown}[] }[] | null}
 */
function affectedPairsOf(d, ctx) {
  const { findings } = ctx;
  const id = String(d.change.id);
  // 部品側の照合（宣言した範囲の外は差分ゼロ・範囲の中は現行と一致）が通っていない宣言は、
  // 範囲の外にも影響している疑いがあるので、影響の計算そのものを根拠にできない
  const catalog = d.change.catalog_verification;
  if (catalog.outside_scope_identical !== true || catalog.inside_matches_current !== true) {
    findings.push(
      `変更宣言 ${id} の catalog_verification が合格していない（outside_scope_identical: ${JSON.stringify(catalog.outside_scope_identical)}、inside_matches_current: ${JSON.stringify(catalog.inside_matches_current)}）。部品の照合が通ってから持ち越す（parity-component の references/amend.md）`,
    );
    return null;
  }
  const componentPath = join(ctx.replaceRoot, "components", String(d.change.slug), "metadata.json");
  const component = readJsonVia(ctx.readBytes, componentPath, "部品 metadata.json");
  if (!component.ok) {
    findings.push(`変更宣言 ${id}: ${component.message}`);
    return null;
  }
  let impact;
  try {
    impact = computeImpact({
      change: d.change,
      componentMetadata: component.value,
      features: [{ slug: ctx.featureSlug, metadata: ctx.featureMetadata }],
      pageUniverse: ctx.pageUniverse,
    });
  } catch (e) {
    findings.push(`変更宣言 ${id} の影響を計算できない: ${reasonOf(e)}`);
    return null;
  }
  return pairsFromImpact(id, impact, ctx);
}

/**
 * computeImpact の結果から、この機能に影響する組を取り出す。一致しないインスタンス・usages、判定不能、影響なしは null。
 * @param {string} id
 * @param {ReturnType<typeof computeImpact>} impact
 * @param {CarryState} state
 * @returns {{ pair: string, region_known: boolean, instances: {id:string, locator:unknown}[] }[] | null}
 */
function pairsFromImpact(id, impact, state) {
  const { findings, notes } = state;
  const feature = impact.features[0];
  if (impact.unmatched_instances.length > 0) {
    // どの機能（.replace/parity/*/metadata.json）のページとも一致しない影響インスタンスは、
    // 未着手の機能のページか path の書き方の食い違いかを区別できない。後者ならこの機能の
    // 「影響なし」は誤りなので、component-impact.mjs の全機能実行（exit 1）と同じく持ち越さない。
    findings.push(
      `変更宣言 ${id} の影響インスタンスがどの機能のページとも一致しない: ${impact.unmatched_instances
        .map((u) => `${u.id}（${u.page}）`)
        .join(
          ", ",
        )}（path の書き方の食い違いを「影響なし」として扱わない。component-impact.mjs を全機能で回して確かめる）`,
    );
    return null;
  }
  if (impact.unmatched_usages.length > 0) {
    // usages も同じ理由で持ち越さない（綴り違いの usages は、使っているページを「影響なし」と判定させる）
    findings.push(
      `変更宣言 ${id} の usages がどの機能のページとも一致しない: ${impact.unmatched_usages.join(", ")}（component-impact.mjs を全機能で回して確かめる）`,
    );
    return null;
  }
  if (feature.verdict === "undeterminable") {
    findings.push(`変更宣言 ${id} の影響を判定できない: ${feature.reasons.join(" / ")}`);
    return null;
  }
  if (feature.verdict === "unaffected") {
    notes.push(`変更宣言 ${id} はこの機能に影響しない: ${feature.reasons.join(" / ")}`);
    return null;
  }
  // affected。
  return feature.pairs;
}

/**
 * 影響する組を機械判定で持ち越せる宣言か確かめ、amend-verify の記録を読む。持ち越せないなら理由を残して null を返す。
 * @param {{ amendVerify: string | null, change: CarryChange }} d
 * @param {{ pair: string, region_known: boolean }[]} pairs
 * @param {ImpactContext} ctx
 * @returns {{ r: Record<string, unknown> & { pairs: unknown[] }, recordPath: string } | null}
 */
function amendRecordOf(d, pairs, ctx) {
  const { findings } = ctx;
  const id = String(d.change.id);
  // 機械判定（amend-verify）の合格条件は「現行へ近づいた」なので、現行に合わせ直す修正にしか意味を持たない。
  // new-appearance は満たすべき条件が宣言から決まらず、合格しても従来のトリアージを省く根拠にならない
  if (d.change.kind !== "align-to-current") {
    findings.push(
      `変更宣言 ${id} は kind: ${JSON.stringify(d.change.kind)} で、この機能に影響する（${pairs.map((p) => p.pair).join(", ")}）。機械判定で持ち越せるのは align-to-current だけ（従来のトリアージへ回す。parity-diff の references/component-change.md）`,
    );
    return null;
  }
  const unknownRegion = pairs.filter((p) => p.region_known !== true).map((p) => p.pair);
  if (unknownRegion.length > 0) {
    findings.push(
      `変更宣言 ${id} の影響する組 ${unknownRegion.join(", ")} は usages だけで一致し領域が分からない（amend-verify で機械判定できないので持ち越さない。従来のトリアージへ回す）`,
    );
    return null;
  }
  if (d.amendVerify === null) {
    findings.push(
      `変更宣言 ${id} はこの機能に影響する（${pairs.map((p) => p.pair).join(", ")}）のに evidence-carry.json の amend_verify が null`,
    );
    return null;
  }
  const recordPath = ctx.fromProject(d.amendVerify);
  const record = readJsonVia(ctx.readBytes, recordPath, "amend-verify の記録");
  if (!record.ok) {
    findings.push(`変更宣言 ${id}: ${record.message}`);
    return null;
  }
  const r = record.value;
  if (!isPlainObject(r) || r.tool !== AMEND_VERIFY_TOOL || !isArray(r.pairs)) {
    findings.push(
      `amend-verify の記録の形でない（tool: ${AMEND_VERIFY_TOOL} と pairs 配列が要る）: ${recordPath}`,
    );
    return null;
  }
  if (r.change_id !== id) {
    findings.push(
      `amend-verify の記録の change_id（${JSON.stringify(r.change_id)}）が変更宣言 ${id} と違う（--change-id ${id} で記録し直す）: ${recordPath}`,
    );
    return null;
  }
  return { r: { ...r, pairs: r.pairs }, recordPath };
}

/**
 * amend-verify の組の 3 つの入力画像の sha256 が、記録したものと今のファイルで一致するか。食い違いは findings に足す。
 * @param {Record<string, unknown>} entry
 * @param {{ pair: string, recordPath: string }} at
 * @param {ImpactContext} ctx
 * @returns {void}
 */
function checkInputHashes(entry, { pair, recordPath }, ctx) {
  const { findings } = ctx;
  for (const key of ["prev_new", "new", "current"]) {
    const ref = isPlainObject(entry.inputs) ? entry.inputs[key] : undefined;
    if (!isPlainObject(ref) || !nonEmptyString(ref.path) || !nonEmptyString(ref.sha256)) {
      findings.push(
        `amend-verify の組 ${pair} の inputs.${key} に path / sha256 が無い: ${recordPath}`,
      );
      continue;
    }
    const imagePath = ctx.fromProject(ref.path);
    let actual;
    try {
      actual = createHash("sha256").update(ctx.readBytes(imagePath)).digest("hex");
    } catch (e) {
      findings.push(
        `amend-verify の組 ${pair} の inputs.${key} を読めない: ${imagePath}（${reasonOf(e)}）`,
      );
      continue;
    }
    if (actual !== ref.sha256) {
      findings.push(
        `amend-verify の組 ${pair} の inputs.${key} が判定後に変わっている（sha256 ${ref.sha256} ≠ 今の ${actual}）: ${imagePath}`,
      );
    }
  }
}

/**
 * 影響する組 1 つを、amend-verify の記録で確かめる。持ち越せない理由は findings に足す。
 * @param {{ pair: string, id: string, change: CarryChange, pairs: { pair: string, instances?: {id:string, locator:unknown}[] }[], r: { pairs: unknown[] }, recordPath: string }} target
 * @param {ImpactContext} ctx
 * @returns {void}
 */
function checkRecordPair({ pair, id, change, pairs, r, recordPath }, ctx) {
  const { findings } = ctx;
  const entries = r.pairs.filter((e) => isPlainObject(e) && e.pair === pair);
  if (entries.length !== 1) {
    findings.push(
      `amend-verify の記録に組 ${pair} が ${entries.length === 0 ? "無い" : "2 つ以上ある"}（変更宣言 ${id} の影響する組を覆っていない）: ${recordPath}`,
    );
    return;
  }
  const entry = entries[0];
  // entries は isPlainObject で絞った要素だけを持つ（到達しない分岐）
  if (!isPlainObject(entry)) return;
  if (entry.pass !== true) {
    findings.push(
      `amend-verify の組 ${pair} が pass でない（${isArray(entry.reasons) ? entry.reasons.join("; ") : "理由なし"}）: ${recordPath}`,
    );
    return;
  }
  const problem =
    checkVerdict(entry) ??
    checkProvenance(entry, pair, {
      changeId: id,
      stageDir: ctx.stageDir,
      currentRoot: resolve(ctx.replaceRoot, "parity", ctx.featureSlug, "baseline"),
      fromProject: ctx.fromProject,
    }) ??
    checkGeometry(entry, change, {
      instances: pairInstances(pairs, pair),
      fromProject: ctx.fromProject,
      readBytes: ctx.readBytes,
    });
  if (problem !== null) {
    findings.push(`amend-verify の組 ${pair}: ${problem}: ${recordPath}`);
    return;
  }
  checkInputHashes(entry, { pair, recordPath }, ctx);
}

/**
 * 5. 使う変更宣言 1 つについて、影響の再計算と amend-verify の記録を確かめる。持ち越せない理由は findings に足す。
 * @param {{ amendVerify: string | null, change: CarryChange }} d
 * @param {ImpactContext} ctx
 * @returns {void}
 */
function checkUsedChange(d, ctx) {
  const pairs = affectedPairsOf(d, ctx);
  if (pairs === null) return;
  const record = amendRecordOf(d, pairs, ctx);
  if (record === null) return;
  const id = String(d.change.id);
  for (const { pair } of pairs) {
    checkRecordPair({ pair, id, change: d.change, pairs, ...record }, ctx);
  }
}

/**
 * 1〜3: render_inputs・リポジトリ・コミットを確かめ、描画入力の差分 D を取る。従来どおり（legacy）なら null。
 * @param {Parameters<typeof judgeCarry>[0]} input
 * @param {CarryState} state
 * @returns {{ renderInputs: string[], git: GitState, range: CommitRange, changed: string[] } | null}
 */
function renderInputDiff(input, state) {
  const renderInputs = renderInputsOf(input.renderInputs);
  if (renderInputs === null) return null;
  const recorded = String(input.recordedCommit).trim();
  const wanted = String(input.wantedCommit).trim();
  const git = { ...state, repo: openRepo(input.repo, state) };
  const recordedFull = verifyCommit(git, recorded, "記録した版");
  const wantedFull = verifyCommit(git, wanted, "今の版");
  if (recordedFull === null || wantedFull === null) throw new CarryStop(null);
  const range = { recorded, wanted, recordedFull, wantedFull };
  checkSpecsHit(git, renderInputs, range);
  return { renderInputs, git, range, changed: renderDiff(git, renderInputs, range) };
}

/**
 * 4. evidence-carry.json と変更宣言を読み、描画入力の差分 D を宣言した改修で説明できることを確かめる。
 * @param {Parameters<typeof judgeCarry>[0]} input
 * @param {{ git: GitState, range: CommitRange, changed: string[] }} diff
 * @returns {{ replaceRoot: string, fromProject: (p: string) => string, used: { amendVerify: string | null, change: CarryChange }[] }}
 */
function explainedChanges(input, { git, range, changed }) {
  const replaceRoot = nonEmptyString(input.replaceRoot) ? resolve(input.replaceRoot) : null;
  if (replaceRoot === null) {
    throw new CarryStop(
      "--replace-root（.replace ディレクトリ）を決められないので変更宣言・部品 metadata を読めない（判定不能を合格にしない）",
    );
  }
  const projectRoot = dirname(replaceRoot);
  /** @param {string} p */
  const fromProject = (p) => (isAbsolute(p) ? p : resolve(projectRoot, p));
  const carries = readCarries(input.evidenceCarryPath, git);
  const declared = readDeclared(carries, fromProject, git);
  const used = usedDeclarations(changed, declared, { range, state: git });

  // 使う変更宣言のコミットが実在するか。
  for (const d of used) {
    /** @type {Array<"before" | "after">} */
    const sides = ["before", "after"];
    for (const side of sides) {
      verifyCommit(git, d.change.commits[side], `変更宣言 ${d.change.id} の commits.${side}`);
    }
  }
  if (git.findings.length > 0) throw new CarryStop(null);
  checkChains(git, { changed, used, range });
  if (git.findings.length > 0) throw new CarryStop(null);
  return { replaceRoot, fromProject, used };
}

/**
 * 持ち越しを判定する（CarryStop で止まったら、呼び出し元の judgeCarry が持ち越さない結果にする）。
 * @param {Parameters<typeof judgeCarry>[0]} input
 * @param {CarryState} state
 * @returns {{ ok: boolean, legacy: boolean, findings: string[], notes: string[], carried_by: string[] }}
 */
function judgeCarryOrStop(input, state) {
  const { notes } = state;
  const diff = renderInputDiff(input, state);
  if (diff === null) {
    return { ok: false, legacy: true, findings: [], notes: [LEGACY_HINT], carried_by: [] };
  }
  const { renderInputs, range, changed } = diff;
  if (changed.length === 0) {
    notes.push(
      `新側のコミットは違う（${range.recorded} → ${range.wanted}）が、描画入力（${renderInputs.join(", ")}）に差分が無いので証跡を持ち越す`,
    );
    return { ok: true, legacy: false, findings: [], notes, carried_by: [] };
  }

  const { replaceRoot, fromProject, used } = explainedChanges(input, diff);

  // 5. 影響の再計算と amend-verify の記録。
  const featureMetadata = featureMetadataOf(input, replaceRoot, state);
  /** @type {ImpactContext} */
  const ctx = {
    ...state,
    featureSlug: input.featureSlug,
    featureMetadata,
    pageUniverse: pageUniverseOf(featureMetadata, input.featureSlug, {
      replaceRoot,
      readBytes: state.readBytes,
    }),
    replaceRoot,
    stageDir: resolve(dirname(input.evidenceCarryPath)),
    fromProject,
  };
  for (const d of used) checkUsedChange(d, ctx);
  if (state.findings.length > 0) throw new CarryStop(null);
  const carriedBy = used.map((d) => String(d.change.id));
  notes.push(
    `新側のコミットは違う（${range.recorded} → ${range.wanted}）が、描画入力の差分（${changed.join(", ")}）は変更宣言 ${carriedBy.join(", ")} で説明でき、影響する組は amend-verify で pass なので証跡を持ち越す`,
  );
  return { ok: true, legacy: false, findings: [], notes, carried_by: carriedBy };
}

/**
 * 持ち越しを判定する。
 *
 * @param {{
 *   recordedCommit: string,
 *   wantedCommit: string,
 *   renderInputs: unknown,
 *   repo: string | null | undefined,
 *   evidenceCarryPath: string,
 *   featureSlug: string,
 *   featureMetadata?: unknown,
 *   replaceRoot: string | null | undefined,
 *   runGit?: (repo: string, args: string[]) => string,
 *   readBytes?: (path: string) => Buffer,
 * }} input
 * @returns {{ ok: boolean, legacy: boolean, findings: string[], notes: string[], carried_by: string[] }}
 */
export function judgeCarry(input) {
  /** @type {CarryState} */
  const state = {
    runGit: input.runGit ?? defaultRunGit,
    readBytes: input.readBytes ?? ((p) => readFileSync(p)),
    findings: [],
    notes: [],
  };
  try {
    return judgeCarryOrStop(input, state);
  } catch (e) {
    if (!(e instanceof CarryStop)) throw e;
    const findings = e.finding === null ? state.findings : [...state.findings, e.finding];
    return { ok: false, legacy: false, findings, notes: state.notes, carried_by: [] };
  }
}
