import {
  ActionRowBuilder,
  AttachmentBuilder,
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
  clearButtonField,
  countButtons,
  createPanel,
  deletePanel,
  getButton,
  getButtons,
  getPanel,
  listPanels,
  updateButton,
  updatePanelMessage,
} from '../db/queries.js';
import { errorEmbed, successEmbed } from '../utils/embeds.js';
import { LIMITS, parseColor, truncate } from '../utils/validators.js';
import { buildPanelMessage } from '../handlers/tickets.js';

export const data = new SlashCommandBuilder()
  .setName('panel')
  .setDescription('Gérer les panels de tickets')
  .setDMPermission(false)
  .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
  .addSubcommand((s) =>
    s
      .setName('create')
      .setDescription('Créer un nouveau panel (ouvre un modal)')
      .addStringOption((o) =>
        o
          .setName('mode')
          .setDescription('Affichage : boutons (max 5) ou dropdown (max 25)')
          .addChoices(
            { name: 'Boutons (max 5 options)', value: 'buttons' },
            { name: 'Dropdown menu (max 25 options)', value: 'select' },
          ),
      ),
  )
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
      .addStringOption((o) =>
        o.setName('description').setDescription('Description (visible dans dropdown uniquement)').setMaxLength(100),
      )
      .addStringOption((o) =>
        o
          .setName('placeholder')
          .setDescription('Texte du dropdown quand rien sélectionné (1er bouton suffit)')
          .setMaxLength(150),
      )
      .addBooleanOption((o) => o.setName('mention_owner').setDescription('Mentionner l’owner à l’ouverture'))
      .addBooleanOption((o) => o.setName('staff_thread').setDescription('Créer un thread privé staff'))
      .addBooleanOption((o) => o.setName('with_questions').setDescription('Demander 1-5 questions via modal')),
  )
  .addSubcommand((s) =>
    s
      .setName('editbutton')
      .setDescription('Modifier un bouton existant (laisse les options vides pour ne pas changer)')
      .addIntegerOption((o) =>
        o.setName('button_id').setDescription('ID du bouton à éditer').setRequired(true),
      )
      .addStringOption((o) =>
        o.setName('label').setDescription('Nouveau texte du bouton').setMaxLength(LIMITS.BUTTON_LABEL),
      )
      .addStringOption((o) => o.setName('emoji').setDescription('Nouvel emoji'))
      .addStringOption((o) =>
        o
          .setName('style')
          .setDescription('Nouveau style')
          .addChoices(
            { name: 'Primary (bleu)', value: '1' },
            { name: 'Secondary (gris)', value: '2' },
            { name: 'Success (vert)', value: '3' },
            { name: 'Danger (rouge)', value: '4' },
          ),
      )
      .addChannelOption((o) =>
        o
          .setName('category')
          .setDescription('Nouvelle catégorie de tickets')
          .addChannelTypes(ChannelType.GuildCategory),
      )
      .addRoleOption((o) => o.setName('support_role').setDescription('Nouveau rôle support'))
      .addRoleOption((o) => o.setName('ping_role').setDescription("Nouveau rôle pingé à l'ouverture"))
      .addRoleOption((o) =>
        o.setName('add_role_on_open').setDescription("Rôle ajouté à l'owner à l'ouverture"),
      )
      .addRoleOption((o) =>
        o.setName('remove_role_on_close').setDescription('Rôle retiré à la fermeture'),
      )
      .addStringOption((o) =>
        o.setName('name_template').setDescription('Nouveau template de nom de channel'),
      )
      .addStringOption((o) => o.setName('open_message').setDescription("Nouveau message d'ouverture"))
      .addStringOption((o) =>
        o.setName('description').setDescription('Description (dropdown uniquement)').setMaxLength(100),
      )
      .addStringOption((o) =>
        o.setName('placeholder_text').setDescription('Texte placeholder du dropdown').setMaxLength(150),
      )
      .addBooleanOption((o) => o.setName('mention_owner').setDescription("Mentionner l'owner à l'ouverture"))
      .addBooleanOption((o) => o.setName('staff_thread').setDescription('Créer un thread privé staff'))
      .addStringOption((o) =>
        o
          .setName('clear')
          .setDescription('Vider un champ (mettre à NULL)')
          .addChoices(
            { name: 'Emoji', value: 'emoji' },
            { name: 'Catégorie', value: 'category_id' },
            { name: 'Rôle ping', value: 'ping_role_id' },
            { name: "Rôle add à l'ouverture", value: 'add_role_on_open' },
            { name: 'Rôle remove à la fermeture', value: 'remove_role_on_close' },
            { name: "Message d'ouverture", value: 'open_message' },
            { name: 'Description', value: 'description' },
            { name: 'Placeholder dropdown', value: 'placeholder_text' },
            { name: 'Rôles support', value: 'support_role_ids' },
          ),
      ),
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
  )
  .addSubcommand((s) =>
    s
      .setName('export')
      .setDescription('Exporter un panel et ses boutons en JSON')
      .addIntegerOption((o) => o.setName('panel_id').setDescription('ID du panel').setRequired(true)),
  )
  .addSubcommand((s) =>
    s.setName('import').setDescription('Importer un panel depuis un JSON (ouvre un modal)'),
  )
  .addSubcommand((s) =>
    s
      .setName('import_file')
      .setDescription('Importer un panel depuis un fichier JSON joint')
      .addAttachmentOption((o) =>
        o.setName('file').setDescription('Fichier JSON exporté par /panel export').setRequired(true),
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
  if (sub === 'create') return openCreateModal(interaction);
  if (sub === 'addbutton') return addButtonCmd(interaction);
  if (sub === 'editbutton') return editButtonCmd(interaction);
  if (sub === 'send') return sendPanel(interaction);
  if (sub === 'list') return listCmd(interaction);
  if (sub === 'delete') return deleteCmd(interaction);
  if (sub === 'export') return exportCmd(interaction);
  if (sub === 'import') return openImportModal(interaction);
  if (sub === 'import_file') return importFromAttachment(interaction);
}

async function openCreateModal(interaction) {
  const mode = interaction.options.getString('mode') || 'buttons';
  const modal = new ModalBuilder()
    .setCustomId(`panel:create:${mode}`)
    .setTitle('Nouveau panel');
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
  const mode = interaction.customId.split(':')[2] === 'select' ? 'select' : 'buttons';
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
    display_mode: mode,
  });
  return interaction.reply({
    embeds: [
      successEmbed(
        `Panel #${id} créé (${mode === 'select' ? 'dropdown' : 'boutons'}). Ajoute une option avec :\n\`/panel addbutton panel_id:${id} label:Support\``,
      ),
    ],
    ephemeral: true,
  });
}

async function addButtonCmd(interaction) {
  const panelId = interaction.options.getInteger('panel_id', true);
  const panel = getPanel(panelId, interaction.guild.id);
  if (!panel) return interaction.reply({ embeds: [errorEmbed('Panel introuvable.')], ephemeral: true });
  const max = panel.display_mode === 'select' ? 25 : 5;
  if (countButtons(panelId) >= max) {
    return interaction.reply({
      embeds: [errorEmbed(`Ce panel est plein : max ${max} options (mode ${panel.display_mode === 'select' ? 'dropdown' : 'boutons'}).`)],
      ephemeral: true,
    });
  }
  const supportRole = interaction.options.getRole('support_role');
  const pingRole = interaction.options.getRole('ping_role');
  const addRole = interaction.options.getRole('add_role_on_open');
  const removeRole = interaction.options.getRole('remove_role_on_close');
  const category = interaction.options.getChannel('category');
  const withQuestions = interaction.options.getBoolean('with_questions');
  const description = interaction.options.getString('description');
  const placeholder = interaction.options.getString('placeholder');

  const baseStub = {
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
    description: description || null,
    placeholder_text: placeholder || null,
  };

  if (withQuestions) {
    pendingButtons.set(interaction.user.id, { panelId, ...baseStub });
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

  const id = addButton(panelId, { ...baseStub, questions: '[]' });
  return interaction.reply({
    embeds: [successEmbed(`Bouton #${id} ajouté au panel #${panelId}.`)],
    ephemeral: true,
  });
}

const pendingButtons = new Map();

/**
 * Soumission du modal panel:questions — collecte les labels et enchaîne sur le
 * modal de placeholders. Si aucune question saisie, finalise directement.
 * @param {import('discord.js').ModalSubmitInteraction} interaction
 */
export async function handleQuestionsModal(interaction) {
  const stub = pendingButtons.get(interaction.user.id);
  if (!stub) {
    return interaction.reply({ embeds: [errorEmbed('Session expirée. Relance la commande.')], ephemeral: true });
  }
  const labels = [];
  for (let i = 0; i < 5; i++) {
    const v = interaction.fields.getTextInputValue(`q${i}`).trim();
    if (v) labels.push(v);
  }

  if (labels.length === 0) {
    pendingButtons.delete(interaction.user.id);
    const id = addButton(stub.panelId, { ...stub, questions: '[]' });
    return interaction.reply({
      embeds: [successEmbed(`Bouton #${id} ajouté sans question.`)],
      ephemeral: true,
    });
  }

  pendingButtons.set(interaction.user.id, { ...stub, _pendingLabels: labels });
  const modal = new ModalBuilder()
    .setCustomId('panel:placeholders')
    .setTitle('Placeholders (optionnels)');
  labels.forEach((label, i) => {
    modal.addComponents(
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId(`p${i}`)
          .setLabel(truncate(`Placeholder Q${i + 1}`, 45))
          .setPlaceholder(truncate(label, 100))
          .setStyle(TextInputStyle.Short)
          .setRequired(false)
          .setMaxLength(100),
      ),
    );
  });
  return interaction.showModal(modal);
}

/**
 * Soumission du modal panel:placeholders — finalise l'ajout du bouton avec ses
 * questions et leurs placeholders.
 * @param {import('discord.js').ModalSubmitInteraction} interaction
 */
export async function handlePlaceholdersModal(interaction) {
  const stub = pendingButtons.get(interaction.user.id);
  if (!stub || !stub._pendingLabels) {
    return interaction.reply({ embeds: [errorEmbed('Session expirée. Relance la commande.')], ephemeral: true });
  }
  pendingButtons.delete(interaction.user.id);
  const labels = stub._pendingLabels;
  const questions = labels.map((label, i) => {
    const placeholder = interaction.fields.getTextInputValue(`p${i}`).trim();
    return { label, placeholder: placeholder || null, required: true, long: true };
  });
  const { _pendingLabels, ...clean } = stub;
  const id = addButton(stub.panelId, { ...clean, questions: JSON.stringify(questions) });
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
          const mode = p.display_mode === 'select' ? 'dropdown' : 'boutons';
          return `**#${p.id}** — ${truncate(p.title, 60)} (${mode}, ${n} option${n > 1 ? 's' : ''}, ${where})`;
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

/**
 * Export d'un panel + ses boutons en JSON portable (sans IDs serveur).
 * @param {import('discord.js').ChatInputCommandInteraction} interaction
 */
async function exportCmd(interaction) {
  const panelId = interaction.options.getInteger('panel_id', true);
  const panel = getPanel(panelId, interaction.guild.id);
  if (!panel) {
    return interaction.reply({ embeds: [errorEmbed('Panel introuvable.')], ephemeral: true });
  }
  const buttons = getButtons(panelId);

  const exportData = {
    version: 1,
    panel: {
      title: panel.title,
      description: panel.description,
      color: panel.color,
      image: panel.image,
      thumbnail: panel.thumbnail,
      display_mode: panel.display_mode || 'buttons',
    },
    buttons: buttons.map((b) => ({
      label: b.label,
      emoji: b.emoji,
      style: b.style,
      mention_owner: b.mention_owner,
      name_template: b.name_template,
      open_message: b.open_message,
      questions: b.questions,
      create_staff_thread: b.create_staff_thread,
      position: b.position,
      description: b.description ?? null,
      placeholder_text: b.placeholder_text ?? null,
    })),
  };

  const json = JSON.stringify(exportData, null, 2);

  if (json.length < 1900) {
    return interaction.reply({
      content: `\`\`\`json\n${json}\n\`\`\``,
      ephemeral: true,
    });
  }
  const buf = Buffer.from(json, 'utf8');
  const file = new AttachmentBuilder(buf, { name: `panel-${panelId}-export.json` });
  return interaction.reply({
    content: `Export du panel #${panelId} (en pièce jointe — JSON trop long pour être affiché)`,
    files: [file],
    ephemeral: true,
  });
}

/**
 * Ouvre le modal d'import (textarea pour coller le JSON).
 * @param {import('discord.js').ChatInputCommandInteraction} interaction
 */
async function openImportModal(interaction) {
  const modal = new ModalBuilder().setCustomId('panel:import').setTitle('Importer un panel');
  modal.addComponents(
    new ActionRowBuilder().addComponents(
      new TextInputBuilder()
        .setCustomId('json')
        .setLabel('Colle ici le JSON exporté')
        .setStyle(TextInputStyle.Paragraph)
        .setRequired(true)
        .setMaxLength(LIMITS.MODAL_INPUT)
        .setPlaceholder('{ "version": 1, "panel": { ... }, "buttons": [ ... ] }'),
    ),
  );
  await interaction.showModal(modal);
}

/**
 * Soumission du modal panel:import — recrée le panel + boutons depuis le JSON.
 * Les IDs serveur (channel, rôles, catégorie) ne sont jamais dans le JSON et
 * doivent être reconfigurés manuellement après l'import.
 * @param {import('discord.js').ModalSubmitInteraction} interaction
 */
export async function handleImportModal(interaction) {
  const raw = interaction.fields.getTextInputValue('json').trim();
  let data;
  try {
    data = JSON.parse(raw);
  } catch {
    return interaction.reply({ embeds: [errorEmbed('JSON invalide.')], ephemeral: true });
  }
  if (!data || typeof data !== 'object' || !data.panel || !Array.isArray(data.buttons)) {
    return interaction.reply({
      embeds: [errorEmbed('JSON invalide : structure attendue { panel: {...}, buttons: [...] }.')],
      ephemeral: true,
    });
  }
  if (data.version && data.version !== 1) {
    return interaction.reply({
      embeds: [errorEmbed(`Version d'export ${data.version} non supportée.`)],
      ephemeral: true,
    });
  }
  if (data.buttons.length > 25) {
    return interaction.reply({
      embeds: [errorEmbed('Trop de boutons (max 25).')],
      ephemeral: true,
    });
  }

  const panelId = createPanel(interaction.guild.id, {
    title: truncate(data.panel.title || 'Panel importé', LIMITS.EMBED_TITLE),
    description: data.panel.description ? truncate(data.panel.description, LIMITS.EMBED_DESCRIPTION) : null,
    color: data.panel.color ?? 5793266,
    image: data.panel.image ?? null,
    thumbnail: data.panel.thumbnail ?? null,
    display_mode: data.panel.display_mode === 'select' ? 'select' : 'buttons',
  });

  let imported = 0;
  for (const b of data.buttons) {
    try {
      addButton(panelId, {
        label: truncate(b.label || 'Option', LIMITS.BUTTON_LABEL),
        emoji: b.emoji ?? null,
        style: b.style ?? 1,
        category_id: null,
        support_role_ids: '[]',
        ping_role_id: null,
        mention_owner: b.mention_owner ?? 1,
        name_template: b.name_template || 'ticket-{username}-{number}',
        open_message: b.open_message ?? null,
        questions: typeof b.questions === 'string' ? b.questions : JSON.stringify(b.questions || []),
        add_role_on_open: null,
        remove_role_on_close: null,
        create_staff_thread: b.create_staff_thread ?? 0,
        position: b.position ?? 0,
        description: b.description ?? null,
        placeholder_text: b.placeholder_text ?? null,
      });
      imported++;
    } catch {
      // bouton malformé : on skip silencieusement
    }
  }

  return interaction.reply({
    embeds: [
      successEmbed(
        `Panel #${panelId} importé avec ${imported} bouton(s).\n\n` +
          `⚠️ Reconfigure les éléments propres à ce serveur :\n` +
          `• catégorie de tickets, rôles support, rôles ping, rôles add/remove\n` +
          `• via \`/panel addbutton\` (recréer chaque bouton avec les rôles) ou en éditant la DB.\n\n` +
          `Puis envoie-le : \`/panel send panel_id:${panelId} channel:#xxx\``,
      ),
    ],
    ephemeral: true,
  });
}

/**
 * Variante de l'import qui lit le JSON depuis une pièce jointe (.json),
 * pour contourner la limite de 4000 chars du modal.
 * @param {import('discord.js').ChatInputCommandInteraction} interaction
 */
async function importFromAttachment(interaction) {
  const attachment = interaction.options.getAttachment('file', true);
  if (!attachment.name.toLowerCase().endsWith('.json')) {
    return interaction.reply({
      embeds: [errorEmbed("Le fichier doit avoir l'extension .json.")],
      ephemeral: true,
    });
  }
  if (attachment.size > 500 * 1024) {
    return interaction.reply({
      embeds: [errorEmbed('Fichier trop gros (max 500 KB).')],
      ephemeral: true,
    });
  }

  await interaction.deferReply({ ephemeral: true });
  let raw;
  try {
    const res = await fetch(attachment.url);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    raw = await res.text();
  } catch {
    return interaction.editReply({ embeds: [errorEmbed('Impossible de télécharger le fichier.')] });
  }

  let data;
  try {
    data = JSON.parse(raw);
  } catch {
    return interaction.editReply({ embeds: [errorEmbed('JSON invalide.')] });
  }
  if (!data || typeof data !== 'object' || !data.panel || !Array.isArray(data.buttons)) {
    return interaction.editReply({
      embeds: [errorEmbed('Structure attendue : { panel: {...}, buttons: [...] }.')],
    });
  }
  if (data.version && data.version !== 1) {
    return interaction.editReply({
      embeds: [errorEmbed(`Version d'export ${data.version} non supportée.`)],
    });
  }
  if (data.buttons.length > 25) {
    return interaction.editReply({ embeds: [errorEmbed('Trop de boutons (max 25).')] });
  }

  const panelId = createPanel(interaction.guild.id, {
    title: truncate(data.panel.title || 'Panel importé', LIMITS.EMBED_TITLE),
    description: data.panel.description ? truncate(data.panel.description, LIMITS.EMBED_DESCRIPTION) : null,
    color: data.panel.color ?? 5793266,
    image: data.panel.image ?? null,
    thumbnail: data.panel.thumbnail ?? null,
    display_mode: data.panel.display_mode === 'select' ? 'select' : 'buttons',
  });

  let imported = 0;
  for (const b of data.buttons) {
    try {
      addButton(panelId, {
        label: truncate(b.label || 'Option', LIMITS.BUTTON_LABEL),
        emoji: b.emoji ?? null,
        style: b.style ?? 1,
        category_id: null,
        support_role_ids: '[]',
        ping_role_id: null,
        mention_owner: b.mention_owner ?? 1,
        name_template: b.name_template || 'ticket-{username}-{number}',
        open_message: b.open_message ?? null,
        questions: typeof b.questions === 'string' ? b.questions : JSON.stringify(b.questions || []),
        add_role_on_open: null,
        remove_role_on_close: null,
        create_staff_thread: b.create_staff_thread ?? 0,
        position: b.position ?? 0,
        description: b.description ?? null,
        placeholder_text: b.placeholder_text ?? null,
      });
      imported++;
    } catch {}
  }

  return interaction.editReply({
    embeds: [
      successEmbed(
        `Panel #${panelId} importé avec ${imported} bouton(s).\n\n` +
          `⚠️ Reconfigure les éléments propres à ce serveur :\n` +
          `• catégorie de tickets, rôles support, rôles ping, rôles add/remove\n\n` +
          `Puis envoie-le : \`/panel send panel_id:${panelId} channel:#xxx\``,
      ),
    ],
  });
}

/**
 * Met à jour les paramètres d'un bouton existant.
 * Les options omises laissent l'ancienne valeur intacte (COALESCE).
 * Pour vider explicitement un champ, utiliser l'option `clear`.
 * @param {import('discord.js').ChatInputCommandInteraction} interaction
 */
async function editButtonCmd(interaction) {
  const buttonId = interaction.options.getInteger('button_id', true);
  const button = getButton(buttonId);
  if (!button) {
    return interaction.reply({ embeds: [errorEmbed('Bouton introuvable.')], ephemeral: true });
  }
  const panel = getPanel(button.panel_id, interaction.guild.id);
  if (!panel) {
    return interaction.reply({
      embeds: [errorEmbed('Bouton appartient à un autre serveur.')],
      ephemeral: true,
    });
  }

  const clearField = interaction.options.getString('clear');
  if (clearField) {
    clearButtonField(buttonId, clearField);
  }

  const supportRole = interaction.options.getRole('support_role');
  const pingRole = interaction.options.getRole('ping_role');
  const addRole = interaction.options.getRole('add_role_on_open');
  const removeRole = interaction.options.getRole('remove_role_on_close');
  const category = interaction.options.getChannel('category');
  const mentionOwner = interaction.options.getBoolean('mention_owner');
  const staffThread = interaction.options.getBoolean('staff_thread');
  const styleStr = interaction.options.getString('style');

  const patch = {
    label: interaction.options.getString('label'),
    emoji: interaction.options.getString('emoji'),
    style: styleStr ? Number(styleStr) : null,
    category_id: category?.id ?? null,
    support_role_ids: supportRole ? JSON.stringify([supportRole.id]) : null,
    ping_role_id: pingRole?.id ?? null,
    add_role_on_open: addRole?.id ?? null,
    remove_role_on_close: removeRole?.id ?? null,
    mention_owner: mentionOwner === null ? null : mentionOwner ? 1 : 0,
    name_template: interaction.options.getString('name_template'),
    open_message: interaction.options.getString('open_message'),
    description: interaction.options.getString('description'),
    placeholder_text: interaction.options.getString('placeholder_text'),
    create_staff_thread: staffThread === null ? null : staffThread ? 1 : 0,
  };

  updateButton(buttonId, patch);

  const changes = [];
  if (patch.label) changes.push(`label → ${patch.label}`);
  if (patch.emoji) changes.push(`emoji → ${patch.emoji}`);
  if (patch.style) changes.push(`style → ${patch.style}`);
  if (category) changes.push(`catégorie → <#${category.id}>`);
  if (supportRole) changes.push(`support_role → <@&${supportRole.id}>`);
  if (pingRole) changes.push(`ping_role → <@&${pingRole.id}>`);
  if (addRole) changes.push(`add_role_on_open → <@&${addRole.id}>`);
  if (removeRole) changes.push(`remove_role_on_close → <@&${removeRole.id}>`);
  if (patch.name_template) changes.push('name_template modifié');
  if (patch.open_message) changes.push("open_message modifié");
  if (patch.description) changes.push('description modifiée');
  if (patch.placeholder_text) changes.push('placeholder_text modifié');
  if (mentionOwner !== null) changes.push(`mention_owner → ${mentionOwner}`);
  if (staffThread !== null) changes.push(`staff_thread → ${staffThread}`);
  if (clearField) changes.push(`vidé : ${clearField}`);

  if (changes.length === 0) {
    return interaction.reply({
      embeds: [errorEmbed('Aucune modification fournie.')],
      ephemeral: true,
    });
  }

  return interaction.reply({
    embeds: [
      successEmbed(
        `Bouton #${buttonId} mis à jour :\n${changes.map((c) => `• ${c}`).join('\n')}\n\n` +
          `⚠️ Si le panel est déjà envoyé, **renvoie-le** avec \`/panel send panel_id:${button.panel_id} channel:#xxx\` pour que les utilisateurs voient les changements visuels (label/emoji/style/description).`,
      ),
    ],
    ephemeral: true,
  });
}
