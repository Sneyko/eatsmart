import 'dotenv/config';
import pino from 'pino';

const required = ['DISCORD_TOKEN', 'CLIENT_ID'];
for (const key of required) {
  if (!process.env[key]) {
    throw new Error(`Missing required env var: ${key}`);
  }
}

export const config = {
  token: process.env.DISCORD_TOKEN,
  clientId: process.env.CLIENT_ID,
  guildId: process.env.GUILD_ID || null,
  dbPath: process.env.DB_PATH || './data.db',
  dashboardPassword: process.env.DASHBOARD_PASSWORD || null,
  dashboardPort: Number(process.env.DASHBOARD_PORT || process.env.PORT || 8080),
  discordInviteUrl: process.env.DISCORD_INVITE_URL || null,
  logLevel: process.env.LOG_LEVEL || 'info',
  nodeEnv: process.env.NODE_ENV || 'production',
};

export const logger = pino({
  level: config.logLevel,
  transport:
    config.nodeEnv !== 'production'
      ? { target: 'pino-pretty', options: { colorize: true, translateTime: 'SYS:HH:MM:ss' } }
      : undefined,
});
