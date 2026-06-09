import { EmbedBuilder } from 'discord.js';
import { logger } from '../config.js';
import {
  claimInviteReward,
  getInviteStats,
  listInviteRewards,
  recordMemberInvite,
  recordMemberLeave,
} from '../db/queries.js';
import { truncate, LIMITS } from '../utils/validators.js';

const inviteSnapshots = new Map();

/**
 * Précharge les compteurs d'invitations pour toutes les guildes.
 * Le bot doit avoir la permission "Gérer le serveur" pour lire les invites.
 * @param {import('discord.js').Client} client
 */
export async function startInviteTracking(client) {
  const guilds = [...client.guilds.cache.values()];
  for (const guild of guilds) {
    await refreshGuildInviteCache(guild);
  }
  logger.info({ guilds: guilds.length }, 'Invite tracking cache initialised');
}

/**
 * Rafraîchit le cache quand une invitation est créée.
 * @param {import('discord.js').Invite} invite
 */
export async function handleInviteCreate(invite) {
  if (invite.guild) await refreshGuildInviteCache(invite.guild);
}

/**
 * Rafraîchit le cache quand une invitation est supprimée.
 * @param {import('discord.js').Invite} invite
 */
export async function handleInviteDelete(invite) {
  if (invite.guild) await refreshGuildInviteCache(invite.guild);
}

/**
 * Détecte l'invitation utilisée par un nouveau membre.
 * @param {import('discord.js').GuildMember} member
 */
export async function handleInviteMemberAdd(member) {
  if (member.user.bot) return;

  const previous = inviteSnapshots.get(member.guild.id) || new Map();
  const next = await fetchInviteSnapshot(member.guild);
  if (!next) {
    recordMemberInvite(member.guild.id, member.id, null, null);
    return;
  }
  inviteSnapshots.set(member.guild.id, next);

  const usedInvite = findUsedInvite(previous, next);
  if (!usedInvite?.inviterId) {
    recordMemberInvite(member.guild.id, member.id, null, usedInvite?.code ?? null);
    logger.debug({ guildId: member.guild.id, memberId: member.id }, 'Invite source unknown');
    return;
  }

  const result = recordMemberInvite(
    member.guild.id,
    member.id,
    usedInvite.inviterId,
    usedInvite.code,
  );
  if (result.counted) {
    logger.info(
      { guildId: member.guild.id, memberId: member.id, inviterId: usedInvite.inviterId },
      'Invite counted',
    );
    await syncInviteRewards(member.guild, usedInvite.inviterId);
  }
}

/**
 * Décrémente l'invitation active quand un membre invité quitte.
 * @param {import('discord.js').GuildMember|import('discord.js').PartialGuildMember} member
 */
export async function handleInviteMemberRemove(member) {
  if (member.user?.bot) return;
  const result = recordMemberLeave(member.guild.id, member.id);
  if (result.counted) {
    logger.info(
      { guildId: member.guild.id, memberId: member.id, inviterId: result.previous.inviter_id },
      'Invite no longer active',
    );
  }
}

/**
 * Attribue les récompenses d'invitation atteintes et non déjà réclamées.
 * @param {import('discord.js').Guild} guild
 * @param {string} userId
 */
export async function syncInviteRewards(guild, userId) {
  const stats = getInviteStats(guild.id, userId);
  const activeInvites = Number(stats.active_invites || 0);
  const rewards = listInviteRewards(guild.id).filter((reward) => activeInvites >= reward.threshold);
  if (rewards.length === 0) return [];

  const granted = [];
  let member = null;
  try {
    member = await guild.members.fetch(userId);
  } catch (err) {
    logger.debug({ err, guildId: guild.id, userId }, 'Could not fetch invite reward member');
  }

  for (const reward of rewards) {
    const claim = claimInviteReward(guild.id, userId, reward.tier_name);
    if (claim.changes === 0) continue;

    if (member && reward.role_id && !member.roles.cache.has(reward.role_id)) {
      try {
        await member.roles.add(reward.role_id, `Récompense invitations: ${reward.tier_name}`);
      } catch (err) {
        logger.warn({ err, roleId: reward.role_id, userId }, 'Could not add invite reward role');
      }
    }

    await announceInviteReward(guild, userId, reward, activeInvites);
    granted.push(reward);
  }
  return granted;
}

async function announceInviteReward(guild, userId, reward, activeInvites) {
  const channel = await resolveAnnounceChannel(guild, reward.announce_channel_id);
  if (!channel?.send) return;

  const roleLine = reward.role_id ? `\nRôle attribué : <@&${reward.role_id}>` : '';
  const embed = new EmbedBuilder()
    .setColor(0x57f287)
    .setTitle('Récompense d’invitations débloquée')
    .setDescription(
      truncate(
        `<@${userId}> a atteint **${activeInvites} invitation(s) active(s)**.\n` +
          `Récompense : **${reward.reward_description}**${roleLine}`,
        LIMITS.EMBED_DESCRIPTION,
      ),
    )
    .setFooter({ text: `Palier: ${reward.tier_name}` })
    .setTimestamp();

  await channel.send({ content: `<@${userId}>`, embeds: [embed] }).catch((err) => {
    logger.debug({ err, channelId: channel.id }, 'Could not announce invite reward');
  });
}

async function resolveAnnounceChannel(guild, channelId) {
  if (channelId) {
    const channel = await guild.channels.fetch(channelId).catch(() => null);
    if (channel?.isTextBased?.()) return channel;
  }
  if (guild.systemChannel?.isTextBased?.()) return guild.systemChannel;
  return null;
}

async function refreshGuildInviteCache(guild) {
  const snapshot = await fetchInviteSnapshot(guild);
  if (snapshot) inviteSnapshots.set(guild.id, snapshot);
}

async function fetchInviteSnapshot(guild) {
  try {
    const invites = await guild.invites.fetch();
    const snapshot = new Map();
    for (const invite of invites.values()) {
      snapshot.set(invite.code, {
        code: invite.code,
        uses: Number(invite.uses || 0),
        inviterId: invite.inviter?.id || invite.inviterId || null,
      });
    }
    return snapshot;
  } catch (err) {
    logger.warn(
      { err, guildId: guild.id },
      'Could not fetch invites. Grant the bot Manage Server to enable invite tracking.',
    );
    return null;
  }
}

function findUsedInvite(previous, next) {
  let best = null;
  for (const invite of next.values()) {
    const before = previous.get(invite.code)?.uses ?? 0;
    const diff = invite.uses - before;
    if (diff <= 0) continue;
    if (!best || diff > best.diff) best = { ...invite, diff };
  }
  return best;
}
