import { takeCoverage } from "node:v8";
import { afterAll } from "vitest";

afterAll(() => {
  if (process.env.NODE_V8_COVERAGE) takeCoverage();
});
