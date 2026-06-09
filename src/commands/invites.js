import {
  ChannelType,
  EmbedBuilder,
  SlashCommandBuilder,
} from 'discord.js';
import {
  deleteInviteReward,
  getInviteStats,
  listAllInviteRewards,
  topInviteStats,
  upsertInviteReward,
} from '../db/queries.js';
import { syncInviteRewards } from '../handlers/invites.js';
import { errorEmbed, successEmbed } from '../utils/embeds.js';
import { isStaff } from '../utils/permissions.js';
import { truncate, LIMITS } from '../utils/validators.js';

export const data = new SlashCommandBuilder()
  .setName('invites')
  .setDescription('Compteur d’invitations actives et récompenses')
  .setDMPermission(false)
  .addSubcommand((s) =>
    s
      .setName('stats')
      .setDescription("Voir les invitations d'un membre")
      .addUserOption((o) =>
        o.setName('user').setDescription('Membre à consulter').setRequired(false),
      ),
  )
  .addSubcommand((s) =>
    s.setName('leaderboard').setDescription('Top invitations actives'),
  )
  .addSubcommandGroup((g) =>
    g
      .setName('config')
      .setDescription('Configurer les récompenses d’invitations')
      .addSubcommand((s) =>
        s
          .setName('set')
          .setDescription('Définir un palier de récompense')
          .addStringOption((o) =>
            o
              .setName('tier_name')
              .setDescription('Nom du palier')
              .setRequired(true)
              .setMaxLength(32),
          )
          .addIntegerOption((o) =>
            o
              .setName('threshold')
              .setDescription('Nombre d’invitations actives requis')
              .setRequired(true)
              .setMinValue(1)
              .setMaxValue(1000),
          )
          .addStringOption((o) =>
            o
              .setName('reward')
              .setDescription('Récompense donnée')
              .setRequired(true)
              .setMaxLength(256),
          )
          .addRoleOption((o) =>
            o.setName('role').setDescription('Rôle à ajouter quand le palier est atteint'),
          )
          .addChannelOption((o) =>
            o
              .setName('announce_channel')
              .setDescription('Salon où annoncer la récompense')
              .addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement),
          )
          .addIntegerOption((o) =>
            o
              .setName('position')
              .setDescription('Ordre d’affichage')
              .setMinValue(0)
              .setMaxValue(50),
          ),
      )
      .addSubcommand((s) =>
        s
          .setName('remove')
          .setDescription('Supprimer un palier')
          .addStringOption((o) =>
            o
              .setName('tier_name')
              .setDescription('Nom du palier')
              .setRequired(true)
              .setMaxLength(32),
          ),
      )
      .addSubcommand((s) =>
        s.setName('list').setDescription('Lister les paliers configurés'),
      ),
  )
  .addSubcommand((s) =>
    s
      .setName('sync')
      .setDescription('Attribuer les récompenses déjà atteintes à un membre')
      .addUserOption((o) =>
        o.setName('user').setDescription('Membre à synchroniser').setRequired(true),
      ),
  );

/**
 * @param {import('discord.js').ChatInputCommandInteraction} interaction
 */
export async function execute(interaction) {
  if (!interaction.guild) {
    return interaction.reply({ embeds: [errorEmbed('Commande serveur uniquement.')], ephemeral: true });
  }

  const group = interaction.options.getSubcommandGroup(false);
  const sub = interaction.options.getSubcommand();

  if (group === 'config') {
    if (!isStaff(interaction.member)) {
      return interaction.reply({ embeds: [errorEmbed('Réservé au staff.')], ephemeral: true });
    }
    if (sub === 'set') return setReward(interaction);
    if (sub === 'remove') return removeReward(interaction);
    if (sub === 'list') return listRewards(interaction);
  }

  if (sub === 'stats') return stats(interaction);
  if (sub === 'leaderboard') return leaderboard(interaction);
  if (sub === 'sync') return sync(interaction);

  return interaction.reply({ embeds: [errorEmbed('Sous-commande inconnue.')], ephemeral: true });
}

async function setReward(interaction) {
  const tierName = interaction.options.getString('tier_name', true).trim();
  const threshold = interaction.options.getInteger('threshold', true);
  const reward = interaction.options.getString('reward', true).trim();
  const role = interaction.options.getRole('role');
  const channel = interaction.options.getChannel('announce_channel');
  const position = interaction.options.getInteger('position') ?? 0;

  upsertInviteReward(
    interaction.guild.id,
    tierName,
    threshold,
    truncate(reward, 256),
    role?.id ?? null,
    channel?.id ?? null,
    position,
  );

  return interaction.reply({
    embeds: [
      successEmbed(
        `Palier **${tierName}** configuré : **${threshold} invitation(s) active(s)** → **${reward}**${
          role ? ` + ${role}` : ''
        }`,
      ),
    ],
    ephemeral: true,
  });
}

async function removeReward(interaction) {
  const tierName = interaction.options.getString('tier_name', true).trim();
  const result = deleteInviteReward(interaction.guild.id, tierName);
  if (result.changes === 0) {
    return interaction.reply({ embeds: [errorEmbed('Palier introuvable.')], ephemeral: true });
  }
  return interaction.reply({
    embeds: [successEmbed(`Palier **${tierName}** supprimé.`)],
    ephemeral: true,
  });
}

async function listRewards(interaction) {
  const rewards = listAllInviteRewards(interaction.guild.id);
  if (rewards.length === 0) {
    return interaction.reply({
      embeds: [errorEmbed('Aucun palier configuré.')],
      ephemeral: true,
    });
  }

  const embed = new EmbedBuilder()
    .setColor(0x8b5cf6)
    .setTitle('Paliers invitations')
    .setDescription(
      rewards.map((r) => {
        const role = r.role_id ? ` • rôle <@&${r.role_id}>` : '';
        const channel = r.announce_channel_id ? ` • annonce <#${r.announce_channel_id}>` : '';
        return `• **${r.tier_name}** : ${r.threshold} actives → ${r.reward_description}${role}${channel}`;
      }).join('\n'),
    );

  return interaction.reply({ embeds: [embed], ephemeral: true });
}

async function stats(interaction) {
  const user = interaction.options.getUser('user') || interaction.user;
  const data = getInviteStats(interaction.guild.id, user.id);
  const embed = new EmbedBuilder()
    .setColor(0x8b5cf6)
    .setAuthor({ name: user.username, iconURL: user.displayAvatarURL() })
    .setTitle('Invitations')
    .addFields(
      {
        name: 'Actives',
        value: String(data.active_invites || 0),
        inline: true,
      },
      {
        name: 'Total',
        value: String(data.total_invites || 0),
        inline: true,
      },
      {
        name: 'Ont quitté',
        value: String(data.left_invites || 0),
        inline: true,
      },
    );

  return interaction.reply({ embeds: [embed], ephemeral: true });
}

async function leaderboard(interaction) {
  const top = topInviteStats(interaction.guild.id, 10);
  const embed = new EmbedBuilder()
    .setColor(0x8b5cf6)
    .setTitle('Leaderboard invitations')
    .setDescription(
      top.length
        ? top
          .map((row, index) =>
            `${index + 1}. <@${row.inviter_id}> — **${row.active_invites}** actives (${row.total_invites} total)`,
          )
          .join('\n')
        : 'Aucune invitation comptabilisée pour le moment.',
    );

  return interaction.reply({ embeds: [embed], ephemeral: true });
}

async function sync(interaction) {
  if (!isStaff(interaction.member)) {
    return interaction.reply({ embeds: [errorEmbed('Réservé au staff.')], ephemeral: true });
  }

  const user = interaction.options.getUser('user', true);
  await interaction.deferReply({ ephemeral: true });
  const granted = await syncInviteRewards(interaction.guild, user.id);
  return interaction.editReply({
    embeds: [
      successEmbed(
        granted.length
          ? `Récompense(s) synchronisée(s) pour <@${user.id}> : ${granted.map((r) => r.tier_name).join(', ')}`
          : `Aucune nouvelle récompense à attribuer à <@${user.id}>.`,
      ),
    ],
  });
}
