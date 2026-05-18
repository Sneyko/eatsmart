import {
  ChannelType,
  PermissionFlagsBits,
  SlashCommandBuilder,
} from 'discord.js';
import { updateAvailabilityConfig } from '../db/availability.js';
import { ensureGuildConfig, updateTicketsConfig, updateWelcomeConfig } from '../db/queries.js';
import { invalidateGuildConfig } from '../utils/cache.js';
import { errorEmbed, successEmbed } from '../utils/embeds.js';
import { parseColor, truncate, LIMITS } from '../utils/validators.js';

export const data = new SlashCommandBuilder()
  .setName('setup')
  .setDescription('Configurer le bot (welcome, tickets, dispo)')
  .setDMPermission(false)
  .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
  .addSubcommand((s) =>
    s
      .setName('tickets')
      .setDescription('Configurer le systeme de tickets')
      .addChannelOption((o) =>
        o
          .setName('category')
          .setDescription('Categorie ou creer les tickets')
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
          .setDescription('Channel ou poster les transcripts')
          .addChannelTypes(ChannelType.GuildText),
      )
      .addRoleOption((o) =>
        o.setName('support_role').setDescription('Role staff principal (un seul, pour la base)'),
      )
      .addIntegerOption((o) =>
        o
          .setName('max_open_per_user')
          .setDescription('Tickets simultanes max par user (0 = illimite)')
          .setMinValue(0)
          .setMaxValue(20),
      )
      .addIntegerOption((o) =>
        o
          .setName('autoclose_hours')
          .setDescription("Auto-close apres X heures d'inactivite (0 = off)")
          .setMinValue(0)
          .setMaxValue(720),
      )
      .addIntegerOption((o) =>
        o
          .setName('cooldown_max')
          .setDescription('Max tickets ouverts par user dans la fenetre (0 = off)')
          .setMinValue(0)
          .setMaxValue(20),
      )
      .addIntegerOption((o) =>
        o
          .setName('cooldown_window_min')
          .setDescription('Fenetre de cooldown en minutes (default 60)')
          .setMinValue(5)
          .setMaxValue(1440),
      )
      .addBooleanOption((o) =>
        o
          .setName('log_messages')
          .setDescription('Logger chaque message des tickets dans le log channel'),
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
      .addRoleOption((o) => o.setName('autorole').setDescription('Role ajoute auto au nouveau membre')),
  )
  .addSubcommand((s) =>
    s
      .setName('dispo')
      .setDescription('Configurer les disponibilites cuistot')
      .addChannelOption((o) =>
        o
          .setName('channel')
          .setDescription('Salon ou poster les cuistots disponibles')
          .addChannelTypes(ChannelType.GuildText),
      )
      .addRoleOption((o) =>
        o.setName('role').setDescription('Role autorise a utiliser /dispo'),
      )
      .addChannelOption((o) =>
        o
          .setName('order_channel')
          .setDescription('Salon ouvert par le bouton Prendre commande')
          .addChannelTypes(ChannelType.GuildText),
      )
      .addStringOption((o) =>
        o
          .setName('order_link')
          .setDescription('Lien Discord exact ouvert par le bouton (message ou salon)')
          .setMaxLength(300),
      ),
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
    const cooldownMax = interaction.options.getInteger('cooldown_max');
    const cooldownWindow = interaction.options.getInteger('cooldown_window_min');
    const logMessages = interaction.options.getBoolean('log_messages');

    updateTicketsConfig(interaction.guild.id, {
      ticket_category_id: category?.id ?? null,
      log_channel_id: log?.id ?? null,
      transcript_channel_id: transcript?.id ?? null,
      support_role_ids: supportRole ? JSON.stringify([supportRole.id]) : null,
      max_open_per_user: maxOpen ?? null,
      autoclose_hours: autoclose ?? null,
      cooldown_max_tickets: cooldownMax ?? null,
      cooldown_window_minutes: cooldownWindow ?? null,
      log_messages: logMessages === null ? null : logMessages ? 1 : 0,
    });
    invalidateGuildConfig(interaction.guild.id);
    return interaction.reply({
      embeds: [successEmbed('Configuration tickets mise a jour.')],
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
      embeds: [successEmbed('Configuration welcome mise a jour.')],
      ephemeral: true,
    });
  }
  if (sub === 'dispo') {
    const channel = interaction.options.getChannel('channel');
    const role = interaction.options.getRole('role');
    const orderChannel = interaction.options.getChannel('order_channel');
    const orderLink = interaction.options.getString('order_link')?.trim() || null;

    if (orderChannel && orderLink) {
      return interaction.reply({
        embeds: [errorEmbed('Choisis soit order_channel, soit order_link, pas les deux.')],
        ephemeral: true,
      });
    }
    if (orderLink && !isHttpUrl(orderLink)) {
      return interaction.reply({
        embeds: [errorEmbed('Le lien doit commencer par http:// ou https://.')],
        ephemeral: true,
      });
    }

    const patch = {};
    if (channel) patch.availability_channel_id = channel.id;
    if (role) patch.availability_role_id = role.id;
    if (orderChannel) {
      patch.availability_order_channel_id = orderChannel.id;
      patch.availability_order_link = null;
    }
    if (orderLink) {
      patch.availability_order_link = orderLink;
      patch.availability_order_channel_id = null;
    }

    if (Object.keys(patch).length === 0) {
      return interaction.reply({
        embeds: [errorEmbed('Indique au moins un salon, un role, ou une destination de commande.')],
        ephemeral: true,
      });
    }

    updateAvailabilityConfig(interaction.guild.id, patch);
    invalidateGuildConfig(interaction.guild.id);
    return interaction.reply({
      embeds: [successEmbed('Configuration dispo mise a jour.')],
      ephemeral: true,
    });
  }
  return interaction.reply({ embeds: [errorEmbed('Sous-commande inconnue.')], ephemeral: true });
}

function isHttpUrl(value) {
  try {
    const url = new URL(value);
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch {
    return false;
  }
}
