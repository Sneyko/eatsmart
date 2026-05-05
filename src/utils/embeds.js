import { EmbedBuilder } from 'discord.js';
import { LIMITS, truncate } from './validators.js';

/**
 * Embed d'erreur ephemeral.
 * @param {string} msg
 */
export function errorEmbed(msg) {
  return new EmbedBuilder().setColor(0xed4245).setDescription(`❌ ${truncate(msg, LIMITS.EMBED_DESCRIPTION)}`);
}

/**
 * Embed de succès ephemeral.
 * @param {string} msg
 */
export function successEmbed(msg) {
  return new EmbedBuilder().setColor(0x57f287).setDescription(`✅ ${truncate(msg, LIMITS.EMBED_DESCRIPTION)}`);
}

/**
 * Embed informatif.
 * @param {string} msg
 */
export function infoEmbed(msg) {
  return new EmbedBuilder().setColor(0x5865f2).setDescription(truncate(msg, LIMITS.EMBED_DESCRIPTION));
}
