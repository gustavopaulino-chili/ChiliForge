-- Script SQL para criar a tabela de servidores FTP no MySQL
-- Execute no phpMyAdmin/Hostinger se for usar deploy FTP salvo no painel

CREATE TABLE IF NOT EXISTS ftp_servers (
    id INT AUTO_INCREMENT PRIMARY KEY,
    user_id INT NOT NULL,
    label VARCHAR(255) DEFAULT NULL,
    host VARCHAR(255) NOT NULL,
    port INT NOT NULL DEFAULT 21,
    username VARCHAR(255) NOT NULL,
    target_dir VARCHAR(255) NOT NULL DEFAULT '/',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT fk_ftp_servers_user
        FOREIGN KEY (user_id) REFERENCES users(id)
        ON DELETE CASCADE
);

CREATE INDEX idx_ftp_servers_user_id ON ftp_servers(user_id);
CREATE INDEX idx_ftp_servers_host ON ftp_servers(host);