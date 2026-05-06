import { logger } from '../config.js';
import { getUserOrderCount, listLoyaltyTiers } from '../db/queries.js';

/**
 * Détermine le palier le plus élevé atteint par un user pour un count donné.
 * @param {Array<{threshold:number}>} tiers triés par threshold ASC
 * @param {number} count
 * @returns {object|null}
 */
export function findTierForCount(tiers, count) {
  let current = null;
  for (const t of tiers) {
    if (count >= t.threshold) current = t;
    else break;
  }
  return current;
}

/**
 * Recalcule et applique le rôle de fidélité pour un user.
 * Retire les rôles de tiers du même scope qui ne correspondent plus,
 * ajoute le rôle du palier courant.
 * @param {import('discord.js').Guild} guild
 * @param {string} userId
 * @param {'client'|'cuistot'} scope
 */
export async function syncLoyaltyRole(guild, userId, scope) {
  const tiers = listLoyaltyTiers(guild.id, scope);
  if (tiers.length === 0) return;

  const count = getUserOrderCount(guild.id, userId, scope);
  const targetTier = findTierForCount(tiers, count);

  let member;
  try {
    member = await guild.members.fetch(userId);
  } catch (err) {
    logger.debug({ err, userId }, 'Could not fetch member for loyalty sync');
    return;
  }

  const allTierRoleIds = new Set(tiers.map((t) => t.role_id));
  for (const roleId of allTierRoleIds) {
    if (member.roles.cache.has(roleId) && roleId !== targetTier?.role_id) {
      try {
        await member.roles.remove(roleId, `Loyalty sync (${scope})`);
      } catch (err) {
        logger.warn({ err, roleId, userId }, 'Could not remove tier role');
      }
    }
  }

  if (targetTier && !member.roles.cache.has(targetTier.role_id)) {
    try {
      await member.roles.add(targetTier.role_id, `Loyalty: atteint ${targetTier.tier_name}`);
      logger.info(
        { userId, scope, tier: targetTier.tier_name, count },
        'Loyalty role granted',
      );
    } catch (err) {
      logger.warn(
        { err, userId, tier: targetTier.tier_name },
        'Could not add tier role',
      );
    }
  }
}
