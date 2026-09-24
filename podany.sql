-- phpMyAdmin SQL Dump
-- version 5.2.3
-- https://www.phpmyadmin.net/
--
-- Host: podany_db:3306
-- Erstellungszeit: 24. Sep 2026 um 18:49
-- Server-Version: 11.8.9-MariaDB-ubu2404
-- PHP-Version: 8.3.26

SET SQL_MODE = "NO_AUTO_VALUE_ON_ZERO";
START TRANSACTION;
SET time_zone = "+00:00";


/*!40101 SET @OLD_CHARACTER_SET_CLIENT=@@CHARACTER_SET_CLIENT */;
/*!40101 SET @OLD_CHARACTER_SET_RESULTS=@@CHARACTER_SET_RESULTS */;
/*!40101 SET @OLD_COLLATION_CONNECTION=@@COLLATION_CONNECTION */;
/*!40101 SET NAMES utf8mb4 */;

--
-- Datenbank: `podany`
--
CREATE DATABASE IF NOT EXISTS `podany` DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_uca1400_ai_ci;
USE `podany`;

-- --------------------------------------------------------

--
-- Tabellenstruktur für Tabelle `auth_tokens`
--

DROP TABLE IF EXISTS `auth_tokens`;
CREATE TABLE IF NOT EXISTS `auth_tokens` (
  `token_hash` varchar(64) NOT NULL,
  `user_id` varchar(64) NOT NULL,
  `expires_at` bigint(20) UNSIGNED NOT NULL,
  `used` tinyint(4) NOT NULL DEFAULT 0,
  `created_at` bigint(20) UNSIGNED NOT NULL DEFAULT unix_timestamp(),
  PRIMARY KEY (`token_hash`),
  KEY `idx_auth_tokens_user` (`user_id`),
  KEY `idx_auth_tokens_expires` (`expires_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_uca1400_ai_ci;

-- --------------------------------------------------------

--
-- Tabellenstruktur für Tabelle `downloads`
--

DROP TABLE IF EXISTS `downloads`;
CREATE TABLE IF NOT EXISTS `downloads` (
  `id` varchar(64) NOT NULL,
  `user_id` varchar(64) NOT NULL,
  `episode_guid` text NOT NULL,
  `title` varchar(512) DEFAULT NULL,
  `audio_url` text DEFAULT NULL,
  `file_path` text DEFAULT NULL,
  `file_size` bigint(20) UNSIGNED NOT NULL DEFAULT 0,
  `status` varchar(20) NOT NULL DEFAULT 'pending',
  `progress` int(11) NOT NULL DEFAULT 0,
  `error` text DEFAULT NULL,
  `created_at` bigint(20) UNSIGNED NOT NULL DEFAULT unix_timestamp(),
  `updated_at` bigint(20) UNSIGNED NOT NULL DEFAULT unix_timestamp(),
  `received_at` bigint(20) UNSIGNED DEFAULT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uniq_downloads_user_episode` (`user_id`,`episode_guid`) USING HASH,
  KEY `idx_downloads_user` (`user_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_uca1400_ai_ci;

-- --------------------------------------------------------

--
-- Tabellenstruktur für Tabelle `playback_state`
--

DROP TABLE IF EXISTS `playback_state`;
CREATE TABLE IF NOT EXISTS `playback_state` (
  `id` varchar(64) NOT NULL,
  `user_id` varchar(64) NOT NULL,
  `episode_guid` text NOT NULL,
  `position_seconds` double NOT NULL DEFAULT 0,
  `completed` tinyint(4) NOT NULL DEFAULT 0,
  `last_listened_at` bigint(20) UNSIGNED NOT NULL DEFAULT unix_timestamp(),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uniq_playback_state_user_episode` (`user_id`,`episode_guid`) USING HASH,
  KEY `idx_playback_state_user` (`user_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_uca1400_ai_ci;

-- --------------------------------------------------------

--
-- Tabellenstruktur für Tabelle `subscriptions`
--

DROP TABLE IF EXISTS `subscriptions`;
CREATE TABLE IF NOT EXISTS `subscriptions` (
  `id` varchar(64) NOT NULL,
  `user_id` varchar(64) NOT NULL,
  `feed_url` text NOT NULL,
  `title` text DEFAULT NULL,
  `artwork` text DEFAULT NULL,
  `created_at` bigint(20) UNSIGNED NOT NULL DEFAULT unix_timestamp(),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uniq_subscriptions_user_feed` (`user_id`,`feed_url`) USING HASH,
  KEY `idx_subscriptions_user` (`user_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_uca1400_ai_ci;

-- --------------------------------------------------------

--
-- Tabellenstruktur für Tabelle `users`
--

DROP TABLE IF EXISTS `users`;
CREATE TABLE IF NOT EXISTS `users` (
  `id` varchar(64) NOT NULL,
  `email` varchar(255) NOT NULL,
  `color` varchar(32) NOT NULL DEFAULT '#d8cdbe',
  `password_hash` varchar(255) DEFAULT NULL,
  `created_at` bigint(20) UNSIGNED NOT NULL DEFAULT unix_timestamp(),
  PRIMARY KEY (`id`),
  UNIQUE KEY `email` (`email`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_uca1400_ai_ci;

--
-- Constraints der exportierten Tabellen
--

--
-- Constraints der Tabelle `auth_tokens`
--
ALTER TABLE `auth_tokens`
  ADD CONSTRAINT `auth_tokens_ibfk_1` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE;

--
-- Constraints der Tabelle `downloads`
--
ALTER TABLE `downloads`
  ADD CONSTRAINT `downloads_ibfk_1` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE;

--
-- Constraints der Tabelle `playback_state`
--
ALTER TABLE `playback_state`
  ADD CONSTRAINT `playback_state_ibfk_1` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE;

--
-- Constraints der Tabelle `subscriptions`
--
ALTER TABLE `subscriptions`
  ADD CONSTRAINT `subscriptions_ibfk_1` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE;
COMMIT;

/*!40101 SET CHARACTER_SET_CLIENT=@OLD_CHARACTER_SET_CLIENT */;
/*!40101 SET CHARACTER_SET_RESULTS=@OLD_CHARACTER_SET_RESULTS */;
/*!40101 SET COLLATION_CONNECTION=@OLD_COLLATION_CONNECTION */;
