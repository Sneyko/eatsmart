import express from 'express';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ChannelType } from 'discord.js';
import { config, logger } from '../config.js';
import { getDb } from '../db/schema.js';
import {
  addButton,
  countButtons,
  createPanel,
  deleteButton,
  deletePanel,
  deletePanelsByGuild,
  ensureGuildConfig,
  getButton,
  getButtons,
  getPanel,
  deleteLoyaltyTier,
  listAllLoyaltyTiers,
  listPanels,
  replaceButton,
  statsCount,
  statsOrderCount,
  updatePanel,
  updatePanelMessage,
  updateTicketsConfig,
  upsertLoyaltyTier,
} from '../db/queries.js';
import { buildPanelMessage } from '../handlers/tickets.js';
import { invalidateGuildConfig } from '../utils/cache.js';
import { LIMITS, parseColor, truncate } from '../utils/validators.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const publicDir = join(__dirname, 'public');
const siteDir = join(publicDir, 'site');
const sessions = new Map();
const SESSION_TTL_MS = 12 * 60 * 60 * 1000;
let dashboardServer;

setInterval(() => {
  const now = Date.now();
  for (const [token, session] of sessions) {
    if (session.expiresAt <= now) sessions.delete(token);
  }
}, 10 * 60 * 1000).unref?.();

function fail(message, status = 400) {
  const err = new Error(message);
  err.status = status;
  throw err;
}

function asyncRoute(handler) {
  return (req, res, next) => Promise.resolve(handler(req, res, next)).catch(next);
}

function parseCookies(header = '') {
  return Object.fromEntries(
    header
      .split(';')
      .map((part) => part.trim())
      .filter(Boolean)
      .map((part) => {
        const index = part.indexOf('=');
        if (index === -1) return [part, ''];
        return [part.slice(0, index), decodeURIComponent(part.slice(index + 1))];
      }),
  );
}

function getSession(req) {
  const token = parseCookies(req.headers.cookie).dashboard_session;
  if (!token) return null;
  const session = sessions.get(token);
  if (!session || session.expiresAt <= Date.now()) {
    sessions.delete(token);
    return null;
  }
  session.expiresAt = Date.now() + SESSION_TTL_MS;
  return session;
}

function makeCookie(req, token, maxAge = SESSION_TTL_MS / 1000) {
  const parts = [
    `dashboard_session=${encodeURIComponent(token)}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
    `Max-Age=${Math.floor(maxAge)}`,
  ];
  if (req.secure) parts.push('Secure');
  return parts.join('; ');
}

function clearCookie() {
  return 'dashboard_session=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0';
}

function normalizedInviteUrl() {
  const inviteUrl = String(config.discordInviteUrl || '').trim();
  if (!inviteUrl) return null;
  try {
    const parsedUrl = new URL(inviteUrl);
    if (!['http:', 'https:'].includes(parsedUrl.protocol)) return null;
    return parsedUrl.href;
  } catch {
    return null;
  }
}

function isSocialCrawler(req) {
  const userAgent = String(req.headers['user-agent'] || '');
  return /\b(Discordbot|Twitterbot|facebookexternalhit|Facebot|Slackbot|LinkedInBot|WhatsApp|TelegramBot|SkypeUriPreview|Pinterest|redditbot|Applebot)\b/i.test(
    userAgent,
  );
}

function renderInvitePreviewPage(inviteUrl) {
  return `<!doctype html>
<html lang="fr">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <meta http-equiv="refresh" content="0; url=${inviteUrl}" />
    <meta property="og:type" content="website" />
    <meta property="og:url" content="https://www.eatsmart.tech/invite" />
    <meta property="og:title" content="Rejoins le serveur Discord EatSmart" />
    <meta property="og:description" content="Commande et suis tes demandes directement dans le Discord EatSmart." />
    <meta property="og:image" content="https://www.eatsmart.tech/site/assets/banner.gif" />
    <meta property="og:image:width" content="800" />
    <meta property="og:image:height" content="450" />
    <meta name="twitter:card" content="summary_large_image" />
    <meta name="twitter:title" content="Rejoins le serveur Discord EatSmart" />
    <meta name="twitter:description" content="Commande et suis tes demandes directement dans le Discord EatSmart." />
    <meta name="twitter:image" content="https://www.eatsmart.tech/site/assets/banner.gif" />
    <title>Rejoins EatSmart</title>
    <link rel="stylesheet" href="/site/styles.css" />
  </head>
  <body class="error-page">
    <main class="error-shell">
      <a class="brand" href="/" aria-label="Accueil EatSmart">
        <span class="brand-mark">ES</span>
        <span>EatSmart</span>
      </a>
      <section class="error-card">
        <p class="eyebrow">Discord EatSmart</p>
        <h1>Rejoins le serveur EatSmart.</h1>
        <p>Tu vas être redirigé vers Discord.</p>
        <a class="button button-primary" href="${inviteUrl}">Ouvrir Discord</a>
      </section>
    </main>
  </body>
</html>`;
}

function safePasswordEquals(input, expected) {
  const left = Buffer.from(String(input || ''));
  const right = Buffer.from(String(expected || ''));
  return left.length === right.length && timingSafeEqual(left, right);
}

function requireAuth(req, res, next) {
  if (!config.dashboardPassword) {
    return res.status(503).json({
      error: 'DASHBOARD_PASSWORD doit être défini dans les variables d’environnement.',
    });
  }
  if (!getSession(req)) return res.status(401).json({ error: 'Session expirée.' });
  return next();
}

function normalizeText(value, max, label, { required = false, fallback = null, multiline = false } = {}) {
  const raw = value === null || value === undefined ? '' : String(value);
  const text = (multiline ? raw.replaceAll('\\n', '\n') : raw).trim();
  if (required && !text) fail(`${label} est requis.`);
  if (!text) return fallback;
  if (text.length > max) fail(`${label} dépasse ${max} caractères.`);
  return text;
}

function normalizeUrl(value, label) {
  const text = normalizeText(value, 500, label);
  if (!text) return null;
  if (!/^https?:\/\//i.test(text)) fail(`${label} doit commencer par http:// ou https://.`);
  return text;
}

function normalizeColor(value) {
  if (typeof value === 'number') return value & 0xffffff;
  const text = String(value ?? '').trim();
  if (!text) return 0x5865f2;
  if (!/^#?[0-9a-f]{6}$/i.test(text)) fail('Couleur hexadécimale invalide.');
  return parseColor(text);
}

function colorToHex(color) {
  return `#${Number(color || 0x5865f2).toString(16).padStart(6, '0').slice(-6)}`;
}

function normalizeMode(value) {
  return value === 'select' ? 'select' : 'buttons';
}

function normalizeSnowflake(value, label) {
  const text = String(value ?? '').trim();
  if (!text) return null;
  if (!/^\d{5,30}$/.test(text)) fail(`${label} invalide.`);
  return text;
}

function parseArray(value) {
  if (Array.isArray(value)) return value;
  if (!value) return [];
  if (typeof value !== 'string') return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function normalizeRoleIds(value, singleValue) {
  const ids = parseArray(value);
  if (ids.length === 0 && singleValue) ids.push(singleValue);
  return ids.map((id) => normalizeSnowflake(id, 'Rôle')).filter(Boolean);
}

function normalizeQuestions(value) {
  const questions = parseArray(value);
  if (questions.length > 5) fail('Un formulaire Discord accepte 5 questions maximum.');
  return questions
    .map((question, index) => {
      const label = normalizeText(question?.label, 45, `Question ${index + 1}`);
      if (!label) return null;
      return {
        label,
        placeholder: normalizeText(question?.placeholder, 100, `Placeholder ${index + 1}`),
        required: question?.required === false ? false : true,
        long: question?.long === false ? false : true,
      };
    })
    .filter(Boolean);
}

function normalizePanelPayload(payload, fallbackTitle = null) {
  return {
    title: normalizeText(payload?.title ?? fallbackTitle, LIMITS.EMBED_TITLE, 'Titre', {
      required: true,
    }),
    description: normalizeText(payload?.description, LIMITS.EMBED_DESCRIPTION, 'Description', {
      multiline: true,
    }),
    color: normalizeColor(payload?.color_hex || payload?.color),
    image: normalizeUrl(payload?.image, 'Image'),
    thumbnail: normalizeUrl(payload?.thumbnail, 'Thumbnail'),
    display_mode: normalizeMode(payload?.display_mode || payload?.mode),
  };
}

function normalizeButtonPayload(payload, defaultPosition = 0) {
  const supportRoleIds = normalizeRoleIds(payload?.support_role_ids, payload?.support_role_id);
  const questions = payload?.questions_enabled === false ? [] : normalizeQuestions(payload?.questions);
  const style = Number(payload?.style ?? 1);
  if (![1, 2, 3, 4].includes(style)) fail('Style de bouton invalide.');

  return {
    label: normalizeText(payload?.label, LIMITS.BUTTON_LABEL, 'Label', { required: true }),
    emoji: normalizeText(payload?.emoji, 100, 'Émoji'),
    style,
    category_id: normalizeSnowflake(payload?.category_id, 'Catégorie de tickets'),
    support_role_ids: JSON.stringify(supportRoleIds),
    ping_role_id: normalizeSnowflake(payload?.ping_role_id, 'Rôle ping'),
    mention_owner: payload?.mention_owner === false ? 0 : 1,
    name_template:
      normalizeText(payload?.name_template, LIMITS.CHANNEL_NAME, 'Template de salon') ||
      'ticket-{username}-{number}',
    open_message: normalizeText(payload?.open_message, LIMITS.EMBED_DESCRIPTION, "Message d'ouverture", {
      multiline: true,
    }),
    questions: JSON.stringify(questions),
    add_role_on_open: normalizeSnowflake(payload?.add_role_on_open, "Rôle ajouté à l'ouverture"),
    remove_role_on_close: normalizeSnowflake(payload?.remove_role_on_close, 'Rôle retiré à la fermeture'),
    create_staff_thread: payload?.create_staff_thread ? 1 : 0,
    position: Number.isInteger(Number(payload?.position)) ? Number(payload.position) : defaultPosition,
    description: normalizeText(payload?.description, 100, 'Description option'),
    placeholder_text: normalizeText(payload?.placeholder_text, 150, 'Placeholder du menu'),
    claimed_category_id: normalizeSnowflake(payload?.claimed_category_id, 'Catégorie après claim'),
  };
}

function parseButtonQuestions(raw) {
  return parseArray(raw).slice(0, 5);
}

function firstSupportRoleId(value) {
  return parseArray(value)[0] || '';
}

function buttonToPayload(button) {
  const supportRoleIds = parseArray(button.support_role_ids);
  return {
    ...button,
    support_role_ids: supportRoleIds,
    support_role_id: supportRoleIds[0] || '',
    questions: parseButtonQuestions(button.questions),
    questions_enabled: parseButtonQuestions(button.questions).length > 0,
  };
}

function panelToPayload(panel, buttons = []) {
  return {
    ...panel,
    color_hex: colorToHex(panel.color),
    mode_label: panel.display_mode === 'select' ? 'Menu déroulant' : 'Boutons',
    buttons: buttons.map(buttonToPayload),
  };
}

function configToPayload(cfg) {
  return {
    ...cfg,
    support_role_ids: parseArray(cfg.support_role_ids),
    support_role_id: firstSupportRoleId(cfg.support_role_ids),
  };
}

function normalizeGuildConfigPayload(payload) {
  return {
    ticket_category_id: normalizeSnowflake(payload?.ticket_category_id, 'Catégorie des tickets') || '',
    log_channel_id: normalizeSnowflake(payload?.log_channel_id, 'Salon des logs') || '',
    transcript_channel_id: normalizeSnowflake(payload?.transcript_channel_id, 'Salon des transcripts') || '',
    support_role_ids: JSON.stringify(normalizeRoleIds(payload?.support_role_ids, payload?.support_role_id)),
  };
}

function normalizeLoyaltyScope(value) {
  if (value === 'client' || value === 'cuistot') return value;
  fail('Type de palier invalide.');
}

function normalizeLoyaltyTierPayload(payload) {
  const threshold = Number(payload?.threshold);
  const position = Number(payload?.position ?? 0);
  const roleId = normalizeSnowflake(payload?.role_id, 'Rôle Discord');
  if (!Number.isInteger(threshold) || threshold < 0 || threshold > 100000) {
    fail('Nombre de commandes minimum invalide.');
  }
  if (!Number.isInteger(position) || position < 0 || position > 20) {
    fail("Position d'affichage invalide.");
  }
  if (!roleId) fail('Rôle Discord requis.');
  return {
    scope: normalizeLoyaltyScope(payload?.scope),
    tier_name: normalizeText(payload?.tier_name, 32, 'Nom du palier', { required: true }),
    threshold,
    role_id: roleId,
    position,
  };
}

function loyaltyTiersToPayload(tiers) {
  const grouped = { client: [], cuistot: [] };
  for (const tier of tiers) {
    if (!grouped[tier.scope]) continue;
    grouped[tier.scope].push(tier);
  }
  for (const scope of Object.keys(grouped)) {
    grouped[scope].sort((a, b) => a.threshold - b.threshold || a.position - b.position);
  }
  return grouped;
}

function getPanelsWithButtons(guildId) {
  return listPanels(guildId).map((panel) => panelToPayload(panel, getButtons(panel.id)));
}

async function resolveGuild(client, req) {
  if (!client.isReady()) fail("Le bot n'est pas encore prêt.", 503);
  const requestedGuildId = req.query.guild_id || req.body?.guild_id || config.guildId;
  if (requestedGuildId) {
    const guild =
      client.guilds.cache.get(requestedGuildId) ||
      (await client.guilds.fetch(requestedGuildId).catch(() => null));
    if (!guild) fail('Serveur Discord introuvable pour ce bot.', 404);
    return guild;
  }
  const firstGuild = client.guilds.cache.first();
  if (!firstGuild) fail("Le bot n'est présent sur aucun serveur.", 404);
  return firstGuild;
}

async function getDiscordOptions(guild) {
  await Promise.all([guild.channels.fetch().catch(() => null), guild.roles.fetch().catch(() => null)]);
  const textTypes = new Set([ChannelType.GuildText, ChannelType.GuildAnnouncement]);
  const channels = [...guild.channels.cache.values()]
    .filter((channel) => textTypes.has(channel.type))
    .sort((a, b) => a.rawPosition - b.rawPosition)
    .map((channel) => ({ id: channel.id, name: `#${channel.name}` }));
  const categories = [...guild.channels.cache.values()]
    .filter((channel) => channel.type === ChannelType.GuildCategory)
    .sort((a, b) => a.rawPosition - b.rawPosition)
    .map((channel) => ({ id: channel.id, name: channel.name }));
  const roles = [...guild.roles.cache.values()]
    .filter((role) => role.id !== guild.roles.everyone.id)
    .sort((a, b) => b.rawPosition - a.rawPosition)
    .map((role) => ({ id: role.id, name: role.name, color: role.hexColor }));
  return { channels, categories, roles };
}

async function buildBootstrap(client, guild) {
  const cfg = ensureGuildConfig(guild.id);
  const ticketStats = statsCount(guild.id) || {};
  return {
    bot: {
      online: client.isReady(),
      ping: client.ws.ping >= 0 ? Math.round(client.ws.ping) : null,
      uptime: client.uptime || 0,
      user: client.user ? { id: client.user.id, tag: client.user.tag } : null,
    },
    guilds: client.guilds.cache.map((g) => ({ id: g.id, name: g.name })),
    guild: { id: guild.id, name: guild.name, icon: guild.iconURL?.() || null },
    config: configToPayload(cfg),
    stats: {
      openTickets: Number(ticketStats.open_count || 0),
      closedTickets: Number(ticketStats.closed_count || 0),
      totalOrders: statsOrderCount(guild.id),
    },
    discord: await getDiscordOptions(guild),
    panels: getPanelsWithButtons(guild.id),
    loyalty: loyaltyTiersToPayload(listAllLoyaltyTiers(guild.id)),
    limits: {
      panelTitle: LIMITS.EMBED_TITLE,
      embedDescription: LIMITS.EMBED_DESCRIPTION,
      buttonLabel: LIMITS.BUTTON_LABEL,
      optionDescription: 100,
      menuPlaceholder: 150,
      questionLabel: 45,
      questionPlaceholder: 100,
    },
  };
}

function buildExport(guildId) {
  const cfg = ensureGuildConfig(guildId);
  return {
    version: 2,
    exported_at: new Date().toISOString(),
    guild_config: {
      ticket_category_id: cfg.ticket_category_id || null,
      log_channel_id: cfg.log_channel_id || null,
      transcript_channel_id: cfg.transcript_channel_id || null,
      support_role_ids: parseArray(cfg.support_role_ids),
    },
    panels: listPanels(guildId).map((panel) => ({
      title: panel.title,
      description: panel.description,
      color: panel.color,
      color_hex: colorToHex(panel.color),
      image: panel.image,
      thumbnail: panel.thumbnail,
      display_mode: panel.display_mode || 'buttons',
      buttons: getButtons(panel.id).map((button) => ({
        label: button.label,
        emoji: button.emoji,
        style: button.style,
        category_id: button.category_id,
        support_role_ids: parseArray(button.support_role_ids),
        ping_role_id: button.ping_role_id,
        mention_owner: button.mention_owner,
        name_template: button.name_template,
        open_message: button.open_message,
        questions: parseButtonQuestions(button.questions),
        add_role_on_open: button.add_role_on_open,
        remove_role_on_close: button.remove_role_on_close,
        create_staff_thread: button.create_staff_thread,
        position: button.position,
        description: button.description,
        placeholder_text: button.placeholder_text,
        claimed_category_id: button.claimed_category_id,
      })),
    })),
  };
}

function normalizeImportData(data) {
  const panels = Array.isArray(data?.panels)
    ? data.panels
    : data?.panel
      ? [{ ...data.panel, buttons: data.buttons || [] }]
      : null;
  if (!panels) fail('JSON invalide : aucun panel à importer.');
  if (panels.length > 100) fail('Import trop volumineux : 100 panels maximum.');

  return {
    guild_config: data.guild_config ? normalizeGuildConfigPayload(data.guild_config) : null,
    panels: panels.map((panel, panelIndex) => {
      const normalizedPanel = normalizePanelPayload(panel, `Panel importé ${panelIndex + 1}`);
      const buttons = Array.isArray(panel.buttons) ? panel.buttons : [];
      const maxButtons = normalizedPanel.display_mode === 'select' ? 25 : 5;
      if (buttons.length > maxButtons) {
        fail(
          `Le panel "${truncate(normalizedPanel.title, 60)}" contient ${buttons.length} options, maximum ${maxButtons}.`,
        );
      }
      return {
        panel: normalizedPanel,
        buttons: buttons.map((button, buttonIndex) => normalizeButtonPayload(button, buttonIndex)),
      };
    }),
  };
}

function assertPanelOwner(panelId, guildId) {
  const panel = getPanel(Number(panelId), guildId);
  if (!panel) fail('Panel introuvable.', 404);
  return panel;
}

function assertButtonOwner(buttonId, guildId) {
  const button = getButton(Number(buttonId));
  if (!button) fail('Option introuvable.', 404);
  const panel = getPanel(button.panel_id, guildId);
  if (!panel) fail('Option introuvable pour ce serveur.', 404);
  return { button, panel };
}

function createDashboardApp(client) {
  const app = express();
  app.set('trust proxy', 1);
  app.use(express.json({ limit: '1mb' }));
  app.use(express.urlencoded({ extended: false }));

  app.use('/site', express.static(siteDir, { index: false }));

  app.get('/invite', (req, res) => {
    const inviteUrl = normalizedInviteUrl();
    if (!inviteUrl) return res.status(503).sendFile(join(siteDir, 'invite-error.html'));
    if (isSocialCrawler(req)) return res.status(200).type('html').send(renderInvitePreviewPage(inviteUrl));
    return res.redirect(302, inviteUrl);
  });

  app.get('/', (req, res) => {
    return res.sendFile(join(siteDir, 'index.html'));
  });

  app.get(['/admin/login', '/dashboard/login'], (req, res) => {
    if (getSession(req)) return res.redirect('/admin');
    return res.sendFile(join(publicDir, 'login.html'));
  });

  app.get('/login', (req, res) => res.redirect(302, '/admin/login'));

  app.get(['/admin', '/admin/'], (req, res) => {
    if (!getSession(req)) return res.redirect('/admin/login');
    return res.sendFile(join(publicDir, 'index.html'));
  });

  app.get(['/dashboard', '/dashboard/'], (req, res) => res.redirect(302, '/admin'));
  app.get(['/admin/app.js', '/app.js'], (req, res) => res.sendFile(join(publicDir, 'app.js')));

  app.get('/api/session', (req, res) => {
    res.json({
      authenticated: Boolean(getSession(req)),
      dashboardConfigured: Boolean(config.dashboardPassword),
      botReady: client.isReady(),
    });
  });

  app.post('/api/login', (req, res) => {
    if (!config.dashboardPassword) {
      return res.status(503).json({
        error: 'DASHBOARD_PASSWORD doit être défini dans les variables d’environnement.',
      });
    }
    if (!safePasswordEquals(req.body?.password, config.dashboardPassword)) {
      return res.status(401).json({ error: 'Mot de passe invalide.' });
    }
    const token = randomBytes(32).toString('hex');
    sessions.set(token, { createdAt: Date.now(), expiresAt: Date.now() + SESSION_TTL_MS });
    res.setHeader('Set-Cookie', makeCookie(req, token));
    return res.json({ ok: true });
  });

  app.post('/api/logout', requireAuth, (req, res) => {
    const token = parseCookies(req.headers.cookie).dashboard_session;
    if (token) sessions.delete(token);
    res.setHeader('Set-Cookie', clearCookie());
    return res.json({ ok: true });
  });

  app.get(
    '/api/bootstrap',
    requireAuth,
    asyncRoute(async (req, res) => {
      const guild = await resolveGuild(client, req);
      res.json(await buildBootstrap(client, guild));
    }),
  );

  app.put(
    '/api/config',
    requireAuth,
    asyncRoute(async (req, res) => {
      const guild = await resolveGuild(client, req);
      updateTicketsConfig(guild.id, normalizeGuildConfigPayload(req.body));
      invalidateGuildConfig(guild.id);
      res.json({ ok: true, config: configToPayload(ensureGuildConfig(guild.id)) });
    }),
  );

  app.get(
    '/api/loyalty',
    requireAuth,
    asyncRoute(async (req, res) => {
      const guild = await resolveGuild(client, req);
      res.json({ loyalty: loyaltyTiersToPayload(listAllLoyaltyTiers(guild.id)) });
    }),
  );

  app.post(
    '/api/loyalty/tiers',
    requireAuth,
    asyncRoute(async (req, res) => {
      const guild = await resolveGuild(client, req);
      const tier = normalizeLoyaltyTierPayload(req.body);
      upsertLoyaltyTier(
        guild.id,
        tier.scope,
        tier.tier_name,
        tier.threshold,
        tier.role_id,
        tier.position,
      );
      res.status(201).json({ ok: true, loyalty: loyaltyTiersToPayload(listAllLoyaltyTiers(guild.id)) });
    }),
  );

  app.delete(
    '/api/loyalty/tiers/:scope/:tierName',
    requireAuth,
    asyncRoute(async (req, res) => {
      const guild = await resolveGuild(client, req);
      const scope = normalizeLoyaltyScope(req.params.scope);
      const tierName = normalizeText(req.params.tierName, 32, 'Nom du palier', { required: true });
      const result = deleteLoyaltyTier(guild.id, scope, tierName);
      if (result.changes === 0) fail('Palier introuvable.', 404);
      res.json({ ok: true, loyalty: loyaltyTiersToPayload(listAllLoyaltyTiers(guild.id)) });
    }),
  );

  app.get(
    '/api/panels',
    requireAuth,
    asyncRoute(async (req, res) => {
      const guild = await resolveGuild(client, req);
      res.json({ panels: getPanelsWithButtons(guild.id) });
    }),
  );

  app.post(
    '/api/panels',
    requireAuth,
    asyncRoute(async (req, res) => {
      const guild = await resolveGuild(client, req);
      const panel = normalizePanelPayload(req.body);
      const id = createPanel(guild.id, panel);
      res.status(201).json({ ok: true, panel: panelToPayload(getPanel(id, guild.id), []) });
    }),
  );

  app.put(
    '/api/panels/:id',
    requireAuth,
    asyncRoute(async (req, res) => {
      const guild = await resolveGuild(client, req);
      assertPanelOwner(req.params.id, guild.id);
      const panel = normalizePanelPayload(req.body);
      const result = updatePanel(Number(req.params.id), guild.id, panel);
      if (result.changes === 0) fail('Panel introuvable.', 404);
      const updated = getPanel(Number(req.params.id), guild.id);
      res.json({ ok: true, panel: panelToPayload(updated, getButtons(updated.id)) });
    }),
  );

  app.delete(
    '/api/panels/:id',
    requireAuth,
    asyncRoute(async (req, res) => {
      const guild = await resolveGuild(client, req);
      assertPanelOwner(req.params.id, guild.id);
      deletePanel(Number(req.params.id), guild.id);
      res.json({ ok: true });
    }),
  );

  app.post(
    '/api/panels/:id/send',
    requireAuth,
    asyncRoute(async (req, res) => {
      const guild = await resolveGuild(client, req);
      const panel = assertPanelOwner(req.params.id, guild.id);
      const buttons = getButtons(panel.id);
      if (buttons.length === 0) fail("Ajoute au moins une option avant d'envoyer le panel.");
      const channelId = normalizeSnowflake(req.body?.channel_id, 'Salon cible');
      const channel = await guild.channels.fetch(channelId).catch(() => null);
      if (!channel?.isTextBased?.() || typeof channel.send !== 'function') {
        fail('Salon Discord invalide.');
      }
      const message = await channel.send(buildPanelMessage(panel, buttons));
      updatePanelMessage(panel.id, channel.id, message.id);
      res.json({
        ok: true,
        panel: panelToPayload(getPanel(panel.id, guild.id), buttons),
        message_id: message.id,
        channel_id: channel.id,
      });
    }),
  );

  app.post(
    '/api/panels/:id/options',
    requireAuth,
    asyncRoute(async (req, res) => {
      const guild = await resolveGuild(client, req);
      const panel = assertPanelOwner(req.params.id, guild.id);
      const max = panel.display_mode === 'select' ? 25 : 5;
      if (countButtons(panel.id) >= max) fail(`Ce panel accepte ${max} options maximum.`);
      const button = normalizeButtonPayload(req.body, countButtons(panel.id));
      const id = addButton(panel.id, button);
      res.status(201).json({ ok: true, option: buttonToPayload(getButton(id)) });
    }),
  );

  app.put(
    '/api/options/:id',
    requireAuth,
    asyncRoute(async (req, res) => {
      const guild = await resolveGuild(client, req);
      const { button } = assertButtonOwner(req.params.id, guild.id);
      const replacement = normalizeButtonPayload(req.body, button.position || 0);
      replaceButton(button.id, replacement);
      res.json({ ok: true, option: buttonToPayload(getButton(button.id)) });
    }),
  );

  app.delete(
    '/api/options/:id',
    requireAuth,
    asyncRoute(async (req, res) => {
      const guild = await resolveGuild(client, req);
      const { button } = assertButtonOwner(req.params.id, guild.id);
      deleteButton(button.id);
      res.json({ ok: true });
    }),
  );

  app.get(
    '/api/export',
    requireAuth,
    asyncRoute(async (req, res) => {
      const guild = await resolveGuild(client, req);
      res.json(buildExport(guild.id));
    }),
  );

  app.post(
    '/api/import',
    requireAuth,
    asyncRoute(async (req, res) => {
      const guild = await resolveGuild(client, req);
      const importData = normalizeImportData(req.body);
      const tx = getDb().transaction(() => {
        if (importData.guild_config) updateTicketsConfig(guild.id, importData.guild_config);
        deletePanelsByGuild(guild.id);
        for (const item of importData.panels) {
          const panelId = createPanel(guild.id, item.panel);
          for (const button of item.buttons) addButton(panelId, button);
        }
      });
      tx();
      invalidateGuildConfig(guild.id);
      res.json({
        ok: true,
        importedPanels: importData.panels.length,
        panels: getPanelsWithButtons(guild.id),
        config: configToPayload(ensureGuildConfig(guild.id)),
      });
    }),
  );

  app.use('/api', (req, res) => res.status(404).json({ error: 'Route API introuvable.' }));
  app.use((req, res) => res.redirect('/'));
  app.use((err, req, res, next) => {
    if (res.headersSent) return next(err);
    logger.error({ err }, 'Dashboard request failed');
    return res.status(err.status || 500).json({
      error: err.status ? err.message : 'Erreur interne du dashboard.',
    });
  });

  return app;
}

export function startDashboard(client) {
  if (dashboardServer) return dashboardServer;
  const app = createDashboardApp(client);
  const port = Number.isFinite(config.dashboardPort) ? config.dashboardPort : 8080;
  dashboardServer = app.listen(port, '0.0.0.0', () => {
    logger.info({ port }, 'Dashboard web started');
  });
  return dashboardServer;
}
