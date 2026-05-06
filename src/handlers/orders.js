import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
} from 'discord.js';
import { logger } from '../config.js';
import { errorEmbed, infoEmbed, successEmbed } from '../utils/embeds.js';
import { isAdmin, isStaff } from '../utils/permissions.js';
import { truncate } from '../utils/validators.js';
import {
  getTicketByChannel,
  incrementUserOrderCount,
  updateOrderState,
} from '../db/queries.js';
import { closeTicket } from './tickets.js';

/**
 * Construit la rangée d'actions cuistot. Le rendu est public mais les
 * checks de permission sont faits au runtime à chaque clic.
 * @param {object} ticket
 */
export function orderActionsRow(ticket) {
  const state = ticket.order_state || 'none';
  if (state === 'none' || state === 'sent') {
    return new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId('order:send')
        .setLabel(state === 'sent' ? 'Modifier envoi' : 'Envoyer commande')
        .setEmoji('📤')
        .setStyle(ButtonStyle.Primary),
      new ButtonBuilder()
        .setCustomId('order:complete')
        .setLabel('Commande terminée')
        .setEmoji('✅')
        .setStyle(ButtonStyle.Success)
        .setDisabled(state !== 'sent'),
      new ButtonBuilder()
        .setCustomId('order:cancel')
        .setLabel('Commande annulée')
        .setEmoji('❌')
        .setStyle(ButtonStyle.Danger),
    );
  }
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId('order:validate-close')
      .setLabel('Valider la clôture')
      .setEmoji('🔓')
      .setStyle(ButtonStyle.Secondary),
  );
}

/**
 * Construit l'embed visible par tous, qui résume l'état de la commande.
 * @param {object} ticket
 * @param {string} cuistotId
 */
export function orderStateEmbed(ticket, cuistotId) {
  const state = ticket.order_state || 'none';
  const colors = {
    none: 0x95a5a6,
    sent: 0x3498db,
    completed: 0x57f287,
    cancelled: 0xed4245,
  };
  const titles = {
    none: '🍴 Commande prise en charge',
    sent: '📤 Commande envoyée',
    completed: '✅ Commande terminée',
    cancelled: '❌ Commande annulée',
  };
  const embed = new EmbedBuilder()
    .setColor(colors[state])
    .setTitle(titles[state])
    .addFields({ name: 'Cuistot', value: `<@${cuistotId}>`, inline: true });

  if (state === 'sent' || state === 'completed') {
    if (ticket.order_price) {
      embed.addFields({ name: '💰 Prix payé', value: ticket.order_price, inline: true });
    }
    if (ticket.order_tracking) {
      embed.addFields({
        name: '🔗 Lien(s) de suivi',
        value: truncate(ticket.order_tracking, 1024),
      });
    }
  }
  if (state === 'cancelled' && ticket.order_cancel_reason) {
    embed.addFields({
      name: "Raison de l'annulation",
      value: truncate(ticket.order_cancel_reason, 1024),
    });
  }
  if (state === 'completed') {
    embed.setDescription('Ta commande a été livrée. Un admin va clôturer le ticket dans peu de temps.');
  }
  if (state === 'cancelled') {
    embed.setDescription('Le ticket sera clôturé par un admin dans peu de temps.');
  }
  embed.setTimestamp();
  return embed;
}

/**
 * Édite le message d'état existant ou en poste un nouveau si introuvable.
 * @param {import('discord.js').TextChannel} channel
 * @param {object} ticket
 * @param {string} cuistotId
 */
async function upsertStatusMessage(channel, ticket, cuistotId) {
  const embed = orderStateEmbed(ticket, cuistotId);
  const components = [orderActionsRow(ticket)];
  if (ticket.order_status_message_id) {
    try {
      const msg = await channel.messages.fetch(ticket.order_status_message_id);
      await msg.edit({ embeds: [embed], components });
      return msg;
    } catch {
      // Message effacé : on en recrée un.
    }
  }
  const msg = await channel.send({ embeds: [embed], components });
  updateOrderState(ticket.id, {
    order_state: ticket.order_state || 'none',
    order_status_message_id: msg.id,
  });
  return msg;
}

/**
 * Appelé depuis claimTicket : initialise l'état et poste le 1er menu.
 */
export async function initOrderOnClaim(channel, ticket, cuistotId) {
  if (!ticket.order_state || ticket.order_state === 'none') {
    updateOrderState(ticket.id, { order_state: 'none' });
    ticket.order_state = 'none';
  }
  await upsertStatusMessage(channel, ticket, cuistotId);
}

/**
 * Bouton "Envoyer commande" → ouvre un modal Prix + Tracking.
 */
export async function handleSendOrder(interaction) {
  const ticket = getTicketByChannel(interaction.channel.id);
  if (!ticket) return interaction.reply({ embeds: [errorEmbed('Ticket introuvable.')], ephemeral: true });
  if (!isStaff(interaction.member)) {
    return interaction.reply({ embeds: [errorEmbed('Réservé au staff.')], ephemeral: true });
  }
  if (!ticket.claimed_by) {
    return interaction.reply({ embeds: [errorEmbed('Le ticket doit être claim avant.')], ephemeral: true });
  }
  if (interaction.user.id !== ticket.claimed_by && !isAdmin(interaction.member)) {
    return interaction.reply({
      embeds: [errorEmbed(`Seul <@${ticket.claimed_by}> peut gérer cette commande.`)],
      ephemeral: true,
    });
  }
  const modal = new ModalBuilder().setCustomId('order:send-modal').setTitle('Envoyer la commande');
  modal.addComponents(
    new ActionRowBuilder().addComponents(
      new TextInputBuilder()
        .setCustomId('price')
        .setLabel('Prix payé par le client')
        .setStyle(TextInputStyle.Short)
        .setRequired(true)
        .setMaxLength(50)
        .setValue(ticket.order_price || '')
        .setPlaceholder('Ex : 12.50 €'),
    ),
    new ActionRowBuilder().addComponents(
      new TextInputBuilder()
        .setCustomId('tracking')
        .setLabel('Lien(s) de suivi UberEats')
        .setStyle(TextInputStyle.Paragraph)
        .setRequired(true)
        .setMaxLength(1500)
        .setValue(ticket.order_tracking || '')
        .setPlaceholder('Colle ici le ou les liens de suivi'),
    ),
  );
  await interaction.showModal(modal);
}

/**
 * Soumission du modal Envoyer commande.
 */
export async function handleSendOrderModal(interaction) {
  const ticket = getTicketByChannel(interaction.channel.id);
  if (!ticket) return interaction.reply({ embeds: [errorEmbed('Ticket introuvable.')], ephemeral: true });
  const price = interaction.fields.getTextInputValue('price').trim();
  const tracking = interaction.fields.getTextInputValue('tracking').trim();

  updateOrderState(ticket.id, {
    order_state: 'sent',
    order_price: price,
    order_tracking: tracking,
  });
  ticket.order_state = 'sent';
  ticket.order_price = price;
  ticket.order_tracking = tracking;

  await upsertStatusMessage(interaction.channel, ticket, ticket.claimed_by);
  return interaction.reply({
    embeds: [successEmbed("Commande envoyée. Le client voit l'état mis à jour.")],
    ephemeral: true,
  });
}

/**
 * Bouton "Commande terminée" → passe le channel en read-only.
 */
export async function handleCompleteOrder(interaction) {
  const ticket = getTicketByChannel(interaction.channel.id);
  if (!ticket) return interaction.reply({ embeds: [errorEmbed('Ticket introuvable.')], ephemeral: true });
  if (!isStaff(interaction.member)) {
    return interaction.reply({ embeds: [errorEmbed('Réservé au staff.')], ephemeral: true });
  }
  if (interaction.user.id !== ticket.claimed_by && !isAdmin(interaction.member)) {
    return interaction.reply({
      embeds: [errorEmbed('Seul le cuistot ayant claim peut faire ça.')],
      ephemeral: true,
    });
  }
  if (ticket.order_state !== 'sent') {
    return interaction.reply({
      embeds: [errorEmbed('Tu dois d\'abord "Envoyer commande" avant de la terminer.')],
      ephemeral: true,
    });
  }

  updateOrderState(ticket.id, { order_state: 'completed' });
  ticket.order_state = 'completed';

  await lockChannelReadOnly(interaction.channel, ticket);
  await upsertStatusMessage(interaction.channel, ticket, ticket.claimed_by);
  return interaction.reply({
    embeds: [successEmbed('Commande terminée. Ticket en read-only. Un admin doit valider la clôture.')],
    ephemeral: true,
  });
}

/**
 * Bouton "Commande annulée" → modal raison.
 */
export async function handleCancelOrder(interaction) {
  const ticket = getTicketByChannel(interaction.channel.id);
  if (!ticket) return interaction.reply({ embeds: [errorEmbed('Ticket introuvable.')], ephemeral: true });
  if (!isStaff(interaction.member)) {
    return interaction.reply({ embeds: [errorEmbed('Réservé au staff.')], ephemeral: true });
  }
  if (ticket.claimed_by && interaction.user.id !== ticket.claimed_by && !isAdmin(interaction.member)) {
    return interaction.reply({
      embeds: [errorEmbed('Seul le cuistot ayant claim peut faire ça.')],
      ephemeral: true,
    });
  }
  const modal = new ModalBuilder().setCustomId('order:cancel-modal').setTitle('Annuler la commande');
  modal.addComponents(
    new ActionRowBuilder().addComponents(
      new TextInputBuilder()
        .setCustomId('reason')
        .setLabel("Raison de l'annulation")
        .setStyle(TextInputStyle.Paragraph)
        .setRequired(true)
        .setMaxLength(1000)
        .setPlaceholder('Pourquoi la commande est annulée ?'),
    ),
  );
  await interaction.showModal(modal);
}

/**
 * Soumission du modal Annuler commande.
 */
export async function handleCancelOrderModal(interaction) {
  const ticket = getTicketByChannel(interaction.channel.id);
  if (!ticket) return interaction.reply({ embeds: [errorEmbed('Ticket introuvable.')], ephemeral: true });
  const reason = interaction.fields.getTextInputValue('reason').trim();

  updateOrderState(ticket.id, {
    order_state: 'cancelled',
    order_cancel_reason: reason,
  });
  ticket.order_state = 'cancelled';
  ticket.order_cancel_reason = reason;

  await lockChannelReadOnly(interaction.channel, ticket);
  await upsertStatusMessage(interaction.channel, ticket, ticket.claimed_by || interaction.user.id);
  return interaction.reply({
    embeds: [successEmbed('Commande annulée. Ticket en read-only. Un admin doit valider la clôture.')],
    ephemeral: true,
  });
}

/**
 * Bouton "Valider la clôture" : admins uniquement.
 * Ferme le ticket et incrémente les compteurs SI state === 'completed'.
 */
export async function handleValidateClose(interaction) {
  const ticket = getTicketByChannel(interaction.channel.id);
  if (!ticket) return interaction.reply({ embeds: [errorEmbed('Ticket introuvable.')], ephemeral: true });
  if (!isAdmin(interaction.member)) {
    return interaction.reply({ embeds: [errorEmbed('Réservé aux admins.')], ephemeral: true });
  }
  if (ticket.order_state !== 'completed' && ticket.order_state !== 'cancelled') {
    return interaction.reply({
      embeds: [errorEmbed('La commande doit être terminée ou annulée avant.')],
      ephemeral: true,
    });
  }

  if (ticket.order_state === 'completed') {
    incrementUserOrderCount(interaction.guild.id, ticket.owner_id, 'client');
    if (ticket.claimed_by) {
      incrementUserOrderCount(interaction.guild.id, ticket.claimed_by, 'cuistot');
    }
  }

  await interaction.reply({
    embeds: [infoEmbed('Clôture validée. Génération du transcript et fermeture en cours…')],
    ephemeral: true,
  });
  return closeTicket(interaction.client, ticket, {
    actorId: interaction.user.id,
    reason:
      ticket.order_state === 'completed'
        ? "Commande terminée et validée par l'admin."
        : `Commande annulée. Raison : ${ticket.order_cancel_reason || 'non précisée'}`,
  });
}

/**
 * Verrouille l'écriture dans le channel pour le client et le cuistot.
 * Les admins (Manage Guild) gardent l'écriture via leurs perms guilde.
 */
async function lockChannelReadOnly(channel, ticket) {
  try {
    await channel.permissionOverwrites.edit(ticket.owner_id, { SendMessages: false });
  } catch (err) {
    logger.debug({ err }, 'lockChannelReadOnly: owner overwrite failed');
  }
  if (ticket.claimed_by) {
    try {
      await channel.permissionOverwrites.edit(ticket.claimed_by, { SendMessages: false });
    } catch (err) {
      logger.debug({ err }, 'lockChannelReadOnly: cuistot overwrite failed');
    }
  }
}
