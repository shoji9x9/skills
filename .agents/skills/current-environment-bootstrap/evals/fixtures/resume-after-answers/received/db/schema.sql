-- 受領物: 現行システム DB スキーマ（2026-08-13 受領・非本番検証環境より出力）
-- サーバーバージョン: 8.0.36
-- 文字コード: utf8mb4 / 照合順序: utf8mb4_ja_0900_as_cs
-- タイムゾーン: Asia/Tokyo
-- sql_mode: STRICT_TRANS_TABLES,NO_ENGINE_SUBSTITUTION

CREATE DATABASE IF NOT EXISTS shipdb
  DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_ja_0900_as_cs;

CREATE TABLE customers (
  id         BIGINT       NOT NULL AUTO_INCREMENT,
  code       VARCHAR(16)  NOT NULL,
  name       VARCHAR(120) NOT NULL,
  rank_code  CHAR(1)      NOT NULL,
  created_at DATETIME     NOT NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_customers_code (code)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_ja_0900_as_cs;

CREATE TABLE orders (
  id           BIGINT        NOT NULL AUTO_INCREMENT,
  order_no     VARCHAR(20)   NOT NULL,
  customer_id  BIGINT        NOT NULL,
  status       TINYINT       NOT NULL,
  ordered_at   DATETIME      NOT NULL,
  shipped_at   DATETIME      NULL,
  total_amount DECIMAL(12,0) NOT NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_orders_order_no (order_no),
  CONSTRAINT fk_orders_customer FOREIGN KEY (customer_id) REFERENCES customers (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_ja_0900_as_cs;

CREATE TABLE app_users (
  id            BIGINT       NOT NULL AUTO_INCREMENT,
  login_id      VARCHAR(32)  NOT NULL,
  password_hash VARCHAR(255) NOT NULL,
  role_code     VARCHAR(16)  NOT NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_app_users_login_id (login_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_ja_0900_as_cs;
