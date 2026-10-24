import { assert, describe, test, expect } from "vitest";
import { spawnSync } from "node:child_process";
import { chmodSync, copyFileSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { makeTempDir } from "../../../lib/testing/test-tmpdir.ts";
import { CHILD_TIMEOUT_MS } from "../../../lib/testing/child-timeout.ts";
import { kaizenEnv, pathWithout, writeKaizenConfig } from "../kaizen-config-env.ts";

// kaizen-schedule-report.sh は **CI から無人で実行され、出力がそのまま Issue になる**。
// 判定が狂っても人が見ているのは結果の Issue だけなので、狂ったこと自体は出力に現れない。
// とくに skip は「止めたはずのリポジトリが毎週動く」「動かしたいリポジトリが警告なしに止まる」の
// どちらにも誤って判定されうるため、層ごと・軸ごとに 1 検体ずつ固定する。
//
// 状態空間:
//
// | 軸          | 値                                                              |
// |-------------|-----------------------------------------------------------------|
// | skip(env)   | true / false / 不正 / 未設定                                     |
// | skip(config)| true / false / 不正 / キーなし / ファイルなし                      |
// | mode        | notify / agent / 不正（設定ファイル・環境変数） / 未設定             |
// | agent       | claude / codex / copilot / 不正 / 未設定                          |
// | model       | 妥当 / 不正（空白入り） / 未設定                                  |
// | effort      | codex に指定 / codex 以外に指定 / 不正 / 未設定                   |
// | pending     | 0 件 / 1 件 / 複数件（priority 降順・日付昇順）                    |
// | 機能を減らす | 共通ライブラリ欠落 × kaizen.jsonc あり / なし                       |
// | 読めない設定 | 旧い .kaizen/config / パーミッション / node が無い × 設定ファイルあり・なし |
//
// 設定は `.config/skills/shoji9x9/kaizen.jsonc`（JSONC）に書く。不正な値と読めない設定は exit 1 で止める。
//
// **`schedule_enabled` の既定は false（opt-in）。** 書いていないリポジトリは止まる。
// 既定が true へ戻ると、テンプレートを置いただけの配布先が週次で実行し始める（Issue #417）。
// 機能を減らす場合の検体は、`"schedule_enabled": true` で採る。false だと、「読めないときに停止する処理が
// 機能した」のか「既定の false として扱われただけ」なのかを区別できず、変異で赤くならない。
//
// 判定の行を無効にした変異で赤くなることは、kaizen-schedule-report.mutations.json が確かめる。
const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "..");
const scriptDir = join(repoRoot, "skills/kaizen/scripts");
const script = join(scriptDir, "kaizen-schedule-report.sh");

type NoteOptions = {
  slug: string;
  status?: string;
  priority?: string;
  type?: string;
  date?: string;
  body?: string;
  proposal?: string | null;
};

type Project = { dir: string; target: string };

function note({
  slug,
  status = "pending",
  priority = "medium",
  type = "rule",
  date = "2026-09-01",
  body = "",
  proposal = null,
}: NoteOptions) {
  return [
    "---",
    // date に空文字を渡したら行ごと落とす（frontmatter に date が無いノートの再現）。
    ...(date ? [`date: ${date}`] : []),
    `type: ${type}`,
    `priority: ${priority}`,
    `status: ${status}`,
    "applied-to: []",
    "---",
    "",
    `# ${slug}`,
    "",
    "## 提案",
    "",
    proposal ?? `${slug} の提案行。`,
    body,
    "",
  ].join("\n");
}

/** 一時プロジェクトを作って cb に渡す。notes は {name: noteOptions}、config は kaizen.jsonc の中身。 */
function withProject<T>(
  {
    notes = {},
    config = null,
    degraded = false,
  }: {
    notes?: Record<string, Omit<NoteOptions, "slug">>;
    config?: string | null;
    degraded?: boolean;
  },
  cb: (p: Project) => T,
): T {
  const dir = makeTempDir("kaizen-sched-");
  try {
    mkdirSync(join(dir, ".kaizen"), { recursive: true });
    for (const [name, opts] of Object.entries(notes)) {
      writeFileSync(join(dir, ".kaizen", `${name}.md`), note({ slug: name, ...opts }));
    }
    if (config !== null) writeKaizenConfig(dir, config);
    let target = script;
    if (degraded) {
      // 共通ライブラリを持たない場所へスクリプト単体を置く（配布物の部分展開の再現）。
      const solo = join(dir, "solo");
      mkdirSync(solo, { recursive: true });
      target = join(solo, "kaizen-schedule-report.sh");
      copyFileSync(script, target);
    }
    return cb({ dir, target });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

function run({ dir, target }: Project, args: string[], env: NodeJS.ProcessEnv = {}) {
  const res = spawnSync("bash", [target, ...args], {
    timeout: CHILD_TIMEOUT_MS,
    cwd: dir,
    encoding: "utf8",
    // 呼び出し側が渡さない変数は「未設定」であって空文字ではない。継承した値が
    // 紛れ込むと env 層のテストが本来の層を測らなくなるので、明示したものだけを渡す。
    // ロケールだけは明示する。最小 env は C ロケールになり、要約の切り詰めが
    // 機能を減らす分岐で処理される。CI のランナー（UTF-8）と違う条件で測らないよう既定を揃える。
    // 人ごとの設定（XDG_CONFIG_HOME）は一時ディレクトリの中に向ける。設定ファイルを node で読むので、
    // テストを実行している node を PATH の先頭に置く（kaizen-config-env.ts）。
    env: {
      PATH: kaizenEnv(dir).PATH,
      HOME: dir,
      XDG_CONFIG_HOME: join(dir, ".test-xdg"),
      LC_ALL: "C.UTF-8",
      ...env,
    },
  });
  const settings = Object.fromEntries(
    res.stdout
      .split("\n")
      .filter((l) => l.includes("="))
      .map((l) => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1)]),
  );
  return { ...res, settings };
}

describe("設定解決（層・デフォルト値への置き換え）", () => {
  test("有効化済みで他の指定が無ければ既定（notify / claude）で動く", () => {
    withProject({ notes: { a: {} }, config: '{ "schedule_enabled": true }\n' }, (p) => {
      const { status, settings } = run(p, ["config"]);
      expect(status).toBe(0);
      expect(settings).toMatchObject({
        skip: "false",
        mode: "notify",
        agent: "claude",
        pending_count: "1",
      });
    });
  });

  test("env は設定ファイルより優先され、採った層を stderr に出す", () => {
    withProject({ notes: { a: {} }, config: '{ "schedule_mode": "notify" }\n' }, (p) => {
      const { settings, stderr } = run(p, ["config"], { KAIZEN_SCHEDULE_MODE: "agent" });
      expect(settings.mode).toBe("agent");
      expect(stderr).toContain("mode=agent（環境変数 KAIZEN_SCHEDULE_MODE）");
      expect(run(p, ["config"]).stderr).toContain(
        "mode=notify（kaizen の設定ファイル（repo の層）の schedule_mode）",
      );
    });
  });

  // 不正な値をデフォルトの値として扱うと、設定したつもりの動きと違う定期実行が警告なしに続く。
  test.each([
    ['{ "schedule_mode": "bogus" }', '"bogus" は "notify"・"agent" のどれでもない'],
    ['{ "schedule_agent": "gemini" }', '"gemini" は "claude"・"codex"・"copilot" のどれでもない'],
    ['{ "schedule_model": "has space" }', "schedule_model"],
    ['{ "schedule_effort": "!!" }', "schedule_effort"],
    ['{ "schedule_enabled": "maybe" }', 'schedule_enabled: 型が "boolean" でない'],
    ['{ "schedule_mod": "agent" }', '知らないキー "schedule_mod"'],
  ])("不正な設定 %s は exit 1 で止め、理由を stderr に出す", (config, message) => {
    withProject({ notes: { a: {} }, config: `${config}\n` }, (p) => {
      const { status, stdout, stderr } = run(p, ["config"]);
      expect(status).toBe(1);
      expect(stderr).toContain(message);
      expect(stderr).toContain("kaizen の設定を読めないので止める");
      // 判定の材料を出力しない（workflow が skip=false と読んで先へ進まないようにする）
      expect(stdout).not.toContain("skip=");
    });
  });

  test("環境変数の不正な値も exit 1 で止める", () => {
    withProject({ notes: { a: {} }, config: '{ "schedule_enabled": true }\n' }, (p) => {
      const { status, stderr } = run(p, ["config"], { KAIZEN_SCHEDULE_AGENT: "gemini" });
      expect(status).toBe(1);
      expect(stderr).toContain("環境変数 KAIZEN_SCHEDULE_AGENT");
    });
  });

  test("旧い .kaizen/config が残っていれば、移行の手順を示して止める", () => {
    withProject({ notes: { a: {} } }, (p) => {
      writeFileSync(join(p.dir, ".kaizen", "config"), "schedule_enabled=on\n");
      const { status, stderr } = run(p, ["config"]);
      expect(status).toBe(1);
      expect(stderr).toContain(".kaizen/config が残っている");
    });
  });

  test("設定ファイルがあるのに node が無ければ止め、無ければ node なしで opt-in の判定まで進む", () => {
    withProject({ notes: { a: {} } }, (p) => {
      const noNode = { PATH: pathWithout(p.dir, ["node"], kaizenEnv(p.dir).PATH ?? "") };
      const none = run(p, ["config"], noNode);
      expect(none.status).toBe(0);
      expect(none.settings.skip_reason).toContain('"schedule_enabled": true が無い');
      writeKaizenConfig(p.dir, '{ "schedule_enabled": true }\n');
      const { status, stderr } = run(p, ["config"], noNode);
      expect(status).toBe(1);
      expect(stderr).toContain("kaizen の設定を読むには node が要るが、見つからない");
    });
  });

  test("effort を受け取るのは codex だけ", () => {
    withProject(
      { notes: { a: {} }, config: '{ "schedule_agent": "codex", "schedule_effort": "high" }\n' },
      (p) => {
        expect(run(p, ["config"]).settings.effort).toBe("high");
      },
    );
    withProject(
      { notes: { a: {} }, config: '{ "schedule_agent": "claude", "schedule_effort": "high" }\n' },
      (p) => {
        const { settings, stderr } = run(p, ["config"]);
        expect(settings.effort).toBe("");
        expect(stderr).toContain("渡す先が無い");
      },
    );
  });
});

// 定期実行は opt-in。ワークフローを置いた（配られた）だけで週次実行が始まらないよう、
// `schedule_enabled` を書いていないリポジトリは止める。理由まで固定するのは、
// 「止まった」と「そもそも動かなかった」を step summary で区別させるため。
describe("opt-in（schedule_enabled の既定は false）", () => {
  test("config がそもそも無ければ止まり、opt-in であることを理由に出す", () => {
    withProject({ notes: { a: {} } }, (p) => {
      const { settings } = run(p, ["config"]);
      expect(settings.skip).toBe("true");
      expect(settings.skip_reason).toContain('"schedule_enabled": true が無い');
    });
  });

  test("config はあっても schedule_enabled が無ければ止まる", () => {
    withProject({ notes: { a: {} }, config: '{ "schedule_mode": "agent" }\n' }, (p) => {
      const { settings } = run(p, ["config"]);
      expect(settings.skip).toBe("true");
      expect(settings.skip_reason).toContain('"schedule_enabled": true が無い');
    });
  });

  test("schedule_enabled: true を書けば動く（誤検知しないことの確認）", () => {
    withProject({ notes: { a: {} }, config: '{ "schedule_enabled": true }\n' }, (p) => {
      const { settings } = run(p, ["config"]);
      expect(settings.skip).toBe("false");
      expect(settings.skip_reason).toBe("");
    });
  });

  // デフォルトの値（スキーマと共通ライブラリの kaizen_config_defaults）を true にしたときに
  // 上のテストが落ちることは、kaizen-schedule-report.mutations.json が確かめる。
});

describe("skip（どちらかが立てば止まる）", () => {
  test("env の一時停止で止まる", () => {
    withProject({ notes: { a: {} }, config: '{ "schedule_enabled": true }\n' }, (p) => {
      const { settings } = run(p, ["config"], { KAIZEN_SCHEDULE_SKIP: "true" });
      expect(settings.skip).toBe("true");
      expect(settings.skip_reason).toContain("KAIZEN_SCHEDULE_SKIP");
    });
  });

  test("設定ファイルの schedule_enabled: false で止まる", () => {
    withProject({ notes: { a: {} }, config: '{ "schedule_enabled": false }\n' }, (p) => {
      const { settings } = run(p, ["config"]);
      expect(settings.skip).toBe("true");
      expect(settings.skip_reason).toContain("schedule_enabled");
    });
  });

  test("env=false でも schedule_enabled: false なら止まる（上書きではなく追加の安全弁）", () => {
    withProject({ notes: { a: {} }, config: '{ "schedule_enabled": false }\n' }, (p) => {
      expect(run(p, ["config"], { KAIZEN_SCHEDULE_SKIP: "false" }).settings.skip).toBe("true");
    });
  });

  // 理由は step summary と要約に出る唯一の手がかり。上書きにすると、先に立った理由
  // （読めないときの停止など）が消えて「停止の実態」と「表示された理由」がずれる。
  // 先に立つ理由は、共通ライブラリを読めないときの停止で作る（schedule_enabled の側は env より後に評価される）。
  test("先に立った停止の理由が env skip で消えない", () => {
    withProject(
      { notes: { a: {} }, config: '{ "schedule_enabled": true }\n', degraded: true },
      (p) => {
        const { settings } = run(p, ["config"], { KAIZEN_SCHEDULE_SKIP: "true" });
        expect(settings.skip).toBe("true");
        expect(settings.skip_reason).toContain("読めない");
        expect(settings.skip_reason).toContain("KAIZEN_SCHEDULE_SKIP");
      },
    );
  });

  // 一時停止レバーの既定は「止めない」。こちらは opt-in の軸と逆なので、不正値を
  // 止める側として扱うと、typo したリポジトリ変数が、警告のない停止になってしまう。
  test("KAIZEN_SCHEDULE_SKIP が真偽値として読めなければ一時停止しない", () => {
    withProject({ notes: { a: {} }, config: '{ "schedule_enabled": true }\n' }, (p) => {
      const { settings, stderr } = run(p, ["config"], { KAIZEN_SCHEDULE_SKIP: "perhaps" });
      expect(settings.skip).toBe("false");
      expect(stderr).toContain("真偽値として読めない");
    });
  });
});

describe("機能を減らして動く場合（共通ライブラリを読めない）", () => {
  // 検体は true。有効化したつもりのリポジトリを、読めないという理由で止める処理を測る。
  // false だと既定の false として扱われただけでも緑になり、読めないときの停止を消しても赤くならない。
  test("設定ファイルが在っても読めないので停止として扱う", () => {
    withProject(
      { notes: { a: {} }, config: '{ "schedule_enabled": true }\n', degraded: true },
      (p) => {
        const { status, settings, stderr } = run(p, ["config"]);
        expect(status).toBe(0);
        expect(settings.skip).toBe("true");
        expect(settings.skip_reason).toContain("読めない");
        // 読めない以上「キーが無い」とは言えないので、opt-in の理由を重ねない。
        expect(settings.skip_reason).not.toContain('"schedule_enabled": true が無い');
        // 機能を減らして動いたことを、本番の構成と出力で区別できる。
        expect(stderr).toContain("kaizen-hook-common.sh を読めないため");
      },
    );
  });
});

describe("設定ファイルを読めない場合", () => {
  test("設定ファイルがパーミッションで読めないときは exit 1 で止める", () => {
    withProject({ notes: { a: {} }, config: '{ "schedule_enabled": true }\n' }, (p) => {
      const configPath = join(p.dir, ".config", "skills", "shoji9x9", "kaizen.jsonc");
      chmodSync(configPath, 0o000);
      // root で実行すると 000 でも読めてしまい、この分岐へ到達しない（到達しない実行を緑にしない）。
      let readable = true;
      try {
        readFileSync(configPath);
      } catch {
        readable = false;
      }
      expect(readable).toBe(false);
      const { status, stdout, stderr } = run(p, ["config"]);
      chmodSync(configPath, 0o600);
      expect(status).toBe(1);
      expect(stderr).toContain("kaizen の設定を読めない");
      expect(stdout).not.toContain("skip=");
    });
  });
});

describe("pending の数え方と並び", () => {
  test("status は frontmatter 限定で判定し、決着済みは数えない", () => {
    const notes = {
      p1: {},
      done: { status: "applied" },
      // 本文に status: pending を書いても frontmatter が applied なら数えない。
      tricky: { status: "rejected", body: "\n```text\nstatus: pending\n```\n" },
    };
    withProject({ notes }, (p) => {
      expect(run(p, ["config"]).settings.pending_count).toBe("1");
    });
  });

  test("0 件のとき agent は notify として扱われる（エージェントへ渡す材料が無い）", () => {
    withProject(
      { notes: { done: { status: "applied" } }, config: '{ "schedule_mode": "agent" }\n' },
      (p) => {
        const { settings, stderr } = run(p, ["config"]);
        expect(settings).toMatchObject({ pending_count: "0", mode: "notify" });
        expect(stderr).toContain("0 件");
      },
    );
  });

  test("issue 出力は priority 降順で並べ、0 件なら表を出さない", () => {
    const notes = {
      lo: { priority: "low", date: "2026-09-01" },
      hi: { priority: "high", date: "2026-09-03" },
      mid: { priority: "medium", date: "2026-09-02" },
    };
    withProject({ notes }, (p) => {
      const body = run(p, ["issue"]).stdout;
      expect(body).toContain("**3 件**");
      const order = ["hi", "mid", "lo"].map((n) => body.indexOf(`.kaizen/${n}.md`));
      expect(order).toStrictEqual([...order].sort((a, b) => a - b));
      expect(order[0]).toBeGreaterThan(-1);
    });
    withProject({ notes: {} }, (p) => {
      const body = run(p, ["issue"]).stdout;
      expect(body).toContain("**0 件**");
      expect(body).not.toContain("| 優先度 |");
    });
  });

  // ソート用のセンチネル（末尾へ回すための 9999-99-99）を表示へ流用しない。
  // priority / type は `unknown` として扱われるのに date だけありもしない日付が出ると、
  // Issue の読み手はそれを記録日として読む。
  test("date が無いノートはソート用センチネルではなく unknown と表示する", () => {
    withProject(
      { notes: { hi: { priority: "high", date: "2026-09-03" }, nodate: { date: "" } } },
      (p) => {
        // 日付の無いノートは末尾へ回りつつ、表示は unknown になる。
        const body = run(p, ["issue"]).stdout;
        expect(body).toContain(".kaizen/nodate.md");
        expect(body).not.toContain("9999-99-99");
        // 列は `優先度 | 種別 | 記録日`。記録日だけが unknown になる。
        expect(body).toMatch(/\| medium \| rule \| unknown \|/);
        expect(body.indexOf(".kaizen/hi.md")).toBeLessThan(body.indexOf(".kaizen/nodate.md"));
      },
    );
  });

  // Issue 本文は 65,536 文字が上限。超えると `gh issue create/edit` が失敗し、
  // その週のレポートが 1 件も届かない。切った分は件数と参照先を明示する
  // （警告なしに省くと「表に無い＝存在しない」と読まれる）。
  test("表は上限行数で切り、残件数を明示する", () => {
    const notes: Record<string, Omit<NoteOptions, "slug">> = {};
    for (let i = 0; i < 65; i += 1) {
      notes[`n${String(i).padStart(3, "0")}`] = { date: "2026-09-01" };
    }
    withProject({ notes }, (p) => {
      const body = run(p, ["issue"]).stdout;
      expect(body).toContain("**65 件**");
      const rows = [...body.matchAll(/^\| medium \| rule \|/gm)].length;
      expect(rows).toBe(60);
      expect(body).toContain("残り 5 件");
      // 切った側のノートは表に出ない（上限が機能していることの確認）。
      expect(body).not.toContain(".kaizen/n064.md");
    });
  });

  // 予算をコメントで宣言するだけでは守られない。実装で切り、切ったことが分かる形にする。
  test("長い要約は 120 文字で切り、切ったと分かる印を付ける", () => {
    // 日本語で 300 文字。バイト単位で切る実装なら文字の途中で割れる。
    const long = "あ".repeat(300);
    withProject({ notes: { long: { proposal: long }, short: {} } }, (p) => {
      const body = run(p, ["issue"]).stdout;
      const rows = body.split("\n").filter((l) => l.startsWith("| ") && l.includes(".kaizen/"));
      expect(rows).toHaveLength(2);
      const cell = (slug: string) => {
        const row = rows.find((r) => r.includes(`${slug}.md`));
        assert.exists(row, `${slug}.md の行が無い`);
        return row.split(" | ")[4].replace(/ \|$/, "");
      };
      expect(cell("long")).toHaveLength(120);
      expect(cell("long").endsWith("\u2026")).toBe(true);
      // 途中で切れた文字（置換文字）を出さない＝文字単位で切れている。
      expect(cell("long")).not.toContain("\uFFFD");
      // 上限以下の要約はそのまま（切り詰めがすべてに適用されていないことの確認）。
      expect(cell("short").endsWith("\u2026")).toBe(false);
    });
  });

  // 非 UTF-8 ロケールではバイト単位になり文字が割れるので切らない。警告なしに機能を減らして動くと
  // 「切ったはず」と読めてしまう。そのため、機能を減らした run を出力で区別できることまで固定する。
  test("非 UTF-8 ロケールでは切り詰めず、機能を減らして動いたと分かる警告を出す", () => {
    const long = "あ".repeat(300);
    withProject({ notes: { long: { proposal: long } } }, (p) => {
      const { stdout, stderr } = run(p, ["issue"], { LC_ALL: "C" });
      expect(stderr).toContain("ロケールが UTF-8 でないため要約を切り詰めない");
      expect(stdout).not.toContain("…");
    });
  });

  test("上限以下なら切り詰めの注記を出さない", () => {
    withProject({ notes: { a: {}, b: {} } }, (p) => {
      expect(run(p, ["issue"]).stdout).not.toContain("残り");
    });
  });

  test("prompt 出力は対象ノートのパスを列挙する", () => {
    withProject({ notes: { a: {}, b: {} } }, (p) => {
      const out = run(p, ["prompt"]).stdout;
      expect(out).toContain(".kaizen/a.md");
      expect(out).toContain(".kaizen/b.md");
      expect(out).toContain("リポジトリを変更しない");
    });
  });
});

test("未知のサブコマンドは exit 2 で usage を出す", () => {
  withProject({ notes: {} }, (p) => {
    const res = run(p, ["bogus"]);
    expect(res.status).toBe(2);
    expect(res.stderr).toContain("usage:");
  });
});
