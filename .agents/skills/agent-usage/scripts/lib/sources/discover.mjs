// このリポジトリ（と、その worktree）で動いたセッションのログを探す。
//
// Claude Code: ~/.claude/projects/ の下の、作業ツリーのパスの英数字以外を - にした名前のディレクトリを読む。
//   その中の `<session>.jsonl` と `<session>/subagents/*.jsonl` が、1 つのセッションのログである。
//   ディレクトリ名は作業ツリーのパスから作られるので、ルートの名前で始まるディレクトリを候補にする。
//   リポジトリの中の worktree も同じ名前で始まる。候補は解析した後に、ログの cwd がルートの中にあるかで確かめる。
// Codex: ~/.codex/sessions/**/rollout-*.jsonl。最初の行（session_meta）の cwd か、リモートの URL で確かめる。
// ルートには、今の worktree に加えて、これまでに Hook と collect が見た worktree（worktrees.mjs）を渡す。

import { closeSync, existsSync, openSync, readSync, readdirSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { basename, join } from "node:path";
import { isRecord } from "../config.mjs";
import { normalizeRemote } from "../repo.mjs";
import { filesUnder } from "../walk.mjs";

/**
 * @typedef {object} LogFile
 * @property {string} path
 * @property {number} size
 * @property {number} mtimeMs
 */

/**
 * @typedef {object} SessionSource
 * @property {"claude-code" | "codex"} agent
 * @property {string} id
 * @property {LogFile | null} main
 * @property {LogFile[]} subagents
 */

/**
 * @param {NodeJS.ProcessEnv} env
 * @returns {string}
 */
export function claudeProjectsDir(env = process.env) {
  if (env.AGENT_USAGE_CLAUDE_PROJECTS) return env.AGENT_USAGE_CLAUDE_PROJECTS;
  return join(env.CLAUDE_CONFIG_DIR || join(homedir(), ".claude"), "projects");
}

/**
 * @param {NodeJS.ProcessEnv} env
 * @returns {string}
 */
export function codexSessionsDir(env = process.env) {
  if (env.AGENT_USAGE_CODEX_SESSIONS) return env.AGENT_USAGE_CODEX_SESSIONS;
  return join(env.CODEX_HOME || join(homedir(), ".codex"), "sessions");
}

/**
 * Claude Code がプロジェクトのディレクトリ名にするパスの形。
 * @param {string} path
 * @returns {string}
 */
export function encodeProjectPath(path) {
  return path.replace(/[^A-Za-z0-9]/g, "-");
}

/**
 * @param {string} p
 * @returns {LogFile}
 */
function fileOf(p) {
  const st = statSync(p);
  return { path: p, size: st.size, mtimeMs: st.mtimeMs };
}

/**
 * @param {string} dir
 * @returns {string[]}
 */
function jsonlIn(dir) {
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { withFileTypes: true })
    .filter((e) => e.isFile() && e.name.endsWith(".jsonl"))
    .map((e) => join(dir, e.name))
    .sort();
}

/**
 * Claude Code のプロジェクトのディレクトリ（dir）にある、セッションごとのサブエージェントのログを out に足す。
 * project は dir の名前（作業ツリーのパスを符号化したもの）。
 * @param {{ out: Map<string, SessionSource>; dir: string; project: string; prefixes: readonly string[] }} o
 * @returns {void}
 */
function addClaudeSubagents(o) {
  const { out, dir, project, prefixes } = o;
  for (const sub of readdirSync(dir, { withFileTypes: true })) {
    if (!sub.isDirectory()) continue;
    const files = jsonlIn(join(dir, sub.name, "subagents"));
    if (files.length === 0) continue;
    const key = `${project}/${sub.name}`;
    // サブエージェントのファイルしか残っていないセッションは cwd で確かめられないので、
    // ディレクトリ名が作業ツリーのパスと一致するときだけ対象にする（前方一致では、名前が同じで始まる別のリポジトリも当たる）
    if (!out.has(key) && !prefixes.includes(project)) continue;
    const src = out.get(key) ?? { agent: "claude-code", id: sub.name, main: null, subagents: [] };
    src.subagents = files.map(fileOf);
    out.set(key, src);
  }
}

/**
 * @param {readonly string[]} roots
 * @param {NodeJS.ProcessEnv} env
 * @returns {SessionSource[]}
 */
export function discoverClaude(roots, env = process.env) {
  const base = claudeProjectsDir(env);
  if (!existsSync(base)) return [];
  const prefixes = roots.map(encodeProjectPath);
  /** @type {Map<string, SessionSource>} */
  const out = new Map();
  for (const ent of readdirSync(base, { withFileTypes: true })) {
    if (!ent.isDirectory() || !prefixes.some((p) => ent.name.startsWith(p))) continue;
    const dir = join(base, ent.name);
    for (const p of jsonlIn(dir)) {
      const id = basename(p, ".jsonl");
      out.set(`${ent.name}/${id}`, { agent: "claude-code", id, main: fileOf(p), subagents: [] });
    }
    addClaudeSubagents({ out, dir, project: ent.name, prefixes });
  }
  return [...out.values()];
}

/**
 * ファイルの最初の行を読む（全体を読まずに session_meta を確かめる）。
 * 読んだ塊ごとに文字列にすると、塊の境目で分かれた複数バイトの文字が置換文字になるので、バイトのままつないでから 1 回で文字列にする。
 * @param {string} path
 * @returns {string}
 */
export function firstLine(path) {
  const fd = openSync(path, "r");
  try {
    /** @type {Buffer[]} */
    const chunks = [];
    let total = 0;
    const buf = Buffer.alloc(65536);
    for (let pos = 0; ;) {
      const n = readSync(fd, buf, 0, buf.length, pos);
      if (n <= 0) break;
      const chunk = buf.subarray(0, n);
      const nl = chunk.indexOf(0x0a);
      if (nl >= 0) {
        chunks.push(Buffer.from(chunk.subarray(0, nl)));
        break;
      }
      chunks.push(Buffer.from(chunk));
      total += n;
      pos += n;
      if (total > 4 * 1024 * 1024) break;
    }
    return Buffer.concat(chunks).toString("utf8");
  } finally {
    closeSync(fd);
  }
}

/**
 * Codex のログの最初の行（session_meta）の payload。読めないか session_meta でなければ null。
 * @param {string} p
 * @returns {Record<string, unknown> | null}
 */
function codexSessionMeta(p) {
  /** @type {unknown} */
  let meta;
  try {
    meta = JSON.parse(firstLine(p));
  } catch {
    return null;
  }
  if (!isRecord(meta) || meta.type !== "session_meta" || !isRecord(meta.payload)) return null;
  return meta.payload;
}

/**
 * session_meta の payload の cwd がルートの中にあるか、リポジトリの URL がリモートと一致するか。
 * @param {Record<string, unknown>} payload
 * @param {{ roots: readonly string[]; remote: string; inside: (path: string, roots: readonly string[]) => boolean }} o
 * @returns {boolean}
 */
function codexInRepo(payload, o) {
  const { roots, remote, inside } = o;
  const cwd = typeof payload.cwd === "string" ? payload.cwd : "";
  const g = isRecord(payload.git) ? payload.git : {};
  const url = typeof g.repository_url === "string" ? normalizeRemote(g.repository_url) : "";
  return (cwd !== "" && inside(cwd, roots)) || (remote !== "" && url === remote);
}

/**
 * Codex のログのうち、cwd がルートの中にあるか、リモートが一致するもの。
 * remote は normalizeRemote した形で渡す。
 * @param {{ roots: readonly string[]; remote: string; env: NodeJS.ProcessEnv; inside: (path: string, roots: readonly string[]) => boolean }} o
 * @returns {SessionSource[]}
 */
export function discoverCodex(o) {
  const { roots, remote, env, inside } = o;
  /** @type {SessionSource[]} */
  const out = [];
  for (const p of filesUnder(codexSessionsDir(env), ".jsonl")) {
    const payload = codexSessionMeta(p);
    if (payload === null || !codexInRepo(payload, { roots, remote, inside })) continue;
    const id =
      typeof payload.id === "string" && payload.id !== "" ? payload.id : basename(p, ".jsonl");
    out.push({ agent: "codex", id, main: fileOf(p), subagents: [] });
  }
  return out;
}
