import { Events } from 'discord.js';
import { handleInviteMemberRemove } from '../handlers/invites.js';

export const name = Events.GuildMemberRemove;
export const execute = handleInviteMemberRemove;
