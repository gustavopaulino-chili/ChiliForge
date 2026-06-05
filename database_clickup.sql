-- ============================================================================
-- ClickUp integration (v1) — schema
-- Idempotent: safe to run more than once. The PHP layer also ensures this
-- schema at runtime (clickup_ensure_schema in api/clickup_common.php), so this
-- file is the canonical record / manual-apply path.
-- ============================================================================

-- 1) OAuth connection per Forge user (one active connection per user).
CREATE TABLE IF NOT EXISTS clickup_connections (
    id                BIGINT AUTO_INCREMENT PRIMARY KEY,
    user_id           INT NOT NULL,
    access_token      TEXT NOT NULL,            -- AES-256-CBC encrypted at rest
    refresh_token     TEXT NULL,                -- encrypted at rest (if provided)
    token_expires_at  DATETIME NULL,
    clickup_user_id   VARCHAR(64) NULL,
    workspace_id      VARCHAR(64) NULL,         -- ClickUp team_id (Workspace)
    space_id          VARCHAR(64) NULL,         -- resolved/fixed Space
    folder_id         VARCHAR(64) NULL,         -- last chosen Folder
    created_at        TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at        TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    UNIQUE KEY uq_clickup_user (user_id),
    CONSTRAINT fk_clickup_conn_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- 2) Origin / idempotency columns on the company table (companies = projects).
--    Defaults so existing rows keep working (source defaults to 'manual').
--    MySQL has no "ADD COLUMN IF NOT EXISTS"; run these once (the PHP ensure
--    layer guards re-runs). If a column already exists, ignore that statement.
ALTER TABLE projects ADD COLUMN source           VARCHAR(32) NOT NULL DEFAULT 'manual';
ALTER TABLE projects ADD COLUMN clickup_list_ids TEXT NULL;
ALTER TABLE projects ADD COLUMN channels         TEXT NULL;

-- Rollback (manual):
-- DROP TABLE IF EXISTS clickup_connections;
-- ALTER TABLE projects DROP COLUMN source, DROP COLUMN clickup_list_ids, DROP COLUMN channels;
