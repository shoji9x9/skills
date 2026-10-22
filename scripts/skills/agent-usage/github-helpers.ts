// github.test.ts のヘルパー。
import { crc32, deflateRawSync } from "node:zlib";
import { parseRepoConfig } from "../../../skills/agent-usage/scripts/lib/config.mjs";
import { collectGitHub } from "../../../skills/agent-usage/scripts/lib/sources/github.mjs";
import { ms } from "./utc-day-helpers.ts";

export type Gh = (args: readonly string[], opts: { binary?: boolean }) => Buffer;

export function options(
  gh: Gh,
  extra: Partial<Parameters<typeof collectGitHub>[0]> = {},
): Parameters<typeof collectGitHub>[0] {
  return {
    slug: "o/r",
    since: ms(0),
    now: ms(12),
    person: "p-00000001",
    tz: "UTC",
    config: parseRepoConfig({ reviewPricing: { copilot: 0.04 } }),
    bundledTools: {
      "copilot-pull-request-reviewer": "copilot",
      "chatgpt-codex-connector": "codex-cloud",
    },
    bundledPricing: { "gpt-5.5": { input: 5, output: 30 } },
    bundledReviewPricing: { "codex-cloud": 0.1 },
    commands: [],
    billing: "none",
    gh,
    ...extra,
  };
}

export const noGh: Gh = () => {
  throw new Error("呼ばれない想定");
};

/** 無圧縮と deflate の項目を持つ zip を作る（テスト用の最小の書き手）。 */
export function makeZip(entries: { name: string; data: Buffer; method: 0 | 8 | 99 }[]): Buffer {
  const locals: Buffer[] = [];
  const centrals: Buffer[] = [];
  let offset = 0;
  for (const e of entries) {
    const body = e.method === 8 ? deflateRawSync(e.data) : e.data;
    const name = Buffer.from(e.name);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(e.method, 8);
    local.writeUInt32LE(crc32(e.data), 14);
    local.writeUInt32LE(body.length, 18);
    local.writeUInt32LE(e.data.length, 22);
    local.writeUInt16LE(name.length, 26);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(e.method, 10);
    central.writeUInt32LE(crc32(e.data), 16);
    central.writeUInt32LE(body.length, 20);
    central.writeUInt32LE(e.data.length, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt32LE(offset, 42);
    locals.push(local, name, body);
    centrals.push(central, name);
    offset += 30 + name.length + body.length;
  }
  const cd = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(cd.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, cd, end]);
}

// collectGitHub に渡す偽の gh。graphql は PR の一覧を、それ以外は path の部分文字列で選んだ応答を返す。
// どれにも当たらない REST の呼び出しは、空の 1 ページを返す。
export function fakeGh(
  prs: object[],
  routes: [string, unknown][] = [],
  user: unknown = { login: "me" },
): Gh {
  return (args) => {
    if (args[0] === "user") return Buffer.from(JSON.stringify(user));
    if (args[0] === "graphql") {
      const nodes = args.some((a) => a.includes("is:open")) ? prs.slice(0, 1) : prs;
      return Buffer.from(
        JSON.stringify([
          { data: { search: { pageInfo: { hasNextPage: false, endCursor: null }, nodes } } },
        ]),
      );
    }
    const path = args[args.length - 1];
    for (const [needle, body] of routes) {
      if (path.includes(needle)) {
        if (body instanceof Error) throw body;
        return Buffer.isBuffer(body) ? body : Buffer.from(JSON.stringify(body));
      }
    }
    return Buffer.from(JSON.stringify([{ workflow_runs: [], artifacts: [], check_runs: [] }]));
  };
}

export const prNode = (items: unknown[], extra: object = {}) => ({
  number: 7,
  headRefName: "feature/5-x",
  author: { login: "me" },
  headRefOid: "abc",
  closedAt: null,
  timelineItems: { pageInfo: { hasNextPage: false }, nodes: items },
  ...extra,
});

export const waits = (
  rows: { kind?: string; agent?: string; start?: string; end?: string; detail?: string }[],
) => rows.filter((r) => r.kind === "review-wait").map((r) => [r.agent, r.start, r.end, r.detail]);

export const throwingUser: Gh = (args, opts) => {
  if (args[0] === "user") throw "文字列の例外";
  return fakeGh([])(args, opts);
};
export const graphqlReturning =
  (body: string): Gh =>
  (args, opts) =>
    args[0] === "graphql" ? Buffer.from(body) : fakeGh([])(args, opts);
