#!/usr/bin/env bash
# 暫定の起動データを投入する（current-environment-bootstrap 工程 6 で作成）
set -euo pipefail
mysql --defaults-file="${MYSQL_DEFAULTS_FILE:?}" shipdb <<SQL
INSERT INTO app_users (login_id, password_hash, role_code) VALUES
  ('bootstrap-admin', '${BOOTSTRAP_ADMIN_PASSWORD_HASH:?}', 'ADMIN'),
  ('bootstrap-operator', '${BOOTSTRAP_OPERATOR_PASSWORD_HASH:?}', 'OPERATOR');
SQL
