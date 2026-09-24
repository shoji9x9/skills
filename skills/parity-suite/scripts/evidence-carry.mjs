// 新側のコミットが変わった証跡を、ページの描画入力の差分で持ち越せるかを判定する（正本）。Issue #454。
//
// 何のためか: 証跡（diff-metadata.json の new.commit・component-comparison.json の new_implementation.commit）は
// 新側リポジトリ全体のコミット SHA に結びついている。共通部品を 1 行直すと、その部品を使うかどうかに関わらず
// 全ページの証跡が「古い」になる。ここでは SHA の不一致を即失効にせず、次を全部確かめられたときだけ持ち越す。
//   1. そのページの描画に効くファイル（replace-metadata.json の new.render_inputs。git pathspec）の差分 D を取る
//   2. D が空なら描画入力は変わっていない → 持ち越す
//   3. D の各ファイルが、evidence-carry.json の carries が指す変更宣言（parity-component の
//      component-change.json）の files のどれかに含まれ、かつ記録の版から今の版までのそのファイルの変化が
//      宣言した改修（commits.before → commits.after）の連鎖で説明できる（宣言の後に宣言外の編集が無い）
//   4. 使った変更宣言ごとに component-impact.mjs の computeImpact をこの機能で再計算し、
//      影響なし → 持ち越す／影響あり → amend-verify.mjs の記録が影響する組を全部覆い、全組 pass で、
//      記録した入力画像の sha256 が今のファイルと一致する → 持ち越す／判定不能 → 落とす
//
// 呼び出し元: artifact-health-check.mjs の checkStage と component-comparison-check.mjs の
// comparison-implementation-stale。**2 つの検査器は同じ入力に同じ判定を出す**——どちらもこの関数だけで
// 持ち越しを決め、独自の緩和を足さない。
//
// fail-closed: リポジトリが無い・git が失敗する・コミットが無い・変更宣言が読めない／不正・影響が判定不能・
// amend-verify の記録が無い／読めない・組が覆われていない・pass でない・sha256 が一致しない、のどれも
// 持ち越さない。render_inputs が無い・空のときだけは判定せず `legacy: true` を返し、呼び出し元は
// 従来どおり SHA の不一致として落とす（後方互換。持ち越しは描画入力を宣言した記録にだけ効く）。
//
// パスの解決（正本）: evidence-carry.json の change / amend_verify と、amend-verify の記録の inputs.*.path は、
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
import { computeImpact, validateChange } from "./component-impact.mjs";

/**
 * ツールのバージョン（正本）。判定規則を変えたら上げる。
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
  "replace-metadata.json に new.render_inputs（ページの描画に効くファイルの git pathspec）が無いので、証跡を描画入力の差分で持ち越せない（部品の改修で持ち越すなら parity-replace で render_inputs を記録する）";

/**
 * @param {unknown} v
 * @returns {v is string}
 */
function nonEmptyString(v) {
  return typeof v === "string" && v.trim() !== "";
}

/**
 * @param {unknown} v
 * @returns {v is Record<string, unknown>}
 */
function isPlainObject(v) {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/**
 * 既定の git 起動。stdin は閉じ、stdout を文字列で返す。失敗は例外（呼び出し側で fail-closed にする）。
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
  const err = /** @type {{ stderr?: unknown, message?: unknown }} */ (e ?? {});
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
 * 影響する組の影響インスタンス（論理名）。
 * @param {{pair:string, instances?: {id:string, locator:string}[]}[]} pairs
 * @param {string} pair
 * @returns {{id:string, locator:string}[]}
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
  const v = /** @type {Record<string, unknown>} */ (r);
  const nums = [v.x, v.y, v.width, v.height];
  if (!nums.every((n) => typeof n === "number" && Number.isFinite(n))) return null;
  return nums.join(",");
}

/**
 * amend-verify の組の判定に使った幾何（margin と領域）が、変更宣言と新側の採取物に結びついているか。
 * 画像の sha256 は画像を認証するだけで、判定を弱める margin・領域（画面全体など）を認証しない。
 * margin は宣言の margin_px と一致し、領域（広げる前の declared_regions）は撮り直した新側の組の
 * traits.json（inputs.new と同じディレクトリ）にある影響インスタンスの論理名の rect と一致することを求める。
 * @param {Record<string, any>} entry
 * @param {Record<string, any>} change
 * @param {{id:string, locator:string}[]} instances
 * @param {(p: string) => string} fromProject
 * @param {(p: string) => Buffer} readBytes
 * @returns {string | null} 不合格の理由（合格なら null）
 */
function checkGeometry(entry, change, instances, fromProject, readBytes) {
  if (entry.margin !== change.margin_px) {
    return `margin ${JSON.stringify(entry.margin)} が変更宣言の margin_px ${JSON.stringify(change.margin_px)} と違う（判定を弱めた記録で持ち越さない）`;
  }
  if (instances.length === 0) return "影響インスタンスが無く、領域を採取物と突き合わせられない";
  const newPath = isPlainObject(entry.inputs) ? entry.inputs.new?.path : undefined;
  if (!nonEmptyString(newPath)) return "inputs.new.path が無く、traits.json を引けない";
  const traitsPath = join(dirname(fromProject(newPath)), "traits.json");
  let traits;
  try {
    traits = JSON.parse(readBytes(traitsPath).toString("utf8"));
  } catch (e) {
    return `新側の traits.json を読めない（inputs.new には撮り直した組の screenshot.png を渡す）: ${traitsPath}（${reasonOf(e)}）`;
  }
  if (!Array.isArray(traits)) return `新側の traits.json が配列でない: ${traitsPath}`;
  /** @type {string[]} */
  const expected = [];
  for (const { locator } of instances) {
    const found = traits.filter((t) => isPlainObject(t) && t.name === locator);
    const key = found.length === 1 ? rectKey(found[0].rect) : null;
    if (key === null) {
      return `新側の traits.json に影響インスタンスの論理名 ${JSON.stringify(locator)} の rect が 1 件だけある形でない（${found.length} 件）: ${traitsPath}`;
    }
    expected.push(key);
  }
  const declared = Array.isArray(entry.declared_regions) ? entry.declared_regions.map(rectKey) : [];
  if (declared.some((k) => k === null) || declared.length === 0) {
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
 * amend-verify の組の 3 つの入力が、それぞれの役割の採取物を指しているか。
 * 画像の sha256 は「そのパスのバイト」を認証するだけで、役割を認証しない（撮り直した新側を 3 つ全部に渡しても
 * 判定は合格し、ハッシュも一致する）。役割ごとに置き場所を固定して突き合わせる:
 * - new: `<stage>/baseline-new/<page>/<state>/<viewport>/screenshot.png`（撮り直した組そのもの）
 * - prev_new: `<stage>/pre-change/<change-id>/<page>/<state>/<viewport>/screenshot.png`（撮る前に写した改修前の新側）
 * - current: `<replaceRoot>/parity/<slug>/baseline/` の下（現側の基準。その下の並びは採取スペックが決める）
 * `<stage>` は evidence-carry.json のあるディレクトリ（new/<target>/）。
 * @param {Record<string, any>} entry
 * @param {string} pair
 * @param {string} changeId
 * @param {{ stageDir: string, currentRoot: string, fromProject: (p: string) => string }} where
 * @returns {string | null} 不合格の理由（合格なら null）
 */
function checkProvenance(entry, pair, changeId, where) {
  const [page, state, viewport] = pair.split("|");
  const inputs = isPlainObject(entry.inputs) ? entry.inputs : {};
  const at = (key) =>
    nonEmptyString(inputs[key]?.path) ? where.fromProject(inputs[key].path) : null;
  const expectedNew = join(where.stageDir, "baseline-new", page, state, viewport, "screenshot.png");
  const expectedPrev = join(
    where.stageDir,
    "pre-change",
    changeId,
    page,
    state,
    viewport,
    "screenshot.png",
  );
  if (at("new") !== expectedNew) {
    return `inputs.new が撮り直した組の採取物（${expectedNew}）でない: ${at("new")}`;
  }
  if (at("prev_new") !== expectedPrev) {
    return `inputs.prev_new が撮る前に写した改修前の新側（${expectedPrev}）でない: ${at("prev_new")}`;
  }
  const current = at("current");
  if (current === null || !current.startsWith(where.currentRoot + sep)) {
    return `inputs.current が現側の基準（${where.currentRoot}${sep} の下）でない: ${current}`;
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
  const runGit = input.runGit ?? defaultRunGit;
  const readBytes = input.readBytes ?? ((p) => readFileSync(p));
  /** @type {string[]} */
  const findings = [];
  /** @type {string[]} */
  const notes = [];
  /**
   * @param {string} message
   */
  const fail = (message) => ({
    ok: false,
    legacy: false,
    findings: [...findings, message],
    notes,
    carried_by: /** @type {string[]} */ ([]),
  });

  // 1. render_inputs。無い・空だけが従来どおり（閉じた免除）。それ以外の形は読めない入力として落とす。
  const renderInputs = input.renderInputs;
  if (
    renderInputs === undefined ||
    renderInputs === null ||
    (Array.isArray(renderInputs) && renderInputs.length === 0)
  ) {
    return { ok: false, legacy: true, findings: [], notes: [LEGACY_HINT], carried_by: [] };
  }
  if (
    !Array.isArray(renderInputs) ||
    !renderInputs.every((s) => nonEmptyString(s) && !/^\s*<[\s\S]*>\s*$/.test(s))
  ) {
    return fail(
      `replace-metadata.json の new.render_inputs が空でない文字列（git pathspec）の配列でない（雛形のプレースホルダを含む）: ${JSON.stringify(renderInputs)}`,
    );
  }
  const recorded = String(input.recordedCommit).trim();
  const wanted = String(input.wantedCommit).trim();

  // 2. リポジトリとコミット。
  if (!nonEmptyString(input.repo)) {
    return fail(
      "--new-repo（新側リポジトリ）が渡されていないので描画入力の差分を取れない（判定不能を合格にしない）",
    );
  }
  const repo = resolve(input.repo);
  let toplevel;
  try {
    toplevel = runGit(repo, ["rev-parse", "--show-toplevel"]).trim();
  } catch (e) {
    return fail(`新側リポジトリ ${repo} で git を実行できない: ${reasonOf(e)}`);
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
    return fail(
      `--new-repo ${repo} がリポジトリの最上位（${toplevel}）でない（変更宣言の files はリポジトリ相対なので起点を揃える）`,
    );
  }
  /**
   * @param {string} sha
   * @param {string} label
   * @returns {string | null} 解けなければ null
   */
  const verifyCommit = (sha, label) => {
    // 16 進でない値を git の引数へ渡さない（`-` 始まりがオプションとして読まれる）。
    if (typeof sha !== "string" || !/^[0-9a-fA-F]{4,64}$/.test(sha)) {
      findings.push(`${label} ${JSON.stringify(sha)} がコミット SHA（16 進）でない`);
      return null;
    }
    try {
      return runGit(repo, ["rev-parse", "--verify", "--quiet", `${sha}^{commit}`]).trim();
    } catch {
      findings.push(`${label} のコミット ${sha} が新側リポジトリ ${repo} に無い`);
      return null;
    }
  };
  const recordedFull = verifyCommit(recorded, "記録した版");
  const wantedFull = verifyCommit(wanted, "今の版");
  if (recordedFull === null || wantedFull === null) {
    return { ok: false, legacy: false, findings, notes, carried_by: [] };
  }

  // 各 pathspec がどちらかの版で 1 つ以上のファイルに当たるか。当たらない pathspec（綴り違い・起点違い）は
  // 差分が常に空になり、描画入力が変わっても「差分なし」で持ち越してしまう。空の木からの差分で数える
  // （ls-tree は pathspec の magic を解さない）。
  let emptyTree;
  try {
    emptyTree = runGit(repo, ["hash-object", "-t", "tree", "/dev/null"]).trim();
  } catch (e) {
    return fail(`空の木のオブジェクト名を得られない（git hash-object が失敗）: ${reasonOf(e)}`);
  }
  /** @type {string[]} */
  const unmatchedSpecs = [];
  for (const spec of renderInputs) {
    let hit = false;
    for (const commit of [wantedFull, recordedFull]) {
      try {
        const out = runGit(repo, [
          "diff",
          "-z",
          "--no-renames",
          "--name-only",
          emptyTree,
          commit,
          "--",
          toPathspec(spec),
        ]);
        if (out.split("\0").some((name) => name !== "")) {
          hit = true;
          break;
        }
      } catch (e) {
        return fail(
          `描画入力 ${spec} の対象ファイルを数えられない（git diff が失敗）: ${reasonOf(e)}`,
        );
      }
    }
    if (!hit) unmatchedSpecs.push(spec);
  }
  if (unmatchedSpecs.length > 0) {
    return fail(
      `new.render_inputs の pathspec がどちらの版のファイルにも当たらない: ${unmatchedSpecs.join(", ")}（当たらない描画入力は差分が常に空になり、持ち越しの根拠にならない。新側リポジトリ最上位からの相対で書く）`,
    );
  }

  // 3. 描画入力の差分 D。-z で名前を引用させず、--no-renames で移動元も数える。
  /** @type {string[]} */
  let changed;
  try {
    changed = runGit(repo, [
      "diff",
      "-z",
      "--no-renames",
      "--name-only",
      recordedFull,
      wantedFull,
      "--",
      ...renderInputs.map(toPathspec),
    ])
      .split("\0")
      .filter((name) => name !== "");
  } catch (e) {
    return fail(`描画入力の差分を取れない（git diff が失敗）: ${reasonOf(e)}`);
  }
  if (changed.length === 0) {
    notes.push(
      `新側のコミットは違う（${recorded} → ${wanted}）が、描画入力（${renderInputs.join(", ")}）に差分が無いので証跡を持ち越す`,
    );
    return { ok: true, legacy: false, findings: [], notes, carried_by: [] };
  }

  // 4. evidence-carry.json と変更宣言。
  const replaceRoot = nonEmptyString(input.replaceRoot) ? resolve(input.replaceRoot) : null;
  if (replaceRoot === null) {
    return fail(
      "--replace-root（.replace ディレクトリ）を決められないので変更宣言・部品 metadata を読めない（判定不能を合格にしない）",
    );
  }
  const projectRoot = dirname(replaceRoot);
  /** @param {string} p */
  const fromProject = (p) => (isAbsolute(p) ? p : resolve(projectRoot, p));
  /**
   * @param {string} path
   * @param {string} label
   * @returns {{ ok: true, value: unknown } | { ok: false, message: string }}
   */
  const readJson = (path, label) => {
    let text;
    try {
      text = readBytes(path).toString("utf8");
    } catch (e) {
      return { ok: false, message: `${label} を読めない: ${path}（${reasonOf(e)}）` };
    }
    try {
      return { ok: true, value: JSON.parse(text) };
    } catch (e) {
      return { ok: false, message: `${label} が JSON として壊れている: ${path}（${reasonOf(e)}）` };
    }
  };

  /** @type {{ change: string, amend_verify: string | null }[]} */
  const carries = [];
  /** @type {Buffer | null} */
  let carryBytes = null;
  try {
    carryBytes = readBytes(input.evidenceCarryPath);
  } catch (e) {
    // 無いのは「持ち越しの宣言が無い」。D が空でない以上、どのファイルも説明できずに下で落ちる。
    // 無い以外の読めなさ（権限等）は宣言の有無が分からないので落とす。
    if (/** @type {NodeJS.ErrnoException} */ (e).code !== "ENOENT") {
      return fail(
        `${EVIDENCE_CARRY_FILE} を読めない: ${input.evidenceCarryPath}（${reasonOf(e)}）`,
      );
    }
    notes.push(`${input.evidenceCarryPath} が無い（持ち越しに使う変更宣言が無い）`);
  }
  if (carryBytes !== null) {
    let value;
    try {
      value = JSON.parse(carryBytes.toString("utf8"));
    } catch (e) {
      return fail(
        `${EVIDENCE_CARRY_FILE} が JSON として壊れている: ${input.evidenceCarryPath}（${reasonOf(e)}）`,
      );
    }
    if (!isPlainObject(value) || !Array.isArray(value.carries)) {
      return fail(
        `${EVIDENCE_CARRY_FILE} が carries 配列を持つオブジェクトでない: ${input.evidenceCarryPath}`,
      );
    }
    for (const [i, raw] of value.carries.entries()) {
      if (
        !isPlainObject(raw) ||
        !nonEmptyString(raw.change) ||
        !(raw.amend_verify === null || nonEmptyString(raw.amend_verify))
      ) {
        return fail(
          `${EVIDENCE_CARRY_FILE} の carries[${i}] が { change: <パス>, amend_verify: <パス> | null } でない: ${JSON.stringify(raw)}`,
        );
      }
      carries.push({ change: raw.change, amend_verify: raw.amend_verify });
    }
  }

  /** @type {{ path: string, amendVerify: string | null, change: Record<string, any> }[]} */
  const declared = [];
  for (const carry of carries) {
    const path = fromProject(carry.change);
    const read = readJson(path, "変更宣言");
    if (!read.ok) return fail(read.message);
    const errors = validateChange(read.value);
    if (errors.length > 0) {
      return fail(`変更宣言 ${path} が不正: ${errors.join(" / ")}`);
    }
    declared.push({
      path,
      amendVerify: carry.amend_verify,
      change: /** @type {Record<string, any>} */ (read.value),
    });
  }

  // D の各ファイルが、どれかの変更宣言の files に含まれるか。
  const uncovered = changed.filter(
    (file) => !declared.some((d) => /** @type {string[]} */ (d.change.files).includes(file)),
  );
  if (uncovered.length > 0) {
    return fail(
      `描画入力の差分（${recorded} → ${wanted}）に、どの変更宣言の files にも無いファイルがある: ${uncovered.join(", ")}（宣言外の変更は持ち越さない）`,
    );
  }
  const used = declared.filter((d) =>
    /** @type {string[]} */ (d.change.files).some((file) => changed.includes(file)),
  );
  for (const d of declared) {
    if (!used.includes(d))
      notes.push(`変更宣言 ${d.change.id} はこの差分に触れないので使わない: ${d.path}`);
  }

  // 使う変更宣言のコミットが実在するか。
  for (const d of used) {
    for (const side of ["before", "after"]) {
      verifyCommit(d.change.commits[side], `変更宣言 ${d.change.id} の commits.${side}`);
    }
  }
  if (findings.length > 0) return { ok: false, legacy: false, findings, notes, carried_by: [] };

  /**
   * そのコミットでのファイルの blob（無ければ "absent"）。
   * @param {string} commit
   * @param {string} file
   * @returns {string}
   */
  const blobOf = (commit, file) => {
    try {
      return runGit(repo, ["rev-parse", "--verify", "--quiet", `${commit}:${file}`]).trim();
    } catch {
      // コミットは実在を確かめ済みなので、失敗はそのパスが無いこと。
      return "absent";
    }
  };
  // 各ファイルの記録の版 → 今の版の変化が、宣言した改修（before → after の blob）の連鎖で辿れるか。
  // files に名前があるだけの古い宣言で、その後の宣言外の編集を持ち越さない。
  for (const file of changed) {
    const edges = used
      .filter((d) => /** @type {string[]} */ (d.change.files).includes(file))
      .map((d) => [blobOf(d.change.commits.before, file), blobOf(d.change.commits.after, file)]);
    const start = blobOf(recordedFull, file);
    const goal = blobOf(wantedFull, file);
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
    if (!reached.has(goal)) {
      findings.push(
        `${file} の変化（${recorded} → ${wanted}）を変更宣言（${used
          .filter((d) => d.change.files.includes(file))
          .map((d) => d.change.id)
          .join(
            ", ",
          )}）の commits.before → after の連鎖で説明できない（宣言の前後に宣言外の編集がある）`,
      );
    }
  }
  if (findings.length > 0) return { ok: false, legacy: false, findings, notes, carried_by: [] };

  // 5. 影響の再計算と amend-verify の記録。
  let featureMetadata = input.featureMetadata;
  if (featureMetadata === undefined) {
    // slug が空だと join が .replace/parity/metadata.json に潰れ、読めない理由が別のパスを指す
    if (typeof input.featureSlug !== "string" || input.featureSlug.trim() === "") {
      return fail(
        "機能の slug が分からない（--metadata を渡すか、component-coverage.json の slug を確かめる）",
      );
    }
    const path = join(replaceRoot, "parity", input.featureSlug, "metadata.json");
    const read = readJson(path, "機能の metadata.json");
    if (!read.ok) return fail(read.message);
    featureMetadata = read.value;
  }
  // unmatched_instances の判定に使う全機能のページ（component-impact.mjs の --feature 実行と同じ扱い）。
  // 他の機能のページにある影響インスタンスを「どこにも一致しない」に数えない。読めない metadata は足さないだけ
  // （一致しないインスタンスが残れば持ち越さない側へ倒れる）。
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
    // 読めなければこの機能のページだけで数える（一致しないものは落ちる側へ倒れる）。
  }
  for (const name of featureDirs) {
    if (name === input.featureSlug) continue;
    const read = readJson(join(parityDir, name, "metadata.json"), "機能の metadata.json");
    if (read.ok) pageUniverse.push(read.value);
  }
  for (const d of used) {
    const id = String(d.change.id);
    // 部品側の照合（宣言した範囲の外は差分ゼロ・範囲の中は現行と一致）が通っていない宣言は、
    // 範囲の外にも効いている疑いがあるので、影響の計算そのものを根拠にできない
    const catalog = /** @type {Record<string, unknown>} */ (d.change.catalog_verification);
    if (catalog.outside_scope_identical !== true || catalog.inside_matches_current !== true) {
      findings.push(
        `変更宣言 ${id} の catalog_verification が合格していない（outside_scope_identical: ${JSON.stringify(catalog.outside_scope_identical)}、inside_matches_current: ${JSON.stringify(catalog.inside_matches_current)}）。部品の照合が通ってから持ち越す（parity-component の references/amend.md）`,
      );
      continue;
    }
    const componentPath = join(replaceRoot, "components", String(d.change.slug), "metadata.json");
    const component = readJson(componentPath, "部品 metadata.json");
    if (!component.ok) {
      findings.push(`変更宣言 ${id}: ${component.message}`);
      continue;
    }
    let impact;
    try {
      impact = computeImpact({
        change: d.change,
        componentMetadata: component.value,
        features: [{ slug: input.featureSlug, metadata: featureMetadata }],
        pageUniverse,
      });
    } catch (e) {
      findings.push(`変更宣言 ${id} の影響を計算できない: ${reasonOf(e)}`);
      continue;
    }
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
          )}（path の書き方の食い違いを「影響なし」に倒さない。component-impact.mjs を全機能で回して確かめる）`,
      );
      continue;
    }
    if (impact.unmatched_usages.length > 0) {
      // usages も同じ理由で持ち越さない（綴り違いの usages は、使っているページを「影響なし」に倒す）
      findings.push(
        `変更宣言 ${id} の usages がどの機能のページとも一致しない: ${impact.unmatched_usages.join(", ")}（component-impact.mjs を全機能で回して確かめる）`,
      );
      continue;
    }
    if (feature.verdict === "undeterminable") {
      findings.push(`変更宣言 ${id} の影響を判定できない: ${feature.reasons.join(" / ")}`);
      continue;
    }
    if (feature.verdict === "unaffected") {
      notes.push(`変更宣言 ${id} はこの機能に影響しない: ${feature.reasons.join(" / ")}`);
      continue;
    }
    // affected。
    const pairs =
      /** @type {{pair:string, region_known:boolean, instances: {id:string, locator:string}[]}[]} */ (
        feature.pairs
      );
    // 機械判定（amend-verify）の合格条件は「現行へ近づいた」なので、現行に合わせ直す修正にしか意味を持たない。
    // new-appearance は満たすべき条件が宣言から決まらず、合格しても従来のトリアージを省く根拠にならない
    if (d.change.kind !== "align-to-current") {
      findings.push(
        `変更宣言 ${id} は kind: ${JSON.stringify(d.change.kind)} で、この機能に影響する（${pairs.map((p) => p.pair).join(", ")}）。機械判定で持ち越せるのは align-to-current だけ（従来のトリアージへ回す。parity-diff の references/component-change.md）`,
      );
      continue;
    }
    const unknownRegion = pairs.filter((p) => p.region_known !== true).map((p) => p.pair);
    if (unknownRegion.length > 0) {
      findings.push(
        `変更宣言 ${id} の影響する組 ${unknownRegion.join(", ")} は usages だけで一致し領域が分からない（amend-verify で機械判定できないので持ち越さない。従来のトリアージへ回す）`,
      );
      continue;
    }
    if (d.amendVerify === null) {
      findings.push(
        `変更宣言 ${id} はこの機能に影響する（${pairs.map((p) => p.pair).join(", ")}）のに evidence-carry.json の amend_verify が null`,
      );
      continue;
    }
    const recordPath = fromProject(d.amendVerify);
    const record = readJson(recordPath, "amend-verify の記録");
    if (!record.ok) {
      findings.push(`変更宣言 ${id}: ${record.message}`);
      continue;
    }
    const r = record.value;
    if (!isPlainObject(r) || r.tool !== AMEND_VERIFY_TOOL || !Array.isArray(r.pairs)) {
      findings.push(
        `amend-verify の記録の形でない（tool: ${AMEND_VERIFY_TOOL} と pairs 配列が要る）: ${recordPath}`,
      );
      continue;
    }
    if (r.change_id !== id) {
      findings.push(
        `amend-verify の記録の change_id（${JSON.stringify(r.change_id)}）が変更宣言 ${id} と違う（--change-id ${id} で取り直す）: ${recordPath}`,
      );
      continue;
    }
    for (const { pair } of pairs) {
      const entries = r.pairs.filter((e) => isPlainObject(e) && e.pair === pair);
      if (entries.length !== 1) {
        findings.push(
          `amend-verify の記録に組 ${pair} が ${entries.length === 0 ? "無い" : "2 つ以上ある"}（変更宣言 ${id} の影響する組を覆っていない）: ${recordPath}`,
        );
        continue;
      }
      const entry = /** @type {Record<string, any>} */ (entries[0]);
      if (entry.pass !== true) {
        findings.push(
          `amend-verify の組 ${pair} が pass でない（${Array.isArray(entry.reasons) ? entry.reasons.join("; ") : "理由なし"}）: ${recordPath}`,
        );
        continue;
      }
      const provenance = checkProvenance(entry, pair, id, {
        stageDir: resolve(dirname(input.evidenceCarryPath)),
        currentRoot: resolve(replaceRoot, "parity", input.featureSlug, "baseline"),
        fromProject,
      });
      if (provenance !== null) {
        findings.push(`amend-verify の組 ${pair}: ${provenance}: ${recordPath}`);
        continue;
      }
      const geometry = checkGeometry(
        entry,
        d.change,
        pairInstances(pairs, pair),
        fromProject,
        readBytes,
      );
      if (geometry !== null) {
        findings.push(`amend-verify の組 ${pair}: ${geometry}: ${recordPath}`);
        continue;
      }
      for (const key of ["prev_new", "new", "current"]) {
        const ref = isPlainObject(entry.inputs) ? entry.inputs[key] : undefined;
        if (!isPlainObject(ref) || !nonEmptyString(ref.path) || !nonEmptyString(ref.sha256)) {
          findings.push(
            `amend-verify の組 ${pair} の inputs.${key} に path / sha256 が無い: ${recordPath}`,
          );
          continue;
        }
        const imagePath = fromProject(ref.path);
        let actual;
        try {
          actual = createHash("sha256").update(readBytes(imagePath)).digest("hex");
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
  }
  if (findings.length > 0) return { ok: false, legacy: false, findings, notes, carried_by: [] };
  const carriedBy = used.map((d) => String(d.change.id));
  notes.push(
    `新側のコミットは違う（${recorded} → ${wanted}）が、描画入力の差分（${changed.join(", ")}）は変更宣言 ${carriedBy.join(", ")} で説明でき、影響する組は amend-verify で pass なので証跡を持ち越す`,
  );
  return { ok: true, legacy: false, findings: [], notes, carried_by: carriedBy };
}
