import { Events } from 'discord.js';
import { handleInviteDelete } from '../handlers/invites.js';

export const name = Events.InviteDelete;
export const execute = handleInviteDelete;
