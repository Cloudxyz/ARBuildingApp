-- phpMyAdmin SQL Dump
-- version 5.2.1
-- https://www.phpmyadmin.net/
--
-- Servidor: 127.0.0.1:3306
-- Tiempo de generación: 05-03-2026 a las 07:37:42
-- Versión del servidor: 10.11.8-MariaDB-0ubuntu0.24.04.1
-- Versión de PHP: 8.1.31

SET SQL_MODE = "NO_AUTO_VALUE_ON_ZERO";
START TRANSACTION;
SET time_zone = "+00:00";


/*!40101 SET @OLD_CHARACTER_SET_CLIENT=@@CHARACTER_SET_CLIENT */;
/*!40101 SET @OLD_CHARACTER_SET_RESULTS=@@CHARACTER_SET_RESULTS */;
/*!40101 SET @OLD_COLLATION_CONNECTION=@@COLLATION_CONNECTION */;
/*!40101 SET NAMES utf8mb4 */;

--
-- Base de datos: `realestatear`
--

-- --------------------------------------------------------

--
-- Estructura de tabla para la tabla `developments`
--

CREATE TABLE `developments` (
  `id` char(36) NOT NULL DEFAULT uuid(),
  `name` varchar(255) NOT NULL,
  `description` text DEFAULT NULL,
  `address` varchar(500) DEFAULT NULL,
  `country` varchar(100) DEFAULT NULL,
  `user_id` char(36) DEFAULT NULL,
  `created_at` datetime NOT NULL DEFAULT current_timestamp(),
  `updated_at` datetime NOT NULL DEFAULT current_timestamp() ON UPDATE current_timestamp(),
  `type` varchar(50) NOT NULL DEFAULT 'fraccionamiento',
  `city` varchar(255) DEFAULT NULL,
  `state` varchar(255) DEFAULT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

--
-- Volcado de datos para la tabla `developments`
--

INSERT INTO `developments` (`id`, `name`, `description`, `address`, `country`, `user_id`, `created_at`, `updated_at`, `type`, `city`, `state`) VALUES
('41365f21-1812-11f1-ad6f-d83addaeda65', 'Marina Towers', NULL, 'Marina Vallarta', 'México', 'a70e48a1-180b-11f1-ad6f-d83addaeda65', '2026-03-04 15:36:50', '2026-03-04 15:36:50', 'fraccionamiento', NULL, NULL);

-- --------------------------------------------------------

--
-- Estructura de tabla para la tabla `units`
--

CREATE TABLE `units` (
  `id` char(36) NOT NULL DEFAULT uuid(),
  `development_id` char(36) DEFAULT NULL,
  `name` varchar(255) NOT NULL,
  `description` text DEFAULT NULL,
  `area_sqm` decimal(10,2) DEFAULT NULL,
  `address` varchar(500) DEFAULT NULL,
  `city` varchar(100) DEFAULT NULL,
  `state` varchar(100) DEFAULT NULL,
  `country` varchar(100) DEFAULT NULL,
  `price` decimal(15,2) DEFAULT NULL,
  `status` enum('available','reserved','sold') NOT NULL DEFAULT 'available',
  `thumbnail_url` varchar(1000) DEFAULT NULL,
  `unit_type` varchar(50) NOT NULL DEFAULT 'land',
  `glb_url` varchar(1000) DEFAULT NULL,
  `latitude` decimal(10,8) DEFAULT NULL,
  `longitude` decimal(11,8) DEFAULT NULL,
  `floors` text DEFAULT NULL,
  `user_id` char(36) DEFAULT NULL,
  `created_at` datetime NOT NULL DEFAULT current_timestamp(),
  `updated_at` datetime NOT NULL DEFAULT current_timestamp() ON UPDATE current_timestamp(),
  `model_glb_url` varchar(1000) DEFAULT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

--
-- Volcado de datos para la tabla `units`
--

INSERT INTO `units` (`id`, `development_id`, `name`, `description`, `area_sqm`, `address`, `city`, `state`, `country`, `price`, `status`, `thumbnail_url`, `unit_type`, `glb_url`, `latitude`, `longitude`, `floors`, `user_id`, `created_at`, `updated_at`, `model_glb_url`) VALUES
('98e23031-1812-11f1-ad6f-d83addaeda65', '41365f21-1812-11f1-ad6f-d83addaeda65', 'Zitadela', '', 51.00, 'Ajijic 92-9', 'Bahía de Banderas', 'Jalisco', 'México', 30000000.00, 'available', NULL, 'land', NULL, NULL, NULL, '[\"https://my.matterport.com/show/?m=RsKKA9cRJnj&play=1&ts=0\",\"\",\"https://my.matterport.com/show/?m=RsKKA9cRJnj&play=1&ts=0\",\"\"]', 'a70e48a1-180b-11f1-ad6f-d83addaeda65', '2026-03-04 15:39:17', '2026-03-04 16:18:18', NULL);

-- --------------------------------------------------------

--
-- Estructura de tabla para la tabla `unit_glb_models`
--

CREATE TABLE `unit_glb_models` (
  `id` char(36) NOT NULL DEFAULT uuid(),
  `unit_id` char(36) NOT NULL,
  `glb_url` varchar(1000) DEFAULT NULL,
  `storage_path` varchar(1000) DEFAULT NULL,
  `external_glb_url` varchar(1000) DEFAULT NULL,
  `label` varchar(255) DEFAULT NULL,
  `user_id` char(36) DEFAULT NULL,
  `unit_type` varchar(50) NOT NULL DEFAULT 'land',
  `created_at` datetime NOT NULL DEFAULT current_timestamp(),
  `updated_at` datetime NOT NULL DEFAULT current_timestamp() ON UPDATE current_timestamp()
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

-- --------------------------------------------------------

--
-- Estructura de tabla para la tabla `unit_models`
--

CREATE TABLE `unit_models` (
  `id` char(36) NOT NULL DEFAULT uuid(),
  `unit_id` char(36) NOT NULL,
  `user_id` char(36) DEFAULT NULL,
  `glb_url` varchar(1000) DEFAULT NULL,
  `storage_path` varchar(1000) DEFAULT NULL,
  `created_at` datetime NOT NULL DEFAULT current_timestamp(),
  `updated_at` datetime NOT NULL DEFAULT current_timestamp() ON UPDATE current_timestamp()
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

-- --------------------------------------------------------

--
-- Estructura de tabla para la tabla `unit_type_models`
--

CREATE TABLE `unit_type_models` (
  `id` char(36) NOT NULL DEFAULT uuid(),
  `unit_type` varchar(50) NOT NULL,
  `name` varchar(255) DEFAULT NULL,
  `model_glb_url` varchar(1000) DEFAULT NULL,
  `external_model_glb_url` varchar(1000) DEFAULT NULL,
  `storage_path` varchar(1000) DEFAULT NULL,
  `user_id` char(36) DEFAULT NULL,
  `created_at` datetime NOT NULL DEFAULT current_timestamp(),
  `updated_at` datetime NOT NULL DEFAULT current_timestamp() ON UPDATE current_timestamp()
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

-- --------------------------------------------------------

--
-- Estructura de tabla para la tabla `users`
--

CREATE TABLE `users` (
  `id` char(36) NOT NULL DEFAULT uuid(),
  `email` varchar(255) NOT NULL,
  `password_hash` varchar(255) NOT NULL,
  `full_name` varchar(255) DEFAULT NULL,
  `phone` varchar(50) DEFAULT NULL,
  `country` varchar(100) DEFAULT NULL,
  `created_at` datetime NOT NULL DEFAULT current_timestamp(),
  `updated_at` datetime NOT NULL DEFAULT current_timestamp() ON UPDATE current_timestamp()
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

--
-- Volcado de datos para la tabla `users`
--

INSERT INTO `users` (`id`, `email`, `password_hash`, `full_name`, `phone`, `country`, `created_at`, `updated_at`) VALUES
('a70e48a1-180b-11f1-ad6f-d83addaeda65', 'cloudzeroxyz@gmail.com', '$2b$10$JkAZCP5c1zqnGgbu1s5TXu2t142L7NuNXzeyQ1qOk9pB0KilxfeOm', 'Devalan', NULL, NULL, '2026-03-04 14:49:35', '2026-03-04 14:49:35');

-- --------------------------------------------------------

--
-- Estructura de tabla para la tabla `user_roles`
--

CREATE TABLE `user_roles` (
  `id` int(10) UNSIGNED NOT NULL,
  `user_id` char(36) NOT NULL,
  `role` enum('user','master_admin') NOT NULL DEFAULT 'user',
  `created_at` datetime NOT NULL DEFAULT current_timestamp()
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

--
-- Volcado de datos para la tabla `user_roles`
--

INSERT INTO `user_roles` (`id`, `user_id`, `role`, `created_at`) VALUES
(12, 'a70e48a1-180b-11f1-ad6f-d83addaeda65', 'master_admin', '2026-03-04 14:49:35');

--
-- Índices para tablas volcadas
--

--
-- Indices de la tabla `developments`
--
ALTER TABLE `developments`
  ADD PRIMARY KEY (`id`),
  ADD KEY `developments_created_by_idx` (`user_id`);

--
-- Indices de la tabla `units`
--
ALTER TABLE `units`
  ADD PRIMARY KEY (`id`),
  ADD KEY `units_development_idx` (`development_id`),
  ADD KEY `units_created_by_idx` (`user_id`);

--
-- Indices de la tabla `unit_glb_models`
--
ALTER TABLE `unit_glb_models`
  ADD PRIMARY KEY (`id`),
  ADD UNIQUE KEY `ux_unit_glb_models_unit_type` (`unit_id`,`unit_type`),
  ADD KEY `unit_glb_models_unit_idx` (`unit_id`),
  ADD KEY `fk_unit_glb_models_user2` (`user_id`);

--
-- Indices de la tabla `unit_models`
--
ALTER TABLE `unit_models`
  ADD PRIMARY KEY (`id`),
  ADD UNIQUE KEY `unit_models_unit_uq` (`unit_id`),
  ADD KEY `fk_unit_models_user` (`user_id`);

--
-- Indices de la tabla `unit_type_models`
--
ALTER TABLE `unit_type_models`
  ADD PRIMARY KEY (`id`),
  ADD UNIQUE KEY `ux_unit_type_models_unit_type` (`unit_type`),
  ADD KEY `unit_type_models_type_idx` (`unit_type`),
  ADD KEY `fk_unit_type_models_user2` (`user_id`);

--
-- Indices de la tabla `users`
--
ALTER TABLE `users`
  ADD PRIMARY KEY (`id`),
  ADD UNIQUE KEY `users_email_uq` (`email`);

--
-- Indices de la tabla `user_roles`
--
ALTER TABLE `user_roles`
  ADD PRIMARY KEY (`id`),
  ADD UNIQUE KEY `user_roles_user_uq` (`user_id`);

--
-- AUTO_INCREMENT de las tablas volcadas
--

--
-- AUTO_INCREMENT de la tabla `user_roles`
--
ALTER TABLE `user_roles`
  MODIFY `id` int(10) UNSIGNED NOT NULL AUTO_INCREMENT, AUTO_INCREMENT=13;

--
-- Restricciones para tablas volcadas
--

--
-- Filtros para la tabla `developments`
--
ALTER TABLE `developments`
  ADD CONSTRAINT `fk_developments_user` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE SET NULL;

--
-- Filtros para la tabla `units`
--
ALTER TABLE `units`
  ADD CONSTRAINT `fk_units_development` FOREIGN KEY (`development_id`) REFERENCES `developments` (`id`) ON DELETE CASCADE,
  ADD CONSTRAINT `fk_units_user` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE SET NULL;

--
-- Filtros para la tabla `unit_glb_models`
--
ALTER TABLE `unit_glb_models`
  ADD CONSTRAINT `fk_unit_glb_models_unit` FOREIGN KEY (`unit_id`) REFERENCES `units` (`id`) ON DELETE CASCADE,
  ADD CONSTRAINT `fk_unit_glb_models_user` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE SET NULL,
  ADD CONSTRAINT `fk_unit_glb_models_user2` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE SET NULL;

--
-- Filtros para la tabla `unit_models`
--
ALTER TABLE `unit_models`
  ADD CONSTRAINT `fk_unit_models_unit` FOREIGN KEY (`unit_id`) REFERENCES `units` (`id`) ON DELETE CASCADE,
  ADD CONSTRAINT `fk_unit_models_user` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE SET NULL;

--
-- Filtros para la tabla `unit_type_models`
--
ALTER TABLE `unit_type_models`
  ADD CONSTRAINT `fk_unit_type_models_user` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE SET NULL,
  ADD CONSTRAINT `fk_unit_type_models_user2` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE SET NULL;

--
-- Filtros para la tabla `user_roles`
--
ALTER TABLE `user_roles`
  ADD CONSTRAINT `fk_user_roles_user` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE;
COMMIT;

/*!40101 SET CHARACTER_SET_CLIENT=@OLD_CHARACTER_SET_CLIENT */;
/*!40101 SET CHARACTER_SET_RESULTS=@OLD_CHARACTER_SET_RESULTS */;
/*!40101 SET COLLATION_CONNECTION=@OLD_COLLATION_CONNECTION */;
