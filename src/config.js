import 'dotenv/config';
import pino from 'pino';

const required = ['DISCORD_TOKEN', 'CLIENT_ID'];
for (const key of required) {
  if (!process.env[key]) {
    throw new Error(`Missing required env var: ${key}`);
  }
}

function boolEnv(key, fallback) {
  const value = process.env[key];
  if (value === undefined || value === '') return fallback;
  return ['1', 'true', 'yes', 'on'].includes(String(value).toLowerCase());
}

function numberEnv(key, fallback) {
  const n = Number(process.env[key]);
  return Number.isFinite(n) ? n : fallback;
}

export const config = {
  token: process.env.DISCORD_TOKEN,
  clientId: process.env.CLIENT_ID,
  guildId: process.env.GUILD_ID || null,
  dbPath: process.env.DB_PATH || './data.db',
  dashboardPassword: process.env.DASHBOARD_PASSWORD || null,
  dashboardPort: Number(process.env.DASHBOARD_PORT || process.env.PORT || 8080),
  discordInviteUrl: process.env.DISCORD_INVITE_URL || null,
  orderTrackingBrowserEnabled: boolEnv('ORDER_TRACKING_BROWSER_ENABLED', true),
  orderTrackingHeadless: boolEnv('ORDER_TRACKING_HEADLESS', true),
  orderTrackingNavigationTimeoutMs: numberEnv('ORDER_TRACKING_NAVIGATION_TIMEOUT_MS', 30000),
  orderTrackingRenderWaitMs: numberEnv('ORDER_TRACKING_RENDER_WAIT_MS', 6000),
  orderTrackingMaxConcurrentBrowsers: Math.max(
    1,
    numberEnv('ORDER_TRACKING_MAX_CONCURRENT_BROWSERS', 1),
  ),
  orderTrackingManualFallbackAfterFails: Math.max(
    1,
    numberEnv('ORDER_TRACKING_MANUAL_FALLBACK_AFTER_FAILS', 3),
  ),
  orderTrackingScreenshotOnFail: boolEnv('ORDER_TRACKING_SCREENSHOT_ON_FAIL', false),
  orderTrackingScreenshotDir:
    process.env.ORDER_TRACKING_SCREENSHOT_DIR || './debug/order-tracking',
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
