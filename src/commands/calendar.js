import { EmbedBuilder, SlashCommandBuilder } from 'discord.js';
import { errorEmbed } from '../utils/embeds.js';

const MONTH_NAMES = [
  'Janvier',
  'Février',
  'Mars',
  'Avril',
  'Mai',
  'Juin',
  'Juillet',
  'Août',
  'Septembre',
  'Octobre',
  'Novembre',
  'Décembre',
];

export const data = new SlashCommandBuilder()
  .setName('calendar')
  .setDescription('Afficher un calendrier mensuel')
  .setDMPermission(false)
  .addIntegerOption((o) =>
    o
      .setName('month')
      .setDescription('Mois à afficher (1-12)')
      .setMinValue(1)
      .setMaxValue(12),
  )
  .addIntegerOption((o) =>
    o
      .setName('year')
      .setDescription('Année à afficher')
      .setMinValue(2024)
      .setMaxValue(2035),
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

  const now = getParisDateParts();
  const month = interaction.options.getInteger('month') || now.month;
  const year = interaction.options.getInteger('year') || now.year;
  const calendar = buildMonthCalendar(year, month, now);

  const embed = new EmbedBuilder()
    .setColor(0x8b5cf6)
    .setTitle(`Calendrier — ${MONTH_NAMES[month - 1]} ${year}`)
    .setDescription(`\`\`\`text\n${calendar}\n\`\`\``)
    .setFooter({ text: "Aujourd'hui est marqué par *" })
    .setTimestamp();

  return interaction.reply({ embeds: [embed] });
}

function getParisDateParts() {
  const parts = new Intl.DateTimeFormat('fr-FR', {
    timeZone: 'Europe/Paris',
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
  }).formatToParts(new Date());
  return {
    year: Number(parts.find((part) => part.type === 'year')?.value),
    month: Number(parts.find((part) => part.type === 'month')?.value),
    day: Number(parts.find((part) => part.type === 'day')?.value),
  };
}

function buildMonthCalendar(year, month, today) {
  const firstDay = new Date(Date.UTC(year, month - 1, 1));
  const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const firstWeekday = firstDay.getUTCDay() || 7;
  const cells = [];

  for (let i = 1; i < firstWeekday; i++) cells.push('   ');
  for (let day = 1; day <= daysInMonth; day++) {
    const isToday = today.year === year && today.month === month && today.day === day;
    cells.push(`${String(day).padStart(2, ' ')}${isToday ? '*' : ' '}`);
  }
  while (cells.length % 7 !== 0) cells.push('   ');

  const rows = ['Lun Mar Mer Jeu Ven Sam Dim'];
  for (let i = 0; i < cells.length; i += 7) {
    rows.push(cells.slice(i, i + 7).join(' '));
  }
  return rows.join('\n');
}
