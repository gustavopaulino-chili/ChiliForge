-- Script SQL para criar tabelas do ChiliForge
-- Execute este script no seu banco MySQL do Hostinger

CREATE TABLE IF NOT EXISTS users (
    id INT AUTO_INCREMENT PRIMARY KEY,
    email VARCHAR(255) NOT NULL UNIQUE,
    pwd VARCHAR(255) NOT NULL,
    name VARCHAR(255) NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS projects (
    id INT AUTO_INCREMENT PRIMARY KEY,
    user_id INT NOT NULL,
    name VARCHAR(255) NOT NULL,
    public_url VARCHAR(255),
    folder_path VARCHAR(255),
    form_data LONGTEXT NOT NULL,
    generated_html LONGTEXT,
    current_step INT DEFAULT 0,
    project_type VARCHAR(50) DEFAULT 'landing_page',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

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

CREATE INDEX idx_user_email ON users(email);
CREATE INDEX idx_projects_user_id ON projects(user_id);
CREATE INDEX idx_projects_created_at ON projects(created_at);
CREATE INDEX idx_ads_campaign_project_id ON ads_campaign(project_id);
CREATE INDEX idx_ads_creatives_project_id ON ads_creatives(project_id);
CREATE INDEX idx_ads_creatives_campaign_id ON ads_creatives(campaign_id);
CREATE INDEX idx_ads_creatives_sort_order ON ads_creatives(campaign_id, sort_order);

ALTER TABLE projects ADD COLUMN IF NOT EXISTS generated_html LONGTEXT AFTER form_data;
ALTER TABLE projects ADD COLUMN IF NOT EXISTS project_type VARCHAR(50) DEFAULT 'landing_page' AFTER current_step;
ALTER TABLE ads_creatives ADD COLUMN IF NOT EXISTS generated_html LONGTEXT AFTER height;
ALTER TABLE ads_creatives DROP COLUMN IF EXISTS html;
ALTER TABLE ads_creatives DROP COLUMN IF EXISTS folder_path;
ALTER TABLE ads_campaign DROP COLUMN IF EXISTS board_html;
ALTER TABLE ads_campaign DROP COLUMN IF EXISTS folder_path;

-- ============================================================
-- API Keys — used by the external Ads Generation API
-- ============================================================
CREATE TABLE IF NOT EXISTS api_keys (
    id             INT AUTO_INCREMENT PRIMARY KEY,
    api_key        VARCHAR(128) NOT NULL UNIQUE,
    label          VARCHAR(255)  DEFAULT NULL COMMENT 'Company / project name',
    user_id        INT           DEFAULT NULL COMMENT 'Owner (FK to users)',
    is_active      TINYINT(1)    NOT NULL DEFAULT 1,
    requests_count INT           NOT NULL DEFAULT 0,
    last_used_at   TIMESTAMP     NULL DEFAULT NULL,
    created_at     TIMESTAMP     NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT fk_api_keys_user
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_api_keys_key ON api_keys(api_key);
