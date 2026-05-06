import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChannelType,
  PermissionFlagsBits,
  SlashCommandBuilder,
} from 'discord.js';
import { ensureGuildConfig, updateRulesConfig } from '../db/queries.js';
import { invalidateGuildConfig } from '../utils/cache.js';
import { errorEmbed, successEmbed } from '../utils/embeds.js';
import { isAdmin } from '../utils/permissions.js';

export const data = new SlashCommandBuilder()
  .setName('rules')
  .setDescription("Système d'acceptation du règlement (auto-rôle)")
  .setDMPermission(false)
  .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
  .addSubcommand((s) =>
    s
      .setName('config')
      .setDescription('Configurer le rôle attribué après acceptation')
      .addRoleOption((o) =>
        o
          .setName('role')
          .setDescription('Rôle "membre validé" attribué à l\'acceptation')
          .setRequired(true),
      ),
  )
  .addSubcommand((s) =>
    s
      .setName('send')
      .setDescription('Envoyer le bouton de validation du règlement')
      .addChannelOption((o) =>
        o
          .setName('channel')
          .setDescription('Channel cible')
          .setRequired(true)
          .addChannelTypes(ChannelType.GuildText),
      )
      .addStringOption((o) =>
        o
          .setName('button_label')
          .setDescription('Texte du bouton (défaut : "J\'accepte le règlement")')
          .setMaxLength(80),
      ),
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
  if (!isAdmin(interaction.member)) {
    return interaction.reply({ embeds: [errorEmbed('Réservé aux admins.')], ephemeral: true });
  }
  const sub = interaction.options.getSubcommand();
  if (sub === 'config') return configCmd(interaction);
  if (sub === 'send') return sendCmd(interaction);
}

async function configCmd(interaction) {
  const role = interaction.options.getRole('role', true);
  ensureGuildConfig(interaction.guild.id);
  updateRulesConfig(interaction.guild.id, role.id);
  invalidateGuildConfig(interaction.guild.id);
  return interaction.reply({
    embeds: [
      successEmbed(
        `Rôle de validation configuré : <@&${role.id}>\n\nMaintenant utilise \`/rules send channel:#règlement\` pour poster le bouton.`,
      ),
    ],
    ephemeral: true,
  });
}

async function sendCmd(interaction) {
  const channel = interaction.options.getChannel('channel', true);
  const label = interaction.options.getString('button_label') || "J'accepte le règlement";

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId('rules:accept')
      .setLabel(label)
      .setEmoji('✅')
      .setStyle(ButtonStyle.Success),
  );

  await channel.send({ components: [row] });
  return interaction.reply({
    embeds: [successEmbed(`Bouton de validation envoyé dans <#${channel.id}>.`)],
    ephemeral: true,
  });
}
