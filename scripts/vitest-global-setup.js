// vitest の globalSetup。**テストの収集より前**に 1 度だけ走る。
//
// `check-mutation-proof.test.js` の fixture は `scripts/` 配下に作る（vitest の
// `include: ["scripts/**/*.test.js"]` に入っていないと、runner が起動する子 vitest が
// 1 件も走らず、検査ではなく置き場所を測ることになるため）。SIGKILL・timeout・ジョブ打ち切りで
// `afterEach` が走らないと `fixture.test.js` が残り、次の run で収集されてしまう。
//
// **掃き取りをテストファイルの import 時に置かない。** import は収集の**後**なので、
// vitest が残骸を先に列挙してから削除することになり、実行順次第で
// `Failed to load .../fixture.test.js` と無関係に赤くなる（収集より前に消すのが正しい位置）。
import { readdirSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const STALE_PREFIXES = ["mutation-proof-fixture-", "mutation-proof-lock-"];

export function setup() {
  // **runner が起動した子 vitest では掃かない。** 子は `scripts/mutation-proof-fixture-*` の
  // fixture を**いま使っている**ので、ここで消すと検査対象ごと消える（実測で 12 テストが落ちた）。
  // 親（通常の `pnpm test`）だけが掃く。
  if (process.env.MUTATION_PROOF_CHILD) return;
  const scripts = join(repoRoot, "scripts");
  for (const name of readdirSync(scripts)) {
    if (STALE_PREFIXES.some((prefix) => name.startsWith(prefix))) {
      rmSync(join(scripts, name), { recursive: true, force: true });
    }
  }
}
