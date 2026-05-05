import { PermissionFlagsBits } from 'discord.js';
import { getCachedGuildConfig } from './cache.js';

/**
 * Vrai si le membre est admin (Manage Guild) ou possède un rôle support.
 * @param {import('discord.js').GuildMember} member
 */
export function isStaff(member) {
  if (!member) return false;
  if (member.permissions.has(PermissionFlagsBits.ManageGuild)) return true;
  const cfg = getCachedGuildConfig(member.guild.id);
  let roles = [];
  try {
    roles = JSON.parse(cfg.support_role_ids || '[]');
  } catch {
    roles = [];
  }
  return roles.some((r) => member.roles.cache.has(r));
}

/**
 * Vrai si le membre a Manage Guild.
 * @param {import('discord.js').GuildMember} member
 */
export function isAdmin(member) {
  return !!member?.permissions?.has(PermissionFlagsBits.ManageGuild);
}
