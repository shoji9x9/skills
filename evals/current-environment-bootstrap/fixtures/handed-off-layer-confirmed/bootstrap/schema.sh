#!/usr/bin/env bash
# 空の DB へ受領スキーマを適用する（current-environment-bootstrap 工程 3 で作成）
set -euo pipefail
# インスタンスのタイムゾーンと sql_mode は、received/db/schema.sql のヘッダの値（schema.md 1 節）
mysql --defaults-file="${MYSQL_DEFAULTS_FILE:?}" <<'SQL'
SET PERSIST time_zone = 'Asia/Tokyo';
SET PERSIST sql_mode = 'STRICT_TRANS_TABLES,NO_ENGINE_SUBSTITUTION';
SQL
mysql --defaults-file="${MYSQL_DEFAULTS_FILE:?}" <received/db/schema.sql
