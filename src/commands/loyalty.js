import { EmbedBuilder, PermissionFlagsBits, SlashCommandBuilder } from 'discord.js';
import {
  deleteLoyaltyTier,
  getUserOrderCount,
  listAllLoyaltyTiers,
  listLoyaltyTiers,
  topOrderUsers,
  upsertLoyaltyTier,
} from '../db/queries.js';
import { errorEmbed, successEmbed } from '../utils/embeds.js';
import { isStaff } from '../utils/permissions.js';
import { findTierForCount, syncLoyaltyRole } from '../handlers/loyalty.js';

export const data = new SlashCommandBuilder()
  .setName('loyalty')
  .setDescription('Système de fidélité (rôles automatiques par nombre de commandes)')
  .setDMPermission(false)
  .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
  .addSubcommandGroup((g) =>
    g
      .setName('config')
      .setDescription('Configurer les paliers')
      .addSubcommand((s) =>
        s
          .setName('set')
          .setDescription('Définir un palier')
          .addStringOption((o) =>
            o
              .setName('scope')
              .setDescription('Côté client ou cuistot')
              .setRequired(true)
              .addChoices(
                { name: 'Client', value: 'client' },
                { name: 'Cuistot', value: 'cuistot' },
              ),
          )
          .addStringOption((o) =>
            o
              .setName('tier_name')
              .setDescription('Nom du palier (ex: Fer, Bronze...)')
              .setRequired(true)
              .setMaxLength(32),
          )
          .addIntegerOption((o) =>
            o
              .setName('threshold')
              .setDescription('Nombre de commandes minimum')
              .setRequired(true)
              .setMinValue(0),
          )
          .addRoleOption((o) =>
            o.setName('role').setDescription('Rôle Discord à attribuer').setRequired(true),
          )
          .addIntegerOption((o) =>
            o
              .setName('position')
              .setDescription("Position d'affichage (0 = bas)")
              .setMinValue(0)
              .setMaxValue(20),
          ),
      )
      .addSubcommand((s) =>
        s
          .setName('remove')
          .setDescription('Supprimer un palier')
          .addStringOption((o) =>
            o
              .setName('scope')
              .setDescription('client ou cuistot')
              .setRequired(true)
              .addChoices(
                { name: 'Client', value: 'client' },
                { name: 'Cuistot', value: 'cuistot' },
              ),
          )
          .addStringOption((o) =>
            o.setName('tier_name').setDescription('Nom du palier à supprimer').setRequired(true),
          ),
      )
      .addSubcommand((s) =>
        s.setName('list').setDescription('Lister tous les paliers configurés'),
      ),
  )
  .addSubcommand((s) =>
    s
      .setName('stats')
      .setDescription("Voir le compteur et palier d'un user")
      .addUserOption((o) =>
        o.setName('user').setDescription('Utilisateur (toi par défaut)').setRequired(false),
      ),
  )
  .addSubcommand((s) =>
    s.setName('leaderboard').setDescription('Top 10 client + top 10 cuistot'),
  )
  .addSubcommand((s) =>
    s
      .setName('sync')
      .setDescription("Force la resynchronisation des rôles d'un user (admin only)")
      .addUserOption((o) => o.setName('user').setDescription('User à resync').setRequired(true)),
  );

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
  if (!isStaff(interaction.member)) {
    return interaction.reply({ embeds: [errorEmbed('Réservé au staff.')], ephemeral: true });
  }

  const group = interaction.options.getSubcommandGroup(false);
  const sub = interaction.options.getSubcommand();

  if (group === 'config') {
    if (sub === 'set') return setTier(interaction);
    if (sub === 'remove') return removeTier(interaction);
    if (sub === 'list') return listTiers(interaction);
  }
  if (sub === 'stats') return statsCmd(interaction);
  if (sub === 'leaderboard') return leaderboardCmd(interaction);
  if (sub === 'sync') return syncCmd(interaction);
}

async function setTier(interaction) {
  const scope = interaction.options.getString('scope', true);
  const tierName = interaction.options.getString('tier_name', true);
  const threshold = interaction.options.getInteger('threshold', true);
  const role = interaction.options.getRole('role', true);
  const position = interaction.options.getInteger('position') ?? 0;
  upsertLoyaltyTier(interaction.guild.id, scope, tierName, threshold, role.id, position);
  return interaction.reply({
    embeds: [
      successEmbed(
        `Palier **${tierName}** (${scope}) défini : à ${threshold} commande(s) → <@&${role.id}>`,
      ),
    ],
    ephemeral: true,
  });
}

async function removeTier(interaction) {
  const scope = interaction.options.getString('scope', true);
  const tierName = interaction.options.getString('tier_name', true);
  const r = deleteLoyaltyTier(interaction.guild.id, scope, tierName);
  if (r.changes === 0) {
    return interaction.reply({ embeds: [errorEmbed('Palier introuvable.')], ephemeral: true });
  }
  return interaction.reply({
    embeds: [successEmbed(`Palier **${tierName}** (${scope}) supprimé.`)],
    ephemeral: true,
  });
}

async function listTiers(interaction) {
  const all = listAllLoyaltyTiers(interaction.guild.id);
  if (all.length === 0) {
    return interaction.reply({
      embeds: [errorEmbed('Aucun palier configuré. Utilise `/loyalty config set` pour en créer.')],
      ephemeral: true,
    });
  }
  const grouped = { client: [], cuistot: [] };
  for (const t of all) grouped[t.scope].push(t);
  const fmt = (arr) =>
    arr.length
      ? arr.map((t) => `• **${t.tier_name}** : ${t.threshold} cmds → <@&${t.role_id}>`).join('\n')
      : '_aucun_';
  const embed = new EmbedBuilder()
    .setColor(0x5865f2)
    .setTitle('Paliers de fidélité')
    .addFields(
      { name: '🛒 Côté CLIENT', value: fmt(grouped.client) },
      { name: '👨‍🍳 Côté CUISTOT', value: fmt(grouped.cuistot) },
    );
  return interaction.reply({ embeds: [embed], ephemeral: true });
}

async function statsCmd(interaction) {
  const user = interaction.options.getUser('user') || interaction.user;
  const clientCount = getUserOrderCount(interaction.guild.id, user.id, 'client');
  const cuistotCount = getUserOrderCount(interaction.guild.id, user.id, 'cuistot');
  const clientTiers = listLoyaltyTiers(interaction.guild.id, 'client');
  const cuistotTiers = listLoyaltyTiers(interaction.guild.id, 'cuistot');
  const clientTier = findTierForCount(clientTiers, clientCount);
  const cuistotTier = findTierForCount(cuistotTiers, cuistotCount);

  const embed = new EmbedBuilder()
    .setColor(0x5865f2)
    .setAuthor({ name: user.username, iconURL: user.displayAvatarURL() })
    .addFields(
      {
        name: '🛒 En tant que client',
        value: `**${clientCount}** commande(s)\nPalier : ${
          clientTier ? `<@&${clientTier.role_id}> (${clientTier.tier_name})` : '_aucun_'
        }`,
        inline: true,
      },
      {
        name: '👨‍🍳 En tant que cuistot',
        value: `**${cuistotCount}** commande(s)\nPalier : ${
          cuistotTier ? `<@&${cuistotTier.role_id}> (${cuistotTier.tier_name})` : '_aucun_'
        }`,
        inline: true,
      },
    );
  return interaction.reply({ embeds: [embed], ephemeral: true });
}

async function leaderboardCmd(interaction) {
  const topClients = topOrderUsers(interaction.guild.id, 'client', 10);
  const topCuistots = topOrderUsers(interaction.guild.id, 'cuistot', 10);
  const embed = new EmbedBuilder()
    .setColor(0x5865f2)
    .setTitle('🏆 Leaderboard fidélité')
    .addFields(
      {
        name: '🛒 Top 10 clients',
        value: topClients.length
          ? topClients.map((u, i) => `${i + 1}. <@${u.user_id}> — ${u.count}`).join('\n')
          : '_aucun_',
        inline: true,
      },
      {
        name: '👨‍🍳 Top 10 cuistots',
        value: topCuistots.length
          ? topCuistots.map((u, i) => `${i + 1}. <@${u.user_id}> — ${u.count}`).join('\n')
          : '_aucun_',
        inline: true,
      },
    );
  return interaction.reply({ embeds: [embed], ephemeral: true });
}

async function syncCmd(interaction) {
  const user = interaction.options.getUser('user', true);
  await interaction.deferReply({ ephemeral: true });
  await syncLoyaltyRole(interaction.guild, user.id, 'client');
  await syncLoyaltyRole(interaction.guild, user.id, 'cuistot');
  return interaction.editReply({
    embeds: [successEmbed(`Rôles de <@${user.id}> resynchronisés.`)],
  });
}
