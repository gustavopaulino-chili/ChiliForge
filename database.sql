-- Script SQL para criar tabelas do ChiliForge
-- Execute este script no seu banco MySQL do Hostinger

-- Tabela de usuários
CREATE TABLE IF NOT EXISTS users (
    id INT AUTO_INCREMENT PRIMARY KEY,
    email VARCHAR(255) NOT NULL UNIQUE,
    pwd VARCHAR(255) NOT NULL,
    name VARCHAR(255) NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Tabela de projetos
CREATE TABLE IF NOT EXISTS projects (
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

-- Índices para performance
CREATE INDEX idx_user_email ON users(email);
CREATE INDEX idx_projects_user_id ON projects(user_id);
CREATE INDEX idx_projects_created_at ON projects(created_at);

-- Adicionar coluna generated_html se não existir (para tabelas existentes)
ALTER TABLE projects ADD COLUMN IF NOT EXISTS generated_html LONGTEXT AFTER form_data;

-- Usuário de exemplo (remova em produção)
-- INSERT INTO users (email, pwd, name) VALUES ('admin@example.com', '$2y$10$example.hash.here', 'Admin');</content>
<parameter name="filePath">c:\Users\ativa\Downloads\ChiliForge\database.sql