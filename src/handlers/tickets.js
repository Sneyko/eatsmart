import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChannelType,
  EmbedBuilder,
  ModalBuilder,
  PermissionFlagsBits,
  StringSelectMenuBuilder,
  StringSelectMenuOptionBuilder,
  TextInputBuilder,
  TextInputStyle,
} from 'discord.js';
import { logger } from '../config.js';
import { getCachedGuildConfig } from '../utils/cache.js';
import { applyVars, buildChannelName, LIMITS, truncate } from '../utils/validators.js';
import { isStaff, isAdmin } from '../utils/permissions.js';
import { errorEmbed, infoEmbed, successEmbed } from '../utils/embeds.js';
import {
  countOpenTickets,
  countRecentTicketsByUser,
  createTicket,
  getButton,
  getPanel,
  getTicketByChannel,
  getTicketById,
  insertFeedback,
  isBlacklisted,
  logAction,
  nextTicketNumber,
  setFirstResponse,
  setTicketClaimed,
  setTicketOwner,
  setTicketStatus,
  snoozeTicket,
  touchTicket,
  updateFeedbackComment,
} from '../db/queries.js';
import { cloneAttachment, generateTranscript } from './transcripts.js';

const pendingCloseReasons = new Map();

setInterval(() => {
  const now = Date.now();
  for (const [k, v] of pendingCloseReasons) {
    if (v.expiresAt < now) pendingCloseReasons.delete(k);
  }
}, 5 * 60 * 1000).unref?.();

/**
 * Récupère et purge la raison stockée pour la confirmation de fermeture.
 * @param {number} ticketId
 * @returns {string|null}
 */
export function consumeCloseReason(ticketId) {
  const entry = pendingCloseReasons.get(ticketId);
  pendingCloseReasons.delete(ticketId);
  return entry?.reason ?? null;
}

/**
 * Construit les rangées de boutons d'un ticket ouvert.
 * Retourne un tableau : [user_row, staff_row] pour séparer visuellement
 * les actions générales (close) des actions staff (claim).
 * @returns {ActionRowBuilder[]}
 */
export function ticketActionRow() {
  const userRow = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId('ticket:close')
      .setLabel('Fermer')
      .setEmoji('🔒')
      .setStyle(ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId('ticket:close-reason')
      .setLabel('Fermer avec raison')
      .setEmoji('📝')
      .setStyle(ButtonStyle.Secondary),
  );
  const staffRow = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId('ticket:claim')
      .setLabel('Prendre en charge')
      .setEmoji('🛡️')
      .setStyle(ButtonStyle.Primary),
  );
  return [userRow, staffRow];
}

/**
 * Construit la rangée [Reopen] / [Delete] proposée après une fermeture.
 */
export function closedActionRow() {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId('ticket:reopen')
      .setLabel('Rouvrir')
      .setEmoji('🔓')
      .setStyle(ButtonStyle.Success),
    new ButtonBuilder()
      .setCustomId('ticket:delete')
      .setLabel('Supprimer')
      .setEmoji('🗑️')
      .setStyle(ButtonStyle.Danger),
  );
}

/**
 * Construit l'embed et les composants d'un panel envoyés dans un channel public.
 * Choisit boutons ou dropdown selon `panel.display_mode`.
 * @param {object} panel
 * @param {object[]} buttons
 */
export function buildPanelMessage(panel, buttons) {
  const embed = new EmbedBuilder()
    .setColor(panel.color || 0x5865f2)
    .setTitle(truncate(panel.title, LIMITS.EMBED_TITLE));
  if (panel.description) embed.setDescription(truncate(panel.description, LIMITS.EMBED_DESCRIPTION));
  if (panel.image) embed.setImage(panel.image);
  if (panel.thumbnail) embed.setThumbnail(panel.thumbnail);

  const components = [];
  if (buttons.length === 0) return { embeds: [embed], components };

  if (panel.display_mode === 'select') {
    const placeholder =
      buttons.find((b) => b.placeholder_text)?.placeholder_text ||
      'Sélectionnez une option pour ouvrir un ticket';
    const select = new StringSelectMenuBuilder()
      .setCustomId(`panel:select:${panel.id}`)
      .setPlaceholder(truncate(placeholder, 150))
      .setMinValues(1)
      .setMaxValues(1);
    for (const b of buttons.slice(0, 25)) {
      const opt = new StringSelectMenuOptionBuilder()
        .setLabel(truncate(b.label, LIMITS.BUTTON_LABEL))
        .setValue(String(b.id));
      if (b.description) opt.setDescription(truncate(b.description, 100));
      if (b.emoji) {
        try {
          opt.setEmoji(b.emoji);
        } catch {}
      }
      select.addOptions(opt);
    }
    components.push(new ActionRowBuilder().addComponents(select));
    return { embeds: [embed], components };
  }

  const row = new ActionRowBuilder();
  for (const b of buttons.slice(0, 5)) {
    const btn = new ButtonBuilder()
      .setCustomId(`panel:open:${b.id}`)
      .setLabel(truncate(b.label, LIMITS.BUTTON_LABEL))
      .setStyle(b.style ?? ButtonStyle.Primary);
    if (b.emoji) {
      try {
        btn.setEmoji(b.emoji);
      } catch {}
    }
    row.addComponents(btn);
  }
  components.push(row);
  return { embeds: [embed], components };
}

/**
 * Gère le clic sur un bouton de panel : ouvre directement le ticket
 * ou affiche un modal de questions si le bouton en a.
 * @param {import('discord.js').ButtonInteraction} interaction
 * @param {string} buttonId
 */
export async function handlePanelButtonClick(interaction, buttonId) {
  const cfg = getCachedGuildConfig(interaction.guild.id);
  if (isBlacklisted(interaction.guild.id, interaction.user.id)) {
    return interaction.reply({
      embeds: [errorEmbed('Tu es blacklisté et ne peux pas ouvrir de ticket.')],
      ephemeral: true,
    });
  }
  if (cfg.cooldown_max_tickets > 0) {
    const windowMin = cfg.cooldown_window_minutes || 60;
    const windowSec = windowMin * 60;
    const recent = countRecentTicketsByUser(interaction.guild.id, interaction.user.id, windowSec);
    if (recent >= cfg.cooldown_max_tickets) {
      return interaction.reply({
        embeds: [
          errorEmbed(
            `Limite de ${cfg.cooldown_max_tickets} tickets par ${windowMin} min atteinte. Réessaye plus tard.`,
          ),
        ],
        ephemeral: true,
      });
    }
  }
  const limit = cfg.max_open_per_user ?? 1;
  if (limit > 0 && countOpenTickets(interaction.guild.id, interaction.user.id) >= limit) {
    return interaction.reply({
      embeds: [errorEmbed(`Tu as déjà ${limit} ticket(s) ouvert(s). Ferme-les avant d'en ouvrir un nouveau.`)],
      ephemeral: true,
    });
  }
  const button = getButton(Number(buttonId));
  if (!button) {
    return interaction.reply({ embeds: [errorEmbed('Bouton introuvable.')], ephemeral: true });
  }

  let questions = [];
  try {
    questions = JSON.parse(button.questions || '[]');
  } catch {
    questions = [];
  }
  if (questions.length > 0) {
    const modal = new ModalBuilder()
      .setCustomId(`panel:answers:${button.id}`)
      .setTitle(truncate(`Ouvrir un ticket — ${button.label}`, 45));
    questions.slice(0, 5).forEach((q, i) => {
      const input = new TextInputBuilder()
        .setCustomId(`q${i}`)
        .setLabel(truncate(q.label || `Question ${i + 1}`, 45))
        .setStyle(q.long ? TextInputStyle.Paragraph : TextInputStyle.Short)
        .setRequired(q.required !== false)
        .setMaxLength(LIMITS.MODAL_INPUT);
      if (q.placeholder) input.setPlaceholder(truncate(q.placeholder, 100));
      modal.addComponents(new ActionRowBuilder().addComponents(input));
    });
    return interaction.showModal(modal);
  }

  await interaction.deferReply({ ephemeral: true });
  try {
    const channel = await openTicket(interaction, button, []);
    await interaction.editReply({
      embeds: [successEmbed(`Ticket créé : <#${channel.id}>`)],
    });
  } catch (err) {
    logger.error({ err }, 'Failed to open ticket');
    await interaction.editReply({
      embeds: [errorEmbed('Impossible de créer le ticket. Vérifie la config (catégorie, permissions).')],
    });
  }
}

/**
 * Soumission du modal de questions : ouvre le ticket avec les réponses postées en embed.
 * @param {import('discord.js').ModalSubmitInteraction} interaction
 * @param {string} buttonId
 */
export async function handleAnswersModal(interaction, buttonId) {
  const button = getButton(Number(buttonId));
  if (!button) {
    return interaction.reply({ embeds: [errorEmbed('Bouton introuvable.')], ephemeral: true });
  }
  let questions = [];
  try {
    questions = JSON.parse(button.questions || '[]');
  } catch {}
  const answers = questions.slice(0, 5).map((q, i) => ({
    label: q.label || `Question ${i + 1}`,
    value: interaction.fields.getTextInputValue(`q${i}`) || '—',
  }));
  await interaction.deferReply({ ephemeral: true });
  try {
    const channel = await openTicket(interaction, button, answers);
    await interaction.editReply({
      embeds: [successEmbed(`Ticket créé : <#${channel.id}>`)],
    });
  } catch (err) {
    logger.error({ err }, 'Failed to open ticket via modal');
    await interaction.editReply({
      embeds: [errorEmbed('Impossible de créer le ticket. Vérifie la config (catégorie, permissions).')],
    });
  }
}

/**
 * Crée le channel privé, insère le ticket en DB, poste le message d'ouverture.
 * @returns {Promise<import('discord.js').TextChannel>}
 */
async function openTicket(interaction, button, answers) {
  const guild = interaction.guild;
  const cfg = getCachedGuildConfig(guild.id);
  const member = interaction.member;

  let supportRoles = [];
  try {
    supportRoles = JSON.parse(button.support_role_ids || '[]');
  } catch {}
  if (supportRoles.length === 0) {
    try {
      supportRoles = JSON.parse(cfg.support_role_ids || '[]');
    } catch {}
  }

  const number = nextTicketNumber(guild.id);
  const name = buildChannelName(button.name_template || 'ticket-{username}-{number}', {
    user: member,
    guild,
    number,
  });

  const overwrites = [
    {
      id: guild.roles.everyone.id,
      deny: [PermissionFlagsBits.ViewChannel],
    },
    {
      id: member.id,
      allow: [
        PermissionFlagsBits.ViewChannel,
        PermissionFlagsBits.SendMessages,
        PermissionFlagsBits.ReadMessageHistory,
        PermissionFlagsBits.AttachFiles,
        PermissionFlagsBits.EmbedLinks,
      ],
    },
    {
      id: guild.client.user.id,
      allow: [
        PermissionFlagsBits.ViewChannel,
        PermissionFlagsBits.SendMessages,
        PermissionFlagsBits.ReadMessageHistory,
        PermissionFlagsBits.ManageChannels,
        PermissionFlagsBits.ManageMessages,
        PermissionFlagsBits.EmbedLinks,
        PermissionFlagsBits.AttachFiles,
      ],
    },
    ...supportRoles.map((r) => ({
      id: r,
      allow: [
        PermissionFlagsBits.ViewChannel,
        PermissionFlagsBits.SendMessages,
        PermissionFlagsBits.ReadMessageHistory,
        PermissionFlagsBits.ManageMessages,
        PermissionFlagsBits.EmbedLinks,
        PermissionFlagsBits.AttachFiles,
      ],
    })),
  ];

  const channel = await guild.channels.create({
    name,
    type: ChannelType.GuildText,
    parent: button.category_id || cfg.ticket_category_id || null,
    permissionOverwrites: overwrites,
    reason: `Ticket ouvert par ${member.user.tag}`,
  });

  let staffThreadId = null;
  if (button.create_staff_thread) {
    try {
      const thread = await channel.threads.create({
        name: `staff-${number}`,
        type: ChannelType.PrivateThread,
        invitable: false,
        autoArchiveDuration: 1440,
      });
      staffThreadId = thread.id;
    } catch (err) {
      logger.warn({ err }, 'Could not create staff thread');
    }
  }

  const ticketId = createTicket({
    guild_id: guild.id,
    channel_id: channel.id,
    panel_id: button.panel_id,
    button_id: button.id,
    number,
    owner_id: member.id,
    staff_thread_id: staffThreadId,
  });
  logAction(guild.id, ticketId, member.id, 'open', JSON.stringify({ buttonId: button.id }));

  if (button.add_role_on_open) {
    try {
      await member.roles.add(button.add_role_on_open, 'Ticket open role');
    } catch (err) {
      logger.warn({ err }, 'Could not add role on ticket open');
    }
  }

  const ctx = { user: member, guild, number };
  const baseEmbed = new EmbedBuilder()
    .setColor(0x5865f2)
    .setTitle(`Ticket #${number} — ${truncate(button.label, 200)}`)
    .setDescription(
      truncate(
        applyVars(
          button.open_message ||
            'Bonjour {user}, un membre du staff va arriver. Décris ton problème en détail.',
          ctx,
        ),
        LIMITS.EMBED_DESCRIPTION,
      ),
    )
    .addFields(
      { name: 'Owner', value: `<@${member.id}>`, inline: true },
      { name: 'Catégorie', value: button.label, inline: true },
    );

  const embeds = [baseEmbed];
  if (answers && answers.length > 0) {
    const answersEmbed = new EmbedBuilder().setColor(0x5865f2).setTitle('Réponses du formulaire');
    for (const a of answers) {
      answersEmbed.addFields({
        name: truncate(a.label, LIMITS.EMBED_FIELD_NAME),
        value: truncate(a.value || '—', LIMITS.EMBED_FIELD_VALUE),
      });
    }
    embeds.push(answersEmbed);
  }

  let pingRoleId = button.ping_role_id;
  if (!pingRoleId && supportRoles.length > 0) {
    pingRoleId = supportRoles[0];
  }

  const mentions = [];
  if (button.mention_owner) mentions.push(`<@${member.id}>`);
  if (pingRoleId) mentions.push(`<@&${pingRoleId}>`);

  await channel.send({
    content: mentions.join(' ') || undefined,
    embeds,
    components: ticketActionRow(),
    allowedMentions: {
      users: button.mention_owner ? [member.id] : [],
      roles: pingRoleId ? [pingRoleId] : [],
    },
  });

  await sendLog(
    guild,
    new EmbedBuilder()
      .setColor(0x57f287)
      .setTitle('Ticket ouvert')
      .addFields(
        { name: 'Ticket', value: `<#${channel.id}> (#${number})`, inline: true },
        { name: 'Par', value: `<@${member.id}>`, inline: true },
        { name: 'Catégorie', value: button.label, inline: true },
      )
      .setTimestamp(),
  );

  return channel;
}

/**
 * Demande la confirmation de fermeture (pas encore d'action destructive).
 * @param {import('discord.js').ButtonInteraction} interaction
 * @param {object} ticket
 */
export async function confirmCloseTicket(interaction, ticket, reason = null) {
  if (reason) {
    pendingCloseReasons.set(ticket.id, {
      reason,
      expiresAt: Date.now() + 10 * 60 * 1000,
    });
  }
  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`ticket:close-confirm:${ticket.id}`)
      .setLabel('Confirmer la fermeture')
      .setStyle(ButtonStyle.Danger),
    new ButtonBuilder()
      .setCustomId('ticket:close-cancel')
      .setLabel('Annuler')
      .setStyle(ButtonStyle.Secondary),
  );
  return interaction.reply({
    embeds: [
      infoEmbed(
        reason
          ? `Confirme la fermeture du ticket avec la raison :\n> ${truncate(reason, 1000)}`
          : 'Confirme la fermeture du ticket.',
      ),
    ],
    components: [row],
    ephemeral: true,
  });
}

/**
 * Ferme un ticket : génère le transcript, retire les permissions du créateur,
 * envoie le DM de feedback, log l'action, propose Reopen/Delete.
 * @param {import('discord.js').Client} client
 * @param {object} ticket
 * @param {{actorId: string, reason?: string|null, silent?: boolean}} opts
 */
export async function closeTicket(client, ticket, { actorId, reason = null, silent = false }) {
  const guild = await client.guilds.fetch(ticket.guild_id).catch(() => null);
  if (!guild) return;
  const channel = await guild.channels.fetch(ticket.channel_id).catch(() => null);
  if (!channel) {
    setTicketStatus(ticket.id, 'closed', reason);
    return;
  }

  const transcript = await generateTranscript(channel, ticket);
  const cfg = getCachedGuildConfig(guild.id);
  const button = ticket.button_id ? getButton(ticket.button_id) : null;

  if (button?.remove_role_on_close) {
    try {
      const owner = await guild.members.fetch(ticket.owner_id).catch(() => null);
      if (owner) await owner.roles.remove(button.remove_role_on_close, 'Ticket closed');
    } catch (err) {
      logger.warn({ err }, 'Could not remove role on close');
    }
  }

  try {
    await channel.permissionOverwrites.edit(ticket.owner_id, { ViewChannel: false });
  } catch {}

  try {
    await channel.setName(`closed-${ticket.number}`);
  } catch {}

  setTicketStatus(ticket.id, 'closed', reason);
  logAction(guild.id, ticket.id, actorId, 'close', reason);

  const summary = new EmbedBuilder()
    .setColor(0xed4245)
    .setTitle('Ticket fermé')
    .addFields(
      { name: 'Fermé par', value: `<@${actorId}>`, inline: true },
      { name: 'Owner', value: `<@${ticket.owner_id}>`, inline: true },
    )
    .setTimestamp();
  if (reason) summary.addFields({ name: 'Raison', value: truncate(reason, 1024) });

  if (!silent) {
    try {
      await channel.send({ embeds: [summary], components: [closedActionRow()] });
    } catch {}
  }

  if (cfg.transcript_channel_id && transcript) {
    const log = await guild.channels.fetch(cfg.transcript_channel_id).catch(() => null);
    if (log?.isTextBased()) {
      try {
        await log.send({
          embeds: [
            new EmbedBuilder()
              .setColor(0x5865f2)
              .setTitle(`Transcript — Ticket #${ticket.number}`)
              .addFields(
                { name: 'Owner', value: `<@${ticket.owner_id}>`, inline: true },
                { name: 'Fermé par', value: `<@${actorId}>`, inline: true },
              )
              .setTimestamp(),
          ],
          files: [cloneAttachment(transcript)],
        });
      } catch (err) {
        logger.warn({ err }, 'Could not post transcript log');
      }
    }
  }

  try {
    const owner = await client.users.fetch(ticket.owner_id);
    const dmEmbed = new EmbedBuilder()
      .setColor(0x5865f2)
      .setTitle(`Ton ticket #${ticket.number} a été fermé`)
      .setDescription(reason ? `Raison : ${truncate(reason, 1024)}` : 'Merci pour ton passage !');
    const ratingRow = new ActionRowBuilder().addComponents(
      ...[1, 2, 3, 4, 5].map((n) =>
        new ButtonBuilder()
          .setCustomId(`fb:rate:${ticket.id}:${n}`)
          .setLabel('★'.repeat(n))
          .setStyle(ButtonStyle.Secondary),
      ),
    );
    const files = transcript ? [cloneAttachment(transcript)] : [];
    await owner.send({ embeds: [dmEmbed], components: [ratingRow], files });
  } catch (err) {
    logger.debug({ err }, 'Could not DM ticket owner');
  }

  await sendLog(
    guild,
    new EmbedBuilder()
      .setColor(0xed4245)
      .setTitle('Ticket fermé')
      .addFields(
        { name: 'Ticket', value: `#${ticket.number}`, inline: true },
        { name: 'Owner', value: `<@${ticket.owner_id}>`, inline: true },
        { name: 'Fermé par', value: `<@${actorId}>`, inline: true },
        ...(reason ? [{ name: 'Raison', value: truncate(reason, 1024) }] : []),
      )
      .setTimestamp(),
  );
}

/**
 * Réouvre un ticket fermé.
 * @param {import('discord.js').ButtonInteraction} interaction
 */
export async function reopenTicket(interaction) {
  const ticket = getTicketByChannel(interaction.channel.id);
  if (!ticket) return interaction.reply({ embeds: [errorEmbed('Ticket introuvable.')], ephemeral: true });
  if (!isStaff(interaction.member) && interaction.user.id !== ticket.owner_id) {
    return interaction.reply({ embeds: [errorEmbed('Seul le staff ou le créateur peut rouvrir.')], ephemeral: true });
  }
  setTicketStatus(ticket.id, 'open');
  logAction(interaction.guild.id, ticket.id, interaction.user.id, 'reopen');
  try {
    await interaction.channel.permissionOverwrites.edit(ticket.owner_id, { ViewChannel: true });
    await interaction.channel.setName(`ticket-${ticket.number}`);
  } catch {}
  await interaction.reply({ embeds: [successEmbed('Ticket rouvert.')] });
  await sendLog(
    interaction.guild,
    new EmbedBuilder()
      .setColor(0xfee75c)
      .setTitle('Ticket rouvert')
      .addFields(
        { name: 'Ticket', value: `<#${ticket.channel_id}> (#${ticket.number})`, inline: true },
        { name: 'Par', value: `<@${interaction.user.id}>`, inline: true },
      )
      .setTimestamp(),
  );
}

/**
 * Supprime définitivement le channel du ticket.
 * @param {import('discord.js').ButtonInteraction} interaction
 */
export async function deleteTicket(interaction) {
  const ticket = getTicketByChannel(interaction.channel.id);
  if (!ticket) return interaction.reply({ embeds: [errorEmbed('Ticket introuvable.')], ephemeral: true });
  if (!isStaff(interaction.member)) {
    return interaction.reply({ embeds: [errorEmbed('Action staff uniquement.')], ephemeral: true });
  }
  await interaction.reply({ embeds: [infoEmbed('Suppression dans 3 secondes…')] });
  logAction(interaction.guild.id, ticket.id, interaction.user.id, 'delete');
  setTimeout(() => {
    interaction.channel.delete('Ticket deleted').catch(() => {});
  }, 3000);
}

/**
 * Claim : seuls le claimer + admins peuvent répondre.
 * @param {import('discord.js').ButtonInteraction|import('discord.js').ChatInputCommandInteraction} interaction
 */
export async function claimTicket(interaction) {
  const ticket = getTicketByChannel(interaction.channel.id);
  if (!ticket) return interaction.reply({ embeds: [errorEmbed('Ticket introuvable.')], ephemeral: true });
  if (!isStaff(interaction.member)) {
    return interaction.reply({ embeds: [errorEmbed('Seul le staff peut claim.')], ephemeral: true });
  }
  if (ticket.claimed_by) {
    return interaction.reply({
      embeds: [errorEmbed(`Déjà claim par <@${ticket.claimed_by}>.`)],
      ephemeral: true,
    });
  }
  setTicketClaimed(ticket.id, interaction.user.id);
  logAction(interaction.guild.id, ticket.id, interaction.user.id, 'claim');

  if (ticket.button_id) {
    const button = getButton(ticket.button_id);
    if (button?.claimed_category_id) {
      try {
        await interaction.channel.setParent(button.claimed_category_id, { lockPermissions: false });
      } catch (err) {
        logger.warn({ err }, 'Could not move ticket to claimed category');
      }
    }
  }

  const cfg = getCachedGuildConfig(interaction.guild.id);
  let supportRoles = [];
  try {
    supportRoles = JSON.parse(cfg.support_role_ids || '[]');
  } catch {}
  for (const r of supportRoles) {
    try {
      await interaction.channel.permissionOverwrites.edit(r, { SendMessages: false });
    } catch {}
  }
  try {
    await interaction.channel.permissionOverwrites.edit(interaction.user.id, {
      ViewChannel: true,
      SendMessages: true,
      ReadMessageHistory: true,
    });
  } catch {}

  await interaction.reply({
    embeds: [successEmbed(`Ticket claim par <@${interaction.user.id}>.`)],
  });
  await sendLog(
    interaction.guild,
    new EmbedBuilder()
      .setColor(0x5865f2)
      .setTitle('Ticket claim')
      .addFields(
        { name: 'Ticket', value: `<#${ticket.channel_id}> (#${ticket.number})`, inline: true },
        { name: 'Par', value: `<@${interaction.user.id}>`, inline: true },
      )
      .setTimestamp(),
  );
}

/**
 * Ajoute un user au ticket.
 */
export async function addUserToTicket(interaction, user) {
  const ticket = getTicketByChannel(interaction.channel.id);
  if (!ticket) return interaction.reply({ embeds: [errorEmbed('Pas un ticket.')], ephemeral: true });
  if (!isStaff(interaction.member) && interaction.user.id !== ticket.owner_id) {
    return interaction.reply({ embeds: [errorEmbed('Action interdite.')], ephemeral: true });
  }
  await interaction.channel.permissionOverwrites.edit(user.id, {
    ViewChannel: true,
    SendMessages: true,
    ReadMessageHistory: true,
  });
  return interaction.reply({ embeds: [successEmbed(`<@${user.id}> ajouté au ticket.`)] });
}

/**
 * Retire un user du ticket.
 */
export async function removeUserFromTicket(interaction, user) {
  const ticket = getTicketByChannel(interaction.channel.id);
  if (!ticket) return interaction.reply({ embeds: [errorEmbed('Pas un ticket.')], ephemeral: true });
  if (!isStaff(interaction.member)) {
    return interaction.reply({ embeds: [errorEmbed('Staff uniquement.')], ephemeral: true });
  }
  await interaction.channel.permissionOverwrites.edit(user.id, { ViewChannel: false });
  return interaction.reply({ embeds: [successEmbed(`<@${user.id}> retiré du ticket.`)] });
}

/**
 * Renomme le channel.
 */
export async function renameTicket(interaction, name) {
  const ticket = getTicketByChannel(interaction.channel.id);
  if (!ticket) return interaction.reply({ embeds: [errorEmbed('Pas un ticket.')], ephemeral: true });
  if (!isStaff(interaction.member)) {
    return interaction.reply({ embeds: [errorEmbed('Staff uniquement.')], ephemeral: true });
  }
  await interaction.channel.setName(truncate(name.toLowerCase().replace(/[^a-z0-9-]+/g, '-'), 100));
  return interaction.reply({ embeds: [successEmbed('Renommé.')] });
}

/**
 * Transfère le ticket à un autre staff.
 */
export async function transferTicket(interaction, user) {
  const ticket = getTicketByChannel(interaction.channel.id);
  if (!ticket) return interaction.reply({ embeds: [errorEmbed('Pas un ticket.')], ephemeral: true });
  if (!isStaff(interaction.member) && !isAdmin(interaction.member)) {
    return interaction.reply({ embeds: [errorEmbed('Staff uniquement.')], ephemeral: true });
  }
  setTicketClaimed(ticket.id, user.id);
  logAction(interaction.guild.id, ticket.id, interaction.user.id, 'transfer', user.id);
  return interaction.reply({ embeds: [successEmbed(`Transféré à <@${user.id}>.`)] });
}

/**
 * Met l'autoclose en pause pendant `hours` heures.
 * @param {import('discord.js').ChatInputCommandInteraction} interaction
 * @param {number} hours
 */
export async function snoozeTicketCmd(interaction, hours) {
  const ticket = getTicketByChannel(interaction.channel.id);
  if (!ticket) return interaction.reply({ embeds: [errorEmbed('Pas un ticket.')], ephemeral: true });
  if (!isStaff(interaction.member)) {
    return interaction.reply({ embeds: [errorEmbed('Staff uniquement.')], ephemeral: true });
  }
  const until = Math.floor(Date.now() / 1000) + hours * 3600;
  snoozeTicket(ticket.id, until);
  logAction(interaction.guild.id, ticket.id, interaction.user.id, 'snooze', String(hours));
  return interaction.reply({
    embeds: [successEmbed(`Ticket en pause pendant ${hours}h. Autoclose désactivé jusque <t:${until}:R>.`)],
  });
}

/**
 * Change le créateur du ticket (admin only).
 */
export async function changeOwner(interaction, user) {
  const ticket = getTicketByChannel(interaction.channel.id);
  if (!ticket) return interaction.reply({ embeds: [errorEmbed('Pas un ticket.')], ephemeral: true });
  if (!isAdmin(interaction.member)) {
    return interaction.reply({ embeds: [errorEmbed('Admin uniquement.')], ephemeral: true });
  }
  setTicketOwner(ticket.id, user.id);
  return interaction.reply({ embeds: [successEmbed(`Owner changé : <@${user.id}>.`)] });
}

/**
 * Touch ticket activity + premier temps de réponse staff + log
 * (optionnel) du message dans le log channel.
 * @param {import('discord.js').Message} message
 */
export async function recordMessage(message) {
  const ticket = getTicketByChannel(message.channel.id);
  if (!ticket || ticket.status !== 'open') return;
  touchTicket(message.channel.id);

  const isOwner = message.author.id === ticket.owner_id;
  let member = null;
  if (!message.author.bot && !isOwner) {
    member =
      message.member ??
      (await message.guild.members.fetch(message.author.id).catch(() => null));
    if (member && isStaff(member)) {
      setFirstResponse(ticket.id);
    }
  }

  const cfg = getCachedGuildConfig(message.guild.id);
  if (!cfg.log_messages || !cfg.log_channel_id || message.author.bot) return;

  try {
    const logCh = await message.guild.channels.fetch(cfg.log_channel_id).catch(() => null);
    if (!logCh?.isTextBased()) return;
    const embed = new EmbedBuilder()
      .setColor(isOwner ? 0x5865f2 : 0x57f287)
      .setAuthor({
        name: `${message.author.username}${isOwner ? ' (client)' : ' (staff)'}`,
        iconURL: message.author.displayAvatarURL(),
      })
      .setDescription(truncate(message.content || '*(message vide ou pièce jointe)*', 1900))
      .setFooter({ text: `Ticket #${ticket.number} · #${message.channel.name}` })
      .setTimestamp(message.createdAt);
    if (message.attachments.size > 0) {
      embed.addFields({
        name: 'Pièces jointes',
        value: message.attachments
          .map((a) => `[${a.name}](${a.url})`)
          .join('\n')
          .slice(0, 1024),
      });
    }
    await logCh.send({ embeds: [embed] });
  } catch (err) {
    logger.debug({ err }, 'Message log failed');
  }
}

/**
 * Stocke un rating de feedback DM.
 */
export async function handleFeedbackRate(interaction, ticketId, rating) {
  const ticket = getTicketById(Number(ticketId));
  if (!ticket || ticket.owner_id !== interaction.user.id) {
    return interaction.reply({
      embeds: [errorEmbed('Feedback indisponible.')],
      ephemeral: true,
    });
  }
  const fbId = insertFeedback(ticket.id, ticket.guild_id, interaction.user.id, rating, null);
  const modal = new ModalBuilder()
    .setCustomId(`fb:comment:${fbId}`)
    .setTitle('Un commentaire ? (optionnel)');
  modal.addComponents(
    new ActionRowBuilder().addComponents(
      new TextInputBuilder()
        .setCustomId('comment')
        .setLabel('Commentaire')
        .setStyle(TextInputStyle.Paragraph)
        .setRequired(false)
        .setMaxLength(LIMITS.MODAL_INPUT),
    ),
  );
  await interaction.showModal(modal);
}

export async function handleFeedbackComment(interaction, fbId) {
  const comment = interaction.fields.getTextInputValue('comment');
  if (comment) updateFeedbackComment(Number(fbId), comment);
  return interaction.reply({
    embeds: [successEmbed('Merci pour ton retour !')],
    ephemeral: true,
  });
}

/**
 * Envoie un embed dans le log channel guild si configuré.
 */
export async function sendLog(guild, embed) {
  const cfg = getCachedGuildConfig(guild.id);
  if (!cfg.log_channel_id) return;
  try {
    const ch = await guild.channels.fetch(cfg.log_channel_id);
    if (ch?.isTextBased()) await ch.send({ embeds: [embed] });
  } catch (err) {
    logger.debug({ err }, 'Log channel send failed');
  }
}
