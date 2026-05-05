import { Events } from 'discord.js';
import { recordMessage } from '../handlers/tickets.js';

export const name = Events.MessageCreate;

/**
 * @param {import('discord.js').Message} message
 */
export async function execute(message) {
  if (!message.guild || message.author.bot) return;
  await recordMessage(message);
}
