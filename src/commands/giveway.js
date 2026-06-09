import {
  ChannelType,
  PermissionFlagsBits,
  SlashCommandBuilder,
} from 'discord.js';
import {
  createGiveawayFromInteraction,
  endGiveawayFromInteraction,
  listGiveaways,
  rerollGiveawayFromInteraction,
} from '../handlers/giveaways.js';
import { errorEmbed } from '../utils/embeds.js';
import { isStaff } from '../utils/permissions.js';

export const data = new SlashCommandBuilder()
  .setName('giveway')
  .setDescription('Créer et gérer les giveaways du serveur')
  .setDMPermission(false)
  .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
  .addSubcommand((s) =>
    s
      .setName('create')
      .setDescription('Créer un giveaway avec embed et bouton de participation')
      .addStringOption((o) =>
        o
          .setName('reward')
          .setDescription('Récompense à gagner')
          .setRequired(true)
          .setMaxLength(256),
      )
      .addIntegerOption((o) =>
        o
          .setName('duration_minutes')
          .setDescription('Durée du giveaway en minutes')
          .setRequired(true)
          .setMinValue(1)
          .setMaxValue(43200),
      )
      .addIntegerOption((o) =>
        o
          .setName('winners')
          .setDescription('Nombre de gagnants')
          .setMinValue(1)
          .setMaxValue(20),
      )
      .addChannelOption((o) =>
        o
          .setName('channel')
          .setDescription('Salon où poster le giveaway')
          .addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement),
      )
      .addStringOption((o) =>
        o
          .setName('description')
          .setDescription('Texte affiché sous la récompense')
          .setMaxLength(1000),
      )
      .addStringOption((o) =>
        o
          .setName('image')
          .setDescription('Image à afficher dans l’embed')
          .setMaxLength(500),
      )
      .addIntegerOption((o) =>
        o
          .setName('required_invites')
          .setDescription('Invitations actives requises pour participer')
          .setMinValue(0)
          .setMaxValue(500),
      ),
  )
  .addSubcommand((s) =>
    s
      .setName('end')
      .setDescription('Terminer un giveaway maintenant')
      .addIntegerOption((o) =>
        o.setName('id').setDescription('ID du giveaway').setRequired(true).setMinValue(1),
      ),
  )
  .addSubcommand((s) =>
    s
      .setName('reroll')
      .setDescription('Relancer le tirage d’un giveaway terminé')
      .addIntegerOption((o) =>
        o.setName('id').setDescription('ID du giveaway').setRequired(true).setMinValue(1),
      ),
  )
  .addSubcommand((s) =>
    s.setName('list').setDescription('Lister les derniers giveaways'),
  );

/**
 * @param {import('discord.js').ChatInputCommandInteraction} interaction
 */
export async function execute(interaction) {
  if (!interaction.guild) {
    return interaction.reply({ embeds: [errorEmbed('Commande serveur uniquement.')], ephemeral: true });
  }
  if (!isStaff(interaction.member)) {
    return interaction.reply({ embeds: [errorEmbed('Réservé au staff.')], ephemeral: true });
  }

  const sub = interaction.options.getSubcommand();
  if (sub === 'create') return createGiveawayFromInteraction(interaction);
  if (sub === 'end') return endGiveawayFromInteraction(interaction);
  if (sub === 'reroll') return rerollGiveawayFromInteraction(interaction);
  if (sub === 'list') return listGiveaways(interaction);

  return interaction.reply({ embeds: [errorEmbed('Sous-commande inconnue.')], ephemeral: true });
}
