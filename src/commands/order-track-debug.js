import { EmbedBuilder, SlashCommandBuilder } from 'discord.js';
import { getTicketByChannel } from '../db/queries.js';
import { extractUberTrackingUrls } from '../utils/orderTracking.js';
import { readUberEatsTrackingWithBrowser } from '../utils/uberTrackingBrowser.js';
import { errorEmbed } from '../utils/embeds.js';
import { isStaff } from '../utils/permissions.js';
import { truncate } from '../utils/validators.js';

export const data = new SlashCommandBuilder()
  .setName('order-track-debug')
  .setDescription('Tester la lecture Playwright d’un suivi Uber Eats')
  .setDMPermission(false)
  .addStringOption((o) =>
    o
      .setName('url')
      .setDescription('Lien Uber Eats à tester')
      .setRequired(false)
      .setMaxLength(1500),
  )
  .addBooleanOption((o) =>
    o
      .setName('ticket')
      .setDescription('Tester le lien du ticket courant')
      .setRequired(false),
  )
  .addBooleanOption((o) =>
    o
      .setName('show_text')
      .setDescription('Afficher un extrait du texte visible lu par Playwright')
      .setRequired(false),
  );

/**
 * @param {import('discord.js').ChatInputCommandInteraction} interaction
 */
export async function execute(interaction) {
  if (!interaction.guild) {
    return interaction.reply({ embeds: [errorEmbed('Commande serveur uniquement.')], ephemeral: true });
  }
  if (!isStaff(interaction.member)) {
    return interaction.reply({ embeds: [errorEmbed('Réservé au staff.')], ephemeral: true });
  }

  const useTicket = interaction.options.getBoolean('ticket') ?? false;
  const showText = interaction.options.getBoolean('show_text') ?? false;
  let sourceText = interaction.options.getString('url')?.trim() || '';

  if (useTicket) {
    const ticket = getTicketByChannel(interaction.channel.id);
    if (!ticket) {
      return interaction.reply({ embeds: [errorEmbed('Ticket introuvable dans ce salon.')], ephemeral: true });
    }
    sourceText = ticket.order_tracking || sourceText;
  }

  const url = extractUberTrackingUrls(sourceText)[0];
  if (!url) {
    return interaction.reply({
      embeds: [errorEmbed('Indique un lien Uber Eats valide, ou utilise `ticket:true` dans un ticket envoyé.')],
      ephemeral: true,
    });
  }

  await interaction.deferReply({ ephemeral: true });
  const info = await readUberEatsTrackingWithBrowser(url);
  const embed = new EmbedBuilder()
    .setColor(info.readable ? 0x57f287 : 0xed4245)
    .setTitle('Debug suivi Uber Eats')
    .addFields(
      { name: 'Lisible', value: info.readable ? 'Oui' : 'Non', inline: true },
      { name: 'Source', value: info.source || 'browser', inline: true },
      { name: 'Raison', value: info.errorReason || 'aucune', inline: true },
      { name: 'ETA', value: info.etaLabel || (Number.isFinite(info.etaMinutes) ? `${info.etaMinutes} min` : 'non détectée'), inline: true },
      { name: 'Statut', value: info.statusText || 'non détecté', inline: true },
      { name: 'PIN', value: info.pinCode ? `\`${info.pinCode}\`` : 'non détecté', inline: true },
    )
    .setTimestamp();

  if (showText) {
    const sample = escapeCodeBlock(truncate(info.rawTextSample || 'Aucun texte visible récupéré.', 1000));
    embed.addFields({ name: 'Texte visible extrait', value: `\`\`\`\n${sample}\n\`\`\`` });
  }

  return interaction.editReply({ embeds: [embed] });
}

function escapeCodeBlock(value) {
  return String(value || '').replaceAll('```', "'''");
}
