// 単価の解決と、トークン数からの費用の計算。単価はリポジトリの設定 → 同梱の単価表の順に探し、どちらにも無ければ「単価不明」。

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { isRecord, parsePrice } from "./config.mjs";

/** @typedef {import("./config.mjs").Price} Price */

/**
 * トークン数。Anthropic と OpenAI の数え方の違いは、ここに入れる前にそろえる。
 * input はキャッシュに当たらなかった入力、cacheRead はキャッシュから読んだ入力、cacheWrite5m・cacheWrite1h はキャッシュへの書き込み。
 * output は推論（thinking・reasoning）を含む出力、reasoning はそのうちの推論の分（内訳として記録するだけで、費用は output で数える）。
 * @typedef {object} Tokens
 * @property {number} input
 * @property {number} cacheRead
 * @property {number} cacheWrite5m
 * @property {number} cacheWrite1h
 * @property {number} output
 * @property {number} reasoning
 */

/** @returns {Tokens} */
export function zeroTokens() {
  return { input: 0, cacheRead: 0, cacheWrite5m: 0, cacheWrite1h: 0, output: 0, reasoning: 0 };
}

/**
 * @param {Tokens} a
 * @param {Tokens} b
 */
export function addTokens(a, b) {
  a.input += b.input;
  a.cacheRead += b.cacheRead;
  a.cacheWrite5m += b.cacheWrite5m;
  a.cacheWrite1h += b.cacheWrite1h;
  a.output += b.output;
  a.reasoning += b.reasoning;
}

/**
 * ログのモデル名を単価表の名前にそろえる。末尾の `[1m]` などの括弧と、`-20251001` のような日付を除く。
 * @param {string} model
 * @returns {string}
 */
export function normalizeModel(model) {
  return model
    .replace(/\[[^\]]*\]$/, "")
    .replace(/-\d{8}$/, "")
    .trim();
}

/**
 * 同梱の単価表を読む。
 * @param {string} path
 * @returns {Record<string, Price>}
 */
export function loadBundledPricing(
  path = fileURLToPath(new URL("../../assets/pricing.json", import.meta.url)),
) {
  const raw = JSON.parse(readFileSync(path, "utf8"));
  if (!isRecord(raw) || !isRecord(raw.models)) throw new Error(`${path}: models が無い`);
  /** @type {Record<string, Price>} */
  const out = {};
  for (const [model, p] of Object.entries(raw.models))
    out[model] = parsePrice(p, `${path}.models.${model}`);
  return out;
}

/**
 * 同梱の単価表から、レビューツールごとの 1 回あたりの推定額を読む。
 * @param {string} path
 * @returns {Record<string, number>}
 */
export function loadBundledReviewPricing(
  path = fileURLToPath(new URL("../../assets/pricing.json", import.meta.url)),
) {
  const raw = JSON.parse(readFileSync(path, "utf8"));
  /** @type {Record<string, number>} */
  const out = {};
  if (!isRecord(raw) || raw.reviews === undefined) return out;
  if (!isRecord(raw.reviews)) throw new Error(`${path}: reviews がオブジェクトでない`);
  for (const [tool, v] of Object.entries(raw.reviews)) {
    if (!isRecord(v) || typeof v.perReview !== "number" || !(v.perReview >= 0)) {
      throw new Error(`${path}.reviews.${tool}: perReview が 0 以上の数でない`);
    }
    out[tool] = v.perReview;
  }
  return out;
}

/**
 * レビュー 1 回の推定額。リポジトリの設定 → 同梱の順に探す。
 * @param {string} tool
 * @param {Record<string, number>} repo
 * @param {Record<string, number>} bundled
 * @returns {{ cost: number | null; source: string }}
 */
export function resolveReviewPrice(tool, repo, bundled) {
  if (Object.hasOwn(repo, tool)) return { cost: repo[tool], source: "estimate-repo" };
  if (Object.hasOwn(bundled, tool)) return { cost: bundled[tool], source: "estimate-bundled" };
  return { cost: null, source: "unknown" };
}

/**
 * @typedef {"repo" | "bundled" | "unknown"} PriceSource
 */

/**
 * @param {string} model
 * @param {Record<string, Price>} repoPricing
 * @param {Record<string, Price>} bundledPricing
 * @returns {{ price: Price | null; source: PriceSource }}
 */
export function resolvePrice(model, repoPricing, bundledPricing) {
  const name = normalizeModel(model);
  for (const key of [model, name]) {
    if (Object.hasOwn(repoPricing, key)) return { price: repoPricing[key], source: "repo" };
  }
  for (const key of [model, name]) {
    if (Object.hasOwn(bundledPricing, key))
      return { price: bundledPricing[key], source: "bundled" };
  }
  return { price: null, source: "unknown" };
}

/**
 * 費用（USD）。単価の欄が無い種類のトークンは、近い欄で代える（OpenAI はキャッシュの書き込みを持たないので input の単価）。
 * @param {Tokens} t
 * @param {Price} p
 * @returns {number}
 */
export function costOf(t, p) {
  const input = p.input ?? 0;
  const output = p.output ?? 0;
  const perM =
    t.input * input +
    t.cacheRead * (p.cacheRead ?? input) +
    t.cacheWrite5m * (p.cacheWrite5m ?? input) +
    t.cacheWrite1h * (p.cacheWrite1h ?? p.cacheWrite5m ?? input) +
    t.output * output;
  return perM / 1e6;
}

/**
 * 単価が分からないときに、費用を配分する重み。単価の比の目安（出力は入力の 5 倍、キャッシュの読み取りは 0.1 倍）で数える。
 * @param {Tokens} t
 * @returns {number}
 */
export function proxyWeight(t) {
  return t.input + t.cacheWrite5m * 1.25 + t.cacheWrite1h * 2 + t.cacheRead * 0.1 + t.output * 5;
}
