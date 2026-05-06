-- Script SQL simplificado para Hostinger
-- Execute estes comandos UM POR UM no phpMyAdmin do Hostinger

-- 1. Verificar se tabela existe
SHOW TABLES LIKE 'projects';

-- 2. Se não existir, criar tabela
CREATE TABLE projects (
    id INT AUTO_INCREMENT PRIMARY KEY,
    user_id INT NOT NULL,
    name VARCHAR(255) NOT NULL,
    public_url VARCHAR(255),
    folder_path VARCHAR(255),
    form_data LONGTEXT NOT NULL,
    generated_html LONGTEXT,
    current_step INT DEFAULT 0,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

-- 3. Verificar estrutura criada
DESCRIBE projects;

-- 4. Se tabela já existia, adicionar coluna generated_html
ALTER TABLE projects ADD COLUMN generated_html LONGTEXT AFTER form_data;

-- 5. Verificar novamente
DESCRIBE projects;