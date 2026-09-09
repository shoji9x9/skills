// パリティスイートから Playwright の待たない取得 API を検出する。
// TypeScript の構文変換は行わず、コメント・文字列を除外したソースを決定論的に走査する。

import { readdirSync, readFileSync, realpathSync, statSync } from "node:fs";
import { extname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const SOURCE_EXTENSIONS = new Set([".js", ".mjs", ".cjs", ".jsx", ".ts", ".mts", ".cts", ".tsx"]);

const RULES = [
  {
    id: "query-handle",
    methods: ["$", "$$"],
    receivers: ["page"],
    message: "page.$ / page.$$ は DOM を即時照会する",
  },
  {
    id: "element-handle",
    methods: ["elementHandle", "elementHandles"],
    receivers: ["locator"],
    message: "ElementHandle への変換は自動待機を失う",
  },
  {
    id: "locator-all",
    methods: ["all"],
    receivers: ["locator"],
    message: "locator.all() は要素一覧を待たない",
  },
  {
    id: "immediate-read",
    methods: [
      "textContent",
      "innerText",
      "innerHTML",
      "inputValue",
      "getAttribute",
      "allTextContents",
      "allInnerTexts",
      "count",
      "isVisible",
      "isHidden",
      "isEnabled",
      "isDisabled",
      "isEditable",
      "isChecked",
    ],
    receivers: ["locator"],
    message: "即時の値読み取りではなく自動リトライ assertion を使う",
  },
  {
    id: "fixed-wait",
    methods: ["waitForTimeout"],
    receivers: ["page"],
    message: "固定時間待機ではなく観測条件を自動待機する",
  },
];

/** コメントと文字列を空白へ置換し、行・桁位置を保つ。判定不能な終端はエラーにする。 */
export function maskNonCode(source) {
  const out = [...source];
  let state = "code";
  let quote = "";
  /** テンプレート補間ごとの波括弧深さ。0 の `}` でテンプレート文字列へ戻る。 */
  const interpolationDepth = [];
  for (let i = 0; i < source.length; i += 1) {
    const c = source[i];
    const n = source[i + 1];
    if (state === "code") {
      if (c === "/" && n === "/") {
        out[i] = out[i + 1] = " ";
        i += 1;
        state = "line-comment";
      } else if (c === "/" && n === "*") {
        out[i] = out[i + 1] = " ";
        i += 1;
        state = "block-comment";
      } else if (c === "'" || c === '"') {
        out[i] = " ";
        quote = c;
        state = "string";
      } else if (c === "`") {
        out[i] = " ";
        state = "template";
      } else if (interpolationDepth.length > 0 && c === "{") {
        interpolationDepth[interpolationDepth.length - 1] += 1;
      } else if (interpolationDepth.length > 0 && c === "}") {
        const last = interpolationDepth.length - 1;
        if (interpolationDepth[last] === 0) {
          out[i] = " ";
          interpolationDepth.pop();
          state = "template";
        } else interpolationDepth[last] -= 1;
      }
    } else if (state === "line-comment") {
      if (c === "\n") state = "code";
      else out[i] = " ";
    } else if (state === "block-comment") {
      if (c === "*" && n === "/") {
        out[i] = out[i + 1] = " ";
        i += 1;
        state = "code";
      } else if (c !== "\n") out[i] = " ";
    } else if (state === "string") {
      if (c === "\\") {
        out[i] = " ";
        if (i + 1 < source.length) {
          if (source[i + 1] !== "\n") out[i + 1] = " ";
          i += 1;
        }
      } else if (c === quote) {
        out[i] = " ";
        state = "code";
      } else if (c !== "\n") out[i] = " ";
    } else if (state === "template") {
      if (c === "\\") {
        out[i] = " ";
        if (i + 1 < source.length) {
          if (source[i + 1] !== "\n") out[i + 1] = " ";
          i += 1;
        }
      } else if (c === "`" && interpolationDepth.length === 0) {
        out[i] = " ";
        state = "code";
      } else if (c === "$" && n === "{") {
        out[i] = out[i + 1] = " ";
        i += 1;
        interpolationDepth.push(0);
        state = "code";
      } else if (c !== "\n") out[i] = " ";
    }
  }
  if (
    state === "block-comment" ||
    state === "string" ||
    state === "template" ||
    interpolationDepth.length > 0
  ) {
    throw new Error(`ソース終端で ${state} が閉じていない`);
  }
  return out.join("");
}

/** 呼び出し直前の式を逆向きにたどり、プロパティチェーンの起点識別子を返す。 */
function receiverRoot(code, dotIndex) {
  let i = dotIndex - 1;
  const skipSpace = () => {
    while (i >= 0 && /\s/.test(code[i])) i -= 1;
  };
  skipSpace();
  while (i >= 0) {
    if (code[i] === ")" || code[i] === "]") {
      const close = code[i];
      const open = close === ")" ? "(" : "[";
      let depth = 1;
      i -= 1;
      while (i >= 0 && depth > 0) {
        if (code[i] === close) depth += 1;
        else if (code[i] === open) depth -= 1;
        i -= 1;
      }
      if (depth !== 0) return null;
      skipSpace();
      continue;
    }
    const end = i + 1;
    while (i >= 0 && /[\w$]/.test(code[i])) i -= 1;
    if (end === i + 1) return null;
    const identifier = code.slice(i + 1, end);
    skipSpace();
    if (code[i] !== ".") return identifier;
    i -= 1;
    skipSpace();
  }
  return null;
}

/** Page / Locator と確認できる識別子を、型注釈と代入チェーンから閉包として導出する。 */
function playwrightReceivers(code) {
  const pages = new Set(["page"]);
  const locators = new Set(["locator"]);
  for (const match of code.matchAll(/\b([A-Za-z_$][\w$]*)\s*:\s*(Page|Locator)\b/g)) {
    (match[2] === "Page" ? pages : locators).add(match[1]);
  }
  const assignments = [...code.matchAll(/\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*/g)];
  let changed = true;
  while (changed) {
    changed = false;
    for (const match of assignments) {
      const rhsStart = match.index + match[0].length;
      const rhs = code.slice(rhsStart);
      const root = rhs.match(/^([A-Za-z_$][\w$]*)/)?.[1];
      if (!root) continue;
      const target = match[1];
      const isLocatorExpression =
        locators.has(root) || (pages.has(root) && /^\w+\s*\.(?:locator|getBy\w+)\s*\(/.test(rhs));
      if (isLocatorExpression && !locators.has(target)) {
        locators.add(target);
        changed = true;
      } else if (
        pages.has(root) &&
        !pages.has(target) &&
        new RegExp(`^${root}\\s*(?:;|$)`).test(rhs)
      ) {
        pages.add(target);
        changed = true;
      }
    }
  }
  return { page: pages, locator: locators };
}

export function scanSource(source, file = "<source>") {
  const code = maskNonCode(source);
  const receivers = playwrightReceivers(code);
  const violations = [];
  for (const rule of RULES) {
    const methodPattern = rule.methods.map((method) => method.replaceAll("$", "\\$")).join("|");
    const pattern = new RegExp(`\\.\\s*(?:${methodPattern})\\s*\\(`, "g");
    for (const match of code.matchAll(pattern)) {
      const root = receiverRoot(code, match.index);
      if (!root) continue;
      const matchesReceiver = rule.receivers.some(
        (kind) => receivers[kind].has(root) || (kind === "locator" && receivers.page.has(root)),
      );
      if (!matchesReceiver) continue;
      const before = code.slice(0, match.index);
      const line = before.split("\n").length;
      const column = match.index - before.lastIndexOf("\n");
      violations.push({ file, line, column, rule: rule.id, message: rule.message });
    }
  }
  return violations.sort(
    (a, b) => a.line - b.line || a.column - b.column || a.rule.localeCompare(b.rule),
  );
}

function collect(path, files, problems) {
  let stat;
  try {
    stat = statSync(path);
  } catch (error) {
    problems.push(`${path}: 読み込めない: ${String(error)}`);
    return;
  }
  if (stat.isFile()) {
    if (SOURCE_EXTENSIONS.has(extname(path))) files.push(path);
    else problems.push(`${path}: 対象外の拡張子`);
    return;
  }
  if (!stat.isDirectory()) {
    problems.push(`${path}: 通常ファイルまたはディレクトリではない`);
    return;
  }
  for (const entry of readdirSync(path, { withFileTypes: true }).sort((a, b) =>
    a.name.localeCompare(b.name),
  )) {
    if (entry.name === "node_modules" || entry.name === ".git") continue;
    collect(resolve(path, entry.name), files, problems);
  }
}

export function main(args) {
  if (args.length === 0) {
    process.stderr.write("usage: auto-wait-check.mjs <suite-file-or-directory> [...]\n");
    return 2;
  }
  const files = [];
  const problems = [];
  for (const arg of args) collect(resolve(arg), files, problems);
  if (files.length === 0) problems.push("走査対象の JavaScript / TypeScript ファイルが 0 件");
  for (const problem of problems) process.stderr.write(`error: ${problem}\n`);
  if (problems.length > 0) return 2;

  const violations = [];
  for (const file of [...new Set(files)].sort()) {
    try {
      violations.push(...scanSource(readFileSync(file, "utf8"), file));
    } catch (error) {
      process.stderr.write(`error: ${file}: 走査不能: ${String(error)}\n`);
      return 2;
    }
  }
  for (const v of violations) {
    process.stderr.write(`${v.file}:${v.line}:${v.column}: ${v.rule}: ${v.message}\n`);
  }
  if (violations.length > 0) {
    process.stderr.write(`error: 待たない取得 API を ${violations.length} 件検出\n`);
    return 1;
  }
  process.stdout.write(`ok: ${files.length} ファイルを走査し、待たない取得 API は 0 件\n`);
  return 0;
}

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

if (invokedAsCli) process.exit(main(process.argv.slice(2)));
