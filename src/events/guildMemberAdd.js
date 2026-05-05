import { Events } from 'discord.js';
import { handleGuildMemberAdd } from '../handlers/welcome.js';

export const name = Events.GuildMemberAdd;
export const execute = handleGuildMemberAdd;
