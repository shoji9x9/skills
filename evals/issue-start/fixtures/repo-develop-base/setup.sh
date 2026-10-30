#!/usr/bin/env bash
set -euo pipefail

if git rev-parse --is-inside-work-tree >/dev/null 2>&1; then
	exit 0
fi

git init -b main
git config user.name "Eval User"
git config user.email "eval@example.invalid"
git add AGENTS.md
git commit -m 'chore: initialize repository'
git switch -c develop
printf '%s\n' 'base' >base.txt
git add base.txt
git commit -m 'feat: add base change'
git switch main
# GitHub には接続できないので、origin は URL だけを置き、remote-tracking ref を手元で作る。
git remote add origin git@github.com:shoji9x9/skills.git
git update-ref refs/remotes/origin/main main
git update-ref refs/remotes/origin/develop develop
