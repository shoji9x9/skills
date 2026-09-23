-- 受領物: 現行システム DB スキーマ（2026-08-13 受領・非本番検証環境より出力）
-- サーバーバージョン: 8.0.36
-- 文字コード: utf8mb4 / 照合順序: utf8mb4_ja_0900_as_cs

CREATE TABLE orders (
  id           BIGINT        NOT NULL AUTO_INCREMENT,
  order_no     VARCHAR(20)   NOT NULL,
  status       TINYINT       NOT NULL,
  ordered_at   DATETIME      NOT NULL,
  total_amount DECIMAL(12,0) NOT NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_orders_order_no (order_no)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_ja_0900_as_cs;
