// run-skill-eval.test.ts と fixtures/parity-component-fixtures.test.ts が JSON のファイルを読むヘルパー。
import { readFileSync } from "node:fs";
import { parseJsonAs } from "../lib/parse-as.ts";

// The caller declares the shape it reads.
export function readJson<T = Record<string, unknown>>(path: string): T {
  return parseJsonAs<T>(readFileSync(path, "utf8"));
}
