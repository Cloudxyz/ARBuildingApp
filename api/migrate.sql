-- ============================================================
-- migrate.sql  — run this on your MySQL server to ensure
-- all required tables and columns exist.
-- Safe to run multiple times (IF NOT EXISTS / IF EXISTS).
-- ============================================================

USE `realestatear`;

-- 1. Ensure floors column exists and has correct type + default NULL
--    (IF NOT EXISTS skips if column already exists, so we MODIFY after).
ALTER TABLE `units`
  ADD COLUMN IF NOT EXISTS `floors` TEXT DEFAULT NULL;
-- Reset the default to NULL and ensure type is TEXT (works across all MySQL / MariaDB versions)
ALTER TABLE `units`
  MODIFY COLUMN `floors` TEXT DEFAULT NULL;

-- 2. Add any other unit columns that may be missing
ALTER TABLE `units`
  ADD COLUMN IF NOT EXISTS `city`          VARCHAR(100)    DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS `state`         VARCHAR(100)    DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS `price`         DECIMAL(15,2)   DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS `area_sqm`      DECIMAL(10,2)   DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS `status`        VARCHAR(20)     DEFAULT 'available',
  ADD COLUMN IF NOT EXISTS `thumbnail_url` VARCHAR(1000)   DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS `model_glb_url` VARCHAR(1000)   DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS `latitude`      DECIMAL(10,8)   DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS `longitude`     DECIMAL(11,8)   DEFAULT NULL;

-- 3. unit_models (one footprint mesh per unit)
CREATE TABLE IF NOT EXISTS `unit_models` (
  `id`             CHAR(36)      NOT NULL DEFAULT (UUID()),
  `unit_id`        CHAR(36)      NOT NULL,
  `user_id`        CHAR(36)      DEFAULT NULL,
  `glb_url`        VARCHAR(1000) DEFAULT NULL,
  `storage_path`   VARCHAR(1000) DEFAULT NULL,
  `floor_count`    INT           NOT NULL DEFAULT 20,
  `scale`          DECIMAL(6,3)  NOT NULL DEFAULT 1.000,
  `rotation_deg`   DECIMAL(6,2)  NOT NULL DEFAULT 0.00,
  `building_type`  VARCHAR(50)   NOT NULL DEFAULT 'residential',
  `color_scheme`   VARCHAR(20)   NOT NULL DEFAULT 'blueprint',
  `footprint_w`    DECIMAL(10,2) NOT NULL DEFAULT 160.00,
  `footprint_h`    DECIMAL(10,2) NOT NULL DEFAULT 100.00,
  `model_data`     JSON          DEFAULT NULL,
  `created_at`     DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at`     DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `unit_models_unit_uq` (`unit_id`),
  CONSTRAINT `fk_unit_models_unit`
    FOREIGN KEY (`unit_id`) REFERENCES `units` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Add AR config columns to existing unit_models rows
ALTER TABLE `unit_models`
  ADD COLUMN IF NOT EXISTS `floor_count`   INT           NOT NULL DEFAULT 20,
  ADD COLUMN IF NOT EXISTS `scale`         DECIMAL(6,3)  NOT NULL DEFAULT 1.000,
  ADD COLUMN IF NOT EXISTS `rotation_deg`  DECIMAL(6,2)  NOT NULL DEFAULT 0.00,
  ADD COLUMN IF NOT EXISTS `building_type` VARCHAR(50)   NOT NULL DEFAULT 'residential',
  ADD COLUMN IF NOT EXISTS `color_scheme`  VARCHAR(20)   NOT NULL DEFAULT 'blueprint',
  ADD COLUMN IF NOT EXISTS `footprint_w`   DECIMAL(10,2) NOT NULL DEFAULT 160.00,
  ADD COLUMN IF NOT EXISTS `footprint_h`   DECIMAL(10,2) NOT NULL DEFAULT 100.00,
  ADD COLUMN IF NOT EXISTS `model_data`    JSON          DEFAULT NULL;

-- 4. unit_type_models (shared GLB library per type)
CREATE TABLE IF NOT EXISTS `unit_type_models` (
  `id`                     CHAR(36)      NOT NULL DEFAULT (UUID()),
  `user_id`                CHAR(36)      DEFAULT NULL,
  `unit_type`              VARCHAR(50)   NOT NULL,
  `model_glb_url`          VARCHAR(1000) DEFAULT NULL,
  `external_model_glb_url` VARCHAR(1000) DEFAULT NULL,
  `storage_path`           VARCHAR(1000) DEFAULT NULL,
  `created_at`             DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at`             DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `unit_type_models_type_uq` (`unit_type`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- 5. unit_glb_models (per-unit per-type GLB models)
CREATE TABLE IF NOT EXISTS `unit_glb_models` (
  `id`               CHAR(36)      NOT NULL DEFAULT (UUID()),
  `unit_id`          CHAR(36)      NOT NULL,
  `user_id`          CHAR(36)      DEFAULT NULL,
  `unit_type`        VARCHAR(50)   NOT NULL DEFAULT 'land',
  `glb_url`          VARCHAR(1000) DEFAULT NULL,
  `storage_path`     VARCHAR(1000) DEFAULT NULL,
  `external_glb_url` VARCHAR(1000) DEFAULT NULL,
  `created_at`       DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at`       DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `unit_glb_models_unit_type_uq` (`unit_id`, `unit_type`),
  CONSTRAINT `fk_unit_glb_models_unit`
    FOREIGN KEY (`unit_id`) REFERENCES `units` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- 6. Add type/city/state to developments if missing
ALTER TABLE `developments`
  ADD COLUMN IF NOT EXISTS `type`  VARCHAR(50)  DEFAULT 'fraccionamiento',
  ADD COLUMN IF NOT EXISTS `city`  VARCHAR(100) DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS `state` VARCHAR(100) DEFAULT NULL;
