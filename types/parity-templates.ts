// 配布スキルの雛形（skills/*/assets/*.template.ts）が import する、コピー先のプロジェクトにだけ在るモジュール。
// シグネチャは利用者のプロジェクトごとに生成されて変わるので、型を固定しない（import したものは any になる）。
// `*` を含む名前は、相対の import（`../../lib/interactions` など）にも一致する。
declare module "*/lib/tools/vendor/trait-capture.mjs";
declare module "*/lib/locator-map/<slug>";
declare module "*/lib/locator-map/<slug>.new";
declare module "*/lib/interactions";
