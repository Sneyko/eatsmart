import { EmbedBuilder, PermissionFlagsBits, SlashCommandBuilder } from 'discord.js';
import {
  statsAvgRating,
  statsCount,
  statsTopStaff,
  topOrderUsers,
} from '../db/queries.js';
import { errorEmbed } from '../utils/embeds.js';

export const data = new SlashCommandBuilder()
  .setName('stats')
  .setDescription('Statistiques tickets du serveur')
  .setDMPermission(false)
  .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild);

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
  const counts = statsCount(interaction.guild.id) || {};
  const top = statsTopStaff(interaction.guild.id);
  const fb = statsAvgRating(interaction.guild.id) || {};

  const avgResp = counts.avg_response
    ? `${Math.round(counts.avg_response / 60)} min`
    : 'N/A';

  const topClients = topOrderUsers(interaction.guild.id, 'client', 5);
  const topCuistots = topOrderUsers(interaction.guild.id, 'cuistot', 5);

  const embed = new EmbedBuilder()
    .setColor(0x5865f2)
    .setTitle('Statistiques tickets')
    .addFields(
      { name: 'Ouverts', value: String(counts.open_count ?? 0), inline: true },
      { name: 'Fermés', value: String(counts.closed_count ?? 0), inline: true },
      { name: 'Temps de 1ʳᵉ réponse moyen', value: avgResp, inline: true },
      {
        name: 'Top staff (claim)',
        value: top.length ? top.map((t) => `<@${t.user_id}> — ${t.n}`).join('\n') : '—',
      },
      {
        name: 'Note moyenne',
        value: fb.n ? `${(fb.avg_rating || 0).toFixed(2)} / 5 (${fb.n} avis)` : '—',
      },
      {
        name: '🏆 Top clients (commandes terminées)',
        value: topClients.length
          ? topClients.map((u, i) => `${i + 1}. <@${u.user_id}> — ${u.count}`).join('\n')
          : '—',
      },
      {
        name: '👨‍🍳 Top cuistots',
        value: topCuistots.length
          ? topCuistots.map((u, i) => `${i + 1}. <@${u.user_id}> — ${u.count}`).join('\n')
          : '—',
      },
    )
    .setTimestamp();
  return interaction.reply({ embeds: [embed], ephemeral: true });
}
