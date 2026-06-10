const app = document.querySelector('#app');
const toast = document.querySelector('#toast');

const state = {
  activeTab: 'dashboard',
  data: null,
  modal: null,
  selectedGuildId: localStorage.getItem('eatsmart-dashboard:guild') || '',
  selectedPanelId: localStorage.getItem('eatsmart-dashboard:panel') || '',
  editingOptionId: '',
};

const tabs = [
  ['dashboard', 'Tableau de bord', 'layout-dashboard'],
  ['panels', 'Panels', 'panels-top-left'],
  ['options', 'Options & questions', 'list-plus'],
  ['loyalty', 'Rôles auto', 'badge-check'],
  ['database', 'Base de données', 'database'],
];

const buttonStyles = [
  [1, 'Primary'],
  [2, 'Secondary'],
  [3, 'Success'],
  [4, 'Danger'],
];

function icon(name, classes = 'h-4 w-4') {
  return `<i data-lucide="${name}" class="${classes}"></i>`;
}

function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

function selectOptions(items, selected, emptyLabel = 'Non défini') {
  const empty = `<option value="">${emptyLabel}</option>`;
  const rows = items
    .map((item) => {
      const isSelected = String(item.id) === String(selected || '');
      return `<option value="${escapeHtml(item.id)}" ${isSelected ? 'selected' : ''}>${escapeHtml(item.name)}</option>`;
    })
    .join('');
  return empty + rows;
}

function classNames(...items) {
  return items.filter(Boolean).join(' ');
}

function showToast(message, tone = 'ok') {
  toast.textContent = message;
  toast.className = classNames(
    'fixed bottom-5 right-5 z-50 max-w-sm rounded-xl border px-4 py-3 text-sm shadow-2xl',
    tone === 'error'
      ? 'border-red-500/40 bg-red-950 text-red-100 shadow-red-950/30'
      : 'border-violet-500/30 bg-slate-950 text-slate-100 shadow-violet-950/30',
  );
  clearTimeout(showToast.timer);
  showToast.timer = setTimeout(() => toast.classList.add('hidden'), 3200);
}

async function api(path, options = {}) {
  const url = new URL(path, window.location.origin);
  if (url.pathname.startsWith('/api/') && !['/api/session', '/api/login', '/api/logout'].includes(url.pathname)) {
    if (state.selectedGuildId) url.searchParams.set('guild_id', state.selectedGuildId);
  }
  const response = await fetch(url, {
    method: options.method || 'GET',
    headers: options.body ? { 'Content-Type': 'application/json' } : undefined,
    body: options.body ? JSON.stringify(options.body) : undefined,
  });
  if (response.status === 401) {
    window.location.href = '/admin/login';
    return null;
  }
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(data.error || 'Action impossible.');
    error.status = response.status;
    throw error;
  }
  return data;
}

async function loadDashboard() {
  try {
    const session = await api('/api/session');
    if (!session?.authenticated) {
      window.location.href = '/admin/login';
      return;
    }
    await refresh();
  } catch (error) {
    renderShell(`<div class="soft-panel rounded-xl p-6 text-red-100">${escapeHtml(error.message)}</div>`);
  }
}

async function refresh() {
  let data;
  try {
    data = await api('/api/bootstrap');
  } catch (error) {
    if (error.status === 404 && state.selectedGuildId) {
      state.selectedGuildId = '';
      localStorage.removeItem('eatsmart-dashboard:guild');
      data = await api('/api/bootstrap');
    } else {
      throw error;
    }
  }
  state.data = data;
  state.selectedGuildId = data.guild.id;
  localStorage.setItem('eatsmart-dashboard:guild', state.selectedGuildId);
  ensureSelectedPanel();
  render();
}

function ensureSelectedPanel() {
  const panels = state.data?.panels || [];
  if (!panels.some((panel) => String(panel.id) === String(state.selectedPanelId))) {
    state.selectedPanelId = panels[0]?.id ? String(panels[0].id) : '';
  }
  if (state.selectedPanelId) localStorage.setItem('eatsmart-dashboard:panel', state.selectedPanelId);
}

function render() {
  if (!state.data) return;
  renderShell(renderActiveTab() + renderModal());
  if (window.lucide) window.lucide.createIcons();
}

function renderShell(content) {
  const guilds = state.data?.guilds || [];
  app.innerHTML = `
    <div class="mx-auto flex min-h-screen w-full max-w-7xl flex-col px-4 py-5 sm:px-6 lg:px-8">
      <header class="mb-5 flex flex-col gap-4 rounded-xl border border-slate-800 bg-slate-950/60 p-4 shadow-2xl shadow-black/30 lg:flex-row lg:items-center lg:justify-between">
        <div class="flex items-center gap-3">
          <div class="flex h-11 w-11 items-center justify-center rounded-xl bg-violet-600 text-white shadow-lg shadow-violet-950/40">
            ${icon('bot', 'h-5 w-5')}
          </div>
          <div>
            <div class="text-lg font-semibold text-white">EatSmart Admin</div>
            <div class="text-sm text-slate-400">${escapeHtml(state.data?.guild?.name || 'Serveur Discord')}</div>
          </div>
        </div>
        <div class="flex flex-col gap-3 sm:flex-row sm:items-center">
          <select id="guildSelect" class="field min-w-56">
            ${guilds.map((guild) => `<option value="${guild.id}" ${guild.id === state.selectedGuildId ? 'selected' : ''}>${escapeHtml(guild.name)}</option>`).join('')}
          </select>
          <button data-action="refresh" class="inline-flex items-center justify-center gap-2 rounded-xl border border-slate-700 px-4 py-3 text-sm font-medium text-slate-200 transition hover:border-violet-500 hover:text-white">
            ${icon('refresh-cw')}
            Actualiser
          </button>
          <button data-action="logout" class="inline-flex items-center justify-center gap-2 rounded-xl bg-slate-800 px-4 py-3 text-sm font-medium text-slate-200 transition hover:bg-slate-700">
            ${icon('log-out')}
            Déconnexion
          </button>
        </div>
      </header>

      <div class="grid flex-1 gap-5 lg:grid-cols-[260px_1fr]">
        <aside class="soft-panel h-fit rounded-xl p-2 lg:sticky lg:top-5">
          <nav class="grid gap-1">
            ${tabs
              .map(
                ([id, label, iconName]) => `
                  <button data-tab="${id}" class="${classNames(
                    'flex items-center gap-3 rounded-xl px-4 py-3 text-left text-sm font-medium transition',
                    state.activeTab === id
                      ? 'bg-violet-600 text-white shadow-lg shadow-violet-950/30'
                      : 'text-slate-300 hover:bg-slate-800/80 hover:text-white',
                  )}">
                    ${icon(iconName)}
                    <span>${label}</span>
                  </button>
                `,
              )
              .join('')}
          </nav>
        </aside>
        <main class="min-w-0 pb-8">${content}</main>
      </div>
    </div>
  `;
}

function renderActiveTab() {
  if (state.activeTab === 'panels') return renderPanels();
  if (state.activeTab === 'options') return renderOptions();
  if (state.activeTab === 'loyalty') return renderLoyalty();
  if (state.activeTab === 'database') return renderDatabase();
  return renderDashboard();
}

function metricCard(label, value, iconName, tone) {
  return `
    <div class="soft-panel rounded-xl p-5">
      <div class="mb-4 flex items-center justify-between">
        <span class="text-sm font-medium text-slate-400">${label}</span>
        <span class="rounded-xl ${tone} p-2">${icon(iconName)}</span>
      </div>
      <div class="text-3xl font-semibold text-white">${value}</div>
    </div>
  `;
}

function renderDashboard() {
  const { bot, stats, config, discord } = state.data;
  const status = bot.online ? 'En ligne' : 'Hors ligne';
  const ping = bot.ping === null ? '—' : `${bot.ping} ms`;
  return `
    <section class="space-y-5">
      <div class="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        ${metricCard('Statut du bot', status, bot.online ? 'wifi' : 'wifi-off', bot.online ? 'bg-emerald-500/15 text-emerald-300' : 'bg-red-500/15 text-red-300')}
        ${metricCard('Ping', ping, 'activity', 'bg-cyan-500/15 text-cyan-300')}
        ${metricCard('Tickets ouverts', stats.openTickets, 'ticket', 'bg-violet-500/15 text-violet-300')}
        ${metricCard('Commandes totales', stats.totalOrders, 'shopping-bag', 'bg-fuchsia-500/15 text-fuchsia-300')}
      </div>

      <form id="configForm" class="soft-panel rounded-xl p-5">
        <div class="mb-5 flex items-center justify-between gap-4">
          <div>
            <h2 class="text-lg font-semibold text-white">Configuration générale</h2>
            <p class="text-sm text-slate-400">Salons et rôle staff</p>
          </div>
          <button class="inline-flex items-center justify-center gap-2 rounded-xl bg-violet-600 px-4 py-3 text-sm font-semibold text-white transition hover:bg-violet-500" type="submit">
            ${icon('save')}
            Enregistrer
          </button>
        </div>
        <div class="grid gap-4 md:grid-cols-2">
          ${fieldSelect('ticket_category_id', 'Catégorie des tickets', discord.categories, config.ticket_category_id)}
          ${fieldSelect('log_channel_id', 'Salon des logs', discord.channels, config.log_channel_id)}
          ${fieldSelect('transcript_channel_id', 'Salon des transcripts', discord.channels, config.transcript_channel_id)}
          ${fieldSelect('support_role_id', 'Rôle Staff', discord.roles, config.support_role_id)}
        </div>
      </form>
    </section>
  `;
}

function fieldSelect(name, label, items, selected) {
  return `
    <label class="block">
      <span class="mb-2 block text-sm font-medium text-slate-300">${label}</span>
      <select name="${name}" class="field">${selectOptions(items, selected)}</select>
    </label>
  `;
}

function renderLoyalty() {
  const loyalty = state.data.loyalty || { client: [], cuistot: [] };
  return `
    <section class="space-y-5">
      <div class="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h2 class="text-xl font-semibold text-white">Rôles automatiques</h2>
          <p class="text-sm text-slate-400">Attribution par nombre de commandes validées</p>
        </div>
      </div>

      <form id="loyaltyForm" class="soft-panel rounded-xl p-5">
        <div class="mb-5 flex items-center justify-between gap-4">
          <div>
            <h3 class="text-lg font-semibold text-white">Ajouter ou mettre à jour un palier</h3>
            <p class="text-sm text-slate-400">Un palier existant avec le même nom sera remplacé.</p>
          </div>
          <button class="inline-flex items-center justify-center gap-2 rounded-xl bg-violet-600 px-4 py-3 text-sm font-semibold text-white transition hover:bg-violet-500" type="submit">
            ${icon('save')}
            Enregistrer
          </button>
        </div>
        <div class="grid gap-4 lg:grid-cols-[1fr_1.2fr_1fr_1.2fr_0.8fr]">
          ${selectField('scope', 'Type', [{ id: 'client', name: 'Client' }, { id: 'cuistot', name: 'Cuistot' }], 'client', 'Type')}
          ${inputField('tier_name', 'Nom du palier', '', { max: 32, required: true })}
          <label class="block">
            <span class="mb-2 block text-sm font-medium text-slate-300">Commandes min.</span>
            <input name="threshold" class="field" type="number" min="0" max="100000" step="1" value="1" required />
          </label>
          ${selectField('role_id', 'Rôle attribué', state.data.discord.roles, '', 'Choisir un rôle')}
          <label class="block">
            <span class="mb-2 block text-sm font-medium text-slate-300">Position</span>
            <input name="position" class="field" type="number" min="0" max="20" step="1" value="0" />
          </label>
        </div>
      </form>

      <div class="grid gap-5 xl:grid-cols-2">
        ${renderLoyaltyScope('client', 'Clients', 'shopping-bag', loyalty.client || [])}
        ${renderLoyaltyScope('cuistot', 'Cuistots', 'chef-hat', loyalty.cuistot || [])}
      </div>
    </section>
  `;
}

function renderLoyaltyScope(scope, label, iconName, tiers) {
  return `
    <section class="soft-panel rounded-xl p-5">
      <div class="mb-4 flex items-center justify-between">
        <div class="flex items-center gap-3">
          <span class="flex h-10 w-10 items-center justify-center rounded-xl bg-violet-500/15 text-violet-200">${icon(iconName)}</span>
          <div>
            <h3 class="font-semibold text-white">${label}</h3>
            <p class="text-sm text-slate-400">${tiers.length} palier${tiers.length > 1 ? 's' : ''}</p>
          </div>
        </div>
      </div>
      <div class="grid gap-3">
        ${
          tiers.length
            ? tiers.map((tier) => renderLoyaltyTier(scope, tier)).join('')
            : `<div class="rounded-xl border border-dashed border-slate-700 p-5 text-center text-sm text-slate-500">Aucun rôle automatique configuré.</div>`
        }
      </div>
    </section>
  `;
}

function renderLoyaltyTier(scope, tier) {
  const role = state.data.discord.roles.find((item) => item.id === tier.role_id);
  return `
    <article class="rounded-xl border border-slate-800 bg-slate-950/40 p-4">
      <div class="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div class="min-w-0">
          <div class="mb-2 flex flex-wrap items-center gap-2">
            <span class="rounded-full bg-slate-800 px-3 py-1 text-xs font-medium text-slate-300">${tier.threshold} commande${tier.threshold > 1 ? 's' : ''}</span>
            <span class="rounded-full bg-slate-800 px-3 py-1 text-xs font-medium text-slate-300">Position ${tier.position}</span>
          </div>
          <h4 class="truncate font-semibold text-white">${escapeHtml(tier.tier_name)}</h4>
          <p class="mt-1 text-sm text-slate-400">${escapeHtml(role ? role.name : `Rôle ${tier.role_id}`)}</p>
        </div>
        <button data-action="delete-loyalty-tier" data-scope="${scope}" data-name="${escapeHtml(tier.tier_name)}" class="inline-flex items-center justify-center gap-2 rounded-xl border border-red-500/30 bg-red-950/30 px-3 py-2 text-sm font-medium text-red-200 transition hover:bg-red-950/60">
          ${icon('trash-2')}
          Supprimer
        </button>
      </div>
    </article>
  `;
}

function renderPanels() {
  const panels = state.data.panels || [];
  return `
    <section class="space-y-5">
      <div class="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 class="text-xl font-semibold text-white">Gestionnaire de panels</h2>
          <p class="text-sm text-slate-400">${panels.length} panel${panels.length > 1 ? 's' : ''}</p>
        </div>
        <button data-action="new-panel" class="inline-flex items-center justify-center gap-2 rounded-xl bg-violet-600 px-4 py-3 text-sm font-semibold text-white shadow-lg shadow-violet-950/30 transition hover:bg-violet-500">
          ${icon('plus')}
          Créer un nouveau Panel
        </button>
      </div>

      <div class="grid gap-4">
        ${
          panels.length
            ? panels.map(renderPanelCard).join('')
            : `<div class="soft-panel rounded-xl p-8 text-center text-slate-400">Aucun panel créé.</div>`
        }
      </div>
    </section>
  `;
}

function renderPanelCard(panel) {
  const sent = panel.channel_id ? `Envoyé dans ${channelName(panel.channel_id)}` : 'Non envoyé';
  return `
    <article class="soft-panel rounded-xl p-5">
      <div class="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
        <div class="min-w-0">
          <div class="mb-2 flex flex-wrap items-center gap-2">
            <span class="rounded-full bg-slate-800 px-3 py-1 text-xs font-medium text-slate-300">#${panel.id}</span>
            <span class="rounded-full bg-violet-500/15 px-3 py-1 text-xs font-medium text-violet-200">${panel.mode_label}</span>
            <span class="rounded-full bg-slate-800 px-3 py-1 text-xs font-medium text-slate-300">${panel.buttons.length} option${panel.buttons.length > 1 ? 's' : ''}</span>
          </div>
          <h3 class="truncate text-lg font-semibold text-white">${escapeHtml(panel.title)}</h3>
          <p class="mt-1 text-sm text-slate-400">${escapeHtml(sent)}</p>
        </div>
        <div class="grid grid-cols-2 gap-2 sm:flex">
          ${smallAction('edit-panel', panel.id, 'Modifier', 'pencil')}
          ${smallAction('send-panel', panel.id, 'Envoyer', 'send')}
          ${smallAction('edit-options', panel.id, 'Options', 'list-plus')}
          ${smallAction('delete-panel', panel.id, 'Supprimer', 'trash-2', 'danger')}
        </div>
      </div>
    </article>
  `;
}

function smallAction(action, id, label, iconName, tone = 'default') {
  return `
    <button data-action="${action}" data-id="${id}" class="${classNames(
      'inline-flex items-center justify-center gap-2 rounded-xl px-3 py-2 text-sm font-medium transition',
      tone === 'danger'
        ? 'border border-red-500/30 bg-red-950/30 text-red-200 hover:bg-red-950/60'
        : 'border border-slate-700 bg-slate-900/70 text-slate-200 hover:border-violet-500 hover:text-white',
    )}">
      ${icon(iconName)}
      ${label}
    </button>
  `;
}

function channelName(id) {
  return state.data.discord.channels.find((channel) => channel.id === id)?.name || `#${id}`;
}

function renderOptions() {
  const panels = state.data.panels || [];
  if (!panels.length) {
    return `<div class="soft-panel rounded-xl p-8 text-center text-slate-400">Crée un panel avant d’ajouter des options.</div>`;
  }
  ensureSelectedPanel();
  const panel = panels.find((item) => String(item.id) === String(state.selectedPanelId)) || panels[0];
  const options = panel.buttons || [];
  const selected =
    state.editingOptionId === 'new'
      ? null
      : options.find((option) => String(option.id) === String(state.editingOptionId)) || options[0] || null;
  const isNew = state.editingOptionId === 'new' || !selected;
  const draft = isNew ? defaultOption(panel) : selected;

  return `
    <section class="space-y-5">
      <div class="soft-panel rounded-xl p-5">
        <div class="grid gap-4 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-end">
          <label class="block">
            <span class="mb-2 block text-sm font-medium text-slate-300">Panel</span>
            <select id="optionPanelSelect" class="field">
              ${panels.map((item) => `<option value="${item.id}" ${item.id === panel.id ? 'selected' : ''}>#${item.id} · ${escapeHtml(item.title)}</option>`).join('')}
            </select>
          </label>
          <button data-action="new-option" class="inline-flex items-center justify-center gap-2 rounded-xl bg-violet-600 px-4 py-3 text-sm font-semibold text-white transition hover:bg-violet-500">
            ${icon('plus')}
            Nouvelle option
          </button>
        </div>
      </div>

      <div class="grid gap-5 xl:grid-cols-[320px_1fr]">
        <aside class="soft-panel h-fit rounded-xl p-3">
          <div class="mb-3 px-2 text-sm font-medium text-slate-400">${options.length} option${options.length > 1 ? 's' : ''}</div>
          <div class="grid gap-2">
            ${
              options.length
                ? options.map((option) => renderOptionListItem(option, selected?.id)).join('')
                : `<div class="rounded-xl border border-dashed border-slate-700 p-5 text-center text-sm text-slate-500">Aucune option.</div>`
            }
          </div>
        </aside>
        ${renderOptionForm(panel, draft, isNew)}
      </div>
    </section>
  `;
}

function renderOptionListItem(option, selectedId) {
  const active = String(option.id) === String(selectedId);
  return `
    <button data-action="select-option" data-id="${option.id}" class="${classNames(
      'flex w-full items-center justify-between gap-3 rounded-xl px-3 py-3 text-left transition',
      active ? 'bg-violet-600 text-white' : 'bg-slate-950/40 text-slate-300 hover:bg-slate-800',
    )}">
      <span class="min-w-0">
        <span class="block truncate text-sm font-medium">${escapeHtml(option.emoji ? `${option.emoji} ${option.label}` : option.label)}</span>
        <span class="${active ? 'text-violet-100' : 'text-slate-500'} block text-xs">${option.questions_enabled ? 'Formulaire activé' : 'Sans formulaire'}</span>
      </span>
      ${icon('chevron-right')}
    </button>
  `;
}

function defaultOption(panel) {
  return {
    label: '',
    emoji: '',
    style: 1,
    category_id: '',
    claimed_category_id: '',
    support_role_id: '',
    ping_role_id: '',
    add_role_on_open: '',
    remove_role_on_close: '',
    mention_owner: true,
    create_staff_thread: false,
    name_template: 'ticket-{username}-{number}',
    open_message: '',
    description: '',
    placeholder_text: panel.display_mode === 'select' ? 'Sélectionnez une option' : '',
    questions_enabled: false,
    questions: [],
  };
}

function renderOptionForm(panel, option, isNew) {
  const { discord } = state.data;
  const questions = option.questions_enabled && option.questions.length === 0 ? [{ label: '', placeholder: '' }] : option.questions || [];
  return `
    <form id="optionForm" data-option-id="${isNew ? 'new' : option.id}" class="soft-panel rounded-xl p-5">
      <div class="mb-5 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 class="text-lg font-semibold text-white">${isNew ? 'Nouvelle option' : 'Modifier l’option'}</h2>
          <p class="text-sm text-slate-400">Panel #${panel.id} · ${panel.mode_label}</p>
        </div>
        <div class="flex gap-2">
          ${
            isNew
              ? ''
              : `<button data-action="delete-option" data-id="${option.id}" type="button" class="inline-flex items-center justify-center gap-2 rounded-xl border border-red-500/30 bg-red-950/30 px-4 py-3 text-sm font-medium text-red-200 transition hover:bg-red-950/60">${icon('trash-2')}Supprimer</button>`
          }
          <button class="inline-flex items-center justify-center gap-2 rounded-xl bg-violet-600 px-4 py-3 text-sm font-semibold text-white transition hover:bg-violet-500" type="submit">
            ${icon('save')}
            Enregistrer
          </button>
        </div>
      </div>

      <div class="grid gap-4 md:grid-cols-2">
        ${inputField('label', 'Label', option.label, { max: 80, required: true })}
        ${inputField('emoji', 'Émoji', option.emoji, { max: 100 })}
        ${selectField('style', 'Style', buttonStyles.map(([id, name]) => ({ id, name })), option.style, 'Style')}
        ${selectField('category_id', 'Catégorie de tickets', discord.categories, option.category_id)}
        ${selectField('claimed_category_id', 'Catégorie après claim', discord.categories, option.claimed_category_id)}
        ${selectField('support_role_id', 'Rôle support dédié', discord.roles, option.support_role_id)}
        ${selectField('ping_role_id', 'Rôle ping', discord.roles, option.ping_role_id)}
        ${selectField('add_role_on_open', 'Rôle ajouté à l’ouverture', discord.roles, option.add_role_on_open)}
        ${selectField('remove_role_on_close', 'Rôle retiré à la fermeture', discord.roles, option.remove_role_on_close)}
        ${inputField('name_template', 'Template du salon', option.name_template, { max: 100 })}
        ${inputField('description', 'Description', option.description, { max: 100 })}
        ${inputField('placeholder_text', 'Placeholder menu', option.placeholder_text, { max: 150 })}
      </div>

      <div class="mt-4 grid gap-4 md:grid-cols-2">
        ${toggleField('mention_owner', 'Mentionner le client', option.mention_owner !== 0 && option.mention_owner !== false)}
        ${toggleField('create_staff_thread', 'Créer un thread staff', Boolean(option.create_staff_thread))}
      </div>

      <label class="mt-4 block">
        <span class="mb-2 block text-sm font-medium text-slate-300">Message d’ouverture</span>
        <textarea name="open_message" class="field min-h-28" maxlength="4096">${escapeHtml(option.open_message)}</textarea>
      </label>

      <div class="mt-5 rounded-xl border border-slate-800 bg-slate-950/40 p-4">
        ${toggleField('questions_enabled', 'Activer un formulaire de questions', Boolean(option.questions_enabled), 'questionsEnabled')}
        <div id="questionsBox" class="${option.questions_enabled ? '' : 'hidden'} mt-4 space-y-3">
          <div id="questionsList" class="space-y-3">
            ${questions.map((question, index) => renderQuestionRow(question, index)).join('')}
          </div>
          <button data-action="add-question" type="button" class="inline-flex items-center justify-center gap-2 rounded-xl border border-slate-700 px-3 py-2 text-sm font-medium text-slate-200 transition hover:border-violet-500 hover:text-white">
            ${icon('plus')}
            Ajouter une question
          </button>
        </div>
      </div>
    </form>
  `;
}

function inputField(name, label, value, options = {}) {
  return `
    <label class="block">
      <span class="mb-2 block text-sm font-medium text-slate-300">${label}</span>
      <input name="${name}" class="field" value="${escapeHtml(value)}" ${options.max ? `maxlength="${options.max}"` : ''} ${options.required ? 'required' : ''} />
    </label>
  `;
}

function selectField(name, label, items, selected, emptyLabel = 'Non défini') {
  return `
    <label class="block">
      <span class="mb-2 block text-sm font-medium text-slate-300">${label}</span>
      <select name="${name}" class="field">${selectOptions(items, selected, emptyLabel)}</select>
    </label>
  `;
}

function toggleField(name, label, checked, id = '') {
  const inputId = id || name;
  return `
    <label class="flex items-center justify-between gap-4 rounded-xl border border-slate-800 bg-slate-950/40 px-4 py-3">
      <span class="text-sm font-medium text-slate-200">${label}</span>
      <input id="${inputId}" name="${name}" type="checkbox" class="toggle h-5 w-9 appearance-none rounded-full bg-slate-700 transition before:block before:h-5 before:w-5 before:rounded-full before:bg-white before:transition checked:before:translate-x-4" ${checked ? 'checked' : ''} />
    </label>
  `;
}

function renderQuestionRow(question, index) {
  return `
    <div data-question-row class="grid gap-3 rounded-xl border border-slate-800 bg-slate-900/50 p-3 md:grid-cols-[1fr_1fr_auto]">
      <label class="block">
        <span class="mb-2 block text-xs font-medium text-slate-400">Question</span>
        <input data-question-label class="field" value="${escapeHtml(question.label)}" maxlength="45" />
      </label>
      <label class="block">
        <span class="mb-2 block text-xs font-medium text-slate-400">Placeholder</span>
        <input data-question-placeholder class="field" value="${escapeHtml(question.placeholder)}" maxlength="100" />
      </label>
      <button data-action="remove-question" type="button" class="self-end rounded-xl border border-slate-700 px-3 py-3 text-slate-300 transition hover:border-red-500/50 hover:text-red-200" aria-label="Supprimer la question ${index + 1}">
        ${icon('x')}
      </button>
    </div>
  `;
}

function renderDatabase() {
  return `
    <section class="grid gap-5 lg:grid-cols-2">
      <div class="soft-panel rounded-xl p-6">
        <div class="mb-5 flex h-12 w-12 items-center justify-center rounded-xl bg-cyan-500/15 text-cyan-300">
          ${icon('download', 'h-5 w-5')}
        </div>
        <h2 class="text-lg font-semibold text-white">Exporter la configuration</h2>
        <p class="mt-1 text-sm text-slate-400">Panels, options, questions, salons et rôle staff.</p>
        <button data-action="export-config" class="mt-5 inline-flex items-center justify-center gap-2 rounded-xl bg-violet-600 px-4 py-3 text-sm font-semibold text-white transition hover:bg-violet-500">
          ${icon('download')}
          Exporter JSON
        </button>
      </div>

      <div class="soft-panel rounded-xl p-6">
        <div class="mb-5 flex h-12 w-12 items-center justify-center rounded-xl bg-fuchsia-500/15 text-fuchsia-300">
          ${icon('upload', 'h-5 w-5')}
        </div>
        <h2 class="text-lg font-semibold text-white">Importer une configuration</h2>
        <p class="mt-1 text-sm text-slate-400">Le fichier remplace les panels actuels du serveur sélectionné.</p>
        <input id="importFile" class="hidden" type="file" accept="application/json,.json" />
        <button data-action="choose-import" class="mt-5 inline-flex items-center justify-center gap-2 rounded-xl border border-slate-700 px-4 py-3 text-sm font-semibold text-slate-200 transition hover:border-violet-500 hover:text-white">
          ${icon('upload')}
          Importer JSON
        </button>
      </div>
    </section>
  `;
}

function renderModal() {
  if (!state.modal) return '';
  if (state.modal.type === 'panel') return renderPanelModal(state.modal.panelId);
  if (state.modal.type === 'send') return renderSendModal(state.modal.panelId);
  return '';
}

function renderPanelModal(panelId) {
  const panel = panelId ? state.data.panels.find((item) => String(item.id) === String(panelId)) : null;
  return `
    <div class="fixed inset-0 z-40 flex items-center justify-center bg-slate-950/80 px-4 py-8 backdrop-blur-sm">
      <form id="panelForm" data-panel-id="${panel?.id || ''}" class="w-full max-w-2xl rounded-xl border border-slate-800 bg-slate-900 p-5 shadow-2xl shadow-black/50">
        <div class="mb-5 flex items-center justify-between gap-4">
          <h2 class="text-lg font-semibold text-white">${panel ? 'Modifier le panel' : 'Créer un panel'}</h2>
          <button data-action="close-modal" type="button" class="rounded-xl border border-slate-700 p-2 text-slate-300 hover:text-white">${icon('x')}</button>
        </div>
        <div class="grid gap-4 md:grid-cols-2">
          ${selectField('display_mode', 'Mode', [{ id: 'buttons', name: 'Boutons' }, { id: 'select', name: 'Menu déroulant' }], panel?.display_mode || 'buttons', 'Mode')}
          <label class="block">
            <span class="mb-2 block text-sm font-medium text-slate-300">Couleur</span>
            <input name="color_hex" class="field h-[50px]" type="color" value="${escapeHtml(panel?.color_hex || '#5865f2')}" />
          </label>
        </div>
        <div class="mt-4 grid gap-4">
          ${inputField('title', 'Titre de l’embed', panel?.title || '', { max: 256, required: true })}
          <label class="block">
            <span class="mb-2 block text-sm font-medium text-slate-300">Description</span>
            <textarea name="description" class="field min-h-36" maxlength="4096">${escapeHtml(panel?.description || '')}</textarea>
          </label>
          ${inputField('image', 'Image URL', panel?.image || '', { max: 500 })}
          ${inputField('thumbnail', 'Thumbnail URL', panel?.thumbnail || '', { max: 500 })}
        </div>
        <div class="mt-5 flex justify-end gap-2">
          <button data-action="close-modal" type="button" class="rounded-xl border border-slate-700 px-4 py-3 text-sm font-medium text-slate-200 transition hover:border-violet-500 hover:text-white">Annuler</button>
          <button class="inline-flex items-center justify-center gap-2 rounded-xl bg-violet-600 px-4 py-3 text-sm font-semibold text-white transition hover:bg-violet-500" type="submit">
            ${icon('save')}
            Enregistrer
          </button>
        </div>
      </form>
    </div>
  `;
}

function renderSendModal(panelId) {
  const panel = state.data.panels.find((item) => String(item.id) === String(panelId));
  return `
    <div class="fixed inset-0 z-40 flex items-center justify-center bg-slate-950/80 px-4 py-8 backdrop-blur-sm">
      <form id="sendForm" data-panel-id="${panelId}" class="w-full max-w-lg rounded-xl border border-slate-800 bg-slate-900 p-5 shadow-2xl shadow-black/50">
        <div class="mb-5 flex items-center justify-between gap-4">
          <div>
            <h2 class="text-lg font-semibold text-white">Envoyer le panel</h2>
            <p class="text-sm text-slate-400">#${panel?.id} · ${escapeHtml(panel?.title || '')}</p>
          </div>
          <button data-action="close-modal" type="button" class="rounded-xl border border-slate-700 p-2 text-slate-300 hover:text-white">${icon('x')}</button>
        </div>
        ${selectField('channel_id', 'Salon Discord', state.data.discord.channels, '', 'Choisir un salon')}
        <div class="mt-5 flex justify-end gap-2">
          <button data-action="close-modal" type="button" class="rounded-xl border border-slate-700 px-4 py-3 text-sm font-medium text-slate-200 transition hover:border-violet-500 hover:text-white">Annuler</button>
          <button class="inline-flex items-center justify-center gap-2 rounded-xl bg-violet-600 px-4 py-3 text-sm font-semibold text-white transition hover:bg-violet-500" type="submit">
            ${icon('send')}
            Envoyer
          </button>
        </div>
      </form>
    </div>
  `;
}

function formDataObject(form) {
  return Object.fromEntries(new FormData(form).entries());
}

function collectOptionPayload(form) {
  const values = formDataObject(form);
  const questionsEnabled = Boolean(form.querySelector('[name="questions_enabled"]')?.checked);
  return {
    ...values,
    mention_owner: Boolean(form.querySelector('[name="mention_owner"]')?.checked),
    create_staff_thread: Boolean(form.querySelector('[name="create_staff_thread"]')?.checked),
    questions_enabled: questionsEnabled,
    questions: questionsEnabled ? collectQuestions() : [],
  };
}

function collectQuestions() {
  return [...document.querySelectorAll('[data-question-row]')]
    .map((row) => ({
      label: row.querySelector('[data-question-label]').value.trim(),
      placeholder: row.querySelector('[data-question-placeholder]').value.trim(),
      required: true,
      long: true,
    }))
    .filter((question) => question.label);
}

async function handleSubmit(event) {
  if (event.target.id === 'configForm') {
    event.preventDefault();
    await api('/api/config', { method: 'PUT', body: formDataObject(event.target) });
    showToast('Configuration enregistrée.');
    await refresh();
  }

  if (event.target.id === 'loyaltyForm') {
    event.preventDefault();
    await api('/api/loyalty/tiers', { method: 'POST', body: formDataObject(event.target) });
    event.target.reset();
    showToast('Palier enregistré.');
    await refresh();
  }

  if (event.target.id === 'panelForm') {
    event.preventDefault();
    const panelId = event.target.dataset.panelId;
    const payload = formDataObject(event.target);
    await api(panelId ? `/api/panels/${panelId}` : '/api/panels', {
      method: panelId ? 'PUT' : 'POST',
      body: payload,
    });
    state.modal = null;
    showToast('Panel enregistré.');
    await refresh();
  }

  if (event.target.id === 'sendForm') {
    event.preventDefault();
    const panelId = event.target.dataset.panelId;
    await api(`/api/panels/${panelId}/send`, {
      method: 'POST',
      body: formDataObject(event.target),
    });
    state.modal = null;
    showToast('Panel envoyé sur Discord.');
    await refresh();
  }

  if (event.target.id === 'optionForm') {
    event.preventDefault();
    const optionId = event.target.dataset.optionId;
    const payload = collectOptionPayload(event.target);
    if (optionId === 'new') {
      await api(`/api/panels/${state.selectedPanelId}/options`, { method: 'POST', body: payload });
    } else {
      await api(`/api/options/${optionId}`, { method: 'PUT', body: payload });
    }
    state.editingOptionId = '';
    showToast('Option enregistrée.');
    await refresh();
  }
}

async function handleClick(event) {
  const target = event.target.closest('[data-action]');
  if (!target) return;
  const { action, id } = target.dataset;

  if (action === 'refresh') {
    await refresh();
    showToast('Données actualisées.');
  }
  if (action === 'logout') {
    await api('/api/logout', { method: 'POST', body: {} });
    window.location.href = '/admin/login';
  }
  if (action === 'new-panel') {
    state.modal = { type: 'panel' };
    render();
  }
  if (action === 'edit-panel') {
    state.modal = { type: 'panel', panelId: id };
    render();
  }
  if (action === 'send-panel') {
    state.modal = { type: 'send', panelId: id };
    render();
  }
  if (action === 'close-modal') {
    state.modal = null;
    render();
  }
  if (action === 'edit-options') {
    state.activeTab = 'options';
    state.selectedPanelId = String(id);
    state.editingOptionId = '';
    render();
  }
  if (action === 'delete-panel') {
    const panel = state.data.panels.find((item) => String(item.id) === String(id));
    if (!confirm(`Supprimer le panel "${panel?.title || id}" ?`)) return;
    await api(`/api/panels/${id}`, { method: 'DELETE', body: {} });
    showToast('Panel supprimé.');
    await refresh();
  }
  if (action === 'new-option') {
    state.editingOptionId = 'new';
    render();
  }
  if (action === 'select-option') {
    state.editingOptionId = String(id);
    render();
  }
  if (action === 'delete-option') {
    if (!confirm('Supprimer cette option ?')) return;
    await api(`/api/options/${id}`, { method: 'DELETE', body: {} });
    state.editingOptionId = '';
    showToast('Option supprimée.');
    await refresh();
  }
  if (action === 'delete-loyalty-tier') {
    const { scope, name } = target.dataset;
    if (!confirm(`Supprimer le palier "${name}" ?`)) return;
    await api(`/api/loyalty/tiers/${encodeURIComponent(scope)}/${encodeURIComponent(name)}`, {
      method: 'DELETE',
      body: {},
    });
    showToast('Palier supprimé.');
    await refresh();
  }
  if (action === 'add-question') {
    addQuestionRow();
  }
  if (action === 'remove-question') {
    target.closest('[data-question-row]')?.remove();
  }
  if (action === 'export-config') {
    const data = await api('/api/export');
    downloadJson(data, `eatsmart-dashboard-${state.selectedGuildId}.json`);
    showToast('Export généré.');
  }
  if (action === 'choose-import') {
    document.querySelector('#importFile')?.click();
  }
}

function addQuestionRow() {
  const list = document.querySelector('#questionsList');
  if (!list) return;
  const count = list.querySelectorAll('[data-question-row]').length;
  if (count >= 5) {
    showToast('Maximum 5 questions.', 'error');
    return;
  }
  list.insertAdjacentHTML('beforeend', renderQuestionRow({ label: '', placeholder: '' }, count));
  if (window.lucide) window.lucide.createIcons();
}

async function handleChange(event) {
  if (event.target.id === 'guildSelect') {
    state.selectedGuildId = event.target.value;
    state.selectedPanelId = '';
    state.editingOptionId = '';
    localStorage.setItem('eatsmart-dashboard:guild', state.selectedGuildId);
    await refresh();
  }
  if (event.target.id === 'optionPanelSelect') {
    state.selectedPanelId = event.target.value;
    state.editingOptionId = '';
    localStorage.setItem('eatsmart-dashboard:panel', state.selectedPanelId);
    render();
  }
  if (event.target.id === 'questionsEnabled') {
    const box = document.querySelector('#questionsBox');
    box?.classList.toggle('hidden', !event.target.checked);
    if (event.target.checked && document.querySelectorAll('[data-question-row]').length === 0) addQuestionRow();
  }
  if (event.target.id === 'importFile') {
    await importFile(event.target.files?.[0]);
    event.target.value = '';
  }
}

async function importFile(file) {
  if (!file) return;
  const text = await file.text();
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    showToast('JSON invalide.', 'error');
    return;
  }
  if (!confirm('Importer ce fichier et remplacer les panels actuels ?')) return;
  const result = await api('/api/import', { method: 'POST', body: data });
  state.editingOptionId = '';
  showToast(`${result.importedPanels} panel(s) importé(s).`);
  await refresh();
}

function downloadJson(data, filename) {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

document.addEventListener('submit', (event) => {
  handleSubmit(event).catch((error) => showToast(error.message, 'error'));
});

document.addEventListener('click', (event) => {
  handleClick(event).catch((error) => showToast(error.message, 'error'));
});

document.addEventListener('change', (event) => {
  handleChange(event).catch((error) => showToast(error.message, 'error'));
});

document.addEventListener('click', (event) => {
  const tab = event.target.closest('[data-tab]');
  if (!tab) return;
  state.activeTab = tab.dataset.tab;
  render();
});

loadDashboard();
