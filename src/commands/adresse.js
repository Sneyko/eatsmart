import {
  ChannelType,
  PermissionFlagsBits,
  SlashCommandBuilder,
} from 'discord.js';
import { buildAddressGeneratorPanel } from '../handlers/addressGenerator.js';
import { errorEmbed, successEmbed } from '../utils/embeds.js';

export const data = new SlashCommandBuilder()
  .setName('adresse')
  .setDescription("Générateur d'adresse de livraison")
  .setDMPermission(false)
  .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
  .addSubcommand((s) =>
    s
      .setName('panel')
      .setDescription("Envoyer le panel du générateur d'adresse")
      .addChannelOption((o) =>
        o
          .setName('channel')
          .setDescription('Salon cible')
          .setRequired(true)
          .addChannelTypes(ChannelType.GuildText),
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

  const sub = interaction.options.getSubcommand();
  if (sub === 'panel') return sendPanel(interaction);
  return interaction.reply({ embeds: [errorEmbed('Sous-commande inconnue.')], ephemeral: true });
}

async function sendPanel(interaction) {
  const channel = interaction.options.getChannel('channel', true);
  await channel.send(buildAddressGeneratorPanel());
  return interaction.reply({
    embeds: [successEmbed(`Générateur d'adresse envoyé dans <#${channel.id}>.`)],
    ephemeral: true,
  });
}
