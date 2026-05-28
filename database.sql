-- Script SQL para criar tabelas do ChiliForge
-- Execute este script no seu banco MySQL do Hostinger

CREATE TABLE IF NOT EXISTS users (
    id INT AUTO_INCREMENT PRIMARY KEY,
    email VARCHAR(255) NOT NULL UNIQUE,
    pwd VARCHAR(255) NOT NULL,
    name VARCHAR(255) NOT NULL,
    account_type ENUM('admin', 'user') NOT NULL DEFAULT 'user',
    gemini_api_key VARCHAR(255) NULL DEFAULT NULL,
    generate_as_image TINYINT(1) NOT NULL DEFAULT 0,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Migration: add gemini_api_key if upgrading from older schema
ALTER TABLE users ADD COLUMN IF NOT EXISTS gemini_api_key VARCHAR(255) NULL DEFAULT NULL;
-- Migration: add generate_as_image if upgrading from older schema
ALTER TABLE users ADD COLUMN IF NOT EXISTS generate_as_image TINYINT(1) NOT NULL DEFAULT 0;

CREATE TABLE IF NOT EXISTS projects (
    id                INT AUTO_INCREMENT PRIMARY KEY,
    user_id           INT NOT NULL,
    name              VARCHAR(255) NOT NULL,
    public_url        VARCHAR(255),
    folder_path       VARCHAR(255),
    company_form_data LONGTEXT NOT NULL DEFAULT '{}',
    context           LONGTEXT,
    project_type      VARCHAR(50) DEFAULT 'landing_page',
    phone             VARCHAR(30) NULL DEFAULT NULL,
    created_at        TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at        TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS lps (
    id             INT AUTO_INCREMENT PRIMARY KEY,
    project_id     INT NOT NULL UNIQUE,
    public_url     VARCHAR(255),
    folder_path    VARCHAR(255),
    form_data      LONGTEXT NOT NULL DEFAULT '{}',
    generated_html LONGTEXT,
    current_step   INT DEFAULT 0,
    created_at     TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at     TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    CONSTRAINT fk_lps_project
        FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS ads_campaign (
    id                  INT AUTO_INCREMENT PRIMARY KEY,
    project_id          INT NOT NULL,
    name                VARCHAR(255) NOT NULL,
    form_data           LONGTEXT NOT NULL,
    public_url          VARCHAR(255),
    current_step        INT DEFAULT 0,
    status              VARCHAR(50) DEFAULT 'generated',
    metadata            LONGTEXT,
    creative_plans      LONGTEXT,
    api_source          VARCHAR(100) NULL DEFAULT NULL,
    external_request_id VARCHAR(128) NULL DEFAULT NULL,
    created_at          TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at          TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
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
CREATE INDEX idx_projects_type ON projects(project_type);
CREATE INDEX idx_lps_project_id ON lps(project_id);
CREATE INDEX idx_ads_campaign_project_id ON ads_campaign(project_id);
CREATE INDEX idx_ads_creatives_project_id ON ads_creatives(project_id);
CREATE INDEX idx_ads_creatives_campaign_id ON ads_creatives(campaign_id);
CREATE INDEX idx_ads_creatives_sort_order ON ads_creatives(campaign_id, sort_order);

ALTER TABLE projects DROP COLUMN IF EXISTS generated_json_site;
ALTER TABLE users ADD COLUMN IF NOT EXISTS account_type ENUM('admin', 'user') NOT NULL DEFAULT 'user' AFTER name;
ALTER TABLE projects ADD COLUMN IF NOT EXISTS public_url VARCHAR(255) AFTER name;
ALTER TABLE projects ADD COLUMN IF NOT EXISTS folder_path VARCHAR(255) AFTER public_url;
ALTER TABLE projects ADD COLUMN IF NOT EXISTS company_form_data LONGTEXT NOT NULL DEFAULT '{}' AFTER folder_path;
ALTER TABLE projects ADD COLUMN IF NOT EXISTS context LONGTEXT AFTER company_form_data;
ALTER TABLE projects ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP AFTER created_at;
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

-- ============================================================
-- Company-project linking: LP/Ad projects reference their parent company project
-- All statements are idempotent — safe to run on an existing database.
-- ============================================================
ALTER TABLE projects ADD COLUMN IF NOT EXISTS company_project_id INT NULL AFTER user_id;
CREATE INDEX IF NOT EXISTS idx_projects_company ON projects(company_project_id);

-- Add FK only when it does not already exist (MySQL 8 dynamic SQL trick)
SET @_fk_exists = (
  SELECT COUNT(*) FROM information_schema.TABLE_CONSTRAINTS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'projects'
    AND CONSTRAINT_NAME = 'fk_projects_company'
);
SET @_add_fk = IF(
  @_fk_exists = 0,
  'ALTER TABLE projects ADD CONSTRAINT fk_projects_company FOREIGN KEY (company_project_id) REFERENCES projects(id) ON DELETE SET NULL',
  'SELECT 1'
);
PREPARE _fk_stmt FROM @_add_fk;
EXECUTE _fk_stmt;
DEALLOCATE PREPARE _fk_stmt;

-- ============================================================
-- Agents — AI agent configs (LP_AGENT, ADS_AGENT)
-- ============================================================
CREATE TABLE IF NOT EXISTS agents (
  id            INT AUTO_INCREMENT PRIMARY KEY,
  name          VARCHAR(100) NOT NULL,
  type          ENUM('landing_page', 'ads') NOT NULL,
  system_prompt LONGTEXT NOT NULL,
  model         VARCHAR(100) NOT NULL DEFAULT 'gemini-2.5-flash',
  temperature   DECIMAL(3,2) NOT NULL DEFAULT 0.90,
  max_tokens    INT NOT NULL DEFAULT 24000,
  is_active     TINYINT(1) NOT NULL DEFAULT 1,
  version       INT NOT NULL DEFAULT 1,
  created_at    TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at    TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uk_agent_name (name)
);

-- system_prompt contains only structural/output-format rules.
-- Creative guidelines, tone, and examples are managed via global File Search Stores
-- (gemini_global_lp_store / gemini_global_ads_store in system_settings).
INSERT IGNORE INTO agents (name, type, system_prompt, model, temperature, max_tokens, version) VALUES
(
  'LP_AGENT',
  'landing_page',
  'You are a landing page generator. Follow all guidelines from your knowledge base.\n\nOUTPUT FORMAT (MANDATORY): Return ONLY the raw HTML document. Start with <!DOCTYPE html> and end with </html>. No markdown, no code fences, no JSON, no extra text before or after.\n\nTECH STACK (FIXED — do not deviate):\n- Tailwind CSS CDN: <script src="https://cdn.tailwindcss.com"></script>\n- Google Fonts <link> in <head> before Tailwind\n- Font Awesome 6 CDN\n- Minimal <style> block ONLY for @keyframes\n- One <script> block before </body>\n\nHARD CONSTRAINTS:\n- No external scripts beyond the above CDNs\n- No iframes\n- All images via <img src="..."> or CSS background-image using provided URLs only\n- No placeholder images (no picsum, no unsplash unless explicitly given)\n- SEO: unique <title>, meta description, OG tags, JSON-LD\n- Write all copy in the language specified in the generation request',
  'gemini-2.5-flash',
  0.90,
  24000,
  1
),
(
  'ADS_AGENT',
  'ads',
  'You are an HTML ad banner generator with full creative freedom. Choose any visual concept, composition, color expression, and typographic approach that best serves the campaign objective. Follow the technical rendering rules from your knowledge base.\n\nOUTPUT FORMAT (MANDATORY): For EACH format requested, output ONE self-contained <div> wrapped in markers:\n<!-- BANNER_START -->\n<div class="ad-banner" style="width:Xpx;height:Ypx;position:relative;overflow:hidden;box-sizing:border-box;" data-platform="PLATFORM" data-format="FORMAT">\n  <!-- layers -->\n</div>\n<!-- BANNER_END -->\n\nTECHNICAL CONSTRAINTS (structural only — all creative decisions remain yours):\n- ALL styles MUST be inline via style="...". Font @import is allowed inside a <style> tag scoped inside the banner div.\n- Every element MUST use position:absolute with explicit top (or bottom) AND left (or right) AND width AND height. Never leave any position coordinate implicit.\n- Required z-index layers: background z-index:0, overlay z-index:5, product z-index:10, logo z-index:20, headline z-index:30, subheadline z-index:35, CTA z-index:40.\n- The outer .ad-banner div MUST have width:Xpx;height:Ypx;overflow:hidden;position:relative;box-sizing:border-box with the exact format dimensions.\n- No flexbox or grid — use absolute positioning for all elements (this enables Figma-like drag editing).\n- Single-line text elements: always add white-space:nowrap;overflow:hidden;text-overflow:ellipsis and an explicit max-width.\n- No external scripts. No iframes. No placeholder images.',
  'gemini-2.5-flash',
  0.80,
  16000,
  2
);

-- ============================================================
-- Gemini File Search Store columns for persistent knowledge
-- ============================================================
ALTER TABLE projects
  ADD COLUMN IF NOT EXISTS gemini_store_name VARCHAR(255) NULL DEFAULT NULL AFTER company_form_data;

ALTER TABLE ads_campaign
  ADD COLUMN IF NOT EXISTS creative_plans LONGTEXT NULL AFTER metadata;

ALTER TABLE ads_campaign
  ADD COLUMN IF NOT EXISTS gemini_memory_store VARCHAR(255) NULL DEFAULT NULL AFTER metadata;

ALTER TABLE ads_campaign
  ADD COLUMN IF NOT EXISTS gemini_good_examples_store VARCHAR(255) NULL DEFAULT NULL AFTER gemini_memory_store;

CREATE TABLE IF NOT EXISTS ads_campaign_examples (
  id                   INT AUTO_INCREMENT PRIMARY KEY,
  campaign_id          INT NOT NULL,
  creative_id          INT NOT NULL,
  gemini_store_name    VARCHAR(255) NULL,
  gemini_document_name VARCHAR(500) NULL,
  created_at           TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uk_campaign_example (campaign_id, creative_id),
  INDEX idx_campaign_examples_campaign (campaign_id),
  INDEX idx_campaign_examples_creative (creative_id),
  CONSTRAINT fk_campaign_examples_campaign
    FOREIGN KEY (campaign_id) REFERENCES ads_campaign(id) ON DELETE CASCADE,
  CONSTRAINT fk_campaign_examples_creative
    FOREIGN KEY (creative_id) REFERENCES ads_creatives(id) ON DELETE CASCADE
);

-- ============================================================
-- Company store uploaded files (PDFs, brand guides, etc.)
-- ============================================================
CREATE TABLE IF NOT EXISTS company_store_files (
  id                 INT AUTO_INCREMENT PRIMARY KEY,
  company_project_id INT NOT NULL,
  gemini_file_uri    VARCHAR(500) NULL,
  gemini_store_name  VARCHAR(255) NULL,
  record_type        ENUM('company_profile', 'uploaded_file') NOT NULL DEFAULT 'uploaded_file',
  display_name       VARCHAR(255) NOT NULL,
  original_name      VARCHAR(255) NULL,
  mime_type          VARCHAR(100) NOT NULL DEFAULT 'application/pdf',
  file_size_bytes    INT NULL,
  storage_path       VARCHAR(500) NULL,
  uploaded_by        INT NULL,
  created_at         TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at         TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_csf_company (company_project_id),
  INDEX idx_csf_record_type (record_type)
);

ALTER TABLE company_store_files
  ADD COLUMN IF NOT EXISTS gemini_store_name VARCHAR(255) NULL AFTER gemini_file_uri;

ALTER TABLE company_store_files
  ADD COLUMN IF NOT EXISTS record_type ENUM('company_profile', 'uploaded_file') NOT NULL DEFAULT 'uploaded_file' AFTER gemini_store_name;

ALTER TABLE company_store_files
  ADD COLUMN IF NOT EXISTS original_name VARCHAR(255) NULL AFTER display_name;

ALTER TABLE company_store_files
  ADD COLUMN IF NOT EXISTS storage_path VARCHAR(500) NULL AFTER file_size_bytes;

ALTER TABLE company_store_files
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP AFTER created_at;

-- ============================================================
-- Global system settings (store names, admin config)
-- ============================================================
CREATE TABLE IF NOT EXISTS system_settings (
  setting_key   VARCHAR(100) NOT NULL PRIMARY KEY,
  setting_value LONGTEXT     NOT NULL DEFAULT '',
  updated_at    TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);

INSERT IGNORE INTO system_settings (setting_key, setting_value) VALUES
  ('gemini_global_lp_store',  ''),
  ('gemini_global_ads_store', '');

-- Async ad generation jobs (A+B: async job + batch processing)
CREATE TABLE IF NOT EXISTS ad_generation_jobs (
  id                  INT AUTO_INCREMENT PRIMARY KEY,
  user_id             INT NOT NULL,
  company_project_id  INT NOT NULL,
  campaign_id         INT NULL,
  project_id          INT NULL,
  status              ENUM('queued','running','completed','failed','cancelled') NOT NULL DEFAULT 'queued',
  creative_plan       LONGTEXT NULL,
  total_batches       TINYINT UNSIGNED NOT NULL DEFAULT 0,
  completed_batches   TINYINT UNSIGNED NOT NULL DEFAULT 0,
  failed_batches      TINYINT UNSIGNED NOT NULL DEFAULT 0,
  error               TEXT NULL,
  created_at          TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at          TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_adj_campaign (campaign_id),
  INDEX idx_adj_user_status (user_id, status)
);

CREATE TABLE IF NOT EXISTS ad_generation_job_batches (
  id           INT AUTO_INCREMENT PRIMARY KEY,
  job_id       INT NOT NULL,
  batch_index  TINYINT UNSIGNED NOT NULL,
  status       ENUM('queued','running','completed','failed') NOT NULL DEFAULT 'queued',
  label        VARCHAR(255) NULL,
  formats_json TEXT NULL,
  error        TEXT NULL,
  attempts     TINYINT UNSIGNED NOT NULL DEFAULT 0,
  saved_count  TINYINT UNSIGNED NOT NULL DEFAULT 0,
  created_at   TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at   TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY (job_id) REFERENCES ad_generation_jobs(id) ON DELETE CASCADE,
  UNIQUE KEY uq_job_batch (job_id, batch_index)
);

-- ============================================================
-- External API columns (added 2026-05)
-- ============================================================
ALTER TABLE projects     ADD COLUMN IF NOT EXISTS phone               VARCHAR(30)  NULL DEFAULT NULL;
ALTER TABLE ads_campaign ADD COLUMN IF NOT EXISTS api_source          VARCHAR(100) NULL DEFAULT NULL;
ALTER TABLE ads_campaign ADD COLUMN IF NOT EXISTS external_request_id VARCHAR(128) NULL DEFAULT NULL;
CREATE INDEX IF NOT EXISTS idx_projects_phone ON projects(phone);

-- Permanent raw-file archive for the global LP/Ads stores.
-- Gemini File Search keeps indexed documents indefinitely; this table keeps
-- our own permanent copy of the original uploads as well.
CREATE TABLE IF NOT EXISTS global_store_files (
  id              INT AUTO_INCREMENT PRIMARY KEY,
  store_type      ENUM('lp', 'ads') NOT NULL,
  store_name      VARCHAR(255) NOT NULL,
  document_name   VARCHAR(500) NULL,
  display_name    VARCHAR(255) NOT NULL,
  original_name   VARCHAR(255) NULL,
  mime_type       VARCHAR(100) NOT NULL DEFAULT 'text/plain',
  file_size_bytes INT NULL,
  storage_path    VARCHAR(500) NOT NULL,
  uploaded_by     INT NULL,
  created_at      TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_global_store_type (store_type),
  INDEX idx_global_store_name (store_name)
);
