#!/usr/bin/env bash
# 空の DB へ受領スキーマを適用する
set -euo pipefail
mysql --defaults-file="${MYSQL_DEFAULTS_FILE:?}" <received/db/schema.sql
