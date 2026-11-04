#!/usr/bin/env bash
# 空の DB へ受領スキーマを適用する（current-environment-bootstrap 工程 3 で作成）
set -euo pipefail
mysql --defaults-file="${MYSQL_DEFAULTS_FILE:?}" <received/db/schema.sql
