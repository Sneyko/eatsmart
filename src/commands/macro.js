import { EmbedBuilder, PermissionFlagsBits, SlashCommandBuilder } from 'discord.js';
import {
  createMacro,
  deleteMacro,
  getMacro,
  getTicketByChannel,
  incrementMacroUses,
  listMacros,
  updateMacro,
} from '../db/queries.js';
import { errorEmbed, infoEmbed, successEmbed } from '../utils/embeds.js';
import { truncate } from '../utils/validators.js';

const NAME_RE = /^[a-z0-9_-]+$/i;
const NAME_MAX = 32;
const CONTENT_MAX = 2000;

export const data = new SlashCommandBuilder()
  .setName('macro')
  .setDescription('Réponses pré-enregistrées (envoi rapide dans un ticket)')
  .setDMPermission(false)
  .addSubcommand((s) =>
    s
      .setName('create')
      .setDescription('Créer une nouvelle macro')
      .addStringOption((o) =>
        o.setName('name').setDescription('Nom (a-z, 0-9, _ et -)').setRequired(true).setMaxLength(NAME_MAX),
      )
      .addStringOption((o) =>
        o.setName('content').setDescription('Contenu envoyé').setRequired(true).setMaxLength(CONTENT_MAX),
      ),
  )
  .addSubcommand((s) =>
    s
      .setName('edit')
      .setDescription('Modifier une macro existante')
      .addStringOption((o) =>
        o.setName('name').setDescription('Nom').setRequired(true).setMaxLength(NAME_MAX),
      )
      .addStringOption((o) =>
        o.setName('content').setDescription('Nouveau contenu').setRequired(true).setMaxLength(CONTENT_MAX),
      ),
  )
  .addSubcommand((s) =>
    s
      .setName('delete')
      .setDescription('Supprimer une macro')
      .addStringOption((o) =>
        o.setName('name').setDescription('Nom').setRequired(true).setMaxLength(NAME_MAX),
      ),
  )
  .addSubcommand((s) => s.setName('list').setDescription('Lister les macros du serveur'))
  .addSubcommand((s) =>
    s
      .setName('send')
      .setDescription('Envoyer une macro dans le ticket courant')
      .addStringOption((o) =>
        o.setName('name').setDescription('Nom').setRequired(true).setMaxLength(NAME_MAX),
      ),
  );

const ADMIN_PERMS = PermissionFlagsBits.ManageGuild;
const isAdmin = (m) => m?.permissions?.has(ADMIN_PERMS);

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
  if (sub === 'create') return createCmd(interaction);
  if (sub === 'edit') return editCmd(interaction);
  if (sub === 'delete') return deleteCmd(interaction);
  if (sub === 'list') return listCmd(interaction);
  if (sub === 'send') return sendCmd(interaction);
}

async function createCmd(interaction) {
  if (!isAdmin(interaction.member)) {
    return interaction.reply({ embeds: [errorEmbed('Permission Manage Guild requise.')], ephemeral: true });
  }
  const name = interaction.options.getString('name', true).trim();
  const content = interaction.options.getString('content', true);
  if (!NAME_RE.test(name)) {
    return interaction.reply({
      embeds: [errorEmbed('Nom invalide. Utilise uniquement a-z, 0-9, _ et -.')],
      ephemeral: true,
    });
  }
  if (getMacro(interaction.guild.id, name)) {
    return interaction.reply({
      embeds: [errorEmbed(`La macro \`${name}\` existe déjà. Utilise \`/macro edit\`.`)],
      ephemeral: true,
    });
  }
  createMacro(interaction.guild.id, name, content, interaction.user.id);
  return interaction.reply({
    embeds: [successEmbed(`Macro \`${name}\` créée.`)],
    ephemeral: true,
  });
}

async function editCmd(interaction) {
  if (!isAdmin(interaction.member)) {
    return interaction.reply({ embeds: [errorEmbed('Permission Manage Guild requise.')], ephemeral: true });
  }
  const name = interaction.options.getString('name', true).trim();
  const content = interaction.options.getString('content', true);
  if (!NAME_RE.test(name)) {
    return interaction.reply({
      embeds: [errorEmbed('Nom invalide.')],
      ephemeral: true,
    });
  }
  const result = updateMacro(interaction.guild.id, name, content);
  if (result.changes === 0) {
    return interaction.reply({
      embeds: [errorEmbed(`Macro \`${name}\` introuvable.`)],
      ephemeral: true,
    });
  }
  return interaction.reply({
    embeds: [successEmbed(`Macro \`${name}\` mise à jour.`)],
    ephemeral: true,
  });
}

async function deleteCmd(interaction) {
  if (!isAdmin(interaction.member)) {
    return interaction.reply({ embeds: [errorEmbed('Permission Manage Guild requise.')], ephemeral: true });
  }
  const name = interaction.options.getString('name', true).trim();
  const result = deleteMacro(interaction.guild.id, name);
  if (result.changes === 0) {
    return interaction.reply({
      embeds: [errorEmbed(`Macro \`${name}\` introuvable.`)],
      ephemeral: true,
    });
  }
  return interaction.reply({
    embeds: [successEmbed(`Macro \`${name}\` supprimée.`)],
    ephemeral: true,
  });
}

async function listCmd(interaction) {
  const rows = listMacros(interaction.guild.id);
  if (rows.length === 0) {
    return interaction.reply({
      embeds: [infoEmbed('Aucune macro. Crée-en une avec `/macro create`.')],
      ephemeral: true,
    });
  }
  const shown = rows.slice(0, 10);
  const lines = shown.map((m) => {
    const snippet = truncate(m.content.replace(/\n/g, ' '), 80);
    return `**\`${m.name}\`** — ${m.uses_count} use${m.uses_count > 1 ? 's' : ''}\n  ${snippet}`;
  });
  const extra = rows.length > shown.length ? `\n\n…et ${rows.length - shown.length} de plus.` : '';
  const embed = new EmbedBuilder()
    .setColor(0x5865f2)
    .setTitle(`Macros (${rows.length})`)
    .setDescription(truncate(lines.join('\n\n') + extra, 4096));
  return interaction.reply({ embeds: [embed], ephemeral: true });
}

async function sendCmd(interaction) {
  const name = interaction.options.getString('name', true).trim();
  const ticket = getTicketByChannel(interaction.channel.id);
  if (!ticket) {
    return interaction.reply({
      embeds: [errorEmbed('À utiliser uniquement dans un channel de ticket.')],
      ephemeral: true,
    });
  }
  const macro = getMacro(interaction.guild.id, name);
  if (!macro) {
    return interaction.reply({
      embeds: [errorEmbed(`Macro \`${name}\` introuvable.`)],
      ephemeral: true,
    });
  }
  incrementMacroUses(macro.id);
  return interaction.reply({ content: macro.content });
}
