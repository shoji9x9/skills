// 配布スキルの雛形（skills/*/assets/*.template.ts）が import する、コピー先のプロジェクトにだけ在るモジュール。
// シグネチャは利用者のプロジェクトごとに生成されて変わるので、型を固定しない（import したものは any になる）。
// `*` を含む名前は、相対の import（`../../lib/interactions` など）にも一致する。
declare module "*/lib/tools/vendor/trait-capture.mjs";
declare module "*/lib/locator-map/<slug>";
declare module "*/lib/locator-map/<slug>.new";
declare module "*/lib/interactions";
// spec-parity の雛形が import する、コピー先で隣に置く部品（tests/parity/）。
// e2e と @e2e-dev/web の型は devDependencies から読む。部品は型を固定しない（import したものは any になる）。
declare module "*/parity/sides.ts";
declare module "*/parity/test.ts";
declare module "*/parity/runtime-errors-reporter.ts";
