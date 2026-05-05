import {
  ActionRowBuilder,
  ChannelType,
  EmbedBuilder,
  ModalBuilder,
  PermissionFlagsBits,
  SlashCommandBuilder,
  TextInputBuilder,
  TextInputStyle,
} from 'discord.js';
import {
  addButton,
  countButtons,
  createPanel,
  deletePanel,
  getButtons,
  getPanel,
  listPanels,
  updatePanelMessage,
} from '../db/queries.js';
import { errorEmbed, successEmbed } from '../utils/embeds.js';
import { LIMITS, parseColor, truncate } from '../utils/validators.js';
import { buildPanelMessage } from '../handlers/tickets.js';

export const data = new SlashCommandBuilder()
  .setName('panel')
  .setDescription('Gérer les panels de tickets')
  .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
  .addSubcommand((s) => s.setName('create').setDescription('Créer un nouveau panel (ouvre un modal)'))
  .addSubcommand((s) =>
    s
      .setName('addbutton')
      .setDescription('Ajouter un bouton (catégorie de ticket) à un panel')
      .addIntegerOption((o) =>
        o.setName('panel_id').setDescription('ID du panel').setRequired(true),
      )
      .addStringOption((o) =>
        o.setName('label').setDescription('Texte du bouton').setRequired(true).setMaxLength(LIMITS.BUTTON_LABEL),
      )
      .addChannelOption((o) =>
        o
          .setName('category')
          .setDescription('Catégorie où créer les tickets de ce bouton')
          .addChannelTypes(ChannelType.GuildCategory),
      )
      .addRoleOption((o) => o.setName('support_role').setDescription('Rôle support dédié à cette catégorie'))
      .addRoleOption((o) => o.setName('ping_role').setDescription('Rôle pingé à l’ouverture'))
      .addRoleOption((o) => o.setName('add_role_on_open').setDescription('Rôle ajouté à l’owner à l’ouverture'))
      .addRoleOption((o) => o.setName('remove_role_on_close').setDescription('Rôle retiré à la fermeture'))
      .addStringOption((o) => o.setName('emoji').setDescription('Emoji du bouton'))
      .addStringOption((o) =>
        o
          .setName('style')
          .setDescription('Style du bouton')
          .addChoices(
            { name: 'Primary (bleu)', value: '1' },
            { name: 'Secondary (gris)', value: '2' },
            { name: 'Success (vert)', value: '3' },
            { name: 'Danger (rouge)', value: '4' },
          ),
      )
      .addStringOption((o) =>
        o.setName('name_template').setDescription('Template du nom (ex : ticket-{username}-{number})'),
      )
      .addStringOption((o) => o.setName('open_message').setDescription('Message d’ouverture custom'))
      .addBooleanOption((o) => o.setName('mention_owner').setDescription('Mentionner l’owner à l’ouverture'))
      .addBooleanOption((o) => o.setName('staff_thread').setDescription('Créer un thread privé staff'))
      .addBooleanOption((o) => o.setName('with_questions').setDescription('Demander 1-5 questions via modal')),
  )
  .addSubcommand((s) =>
    s
      .setName('send')
      .setDescription('Envoyer le panel dans un channel')
      .addIntegerOption((o) => o.setName('panel_id').setDescription('ID du panel').setRequired(true))
      .addChannelOption((o) =>
        o
          .setName('channel')
          .setDescription('Channel cible')
          .setRequired(true)
          .addChannelTypes(ChannelType.GuildText),
      ),
  )
  .addSubcommand((s) => s.setName('list').setDescription('Lister tous les panels du serveur'))
  .addSubcommand((s) =>
    s
      .setName('delete')
      .setDescription('Supprimer un panel')
      .addIntegerOption((o) => o.setName('panel_id').setDescription('ID du panel').setRequired(true)),
  );

/**
 * @param {import('discord.js').ChatInputCommandInteraction} interaction
 */
export async function execute(interaction) {
  const sub = interaction.options.getSubcommand();
  if (sub === 'create') return openCreateModal(interaction);
  if (sub === 'addbutton') return addButtonCmd(interaction);
  if (sub === 'send') return sendPanel(interaction);
  if (sub === 'list') return listCmd(interaction);
  if (sub === 'delete') return deleteCmd(interaction);
}

async function openCreateModal(interaction) {
  const modal = new ModalBuilder().setCustomId('panel:create').setTitle('Nouveau panel');
  modal.addComponents(
    new ActionRowBuilder().addComponents(
      new TextInputBuilder()
        .setCustomId('title')
        .setLabel('Titre')
        .setStyle(TextInputStyle.Short)
        .setRequired(true)
        .setMaxLength(LIMITS.EMBED_TITLE),
    ),
    new ActionRowBuilder().addComponents(
      new TextInputBuilder()
        .setCustomId('description')
        .setLabel('Description')
        .setStyle(TextInputStyle.Paragraph)
        .setRequired(false)
        .setMaxLength(LIMITS.MODAL_INPUT),
    ),
    new ActionRowBuilder().addComponents(
      new TextInputBuilder()
        .setCustomId('color')
        .setLabel('Couleur hex (ex: #5865F2)')
        .setStyle(TextInputStyle.Short)
        .setRequired(false)
        .setMaxLength(8),
    ),
    new ActionRowBuilder().addComponents(
      new TextInputBuilder()
        .setCustomId('image')
        .setLabel('URL image (optionnel)')
        .setStyle(TextInputStyle.Short)
        .setRequired(false)
        .setMaxLength(500),
    ),
    new ActionRowBuilder().addComponents(
      new TextInputBuilder()
        .setCustomId('thumbnail')
        .setLabel('URL thumbnail (optionnel)')
        .setStyle(TextInputStyle.Short)
        .setRequired(false)
        .setMaxLength(500),
    ),
  );
  await interaction.showModal(modal);
}

/**
 * Soumission du modal panel:create.
 * @param {import('discord.js').ModalSubmitInteraction} interaction
 */
export async function handleCreateModal(interaction) {
  const title = interaction.fields.getTextInputValue('title');
  const description = interaction.fields.getTextInputValue('description');
  const color = interaction.fields.getTextInputValue('color');
  const image = interaction.fields.getTextInputValue('image');
  const thumbnail = interaction.fields.getTextInputValue('thumbnail');
  const id = createPanel(interaction.guild.id, {
    title: truncate(title, LIMITS.EMBED_TITLE),
    description: truncate(description, LIMITS.EMBED_DESCRIPTION),
    color: parseColor(color),
    image: image || null,
    thumbnail: thumbnail || null,
  });
  return interaction.reply({
    embeds: [
      successEmbed(
        `Panel #${id} créé. Ajoute un bouton avec :\n\`/panel addbutton panel_id:${id} label:Support\``,
      ),
    ],
    ephemeral: true,
  });
}

async function addButtonCmd(interaction) {
  const panelId = interaction.options.getInteger('panel_id', true);
  const panel = getPanel(panelId, interaction.guild.id);
  if (!panel) return interaction.reply({ embeds: [errorEmbed('Panel introuvable.')], ephemeral: true });
  if (countButtons(panelId) >= 5) {
    return interaction.reply({
      embeds: [errorEmbed('Un panel ne peut avoir que 5 boutons max (limite Discord).')],
      ephemeral: true,
    });
  }
  const supportRole = interaction.options.getRole('support_role');
  const pingRole = interaction.options.getRole('ping_role');
  const addRole = interaction.options.getRole('add_role_on_open');
  const removeRole = interaction.options.getRole('remove_role_on_close');
  const category = interaction.options.getChannel('category');
  const withQuestions = interaction.options.getBoolean('with_questions');

  if (withQuestions) {
    const buttonStub = {
      panelId,
      label: interaction.options.getString('label', true),
      emoji: interaction.options.getString('emoji'),
      style: Number(interaction.options.getString('style') || '1'),
      category_id: category?.id || null,
      support_role_ids: supportRole ? JSON.stringify([supportRole.id]) : '[]',
      ping_role_id: pingRole?.id || null,
      add_role_on_open: addRole?.id || null,
      remove_role_on_close: removeRole?.id || null,
      mention_owner: interaction.options.getBoolean('mention_owner') === false ? 0 : 1,
      create_staff_thread: interaction.options.getBoolean('staff_thread') ? 1 : 0,
      name_template: interaction.options.getString('name_template') || 'ticket-{username}-{number}',
      open_message: interaction.options.getString('open_message') || null,
    };
    pendingButtons.set(interaction.user.id, buttonStub);
    const modal = new ModalBuilder()
      .setCustomId('panel:questions')
      .setTitle('Questions du formulaire (1-5)');
    for (let i = 0; i < 5; i++) {
      modal.addComponents(
        new ActionRowBuilder().addComponents(
          new TextInputBuilder()
            .setCustomId(`q${i}`)
            .setLabel(`Question ${i + 1} (laisser vide = ignorer)`)
            .setStyle(TextInputStyle.Short)
            .setRequired(false)
            .setMaxLength(45),
        ),
      );
    }
    return interaction.showModal(modal);
  }

  const id = addButton(panelId, {
    label: interaction.options.getString('label', true),
    emoji: interaction.options.getString('emoji'),
    style: Number(interaction.options.getString('style') || '1'),
    category_id: category?.id || null,
    support_role_ids: supportRole ? JSON.stringify([supportRole.id]) : '[]',
    ping_role_id: pingRole?.id || null,
    add_role_on_open: addRole?.id || null,
    remove_role_on_close: removeRole?.id || null,
    mention_owner: interaction.options.getBoolean('mention_owner') === false ? 0 : 1,
    create_staff_thread: interaction.options.getBoolean('staff_thread') ? 1 : 0,
    name_template: interaction.options.getString('name_template') || 'ticket-{username}-{number}',
    open_message: interaction.options.getString('open_message') || null,
    questions: '[]',
  });
  return interaction.reply({
    embeds: [successEmbed(`Bouton #${id} ajouté au panel #${panelId}.`)],
    ephemeral: true,
  });
}

const pendingButtons = new Map();

/**
 * Soumission du modal panel:questions — finalise l'ajout du bouton avec ses questions.
 * @param {import('discord.js').ModalSubmitInteraction} interaction
 */
export async function handleQuestionsModal(interaction) {
  const stub = pendingButtons.get(interaction.user.id);
  if (!stub) {
    return interaction.reply({ embeds: [errorEmbed('Session expirée. Relance la commande.')], ephemeral: true });
  }
  pendingButtons.delete(interaction.user.id);
  const questions = [];
  for (let i = 0; i < 5; i++) {
    const v = interaction.fields.getTextInputValue(`q${i}`).trim();
    if (v) questions.push({ label: v, required: true, long: true });
  }
  const id = addButton(stub.panelId, { ...stub, questions: JSON.stringify(questions) });
  return interaction.reply({
    embeds: [successEmbed(`Bouton #${id} ajouté avec ${questions.length} question(s).`)],
    ephemeral: true,
  });
}

async function sendPanel(interaction) {
  const panelId = interaction.options.getInteger('panel_id', true);
  const panel = getPanel(panelId, interaction.guild.id);
  if (!panel) return interaction.reply({ embeds: [errorEmbed('Panel introuvable.')], ephemeral: true });
  const buttons = getButtons(panelId);
  if (buttons.length === 0)
    return interaction.reply({
      embeds: [errorEmbed('Ajoute au moins un bouton avant d’envoyer le panel.')],
      ephemeral: true,
    });
  const channel = interaction.options.getChannel('channel', true);
  const msg = await channel.send(buildPanelMessage(panel, buttons));
  updatePanelMessage(panelId, channel.id, msg.id);
  return interaction.reply({
    embeds: [successEmbed(`Panel envoyé dans <#${channel.id}>.`)],
    ephemeral: true,
  });
}

async function listCmd(interaction) {
  const panels = listPanels(interaction.guild.id);
  if (panels.length === 0) {
    return interaction.reply({
      embeds: [errorEmbed('Aucun panel. Crée-en un avec `/panel create`.')],
      ephemeral: true,
    });
  }
  const embed = new EmbedBuilder()
    .setColor(0x5865f2)
    .setTitle('Panels')
    .setDescription(
      panels
        .map((p) => {
          const n = countButtons(p.id);
          const where = p.channel_id ? `<#${p.channel_id}>` : 'non envoyé';
          return `**#${p.id}** — ${truncate(p.title, 60)} (${n} bouton${n > 1 ? 's' : ''}, ${where})`;
        })
        .join('\n'),
    );
  return interaction.reply({ embeds: [embed], ephemeral: true });
}

async function deleteCmd(interaction) {
  const panelId = interaction.options.getInteger('panel_id', true);
  const result = deletePanel(panelId, interaction.guild.id);
  if (result.changes === 0)
    return interaction.reply({ embeds: [errorEmbed('Panel introuvable.')], ephemeral: true });
  return interaction.reply({ embeds: [successEmbed(`Panel #${panelId} supprimé.`)], ephemeral: true });
}
