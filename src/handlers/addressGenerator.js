import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
} from 'discord.js';
import { config, logger } from '../config.js';
import { errorEmbed } from '../utils/embeds.js';
import { LIMITS, truncate } from '../utils/validators.js';

const MIN_DISTANCE_M = 700;
const MAX_DISTANCE_M = 1000;
const MAX_ADDRESS_INPUT = 300;
const NOMINATIM_BASE_URL = process.env.NOMINATIM_BASE_URL || 'https://nominatim.openstreetmap.org';
const OVERPASS_URL = process.env.OVERPASS_URL || 'https://overpass-api.de/api/interpreter';
const GEOCODER_USER_AGENT =
  process.env.NOMINATIM_USER_AGENT || `EatSmartTicketBot/1.0 DiscordApp/${config.clientId}`;
const PUBLIC_TAGS = ['amenity', 'shop', 'tourism', 'office', 'leisure', 'craft', 'healthcare'];

let nextNominatimRequestAt = 0;

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
    .setTitle("Générateur d'adresse");

  modal.addComponents(
    new ActionRowBuilder().addComponents(
      new TextInputBuilder()
        .setCustomId('address')
        .setLabel('Adresse de référence')
        .setPlaceholder('Ex : 10 rue de Rivoli, Paris')
        .setStyle(TextInputStyle.Short)
        .setRequired(true)
        .setMaxLength(MAX_ADDRESS_INPUT),
    ),
  );

  return interaction.showModal(modal);
}

/**
 * @param {import('discord.js').ModalSubmitInteraction} interaction
 */
export async function handleAddressGeneratorModal(interaction) {
  const address = interaction.fields.getTextInputValue('address').trim();
  if (address.length < 5) {
    return interaction.reply({
      embeds: [errorEmbed('Indique une adresse plus précise.')],
      ephemeral: true,
    });
  }

  await interaction.deferReply({ ephemeral: true });

  try {
    const result = await generateNearbyAddress(address);
    const embed = new EmbedBuilder()
      .setColor(0x8b5cf6)
      .setTitle('Adresse proposée')
      .setDescription(
        truncate(
          `**${result.address}**\n\n` +
            `Distance approximative : **${Math.round(result.distance)} m**\n` +
            `Source : OpenStreetMap\n\n` +
            `Utilise uniquement une adresse accessible et adaptée au contexte de livraison.`,
          LIMITS.EMBED_DESCRIPTION,
        ),
      );
    if (result.placeName) {
      embed.addFields({ name: 'Lieu', value: truncate(result.placeName, LIMITS.EMBED_FIELD_VALUE) });
    }
    return interaction.editReply({ embeds: [embed] });
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
  const origin = await geocodeAddress(input);
  const overpassCandidates = await findAddressCandidates(origin.lat, origin.lon).catch((err) => {
    logger.warn({ message: err.message }, 'Overpass lookup failed');
    return [];
  });

  if (overpassCandidates.length > 0) {
    return pickCandidate(overpassCandidates);
  }

  const fallback = await reverseGeocodeRandomPoints(origin.lat, origin.lon);
  if (fallback) return fallback;
  throw new Error('No nearby address found');
}

async function geocodeAddress(input) {
  await throttleNominatim();
  const url = buildNominatimUrl('search');
  url.searchParams.set('q', input);
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
  const houseNumber = cleanTag(tags['addr:housenumber']);
  const street = cleanTag(tags['addr:street']);
  if (!Number.isFinite(lat) || !Number.isFinite(lon) || !houseNumber || !street) return null;

  const city =
    cleanTag(tags['addr:city']) ||
    cleanTag(tags['addr:town']) ||
    cleanTag(tags['addr:village']) ||
    cleanTag(tags['addr:municipality']) ||
    cleanTag(tags['addr:suburb']);
  const postcode = cleanTag(tags['addr:postcode']);
  const country = cleanTag(tags['addr:country']);
  const placeName = cleanTag(tags.name);
  const locality = [postcode, city].filter(Boolean).join(' ');
  const address = [commaJoin([`${houseNumber} ${street}`, locality]), country].filter(Boolean).join(', ');
  const isPublic = PUBLIC_TAGS.some((tag) => tags[tag]) || Boolean(placeName);

  return {
    address,
    placeName,
    distance: haversineMeters(originLat, originLon, lat, lon),
    isPublic,
  };
}

async function reverseGeocodeRandomPoints(lat, lon) {
  for (let i = 0; i < 8; i++) {
    const point = randomPointAround(lat, lon);
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

function normalizeNominatimReverse(data, originLat, originLon, fallbackDistance) {
  const address = data?.address || {};
  const houseNumber = cleanTag(address.house_number);
  const street = cleanTag(address.road || address.pedestrian || address.footway || address.street);
  if (!houseNumber || !street) return null;

  const city = cleanTag(address.city || address.town || address.village || address.municipality || address.suburb);
  const postcode = cleanTag(address.postcode);
  const country = cleanTag(address.country_code?.toUpperCase() || address.country);
  const formatted = [commaJoin([`${houseNumber} ${street}`, [postcode, city].filter(Boolean).join(' ')]), country]
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
    if (!response.ok) throw new Error('Geocoding service error');
    return response.json();
  } finally {
    clearTimeout(timeout);
  }
}

function buildNominatimUrl(path) {
  const base = NOMINATIM_BASE_URL.endsWith('/') ? NOMINATIM_BASE_URL : `${NOMINATIM_BASE_URL}/`;
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
