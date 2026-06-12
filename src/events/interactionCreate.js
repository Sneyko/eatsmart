import {
  ActionRowBuilder,
  Events,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
} from 'discord.js';
import { logger } from '../config.js';
import { errorEmbed } from '../utils/embeds.js';
import { getTicketByChannel } from '../db/queries.js';
import {
  claimTicket,
  closeTicket,
  confirmCloseTicket,
  consumeCloseReason,
  deleteTicket,
  handleAnswersModal,
  handleFeedbackComment,
  handleFeedbackRate,
  handlePanelButtonClick,
  reopenTicket,
} from '../handlers/tickets.js';
import {
  handleCreateModal,
  handleImportModal,
  handlePlaceholdersModal,
  handleQuestionsModal,
} from '../commands/panel.js';
import {
  handleCancelOrder,
  handleCancelOrderModal,
  handleCompleteOrder,
  handleManualEta,
  handleManualEtaModal,
  handleSendOrder,
  handleSendOrderModal,
  handleValidateClose,
} from '../handlers/orders.js';
import { handleAcceptRules } from '../handlers/rules.js';
import {
  handleAddressGeneratorButton,
  handleAddressGeneratorModal,
  handleAddressRetryButton,
} from '../handlers/addressGenerator.js';
import { handleGiveawayJoin } from '../handlers/giveaways.js';

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
    if (interaction.isStringSelectMenu()) {
      return routeSelect(interaction);
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
  if (id.startsWith('ticket:close-confirm:')) {
    const ticketId = Number(id.split(':')[2]);
    const ticket = getTicketByChannel(interaction.channel.id);
    if (!ticket || ticket.id !== ticketId) {
      return interaction.reply({ embeds: [errorEmbed('Ticket introuvable.')], ephemeral: true });
    }
    const reason = consumeCloseReason(ticket.id);
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
  if (id === 'order:send') return handleSendOrder(interaction);
  if (id === 'order:complete') return handleCompleteOrder(interaction);
  if (id === 'order:cancel') return handleCancelOrder(interaction);
  if (id === 'order:validate-close') return handleValidateClose(interaction);
  if (id === 'order:manual-eta') return handleManualEta(interaction);
  if (id === 'rules:accept') return handleAcceptRules(interaction);
  if (id === 'address:open') return handleAddressGeneratorButton(interaction);
  if (id === 'address:retry') return handleAddressRetryButton(interaction);
  if (id.startsWith('giveaway:join:')) return handleGiveawayJoin(interaction, id.split(':')[2]);
}

async function routeSelect(interaction) {
  const id = interaction.customId;
  if (id.startsWith('panel:select:')) {
    const buttonId = interaction.values[0];
    return handlePanelButtonClick(interaction, buttonId);
  }
}

async function routeModal(interaction) {
  const id = interaction.customId;
  if (id.startsWith('panel:create')) return handleCreateModal(interaction);
  if (id === 'panel:questions') return handleQuestionsModal(interaction);
  if (id === 'panel:placeholders') return handlePlaceholdersModal(interaction);
  if (id === 'panel:import') return handleImportModal(interaction);
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
  if (id === 'order:send-modal') return handleSendOrderModal(interaction);
  if (id === 'order:cancel-modal') return handleCancelOrderModal(interaction);
  if (id === 'order:manual-eta-modal') return handleManualEtaModal(interaction);
  if (id === 'address:generate') return handleAddressGeneratorModal(interaction);
}
