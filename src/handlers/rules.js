import { logger } from '../config.js';
import { errorEmbed, successEmbed } from '../utils/embeds.js';
import { getCachedGuildConfig } from '../utils/cache.js';

/**
 * Bouton "J'accepte le règlement" : assigne le rôle de validation s'il
 * n'est pas déjà présent. Pas de toggle (clic ne retire pas le rôle).
 * @param {import('discord.js').ButtonInteraction} interaction
 */
export async function handleAcceptRules(interaction) {
  const cfg = getCachedGuildConfig(interaction.guild.id);
  if (!cfg.rules_role_id) {
    return interaction.reply({
      embeds: [errorEmbed("Le rôle de validation n'est pas configuré. Préviens un admin.")],
      ephemeral: true,
    });
  }

  const member = interaction.member;
  if (member.roles.cache.has(cfg.rules_role_id)) {
    return interaction.reply({
      embeds: [successEmbed('Tu as déjà accepté le règlement, ton accès est déjà débloqué. ✅')],
      ephemeral: true,
    });
  }

  try {
    await member.roles.add(cfg.rules_role_id, 'Acceptation du règlement');
  } catch (err) {
    logger.warn({ err, userId: member.id }, 'Failed to add rules role');
    return interaction.reply({
      embeds: [errorEmbed("Erreur : impossible d'attribuer le rôle. Préviens un admin.")],
      ephemeral: true,
    });
  }

  return interaction.reply({
    embeds: [
      successEmbed('🎉 Bienvenue ! Ton règlement est validé, tu as maintenant accès au serveur.'),
    ],
    ephemeral: true,
  });
}
