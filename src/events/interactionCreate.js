import { Events } from 'discord.js';
import { logger } from '../config.js';
import { errorEmbed } from '../utils/embeds.js';
import { getTicketByChannel } from '../db/queries.js';
import {
  claimTicket,
  closeTicket,
  confirmCloseTicket,
  deleteTicket,
  handleAnswersModal,
  handleFeedbackComment,
  handleFeedbackRate,
  handlePanelButtonClick,
  reopenTicket,
} from '../handlers/tickets.js';
import { handleCreateModal, handleQuestionsModal } from '../commands/panel.js';

export const name = Events.InteractionCreate;

/**
 * @param {import('discord.js').Interaction} interaction
 */
export async function execute(interaction) {
  try {
    if (interaction.isChatInputCommand()) {
      const cmd = interaction.client.commands.get(interaction.commandName);
      if (!cmd) return;
      await cmd.execute(interaction);
      return;
    }
    if (interaction.isButton()) {
      return routeButton(interaction);
    }
    if (interaction.isModalSubmit()) {
      return routeModal(interaction);
    }
  } catch (err) {
    logger.error({ err, customId: interaction.customId, command: interaction.commandName }, 'Interaction error');
    const payload = { embeds: [errorEmbed('Une erreur est survenue. Réessaye, ou contacte un admin.')], ephemeral: true };
    try {
      if (interaction.deferred || interaction.replied) {
        await interaction.followUp(payload);
      } else {
        await interaction.reply(payload);
      }
    } catch {}
  }
}

async function routeButton(interaction) {
  const id = interaction.customId;
  if (id.startsWith('panel:open:')) {
    return handlePanelButtonClick(interaction, id.split(':')[2]);
  }
  if (id === 'ticket:close') {
    const ticket = getTicketByChannel(interaction.channel.id);
    if (!ticket) return interaction.reply({ embeds: [errorEmbed('Ticket introuvable.')], ephemeral: true });
    return confirmCloseTicket(interaction, ticket, null);
  }
  if (id === 'ticket:close-reason') {
    const { ActionRowBuilder, ModalBuilder, TextInputBuilder, TextInputStyle } = await import('discord.js');
    const modal = new ModalBuilder().setCustomId('ticket:close-reason-modal').setTitle('Fermer le ticket');
    modal.addComponents(
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId('reason')
          .setLabel('Raison')
          .setStyle(TextInputStyle.Paragraph)
          .setRequired(true)
          .setMaxLength(1000),
      ),
    );
    return interaction.showModal(modal);
  }
  if (id.startsWith('ticket:close-confirm')) {
    const parts = id.split(':');
    const reason = parts[2] ? decodeURIComponent(parts[2]) : null;
    const ticket = getTicketByChannel(interaction.channel.id);
    if (!ticket) return interaction.reply({ embeds: [errorEmbed('Ticket introuvable.')], ephemeral: true });
    await interaction.update({ content: 'Fermeture en cours…', embeds: [], components: [] });
    return closeTicket(interaction.client, ticket, { actorId: interaction.user.id, reason });
  }
  if (id === 'ticket:close-cancel') {
    return interaction.update({ content: 'Annulé.', embeds: [], components: [] });
  }
  if (id === 'ticket:claim') return claimTicket(interaction);
  if (id === 'ticket:reopen') return reopenTicket(interaction);
  if (id === 'ticket:delete') return deleteTicket(interaction);
  if (id.startsWith('fb:rate:')) {
    const [, , ticketId, rating] = id.split(':');
    return handleFeedbackRate(interaction, ticketId, Number(rating));
  }
}

async function routeModal(interaction) {
  const id = interaction.customId;
  if (id === 'panel:create') return handleCreateModal(interaction);
  if (id === 'panel:questions') return handleQuestionsModal(interaction);
  if (id.startsWith('panel:answers:')) {
    return handleAnswersModal(interaction, id.split(':')[2]);
  }
  if (id === 'ticket:close-reason-modal') {
    const reason = interaction.fields.getTextInputValue('reason');
    const ticket = getTicketByChannel(interaction.channel.id);
    if (!ticket) return interaction.reply({ embeds: [errorEmbed('Ticket introuvable.')], ephemeral: true });
    return confirmCloseTicket(interaction, ticket, reason);
  }
  if (id.startsWith('fb:comment:')) {
    return handleFeedbackComment(interaction, id.split(':')[2]);
  }
}
