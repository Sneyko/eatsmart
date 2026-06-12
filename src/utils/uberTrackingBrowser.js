import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { chromium, devices } from 'playwright';
import { config, logger } from '../config.js';
import { truncate } from './validators.js';

const MOBILE_DEVICE = devices['iPhone 13'] || devices['iPhone 11'];
const TRACKING_USER_AGENT =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 ' +
  '(KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1 EatSmartBot/1.0';

let browserPromise = null;
let activeBrowserReads = 0;
const browserQueue = [];

export async function readUberEatsTrackingWithBrowser(url) {
  const release = await acquireBrowserSlot();
  let context = null;
  let page = null;
  try {
    const browser = await getTrackingBrowser();
    context = await browser.newContext({
      ...(MOBILE_DEVICE || {}),
      locale: 'fr-FR',
      timezoneId: 'Europe/Paris',
      userAgent: TRACKING_USER_AGENT,
      viewport: MOBILE_DEVICE?.viewport || { width: 390, height: 844 },
      isMobile: true,
      hasTouch: true,
    });
    page = await context.newPage();
    page.setDefaultTimeout(config.orderTrackingNavigationTimeoutMs);
    page.setDefaultNavigationTimeout(config.orderTrackingNavigationTimeoutMs);

    logger.debug(trackingLogMeta(url), 'Reading Uber Eats tracking page with browser');
    await page.goto(url, {
      waitUntil: 'domcontentloaded',
      timeout: config.orderTrackingNavigationTimeoutMs,
    });
    await page.waitForLoadState('networkidle', { timeout: 8000 }).catch(() => {});
    await page.waitForTimeout(config.orderTrackingRenderWaitMs);

    const [title, locatorText, evaluatedText] = await Promise.all([
      page.title().catch(() => ''),
      page.locator('body').innerText({ timeout: 5000 }).catch(() => ''),
      page.evaluate(() => document.body?.innerText || '').catch(() => ''),
    ]);
    const text = normalizeVisibleText([title, locatorText, evaluatedText].join('\n'));
    const parsed = parseUberTrackingText(text);

    if (!parsed.readable && config.orderTrackingScreenshotOnFail) {
      await saveFailureScreenshot(page, url).catch((err) => {
        logger.debug({ err, ...trackingLogMeta(url) }, 'Could not save tracking screenshot');
      });
    }

    if (parsed.readable) {
      logger.debug(
        { ...trackingLogMeta(url), etaMinutes: parsed.etaMinutes, statusText: parsed.statusText },
        'Uber Eats tracking page parsed',
      );
    } else {
      logger.debug(
        { ...trackingLogMeta(url), reason: parsed.errorReason },
        'Uber Eats tracking page unreadable',
      );
    }

    return {
      ...parsed,
      rawTextSample: text ? truncate(text, 1000) : null,
      source: 'browser',
    };
  } catch (err) {
    logger.debug({ err, ...trackingLogMeta(url) }, 'Browser tracking read failed');
    if (page && config.orderTrackingScreenshotOnFail) {
      await saveFailureScreenshot(page, url).catch(() => {});
    }
    return unreadableResult('browser_error', err?.message);
  } finally {
    await page?.close().catch(() => {});
    await context?.close().catch(() => {});
    release();
  }
}

export async function closeTrackingBrowser() {
  const browser = await browserPromise?.catch(() => null);
  browserPromise = null;
  if (!browser) return;
  await browser.close();
  logger.info('Order tracking browser closed');
}

export function parseUberTrackingText(text) {
  const normalized = normalizeVisibleText(text);
  const lower = normalized.toLowerCase();
  if (!normalized || normalized.length < 20) return unreadableResult('empty_text');
  if (/(connectez-vous|connexion|sign in|log in|login|required session|session expir)/i.test(lower)) {
    return unreadableResult('login_required');
  }
  if (/(captcha|verify you are human|vérifier que vous êtes humain)/i.test(lower)) {
    return unreadableResult('captcha_or_verification');
  }

  const eta = extractEta(normalized);
  const status = extractStatus(normalized);
  const pinCode = extractPinCode(normalized);

  return {
    readable: Boolean(eta || status.statusText || pinCode),
    etaMinutes: eta?.minutes ?? null,
    etaLabel: eta?.label ?? null,
    etaTime: eta?.time ?? null,
    statusText: status.statusText,
    completed: status.completed,
    cancelled: status.cancelled,
    pinCode,
    rawTextSample: null,
    source: 'browser',
    errorReason: eta || status.statusText || pinCode ? null : 'no_tracking_signal',
  };
}

export function parseManualEtaInput(value) {
  const parsed = extractEta(normalizeVisibleText(value));
  if (!parsed) return null;
  return {
    etaMinutes: parsed.minutes,
    etaLabel: parsed.label,
    etaTime: parsed.time ?? null,
  };
}

async function getTrackingBrowser() {
  if (!browserPromise) {
    browserPromise = chromium
      .launch({
        headless: config.orderTrackingHeadless,
        args: ['--no-sandbox', '--disable-dev-shm-usage'],
      })
      .catch((err) => {
        browserPromise = null;
        throw err;
      });
    logger.info(
      { headless: config.orderTrackingHeadless },
      'Order tracking browser starting',
    );
  }
  return browserPromise;
}

async function acquireBrowserSlot() {
  const max = config.orderTrackingMaxConcurrentBrowsers;
  if (activeBrowserReads < max) {
    activeBrowserReads += 1;
    return releaseBrowserSlot;
  }
  await new Promise((resolve) => browserQueue.push(resolve));
  activeBrowserReads += 1;
  return releaseBrowserSlot;
}

function releaseBrowserSlot() {
  activeBrowserReads = Math.max(0, activeBrowserReads - 1);
  const next = browserQueue.shift();
  if (next) next();
}

function extractEta(text) {
  const patterns = [
    /\b(\d{1,3})\s*[-–]\s*(\d{1,3})\s*(?:min|mins|minute|minutes)\b/i,
    /(?:arriv[ée]e?|arrive|arrives|eta|estim[ée]e?|livraison|delivery|dropoff|dans|in)[^0-9]{0,100}(\d{1,3})\s*(?:min|mins|minute|minutes)\b/i,
    /\b(\d{1,3})\s*(?:min|mins|minute|minutes)\s*(?:restantes?|remaining|avant|jusqu|until|left)\b/i,
    /\b(\d{1,3})\s*(?:min|mins|minute|minutes)\b/i,
  ];
  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (!match) continue;
    const first = Number(match[1]);
    const second = Number(match[2]);
    const minutes = Number.isFinite(second) ? Math.max(first, second) : first;
    if (minutes >= 0 && minutes <= 180) {
      return {
        minutes,
        label: Number.isFinite(second) ? `${first}-${second} min` : `${minutes} min`,
      };
    }
  }

  const timePatterns = [
    /(?:arriv[ée]e?|livraison|estim[ée]e?|estimated arrival|delivery)[^0-9]{0,100}(\d{1,2})\s*(?:h|:)\s*(\d{2})(?:\s*([ap]\.?m\.?))?/i,
    /\b(\d{1,2})\s*(?:h|:)\s*(\d{2})(?:\s*([ap]\.?m\.?))?\b/i,
  ];
  for (const pattern of timePatterns) {
    const match = text.match(pattern);
    if (!match) continue;
    const hour = Number(match[1]);
    const minute = Number(match[2]);
    if (!Number.isFinite(hour) || !Number.isFinite(minute)) continue;
    const eta = minutesUntilClockTime(hour, minute, match[3]);
    if (!eta) continue;
    return eta;
  }

  return null;
}

function extractStatus(text) {
  const lower = text.toLowerCase();
  if (
    /(commande|order)[^.!?\n]{0,100}(livr[ée]e?|delivered)/i.test(lower) ||
    /(livr[ée]e?|delivered)[^.!?\n]{0,100}(commande|order|successfully|avec succ[èe]s)/i.test(lower)
  ) {
    return { statusText: 'Commande livrée', completed: true, cancelled: false };
  }
  if (
    /(commande|order)[^.!?\n]{0,100}(annul[ée]e?|cancelled|canceled)/i.test(lower) ||
    /(annul[ée]e?|cancelled|canceled)[^.!?\n]{0,100}(commande|order)/i.test(lower)
  ) {
    return { statusText: 'Commande annulée', completed: false, cancelled: true };
  }
  if (/(livreur|courier|driver)[^.!?\n]{0,80}(arrive|arriv|near|bient[ôo]t)/i.test(lower)) {
    return { statusText: 'Le livreur arrive', completed: false, cancelled: false };
  }
  if (/(en route|on the way|heading your way|dropoff|approche)/i.test(lower)) {
    return { statusText: 'En route', completed: false, cancelled: false };
  }
  if (/(prépar|prepar|being prepared|restaurant prépare)/i.test(lower)) {
    return { statusText: 'Préparation', completed: false, cancelled: false };
  }
  if (/(pickup|récupér|collecte|picked up)/i.test(lower)) {
    return { statusText: 'Récupération', completed: false, cancelled: false };
  }
  return { statusText: null, completed: false, cancelled: false };
}

function extractPinCode(text) {
  const patterns = [
    /\b(?:pin|code\s*pin|code\s+de\s+(?:livraison|confirmation|s[ée]curit[ée]))\b[^0-9]{0,80}\b(\d{4,6})\b/i,
    /\b(\d{4,6})\b[^a-z0-9]{0,40}\b(?:pin|code\s*pin|code\s+de\s+(?:livraison|confirmation|s[ée]curit[ée]))\b/i,
  ];
  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match?.[1]) return match[1];
  }
  return null;
}

function minutesUntilClockTime(rawHour, minute, meridiem) {
  let hour = rawHour;
  if (meridiem) {
    const normalized = meridiem.toLowerCase().replaceAll('.', '');
    if (normalized === 'pm' && hour < 12) hour += 12;
    if (normalized === 'am' && hour === 12) hour = 0;
  }
  if (hour < 0 || hour > 23 || minute < 0 || minute > 59) return null;

  const now = new Date();
  const target = new Date(now);
  target.setHours(hour, minute, 0, 0);
  let diff = Math.round((target.getTime() - now.getTime()) / 60000);
  if (diff < -30) {
    target.setDate(target.getDate() + 1);
    diff = Math.round((target.getTime() - now.getTime()) / 60000);
  }
  if (diff < 0 || diff > 24 * 60) return null;

  const time = `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
  return {
    minutes: diff,
    label: diff <= 1 ? '1 min' : `${diff} min (${time})`,
    time,
  };
}

function unreadableResult(errorReason, message = null) {
  return {
    readable: false,
    etaMinutes: null,
    etaLabel: null,
    etaTime: null,
    statusText: null,
    completed: false,
    cancelled: false,
    pinCode: null,
    rawTextSample: message ? truncate(String(message), 1000) : null,
    source: 'browser',
    errorReason,
  };
}

function normalizeVisibleText(text) {
  return String(text || '')
    .replace(/\u00a0/g, ' ')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

async function saveFailureScreenshot(page, url) {
  await mkdir(config.orderTrackingScreenshotDir, { recursive: true });
  const filename = `${Date.now()}-${safeTrackingId(url)}.png`;
  await page.screenshot({
    path: join(config.orderTrackingScreenshotDir, filename),
    fullPage: true,
  });
}

function trackingLogMeta(url) {
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    return { host: 'invalid', trackingId: null };
  }
  if (!['http:', 'https:'].includes(parsed.protocol)) {
    return { host: parsed.protocol.replace(':', '') || 'local', trackingId: 'local' };
  }
  return {
    host: parsed.hostname,
    trackingId: safeTrackingId(url),
  };
}

function safeTrackingId(url) {
  try {
    const parsed = new URL(url);
    if (!['http:', 'https:'].includes(parsed.protocol)) return 'local';
    const uuid = parsed.pathname.match(/[0-9a-f]{8}-[0-9a-f-]{27,}/i)?.[0];
    return uuid || parsed.pathname.split('/').filter(Boolean).at(-1) || 'tracking';
  } catch {
    return 'tracking';
  }
}
