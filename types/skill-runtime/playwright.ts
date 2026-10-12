// 配布スキルのスクリプトが JSDoc で参照する `playwright` の型。`tsconfig.skills.json` の `paths` がこのファイルへ解決する。
// 同じ型は、devDependencies の `@playwright/test` が公開している。
export type { Locator, Page } from "@playwright/test";
