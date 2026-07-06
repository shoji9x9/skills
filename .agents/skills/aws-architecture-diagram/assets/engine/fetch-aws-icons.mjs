// AWS 公式アイコン（AWS Architecture Icons）を取得し、icon-manifest.json の
// マッピングに従って aws-icons/<id>.svg として書き出す（スキル所有のエンジン。
// コピーせずスキルから実行する）。SVG 自体はスキルに同梱せず、使う人が公式パッケージ
// から取得する（再配布を避ける）。
//
//   cd <図ディレクトリ> && node <skill>/assets/engine/fetch-aws-icons.mjs [--only id,...]
//   （または DIAGRAM_DIR を指定。--out で出力先を直接指定も可）
//
// プロジェクト所有ファイル（DIAGRAM_DIR に置く。既定は cwd）:
//   icon-manifest.json    id → AWS サービス名のマッピング（ここに追記して増やす）
//   icons/aws-icons/      既定の出力先
//
// パッケージ URL は四半期ごとに変わるため固定せず、公式ページ
//   https://aws.amazon.com/architecture/icons/
// から現行の Icon-package_*.zip を動的に取得する。ZIP は Node の zlib だけで展開する
// （unzip / python への依存なし）。マニフェストに載っていて見つからなかった id は
// stderr に警告する（AWS 側のファイル名変更に気づけるように）。
//
// 出典・利用条件は出力先ディレクトリに NOTICE.md を書き出す。
import { inflateRawSync } from "node:zlib";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const DIAGRAM_DIR = process.env.DIAGRAM_DIR ?? process.cwd();
const ICONS_PAGE = "https://aws.amazon.com/architecture/icons/";

function arg(name) {
  const argv = process.argv.slice(2);
  const i = argv.indexOf(name);
  if (i >= 0) return argv[i + 1];
  const eq = argv.find((a) => a.startsWith(`${name}=`));
  return eq ? eq.slice(name.length + 1) : undefined;
}

const OUT_DIR = arg("--out") ?? join(DIAGRAM_DIR, "icons/aws-icons");
const only = arg("--only")
  ?.split(",")
  .map((s) => s.trim())
  .filter(Boolean);

const manifest = JSON.parse(readFileSync(join(DIAGRAM_DIR, "icon-manifest.json"), "utf8"));
if (!manifest.aws || typeof manifest.aws !== "object") {
  throw new Error(
    'icon-manifest.json に aws マッピングがありません（{ "aws": { id: "AWSサービス名" } }）',
  );
}
const wanted = Object.entries(manifest.aws).filter(([id]) => !only || only.includes(id));
if (only) {
  const unknown = only.filter((id) => !(id in manifest.aws));
  if (unknown.length)
    console.error(`警告: マニフェストに無い id を無視します: ${unknown.join(", ")}`);
}

// HTTP ステータスを確認してから本文を返す（非 200 を後段の不可解なエラーに化けさせない）。
async function fetchOk(url, what) {
  const res = await fetch(url);
  if (!res.ok)
    throw new Error(`${what}の取得に失敗しました（HTTP ${res.status} ${res.statusText}）: ${url}`);
  return res;
}

// --- 公式ページから現行パッケージ URL を抽出 ---
async function resolvePackageUrl() {
  const html = await (await fetchOk(ICONS_PAGE, "公式アイコンページ")).text();
  const m = html.match(/https:\/\/[^"']*Icon-package_[^"']+\.zip/);
  if (!m)
    throw new Error(
      "公式ページから Icon-package の URL を抽出できませんでした（ページ構成の変更かもしれません）",
    );
  return m[0];
}

// --- 標準 ZIP の展開（必要ファイルだけ、central directory から解決） ---
function readZipEntries(buf) {
  // End Of Central Directory を末尾から探す。
  let eocd = -1;
  for (let i = buf.length - 22; i >= 0 && i >= buf.length - 22 - 0xffff; i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new Error("ZIP: EOCD が見つかりません");
  const count = buf.readUInt16LE(eocd + 10);
  let p = buf.readUInt32LE(eocd + 16); // central directory の先頭
  const entries = new Map();
  for (let n = 0; n < count; n++) {
    if (buf.readUInt32LE(p) !== 0x02014b50) break;
    const method = buf.readUInt16LE(p + 10);
    const compSize = buf.readUInt32LE(p + 20);
    const nameLen = buf.readUInt16LE(p + 28);
    const extraLen = buf.readUInt16LE(p + 30);
    const commentLen = buf.readUInt16LE(p + 32);
    const localOffset = buf.readUInt32LE(p + 42);
    const name = buf.toString("utf8", p + 46, p + 46 + nameLen);
    p += 46 + nameLen + extraLen + commentLen;
    // __MACOSX/ 配下は AppleDouble のメタデータ複製。basename が実体と衝突しうるので除外する。
    if (name.startsWith("__MACOSX/")) continue;
    entries.set(name.split("/").pop(), { name, method, compSize, localOffset });
  }
  return entries;
}

function extract(buf, entry) {
  // ローカルヘッダから実データ開始位置を求める（name/extra 長は central と別値のことがある）。
  const lo = entry.localOffset;
  if (buf.readUInt32LE(lo) !== 0x04034b50)
    throw new Error(`ZIP: ローカルヘッダ不正: ${entry.name}`);
  const nameLen = buf.readUInt16LE(lo + 26);
  const extraLen = buf.readUInt16LE(lo + 28);
  const start = lo + 30 + nameLen + extraLen;
  const data = buf.subarray(start, start + entry.compSize);
  if (entry.method === 0) return data; // stored
  if (entry.method === 8) return inflateRawSync(data); // deflate
  throw new Error(`ZIP: 未対応の圧縮方式 ${entry.method}: ${entry.name}`);
}

const url = await resolvePackageUrl();
console.log(`パッケージ: ${url}`);
const buf = Buffer.from(await (await fetchOk(url, "アイコンパッケージ")).arrayBuffer());
const entries = readZipEntries(buf);

mkdirSync(OUT_DIR, { recursive: true });
const missing = [];
let ok = 0;
for (const [id, service] of wanted) {
  const fileName = `Arch_${service}_64.svg`;
  const entry = entries.get(fileName);
  if (!entry) {
    missing.push(`${id} (${fileName})`);
    continue;
  }
  const svg = extract(buf, entry).toString("utf8");
  writeFileSync(join(OUT_DIR, `${id}.svg`), svg);
  ok++;
}

writeFileSync(join(OUT_DIR, "NOTICE.md"), NOTICE());
console.log(`書き出し: ${ok} 個 → ${OUT_DIR}`);
if (missing.length) {
  console.error(
    `警告: 次の id は取得できませんでした（AWS 側のファイル名変更の可能性。icon-manifest.json を確認）:\n  - ${missing.join("\n  - ")}`,
  );
}

function NOTICE() {
  return `# アイコンの出典

本ディレクトリのアイコンは **AWS Architecture Icons**（AWS 公式）を \`fetch-aws-icons.mjs\` で
取得したものです。スキルには SVG を同梱せず、利用者が公式パッケージから取得します。

- 出典: AWS Architecture Icons — <https://aws.amazon.com/architecture/icons/>
- 取得元: <${url}>
- 利用範囲: AWS はアーキテクチャ図の作成目的での利用を許諾している。
- 注意: アイコンは四半期ごとに更新されるため、差し替え時はバージョンを混在させない。
  社外配布物へ転用する場合は、配布元パッケージ同梱の Terms と AWS の商標／ブランド
  ガイドラインを確認すること（AWS との提携を誤認させる使用は不可）。

ブラウザ / 外部 API 等の非 AWS アイコン（\`icons/\` 直下）は別出典・別ライセンス。
`;
}
