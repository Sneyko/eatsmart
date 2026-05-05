import { REST, Routes } from 'discord.js';
import { readdirSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';
import { config, logger } from './config.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

const commands = [];
const dir = join(__dirname, 'commands');
for (const file of readdirSync(dir).filter((f) => f.endsWith('.js'))) {
  const mod = await import(pathToFileURL(join(dir, file)).href);
  if (mod.data) commands.push(mod.data.toJSON());
}

const rest = new REST({ version: '10' }).setToken(config.token);

try {
  if (config.guildId) {
    logger.info({ guildId: config.guildId, count: commands.length }, 'Deploying GUILD commands');
    await rest.put(Routes.applicationGuildCommands(config.clientId, config.guildId), {
      body: commands,
    });
  } else {
    logger.info({ count: commands.length }, 'Deploying GLOBAL commands (peut prendre 1h)');
    await rest.put(Routes.applicationCommands(config.clientId), { body: commands });
  }
  logger.info('Commands deployed.');
} catch (err) {
  logger.error({ err }, 'Failed to deploy commands');
  process.exit(1);
}
