import Database from 'better-sqlite3';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { config, logger } from '../config.js';

let db;

/**
 * Initialise la connexion SQLite, active WAL et cree les tables si besoin.
 * @returns {Database.Database}
 */
export function initDb() {
  if (db) return db;
  const dbDir = dirname(config.dbPath);
  if (dbDir && dbDir !== '.') mkdirSync(dbDir, { recursive: true });
  db = new Database(config.dbPath);
  db.pragma('journal_mode = WAL');
  db.pragma('synchronous = NORMAL');
  db.pragma('foreign_keys = ON');

  db.exec(`
    CREATE TABLE IF NOT EXISTS guild_config (
      guild_id TEXT PRIMARY KEY,
      ticket_category_id TEXT,
      log_channel_id TEXT,
      transcript_channel_id TEXT,
      support_role_ids TEXT DEFAULT '[]',
      max_open_per_user INTEGER DEFAULT 1,
      autoclose_hours INTEGER DEFAULT 0,
      ticket_counter INTEGER DEFAULT 0,
      welcome_enabled INTEGER DEFAULT 0,
      welcome_channel_id TEXT,
      welcome_title TEXT,
      welcome_description TEXT,
      welcome_color INTEGER DEFAULT 5793266,
      welcome_image TEXT,
      welcome_thumbnail TEXT,
      welcome_role_id TEXT,
      availability_channel_id TEXT,
      availability_role_id TEXT,
      availability_order_channel_id TEXT,
      availability_order_link TEXT,
      created_at INTEGER DEFAULT (strftime('%s','now'))
    );

    CREATE TABLE IF NOT EXISTS panels (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      guild_id TEXT NOT NULL,
      title TEXT NOT NULL,
      description TEXT,
      color INTEGER DEFAULT 5793266,
      image TEXT,
      thumbnail TEXT,
      message_id TEXT,
      channel_id TEXT,
      display_mode TEXT DEFAULT 'buttons',
      created_at INTEGER DEFAULT (strftime('%s','now'))
    );

    CREATE TABLE IF NOT EXISTS panel_buttons (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      panel_id INTEGER NOT NULL,
      label TEXT NOT NULL,
      emoji TEXT,
      style INTEGER DEFAULT 1,
      category_id TEXT,
      support_role_ids TEXT DEFAULT '[]',
      ping_role_id TEXT,
      mention_owner INTEGER DEFAULT 1,
      name_template TEXT DEFAULT 'ticket-{username}-{number}',
      open_message TEXT,
      questions TEXT DEFAULT '[]',
      add_role_on_open TEXT,
      remove_role_on_close TEXT,
      create_staff_thread INTEGER DEFAULT 0,
      position INTEGER DEFAULT 0,
      description TEXT,
      placeholder_text TEXT,
      FOREIGN KEY (panel_id) REFERENCES panels(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS tickets (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      guild_id TEXT NOT NULL,
      channel_id TEXT NOT NULL UNIQUE,
      panel_id INTEGER,
      button_id INTEGER,
      number INTEGER NOT NULL,
      owner_id TEXT NOT NULL,
      claimed_by TEXT,
      status TEXT DEFAULT 'open',
      staff_thread_id TEXT,
      opened_at INTEGER DEFAULT (strftime('%s','now')),
      closed_at INTEGER,
      first_response_at INTEGER,
      last_activity_at INTEGER DEFAULT (strftime('%s','now')),
      close_reason TEXT
    );

    CREATE INDEX IF NOT EXISTS idx_tickets_guild_status ON tickets(guild_id, status);
    CREATE INDEX IF NOT EXISTS idx_tickets_owner ON tickets(owner_id, status);
    CREATE INDEX IF NOT EXISTS idx_tickets_lastactivity ON tickets(status, last_activity_at);

    CREATE TABLE IF NOT EXISTS blacklist (
      guild_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      reason TEXT,
      added_by TEXT,
      added_at INTEGER DEFAULT (strftime('%s','now')),
      PRIMARY KEY (guild_id, user_id)
    );

    CREATE TABLE IF NOT EXISTS feedback (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      ticket_id INTEGER NOT NULL,
      guild_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      rating INTEGER,
      comment TEXT,
      created_at INTEGER DEFAULT (strftime('%s','now')),
      FOREIGN KEY (ticket_id) REFERENCES tickets(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS staff_actions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      guild_id TEXT NOT NULL,
      ticket_id INTEGER,
      user_id TEXT NOT NULL,
      action TEXT NOT NULL,
      meta TEXT,
      created_at INTEGER DEFAULT (strftime('%s','now'))
    );

    CREATE INDEX IF NOT EXISTS idx_staff_actions_guild ON staff_actions(guild_id, created_at);

    CREATE TABLE IF NOT EXISTS availability_posts (
      guild_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      channel_id TEXT NOT NULL,
      message_id TEXT NOT NULL,
      message TEXT,
      created_at INTEGER DEFAULT (strftime('%s','now')),
      updated_at INTEGER DEFAULT (strftime('%s','now')),
      PRIMARY KEY (guild_id, user_id)
    );
    CREATE INDEX IF NOT EXISTS idx_availability_posts_guild ON availability_posts(guild_id);

    CREATE TABLE IF NOT EXISTS macros (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      guild_id TEXT NOT NULL,
      name TEXT NOT NULL,
      content TEXT NOT NULL,
      created_by TEXT NOT NULL,
      created_at INTEGER DEFAULT (strftime('%s','now')),
      uses_count INTEGER DEFAULT 0,
      UNIQUE(guild_id, name)
    );
    CREATE INDEX IF NOT EXISTS idx_macros_guild ON macros(guild_id);

    CREATE TABLE IF NOT EXISTS user_order_counts (
      guild_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      role TEXT NOT NULL,
      count INTEGER DEFAULT 0,
      updated_at INTEGER DEFAULT (strftime('%s','now')),
      PRIMARY KEY (guild_id, user_id, role)
    );
    CREATE INDEX IF NOT EXISTS idx_order_counts_role ON user_order_counts(guild_id, role, count DESC);

    CREATE TABLE IF NOT EXISTS loyalty_tiers (
      guild_id TEXT NOT NULL,
      scope TEXT NOT NULL,
      tier_name TEXT NOT NULL,
      threshold INTEGER NOT NULL,
      role_id TEXT NOT NULL,
      position INTEGER NOT NULL,
      PRIMARY KEY (guild_id, scope, tier_name)
    );
    CREATE INDEX IF NOT EXISTS idx_loyalty_tiers_lookup ON loyalty_tiers(guild_id, scope, threshold DESC);

    CREATE TABLE IF NOT EXISTS order_trackings (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      ticket_id INTEGER NOT NULL UNIQUE,
      guild_id TEXT NOT NULL,
      channel_id TEXT NOT NULL,
      owner_id TEXT NOT NULL,
      provider TEXT NOT NULL DEFAULT 'ubereats',
      tracking_url TEXT NOT NULL,
      active INTEGER DEFAULT 1,
      last_eta_minutes INTEGER,
      last_eta_label TEXT,
      last_status_text TEXT,
      last_checked_at INTEGER,
      next_check_at INTEGER DEFAULT (strftime('%s','now')),
      last_reminder_at INTEGER,
      near_notified_at INTEGER,
      pin_notified_at INTEGER,
      completed_notified_at INTEGER,
      fail_count INTEGER DEFAULT 0,
      created_at INTEGER DEFAULT (strftime('%s','now')),
      updated_at INTEGER DEFAULT (strftime('%s','now')),
      FOREIGN KEY (ticket_id) REFERENCES tickets(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_order_trackings_due ON order_trackings(active, next_check_at);
    CREATE INDEX IF NOT EXISTS idx_order_trackings_ticket ON order_trackings(ticket_id);

    CREATE TABLE IF NOT EXISTS giveaways (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      guild_id TEXT NOT NULL,
      channel_id TEXT NOT NULL,
      message_id TEXT,
      host_id TEXT NOT NULL,
      prize TEXT NOT NULL,
      description TEXT,
      image TEXT,
      winners_count INTEGER DEFAULT 1,
      required_invites INTEGER DEFAULT 0,
      ends_at INTEGER NOT NULL,
      status TEXT DEFAULT 'open',
      winner_ids TEXT DEFAULT '[]',
      created_at INTEGER DEFAULT (strftime('%s','now')),
      ended_at INTEGER
    );
    CREATE INDEX IF NOT EXISTS idx_giveaways_due ON giveaways(status, ends_at);
    CREATE INDEX IF NOT EXISTS idx_giveaways_guild ON giveaways(guild_id, status);

    CREATE TABLE IF NOT EXISTS giveaway_entries (
      giveaway_id INTEGER NOT NULL,
      guild_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      joined_at INTEGER DEFAULT (strftime('%s','now')),
      PRIMARY KEY (giveaway_id, user_id),
      FOREIGN KEY (giveaway_id) REFERENCES giveaways(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_giveaway_entries_guild ON giveaway_entries(guild_id, user_id);

    CREATE TABLE IF NOT EXISTS invite_members (
      guild_id TEXT NOT NULL,
      invited_user_id TEXT NOT NULL,
      inviter_id TEXT,
      invite_code TEXT,
      joined_at INTEGER DEFAULT (strftime('%s','now')),
      left_at INTEGER,
      active INTEGER DEFAULT 1,
      PRIMARY KEY (guild_id, invited_user_id)
    );
    CREATE INDEX IF NOT EXISTS idx_invite_members_inviter ON invite_members(guild_id, inviter_id, active);

    CREATE TABLE IF NOT EXISTS invite_stats (
      guild_id TEXT NOT NULL,
      inviter_id TEXT NOT NULL,
      total_invites INTEGER DEFAULT 0,
      active_invites INTEGER DEFAULT 0,
      left_invites INTEGER DEFAULT 0,
      updated_at INTEGER DEFAULT (strftime('%s','now')),
      PRIMARY KEY (guild_id, inviter_id)
    );
    CREATE INDEX IF NOT EXISTS idx_invite_stats_leaderboard ON invite_stats(guild_id, active_invites DESC);

    CREATE TABLE IF NOT EXISTS invite_rewards (
      guild_id TEXT NOT NULL,
      tier_name TEXT NOT NULL,
      threshold INTEGER NOT NULL,
      reward_description TEXT NOT NULL,
      role_id TEXT,
      announce_channel_id TEXT,
      position INTEGER DEFAULT 0,
      enabled INTEGER DEFAULT 1,
      PRIMARY KEY (guild_id, tier_name)
    );
    CREATE INDEX IF NOT EXISTS idx_invite_rewards_lookup ON invite_rewards(guild_id, threshold ASC);

    CREATE TABLE IF NOT EXISTS invite_reward_claims (
      guild_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      tier_name TEXT NOT NULL,
      claimed_at INTEGER DEFAULT (strftime('%s','now')),
      PRIMARY KEY (guild_id, user_id, tier_name)
    );
  `);

  // Migrations idempotentes (no-op si la colonne existe deja).
  try { db.exec(`ALTER TABLE panels ADD COLUMN display_mode TEXT DEFAULT 'buttons'`); } catch {}
  try { db.exec(`ALTER TABLE panel_buttons ADD COLUMN description TEXT`); } catch {}
  try { db.exec(`ALTER TABLE panel_buttons ADD COLUMN placeholder_text TEXT`); } catch {}
  try { db.exec(`ALTER TABLE panel_buttons ADD COLUMN claimed_category_id TEXT`); } catch {}
  try { db.exec(`ALTER TABLE guild_config ADD COLUMN cooldown_max_tickets INTEGER DEFAULT 0`); } catch {}
  try { db.exec(`ALTER TABLE guild_config ADD COLUMN cooldown_window_minutes INTEGER DEFAULT 60`); } catch {}
  try { db.exec(`ALTER TABLE guild_config ADD COLUMN log_messages INTEGER DEFAULT 0`); } catch {}
  try { db.exec(`ALTER TABLE guild_config ADD COLUMN rules_role_id TEXT`); } catch {}
  try { db.exec(`ALTER TABLE guild_config ADD COLUMN availability_channel_id TEXT`); } catch {}
  try { db.exec(`ALTER TABLE guild_config ADD COLUMN availability_role_id TEXT`); } catch {}
  try { db.exec(`ALTER TABLE guild_config ADD COLUMN availability_order_channel_id TEXT`); } catch {}
  try { db.exec(`ALTER TABLE guild_config ADD COLUMN availability_order_link TEXT`); } catch {}
  try { db.exec(`ALTER TABLE tickets ADD COLUMN snoozed_until INTEGER`); } catch {}
  try { db.exec(`ALTER TABLE tickets ADD COLUMN order_state TEXT DEFAULT 'none'`); } catch {}
  try { db.exec(`ALTER TABLE tickets ADD COLUMN order_price TEXT`); } catch {}
  try { db.exec(`ALTER TABLE tickets ADD COLUMN order_tracking TEXT`); } catch {}
  try { db.exec(`ALTER TABLE tickets ADD COLUMN order_status_message_id TEXT`); } catch {}
  try { db.exec(`ALTER TABLE tickets ADD COLUMN order_cancel_reason TEXT`); } catch {}

  logger.info({ path: config.dbPath }, 'Database initialised');
  return db;
}

/**
 * Recupere la connexion DB deja initialisee.
 * @returns {Database.Database}
 */
export function getDb() {
  if (!db) initDb();
  return db;
}
