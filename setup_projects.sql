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

-- 6. Criar tabelas especificas para Ads
CREATE TABLE IF NOT EXISTS ads_campaign (
    id INT AUTO_INCREMENT PRIMARY KEY,
    project_id INT NOT NULL,
    name VARCHAR(255) NOT NULL,
    form_data LONGTEXT NOT NULL,
    public_url VARCHAR(255),
    current_step INT DEFAULT 0,
    status VARCHAR(50) DEFAULT 'generated',
    metadata LONGTEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    CONSTRAINT fk_ads_campaign_project
        FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS ads_creatives (
    id INT AUTO_INCREMENT PRIMARY KEY,
    project_id INT NOT NULL,
    campaign_id INT NOT NULL,
    name VARCHAR(255) NOT NULL,
    platform VARCHAR(50),
    format VARCHAR(100),
    label VARCHAR(255),
    width INT DEFAULT 1080,
    height INT DEFAULT 1080,
    generated_html LONGTEXT NOT NULL,
    public_url VARCHAR(255),
    sort_order INT DEFAULT 0,
    metadata LONGTEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    CONSTRAINT fk_ads_creatives_project
        FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE,
    CONSTRAINT fk_ads_creatives_campaign
        FOREIGN KEY (campaign_id) REFERENCES ads_campaign(id) ON DELETE CASCADE
);

CREATE INDEX idx_ads_campaign_project_id ON ads_campaign(project_id);
CREATE INDEX idx_ads_creatives_project_id ON ads_creatives(project_id);
CREATE INDEX idx_ads_creatives_campaign_id ON ads_creatives(campaign_id);
CREATE INDEX idx_ads_creatives_sort_order ON ads_creatives(campaign_id, sort_order);

ALTER TABLE ads_creatives ADD COLUMN IF NOT EXISTS generated_html LONGTEXT AFTER height;
ALTER TABLE ads_creatives DROP COLUMN IF EXISTS html;
ALTER TABLE ads_creatives DROP COLUMN IF EXISTS folder_path;
ALTER TABLE ads_campaign DROP COLUMN IF EXISTS board_html;
ALTER TABLE ads_campaign DROP COLUMN IF EXISTS folder_path;
