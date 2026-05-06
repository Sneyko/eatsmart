import Database from 'better-sqlite3';
import { config, logger } from '../config.js';

let db;

/**
 * Initialise la connexion SQLite, active WAL et crée les tables si besoin.
 * @returns {Database.Database}
 */
export function initDb() {
  if (db) return db;
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
  `);

  // Migrations idempotentes (no-op si la colonne existe déjà).
  try { db.exec(`ALTER TABLE panels ADD COLUMN display_mode TEXT DEFAULT 'buttons'`); } catch {}
  try { db.exec(`ALTER TABLE panel_buttons ADD COLUMN description TEXT`); } catch {}
  try { db.exec(`ALTER TABLE panel_buttons ADD COLUMN placeholder_text TEXT`); } catch {}
  try { db.exec(`ALTER TABLE panel_buttons ADD COLUMN claimed_category_id TEXT`); } catch {}
  try { db.exec(`ALTER TABLE guild_config ADD COLUMN cooldown_max_tickets INTEGER DEFAULT 0`); } catch {}
  try { db.exec(`ALTER TABLE guild_config ADD COLUMN cooldown_window_minutes INTEGER DEFAULT 60`); } catch {}
  try { db.exec(`ALTER TABLE guild_config ADD COLUMN log_messages INTEGER DEFAULT 0`); } catch {}
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
 * Récupère la connexion DB déjà initialisée.
 * @returns {Database.Database}
 */
export function getDb() {
  if (!db) initDb();
  return db;
}
