# セキュリティポリシー / Security Policy

日本語の後に、同じ内容を英語で書く。

The English version follows the Japanese version. Both versions say the same thing.

## 日本語

### 対象

このリポジトリの次のものを対象にする。

- 配布スキル（`skills/` の下）と、スキルに同梱したスクリプト・テンプレート
- このリポジトリの GitHub Actions のワークフロー（`.github/workflows/` の下）

`gh skill install` で利用者のプロジェクトに入れたスキルの脆弱性も、このリポジトリに報告してよい。

### サポートするバージョン

配布スキルは最新のリリースだけを、ワークフローは `main` ブランチの最新だけをサポートする。
配布スキルの修正は、`main` に入れた後に新しいリリースとして公開する。修正が届くのは、そのリリースを `gh skill update` で入れた後である。

### 脆弱性の報告

報告は、このリポジトリの private vulnerability reporting のフォームから送る。
<https://github.com/shoji9x9/skills/security/advisories/new>

脆弱性を公開の Issue と PR に書かない。
受け取った報告には、7 日以内に受領を返す。修正の後に、公開の時期を報告者と相談して決める。

## English

### Scope

This policy covers the following parts of this repository:

- The distributed skills (under `skills/`) and the scripts and templates bundled with them
- The GitHub Actions workflows of this repository (under `.github/workflows/`)

You can also report a vulnerability in a skill that you installed into your own project with `gh skill install`.

### Supported Versions

For the distributed skills, only the latest release is supported. For the workflows, only the latest commit on the `main` branch is supported.
Fixes to the distributed skills are merged into `main` and then published in a new release. You get a fix after you install that release with `gh skill update`.

### Reporting a Vulnerability

Please use the private vulnerability reporting form of this repository:
<https://github.com/shoji9x9/skills/security/advisories/new>

Do not disclose vulnerabilities in a public Issue or pull request.
We acknowledge reports within 7 days. After a fix is available, we agree on the disclosure timeline with the reporter.
