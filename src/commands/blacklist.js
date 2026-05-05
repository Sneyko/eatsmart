import { EmbedBuilder, PermissionFlagsBits, SlashCommandBuilder } from 'discord.js';
import { addBlacklist, listBlacklist, removeBlacklist } from '../db/queries.js';
import { errorEmbed, successEmbed } from '../utils/embeds.js';

export const data = new SlashCommandBuilder()
  .setName('blacklist')
  .setDescription('Bloquer / débloquer des users de l’ouverture de tickets')
  .setDMPermission(false)
  .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
  .addSubcommand((s) =>
    s
      .setName('add')
      .setDescription('Blacklister un user')
      .addUserOption((o) => o.setName('user').setDescription('User').setRequired(true))
      .addStringOption((o) => o.setName('reason').setDescription('Raison')),
  )
  .addSubcommand((s) =>
    s
      .setName('remove')
      .setDescription('Retirer un user de la blacklist')
      .addUserOption((o) => o.setName('user').setDescription('User').setRequired(true)),
  )
  .addSubcommand((s) => s.setName('list').setDescription('Lister la blacklist'));

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
  const sub = interaction.options.getSubcommand();
  if (sub === 'add') {
    const user = interaction.options.getUser('user', true);
    const reason = interaction.options.getString('reason') || null;
    addBlacklist(interaction.guild.id, user.id, reason, interaction.user.id);
    return interaction.reply({
      embeds: [successEmbed(`<@${user.id}> blacklisté.${reason ? ` Raison : ${reason}` : ''}`)],
      ephemeral: true,
    });
  }
  if (sub === 'remove') {
    const user = interaction.options.getUser('user', true);
    const r = removeBlacklist(interaction.guild.id, user.id);
    if (r.changes === 0)
      return interaction.reply({ embeds: [errorEmbed('Pas blacklisté.')], ephemeral: true });
    return interaction.reply({
      embeds: [successEmbed(`<@${user.id}> retiré de la blacklist.`)],
      ephemeral: true,
    });
  }
  if (sub === 'list') {
    const rows = listBlacklist(interaction.guild.id);
    if (rows.length === 0)
      return interaction.reply({ embeds: [errorEmbed('Blacklist vide.')], ephemeral: true });
    const embed = new EmbedBuilder()
      .setColor(0xed4245)
      .setTitle(`Blacklist (${rows.length})`)
      .setDescription(rows.map((r) => `• <@${r.user_id}>${r.reason ? ` — ${r.reason}` : ''}`).join('\n'));
    return interaction.reply({ embeds: [embed], ephemeral: true });
  }
}
