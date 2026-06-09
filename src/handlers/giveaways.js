import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
} from 'discord.js';
import { logger } from '../config.js';
import {
  addGiveawayEntry,
  countGiveawayEntries,
  createGiveaway,
  endGiveaway,
  getGiveaway,
  getInviteStats,
  listDueGiveaways,
  listGiveawayEntries,
  listGuildGiveaways,
  updateGiveawayMessage,
} from '../db/queries.js';
import { errorEmbed, successEmbed } from '../utils/embeds.js';
import { truncate, LIMITS } from '../utils/validators.js';

const GIVEAWAY_COLOR = 0x8b5cf6;
const GIVEAWAY_ENDED_COLOR = 0x2f3136;
const GIVEAWAY_POLL_MS = Number(process.env.GIVEAWAY_POLL_SECONDS || 30) * 1000;

let timer = null;
let running = false;

/**
 * Démarre le check périodique des giveaways qui doivent se terminer.
 * @param {import('discord.js').Client} client
 */
export function startGiveawayScheduler(client) {
  if (timer) return;
  const tick = () => runGiveawayPass(client).catch((err) => {
    logger.error({ err }, 'Giveaway pass failed');
  });
  timer = setInterval(tick, GIVEAWAY_POLL_MS);
  setTimeout(tick, 10 * 1000).unref?.();
  logger.info({ intervalSec: GIVEAWAY_POLL_MS / 1000 }, 'Giveaway scheduler started');
}

/**
 * Crée un giveaway et poste l'embed dans le salon choisi.
 * @param {import('discord.js').ChatInputCommandInteraction} interaction
 */
export async function createGiveawayFromInteraction(interaction) {
  const channel = interaction.options.getChannel('channel') || interaction.channel;
  if (!channel?.isTextBased?.() || !channel.send) {
    return interaction.reply({
      embeds: [errorEmbed('Choisis un salon textuel valide.')],
      ephemeral: true,
    });
  }

  const prize = interaction.options.getString('reward', true).trim();
  const description = interaction.options.getString('description')?.trim() || null;
  const durationMinutes = interaction.options.getInteger('duration_minutes', true);
  const winnersCount = interaction.options.getInteger('winners') ?? 1;
  const requiredInvites = interaction.options.getInteger('required_invites') ?? 0;
  const image = interaction.options.getString('image')?.trim() || null;

  if (image && !isHttpUrl(image)) {
    return interaction.reply({
      embeds: [errorEmbed("L'image doit être une URL http:// ou https://.")],
      ephemeral: true,
    });
  }

  const endsAt = nowSeconds() + durationMinutes * 60;
  const giveawayId = createGiveaway({
    guild_id: interaction.guild.id,
    channel_id: channel.id,
    host_id: interaction.user.id,
    prize: truncate(prize, 256),
    description: description ? truncate(description, LIMITS.EMBED_DESCRIPTION) : null,
    image,
    winners_count: winnersCount,
    required_invites: requiredInvites,
    ends_at: endsAt,
  });
  const giveaway = getGiveaway(giveawayId);

  try {
    const message = await channel.send(buildGiveawayMessage(giveaway, 0));
    updateGiveawayMessage(giveawayId, channel.id, message.id);
    return interaction.reply({
      embeds: [
        successEmbed(
          `Giveaway créé dans ${channel}.\nID : **${giveawayId}**\nMessage : ${message.url}`,
        ),
      ],
      ephemeral: true,
    });
  } catch (err) {
    endGiveaway(giveawayId, []);
    logger.warn({ err, giveawayId, channelId: channel.id }, 'Could not send giveaway message');
    return interaction.reply({
      embeds: [errorEmbed("Impossible d'envoyer le giveaway dans ce salon.")],
      ephemeral: true,
    });
  }
}

/**
 * Affiche les giveaways récents du serveur.
 * @param {import('discord.js').ChatInputCommandInteraction} interaction
 */
export async function listGiveaways(interaction) {
  const giveaways = listGuildGiveaways(interaction.guild.id, 12);
  if (giveaways.length === 0) {
    return interaction.reply({
      embeds: [errorEmbed('Aucun giveaway enregistré pour ce serveur.')],
      ephemeral: true,
    });
  }

  const lines = giveaways.map((g) => {
    const state = g.status === 'open' ? `fin <t:${g.ends_at}:R>` : 'terminé';
    return `#${g.id} • **${truncate(g.prize, 80)}** • ${state} • ${g.winners_count} gagnant(s)`;
  });
  const embed = new EmbedBuilder()
    .setColor(GIVEAWAY_COLOR)
    .setTitle('Giveaways')
    .setDescription(lines.join('\n'));

  return interaction.reply({ embeds: [embed], ephemeral: true });
}

/**
 * Termine un giveaway immédiatement.
 * @param {import('discord.js').ChatInputCommandInteraction} interaction
 */
export async function endGiveawayFromInteraction(interaction) {
  const id = interaction.options.getInteger('id', true);
  const giveaway = getGiveaway(id);
  if (!giveaway || giveaway.guild_id !== interaction.guild.id) {
    return interaction.reply({ embeds: [errorEmbed('Giveaway introuvable.')], ephemeral: true });
  }
  if (giveaway.status !== 'open') {
    return interaction.reply({ embeds: [errorEmbed('Ce giveaway est déjà terminé.')], ephemeral: true });
  }

  await interaction.deferReply({ ephemeral: true });
  const winners = await closeGiveaway(interaction.client, giveaway, 'manual');
  return interaction.editReply({
    embeds: [
      successEmbed(
        winners.length
          ? `Giveaway terminé. Gagnant(s) : ${formatMentions(winners)}`
          : 'Giveaway terminé sans participant éligible.',
      ),
    ],
  });
}

/**
 * Retire un nouveau gagnant sur un giveaway déjà terminé.
 * @param {import('discord.js').ChatInputCommandInteraction} interaction
 */
export async function rerollGiveawayFromInteraction(interaction) {
  const id = interaction.options.getInteger('id', true);
  const giveaway = getGiveaway(id);
  if (!giveaway || giveaway.guild_id !== interaction.guild.id) {
    return interaction.reply({ embeds: [errorEmbed('Giveaway introuvable.')], ephemeral: true });
  }
  if (giveaway.status !== 'ended') {
    return interaction.reply({
      embeds: [errorEmbed('Le giveaway doit être terminé avant de reroll.')],
      ephemeral: true,
    });
  }

  const winners = pickWinners(listGiveawayEntries(giveaway.id).map((e) => e.user_id), giveaway.winners_count);
  endGiveaway(giveaway.id, winners);

  const channel = await interaction.client.channels.fetch(giveaway.channel_id).catch(() => null);
  if (channel?.send) {
    await channel.send(buildWinnerAnnouncement(giveaway, winners, true));
  }

  return interaction.reply({
    embeds: [
      successEmbed(
        winners.length
          ? `Nouveau tirage : ${formatMentions(winners)}`
          : 'Impossible de reroll : aucun participant.',
      ),
    ],
    ephemeral: true,
  });
}

/**
 * Gère le bouton de participation.
 * @param {import('discord.js').ButtonInteraction} interaction
 * @param {string} giveawayId
 */
export async function handleGiveawayJoin(interaction, giveawayId) {
  if (!interaction.guild) {
    return interaction.reply({ embeds: [errorEmbed('Serveur uniquement.')], ephemeral: true });
  }

  const giveaway = getGiveaway(Number(giveawayId));
  if (!giveaway || giveaway.guild_id !== interaction.guild.id) {
    return interaction.reply({ embeds: [errorEmbed('Giveaway introuvable.')], ephemeral: true });
  }
  if (giveaway.status !== 'open' || giveaway.ends_at <= nowSeconds()) {
    await closeGiveaway(interaction.client, giveaway, 'expired').catch(() => {});
    return interaction.reply({ embeds: [errorEmbed('Ce giveaway est terminé.')], ephemeral: true });
  }
  if (interaction.user.bot) {
    return interaction.reply({ embeds: [errorEmbed('Les bots ne peuvent pas participer.')], ephemeral: true });
  }

  const requiredInvites = Number(giveaway.required_invites || 0);
  if (requiredInvites > 0) {
    const stats = getInviteStats(interaction.guild.id, interaction.user.id);
    if (Number(stats.active_invites || 0) < requiredInvites) {
      return interaction.reply({
        embeds: [
          errorEmbed(
            `Il faut **${requiredInvites} invitation(s) active(s)** pour participer. Tu en as **${stats.active_invites || 0}**.`,
          ),
        ],
        ephemeral: true,
      });
    }
  }

  const result = addGiveawayEntry(giveaway.id, giveaway.guild_id, interaction.user.id);
  if (result.changes === 0) {
    return interaction.reply({
      embeds: [successEmbed('Tu es déjà inscrit à ce giveaway.')],
      ephemeral: true,
    });
  }

  const entryCount = countGiveawayEntries(giveaway.id);
  await interaction.message.edit(buildGiveawayMessage(giveaway, entryCount)).catch((err) => {
    logger.debug({ err, giveawayId: giveaway.id }, 'Could not refresh giveaway message');
  });
  return interaction.reply({
    embeds: [successEmbed('Participation enregistrée. Bonne chance !')],
    ephemeral: true,
  });
}

async function runGiveawayPass(client) {
  if (running) return;
  running = true;
  try {
    const due = listDueGiveaways(nowSeconds(), 10);
    for (const giveaway of due) {
      await closeGiveaway(client, giveaway, 'scheduled').catch((err) => {
        logger.warn({ err, giveawayId: giveaway.id }, 'Could not close giveaway');
      });
    }
  } finally {
    running = false;
  }
}

async function closeGiveaway(client, giveaway, reason) {
  const latest = getGiveaway(giveaway.id);
  if (!latest || latest.status !== 'open') return parseWinnerIds(latest?.winner_ids);

  const entries = listGiveawayEntries(latest.id).map((e) => e.user_id);
  const winners = pickWinners(entries, latest.winners_count);
  endGiveaway(latest.id, winners);

  const ended = { ...latest, status: 'ended', winner_ids: JSON.stringify(winners) };
  const entryCount = entries.length;
  const channel = await client.channels.fetch(latest.channel_id).catch(() => null);
  if (channel?.messages && latest.message_id) {
    const message = await channel.messages.fetch(latest.message_id).catch(() => null);
    await message?.edit(buildGiveawayMessage(ended, entryCount)).catch((err) => {
      logger.debug({ err, giveawayId: latest.id }, 'Could not edit ended giveaway');
    });
  }
  if (channel?.send) {
    await channel.send(buildWinnerAnnouncement(latest, winners, false, reason)).catch((err) => {
      logger.debug({ err, giveawayId: latest.id }, 'Could not announce giveaway winners');
    });
  }

  return winners;
}

function buildGiveawayMessage(giveaway, entryCount) {
  const isEnded = giveaway.status === 'ended';
  const winners = parseWinnerIds(giveaway.winner_ids);
  const embed = new EmbedBuilder()
    .setColor(isEnded ? GIVEAWAY_ENDED_COLOR : GIVEAWAY_COLOR)
    .setTitle(isEnded ? 'Giveaway terminé' : 'Giveaway')
    .setDescription(
      truncate(
        [
          `**${giveaway.prize}**`,
          giveaway.description,
        ].filter(Boolean).join('\n\n'),
        LIMITS.EMBED_DESCRIPTION,
      ),
    )
    .addFields(
      {
        name: 'Récompense',
        value: truncate(giveaway.prize, LIMITS.EMBED_FIELD_VALUE),
        inline: true,
      },
      {
        name: 'Gagnant(s)',
        value: String(giveaway.winners_count || 1),
        inline: true,
      },
      {
        name: 'Participants',
        value: String(entryCount),
        inline: true,
      },
      {
        name: isEnded ? 'Terminé' : 'Fin',
        value: `<t:${giveaway.ends_at}:F>\n<t:${giveaway.ends_at}:R>`,
        inline: true,
      },
      {
        name: 'Organisé par',
        value: `<@${giveaway.host_id}>`,
        inline: true,
      },
      {
        name: 'Condition',
        value: Number(giveaway.required_invites || 0) > 0
          ? `${giveaway.required_invites} invitation(s) active(s)`
          : 'Aucune',
        inline: true,
      },
    )
    .setFooter({ text: `Giveaway #${giveaway.id}` })
    .setTimestamp();

  if (isEnded) {
    embed.addFields({
      name: 'Gagnant(s) tiré(s)',
      value: winners.length ? formatMentions(winners) : 'Aucun participant éligible',
    });
  }
  if (giveaway.image) embed.setImage(giveaway.image);

  const components = isEnded ? [] : [
    new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId(`giveaway:join:${giveaway.id}`)
        .setLabel('Participer')
        .setEmoji('🎉')
        .setStyle(ButtonStyle.Primary),
    ),
  ];

  return { embeds: [embed], components };
}

function buildWinnerAnnouncement(giveaway, winners, reroll = false, reason = 'scheduled') {
  const title = reroll ? 'Nouveau tirage giveaway' : 'Résultat du giveaway';
  const description = winners.length
    ? `${formatMentions(winners)} remporte(nt) **${giveaway.prize}**.`
    : `Aucun participant éligible pour **${giveaway.prize}**.`;

  return {
    content: winners.length ? formatMentions(winners) : undefined,
    embeds: [
      new EmbedBuilder()
        .setColor(winners.length ? 0x57f287 : 0xed4245)
        .setTitle(title)
        .setDescription(truncate(description, LIMITS.EMBED_DESCRIPTION))
        .setFooter({ text: `Giveaway #${giveaway.id} • ${reason}` })
        .setTimestamp(),
    ],
  };
}

function pickWinners(userIds, winnersCount) {
  const unique = [...new Set(userIds.filter(Boolean))];
  for (let i = unique.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [unique[i], unique[j]] = [unique[j], unique[i]];
  }
  return unique.slice(0, Math.max(1, Number(winnersCount || 1)));
}

function parseWinnerIds(value) {
  try {
    const ids = JSON.parse(value || '[]');
    return Array.isArray(ids) ? ids : [];
  } catch {
    return [];
  }
}

function formatMentions(userIds) {
  return userIds.map((id) => `<@${id}>`).join(', ');
}

function nowSeconds() {
  return Math.floor(Date.now() / 1000);
}

function isHttpUrl(value) {
  try {
    const url = new URL(value);
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch {
    return false;
  }
}
