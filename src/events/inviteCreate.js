import { Events } from 'discord.js';
import { handleInviteCreate } from '../handlers/invites.js';

export const name = Events.InviteCreate;
export const execute = handleInviteCreate;
