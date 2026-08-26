-- MySQL dump 10.13  Distrib 8.0.36
-- Host: db-01    Database: shipdb
-- ------------------------------------------------------
-- Server version 8.0.36

CREATE TABLE `customers` (
  `id` bigint NOT NULL AUTO_INCREMENT,
  `code` varchar(16) NOT NULL,
  `name` varchar(120) NOT NULL,
  `tel` varchar(20) DEFAULT NULL,
  `email` varchar(255) DEFAULT NULL,
  `created_at` datetime NOT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_customers_code` (`code`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_ja_0900_as_cs;

INSERT INTO `customers` VALUES
 (1,'C0001','株式会社あかつき商事','03-5555-0101','keiri@akatsuki-shoji.example.jp','2019-04-01 09:00:00'),
 (2,'C0002','有限会社みなと物流','045-555-0202','info@minato-butsuryu.example.jp','2019-05-15 13:30:00'),
 (3,'C0003','鈴木製作所','052-555-0303','suzuki@suzuki-ss.example.jp','2020-01-20 10:15:00');

CREATE TABLE `orders` (
  `id` bigint NOT NULL AUTO_INCREMENT,
  `order_no` varchar(20) NOT NULL,
  `customer_id` bigint NOT NULL,
  `status` tinyint NOT NULL,
  `ordered_at` datetime NOT NULL,
  `shipped_at` datetime DEFAULT NULL,
  `total_amount` decimal(12,0) NOT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_orders_order_no` (`order_no`),
  CONSTRAINT `fk_orders_customer` FOREIGN KEY (`customer_id`) REFERENCES `customers` (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_ja_0900_as_cs;

INSERT INTO `orders` VALUES
 (10001,'ORD-20260320-0001',1,2,'2026-03-20 10:02:11','2026-03-22 14:30:00',482000),
 (10002,'ORD-20260321-0002',3,1,'2026-03-21 09:44:52',NULL,1250000);

CREATE TABLE `app_users` (
  `id` bigint NOT NULL AUTO_INCREMENT,
  `login_id` varchar(32) NOT NULL,
  `password_hash` varchar(255) NOT NULL,
  `role_code` varchar(16) NOT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_app_users_login_id` (`login_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_ja_0900_as_cs;

INSERT INTO `app_users` VALUES
 (1,'t.yamada','$2y$10$xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx','ADMIN'),
 (2,'m.sato','$2y$10$yyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyy','OPERATOR');
