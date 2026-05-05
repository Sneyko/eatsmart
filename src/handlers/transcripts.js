import discordTranscripts from 'discord-html-transcripts';
import { AttachmentBuilder } from 'discord.js';
import { logger } from '../config.js';

/**
 * Génère un transcript HTML pour un ticket fermé.
 * @param {import('discord.js').TextChannel} channel
 * @param {object} ticket
 * @returns {Promise<AttachmentBuilder|null>}
 */
export async function generateTranscript(channel, ticket) {
  try {
    const attachment = await discordTranscripts.createTranscript(channel, {
      limit: -1,
      filename: `transcript-${ticket.number}-${ticket.channel_id}.html`,
      saveImages: false,
      footerText: 'Exporté le {date}',
      poweredBy: false,
    });
    return attachment;
  } catch (err) {
    logger.error({ err, channelId: channel.id }, 'Transcript generation failed');
    return null;
  }
}

/**
 * Convertit un AttachmentBuilder en attachement frais (Discord rejette le réutiliser tel quel).
 * @param {AttachmentBuilder} a
 */
export function cloneAttachment(a) {
  if (!a) return null;
  return new AttachmentBuilder(a.attachment, { name: a.name });
}
