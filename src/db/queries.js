import { getDb } from './schema.js';

const stmts = {};

/**
 * Prépare (et met en cache) les statements une fois la DB connue.
 */
function prepare() {
  const db = getDb();
  if (stmts.ready) return stmts;

  stmts.upsertGuildConfig = db.prepare(`
    INSERT INTO guild_config (guild_id) VALUES (?)
    ON CONFLICT(guild_id) DO NOTHING
  `);

  stmts.getGuildConfig = db.prepare(`SELECT * FROM guild_config WHERE guild_id = ?`);

  stmts.updateTicketsConfig = db.prepare(`
    UPDATE guild_config SET
      ticket_category_id = COALESCE(?, ticket_category_id),
      log_channel_id = COALESCE(?, log_channel_id),
      transcript_channel_id = COALESCE(?, transcript_channel_id),
      support_role_ids = COALESCE(?, support_role_ids),
      max_open_per_user = COALESCE(?, max_open_per_user),
      autoclose_hours = COALESCE(?, autoclose_hours),
      cooldown_max_tickets = COALESCE(?, cooldown_max_tickets),
      cooldown_window_minutes = COALESCE(?, cooldown_window_minutes),
      log_messages = COALESCE(?, log_messages)
    WHERE guild_id = ?
  `);

  stmts.updateWelcomeConfig = db.prepare(`
    UPDATE guild_config SET
      welcome_enabled = COALESCE(?, welcome_enabled),
      welcome_channel_id = COALESCE(?, welcome_channel_id),
      welcome_title = COALESCE(?, welcome_title),
      welcome_description = COALESCE(?, welcome_description),
      welcome_color = COALESCE(?, welcome_color),
      welcome_image = COALESCE(?, welcome_image),
      welcome_thumbnail = COALESCE(?, welcome_thumbnail),
      welcome_role_id = COALESCE(?, welcome_role_id)
    WHERE guild_id = ?
  `);

  stmts.incrementTicketCounter = db.prepare(`
    UPDATE guild_config SET ticket_counter = ticket_counter + 1 WHERE guild_id = ?
    RETURNING ticket_counter
  `);

  stmts.updateRulesConfig = db.prepare(
    `UPDATE guild_config SET rules_role_id = COALESCE(?, rules_role_id) WHERE guild_id = ?`,
  );

  stmts.insertPanel = db.prepare(`
    INSERT INTO panels (guild_id, title, description, color, image, thumbnail, display_mode)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `);
  stmts.getPanel = db.prepare(`SELECT * FROM panels WHERE id = ? AND guild_id = ?`);
  stmts.listPanels = db.prepare(`SELECT * FROM panels WHERE guild_id = ? ORDER BY id ASC`);
  stmts.deletePanel = db.prepare(`DELETE FROM panels WHERE id = ? AND guild_id = ?`);
  stmts.deletePanelsByGuild = db.prepare(`DELETE FROM panels WHERE guild_id = ?`);
  stmts.updatePanel = db.prepare(`
    UPDATE panels SET
      title = ?,
      description = ?,
      color = ?,
      image = ?,
      thumbnail = ?,
      display_mode = ?
    WHERE id = ? AND guild_id = ?
  `);
  stmts.updatePanelMessage = db.prepare(
    `UPDATE panels SET message_id = ?, channel_id = ? WHERE id = ?`,
  );

  stmts.insertButton = db.prepare(`
    INSERT INTO panel_buttons
      (panel_id, label, emoji, style, category_id, support_role_ids, ping_role_id,
       mention_owner, name_template, open_message, questions, add_role_on_open,
       remove_role_on_close, create_staff_thread, position, description, placeholder_text,
       claimed_category_id)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  stmts.getButtons = db.prepare(
    `SELECT * FROM panel_buttons WHERE panel_id = ? ORDER BY position ASC, id ASC`,
  );
  stmts.getButton = db.prepare(`SELECT * FROM panel_buttons WHERE id = ?`);
  stmts.deleteButton = db.prepare(`DELETE FROM panel_buttons WHERE id = ?`);
  stmts.updateButton = db.prepare(`
    UPDATE panel_buttons SET
      label = COALESCE(?, label),
      emoji = COALESCE(?, emoji),
      style = COALESCE(?, style),
      category_id = COALESCE(?, category_id),
      support_role_ids = COALESCE(?, support_role_ids),
      ping_role_id = COALESCE(?, ping_role_id),
      mention_owner = COALESCE(?, mention_owner),
      name_template = COALESCE(?, name_template),
      open_message = COALESCE(?, open_message),
      add_role_on_open = COALESCE(?, add_role_on_open),
      remove_role_on_close = COALESCE(?, remove_role_on_close),
      create_staff_thread = COALESCE(?, create_staff_thread),
      description = COALESCE(?, description),
      placeholder_text = COALESCE(?, placeholder_text),
      claimed_category_id = COALESCE(?, claimed_category_id)
    WHERE id = ?
  `);
  stmts.replaceButton = db.prepare(`
    UPDATE panel_buttons SET
      label = ?,
      emoji = ?,
      style = ?,
      category_id = ?,
      support_role_ids = ?,
      ping_role_id = ?,
      mention_owner = ?,
      name_template = ?,
      open_message = ?,
      questions = ?,
      add_role_on_open = ?,
      remove_role_on_close = ?,
      create_staff_thread = ?,
      position = ?,
      description = ?,
      placeholder_text = ?,
      claimed_category_id = ?
    WHERE id = ?
  `);
  stmts.countButtons = db.prepare(
    `SELECT COUNT(*) as c FROM panel_buttons WHERE panel_id = ?`,
  );

  stmts.insertTicket = db.prepare(`
    INSERT INTO tickets (guild_id, channel_id, panel_id, button_id, number, owner_id, staff_thread_id)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `);
  stmts.getTicketByChannel = db.prepare(`SELECT * FROM tickets WHERE channel_id = ?`);
  stmts.getTicketById = db.prepare(`SELECT * FROM tickets WHERE id = ?`);
  stmts.countOpenTickets = db.prepare(
    `SELECT COUNT(*) as c FROM tickets WHERE guild_id = ? AND owner_id = ? AND status = 'open'`,
  );
  stmts.setTicketClaimed = db.prepare(
    `UPDATE tickets SET claimed_by = ? WHERE id = ?`,
  );
  stmts.setTicketStatus = db.prepare(
    `UPDATE tickets SET status = ?, closed_at = ?, close_reason = ? WHERE id = ?`,
  );
  stmts.setTicketOwner = db.prepare(`UPDATE tickets SET owner_id = ? WHERE id = ?`);
  stmts.touchTicket = db.prepare(
    `UPDATE tickets SET last_activity_at = strftime('%s','now') WHERE channel_id = ?`,
  );
  stmts.setFirstResponse = db.prepare(
    `UPDATE tickets SET first_response_at = strftime('%s','now') WHERE id = ? AND first_response_at IS NULL`,
  );
  stmts.listStaleOpenTickets = db.prepare(`
    SELECT t.*, gc.autoclose_hours
    FROM tickets t
    JOIN guild_config gc ON gc.guild_id = t.guild_id
    WHERE t.status = 'open'
      AND gc.autoclose_hours > 0
      AND (strftime('%s','now') - t.last_activity_at) > gc.autoclose_hours * 3600
      AND (t.snoozed_until IS NULL OR t.snoozed_until < strftime('%s','now'))
  `);

  stmts.snoozeTicket = db.prepare(`UPDATE tickets SET snoozed_until = ? WHERE id = ?`);

  stmts.countRecentTicketsByUser = db.prepare(`
    SELECT COUNT(*) AS c FROM tickets
    WHERE guild_id = ? AND owner_id = ?
      AND opened_at > strftime('%s','now') - ?
  `);

  stmts.updateOrderState = db.prepare(`
    UPDATE tickets SET
      order_state = ?,
      order_price = COALESCE(?, order_price),
      order_tracking = COALESCE(?, order_tracking),
      order_status_message_id = COALESCE(?, order_status_message_id),
      order_cancel_reason = COALESCE(?, order_cancel_reason)
    WHERE id = ?
  `);

  stmts.incrementUserOrderCount = db.prepare(`
    INSERT INTO user_order_counts (guild_id, user_id, role, count, updated_at)
    VALUES (?, ?, ?, 1, strftime('%s','now'))
    ON CONFLICT(guild_id, user_id, role) DO UPDATE SET
      count = count + 1,
      updated_at = strftime('%s','now')
  `);

  stmts.getUserOrderCount = db.prepare(`
    SELECT count FROM user_order_counts WHERE guild_id = ? AND user_id = ? AND role = ?
  `);

  stmts.topOrderUsers = db.prepare(`
    SELECT user_id, count FROM user_order_counts
    WHERE guild_id = ? AND role = ?
    ORDER BY count DESC LIMIT ?
  `);

  stmts.upsertLoyaltyTier = db.prepare(`
    INSERT INTO loyalty_tiers (guild_id, scope, tier_name, threshold, role_id, position)
    VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT(guild_id, scope, tier_name) DO UPDATE SET
      threshold = excluded.threshold,
      role_id = excluded.role_id,
      position = excluded.position
  `);
  stmts.deleteLoyaltyTier = db.prepare(
    `DELETE FROM loyalty_tiers WHERE guild_id = ? AND scope = ? AND tier_name = ?`,
  );
  stmts.listLoyaltyTiers = db.prepare(
    `SELECT * FROM loyalty_tiers WHERE guild_id = ? AND scope = ? ORDER BY threshold ASC`,
  );
  stmts.listAllLoyaltyTiers = db.prepare(
    `SELECT * FROM loyalty_tiers WHERE guild_id = ? ORDER BY scope, threshold ASC`,
  );

  stmts.insertMacro = db.prepare(`
    INSERT INTO macros (guild_id, name, content, created_by) VALUES (?, ?, ?, ?)
  `);
  stmts.getMacro = db.prepare(`SELECT * FROM macros WHERE guild_id = ? AND name = ?`);
  stmts.listMacros = db.prepare(`SELECT * FROM macros WHERE guild_id = ? ORDER BY name ASC`);
  stmts.deleteMacro = db.prepare(`DELETE FROM macros WHERE guild_id = ? AND name = ?`);
  stmts.updateMacro = db.prepare(`UPDATE macros SET content = ? WHERE guild_id = ? AND name = ?`);
  stmts.incrementMacroUses = db.prepare(`UPDATE macros SET uses_count = uses_count + 1 WHERE id = ?`);

  stmts.addBlacklist = db.prepare(`
    INSERT INTO blacklist (guild_id, user_id, reason, added_by) VALUES (?, ?, ?, ?)
    ON CONFLICT(guild_id, user_id) DO UPDATE SET reason = excluded.reason, added_by = excluded.added_by
  `);
  stmts.removeBlacklist = db.prepare(
    `DELETE FROM blacklist WHERE guild_id = ? AND user_id = ?`,
  );
  stmts.isBlacklisted = db.prepare(
    `SELECT 1 FROM blacklist WHERE guild_id = ? AND user_id = ?`,
  );
  stmts.listBlacklist = db.prepare(`SELECT * FROM blacklist WHERE guild_id = ?`);

  stmts.insertFeedback = db.prepare(`
    INSERT INTO feedback (ticket_id, guild_id, user_id, rating, comment) VALUES (?, ?, ?, ?, ?)
  `);
  stmts.updateFeedbackComment = db.prepare(
    `UPDATE feedback SET comment = ? WHERE id = ?`,
  );

  stmts.logAction = db.prepare(`
    INSERT INTO staff_actions (guild_id, ticket_id, user_id, action, meta) VALUES (?, ?, ?, ?, ?)
  `);

  stmts.statsCount = db.prepare(`
    SELECT
      SUM(CASE WHEN status='open' THEN 1 ELSE 0 END) AS open_count,
      SUM(CASE WHEN status='closed' THEN 1 ELSE 0 END) AS closed_count,
      AVG(CASE WHEN first_response_at IS NOT NULL THEN first_response_at - opened_at END) AS avg_response
    FROM tickets WHERE guild_id = ?
  `);
  stmts.statsTopStaff = db.prepare(`
    SELECT claimed_by AS user_id, COUNT(*) AS n
    FROM tickets WHERE guild_id = ? AND claimed_by IS NOT NULL
    GROUP BY claimed_by ORDER BY n DESC LIMIT 5
  `);
  stmts.statsAvgRating = db.prepare(`
    SELECT AVG(rating) AS avg_rating, COUNT(*) AS n FROM feedback WHERE guild_id = ?
  `);
  stmts.statsOrderCount = db.prepare(`
    SELECT COUNT(*) AS c
    FROM tickets
    WHERE guild_id = ? AND COALESCE(order_state, 'none') != 'none'
  `);

  stmts.getOrderTrackingByTicket = db.prepare(
    `SELECT * FROM order_trackings WHERE ticket_id = ?`,
  );
  stmts.upsertOrderTracking = db.prepare(`
    INSERT INTO order_trackings (
      ticket_id, guild_id, channel_id, owner_id, provider, tracking_url,
      active, next_check_at, fail_count
    )
    VALUES (?, ?, ?, ?, ?, ?, 1, ?, 0)
    ON CONFLICT(ticket_id) DO UPDATE SET
      guild_id = excluded.guild_id,
      channel_id = excluded.channel_id,
      owner_id = excluded.owner_id,
      provider = excluded.provider,
      tracking_url = excluded.tracking_url,
      active = 1,
      next_check_at = excluded.next_check_at,
      fail_count = 0,
      last_eta_minutes = CASE
        WHEN order_trackings.tracking_url != excluded.tracking_url THEN NULL
        ELSE order_trackings.last_eta_minutes
      END,
      last_eta_label = CASE
        WHEN order_trackings.tracking_url != excluded.tracking_url THEN NULL
        ELSE order_trackings.last_eta_label
      END,
      last_status_text = CASE
        WHEN order_trackings.tracking_url != excluded.tracking_url THEN NULL
        ELSE order_trackings.last_status_text
      END,
      last_checked_at = CASE
        WHEN order_trackings.tracking_url != excluded.tracking_url THEN NULL
        ELSE order_trackings.last_checked_at
      END,
      last_reminder_at = CASE
        WHEN order_trackings.tracking_url != excluded.tracking_url THEN NULL
        ELSE order_trackings.last_reminder_at
      END,
      near_notified_at = CASE
        WHEN order_trackings.tracking_url != excluded.tracking_url THEN NULL
        ELSE order_trackings.near_notified_at
      END,
      pin_notified_at = CASE
        WHEN order_trackings.tracking_url != excluded.tracking_url THEN NULL
        ELSE order_trackings.pin_notified_at
      END,
      completed_notified_at = CASE
        WHEN order_trackings.tracking_url != excluded.tracking_url THEN NULL
        ELSE order_trackings.completed_notified_at
      END,
      updated_at = strftime('%s','now')
  `);
  stmts.listDueOrderTrackings = db.prepare(`
    SELECT ot.*, t.order_state, t.status AS ticket_status
    FROM order_trackings ot
    JOIN tickets t ON t.id = ot.ticket_id
    WHERE ot.active = 1
      AND t.status = 'open'
      AND COALESCE(t.order_state, 'none') = 'sent'
      AND COALESCE(ot.next_check_at, 0) <= ?
    ORDER BY COALESCE(ot.next_check_at, 0) ASC
    LIMIT ?
  `);
  stmts.stopOrderTrackingByTicket = db.prepare(`
    UPDATE order_trackings SET
      active = 0,
      last_status_text = COALESCE(?, last_status_text),
      updated_at = strftime('%s','now')
    WHERE ticket_id = ?
  `);

  stmts.ready = true;
  return stmts;
}

/** @returns {object} */
export function ensureGuildConfig(guildId) {
  const s = prepare();
  s.upsertGuildConfig.run(guildId);
  return s.getGuildConfig.get(guildId);
}

/** @returns {object|undefined} */
export function getGuildConfig(guildId) {
  return prepare().getGuildConfig.get(guildId);
}

export function updateTicketsConfig(guildId, patch) {
  const s = prepare();
  s.upsertGuildConfig.run(guildId);
  s.updateTicketsConfig.run(
    patch.ticket_category_id ?? null,
    patch.log_channel_id ?? null,
    patch.transcript_channel_id ?? null,
    patch.support_role_ids ?? null,
    patch.max_open_per_user ?? null,
    patch.autoclose_hours ?? null,
    patch.cooldown_max_tickets ?? null,
    patch.cooldown_window_minutes ?? null,
    patch.log_messages ?? null,
    guildId,
  );
}

export function updateRulesConfig(guildId, roleId) {
  const s = prepare();
  s.upsertGuildConfig.run(guildId);
  s.updateRulesConfig.run(roleId, guildId);
}

export function updateWelcomeConfig(guildId, patch) {
  const s = prepare();
  s.upsertGuildConfig.run(guildId);
  s.updateWelcomeConfig.run(
    patch.welcome_enabled ?? null,
    patch.welcome_channel_id ?? null,
    patch.welcome_title ?? null,
    patch.welcome_description ?? null,
    patch.welcome_color ?? null,
    patch.welcome_image ?? null,
    patch.welcome_thumbnail ?? null,
    patch.welcome_role_id ?? null,
    guildId,
  );
}

export function nextTicketNumber(guildId) {
  const s = prepare();
  s.upsertGuildConfig.run(guildId);
  return s.incrementTicketCounter.get(guildId).ticket_counter;
}

export function createPanel(guildId, p) {
  return prepare().insertPanel.run(
    guildId,
    p.title,
    p.description ?? null,
    p.color ?? 5793266,
    p.image ?? null,
    p.thumbnail ?? null,
    p.display_mode ?? 'buttons',
  ).lastInsertRowid;
}
export const getPanel = (id, guildId) => prepare().getPanel.get(id, guildId);
export const listPanels = (guildId) => prepare().listPanels.all(guildId);
export const deletePanel = (id, guildId) => prepare().deletePanel.run(id, guildId);
export const deletePanelsByGuild = (guildId) => prepare().deletePanelsByGuild.run(guildId);
export function updatePanel(id, guildId, p) {
  return prepare().updatePanel.run(
    p.title,
    p.description ?? null,
    p.color ?? 5793266,
    p.image ?? null,
    p.thumbnail ?? null,
    p.display_mode ?? 'buttons',
    id,
    guildId,
  );
}
export const updatePanelMessage = (id, channelId, messageId) =>
  prepare().updatePanelMessage.run(messageId, channelId, id);

export function addButton(panelId, b) {
  return prepare().insertButton.run(
    panelId,
    b.label,
    b.emoji ?? null,
    b.style ?? 1,
    b.category_id ?? null,
    b.support_role_ids ?? '[]',
    b.ping_role_id ?? null,
    b.mention_owner ?? 1,
    b.name_template ?? 'ticket-{username}-{number}',
    b.open_message ?? null,
    b.questions ?? '[]',
    b.add_role_on_open ?? null,
    b.remove_role_on_close ?? null,
    b.create_staff_thread ?? 0,
    b.position ?? 0,
    b.description ?? null,
    b.placeholder_text ?? null,
    b.claimed_category_id ?? null,
  ).lastInsertRowid;
}
export const getButtons = (panelId) => prepare().getButtons.all(panelId);
export const getButton = (id) => prepare().getButton.get(id);
export const deleteButton = (id) => prepare().deleteButton.run(id);
export const countButtons = (panelId) => prepare().countButtons.get(panelId).c;

export function replaceButton(id, b) {
  return prepare().replaceButton.run(
    b.label,
    b.emoji ?? null,
    b.style ?? 1,
    b.category_id ?? null,
    b.support_role_ids ?? '[]',
    b.ping_role_id ?? null,
    b.mention_owner ?? 1,
    b.name_template ?? 'ticket-{username}-{number}',
    b.open_message ?? null,
    b.questions ?? '[]',
    b.add_role_on_open ?? null,
    b.remove_role_on_close ?? null,
    b.create_staff_thread ?? 0,
    b.position ?? 0,
    b.description ?? null,
    b.placeholder_text ?? null,
    b.claimed_category_id ?? null,
    id,
  );
}

export function updateButton(id, patch) {
  const s = prepare();
  return s.updateButton.run(
    patch.label ?? null,
    patch.emoji ?? null,
    patch.style ?? null,
    patch.category_id ?? null,
    patch.support_role_ids ?? null,
    patch.ping_role_id ?? null,
    patch.mention_owner ?? null,
    patch.name_template ?? null,
    patch.open_message ?? null,
    patch.add_role_on_open ?? null,
    patch.remove_role_on_close ?? null,
    patch.create_staff_thread ?? null,
    patch.description ?? null,
    patch.placeholder_text ?? null,
    patch.claimed_category_id ?? null,
    id,
  );
}

const CLEARABLE_BUTTON_FIELDS = new Set([
  'emoji',
  'category_id',
  'ping_role_id',
  'add_role_on_open',
  'remove_role_on_close',
  'open_message',
  'description',
  'placeholder_text',
  'support_role_ids',
  'claimed_category_id',
]);

export function clearButtonField(id, field) {
  if (!CLEARABLE_BUTTON_FIELDS.has(field)) throw new Error('Invalid field for clear');
  const stmt = getDb().prepare(`UPDATE panel_buttons SET ${field} = NULL WHERE id = ?`);
  return stmt.run(id);
}

export function createTicket(t) {
  return prepare().insertTicket.run(
    t.guild_id,
    t.channel_id,
    t.panel_id,
    t.button_id,
    t.number,
    t.owner_id,
    t.staff_thread_id ?? null,
  ).lastInsertRowid;
}
export const getTicketByChannel = (channelId) => prepare().getTicketByChannel.get(channelId);
export const getTicketById = (id) => prepare().getTicketById.get(id);
export const countOpenTickets = (guildId, userId) =>
  prepare().countOpenTickets.get(guildId, userId).c;
export const setTicketClaimed = (id, userId) => prepare().setTicketClaimed.run(userId, id);
export const setTicketStatus = (id, status, reason = null) =>
  prepare().setTicketStatus.run(status, status === 'closed' ? Math.floor(Date.now() / 1000) : null, reason, id);
export const setTicketOwner = (id, userId) => prepare().setTicketOwner.run(userId, id);
export const touchTicket = (channelId) => prepare().touchTicket.run(channelId);
export const setFirstResponse = (id) => prepare().setFirstResponse.run(id);
export const listStaleOpenTickets = () => prepare().listStaleOpenTickets.all();
export const snoozeTicket = (id, until) => prepare().snoozeTicket.run(until, id);
export const countRecentTicketsByUser = (guildId, userId, windowSeconds) =>
  prepare().countRecentTicketsByUser.get(guildId, userId, windowSeconds).c;

export const addBlacklist = (guildId, userId, reason, addedBy) =>
  prepare().addBlacklist.run(guildId, userId, reason, addedBy);
export const removeBlacklist = (guildId, userId) =>
  prepare().removeBlacklist.run(guildId, userId);
export const isBlacklisted = (guildId, userId) =>
  !!prepare().isBlacklisted.get(guildId, userId);
export const listBlacklist = (guildId) => prepare().listBlacklist.all(guildId);

export const insertFeedback = (ticketId, guildId, userId, rating, comment = null) =>
  prepare().insertFeedback.run(ticketId, guildId, userId, rating, comment).lastInsertRowid;
export const updateFeedbackComment = (id, comment) =>
  prepare().updateFeedbackComment.run(comment, id);

export const logAction = (guildId, ticketId, userId, action, meta = null) =>
  prepare().logAction.run(guildId, ticketId, userId, action, meta);

export const createMacro = (guildId, name, content, userId) =>
  prepare().insertMacro.run(guildId, name, content, userId);
export const getMacro = (guildId, name) => prepare().getMacro.get(guildId, name);
export const listMacros = (guildId) => prepare().listMacros.all(guildId);
export const deleteMacro = (guildId, name) => prepare().deleteMacro.run(guildId, name);
export const updateMacro = (guildId, name, content) =>
  prepare().updateMacro.run(content, guildId, name);
export const incrementMacroUses = (id) => prepare().incrementMacroUses.run(id);

export function updateOrderState(ticketId, patch) {
  return prepare().updateOrderState.run(
    patch.order_state,
    patch.order_price ?? null,
    patch.order_tracking ?? null,
    patch.order_status_message_id ?? null,
    patch.order_cancel_reason ?? null,
    ticketId,
  );
}
export const incrementUserOrderCount = (guildId, userId, role) =>
  prepare().incrementUserOrderCount.run(guildId, userId, role);
export const getUserOrderCount = (guildId, userId, role) =>
  prepare().getUserOrderCount.get(guildId, userId, role)?.count ?? 0;
export const topOrderUsers = (guildId, role, limit = 10) =>
  prepare().topOrderUsers.all(guildId, role, limit);

export const upsertLoyaltyTier = (guildId, scope, tierName, threshold, roleId, position) =>
  prepare().upsertLoyaltyTier.run(guildId, scope, tierName, threshold, roleId, position);
export const deleteLoyaltyTier = (guildId, scope, tierName) =>
  prepare().deleteLoyaltyTier.run(guildId, scope, tierName);
export const listLoyaltyTiers = (guildId, scope) =>
  prepare().listLoyaltyTiers.all(guildId, scope);
export const listAllLoyaltyTiers = (guildId) => prepare().listAllLoyaltyTiers.all(guildId);

export const statsCount = (guildId) => prepare().statsCount.get(guildId);
export const statsTopStaff = (guildId) => prepare().statsTopStaff.all(guildId);
export const statsAvgRating = (guildId) => prepare().statsAvgRating.get(guildId);
export const statsOrderCount = (guildId) => prepare().statsOrderCount.get(guildId)?.c ?? 0;

export const getOrderTrackingByTicket = (ticketId) =>
  prepare().getOrderTrackingByTicket.get(ticketId);

export function upsertOrderTracking(tracking) {
  return prepare().upsertOrderTracking.run(
    tracking.ticket_id,
    tracking.guild_id,
    tracking.channel_id,
    tracking.owner_id,
    tracking.provider ?? 'ubereats',
    tracking.tracking_url,
    tracking.next_check_at ?? Math.floor(Date.now() / 1000),
  );
}

export const listDueOrderTrackings = (now, limit = 10) =>
  prepare().listDueOrderTrackings.all(now, limit);

export function updateOrderTracking(id, patch) {
  const allowed = new Set([
    'active',
    'last_eta_minutes',
    'last_eta_label',
    'last_status_text',
    'last_checked_at',
    'next_check_at',
    'last_reminder_at',
    'near_notified_at',
    'pin_notified_at',
    'completed_notified_at',
    'fail_count',
  ]);
  const entries = Object.entries(patch).filter(([key]) => allowed.has(key));
  if (entries.length === 0) return { changes: 0 };
  const assignments = entries.map(([key]) => `${key} = ?`).join(', ');
  const values = entries.map(([, value]) => value);
  return getDb()
    .prepare(`UPDATE order_trackings SET ${assignments}, updated_at = strftime('%s','now') WHERE id = ?`)
    .run(...values, id);
}

export const stopOrderTrackingByTicket = (ticketId, statusText = null) =>
  prepare().stopOrderTrackingByTicket.run(statusText, ticketId);
