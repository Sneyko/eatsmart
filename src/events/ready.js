import { Events } from 'discord.js';
import { logger } from '../config.js';
import { startAutoClose } from '../utils/autoclose.js';
import { startGiveawayScheduler } from '../handlers/giveaways.js';
import { startInviteTracking } from '../handlers/invites.js';
import { startOrderTracking } from '../utils/orderTracking.js';

export const name = Events.ClientReady;
export const once = true;

/**
 * @param {import('discord.js').Client} client
 */
export function execute(client) {
  logger.info({ tag: client.user.tag, id: client.user.id }, 'Bot ready');
  startAutoClose(client);
  startOrderTracking(client);
  startGiveawayScheduler(client);
  startInviteTracking(client).catch((err) => {
    logger.warn({ err }, 'Invite tracking startup failed');
  });
}
