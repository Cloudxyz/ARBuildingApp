-- =============================================================
-- RealEstateAR — MySQL Schema (aligned with app types)
-- DB: realestatear | User: realestatear-user
-- =============================================================

CREATE DATABASE IF NOT EXISTS `realestatear`
  DEFAULT CHARACTER SET utf8mb4
  DEFAULT COLLATE utf8mb4_unicode_ci;

USE `realestatear`;

-- -------------------------------------------------------------
-- 1. users  (replaces Supabase auth.users + profiles)
-- -------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `users` (
  `id`            CHAR(36)      NOT NULL DEFAULT (UUID()),
  `email`         VARCHAR(255)  NOT NULL,
  `password_hash` VARCHAR(255)  NOT NULL,
  `full_name`     VARCHAR(255)  DEFAULT NULL,
  `phone`         VARCHAR(50)   DEFAULT NULL,
  `country`       VARCHAR(100)  DEFAULT NULL,
  `created_at`    DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at`    DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `users_email_uq` (`email`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- -------------------------------------------------------------
-- 2. user_roles
-- -------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `user_roles` (
  `id`         INT UNSIGNED  NOT NULL AUTO_INCREMENT,
  `user_id`    CHAR(36)      NOT NULL,
  `role`       ENUM('user', 'master_admin') NOT NULL DEFAULT 'user',
  `created_at` DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `user_roles_user_uq` (`user_id`),
  CONSTRAINT `fk_user_roles_user`
    FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- -------------------------------------------------------------
-- 3. developments  (matches app Development type)
-- -------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `developments` (
  `id`          CHAR(36)      NOT NULL DEFAULT (UUID()),
  `user_id`     CHAR(36)      DEFAULT NULL,
  `name`        VARCHAR(255)  NOT NULL,
  `type`        ENUM('fraccionamiento','condominio') NOT NULL DEFAULT 'fraccionamiento',
  `description` TEXT          DEFAULT NULL,
  `address`     VARCHAR(500)  DEFAULT NULL,
  `city`        VARCHAR(100)  DEFAULT NULL,
  `state`       VARCHAR(100)  DEFAULT NULL,
  `country`     VARCHAR(100)  DEFAULT NULL,
  `created_at`  DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at`  DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `developments_user_idx` (`user_id`),
  CONSTRAINT `fk_developments_user`
    FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- -------------------------------------------------------------
-- 4. units  (matches app Unit type)
-- -------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `units` (
  `id`               CHAR(36)        NOT NULL DEFAULT (UUID()),
  `user_id`          CHAR(36)        DEFAULT NULL,
  `development_id`   CHAR(36)        DEFAULT NULL,
  `unit_type`        ENUM('land','house','building','commercial') NOT NULL DEFAULT 'land',
  `model_glb_url`    VARCHAR(1000)   DEFAULT NULL,
  `name`             VARCHAR(255)    NOT NULL,
  `description`      TEXT            DEFAULT NULL,
  `area_sqm`         DECIMAL(10,2)   DEFAULT NULL,
  `latitude`         DECIMAL(10, 8)  DEFAULT NULL,
  `longitude`        DECIMAL(11, 8)  DEFAULT NULL,
  `address`          VARCHAR(500)    DEFAULT NULL,
  `city`             VARCHAR(100)    DEFAULT NULL,
  `state`            VARCHAR(100)    DEFAULT NULL,
  `country`          VARCHAR(100)    DEFAULT NULL,
  `price`            DECIMAL(15,2)   DEFAULT NULL,
  `status`           ENUM('available','reserved','sold') NOT NULL DEFAULT 'available',
  `thumbnail_url`    VARCHAR(1000)   DEFAULT NULL,
  `floors`           JSON            DEFAULT NULL,
  `created_at`       DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at`       DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `units_development_idx` (`development_id`),
  KEY `units_user_idx` (`user_id`),
  CONSTRAINT `fk_units_development`
    FOREIGN KEY (`development_id`) REFERENCES `developments` (`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_units_user`
    FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- -------------------------------------------------------------
-- 5. unit_models  (one footprint mesh per unit — matches app UnitModel)
-- -------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `unit_models` (
  `id`           CHAR(36)      NOT NULL DEFAULT (UUID()),
  `unit_id`      CHAR(36)      NOT NULL,
  `user_id`      CHAR(36)      DEFAULT NULL,
  `glb_url`      VARCHAR(1000) DEFAULT NULL,
  `storage_path` VARCHAR(1000) DEFAULT NULL,
  `created_at`   DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at`   DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `unit_models_unit_uq` (`unit_id`),
  CONSTRAINT `fk_unit_models_unit`
    FOREIGN KEY (`unit_id`) REFERENCES `units` (`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_unit_models_user`
    FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- -------------------------------------------------------------
-- 6. unit_type_models  (shared library — matches app UnitTypeModel)
-- -------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `unit_type_models` (
  `id`                     CHAR(36)      NOT NULL DEFAULT (UUID()),
  `user_id`                CHAR(36)      DEFAULT NULL,
  `unit_type`              ENUM('house','building','commercial') NOT NULL,
  `model_glb_url`          VARCHAR(1000) DEFAULT NULL,
  `external_model_glb_url` VARCHAR(1000) DEFAULT NULL,
  `storage_path`           VARCHAR(1000) DEFAULT NULL,
  `created_at`             DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at`             DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `unit_type_models_type_idx` (`unit_type`),
  CONSTRAINT `fk_unit_type_models_user`
    FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- -------------------------------------------------------------
-- 7. unit_glb_models  (per-unit per-type GLB — matches app UnitGlbModel)
-- -------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `unit_glb_models` (
  `id`               CHAR(36)      NOT NULL DEFAULT (UUID()),
  `unit_id`          CHAR(36)      NOT NULL,
  `user_id`          CHAR(36)      DEFAULT NULL,
  `unit_type`        ENUM('land','house','building','commercial') NOT NULL DEFAULT 'land',
  `glb_url`          VARCHAR(1000) DEFAULT NULL,
  `storage_path`     VARCHAR(1000) DEFAULT NULL,
  `external_glb_url` VARCHAR(1000) DEFAULT NULL,
  `created_at`       DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at`       DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `unit_glb_models_unit_idx` (`unit_id`),
  KEY `unit_glb_models_user_idx` (`user_id`),
  CONSTRAINT `fk_unit_glb_models_unit`
    FOREIGN KEY (`unit_id`) REFERENCES `units` (`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_unit_glb_models_user`
    FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
