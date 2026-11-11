/**
 * e2e の設定（雛形）— spec-parity
 *
 * このファイルは、プロジェクトへコピーして使う雛形である。コピー先はプロジェクトのルートの `e2e.config.ts` にする。
 * 既に e2e.config.ts があれば上書きせず、targets・initScripts・reporters の 3 か所を既存の設定に足す。
 *
 * - targets: current と new の 2 つ。URL は tests/parity/sides.ts が環境変数から解決する。渡していない側は入れない
 * - initScripts: 操作中のエラーを記録する init script を、すべての target に入れる
 * - reporters: 操作中のエラーの記録を書く reporter。PARITY_RUNTIME_CAPTURE=1 の実行でだけ書く
 * - tests: e2e のデフォルト（tests/**\/*.e2e.ts）のまま。tests/parity/ の部品は *.e2e.ts でないので集められない
 * 幅は、web() の viewport で決める（デフォルトの幅を変えたいときだけ書く）。横のはみ出しは、テストの中の browser.setViewport で幅を変えて測る。
 */
import { web } from "@e2e-dev/web";
import { SIDES } from "./tests/parity/sides.ts";
import { runtimeErrorsReporter } from "./tests/parity/runtime-errors-reporter.ts";

const engine = () => web({ initScripts: [{ path: "tests/parity/runtime-errors-init.js" }] });

const targets = [
  ...(SIDES.current
    ? [{ name: "current", engine: engine(), app: { url: SIDES.current.app } }]
    : []),
  ...(SIDES.new ? [{ name: "new", engine: engine(), app: { url: SIDES.new.app } }] : []),
];

export default {
  targets,
  reporters: ["list", runtimeErrorsReporter()],
};
