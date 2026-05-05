import { SlashCommandBuilder } from 'discord.js';
import { errorEmbed } from '../utils/embeds.js';
import { getTicketByChannel } from '../db/queries.js';
import {
  addUserToTicket,
  changeOwner,
  claimTicket,
  confirmCloseTicket,
  removeUserFromTicket,
  renameTicket,
  snoozeTicketCmd,
  transferTicket,
} from '../handlers/tickets.js';

export const data = new SlashCommandBuilder()
  .setName('ticket')
  .setDescription('Actions sur le ticket courant')
  .setDMPermission(false)
  .addSubcommand((s) =>
    s
      .setName('close')
      .setDescription('Fermer ce ticket')
      .addStringOption((o) => o.setName('reason').setDescription('Raison')),
  )
  .addSubcommand((s) => s.setName('claim').setDescription('Claim ce ticket'))
  .addSubcommand((s) =>
    s
      .setName('add')
      .setDescription('Ajouter un user au ticket')
      .addUserOption((o) => o.setName('user').setDescription('User').setRequired(true)),
  )
  .addSubcommand((s) =>
    s
      .setName('remove')
      .setDescription('Retirer un user du ticket')
      .addUserOption((o) => o.setName('user').setDescription('User').setRequired(true)),
  )
  .addSubcommand((s) =>
    s
      .setName('rename')
      .setDescription('Renommer le channel')
      .addStringOption((o) => o.setName('name').setDescription('Nouveau nom').setRequired(true).setMaxLength(100)),
  )
  .addSubcommand((s) =>
    s
      .setName('transfer')
      .setDescription('Transférer le ticket à un autre staff')
      .addUserOption((o) => o.setName('user').setDescription('Staff cible').setRequired(true)),
  )
  .addSubcommand((s) =>
    s
      .setName('owner')
      .setDescription('Changer l’owner du ticket (admin)')
      .addUserOption((o) => o.setName('user').setDescription('Nouveau owner').setRequired(true)),
  )
  .addSubcommand((s) =>
    s
      .setName('snooze')
      .setDescription("Met en pause l'autoclose pour X heures")
      .addIntegerOption((o) =>
        o
          .setName('hours')
          .setDescription('Durée en heures')
          .setRequired(true)
          .setMinValue(1)
          .setMaxValue(168),
      ),
  );

/**
 * @param {import('discord.js').ChatInputCommandInteraction} interaction
 */
export async function execute(interaction) {
  const ticket = getTicketByChannel(interaction.channel.id);
  const sub = interaction.options.getSubcommand();
  if (!ticket && sub !== 'claim') {
    return interaction.reply({
      embeds: [errorEmbed('Cette commande ne s’utilise que dans un ticket.')],
      ephemeral: true,
    });
  }
  if (sub === 'close') {
    return confirmCloseTicket(interaction, ticket, interaction.options.getString('reason'));
  }
  if (sub === 'claim') return claimTicket(interaction);
  if (sub === 'add') return addUserToTicket(interaction, interaction.options.getUser('user', true));
  if (sub === 'remove') return removeUserFromTicket(interaction, interaction.options.getUser('user', true));
  if (sub === 'rename') return renameTicket(interaction, interaction.options.getString('name', true));
  if (sub === 'transfer') return transferTicket(interaction, interaction.options.getUser('user', true));
  if (sub === 'owner') return changeOwner(interaction, interaction.options.getUser('user', true));
  if (sub === 'snooze') return snoozeTicketCmd(interaction, interaction.options.getInteger('hours', true));
}
