# 8. aws-architecture-diagram

伝えること: IaC から AWS の構成図を作り、更新する。

## スライド

1. 困りごと。GUI で手で描いた構成図は、差分をレビューできず、IaC とずれていく。環境ごとに図があると、直す手間が増える。
   根拠: `skills/aws-architecture-diagram/SKILL.md` の冒頭、`skills/aws-architecture-diagram/references/environments.md` の冒頭
2. 呼び出し方。初回は `aws-architecture-diagram setup --from <IaC のパス>`、以降は `aws-architecture-diagram update --env <環境名>`。
   根拠: `skills/aws-architecture-diagram/SKILL.md`「使い方」
3. 仕組み（図）。IaC か説明を読んで spec（ノード・エッジ・グループ）を書き、同梱のエンジンが SVG を作る。PNG に変換して目で確かめ、直す。
   根拠: `skills/aws-architecture-diagram/SKILL.md` の冒頭と「入力（構成の情報源）」
4. setup の流れ。配置 → AWS のアイコンの取得 → 図を持つ環境の決定 → 初期の spec → 生成と確認の繰り返し。2 回目からは update で、情報源の変化を spec に反映して生成し直す。
   根拠: `skills/aws-architecture-diagram/SKILL.md`「セットアップ（`setup`・対話的）」「生成・更新（`update`・既定）」
5. コピーするものとしないもの。テンプレートは 1 回だけコピーして利用者が編集し、エンジンはコピーせずスキルから実行する。
   根拠: `skills/aws-architecture-diagram/SKILL.md`「同梱物と配置の方針（コピーするものとしないもの）」
6. 作図ルール。線の交差を減らす、線を直角に曲げる、軸をそろえる、ラベルを読める位置に置く。
   根拠: `skills/aws-architecture-diagram/SKILL.md`「作図ルール（要点）」
7. 環境ごとの図。1 つの基本の spec と変換で、環境ごとの図を出し分ける。同梱のサンプルの prod と local の図を並べる。
   サンプルの図には AWS 公式アイコンが入っている。AWS が許諾するアーキテクチャ図の範囲で使う（サンプルの `NOTICE.md`）。
   根拠: `skills/aws-architecture-diagram/references/environments.md`、`skills/aws-architecture-diagram/assets/samples/serverless-web-app/`
8. 人が判断する点。図の置き場所、図を持つ環境、情報源、IaC が大きいときに図に載せる粒度。
   根拠: `skills/aws-architecture-diagram/SKILL.md`「セットアップ（`setup`・対話的）」「入力（構成の情報源）」
9. 成果物。spec、環境の定義、環境ごとの SVG。確認に使う PNG は一時ディレクトリに出すので含めない。単独で使うので、つながるスキルのスライドは置かない。
   根拠: `skills/aws-architecture-diagram/SKILL.md`「生成・更新（`update`・既定）」、`skills/aws-architecture-diagram/scripts/preview-diagram.mjs`
