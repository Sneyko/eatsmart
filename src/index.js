import { Client, Collection, GatewayIntentBits, Partials } from 'discord.js';
import { readdirSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';
import { config, logger } from './config.js';
import { initDb } from './db/schema.js';
import { startDashboard } from './dashboard/server.js';
import { closeTrackingBrowser } from './utils/uberTrackingBrowser.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

initDb();

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildInvites,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.DirectMessages,
  ],
  partials: [Partials.Channel, Partials.Message],
});

client.commands = new Collection();

const commandsDir = join(__dirname, 'commands');
for (const file of readdirSync(commandsDir).filter((f) => f.endsWith('.js'))) {
  const mod = await import(pathToFileURL(join(commandsDir, file)).href);
  if (!mod.data || !mod.execute) {
    logger.warn({ file }, 'Skipping invalid command module');
    continue;
  }
  client.commands.set(mod.data.name, mod);
  logger.debug({ command: mod.data.name }, 'Loaded command');
}

const eventsDir = join(__dirname, 'events');
for (const file of readdirSync(eventsDir).filter((f) => f.endsWith('.js'))) {
  const mod = await import(pathToFileURL(join(eventsDir, file)).href);
  if (!mod.name || !mod.execute) continue;
  if (mod.once) client.once(mod.name, (...a) => mod.execute(...a));
  else client.on(mod.name, (...a) => mod.execute(...a));
  logger.debug({ event: mod.name }, 'Registered event');
}

process.on('unhandledRejection', (err) => logger.error({ err }, 'Unhandled rejection'));
process.on('uncaughtException', (err) => logger.error({ err }, 'Uncaught exception'));

const dashboardServer = startDashboard(client);

let shuttingDown = false;
const shutdown = async (signal) => {
  if (shuttingDown) return;
  shuttingDown = true;
  logger.info({ signal }, 'Shutting down');
  dashboardServer?.close?.();
  await closeTrackingBrowser().catch((err) => {
    logger.warn({ err }, 'Could not close tracking browser');
  });
  client.destroy();
  process.exit(0);
};
process.on('SIGINT', () => { void shutdown('SIGINT'); });
process.on('SIGTERM', () => { void shutdown('SIGTERM'); });

await client.login(config.token);
