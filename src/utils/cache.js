import { ensureGuildConfig, getGuildConfig } from '../db/queries.js';

const guildCache = new Map();

/**
 * Récupère la config d'une guilde, depuis la RAM ou depuis SQLite.
 * @param {string} guildId
 */
export function getCachedGuildConfig(guildId) {
  if (guildCache.has(guildId)) return guildCache.get(guildId);
  let cfg = getGuildConfig(guildId);
  if (!cfg) cfg = ensureGuildConfig(guildId);
  guildCache.set(guildId, cfg);
  return cfg;
}

/**
 * Invalide la config d'une guilde après un update.
 * @param {string} guildId
 */
export function invalidateGuildConfig(guildId) {
  guildCache.delete(guildId);
}
