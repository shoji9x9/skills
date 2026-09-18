// 撮る範囲の穴を採取の段で数える検査（正本）。Issue #239。
//
// 何のためか: 撮る範囲が狭いと、**実装したあとに範囲外の差分が現れる**。
// そこで範囲を広げて撮り直すことになるが、**現側も撮り直し**なので反復が 1 つ増える。
// 範囲の狭さは「差分が出なかった」と同じ見え方になる——**差分器は撮った 2 枚しか比べない**ので、
// 撮らなかった領域は永久に差 0 件として通る。だから**撮る段で穴を数える**。
//
// この検査が落とすのは 4 つ。
//   1. **撮影組の取りこぼし**: ノイズ基準値を採った組（ページ × 状態 × ビューポート）に、範囲の実測が無い。
//      「範囲を測っていない組」と「穴の無い組」を同じ見え方にしない。
//   2. **文書が撮影領域より大きい**（`below-fold` / `beyond-right`）: `full_page: false` で下・右が切れている。
//   3. **内部スクロール器の外**（`scroll:<名前>`）: 器の `scrollHeight` / `scrollWidth` が `clientHeight` / `clientWidth` より大きく、
//      画素にも特性にも出ない領域が器の中に残っている（仮想スクロール・固定高のグリッドが該当する）。
//   4. **撮影領域の外にある論理名付き要素**（`offscreen:<名前>`）: 特性は採れても画素には写らない。
//
// 穴は消すか、**対象外として理由付きで宣言する**（`capture_scope_exemptions`）。宣言の無い穴は落とす。
// 効かない宣言（対応する穴が無い）も落とす——古い宣言が残ると、範囲を狭めても静かに通る。
//
// 決定論的: 乱数・現在時刻・ネットワークに依存しない。読むのは `metadata.json` だけで、ブラウザは駆動しない
// （範囲の実測は採取スペックが行い、その結果をこのスクリプトが数える）。TypeScript 構文は使わない（型は JSDoc）。
//
// 終了コード: 0 ＝ 条件を満たす、1 ＝ 穴・不整合が残る（採取へ戻す）、2 ＝ 使い方の誤り・型崩れ。

import { readFileSync, realpathSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * ツールのバージョン（正本）。判定規則・出力形状を変えたら上げる。
 * @type {string}
 */
export const VERSION = "1";

/** `metadata.json` の `mode` の語彙（正本は parity-suite の SKILL.md）。視覚採取物を持つのは `feature` だけ。 */
export const MODES = ["feature", "api-resource", "batch"];

/**
 * 撮影組の鍵。`noise_baseline` と `capture_scope` を突き合わせる単位。
 * @param {{page?: unknown, state?: unknown, viewport?: unknown}} entry
 * @returns {string}
 */
export function combinationKey(entry) {
  return `${String(entry.page)}|${String(entry.state)}|${String(entry.viewport)}`;
}

/**
 * 正の有限数か（寸法の実測値はここを通す）。
 * @param {unknown} value
 * @returns {boolean}
 */
function positiveNumber(value) {
  return typeof value === "number" && Number.isFinite(value) && value > 0;
}

/**
 * 空でない文字列か。
 * @param {unknown} value
 * @returns {boolean}
 */
function nonEmptyString(value) {
  return typeof value === "string" && value.trim() !== "";
}

/**
 * 寸法（`{width, height}`）を検証して返す。型崩れ・0 以下なら null。
 *
 * **0 を通さない**——同梱テンプレートは寸法を `0` で置いてあるので、
 * プレースホルダのまま書いた組は文書も撮影領域も 0×0 になり、寸法の比較では穴が 1 つも出ない。
 * 「測っていない組」が「穴の無い組」と同じ見え方になるため、実測値は正の数だけを受ける。
 * @param {unknown} value
 * @returns {{width:number, height:number} | null}
 */
function readSize(value) {
  if (!value || typeof value !== "object") return null;
  const size = /** @type {{width?: unknown, height?: unknown}} */ (value);
  if (!positiveNumber(size.width) || !positiveNumber(size.height)) return null;
  return { width: /** @type {number} */ (size.width), height: /** @type {number} */ (size.height) };
}

/**
 * 1 つの撮影組の実測から穴を導く。
 *
 * **穴は記録された `holes` ではなく寸法から導く**——書き手が挙げた分だけを見ると、
 * 挙げ忘れた穴が「穴が無い」と同じ見え方になる。
 * @param {Record<string, unknown>} entry
 * @returns {{ holes: {id:string, kind:string, detail:string}[], findings: {code:string, message:string}[] }}
 */
export function deriveHoles(entry) {
  const key = combinationKey(entry);
  /** @type {{id:string, kind:string, detail:string}[]} */
  const holes = [];
  /** @type {{code:string, message:string}[]} */
  const findings = [];
  const document = readSize(entry.document);
  const captured = readSize(entry.captured);
  if (!document || !captured) {
    findings.push({
      code: "scope-size-unreadable",
      message: `${key} の document / captured の寸法が数値で書かれていない（測っていないことを穴が無いことに倒さない）`,
    });
    return { holes, findings };
  }
  if (document.height > captured.height) {
    holes.push({
      id: `${key}#below-fold`,
      kind: "below-fold",
      detail: `文書の高さ ${document.height} に対し撮影領域は ${captured.height}（下が ${document.height - captured.height}px 切れている）`,
    });
  }
  if (document.width > captured.width) {
    holes.push({
      id: `${key}#beyond-right`,
      kind: "beyond-right",
      detail: `文書の幅 ${document.width} に対し撮影領域は ${captured.width}（右が ${document.width - captured.width}px 切れている）`,
    });
  }
  const containers = entry.scroll_containers;
  if (!Array.isArray(containers)) {
    findings.push({
      code: "scroll-containers-missing",
      message: `${key} に scroll_containers が無い（内部スクロール器を数えていないことと、器が無いことを書き分ける。無ければ空配列を書く）`,
    });
  } else {
    const seen = new Set();
    for (const raw of containers) {
      const container = /** @type {Record<string, unknown>} */ (raw ?? {});
      const name = container.name;
      if (!nonEmptyString(name)) {
        findings.push({
          code: "scroll-container-name-missing",
          message: `${key} の scroll_containers に名前の無い要素がある（穴の id が決まらない）`,
        });
        continue;
      }
      if (seen.has(name)) {
        findings.push({
          code: "scroll-container-duplicated",
          message: `${key} の scroll_containers に ${name} が 2 つ以上ある（宣言がどちらに効くか決まらない）`,
        });
      }
      seen.add(name);
      const client = readSize(container.client);
      const scroll = readSize(container.scroll);
      if (!client || !scroll) {
        findings.push({
          code: "scroll-container-size-unreadable",
          message: `${key} の scroll_containers[${String(name)}] の client / scroll が数値で書かれていない`,
        });
        continue;
      }
      if (scroll.height > client.height || scroll.width > client.width) {
        holes.push({
          id: `${key}#scroll:${String(name)}`,
          kind: "scroll-container",
          detail: `器 ${String(name)} の内容 ${scroll.width}x${scroll.height} が可視部 ${client.width}x${client.height} より大きい`,
        });
      }
    }
  }
  const outside = entry.named_elements_outside;
  if (!Array.isArray(outside)) {
    findings.push({
      code: "named-elements-outside-missing",
      message: `${key} に named_elements_outside が無い（撮影領域の外に出た論理名を数えていない。無ければ空配列を書く）`,
    });
  } else {
    for (const name of outside) {
      if (!nonEmptyString(name)) {
        findings.push({
          code: "named-element-name-missing",
          message: `${key} の named_elements_outside に空の要素がある`,
        });
        continue;
      }
      holes.push({
        id: `${key}#offscreen:${String(name)}`,
        kind: "offscreen-named-element",
        detail: `論理名 ${String(name)} が撮影領域の外にある（特性は採れても画素には写らない）`,
      });
    }
  }
  return { holes, findings };
}

/**
 * `metadata.json` の内容から撮る範囲の穴を数える。
 *
 * `judged: false` は「視覚採取物を持たないモードなので判定に入れない」の意味で、合格とは別物
 * （呼び出し側は判定しなかった事実を記録に残す）。
 * @param {unknown} metadata
 * @returns {{ findings: {code:string, message:string}[], holes: {id:string, kind:string, detail:string}[], counts: Record<string, number>, structural: boolean, judged: boolean }}
 */
export function checkCaptureScope(metadata) {
  /** @type {{code:string, message:string}[]} */
  const findings = [];
  /** @type {{id:string, kind:string, detail:string}[]} */
  const holes = [];
  if (!metadata || typeof metadata !== "object") {
    return {
      findings: [
        { code: "metadata-unreadable", message: "metadata.json が JSON オブジェクトではない" },
      ],
      holes,
      counts: { combinations: 0, holes: 0 },
      structural: true,
      judged: true,
    };
  }
  const meta = /** @type {Record<string, any>} */ (metadata);
  // 視覚採取物を持たないモード（api-resource / batch）は撮影条件そのものを持たないので判定に入れない。
  // **通すのはこの閉じた集合だけ**で、mode が読めない・知らない値のときは判定を飛ばさず落とす
  // （緩和経路を「壊れている入力」全部に広げない）。
  // **欠落・非文字列も同じ**——分岐の外へ落として feature 扱いにすると、壊れた metadata が
  // 「撮影条件が読めた feature」として判定を通りうる。mode は語彙の中の文字列であることを先に確かめる。
  if (typeof meta.mode !== "string" || !MODES.includes(meta.mode)) {
    return {
      findings: [
        {
          code: "mode-unknown",
          message: `mode「${meta.mode === undefined ? "（欠落）" : String(meta.mode)}」が語彙外（${MODES.join(" / ")}）。判定を飛ばさない`,
        },
      ],
      holes,
      counts: { combinations: 0, holes: 0 },
      structural: true,
      judged: true,
    };
  }
  if (meta.mode !== "feature") {
    return {
      findings,
      holes,
      counts: { combinations: 0, holes: 0 },
      structural: false,
      judged: false,
    };
  }
  const conditions = meta.capture_conditions;
  if (!conditions || typeof conditions !== "object") {
    return {
      findings: [
        {
          code: "capture-conditions-missing",
          message: "capture_conditions が無い（撮影条件を持たない成果物は範囲の判定に入れない）",
        },
      ],
      holes,
      counts: { combinations: 0, holes: 0 },
      structural: true,
      judged: true,
    };
  }
  const noiseBaseline = meta.noise_baseline;
  if (!Array.isArray(noiseBaseline) || noiseBaseline.length === 0) {
    findings.push({
      code: "noise-baseline-missing",
      message:
        "noise_baseline が空（どの組を撮ったかが分からない。範囲の検査は撮った組の一覧を突き合わせ相手にする）",
    });
  }
  const scope = conditions.capture_scope;
  if (!Array.isArray(scope)) {
    findings.push({
      code: "capture-scope-missing",
      message:
        "capture_conditions.capture_scope が無い（範囲を測っていない。撮った組ごとに文書・撮影領域・内部スクロール器・領域外の論理名を実測して書く）",
    });
    return {
      findings,
      holes,
      counts: { combinations: Array.isArray(noiseBaseline) ? noiseBaseline.length : 0, holes: 0 },
      structural: false,
      judged: true,
    };
  }
  /** @type {Map<string, Record<string, unknown>>} */
  const scopeByKey = new Map();
  for (const raw of scope) {
    const entry = /** @type {Record<string, unknown>} */ (raw ?? {});
    if (
      !nonEmptyString(entry.page) ||
      !nonEmptyString(entry.state) ||
      !nonEmptyString(entry.viewport)
    ) {
      findings.push({
        code: "scope-entry-unkeyed",
        message:
          "capture_scope に page / state / viewport の揃っていない要素がある（撮影組を特定できない）",
      });
      continue;
    }
    const key = combinationKey(entry);
    if (scopeByKey.has(key)) {
      findings.push({
        code: "scope-entry-duplicated",
        message: `capture_scope に ${key} の要素が 2 つ以上ある（どちらの実測が有効か決まらない）`,
      });
    }
    scopeByKey.set(key, entry);
  }
  /** @type {Set<string>} */
  const shot = new Set();
  if (Array.isArray(noiseBaseline)) {
    for (const raw of noiseBaseline) {
      const entry = /** @type {Record<string, unknown>} */ (raw ?? {});
      if (
        !nonEmptyString(entry.page) ||
        !nonEmptyString(entry.state) ||
        !nonEmptyString(entry.viewport)
      ) {
        findings.push({
          code: "noise-entry-unkeyed",
          message: "noise_baseline に page / state / viewport の揃っていない要素がある",
        });
        continue;
      }
      shot.add(combinationKey(entry));
    }
  }
  for (const key of shot) {
    if (!scopeByKey.has(key)) {
      findings.push({
        code: "scope-entry-missing",
        message: `${key} は撮ったのに範囲の実測が無い（測っていない組を穴の無い組と同じ扱いにしない）`,
      });
    }
  }
  for (const key of scopeByKey.keys()) {
    if (shot.size > 0 && !shot.has(key)) {
      findings.push({
        code: "scope-entry-unknown",
        message: `capture_scope の ${key} は noise_baseline に無い組（撮っていない組の実測が混ざっている）`,
      });
    }
  }
  for (const entry of scopeByKey.values()) {
    const derived = deriveHoles(entry);
    holes.push(...derived.holes);
    findings.push(...derived.findings);
  }

  const exemptions = conditions.capture_scope_exemptions ?? [];
  if (!Array.isArray(exemptions)) {
    findings.push({
      code: "exemptions-malformed",
      message: "capture_conditions.capture_scope_exemptions が配列ではない",
    });
    return {
      findings,
      holes,
      counts: { combinations: shot.size, holes: holes.length },
      structural: false,
      judged: true,
    };
  }
  /** @type {Map<string, Record<string, unknown>>} */
  const exemptionById = new Map();
  for (const raw of exemptions) {
    const exemption = /** @type {Record<string, unknown>} */ (raw ?? {});
    if (!nonEmptyString(exemption.id)) {
      findings.push({
        code: "exemption-id-missing",
        message:
          "capture_scope_exemptions に id の無い要素がある（どの穴を対象外にしたか決まらない）",
      });
      continue;
    }
    const id = String(exemption.id);
    if (exemptionById.has(id)) {
      findings.push({
        code: "exemption-duplicated",
        message: `capture_scope_exemptions に ${id} が 2 つ以上ある`,
      });
    }
    exemptionById.set(id, exemption);
  }
  const holeIds = new Set(holes.map((hole) => hole.id));
  for (const hole of holes) {
    const exemption = exemptionById.get(hole.id);
    if (!exemption) {
      findings.push({
        code: "hole-unexempted",
        message: `撮る範囲に穴がある: ${hole.detail}（id: ${hole.id}）。範囲を広げて撮り直すか、対象外として理由付きで宣言する`,
      });
      continue;
    }
    if (!nonEmptyString(exemption.reason)) {
      findings.push({
        code: "exemption-reason-missing",
        message: `${hole.id} の宣言に reason が無い（なぜ撮らないかが残らない）`,
      });
    }
    if (!nonEmptyString(exemption.gaps_ref)) {
      findings.push({
        code: "exemption-gaps-ref-missing",
        message: `${hole.id} の宣言に gaps_ref が無い（gaps.md の未検証領域へ回らないと、対象外が誰にも見えない）`,
      });
    }
  }
  for (const id of exemptionById.keys()) {
    if (!holeIds.has(id)) {
      findings.push({
        code: "exemption-ineffective",
        message: `${id} の宣言に対応する穴が無い（効かない宣言。範囲を狭めても静かに通る状態になるので消す）`,
      });
    }
  }

  return {
    findings,
    holes,
    counts: { combinations: shot.size, holes: holes.length },
    structural: false,
    judged: true,
  };
}

/**
 * CLI 本体。
 * @param {string[]} argv
 * @param {{ readFile?: (path: string) => string, cwd?: string, write?: (s: string) => void, writeErr?: (s: string) => void }} [deps]
 * @returns {number}
 */
export function main(argv, deps = {}) {
  const readFile = deps.readFile ?? ((p) => readFileSync(p, "utf8"));
  const cwd = deps.cwd ?? process.cwd();
  const write = deps.write ?? ((s) => process.stdout.write(s));
  const writeErr = deps.writeErr ?? ((s) => process.stderr.write(s));
  const usage = "usage: capture-scope-check.mjs --metadata <.replace/parity/<slug>/metadata.json>";
  /**
   * 引数・入力の誤りを stderr へ知らせる（判定結果ではないので stdout の JSON には混ぜない）。
   * @param {string} message
   * @returns {number}
   */
  const fail = (message) => {
    writeErr(`error: ${message}\n${usage}\n`);
    return 2;
  };
  const out = (obj) =>
    write(
      `${JSON.stringify({ tool: "capture-scope-check", version: VERSION, ...obj }, null, 2)}\n`,
    );
  /** @type {Record<string, string>} */
  const args = {};
  for (let i = 0; i < argv.length; i += 1) {
    const key = argv[i];
    if (!key.startsWith("--")) {
      return fail(`不明な引数: ${key}`);
    }
    const value = argv[i + 1];
    if (typeof value !== "string" || value.startsWith("--")) {
      return fail(`${key} に値がない`);
    }
    if (args[key] !== undefined) {
      return fail(`${key} が複数ある`);
    }
    args[key] = value;
    i += 1;
  }
  const unknown = Object.keys(args).filter((k) => k !== "--metadata");
  if (unknown.length > 0) {
    return fail(`不明な引数: ${unknown.join(", ")}`);
  }
  const metadataPath = args["--metadata"];
  if (!metadataPath) {
    return fail("--metadata は必須");
  }
  let metadata;
  try {
    metadata = JSON.parse(readFile(resolve(cwd, metadataPath)));
  } catch (error) {
    return fail(`${metadataPath} を読めない: ${error && error.message}`);
  }
  const result = checkCaptureScope(metadata);
  if (result.structural) {
    out({ ok: false, structural: true, findings: result.findings, counts: result.counts });
    return 2;
  }
  out({
    ok: result.findings.length === 0,
    judged: result.judged,
    findings: result.findings,
    holes: result.holes,
    counts: { ...result.counts, findings: result.findings.length },
  });
  return result.findings.length === 0 ? 0 : 1;
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
  // process.exit は書き込み中の stdout を捨てるため、終了コードだけ設定して自然終了させる。
  process.exitCode = main(process.argv.slice(2));
}
