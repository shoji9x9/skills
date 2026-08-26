#!/usr/bin/env bash
# 暫定起動データを投入する（削除 → 投入）
set -euo pipefail
mysql --defaults-file="${MYSQL_DEFAULTS_FILE:?}" <<'SQL'
DELETE FROM orders;
DELETE FROM customers;
DELETE FROM app_users;
INSERT INTO app_users (login_id, password_hash, role_code) VALUES
  ('admin', '$2y$10$example', 'ADMIN'),
  ('operator', '$2y$10$example', 'OPERATOR');
INSERT INTO customers (code, name, created_at) VALUES
  ('C0001', '株式会社あかつき商事', '2024-04-01 09:00:00'),
  ('C0002', '有限会社みなと物流', '2024-05-15 13:30:00');
SQL
