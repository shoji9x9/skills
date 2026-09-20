import { describe, test, expect } from "vitest";
import { spawnSync } from "node:child_process";
import {
  chmodSync,
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

// kaizen-schedule-report.sh は **CI から無人で走り、出力がそのまま Issue になる**。
// 判定が狂っても人が見ているのは結果の Issue だけなので、狂ったこと自体は出力に現れない。
// とくに skip は「止めたはずのリポジトリが毎週動く」「動かしたいリポジトリが黙って止まる」の
// どちらにも倒れうるため、層ごと・軸ごとに 1 検体ずつ固定する。
//
// 状態空間:
//
// | 軸          | 値                                                              |
// |-------------|-----------------------------------------------------------------|
// | skip(env)   | true / false / 不正 / 未設定                                     |
// | skip(config)| on / off / 不正 / キーなし / ファイルなし                          |
// | mode        | notify / agent / 不正 / 未設定                                   |
// | agent       | claude / codex / copilot / 不正 / 未設定                          |
// | model       | 妥当 / 不正（空白入り） / 未設定                                  |
// | effort      | codex に指定 / codex 以外に指定 / 不正 / 未設定                   |
// | pending     | 0 件 / 1 件 / 複数件（priority 降順・日付昇順）                    |
// | 縮退        | 共通ライブラリ欠落 × .kaizen/config あり / なし                    |
//
// **`schedule_enabled` の既定は off（opt-in）。** 書いていないリポジトリは止まる。
// 既定が on へ戻ると、テンプレートを置いただけの配布先が週次で走り出す（Issue #417）。
// 縮退・パーミッションの検体は `schedule_enabled=on` で採る——`off` だと「fail-closed が
// 効いた」のか「既定 off に倒れただけ」なのかを区別できず、変異で赤くならない。
//
// 変異による検出能力の実証（実測。いずれも狙った assertion が落ちることを確認した）:
//   1. `config_unreadable` の skip 代入を消す → 縮退・パーミッションの各 fail-closed が fail
//   2. schedule_enabled の `1)` 分岐から skip 代入を消す → config での停止が効かず fail
//   3. pending 0 件での `resolved_mode=notify` への倒しを消す → 1 件 fail
//   4. キーなしの `else` 分岐から skip 代入を消す → opt-in の既定が fail
const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const scriptDir = join(repoRoot, "skills/kaizen/scripts");
const script = join(scriptDir, "kaizen-schedule-report.sh");

function note({
  slug,
  status = "pending",
  priority = "medium",
  type = "rule",
  date = "2026-09-01",
  body = "",
  proposal = null,
}) {
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

/** 一時プロジェクトを作って cb に渡す。notes は {name: noteOptions}、config は .kaizen/config の中身。 */
function withProject({ notes = {}, config = null, degraded = false }, cb) {
  const dir = mkdtempSync(join(tmpdir(), "kaizen-sched-"));
  try {
    mkdirSync(join(dir, ".kaizen"), { recursive: true });
    for (const [name, opts] of Object.entries(notes)) {
      writeFileSync(join(dir, ".kaizen", `${name}.md`), note({ slug: name, ...opts }));
    }
    if (config !== null) writeFileSync(join(dir, ".kaizen", "config"), config);
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

function run({ dir, target }, args, env = {}) {
  const res = spawnSync("bash", [target, ...args], {
    cwd: dir,
    encoding: "utf8",
    // 呼び出し側が渡さない変数は「未設定」であって空文字ではない。継承した値が
    // 紛れ込むと env 層のテストが本来の層を測らなくなるので、明示したものだけを渡す。
    // ロケールだけは明示する——最小 env は C ロケールになり、要約の切り詰めが
    // 縮退経路へ落ちる。CI のランナー（UTF-8）と違う条件で測らないよう既定を揃える。
    env: { PATH: process.env.PATH, HOME: dir, LC_ALL: "C.UTF-8", ...env },
  });
  const settings = Object.fromEntries(
    res.stdout
      .split("\n")
      .filter((l) => l.includes("="))
      .map((l) => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1)]),
  );
  return { ...res, settings };
}

describe("設定解決（層・既定倒し）", () => {
  test("有効化済みで他の指定が無ければ既定（notify / claude）で動く", () => {
    withProject({ notes: { a: {} }, config: "schedule_enabled=on\n" }, (p) => {
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

  test("env は config より優先される", () => {
    withProject({ notes: { a: {} }, config: "schedule_mode=notify\n" }, (p) => {
      const { settings } = run(p, ["config"], { KAIZEN_SCHEDULE_MODE: "agent" });
      expect(settings.mode).toBe("agent");
    });
  });

  test("不正値は既定へ倒し、倒したことを stderr に出す", () => {
    const config =
      "schedule_mode=bogus\nschedule_agent=gemini\nschedule_model=has space\nschedule_effort=!!\n";
    withProject({ notes: { a: {} }, config }, (p) => {
      const { settings, stderr } = run(p, ["config"]);
      expect(settings).toMatchObject({ mode: "notify", agent: "claude", model: "", effort: "" });
      for (const key of ["mode=bogus", "agent=gemini", "model=has space", "effort=!!"]) {
        expect(stderr).toContain(key);
      }
    });
  });

  test("effort を受け取るのは codex だけ", () => {
    withProject(
      { notes: { a: {} }, config: "schedule_agent=codex\nschedule_effort=high\n" },
      (p) => {
        expect(run(p, ["config"]).settings.effort).toBe("high");
      },
    );
    withProject(
      { notes: { a: {} }, config: "schedule_agent=claude\nschedule_effort=high\n" },
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
describe("opt-in（schedule_enabled の既定は off）", () => {
  test("config がそもそも無ければ止まり、opt-in であることを理由に出す", () => {
    withProject({ notes: { a: {} } }, (p) => {
      const { settings } = run(p, ["config"]);
      expect(settings.skip).toBe("true");
      expect(settings.skip_reason).toContain("schedule_enabled=on が無い");
    });
  });

  test("config はあっても schedule_enabled が無ければ止まる", () => {
    withProject({ notes: { a: {} }, config: "schedule_mode=agent\n" }, (p) => {
      const { settings } = run(p, ["config"]);
      expect(settings.skip).toBe("true");
      expect(settings.skip_reason).toContain("schedule_enabled=on が無い");
    });
  });

  test("schedule_enabled=on を書けば動く（陰性コントロール）", () => {
    withProject({ notes: { a: {} }, config: "schedule_enabled=on\n" }, (p) => {
      const { settings } = run(p, ["config"]);
      expect(settings.skip).toBe("false");
      expect(settings.skip_reason).toBe("");
    });
  });

  // **既定は定数が決める。** 分岐ごとに `skip="true"` を直書きすると、定数を on にしても
  // 挙動は止まったままメッセージだけが「既定 on」と嘘をつく（実測でこの状態だった）。
  // 定数を差し替えた複製を走らせ、既定が本当に反転することで判定点の単一性を測る。
  test("DEFAULT_SCHEDULE_ENABLED が実際の既定を決める（メッセージだけではない）", () => {
    const flipped = readFileSync(script, "utf8").replace(
      /^readonly DEFAULT_SCHEDULE_ENABLED=off$/m,
      "readonly DEFAULT_SCHEDULE_ENABLED=on",
    );
    // 置換が当たったことの陽性コントロール（空振りだと既定 off のまま測ってしまう）。
    expect(flipped).toContain("readonly DEFAULT_SCHEDULE_ENABLED=on");
    const dir = mkdtempSync(join(tmpdir(), "kaizen-sched-default-"));
    try {
      mkdirSync(join(dir, ".kaizen"), { recursive: true });
      writeFileSync(join(dir, ".kaizen", "a.md"), note({ slug: "a" }));
      const target = join(dir, "kaizen-schedule-report.sh");
      // 共通ライブラリも一緒に置く（縮退経路で測らないため）。
      copyFileSync(join(scriptDir, "kaizen-hook-common.sh"), join(dir, "kaizen-hook-common.sh"));
      writeFileSync(target, flipped);
      // 既定が on になるので、キーが無くても走る側へ反転する。
      expect(run({ dir, target }, ["config"]).settings.skip).toBe("false");
      // 明示的な off は既定に関わらず止まる（既定の反転が上書きに化けていないこと）。
      writeFileSync(join(dir, ".kaizen", "config"), "schedule_enabled=off\n");
      expect(run({ dir, target }, ["config"]).settings.skip).toBe("true");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  // 不正値を有効側へ倒すと、typo した `.kaizen/config` が「有効化した証拠」になってしまう。
  test("schedule_enabled が真偽値として読めなければ既定 off へ倒して止まる", () => {
    withProject({ notes: { a: {} }, config: "schedule_enabled=maybe\n" }, (p) => {
      const { settings, stderr } = run(p, ["config"]);
      expect(settings.skip).toBe("true");
      expect(stderr).toContain("真偽値として読めない");
      expect(stderr).toContain("既定 off へ倒す");
      expect(settings.skip_reason).toContain("schedule_enabled=maybe");
    });
  });
});

describe("skip（どちらかが立てば止まる）", () => {
  test("env の一時停止で止まる", () => {
    withProject({ notes: { a: {} }, config: "schedule_enabled=on\n" }, (p) => {
      const { settings } = run(p, ["config"], { KAIZEN_SCHEDULE_SKIP: "true" });
      expect(settings.skip).toBe("true");
      expect(settings.skip_reason).toContain("KAIZEN_SCHEDULE_SKIP");
    });
  });

  test("config の schedule_enabled=off で止まる", () => {
    withProject({ notes: { a: {} }, config: "schedule_enabled=off\n" }, (p) => {
      const { settings } = run(p, ["config"]);
      expect(settings.skip).toBe("true");
      expect(settings.skip_reason).toContain("schedule_enabled");
    });
  });

  test("env=false でも config=off なら止まる（上書きではなく追加の安全弁）", () => {
    withProject({ notes: { a: {} }, config: "schedule_enabled=off\n" }, (p) => {
      expect(run(p, ["config"], { KAIZEN_SCHEDULE_SKIP: "false" }).settings.skip).toBe("true");
    });
  });

  // 理由は step summary と要約に出る唯一の手がかり。上書きにすると、先に立った理由
  // （fail-closed の発動など）が消えて「停止の実態」と「表示された理由」がずれる。
  //
  // 判別できるのは **config_unreadable が先に立ったとき**だけ。`schedule_enabled` 側は
  // env より後に評価されるので、env を上書きにしても後勝ちで両方残ってしまい、
  // この分岐へ到達しない（最初に書いたテストがまさにそれで、変異で赤くならなかった）。
  test("先に立った fail-closed の理由が env skip で消えない", () => {
    // 検体は `on`。`off` だと「読めないので止めた」のか「既定 off に倒れた」のかを
    // 区別できず、fail-closed を消す変異で赤くならない。
    withProject({ notes: { a: {} }, config: "schedule_enabled=on\n" }, (p) => {
      const configPath = join(p.dir, ".kaizen", "config");
      chmodSync(configPath, 0o000);
      let readable = true;
      try {
        readFileSync(configPath);
      } catch {
        readable = false;
      }
      expect(readable).toBe(false);
      const { settings } = run(p, ["config"], { KAIZEN_SCHEDULE_SKIP: "true" });
      chmodSync(configPath, 0o600);
      expect(settings.skip).toBe("true");
      expect(settings.skip_reason).toContain("読めない");
      expect(settings.skip_reason).toContain("KAIZEN_SCHEDULE_SKIP");
    });
  });

  // 一時停止レバーの既定は「止めない」。こちらは opt-in の軸と逆なので、不正値を
  // 止める側へ倒すと、typo したリポジトリ変数が無言の停止に化ける。
  test("KAIZEN_SCHEDULE_SKIP が真偽値として読めなければ一時停止しない", () => {
    withProject({ notes: { a: {} }, config: "schedule_enabled=on\n" }, (p) => {
      const { settings, stderr } = run(p, ["config"], { KAIZEN_SCHEDULE_SKIP: "perhaps" });
      expect(settings.skip).toBe("false");
      expect(stderr).toContain("真偽値として読めない");
    });
  });
});

describe("縮退（共通ライブラリを読めない）", () => {
  // 検体は `on`。有効化したつもりのリポジトリを、読めないという理由で止める経路を測る。
  // `off` だと既定 off に倒れただけでも緑になり、fail-closed を消しても赤くならない。
  test("config が在るのに読めないなら停止側へ倒す（fail-closed）", () => {
    withProject({ notes: { a: {} }, config: "schedule_enabled=on\n", degraded: true }, (p) => {
      const { settings } = run(p, ["config"]);
      expect(settings.skip).toBe("true");
      expect(settings.skip_reason).toContain("読めない");
      // 読めない以上「キーが無い」とは言えないので、opt-in の理由を重ねない。
      expect(settings.skip_reason).not.toContain("schedule_enabled=on が無い");
    });
  });

  test("config がそもそも無ければ opt-in の既定で止まる（縮退が理由ではない）", () => {
    withProject({ notes: { a: {} }, degraded: true }, (p) => {
      const { settings } = run(p, ["config"]);
      expect(settings.skip).toBe("true");
      expect(settings.skip_reason).toContain("schedule_enabled=on が無い");
      expect(settings.skip_reason).not.toContain("読めない");
    });
  });

  // ライブラリが読めても `.kaizen/config` 自体が読めなければ同じ穴になる。
  // kaizen_config_value は「読めない」と「キーが無い」を同じ 1 で返すため、
  // 区別しないと schedule_enabled=off を読み落として fail-open する。
  test("config がパーミッションで読めないときも停止側へ倒す", () => {
    // 同じ理由で検体は `on`（`off` では既定 off との弁別ができない）。
    withProject({ notes: { a: {} }, config: "schedule_enabled=on\n" }, (p) => {
      const configPath = join(p.dir, ".kaizen", "config");
      chmodSync(configPath, 0o000);
      // root で走ると 000 でも読めてしまい、この分岐へ到達しない（到達しない実行を緑にしない）。
      let readable = true;
      try {
        readFileSync(configPath);
      } catch {
        readable = false;
      }
      expect(readable).toBe(false);
      const { settings } = run(p, ["config"]);
      expect(settings.skip).toBe("true");
      expect(settings.skip_reason).toContain("読めない");
      chmodSync(configPath, 0o600);
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

  test("0 件のとき agent は notify へ倒れる（エージェントへ渡す材料が無い）", () => {
    withProject(
      { notes: { done: { status: "applied" } }, config: "schedule_mode=agent\n" },
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
  // priority / type は `unknown` に倒れるのに date だけありもしない日付が出ると、
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
  // （黙って落とすと「表に無い＝存在しない」と読まれる）。
  test("表は上限行数で切り、残件数を明示する", () => {
    const notes = {};
    for (let i = 0; i < 65; i += 1) {
      notes[`n${String(i).padStart(3, "0")}`] = { date: "2026-09-01" };
    }
    withProject({ notes }, (p) => {
      const body = run(p, ["issue"]).stdout;
      expect(body).toContain("**65 件**");
      const rows = [...body.matchAll(/^\| medium \| rule \|/gm)].length;
      expect(rows).toBe(60);
      expect(body).toContain("残り 5 件");
      // 切った側のノートは表に出ない（上限が効いている陰性コントロール）。
      expect(body).not.toContain(".kaizen/n064.md");
    });
  });

  // 予算をコメントで宣言するだけでは守られない（`.kaizen/2026-09-19-length-limit-
  // measured-by-proxy-not-enforcer.md`）。実装で切り、切ったことが分かる形にする。
  test("長い要約は 120 文字で切り、切ったと分かる印を付ける", () => {
    // 日本語で 300 文字。バイト単位で切る実装なら文字の途中で割れる。
    const long = "あ".repeat(300);
    withProject({ notes: { long: { proposal: long }, short: {} } }, (p) => {
      const body = run(p, ["issue"]).stdout;
      const rows = body.split("\n").filter((l) => l.startsWith("| ") && l.includes(".kaizen/"));
      expect(rows).toHaveLength(2);
      const cell = (slug) =>
        rows
          .find((r) => r.includes(`${slug}.md`))
          .split(" | ")[4]
          .replace(/ \|$/, "");
      expect(cell("long")).toHaveLength(120);
      expect(cell("long").endsWith("\u2026")).toBe(true);
      // 壊れた文字（置換文字）を出さない＝文字単位で切れている。
      expect(cell("long")).not.toContain("\uFFFD");
      // 上限以下の要約はそのまま（切り詰めが無差別に効いていない陰性コントロール）。
      expect(cell("short").endsWith("\u2026")).toBe(false);
    });
  });

  // 非 UTF-8 ロケールではバイト単位になり文字が割れるので切らない。黙って縮退すると
  // 「切ったはず」と読めてしまうので、縮退した run を出力で区別できることまで固定する。
  test("非 UTF-8 ロケールでは切り詰めず、縮退したと分かる警告を出す", () => {
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
