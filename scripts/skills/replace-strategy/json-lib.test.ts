// replace-strategy の lib/json.mjs の parseJsonOrThrow のテスト。
//
// parseJsonOrThrow は JSON を読み、読めなければ構文エラーの message を toError に渡して、返った例外を投げる。
// append-only-check.mjs・asset-delivery-check.mjs・evidence-gap-check.mjs は、toError で自分の UsageError と文言を作る。

import { expect, test, vi } from "vitest";
import { parseJsonOrThrow } from "../../../skills/replace-strategy/scripts/lib/json.mjs";

class StubError extends Error {}

test("JSON として読めれば値を返し、toError を呼ばない", () => {
  const toError = vi.fn((message: string) => new StubError(message));
  expect(parseJsonOrThrow('{"a":[1,null]}', toError)).toEqual({ a: [1, null] });
  expect(parseJsonOrThrow("null", toError)).toBeNull();
  expect(toError).not.toHaveBeenCalled();
});

test("読めなければ、JSON.parse の message を toError に渡し、返った例外を投げる", () => {
  let expected = "";
  try {
    JSON.parse("{");
  } catch (e) {
    expected = e instanceof Error ? e.message : "";
  }
  expect(expected).not.toBe("");
  const toError = vi.fn((message: string) => new StubError(`読めない: x.json（${message}）`));
  expect(() => parseJsonOrThrow("{", toError)).toThrow(StubError);
  expect(() => parseJsonOrThrow("{", toError)).toThrow(`読めない: x.json（${expected}）`);
  expect(toError).toHaveBeenCalledWith(expected);
});
