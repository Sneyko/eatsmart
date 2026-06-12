import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
} from 'discord.js';
import { config, logger } from '../config.js';
import {
  getOrderTrackingByTicket,
  listDueOrderTrackings,
  stopOrderTrackingByTicket,
  updateOrderTracking,
  upsertOrderTracking,
} from '../db/queries.js';
import { truncate } from './validators.js';
import {
  parseUberTrackingText,
  readUberEatsTrackingWithBrowser,
} from './uberTrackingBrowser.js';

const POLL_INTERVAL_MS = Number(process.env.ORDER_TRACKING_POLL_SECONDS || 60) * 1000;
const CHECK_BATCH_SIZE = Number(process.env.ORDER_TRACKING_BATCH_SIZE || 8);
const REMINDER_INTERVAL_SECONDS = Number(process.env.ORDER_TRACKING_REMINDER_MINUTES || 5) * 60;
const ARRIVAL_THRESHOLD_MINUTES = Number(process.env.ORDER_TRACKING_ARRIVAL_THRESHOLD_MINUTES || 3);
const FETCH_TIMEOUT_MS = Number(process.env.ORDER_TRACKING_FETCH_TIMEOUT_MS || 15000);
const UBER_HOST_RE = /(^|\.)ubereats\.com$/i;

let timer = null;
let running = false;

/**
 * Démarre le suivi périodique des commandes Uber Eats actives.
 * @param {import('discord.js').Client} client
 */
export function startOrderTracking(client) {
  if (timer) return;
  const tick = () => runOrderTrackingPass(client).catch((err) => {
    logger.error({ err }, 'Order tracking pass failed');
  });
  timer = setInterval(tick, POLL_INTERVAL_MS);
  setTimeout(tick, 15 * 1000).unref?.();
  logger.info({ intervalSec: POLL_INTERVAL_MS / 1000 }, 'Order tracking started');
}

export function stopOrderTracking() {
  if (timer) clearInterval(timer);
  timer = null;
}

/**
 * Active ou met à jour le suivi Uber lié à un ticket.
 * @param {object} ticket
 */
export function syncOrderTrackingForTicket(ticket) {
  const url = extractUberTrackingUrls(ticket.order_tracking || '')[0];
  if (!url) {
    stopOrderTrackingByTicket(ticket.id, 'Aucun lien Uber Eats détecté');
    return { active: false, reason: 'no_url' };
  }

  const previous = getOrderTrackingByTicket(ticket.id);
  const changed = previous?.tracking_url !== url;
  upsertOrderTracking({
    ticket_id: ticket.id,
    guild_id: ticket.guild_id,
    channel_id: ticket.channel_id,
    owner_id: ticket.owner_id,
    provider: 'ubereats',
    tracking_url: url,
    next_check_at: Math.floor(Date.now() / 1000) + 10,
  });
  return { active: true, changed, url };
}

export function stopOrderTrackingForTicket(ticketId, statusText = 'Suivi arrêté') {
  stopOrderTrackingByTicket(ticketId, statusText);
}

export function extractUberTrackingUrls(text) {
  const links = String(text || '').match(/https?:\/\/[^\s<>()"']+/gi) || [];
  const seen = new Set();
  const urls = [];
  for (const link of links) {
    const cleaned = link.replace(/[.,;!?]+$/g, '');
    let parsed;
    try {
      parsed = new URL(cleaned);
    } catch {
      continue;
    }
    if (!UBER_HOST_RE.test(parsed.hostname)) continue;
    if (!/\/orders\//i.test(parsed.pathname)) continue;
    const normalized = parsed.toString();
    if (!seen.has(normalized)) {
      seen.add(normalized);
      urls.push(normalized);
    }
  }
  return urls;
}

async function runOrderTrackingPass(client) {
  if (running) return;
  running = true;
  try {
    const now = nowSeconds();
    const rows = listDueOrderTrackings(now, CHECK_BATCH_SIZE);
    for (const row of rows) {
      await processTracking(client, row).catch((err) => {
        logger.warn({ err, trackingId: row.id, ticketId: row.ticket_id }, 'Order tracking item failed');
      });
    }
  } finally {
    running = false;
  }
}

async function processTracking(client, row) {
  const now = nowSeconds();
  const autoInfo = await readUberEatsTracking(row.tracking_url);
  const info = mergeWithManualEta(row, autoInfo);
  const nextFailCount = autoInfo.readable ? 0 : Number(row.fail_count || 0) + 1;
  const nextCheck = now + Math.max(30, Math.floor(POLL_INTERVAL_MS / 1000));
  const basePatch = {
    last_checked_at: now,
    next_check_at: nextCheck,
    fail_count: nextFailCount,
    last_eta_minutes: info.etaMinutes ?? row.last_eta_minutes ?? null,
    last_eta_label: info.etaLabel ?? row.last_eta_label ?? null,
    last_status_text: info.statusText ?? row.last_status_text ?? null,
    last_error_reason: autoInfo.readable ? null : autoInfo.errorReason ?? 'unreadable',
  };

  if (!info.readable) {
    if (shouldNotifyManualFallback(row, nextFailCount)) {
      const channel = await client.channels.fetch(row.channel_id).catch(() => null);
      if (channel?.send) {
        await channel.send(buildManualFallbackMessage(row, autoInfo));
        basePatch.manual_fallback_notified_at = now;
        logger.info(
          { trackingId: row.id, ticketId: row.ticket_id, reason: autoInfo.errorReason },
          'Manual ETA fallback requested',
        );
      }
    }
    updateOrderTracking(row.id, basePatch);
    return;
  }

  const channel = await client.channels.fetch(row.channel_id).catch(() => null);
  if (!channel?.send) {
    updateOrderTracking(row.id, {
      ...basePatch,
      next_check_at: now + 10 * 60,
      fail_count: Number(row.fail_count || 0) + 1,
    });
    return;
  }

  if (info.completed && !row.completed_notified_at) {
    await channel.send(buildDeliveredMessage(row, info));
    updateOrderTracking(row.id, {
      ...basePatch,
      active: 0,
      completed_notified_at: now,
      last_status_text: info.statusText || 'Commande livrée',
    });
    return;
  }

  if (info.cancelled && !row.completed_notified_at) {
    await channel.send(buildCancelledMessage(row, info));
    updateOrderTracking(row.id, {
      ...basePatch,
      active: 0,
      completed_notified_at: now,
      last_status_text: info.statusText || 'Commande annulée',
    });
    return;
  }

  const patch = { ...basePatch };
  if (
    Number.isFinite(info.etaMinutes) &&
    info.etaMinutes <= ARRIVAL_THRESHOLD_MINUTES &&
    !row.near_notified_at
  ) {
    await channel.send(buildNearArrivalMessage(row, info));
    patch.near_notified_at = now;
    patch.last_reminder_at = now;
    if (info.pinCode) patch.pin_notified_at = now;
  } else if (shouldSendReminder(row, info, now)) {
    await channel.send(buildReminderMessage(row, info));
    patch.last_reminder_at = now;
  }

  updateOrderTracking(row.id, patch);
}

function shouldSendReminder(row, info, now) {
  if (!Number.isFinite(info.etaMinutes)) return false;
  if (Number.isFinite(info.etaMinutes) && info.etaMinutes <= ARRIVAL_THRESHOLD_MINUTES) return false;
  return !row.last_reminder_at || now - Number(row.last_reminder_at) >= REMINDER_INTERVAL_SECONDS;
}

export async function readUberEatsTracking(url) {
  let browserInfo = null;
  if (config.orderTrackingBrowserEnabled) {
    browserInfo = await readUberEatsTrackingWithBrowser(url);
    if (browserInfo.readable) return browserInfo;
  }

  const fallbackInfo = await readUberEatsTrackingWithFetchFallback(url);
  if (fallbackInfo.readable) return fallbackInfo;
  return browserInfo ?? fallbackInfo;
}

export async function readUberEatsTrackingWithFetchFallback(url) {
  try {
    const html = await fetchTrackingHtml(url);
    const text = normalizeTrackingText(html);
    const parsed = parseUberTrackingText(text);
    return {
      ...parsed,
      source: 'fetch',
      rawTextSample: null,
    };
  } catch (err) {
    logger.debug({ err }, 'Fetch tracking fallback failed');
    return {
      readable: false,
      etaMinutes: null,
      etaLabel: null,
      etaTime: null,
      statusText: null,
      completed: false,
      cancelled: false,
      pinCode: null,
      rawTextSample: truncate(err?.message || 'fetch failed', 1000),
      source: 'fetch',
      errorReason: 'fetch_error',
    };
  }
}

async function fetchTrackingHtml(url) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const response = await fetch(url, {
      redirect: 'follow',
      signal: controller.signal,
      headers: {
        Accept: 'text/html,application/xhtml+xml,application/json;q=0.9,*/*;q=0.8',
        'Accept-Language': 'fr-FR,fr;q=0.9,en;q=0.6',
        'Cache-Control': 'no-cache',
        'User-Agent':
          'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 ' +
          'Chrome/125.0 Safari/537.36 EatSmartBot/1.0',
      },
    });
    if (!response.ok) throw new Error(`Uber tracking unavailable (${response.status})`);
    return response.text();
  } finally {
    clearTimeout(timeout);
  }
}

function normalizeTrackingText(html) {
  const source = String(html || '');
  const statePayloads = [
    extractJsonScriptContent(source, '__REACT_QUERY_STATE__'),
    extractJsonScriptContent(source, '__REDUX_STATE__'),
  ].filter(Boolean);
  const visibleText = source.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, ' ');

  return decodeHtmlEntities(
    [visibleText, ...statePayloads].join(' ')
      .replace(/\\u([0-9a-fA-F]{4})/g, (_, hex) => String.fromCharCode(parseInt(hex, 16)))
      .replace(/\\u003c/gi, '<')
      .replace(/\\u003e/gi, '>')
      .replace(/\\u0026/gi, '&')
      .replace(/\\u002f/gi, '/')
      .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, ' ')
      .replace(/<[^>]+>/g, ' ')
      .replace(/["{}[\],:]+/g, ' ')
      .replace(/\s+/g, ' ')
      .trim(),
  );
}

function extractJsonScriptContent(html, id) {
  const pattern = new RegExp(`<script[^>]+id=["']${id}["'][^>]*>([\\s\\S]*?)<\\/script>`, 'i');
  return html.match(pattern)?.[1] || '';
}

function mergeWithManualEta(row, autoInfo) {
  const manual = buildManualTrackingInfo(row);
  if (!manual || autoInfo.completed || autoInfo.cancelled) return autoInfo;
  if (!autoInfo.readable) {
    return {
      ...manual,
      errorReason: autoInfo.errorReason,
    };
  }
  if (Number.isFinite(autoInfo.etaMinutes)) {
    return {
      ...autoInfo,
      pinCode: autoInfo.pinCode || manual.pinCode,
    };
  }
  return {
    ...autoInfo,
    etaMinutes: manual.etaMinutes,
    etaLabel: manual.etaLabel,
    etaTime: manual.etaTime,
    pinCode: autoInfo.pinCode || manual.pinCode,
  };
}

function buildManualTrackingInfo(row) {
  if (row.manual_eta_minutes === null || row.manual_eta_minutes === undefined) return null;
  const minutes = Number(row.manual_eta_minutes);
  if (!Number.isFinite(minutes)) return null;
  return {
    readable: true,
    etaMinutes: minutes,
    etaLabel: row.manual_eta_label || `${minutes} min`,
    etaTime: null,
    statusText: row.last_status_text || 'ETA manuelle',
    completed: false,
    cancelled: false,
    pinCode: row.manual_pin_code || null,
    rawTextSample: null,
    source: 'manual',
    errorReason: null,
  };
}

function shouldNotifyManualFallback(row, failCount) {
  if (row.manual_fallback_notified_at) return false;
  if (row.manual_eta_minutes !== null && row.manual_eta_minutes !== undefined) return false;
  return failCount >= config.orderTrackingManualFallbackAfterFails;
}

function manualEtaRow() {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId('order:manual-eta')
      .setLabel('Modifier ETA')
      .setEmoji('⏱️')
      .setStyle(ButtonStyle.Secondary),
  );
}

function buildManualFallbackMessage(row, info) {
  const reason = info.errorReason ? `\nRaison technique : \`${truncate(info.errorReason, 80)}\`` : '';
  return {
    content: `<@${row.owner_id}>`,
    embeds: [
      new EmbedBuilder()
        .setColor(0xf59e0b)
        .setTitle('⏱️ ETA manuelle requise')
        .setDescription(
          truncate(
            "Le suivi automatique Uber Eats n'arrive pas à lire l'heure d'arrivée.\n" +
              'Colle une ETA manuelle ou utilise le bouton **Modifier ETA**.' +
              reason,
            4096,
          ),
        )
        .setTimestamp(),
    ],
    components: [manualEtaRow()],
  };
}

function buildReminderMessage(row, info) {
  const eta = formatEta(info);
  return {
    content: `<@${row.owner_id}>`,
    embeds: [
      new EmbedBuilder()
        .setColor(0x5865f2)
        .setTitle('🚗 Suivi de ta commande')
        .setDescription(
          truncate(
            `${eta ? `Arrivée estimée : **${eta}**.` : 'Le suivi est actif.'}\n` +
              `${info.statusText ? `Statut : **${info.statusText}**.` : ''}`,
            4096,
          ),
        )
        .setTimestamp(),
    ],
  };
}

function buildNearArrivalMessage(row, info) {
  const eta = formatEta(info) || 'quelques minutes';
  const description = [
    `Ta commande arrive bientôt : **${eta}**.`,
    info.pinCode ? `Code PIN à donner au livreur : **${info.pinCode}**` : null,
  ].filter(Boolean).join('\n');

  return {
    content: `<@${row.owner_id}>`,
    embeds: [
      new EmbedBuilder()
        .setColor(0xf59e0b)
        .setTitle('📍 Le livreur arrive bientôt')
        .setDescription(truncate(description, 4096))
        .setTimestamp(),
    ],
  };
}

function buildDeliveredMessage(row, info) {
  return {
    content: `<@${row.owner_id}>`,
    embeds: [
      new EmbedBuilder()
        .setColor(0x57f287)
        .setTitle('✅ Commande livrée')
        .setDescription(truncate(info.statusText || 'La commande semble livrée.', 4096))
        .setTimestamp(),
    ],
  };
}

function buildCancelledMessage(row, info) {
  return {
    content: `<@${row.owner_id}>`,
    embeds: [
      new EmbedBuilder()
        .setColor(0xed4245)
        .setTitle('❌ Suivi de commande arrêté')
        .setDescription(truncate(info.statusText || 'La commande semble annulée.', 4096))
        .setTimestamp(),
    ],
  };
}

function formatEta(info) {
  if (info.etaLabel) return info.etaLabel;
  if (Number.isFinite(info.etaMinutes)) return `${info.etaMinutes} min`;
  return null;
}

function decodeHtmlEntities(value) {
  return String(value || '')
    .replace(/&quot;/g, '"')
    .replace(/&#x27;/g, "'")
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>');
}

function nowSeconds() {
  return Math.floor(Date.now() / 1000);
}
