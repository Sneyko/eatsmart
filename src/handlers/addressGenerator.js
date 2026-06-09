import {
  ActionRowBuilder,
  AttachmentBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
} from 'discord.js';
import sharp from 'sharp';
import { config, logger } from '../config.js';
import { errorEmbed } from '../utils/embeds.js';
import { LIMITS, truncate } from '../utils/validators.js';

const MIN_DISTANCE_M = 700;
const MAX_DISTANCE_M = 1000;
const MAX_STREET_NUMBER_INPUT = 20;
const MAX_STREET_INPUT = 120;
const MAX_POSTAL_CODE_INPUT = 12;
const MAX_CITY_INPUT = 80;
const ADDRESS_SESSION_TTL_MS = 10 * 60 * 1000;
const FRENCH_ADDRESS_API_URL = process.env.FRENCH_ADDRESS_API_URL || 'https://api-adresse.data.gouv.fr';
const NOMINATIM_BASE_URL = process.env.NOMINATIM_BASE_URL || 'https://nominatim.openstreetmap.org';
const OVERPASS_URL = process.env.OVERPASS_URL || 'https://overpass-api.de/api/interpreter';
const ADDRESS_MAP_ENABLED = process.env.ADDRESS_MAP_ENABLED !== '0';
const ADDRESS_MAP_WIDTH = Number(process.env.ADDRESS_MAP_WIDTH || 800);
const ADDRESS_MAP_HEIGHT = Number(process.env.ADDRESS_MAP_HEIGHT || 450);
const ADDRESS_MAP_FOOTER_HEIGHT = 54;
const ADDRESS_MAP_TILE_SIZE = 256;
const ADDRESS_MAP_TILE_URL =
  process.env.ADDRESS_MAP_TILE_URL || 'https://tile.openstreetmap.org/{z}/{x}/{y}.png';
const GEOCODER_USER_AGENT =
  process.env.NOMINATIM_USER_AGENT || `EatSmartTicketBot/1.0 DiscordApp/${config.clientId}`;
const MAP_TILE_USER_AGENT =
  process.env.MAP_TILE_USER_AGENT || 'EatSmartTicketBot/1.0 (https://github.com/Sneyko/eatsmart)';
const PUBLIC_TAGS = ['amenity', 'shop', 'tourism', 'office', 'leisure', 'craft', 'healthcare'];

let nextNominatimRequestAt = 0;
const addressSessions = new Map();
const mapTileCache = new Map();

export function buildAddressGeneratorPanel() {
  const embed = new EmbedBuilder()
    .setColor(0x8b5cf6)
    .setTitle("📍 Générateur d'adresse de livraison")
    .setDescription(
      "Génère une adresse proche (≈ 700-1000 m) de celle que tu fournis.\n\n" +
        'Utile pour les besoins de livraison qui doivent rester anonymes vis-à-vis de ton adresse exacte.\n\n' +
        "Confidentialité : ton adresse n'est jamais stockée en clair.\n\n" +
        'Clique sur le bouton ci-dessous pour ouvrir le formulaire.',
    );

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId('address:open')
      .setLabel('Générer une adresse')
      .setEmoji('📍')
      .setStyle(ButtonStyle.Primary),
  );

  return { embeds: [embed], components: [row] };
}

/**
 * @param {import('discord.js').ButtonInteraction} interaction
 */
export async function handleAddressGeneratorButton(interaction) {
  const modal = new ModalBuilder()
    .setCustomId('address:generate')
    .setTitle('Générer une adresse');

  modal.addComponents(
    new ActionRowBuilder().addComponents(
      new TextInputBuilder()
        .setCustomId('street_number')
        .setLabel('Numéro de rue')
        .setPlaceholder('12')
        .setStyle(TextInputStyle.Short)
        .setRequired(true)
        .setMaxLength(MAX_STREET_NUMBER_INPUT),
    ),
    new ActionRowBuilder().addComponents(
      new TextInputBuilder()
        .setCustomId('street')
        .setLabel('Rue')
        .setPlaceholder('Rue Lafayette')
        .setStyle(TextInputStyle.Short)
        .setRequired(true)
        .setMaxLength(MAX_STREET_INPUT),
    ),
    new ActionRowBuilder().addComponents(
      new TextInputBuilder()
        .setCustomId('postal_code')
        .setLabel('Code postal')
        .setPlaceholder('75009')
        .setStyle(TextInputStyle.Short)
        .setRequired(true)
        .setMaxLength(MAX_POSTAL_CODE_INPUT),
    ),
    new ActionRowBuilder().addComponents(
      new TextInputBuilder()
        .setCustomId('city')
        .setLabel('Ville')
        .setPlaceholder('Paris')
        .setStyle(TextInputStyle.Short)
        .setRequired(true)
        .setMaxLength(MAX_CITY_INPUT),
    ),
  );

  return interaction.showModal(modal);
}

/**
 * @param {import('discord.js').ButtonInteraction} interaction
 */
export async function handleAddressRetryButton(interaction) {
  const session = getAddressSession(interaction);
  if (!session) return handleAddressGeneratorButton(interaction);

  await interaction.deferReply({ ephemeral: true });
  try {
    const result = await generateNearbyAddress(session.origin);
    rememberAddressSession(interaction, session.origin);
    return interaction.editReply(await buildGeneratedAddressMessage(result, session.origin));
  } catch (err) {
    logger.warn({ message: err.message }, 'Address regeneration failed');
    return interaction.editReply({
      embeds: [
        errorEmbed(
          "Impossible de trouver une autre adresse fiable entre 700 et 1000 m. Réouvre le formulaire avec une adresse plus précise.",
        ),
      ],
    });
  }
}

/**
 * @param {import('discord.js').ModalSubmitInteraction} interaction
 */
export async function handleAddressGeneratorModal(interaction) {
  const input = readAddressForm(interaction);
  const validationError = validateAddressForm(input);
  if (validationError) {
    return interaction.reply({
      embeds: [errorEmbed(validationError)],
      ephemeral: true,
    });
  }

  await interaction.deferReply({ ephemeral: true });

  try {
    const origin = await geocodeAddress(input);
    rememberAddressSession(interaction, origin);
    const result = await generateNearbyAddress(origin);
    return interaction.editReply(await buildGeneratedAddressMessage(result, origin));
  } catch (err) {
    logger.warn({ message: err.message }, 'Address generation failed');
    return interaction.editReply({
      embeds: [
        errorEmbed(
          "Impossible de trouver une adresse fiable entre 700 et 1000 m. Essaie une adresse plus précise ou une zone plus dense.",
        ),
      ],
    });
  }
}

export async function generateNearbyAddress(input) {
  const origin = isOrigin(input) ? input : await geocodeAddress(input);
  const frenchCandidate = await reverseGeocodeRandomPoints(origin.lat, origin.lon);
  if (frenchCandidate) return frenchCandidate;

  const overpassCandidates = await findAddressCandidates(origin.lat, origin.lon).catch((err) => {
    logger.warn({ message: err.message }, 'Overpass lookup failed');
    return [];
  });

  if (overpassCandidates.length > 0) {
    return pickCandidate(overpassCandidates);
  }

  throw new Error('No nearby address found');
}

async function geocodeAddress(input) {
  const frenchResult = await geocodeFrenchAddress(input).catch((err) => {
    logger.warn({ message: err.message }, 'French address lookup failed');
    return null;
  });
  if (frenchResult) return frenchResult;

  await throttleNominatim();
  const url = buildNominatimUrl('search');
  if (typeof input === 'string') {
    url.searchParams.set('q', input);
  } else {
    url.searchParams.set('street', `${input.streetNumber} ${input.street}`);
    url.searchParams.set('postalcode', input.postalCode);
    url.searchParams.set('city', input.city);
    url.searchParams.set('country', 'France');
  }
  url.searchParams.set('format', 'jsonv2');
  url.searchParams.set('addressdetails', '1');
  url.searchParams.set('limit', '1');

  const data = await fetchJson(url);
  const first = Array.isArray(data) ? data[0] : null;
  const lat = Number(first?.lat);
  const lon = Number(first?.lon);
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
    throw new Error('Address geocoding failed');
  }
  return { lat, lon };
}

async function geocodeFrenchAddress(input) {
  const query = typeof input === 'string' ? input : `${input.streetNumber} ${input.street}, ${input.postalCode} ${input.city}`;
  const url = buildFrenchAddressUrl('search/');
  url.searchParams.set('q', query);
  url.searchParams.set('limit', '1');

  const data = await fetchJson(url);
  const feature = Array.isArray(data?.features) ? data.features[0] : null;
  const [lon, lat] = feature?.geometry?.coordinates || [];
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
  return { lat, lon };
}

async function findAddressCandidates(lat, lon) {
  const publicCandidates = await queryOverpass(lat, lon, true);
  if (publicCandidates.length > 0) return publicCandidates;
  return queryOverpass(lat, lon, false);
}

async function queryOverpass(lat, lon, publicOnly) {
  const selectors = buildOverpassSelectors(lat, lon, publicOnly).join('\n');
  const query = `[out:json][timeout:20];\n(\n${selectors}\n);\nout center tags 120;`;
  const data = await fetchJson(OVERPASS_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8' },
    body: new URLSearchParams({ data: query }),
  });

  return (data.elements || [])
    .map((element) => normalizeOverpassElement(element, lat, lon))
    .filter(Boolean)
    .filter((candidate) => candidate.distance >= MIN_DISTANCE_M && candidate.distance <= MAX_DISTANCE_M);
}

function buildOverpassSelectors(lat, lon, publicOnly) {
  const base = [
    `node(around:${MAX_DISTANCE_M},${lat},${lon})["addr:housenumber"]["addr:street"]`,
    `way(around:${MAX_DISTANCE_M},${lat},${lon})["addr:housenumber"]["addr:street"]`,
    `relation(around:${MAX_DISTANCE_M},${lat},${lon})["addr:housenumber"]["addr:street"]`,
  ];
  if (!publicOnly) return base.map((selector) => `  ${selector};`);

  return base.flatMap((selector) =>
    PUBLIC_TAGS.map((tag) => `  ${selector}["${tag}"];`),
  );
}

function normalizeOverpassElement(element, originLat, originLon) {
  const tags = element.tags || {};
  const lat = Number(element.lat ?? element.center?.lat);
  const lon = Number(element.lon ?? element.center?.lon);
  const streetNumber = cleanTag(tags['addr:housenumber']);
  const street = cleanTag(tags['addr:street']);
  if (!Number.isFinite(lat) || !Number.isFinite(lon) || !street) return null;

  const city =
    cleanTag(tags['addr:city']) ||
    cleanTag(tags['addr:town']) ||
    cleanTag(tags['addr:village']) ||
    cleanTag(tags['addr:municipality']) ||
    cleanTag(tags['addr:suburb']);
  const postcode = cleanTag(tags['addr:postcode']);
  const country = normalizeCountry(cleanTag(tags['addr:country']));
  const placeName = cleanTag(tags.name);
  const locality = [postcode, city].filter(Boolean).join(' ');
  const streetLine = [streetNumber, street].filter(Boolean).join(' ');
  const fullAddress = buildFullAddress(streetLine, postcode, city);
  const address = [commaJoin([streetLine, locality]), country].filter(Boolean).join(', ');
  const isPublic = PUBLIC_TAGS.some((tag) => tags[tag]) || Boolean(placeName);

  return {
    address,
    streetNumber,
    street,
    postcode,
    city,
    country,
    fullAddress,
    lat,
    lon,
    placeName,
    distance: haversineMeters(originLat, originLon, lat, lon),
    isPublic,
  };
}

async function reverseGeocodeRandomPoints(lat, lon) {
  for (let i = 0; i < 8; i++) {
    const point = randomPointAround(lat, lon);
    const frenchCandidate = await reverseGeocodeFrenchPoint(point, lat, lon).catch(() => null);
    if (frenchCandidate) return frenchCandidate;

    await throttleNominatim();
    const url = buildNominatimUrl('reverse');
    url.searchParams.set('lat', String(point.lat));
    url.searchParams.set('lon', String(point.lon));
    url.searchParams.set('format', 'jsonv2');
    url.searchParams.set('addressdetails', '1');
    url.searchParams.set('zoom', '18');

    const data = await fetchJson(url).catch(() => null);
    const candidate = normalizeNominatimReverse(data, lat, lon, point.distance);
    if (candidate) return candidate;
  }
  return null;
}

async function reverseGeocodeFrenchPoint(point, originLat, originLon) {
  const url = buildFrenchAddressUrl('reverse/');
  url.searchParams.set('lat', String(point.lat));
  url.searchParams.set('lon', String(point.lon));
  url.searchParams.set('limit', '1');

  const data = await fetchJson(url);
  const feature = Array.isArray(data?.features) ? data.features[0] : null;
  const candidate = normalizeFrenchAddressFeature(feature, originLat, originLon, point.distance);
  return candidate;
}

function normalizeFrenchAddressFeature(feature, originLat, originLon, fallbackDistance) {
  const properties = feature?.properties || {};
  const [lon, lat] = feature?.geometry?.coordinates || [];
  const streetNumber = cleanTag(properties.housenumber);
  const street = cleanTag(properties.street || properties.name);
  if (!street) return null;

  const postcode = cleanTag(properties.postcode);
  const city = cleanTag(properties.city);
  const streetLine = [streetNumber, street].filter(Boolean).join(' ');
  const fullAddress = buildFullAddress(streetLine, postcode, city);
  const distance = Number.isFinite(lat) && Number.isFinite(lon)
    ? haversineMeters(originLat, originLon, lat, lon)
    : fallbackDistance;

  if (distance < MIN_DISTANCE_M || distance > MAX_DISTANCE_M) return null;
  return {
    address: [commaJoin([streetLine, [postcode, city].filter(Boolean).join(' ')]), 'France']
      .filter(Boolean)
      .join(', '),
    streetNumber,
    street,
    postcode,
    city,
    country: 'France',
    fullAddress,
    lat: Number.isFinite(lat) ? lat : null,
    lon: Number.isFinite(lon) ? lon : null,
    placeName: cleanTag(properties.label),
    distance,
    isPublic: true,
  };
}

function normalizeNominatimReverse(data, originLat, originLon, fallbackDistance) {
  const address = data?.address || {};
  const streetNumber = cleanTag(address.house_number);
  const street = cleanTag(address.road || address.pedestrian || address.footway || address.street);
  if (!street) return null;

  const city = cleanTag(address.city || address.town || address.village || address.municipality || address.suburb);
  const postcode = cleanTag(address.postcode);
  const country = normalizeCountry(cleanTag(address.country || address.country_code?.toUpperCase()));
  const streetLine = [streetNumber, street].filter(Boolean).join(' ');
  const formatted = [commaJoin([streetLine, [postcode, city].filter(Boolean).join(' ')]), country]
    .filter(Boolean)
    .join(', ');
  const lat = Number(data.lat);
  const lon = Number(data.lon);
  const distance = Number.isFinite(lat) && Number.isFinite(lon)
    ? haversineMeters(originLat, originLon, lat, lon)
    : fallbackDistance;

  if (distance < MIN_DISTANCE_M || distance > MAX_DISTANCE_M) return null;
  return {
    address: formatted,
    streetNumber,
    street,
    postcode,
    city,
    country,
    fullAddress: buildFullAddress(streetLine, postcode, city),
    lat: Number.isFinite(lat) ? lat : null,
    lon: Number.isFinite(lon) ? lon : null,
    placeName: cleanTag(data.name),
    distance,
    isPublic: Boolean(data.name),
  };
}

function pickCandidate(candidates) {
  const publicCandidates = candidates.filter((candidate) => candidate.isPublic);
  const pool = publicCandidates.length > 0 ? publicCandidates : candidates;
  return pool[Math.floor(Math.random() * pool.length)];
}

async function buildGeneratedAddressMessage(result, origin = null) {
  const embed = new EmbedBuilder()
    .setColor(0x8b5cf6)
    .setTitle('📍 Adresse générée')
    .addFields(
      {
        name: 'N° de rue',
        value: formatInlineValue(result.streetNumber || 'inconnu', !result.streetNumber),
        inline: true,
      },
      {
        name: 'Rue',
        value: formatInlineValue(result.street || 'inconnue'),
        inline: true,
      },
      {
        name: 'Code postal',
        value: formatInlineValue(result.postcode || 'inconnu'),
        inline: true,
      },
      {
        name: 'Ville',
        value: formatInlineValue(result.city || 'inconnue'),
        inline: true,
      },
      {
        name: 'Pays',
        value: formatInlineValue(result.country || 'France'),
        inline: true,
      },
      {
        name: 'Adresse complète',
        value: formatAddressBlock(result.fullAddress || result.address),
      },
      {
        name: 'Distance',
        value: `~${Math.round(result.distance)}m`,
        inline: true,
      },
      {
        name: 'Coordonnées',
        value: formatCoordinates(result.lat, result.lon),
        inline: true,
      },
    )
    .setFooter({ text: 'Confidentiel — visible uniquement par toi' });

  const files = [];
  if (ADDRESS_MAP_ENABLED && canRenderMap(origin, result)) {
    try {
      const mapBuffer = await renderAddressMap(origin, result);
      files.push(new AttachmentBuilder(mapBuffer, { name: 'adresse-map.png' }));
      embed.setImage('attachment://adresse-map.png');
    } catch (err) {
      logger.warn({ message: err.message }, 'Address map render failed');
    }
  }

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId('address:retry')
      .setLabel('Une autre adresse')
      .setEmoji('🔄')
      .setStyle(ButtonStyle.Secondary),
  );

  return { embeds: [embed], components: [row], files };
}

function readAddressForm(interaction) {
  return {
    streetNumber: interaction.fields.getTextInputValue('street_number').trim(),
    street: interaction.fields.getTextInputValue('street').trim(),
    postalCode: interaction.fields.getTextInputValue('postal_code').trim(),
    city: interaction.fields.getTextInputValue('city').trim(),
  };
}

function validateAddressForm(input) {
  if (input.streetNumber.length < 1) return 'Indique le numéro de rue.';
  if (input.street.length < 2) return 'Indique une rue plus précise.';
  if (input.postalCode.length < 3) return 'Indique un code postal valide.';
  if (input.city.length < 2) return 'Indique une ville valide.';
  if (!/^[\p{L}\p{N}\s.'’/-]+$/u.test(input.streetNumber)) return 'Le numéro de rue contient un caractère non accepté.';
  if (!/^[\p{L}\p{N}\s.'’,-]+$/u.test(input.street)) return 'La rue contient un caractère non accepté.';
  if (!/^[A-Za-z0-9\s-]+$/.test(input.postalCode)) return 'Le code postal contient un caractère non accepté.';
  if (!/^[\p{L}\s.'’,-]+$/u.test(input.city)) return 'La ville contient un caractère non accepté.';
  return null;
}

function rememberAddressSession(interaction, origin) {
  addressSessions.set(addressSessionKey(interaction), {
    origin: { lat: origin.lat, lon: origin.lon },
    expiresAt: Date.now() + ADDRESS_SESSION_TTL_MS,
  });
}

function getAddressSession(interaction) {
  const key = addressSessionKey(interaction);
  const session = addressSessions.get(key);
  if (!session) return null;
  if (session.expiresAt <= Date.now()) {
    addressSessions.delete(key);
    return null;
  }
  return session;
}

function addressSessionKey(interaction) {
  return `${interaction.guildId || 'dm'}:${interaction.user.id}`;
}

function isOrigin(input) {
  return Number.isFinite(input?.lat) && Number.isFinite(input?.lon);
}

function buildFullAddress(streetLine, postcode, city) {
  return [streetLine, [postcode, city].filter(Boolean).join(' ')].filter(Boolean).join('\n');
}

function normalizeCountry(country) {
  if (!country) return 'France';
  if (country.toUpperCase() === 'FR') return 'France';
  return country;
}

function formatInlineValue(value, italic = false) {
  const safe = escapeMarkdown(String(value || 'inconnu'));
  const display = italic ? `_${safe}_` : `\`${escapeInlineCode(safe)}\``;
  return truncate(display, LIMITS.EMBED_FIELD_VALUE);
}

function formatAddressBlock(value) {
  const safe = String(value || 'Adresse inconnue').replace(/```/g, "'''");
  return truncate(`\`\`\`\n${safe}\n\`\`\``, LIMITS.EMBED_FIELD_VALUE);
}

function formatCoordinates(lat, lon) {
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return '`inconnues`';
  return `\`${lat.toFixed(5)}, ${lon.toFixed(5)}\``;
}

function canRenderMap(origin, result) {
  return (
    Number.isFinite(origin?.lat) &&
    Number.isFinite(origin?.lon) &&
    Number.isFinite(result?.lat) &&
    Number.isFinite(result?.lon)
  );
}

async function renderAddressMap(origin, result) {
  const width = clampNumber(ADDRESS_MAP_WIDTH, 320, 1280);
  const height = clampNumber(ADDRESS_MAP_HEIGHT, 260, 900);
  const mapViewportHeight = Math.max(200, height - ADDRESS_MAP_FOOTER_HEIGHT);
  const zoom = chooseMapZoom(origin, result, width, mapViewportHeight);
  const originPx = projectToWorldPixel(origin.lat, origin.lon, zoom);
  const resultPx = projectToWorldPixel(result.lat, result.lon, zoom);
  const center = {
    x: (originPx.x + resultPx.x) / 2,
    y: (originPx.y + resultPx.y) / 2,
  };
  const topLeft = {
    x: center.x - width / 2,
    y: center.y - mapViewportHeight / 2,
  };
  const tiles = await fetchMapTiles(zoom, topLeft, width, height);
  if (tiles.length === 0) throw new Error('No map tiles fetched');

  const originPoint = {
    x: originPx.x - topLeft.x,
    y: originPx.y - topLeft.y,
  };
  const resultPoint = {
    x: resultPx.x - topLeft.x,
    y: resultPx.y - topLeft.y,
  };

  const base = sharp({
    create: {
      width,
      height,
      channels: 4,
      background: '#e8e4dc',
    },
  });

  const png = await base
    .composite([
      ...tiles,
      {
        input: Buffer.from(buildMapOverlaySvg(width, height, originPoint, resultPoint, result)),
        left: 0,
        top: 0,
      },
    ])
    .png()
    .toBuffer();

  return png;
}

async function fetchMapTiles(zoom, topLeft, width, height) {
  const maxTile = 2 ** zoom;
  const minTileX = Math.floor(topLeft.x / ADDRESS_MAP_TILE_SIZE);
  const maxTileX = Math.floor((topLeft.x + width) / ADDRESS_MAP_TILE_SIZE);
  const minTileY = Math.floor(topLeft.y / ADDRESS_MAP_TILE_SIZE);
  const maxTileY = Math.floor((topLeft.y + height) / ADDRESS_MAP_TILE_SIZE);
  const tiles = [];

  for (let tileX = minTileX; tileX <= maxTileX; tileX += 1) {
    for (let tileY = minTileY; tileY <= maxTileY; tileY += 1) {
      if (tileY < 0 || tileY >= maxTile) continue;
      const wrappedX = modulo(tileX, maxTile);
      const left = Math.round(tileX * ADDRESS_MAP_TILE_SIZE - topLeft.x);
      const top = Math.round(tileY * ADDRESS_MAP_TILE_SIZE - topLeft.y);
      const tile = await fetchMapTile(zoom, wrappedX, tileY).catch((err) => {
        logger.debug({ message: err.message, zoom, x: wrappedX, y: tileY }, 'Map tile fetch failed');
        return null;
      });
      if (tile) tiles.push({ input: tile, left, top });
    }
  }

  return tiles;
}

async function fetchMapTile(zoom, x, y) {
  const key = `${zoom}/${x}/${y}`;
  const cached = mapTileCache.get(key);
  if (cached) return cached;

  const url = ADDRESS_MAP_TILE_URL
    .replace('{z}', String(zoom))
    .replace('{x}', String(x))
    .replace('{y}', String(y));
  const buffer = await fetchBinary(url, {
    headers: {
      'User-Agent': MAP_TILE_USER_AGENT,
      Accept: 'image/png,image/*;q=0.8,*/*;q=0.5',
    },
  });
  rememberMapTile(key, buffer);
  return buffer;
}

function rememberMapTile(key, buffer) {
  if (mapTileCache.size >= 256) {
    const oldest = mapTileCache.keys().next().value;
    if (oldest) mapTileCache.delete(oldest);
  }
  mapTileCache.set(key, buffer);
}

async function fetchBinary(url, options = {}) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 12000);
  try {
    const response = await fetch(url, { ...options, signal: controller.signal });
    if (!response.ok) throw new Error(`Map tile error (${response.status})`);
    return Buffer.from(await response.arrayBuffer());
  } finally {
    clearTimeout(timeout);
  }
}

function chooseMapZoom(origin, result, width, height) {
  for (let zoom = 18; zoom >= 13; zoom -= 1) {
    const a = projectToWorldPixel(origin.lat, origin.lon, zoom);
    const b = projectToWorldPixel(result.lat, result.lon, zoom);
    if (Math.abs(a.x - b.x) <= width * 0.62 && Math.abs(a.y - b.y) <= height * 0.62) {
      return zoom;
    }
  }
  return 13;
}

function projectToWorldPixel(lat, lon, zoom) {
  const sinLat = Math.sin(toRad(Math.max(-85.05112878, Math.min(85.05112878, lat))));
  const scale = ADDRESS_MAP_TILE_SIZE * 2 ** zoom;
  return {
    x: ((lon + 180) / 360) * scale,
    y: (0.5 - Math.log((1 + sinLat) / (1 - sinLat)) / (4 * Math.PI)) * scale,
  };
}

function buildMapOverlaySvg(width, height, originPoint, resultPoint, result) {
  const footerY = height - ADDRESS_MAP_FOOTER_HEIGHT;
  const line = shortenLine(originPoint, resultPoint, 17, 19);
  const distance = Number.isFinite(result.distance) ? Math.round(result.distance) : null;
  const address = escapeXml(result.fullAddress || result.address || 'Adresse générée');
  const footer = escapeXml(
    `Distance : ${distance ? `~${distance} m` : '—'} | Restez appuyé sur l'adresse pour copier`,
  );

  return `
<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
  <defs>
    <filter id="shadow" x="-30%" y="-30%" width="160%" height="160%">
      <feDropShadow dx="0" dy="2" stdDeviation="2" flood-color="#0f172a" flood-opacity="0.35"/>
    </filter>
    <marker id="arrow" markerWidth="14" markerHeight="14" refX="11" refY="5" orient="auto" markerUnits="strokeWidth">
      <path d="M 0 0 L 11 5 L 0 10 z" fill="#5865f2"/>
    </marker>
  </defs>
  <path d="M ${line.x1.toFixed(1)} ${line.y1.toFixed(1)} L ${line.x2.toFixed(1)} ${line.y2.toFixed(1)}"
        stroke="#5865f2" stroke-width="5" stroke-linecap="round" marker-end="url(#arrow)" opacity="0.92" filter="url(#shadow)"/>
  <circle cx="${originPoint.x.toFixed(1)}" cy="${originPoint.y.toFixed(1)}" r="10" fill="#22c55e" stroke="#ffffff" stroke-width="4" filter="url(#shadow)"/>
  <circle cx="${resultPoint.x.toFixed(1)}" cy="${resultPoint.y.toFixed(1)}" r="11" fill="#ef4444" stroke="#ffffff" stroke-width="4" filter="url(#shadow)"/>
  <rect x="0" y="${footerY}" width="${width}" height="${ADDRESS_MAP_FOOTER_HEIGHT}" fill="#2f3136" opacity="0.96"/>
  <text x="20" y="${footerY + 34}" font-family="Arial, Helvetica, sans-serif" font-size="22" font-weight="700" fill="#f8fafc">${footer}</text>
  <text x="${width - 16}" y="${footerY + 34}" font-family="Arial, Helvetica, sans-serif" font-size="15" fill="#cbd5e1" text-anchor="end">© OpenStreetMap</text>
  <title>${address}</title>
</svg>`;
}

function shortenLine(a, b, startOffset, endOffset) {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const length = Math.hypot(dx, dy);
  if (length < startOffset + endOffset + 1) return { x1: a.x, y1: a.y, x2: b.x, y2: b.y };
  const ux = dx / length;
  const uy = dy / length;
  return {
    x1: a.x + ux * startOffset,
    y1: a.y + uy * startOffset,
    x2: b.x - ux * endOffset,
    y2: b.y - uy * endOffset,
  };
}

function clampNumber(value, min, max) {
  if (!Number.isFinite(value)) return min;
  return Math.max(min, Math.min(max, Math.round(value)));
}

function modulo(value, divisor) {
  return ((value % divisor) + divisor) % divisor;
}

function escapeInlineCode(value) {
  return value.replace(/`/g, "'");
}

function escapeXml(value) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function escapeMarkdown(value) {
  return value.replace(/([*_~|])/g, '\\$1');
}

function randomPointAround(lat, lon) {
  const distance = MIN_DISTANCE_M + Math.random() * (MAX_DISTANCE_M - MIN_DISTANCE_M);
  const bearing = Math.random() * Math.PI * 2;
  const angularDistance = distance / 6371000;
  const latRad = toRad(lat);
  const lonRad = toRad(lon);

  const targetLat = Math.asin(
    Math.sin(latRad) * Math.cos(angularDistance) +
      Math.cos(latRad) * Math.sin(angularDistance) * Math.cos(bearing),
  );
  const targetLon =
    lonRad +
    Math.atan2(
      Math.sin(bearing) * Math.sin(angularDistance) * Math.cos(latRad),
      Math.cos(angularDistance) - Math.sin(latRad) * Math.sin(targetLat),
    );

  return { lat: toDeg(targetLat), lon: toDeg(targetLon), distance };
}

function haversineMeters(lat1, lon1, lat2, lon2) {
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 6371000 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

async function throttleNominatim() {
  const now = Date.now();
  const waitMs = Math.max(0, nextNominatimRequestAt - now);
  if (waitMs > 0) await delay(waitMs);
  nextNominatimRequestAt = Date.now() + 1100;
}

async function fetchJson(url, options = {}) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 20000);
  try {
    const response = await fetch(url, {
      ...options,
      signal: controller.signal,
      headers: {
        'User-Agent': GEOCODER_USER_AGENT,
        Accept: 'application/json',
        ...(options.headers || {}),
      },
    });
    if (!response.ok) throw new Error(`Geocoding service error (${response.status})`);
    return response.json();
  } finally {
    clearTimeout(timeout);
  }
}

function buildNominatimUrl(path) {
  const base = NOMINATIM_BASE_URL.endsWith('/') ? NOMINATIM_BASE_URL : `${NOMINATIM_BASE_URL}/`;
  return new URL(path, base);
}

function buildFrenchAddressUrl(path) {
  const base = FRENCH_ADDRESS_API_URL.endsWith('/') ? FRENCH_ADDRESS_API_URL : `${FRENCH_ADDRESS_API_URL}/`;
  return new URL(path, base);
}

function cleanTag(value) {
  const text = String(value || '').trim();
  return text || null;
}

function commaJoin(parts) {
  return parts.filter(Boolean).join(', ');
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function toRad(value) {
  return (value * Math.PI) / 180;
}

function toDeg(value) {
  return (value * 180) / Math.PI;
}
