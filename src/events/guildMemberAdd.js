import { Events } from 'discord.js';
import { handleInviteMemberAdd } from '../handlers/invites.js';
import { handleGuildMemberAdd } from '../handlers/welcome.js';

export const name = Events.GuildMemberAdd;

export async function execute(member) {
  await handleInviteMemberAdd(member);
  await handleGuildMemberAdd(member);
}
