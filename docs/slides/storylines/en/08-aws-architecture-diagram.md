# 8. aws-architecture-diagram

Message: Create and update AWS architecture diagrams from IaC.

## Slides

1. The problem. Architecture diagrams drawn by hand in a GUI cannot be reviewed as diffs, and drift away from the IaC. With a diagram per environment, fixing them takes more work.
   Sources: the opening of `skills/aws-architecture-diagram/SKILL.md`, the opening of `skills/aws-architecture-diagram/references/environments.md`
2. How to invoke. The first time, `aws-architecture-diagram setup --from <IaC path>`. After that, `aws-architecture-diagram update --env <env>`.
   Sources: `skills/aws-architecture-diagram/SKILL.md` "使い方"
3. How it works (diagram). The agent reads the IaC or a description and writes a spec (nodes, edges, groups), and the bundled engine generates the SVG. The agent converts it to PNG, checks
   it visually and fixes it.
   Sources: the opening of `skills/aws-architecture-diagram/SKILL.md` and "入力（構成の情報源）"
4. Setup flow. Placement → fetch the AWS icons → decide which environments get diagrams → initial spec → repeat generating and checking. From the second time on, update reflects changes in
   the sources into the spec and regenerates.
   Sources: `skills/aws-architecture-diagram/SKILL.md` "セットアップ（`setup`・対話的）" "生成・更新（`update`・既定）"
5. What is copied and what is not. Templates are copied once and the user edits them. The engine is not copied and runs from the skill.
   Sources: `skills/aws-architecture-diagram/SKILL.md` "同梱物と配置の方針（コピーするものとしないもの）"
6. Drawing rules. Reduce line crossings, bend lines at right angles, align axes, and place labels where they can be read.
   Sources: `skills/aws-architecture-diagram/SKILL.md` "作図ルール（要点）"
7. Diagrams per environment. One base spec plus transformations produces a diagram for each environment. Show the prod and local diagrams of the bundled sample side by side.
   The sample diagrams contain official AWS icons. Use them within the scope AWS permits for architecture diagrams (the sample's `NOTICE.md`).
   Sources: `skills/aws-architecture-diagram/references/environments.md`, `skills/aws-architecture-diagram/assets/samples/serverless-web-app/`
8. Where people decide. Where to put the diagrams, which environments get diagrams, the sources, and the level of detail when the IaC is large.
   Sources: `skills/aws-architecture-diagram/SKILL.md` "セットアップ（`setup`・対話的）" "入力（構成の情報源）"
9. Outputs. The spec, the environment definitions, and an SVG per environment. PNGs used for checking go to a temporary directory and are not included. The skill is used on its own, so there
   is no "Related skills" slide.
   Sources: `skills/aws-architecture-diagram/SKILL.md` "生成・更新（`update`・既定）", `skills/aws-architecture-diagram/scripts/preview-diagram.mjs`
