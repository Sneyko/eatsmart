import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  SlashCommandBuilder,
} from 'discord.js';
import {
  deleteAvailabilityPost,
  getAvailabilityPost,
  upsertAvailabilityPost,
} from '../db/availability.js';
import { getCachedGuildConfig } from '../utils/cache.js';
import { errorEmbed, infoEmbed, successEmbed } from '../utils/embeds.js';
import { isAdmin } from '../utils/permissions.js';
import { LIMITS, truncate } from '../utils/validators.js';

const MESSAGE_MAX = 1000;

export const data = new SlashCommandBuilder()
  .setName('dispo')
  .setDescription('Afficher ou retirer sa disponibilite cuistot')
  .setDMPermission(false)
  .addSubcommand((s) =>
    s
      .setName('on')
      .setDescription('Afficher que tu es disponible')
      .addStringOption((o) =>
        o
          .setName('message')
          .setDescription('Message optionnel affiche dans ton embed')
          .setMaxLength(MESSAGE_MAX),
      ),
  )
  .addSubcommand((s) => s.setName('off').setDescription('Retirer ta disponibilite'));

/**
 * @param {import('discord.js').ChatInputCommandInteraction} interaction
 */
export async function execute(interaction) {
  if (!interaction.guild) {
    return interaction.reply({
      embeds: [errorEmbed('Commande serveur uniquement.')],
      ephemeral: true,
    });
  }

  const cfg = getCachedGuildConfig(interaction.guild.id);
  const accessError = validateAccess(interaction, cfg);
  if (accessError) {
    return interaction.reply({ embeds: [errorEmbed(accessError)], ephemeral: true });
  }

  const sub = interaction.options.getSubcommand();
  if (sub === 'on') return setAvailable(interaction, cfg);
  if (sub === 'off') return setUnavailable(interaction);
  return interaction.reply({ embeds: [errorEmbed('Sous-commande inconnue.')], ephemeral: true });
}

async function setAvailable(interaction, cfg) {
  const targetUrl = resolveOrderUrl(cfg, interaction.guild.id);
  if (!cfg.availability_channel_id || !targetUrl) {
    return interaction.reply({
      embeds: [
        errorEmbed(
          'Le systeme dispo n\'est pas completement configure. Utilise `/setup dispo` avec un salon, un role et un salon/lien de commande.',
        ),
      ],
      ephemeral: true,
    });
  }
  if (!isHttpUrl(targetUrl)) {
    return interaction.reply({
      embeds: [errorEmbed('Le lien configure pour le bouton Prendre commande est invalide.')],
      ephemeral: true,
    });
  }

  const channel = await interaction.guild.channels.fetch(cfg.availability_channel_id).catch(() => null);
  if (!channel?.isTextBased?.()) {
    return interaction.reply({
      embeds: [errorEmbed('Le salon de disponibilites configure est introuvable ou invalide.')],
      ephemeral: true,
    });
  }

  const customMessage = interaction.options.getString('message')?.trim() || null;
  const previous = getAvailabilityPost(interaction.guild.id, interaction.user.id);
  if (previous) await deleteAvailabilityMessage(interaction.guild, previous);

  const embed = buildAvailabilityEmbed(interaction, customMessage);
  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setLabel('Prendre commande')
      .setStyle(ButtonStyle.Link)
      .setURL(targetUrl),
  );

  const posted = await channel.send({ embeds: [embed], components: [row] });
  upsertAvailabilityPost({
    guildId: interaction.guild.id,
    userId: interaction.user.id,
    channelId: channel.id,
    messageId: posted.id,
    message: customMessage,
  });

  const jumpUrl = `https://discord.com/channels/${interaction.guild.id}/${channel.id}/${posted.id}`;
  return interaction.reply({
    embeds: [successEmbed(`Disponibilite publiee : ${jumpUrl}`)],
    ephemeral: true,
  });
}

async function setUnavailable(interaction) {
  const existing = getAvailabilityPost(interaction.guild.id, interaction.user.id);
  if (!existing) {
    return interaction.reply({
      embeds: [infoEmbed('Tu n\'as pas de disponibilite active.')],
      ephemeral: true,
    });
  }

  await deleteAvailabilityMessage(interaction.guild, existing);
  deleteAvailabilityPost(interaction.guild.id, interaction.user.id);
  return interaction.reply({
    embeds: [successEmbed('Disponibilite retiree.')],
    ephemeral: true,
  });
}

function buildAvailabilityEmbed(interaction, customMessage) {
  const description = customMessage || 'Je suis disponible pour prendre une commande.';
  return new EmbedBuilder()
    .setColor(0x57f287)
    .setTitle('Dispo')
    .setDescription(truncate(description, LIMITS.EMBED_DESCRIPTION))
    .addFields({ name: 'Cuistot', value: `<@${interaction.user.id}>`, inline: true })
    .setThumbnail(interaction.user.displayAvatarURL())
    .setTimestamp();
}

async function deleteAvailabilityMessage(guild, post) {
  const channel = await guild.channels.fetch(post.channel_id).catch(() => null);
  if (!channel?.isTextBased?.()) return;
  const message = await channel.messages.fetch(post.message_id).catch(() => null);
  if (message) await message.delete().catch(() => {});
}

function validateAccess(interaction, cfg) {
  if (!cfg.availability_role_id) {
    return 'Aucun role cuistot n\'est configure. Utilise `/setup dispo role:@role`.';
  }
  if (isAdmin(interaction.member)) return null;
  if (!interaction.member?.roles?.cache?.has(cfg.availability_role_id)) {
    return `Commande reservee au role <@&${cfg.availability_role_id}>.`;
  }
  return null;
}

function resolveOrderUrl(cfg, guildId) {
  if (cfg.availability_order_link) return cfg.availability_order_link;
  if (cfg.availability_order_channel_id) {
    return `https://discord.com/channels/${guildId}/${cfg.availability_order_channel_id}`;
  }
  return null;
}

function isHttpUrl(value) {
  try {
    const url = new URL(value);
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch {
    return false;
  }
}
