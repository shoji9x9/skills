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
// | skip(config)| on / off / 不正 / 未設定                                         |
// | mode        | notify / agent / 不正 / 未設定                                   |
// | agent       | claude / codex / copilot / 不正 / 未設定                          |
// | model       | 妥当 / 不正（空白入り） / 未設定                                  |
// | effort      | codex に指定 / codex 以外に指定 / 不正 / 未設定                   |
// | pending     | 0 件 / 1 件 / 複数件（priority 降順・日付昇順）                    |
// | 縮退        | 共通ライブラリ欠落 × .kaizen/config あり / なし                    |
//
// 変異による検出能力の実証（このファイルを書いた時点で 3 通り実施し、いずれも赤くなることを実測した）:
//   1. `config_unreadable` の skip 代入を消す → 1 件 fail（縮退時に fail-open へ戻る）
//   2. schedule_enabled の `1)` 分岐から skip 代入を消す → 2 件 fail（config での停止が効かない）
//   3. pending 0 件での `resolved_mode=notify` への倒しを消す → 1 件 fail
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
    `${slug} の提案行。`,
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
    env: { PATH: process.env.PATH, HOME: dir, ...env },
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
  test("config も env も無ければ既定（notify / claude）で動く", () => {
    withProject({ notes: { a: {} } }, (p) => {
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

describe("skip（どちらかが立てば止まる）", () => {
  test("env の一時停止で止まる", () => {
    withProject({ notes: { a: {} } }, (p) => {
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
    withProject({ notes: { a: {} }, config: "schedule_enabled=off\n" }, (p) => {
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

  test("真偽値として読めない値は skip しない側へ倒す", () => {
    withProject({ notes: { a: {} }, config: "schedule_enabled=maybe\n" }, (p) => {
      const { settings, stderr } = run(p, ["config"], { KAIZEN_SCHEDULE_SKIP: "perhaps" });
      expect(settings.skip).toBe("false");
      expect(stderr).toContain("真偽値として読めない");
    });
  });
});

describe("縮退（共通ライブラリを読めない）", () => {
  test("config が在るのに読めないなら停止側へ倒す（fail-closed）", () => {
    withProject({ notes: { a: {} }, config: "schedule_enabled=off\n", degraded: true }, (p) => {
      const { settings } = run(p, ["config"]);
      expect(settings.skip).toBe("true");
      expect(settings.skip_reason).toContain("読めない");
    });
  });

  test("config がそもそも無ければ尊重する設定が無いので進む", () => {
    withProject({ notes: { a: {} }, degraded: true }, (p) => {
      expect(run(p, ["config"]).settings.skip).toBe("false");
    });
  });

  // ライブラリが読めても `.kaizen/config` 自体が読めなければ同じ穴になる。
  // kaizen_config_value は「読めない」と「キーが無い」を同じ 1 で返すため、
  // 区別しないと schedule_enabled=off を読み落として fail-open する。
  test("config がパーミッションで読めないときも停止側へ倒す", () => {
    withProject({ notes: { a: {} }, config: "schedule_enabled=off\n" }, (p) => {
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
      expect(run(p, ["config"]).settings.skip).toBe("true");
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
