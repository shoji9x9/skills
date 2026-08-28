#!/usr/bin/env bash
set -euo pipefail

if git rev-parse --is-inside-work-tree >/dev/null 2>&1; then
	exit 0
fi

git init -b main
git config user.name "Eval User"
git config user.email "eval@example.invalid"
printf '%s\n' '# Evaluation repository' >README.md
git add README.md
git commit -m 'chore: initialize repository'
git switch -c develop
printf '%s\n' 'base' >base.txt
git add base.txt
git commit -m 'feat: add base change'
git switch -c feature/12-example
printf '%s\n' 'feature' >feature.txt
git add feature.txt
git commit -m 'feat: add feature change'
git switch develop
printf '%s\n' 'advanced' >advanced.txt
git add advanced.txt
git commit -m 'feat: advance integration branch'
git switch main
git clone --bare . .fixture-origin
git switch feature/12-example
git remote add origin "$PWD/.fixture-origin"
git fetch origin
