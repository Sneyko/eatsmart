import {
  ChannelType,
  PermissionFlagsBits,
  SlashCommandBuilder,
} from 'discord.js';
import { ensureGuildConfig, updateTicketsConfig, updateWelcomeConfig } from '../db/queries.js';
import { invalidateGuildConfig } from '../utils/cache.js';
import { errorEmbed, successEmbed } from '../utils/embeds.js';
import { parseColor, truncate, LIMITS } from '../utils/validators.js';

export const data = new SlashCommandBuilder()
  .setName('setup')
  .setDescription('Configurer le bot (welcome, tickets)')
  .setDMPermission(false)
  .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
  .addSubcommand((s) =>
    s
      .setName('tickets')
      .setDescription('Configurer le système de tickets')
      .addChannelOption((o) =>
        o
          .setName('category')
          .setDescription('Catégorie où créer les tickets')
          .addChannelTypes(ChannelType.GuildCategory),
      )
      .addChannelOption((o) =>
        o
          .setName('log_channel')
          .setDescription('Channel des logs staff')
          .addChannelTypes(ChannelType.GuildText),
      )
      .addChannelOption((o) =>
        o
          .setName('transcript_channel')
          .setDescription('Channel où poster les transcripts')
          .addChannelTypes(ChannelType.GuildText),
      )
      .addRoleOption((o) =>
        o.setName('support_role').setDescription('Rôle staff principal (un seul, pour la base)'),
      )
      .addIntegerOption((o) =>
        o
          .setName('max_open_per_user')
          .setDescription('Tickets simultanés max par user (0 = illimité)')
          .setMinValue(0)
          .setMaxValue(20),
      )
      .addIntegerOption((o) =>
        o
          .setName('autoclose_hours')
          .setDescription("Auto-close après X heures d'inactivité (0 = off)")
          .setMinValue(0)
          .setMaxValue(720),
      ),
  )
  .addSubcommand((s) =>
    s
      .setName('welcome')
      .setDescription('Configurer le message de bienvenue')
      .addBooleanOption((o) => o.setName('enabled').setDescription('Activer ou non'))
      .addChannelOption((o) =>
        o
          .setName('channel')
          .setDescription('Channel des messages de bienvenue')
          .addChannelTypes(ChannelType.GuildText),
      )
      .addStringOption((o) => o.setName('title').setDescription('Titre embed').setMaxLength(LIMITS.EMBED_TITLE))
      .addStringOption((o) =>
        o.setName('description').setDescription('Description embed (variables : {user}, {server}, {membercount})'),
      )
      .addStringOption((o) => o.setName('color').setDescription('Couleur hex (#5865F2)'))
      .addStringOption((o) => o.setName('image').setDescription('URL image (large)'))
      .addStringOption((o) => o.setName('thumbnail').setDescription('URL thumbnail'))
      .addRoleOption((o) => o.setName('autorole').setDescription('Rôle ajouté auto au nouveau membre')),
  );

/**
 * @param {import('discord.js').ChatInputCommandInteraction} interaction
 */
export async function execute(interaction) {
  if (!interaction.guild) {
    return interaction.reply({
      embeds: [errorEmbed("Cette commande ne s'utilise que sur un serveur.")],
      ephemeral: true,
    });
  }
  ensureGuildConfig(interaction.guild.id);
  const sub = interaction.options.getSubcommand();
  if (sub === 'tickets') {
    const category = interaction.options.getChannel('category');
    const log = interaction.options.getChannel('log_channel');
    const transcript = interaction.options.getChannel('transcript_channel');
    const supportRole = interaction.options.getRole('support_role');
    const maxOpen = interaction.options.getInteger('max_open_per_user');
    const autoclose = interaction.options.getInteger('autoclose_hours');

    updateTicketsConfig(interaction.guild.id, {
      ticket_category_id: category?.id ?? null,
      log_channel_id: log?.id ?? null,
      transcript_channel_id: transcript?.id ?? null,
      support_role_ids: supportRole ? JSON.stringify([supportRole.id]) : null,
      max_open_per_user: maxOpen ?? null,
      autoclose_hours: autoclose ?? null,
    });
    invalidateGuildConfig(interaction.guild.id);
    return interaction.reply({
      embeds: [successEmbed('Configuration tickets mise à jour.')],
      ephemeral: true,
    });
  }
  if (sub === 'welcome') {
    const enabled = interaction.options.getBoolean('enabled');
    const channel = interaction.options.getChannel('channel');
    const title = interaction.options.getString('title');
    const description = interaction.options.getString('description');
    const color = interaction.options.getString('color');
    const image = interaction.options.getString('image');
    const thumbnail = interaction.options.getString('thumbnail');
    const autorole = interaction.options.getRole('autorole');

    updateWelcomeConfig(interaction.guild.id, {
      welcome_enabled: enabled === null ? null : enabled ? 1 : 0,
      welcome_channel_id: channel?.id ?? null,
      welcome_title: title ? truncate(title, LIMITS.EMBED_TITLE) : null,
      welcome_description: description ? truncate(description, LIMITS.EMBED_DESCRIPTION) : null,
      welcome_color: color ? parseColor(color) : null,
      welcome_image: image ?? null,
      welcome_thumbnail: thumbnail ?? null,
      welcome_role_id: autorole?.id ?? null,
    });
    invalidateGuildConfig(interaction.guild.id);
    return interaction.reply({
      embeds: [successEmbed('Configuration welcome mise à jour.')],
      ephemeral: true,
    });
  }
  return interaction.reply({ embeds: [errorEmbed('Sous-commande inconnue.')], ephemeral: true });
}
