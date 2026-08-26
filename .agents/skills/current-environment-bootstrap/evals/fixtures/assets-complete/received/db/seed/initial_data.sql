-- 受領物: 現行システムの公式初期投入データ（検証環境構築手順書 4.2 節で使用するもの）
INSERT INTO app_users (login_id, password_hash, role_code) VALUES
  ('admin',    '$2y$10$exampleexampleexampleexampleexampleexampleexampleexamp', 'ADMIN'),
  ('operator', '$2y$10$exampleexampleexampleexampleexampleexampleexampleexamp', 'OPERATOR');

INSERT INTO customers (code, name, name_kana, created_at) VALUES
  ('C0001', 'ダミー取引先A株式会社', 'ダミートリヒキサキエーカブシキガイシャ', '2024-04-01 09:00:00'),
  ('C0002', 'ダミー取引先B株式会社', 'ダミートリヒキサキビーカブシキガイシャ', '2024-05-15 13:30:00');
