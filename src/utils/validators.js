/**
 * Limites Discord (titres, descriptions, etc.).
 */
export const LIMITS = {
  EMBED_TITLE: 256,
  EMBED_DESCRIPTION: 4096,
  EMBED_FIELD_NAME: 256,
  EMBED_FIELD_VALUE: 1024,
  BUTTON_LABEL: 80,
  CHANNEL_NAME: 100,
  MODAL_INPUT: 4000,
};

/**
 * Tronque une chaîne au max imposé par Discord, ajoute "..." si dépassement.
 * @param {string|null|undefined} s
 * @param {number} max
 */
export function truncate(s, max) {
  if (!s) return s;
  if (s.length <= max) return s;
  return s.slice(0, max - 1) + '…';
}

/**
 * Sanitise une couleur entrée par l'utilisateur (#rrggbb ou nombre).
 * @param {string|number|null|undefined} c
 * @returns {number}
 */
export function parseColor(c) {
  if (c === null || c === undefined || c === '') return 0x5865f2;
  if (typeof c === 'number') return c & 0xffffff;
  const trimmed = String(c).trim().replace(/^#/, '');
  const n = parseInt(trimmed, 16);
  return Number.isFinite(n) ? n & 0xffffff : 0x5865f2;
}

/**
 * Remplace les variables {user}, {server}, {membercount}.
 * @param {string} template
 * @param {{user?: import('discord.js').GuildMember, guild?: import('discord.js').Guild, username?: string}} ctx
 */
export function applyVars(template, ctx) {
  if (!template) return '';
  return template
    .replaceAll('{user}', ctx.user ? `<@${ctx.user.id}>` : ctx.username || '')
    .replaceAll('{username}', ctx.user?.user?.username || ctx.username || 'user')
    .replaceAll('{server}', ctx.guild?.name || '')
    .replaceAll('{membercount}', String(ctx.guild?.memberCount ?? ''))
    .replaceAll('{number}', String(ctx.number ?? ''));
}

/**
 * Retourne un nom de channel valide à partir d'un template.
 * @param {string} template
 * @param {object} ctx
 */
export function buildChannelName(template, ctx) {
  let name = applyVars(template, ctx).toLowerCase();
  name = name.replace(/[^a-z0-9-]+/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '');
  if (!name) name = `ticket-${ctx.number ?? 0}`;
  return truncate(name, LIMITS.CHANNEL_NAME);
}
