import { getDb } from './schema.js';

const CONFIG_FIELDS = new Map([
  ['availability_channel_id', 'availability_channel_id'],
  ['availability_role_id', 'availability_role_id'],
  ['availability_order_channel_id', 'availability_order_channel_id'],
  ['availability_order_link', 'availability_order_link'],
]);

/**
 * Met a jour la configuration du systeme de disponibilites.
 * Les champs omis ne sont pas modifies, les champs a null sont effaces.
 * @param {string} guildId
 * @param {object} patch
 */
export function updateAvailabilityConfig(guildId, patch) {
  const db = getDb();
  db.prepare(`
    INSERT INTO guild_config (guild_id) VALUES (?)
    ON CONFLICT(guild_id) DO NOTHING
  `).run(guildId);

  const entries = Object.entries(patch).filter(
    ([key, value]) => CONFIG_FIELDS.has(key) && value !== undefined,
  );
  if (entries.length === 0) return { changes: 0 };

  const assignments = entries.map(([key]) => `${CONFIG_FIELDS.get(key)} = ?`).join(', ');
  return db.prepare(`UPDATE guild_config SET ${assignments} WHERE guild_id = ?`).run(
    ...entries.map(([, value]) => value),
    guildId,
  );
}

/**
 * Enregistre le message de disponibilite actif d'un cuistot.
 */
export function upsertAvailabilityPost({ guildId, userId, channelId, messageId, message = null }) {
  return getDb().prepare(`
    INSERT INTO availability_posts (guild_id, user_id, channel_id, message_id, message)
    VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(guild_id, user_id) DO UPDATE SET
      channel_id = excluded.channel_id,
      message_id = excluded.message_id,
      message = excluded.message,
      updated_at = strftime('%s','now')
  `).run(guildId, userId, channelId, messageId, message);
}

export function getAvailabilityPost(guildId, userId) {
  return getDb().prepare(`
    SELECT * FROM availability_posts WHERE guild_id = ? AND user_id = ?
  `).get(guildId, userId);
}

export function deleteAvailabilityPost(guildId, userId) {
  return getDb().prepare(`
    DELETE FROM availability_posts WHERE guild_id = ? AND user_id = ?
  `).run(guildId, userId);
}
