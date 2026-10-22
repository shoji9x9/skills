// preview-diagram.test.ts のヘルパー。
import { spawnSync } from "node:child_process";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { makeTempDir } from "../../lib/testing/test-tmpdir.ts";

export const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
export const script = join(repoRoot, "skills/aws-architecture-diagram/scripts/preview-diagram.mjs");

export const FAKE_CHROME = `#!/usr/bin/env bash
printf '%s\\n' "$@" > "$FAKE_CHROME_LOG/args.txt"
for a in "$@"; do
  case "$a" in
    --screenshot=*) shot="\${a#--screenshot=}" ;;
    file://*) page="\${a#file://}" ;;
  esac
done
cp "$page" "$FAKE_CHROME_LOG/page.html"
case "\${FAKE_CHROME_MODE:-ok}" in
  ok) printf 'PNG' > "$shot" ;;
  fail)
    for i in 1 2 3 4 5 6; do echo "line $i" >&2; done
    echo "Failed to connect to the bus: no dbus" >&2
    exit 3 ;;
  signal) kill -TERM $$ ;;
  hang) exec sleep 30 ;;
esac
`;

export type Run = {
  args?: string[];
  svg?: string | null;
  svgName?: string;
  env?: Record<string, string>;
  /** 人ごとの設定（${XDG_CONFIG_HOME}/skills/shoji9x9/aws-architecture-diagram.jsonc）の中身 */
  userConfig?: string;
};

/** 人ごとの設定と、入力の SVG を書く。 */
function writeInputs(dir: string, out: string, opts: Run) {
  if (opts.userConfig !== undefined) {
    const userDir = join(dir, "xdg", "skills", "shoji9x9");
    mkdirSync(userDir, { recursive: true });
    writeFileSync(join(userDir, "aws-architecture-diagram.jsonc"), opts.userConfig);
  }
  if (opts.svg !== null) {
    writeFileSync(
      join(out, opts.svgName ?? "architecture-prod.svg"),
      opts.svg ?? '<svg xmlns="http://www.w3.org/2000/svg" width="640" height="480"><rect/></svg>',
    );
  }
}

export function run(opts: Run) {
  const dir = makeTempDir("preview-");
  const out = join(dir, "out");
  const tmp = join(dir, "tmp");
  const log = join(dir, "log");
  for (const d of [out, tmp, log]) mkdirSync(d);
  writeInputs(dir, out, opts);
  const chrome = join(dir, "fake-chrome");
  writeFileSync(chrome, FAKE_CHROME);
  chmodSync(chrome, 0o755);
  const result = spawnSync(
    process.execPath,
    [script, ...(opts.args ?? ["prod"]), "--out-dir", out],
    {
      // 手元の設定ファイルを読まないよう、git の外の一時ディレクトリで実行し、人ごとの設定の置き場所も一時ディレクトリにする
      cwd: dir,
      env: {
        ...process.env,
        XDG_CONFIG_HOME: join(dir, "xdg"),
        PUPPETEER_EXECUTABLE_PATH: chrome,
        TMPDIR: tmp,
        FAKE_CHROME_LOG: log,
        ...opts.env,
      },
      encoding: "utf8",
      timeout: 20000,
    },
  );
  if (result.error) throw result.error;
  const argsFile = join(log, "args.txt");
  const chromeArgs = existsSync(argsFile) ? readFileSync(argsFile, "utf8").trim().split("\n") : [];
  const pageFile = join(log, "page.html");
  return {
    ...result,
    tmp,
    chrome,
    chromeArgs,
    page: existsSync(pageFile) ? readFileSync(pageFile, "utf8") : "",
    // 一時ディレクトリ（diagram-preview-*）が残っていないかを見るための、TMPDIR の中身。
    leftovers: readdirSync(tmp).filter((f) => f.startsWith("diagram-preview-")),
  };
}

export const windowSize = (args: string[]) => args.find((a) => a.startsWith("--window-size="));
