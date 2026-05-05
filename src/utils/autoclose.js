import { listStaleOpenTickets } from '../db/queries.js';
import { closeTicket } from '../handlers/tickets.js';
import { logger } from '../config.js';

const INTERVAL_MS = 30 * 60 * 1000;
let timer = null;

/**
 * Démarre le cron interne qui ferme les tickets inactifs toutes les 30 min.
 * @param {import('discord.js').Client} client
 */
export function startAutoClose(client) {
  if (timer) return;
  const tick = async () => {
    try {
      const stale = listStaleOpenTickets();
      if (stale.length === 0) return;
      logger.info({ count: stale.length }, 'Auto-close pass');
      for (const ticket of stale) {
        try {
          await closeTicket(client, ticket, {
            reason: `Fermeture automatique pour inactivité (${ticket.autoclose_hours}h).`,
            actorId: client.user.id,
            silent: false,
          });
        } catch (err) {
          logger.error({ err, ticketId: ticket.id }, 'Auto-close failed');
        }
      }
    } catch (err) {
      logger.error({ err }, 'Auto-close cron error');
    }
  };
  timer = setInterval(tick, INTERVAL_MS);
  setTimeout(tick, 60 * 1000).unref?.();
  logger.info({ intervalMin: INTERVAL_MS / 60000 }, 'Auto-close cron started');
}

export function stopAutoClose() {
  if (timer) clearInterval(timer);
  timer = null;
}
