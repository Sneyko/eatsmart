import { EmbedBuilder } from 'discord.js';
import { logger } from '../config.js';
import { getCachedGuildConfig } from '../utils/cache.js';
import { applyVars, truncate, LIMITS } from '../utils/validators.js';

/**
 * Envoie le message de bienvenue et applique le rôle auto, si configuré.
 * @param {import('discord.js').GuildMember} member
 */
export async function handleGuildMemberAdd(member) {
  if (member.user.bot) return;
  const cfg = getCachedGuildConfig(member.guild.id);
  if (!cfg.welcome_enabled) return;

  if (cfg.welcome_role_id) {
    try {
      await member.roles.add(cfg.welcome_role_id, 'Welcome auto-role');
    } catch (err) {
      logger.warn({ err, memberId: member.id }, 'Failed to add welcome role');
    }
  }

  if (!cfg.welcome_channel_id) return;
  const channel = member.guild.channels.cache.get(cfg.welcome_channel_id);
  if (!channel?.isTextBased()) return;

  const ctx = { user: member, guild: member.guild };
  const embed = new EmbedBuilder()
    .setColor(cfg.welcome_color || 0x5865f2)
    .setTitle(truncate(applyVars(cfg.welcome_title || 'Bienvenue !', ctx), LIMITS.EMBED_TITLE))
    .setDescription(
      truncate(
        applyVars(
          cfg.welcome_description ||
            'Bienvenue {user} sur **{server}** ! Tu es notre membre #{membercount}.',
          ctx,
        ),
        LIMITS.EMBED_DESCRIPTION,
      ),
    );
  if (cfg.welcome_image) embed.setImage(cfg.welcome_image);
  if (cfg.welcome_thumbnail) embed.setThumbnail(cfg.welcome_thumbnail);

  try {
    await channel.send({ content: `<@${member.id}>`, embeds: [embed] });
  } catch (err) {
    logger.warn({ err, channelId: channel.id }, 'Welcome message failed');
  }
}
