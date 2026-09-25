CREATE TABLE IF NOT EXISTS users (
  id VARCHAR(64) PRIMARY KEY,
  email VARCHAR(255) UNIQUE NOT NULL,
  color VARCHAR(32) NOT NULL DEFAULT '#d8cdbe',
  password_hash VARCHAR(255),
  created_at BIGINT UNSIGNED NOT NULL DEFAULT (UNIX_TIMESTAMP())
);

CREATE TABLE IF NOT EXISTS auth_tokens (
  token_hash VARCHAR(64) PRIMARY KEY,
  user_id VARCHAR(64) NOT NULL,
  expires_at BIGINT UNSIGNED NOT NULL,
  used TINYINT NOT NULL DEFAULT 0,
  created_at BIGINT UNSIGNED NOT NULL DEFAULT (UNIX_TIMESTAMP()),
  INDEX idx_auth_tokens_user (user_id),
  INDEX idx_auth_tokens_expires (expires_at),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS subscriptions (
  id VARCHAR(64) PRIMARY KEY,
  user_id VARCHAR(64) NOT NULL,
  feed_url TEXT NOT NULL,
  title TEXT,
  image TEXT,
  created_at BIGINT UNSIGNED NOT NULL DEFAULT (UNIX_TIMESTAMP()),
  UNIQUE KEY uniq_subscriptions_user_feed (user_id, feed_url),
  INDEX idx_subscriptions_user (user_id),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS playback_state (
  id VARCHAR(64) PRIMARY KEY,
  user_id VARCHAR(64) NOT NULL,
  episode_guid TEXT NOT NULL,
  position_seconds REAL NOT NULL DEFAULT 0,
  completed TINYINT NOT NULL DEFAULT 0,
  last_listened_at BIGINT UNSIGNED NOT NULL DEFAULT (UNIX_TIMESTAMP()),
  UNIQUE KEY uniq_playback_state_user_episode (user_id, episode_guid),
  INDEX idx_playback_state_user (user_id),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS downloads (
  id VARCHAR(64) PRIMARY KEY,
  user_id VARCHAR(64) NOT NULL,
  episode_guid TEXT NOT NULL,
  subscription_id VARCHAR(64),
  title VARCHAR(512),
  image TEXT,
  audio_url TEXT,
  file_path TEXT,
  file_size BIGINT UNSIGNED NOT NULL DEFAULT 0,
  status VARCHAR(20) NOT NULL DEFAULT 'pending',
  progress INT NOT NULL DEFAULT 0,
  error TEXT,
  created_at BIGINT UNSIGNED NOT NULL DEFAULT (UNIX_TIMESTAMP()),
  updated_at BIGINT UNSIGNED NOT NULL DEFAULT (UNIX_TIMESTAMP()),
  received_at BIGINT UNSIGNED,
  UNIQUE KEY uniq_downloads_user_episode (user_id, episode_guid),
  INDEX idx_downloads_user (user_id),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);
