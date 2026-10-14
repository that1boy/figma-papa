'use strict';
// Lucide icons for model markup: <i data-icon="search" class="size-4"></i> is
// replaced at presentation time by the inline SVG. Stored artifacts keep the
// compact <i> form. Icon data: assets/icons/lucide.json (ISC licence).
const fs = require('node:fs');
const path = require('node:path');
const { escapeHTML, attrs, findElements, splice, iconAttribute } = require('./svg.cjs');

const FILE = path.join(__dirname, '..', 'assets', 'icons', 'lucide.json');
// Defence in depth: only plain drawing primitives with quoted, markup-free values are accepted.
const SAFE_ICON = /^(?:<(?:path|circle|rect|line|ellipse|polyline|polygon)(?: [a-z][a-z0-9-]*="[^"<>&]*")*\/>)+$/;
let ICONS = null;
function icons() {
  if (!ICONS) {
    ICONS = new Map();
    for (const [k, v] of Object.entries(JSON.parse(fs.readFileSync(FILE, 'utf8'))))
      if (/^[a-z0-9-]{1,48}$/.test(k) && typeof v === 'string' && SAFE_ICON.test(v)) ICONS.set(k, v);
  }
  return ICONS;
}
const iconNames = () => [...icons().keys()];
const FALLBACK_ICON = 'circle-dashed';

// Real Lucide names that models almost always mean differently.
const OVERRIDES = { delete: 'trash', hamburger: 'menu', group: 'users' };
// Names models commonly use (older Lucide, Feather, Material, Heroicons, plain words).
const ICON_ALIASES = {
  close: 'x', cancel: 'x', times: 'x', dismiss: 'x', 'x-mark': 'x', xmark: 'x',
  remove: 'minus', subtract: 'minus', add: 'plus', new: 'plus', create: 'plus', 'plus-circle': 'circle-plus', 'add-circle': 'circle-plus', 'minus-circle': 'circle-minus',
  done: 'check', tick: 'check', checkmark: 'check', ok: 'check', 'check-all': 'check-check', 'done-all': 'check-check',
  'trash-2': 'trash', bin: 'trash', 'delete-forever': 'trash', garbage: 'trash',
  home: 'house', 'home-2': 'house', dashboard: 'layout-dashboard', overview: 'layout-dashboard', grid: 'layout-grid', apps: 'layout-grid', 'view-grid': 'layout-grid', 'view-list': 'layout-list',
  edit: 'pencil', 'edit-2': 'pencil', 'edit-3': 'pen-line', modify: 'pencil', write: 'square-pen', compose: 'square-pen', 'pencil-square': 'square-pen',
  warning: 'triangle-alert', 'alert-triangle': 'triangle-alert', caution: 'triangle-alert', 'exclamation-triangle': 'triangle-alert',
  alert: 'circle-alert', 'alert-circle': 'circle-alert', 'exclamation-circle': 'circle-alert', error: 'circle-x', 'x-circle': 'circle-x', danger: 'octagon-alert', 'alert-octagon': 'octagon-alert',
  success: 'circle-check', 'check-circle': 'circle-check', 'check-circle-2': 'circle-check', 'check-circle-big': 'circle-check-big', verified: 'badge-check', 'badge-check-2': 'badge-check',
  information: 'info', 'info-circle': 'info', 'information-circle': 'info',
  help: 'circle-question-mark', question: 'circle-question-mark', 'help-circle': 'circle-question-mark', 'circle-help': 'circle-question-mark', 'question-circle': 'circle-question-mark', 'question-mark-circle': 'circle-question-mark', faq: 'circle-question-mark', support: 'life-buoy',
  cart: 'shopping-cart', basket: 'shopping-basket', bag: 'shopping-bag', shop: 'store', storefront: 'store',
  logout: 'log-out', 'sign-out': 'log-out', signout: 'log-out', exit: 'log-out', login: 'log-in', 'sign-in': 'log-in', signin: 'log-in',
  notification: 'bell', notifications: 'bell', alarm: 'alarm-clock', 'bell-alert': 'bell-ring',
  more: 'ellipsis', 'more-horizontal': 'ellipsis', 'more-horiz': 'ellipsis', dots: 'ellipsis', 'dots-horizontal': 'ellipsis', 'more-vertical': 'ellipsis-vertical', 'more-vert': 'ellipsis-vertical', kebab: 'ellipsis-vertical', 'dots-vertical': 'ellipsis-vertical', options: 'ellipsis-vertical',
  'menu-2': 'menu', bars: 'menu', 'bars-3': 'menu', burger: 'menu', 'hamburger-menu': 'menu', sidebar: 'panel-left', 'sidebar-open': 'panel-left-open', 'sidebar-close': 'panel-left-close',
  date: 'calendar', event: 'calendar', schedule: 'calendar-days', agenda: 'calendar-days', 'calendar-event': 'calendar-check', time: 'clock', 'access-time': 'clock', stopwatch: 'timer',
  chart: 'chart-column', charts: 'chart-column', 'bar-chart': 'chart-column', 'bar-chart-2': 'chart-column', 'bar-chart-3': 'chart-no-axes-column', 'bar-chart-big': 'chart-column-big', 'bar-chart-horizontal': 'chart-bar', analytics: 'chart-column', statistics: 'chart-column', stats: 'chart-column', insights: 'chart-line', report: 'file-chart-column', reports: 'file-chart-column',
  'line-chart': 'chart-line', 'pie-chart': 'chart-pie', 'area-chart': 'chart-area', 'scatter-chart': 'chart-scatter', 'candlestick-chart': 'chart-candlestick', 'gantt-chart': 'chart-gantt', growth: 'trending-up', trend: 'trending-up', decline: 'trending-down', pulse: 'activity',
  filter: 'funnel', filters: 'funnel', 'filter-list': 'list-filter', 'filter-x': 'funnel-x', sort: 'arrow-up-down', 'sort-asc': 'arrow-up-narrow-wide', 'sort-desc': 'arrow-down-wide-narrow', 'sort-ascending': 'arrow-up-narrow-wide', 'sort-descending': 'arrow-down-wide-narrow', swap: 'arrow-left-right', tune: 'sliders-horizontal', sliders: 'sliders-horizontal', adjustments: 'sliders-horizontal', preferences: 'sliders-horizontal', gear: 'settings', config: 'settings', configuration: 'settings',
  profile: 'circle-user', account: 'circle-user', avatar: 'circle-user', person: 'user', people: 'users', team: 'users', members: 'users', customers: 'users', 'person-add': 'user-plus', 'user-add': 'user-plus', 'add-user': 'user-plus', 'user-circle': 'circle-user', 'person-circle': 'circle-user',
  email: 'mail', envelope: 'mail', 'envelope-open': 'mail-open', message: 'message-square', messages: 'messages-square', chat: 'message-circle', 'chat-bubble': 'message-circle', comment: 'message-square', comments: 'messages-square', conversation: 'messages-square', sms: 'message-square-text',
  call: 'phone', telephone: 'phone', mobile: 'smartphone', 'phone-mobile': 'smartphone', cellphone: 'smartphone', desktop: 'monitor', display: 'monitor', 'device-desktop': 'monitor', 'device-mobile': 'smartphone',
  location: 'map-pin', 'location-on': 'map-pin', place: 'map-pin', marker: 'map-pin', address: 'map-pin', 'map-marker': 'map-pin', world: 'globe', language: 'languages', web: 'globe', website: 'globe', internet: 'globe',
  money: 'banknote', cash: 'banknote', dollar: 'dollar-sign', usd: 'dollar-sign', payment: 'credit-card', payments: 'credit-card', card: 'credit-card', billing: 'receipt', invoice: 'receipt-text', bill: 'receipt', pricing: 'tag', price: 'tag', sale: 'badge-percent', discount: 'badge-percent', coupon: 'ticket-percent', bank: 'landmark', savings: 'piggy-bank', finance: 'wallet', budget: 'wallet',
  document: 'file-text', doc: 'file-text', docs: 'files', documents: 'files', 'file-document': 'file-text', page: 'file', note: 'sticky-note', notes: 'notebook-pen', article: 'newspaper', news: 'newspaper', blog: 'newspaper', directory: 'folder', attachment: 'paperclip', attach: 'paperclip', 'attach-file': 'paperclip', clip: 'paperclip',
  photo: 'image', picture: 'image', gallery: 'images', photos: 'images', 'image-add': 'image-plus', movie: 'film', 'video-camera': 'video', microphone: 'mic', 'mic-on': 'mic', sound: 'volume-2', 'volume-up': 'volume-2', mute: 'volume-x', 'play-circle': 'circle-play', 'pause-circle': 'circle-pause', stop: 'square', 'stop-circle': 'circle-stop',
  refresh: 'refresh-cw', reload: 'refresh-cw', sync: 'refresh-cw', update: 'refresh-cw', retry: 'rotate-ccw', reset: 'rotate-ccw', history: 'rotate-ccw-clock', recent: 'rotate-ccw-clock', restore: 'archive-restore', back: 'arrow-left', next: 'arrow-right', previous: 'arrow-left', prev: 'arrow-left', return: 'corner-down-left', enter: 'corner-down-left',
  'arrow-back': 'arrow-left', 'arrow-forward': 'arrow-right', 'arrow-narrow-right': 'arrow-right', 'arrow-narrow-left': 'arrow-left', 'arrow-long-right': 'arrow-right', 'arrow-long-left': 'arrow-left', 'expand-more': 'chevron-down', 'expand-less': 'chevron-up', caret: 'chevron-down', 'caret-down': 'chevron-down', 'caret-up': 'chevron-up', 'caret-left': 'chevron-left', 'caret-right': 'chevron-right', 'chevron-double-right': 'chevrons-right', 'chevron-double-left': 'chevrons-left', 'unfold-more': 'chevrons-up-down', selector: 'chevrons-up-down', 'chevron-up-down': 'chevrons-up-down',
  'external-link-alt': 'external-link', 'open-in-new': 'external-link', 'link-external': 'external-link', launch: 'external-link', 'arrow-top-right-on-square': 'external-link', url: 'link', hyperlink: 'link',
  'share-alt': 'share-2', export: 'download', 'cloud-upload-alt': 'cloud-upload', 'upload-cloud': 'cloud-upload', 'download-cloud': 'cloud-download', 'arrow-down-tray': 'download', 'arrow-up-tray': 'upload', print: 'printer', duplicate: 'copy', clone: 'copy', 'content-copy': 'copy', paste: 'clipboard-paste', 'save-alt': 'save', floppy: 'save', 'paper-airplane': 'send', 'paper-plane': 'send', submit: 'send',
  unlock: 'lock-open', unlocked: 'lock-open', 'lock-closed': 'lock', locked: 'lock', 'lock-open-alt': 'lock-open', password: 'key-round', security: 'shield-check', secure: 'shield-check', privacy: 'shield', protected: 'shield-check', 'shield-exclamation': 'shield-alert', 'verified-user': 'shield-check',
  visible: 'eye', show: 'eye', visibility: 'eye', preview: 'eye', hide: 'eye-off', hidden: 'eye-off', invisible: 'eye-off', 'visibility-off': 'eye-off', 'eye-slash': 'eye-off',
  favorite: 'star', favourite: 'star', rating: 'star', 'star-outline': 'star', like: 'heart', love: 'heart', likes: 'thumbs-up', 'thumb-up': 'thumbs-up', 'thumb-down': 'thumbs-down', dislike: 'thumbs-down', label: 'tag', labels: 'tags', category: 'tag', categories: 'tags',
  collapse: 'minimize-2', 'fullscreen-exit': 'minimize', magnifier: 'search', 'magnifying-glass': 'search', find: 'search', lookup: 'search', 'search-alt': 'search',
  shipping: 'truck', delivery: 'truck', shipment: 'truck', 'local-shipping': 'truck', parcel: 'package', order: 'package', orders: 'package', product: 'package', products: 'boxes', inventory: 'boxes', present: 'gift',
  company: 'building', office: 'building', 'building-2': 'building', 'building-office': 'building', organization: 'building', organisation: 'building', business: 'briefcase-business', work: 'briefcase', job: 'briefcase', jobs: 'briefcase', career: 'briefcase', education: 'graduation-cap', 'academic-cap': 'graduation-cap', course: 'book-open', learn: 'book-open', 'book-2': 'book',
  idea: 'lightbulb', 'light-bulb': 'lightbulb', tip: 'lightbulb', tips: 'lightbulb', light: 'sun', 'light-mode': 'sun', dark: 'moon', 'dark-mode': 'moon', theme: 'sun-moon', weather: 'cloud-sun', lightning: 'zap', flash: 'zap', energy: 'zap', fire: 'flame', hot: 'flame', trending: 'flame', magic: 'wand-sparkles', 'magic-wand': 'wand-sparkles', ai: 'sparkles', stars: 'sparkles', goals: 'target', aim: 'target', achievement: 'award', certificate: 'award', prize: 'trophy', winner: 'trophy',
  'code-bracket': 'code', developer: 'code-xml', console: 'terminal', cli: 'terminal', api: 'webhook', integration: 'plug', integrations: 'blocks', plugin: 'plug', extension: 'puzzle', storage: 'hard-drive', 'hard-disk': 'hard-drive', 'data-base': 'database', data: 'database', 'cloud-storage': 'cloud', robot: 'bot', assistant: 'bot', chip: 'cpu', processor: 'cpu', 'wi-fi': 'wifi', electricity: 'plug-zap', on: 'power', off: 'power-off', 'power-settings': 'power',
  tasks: 'list-checks', task: 'square-check', todo: 'list-todo', checklist: 'list-checks', 'check-square': 'square-check', checkbox: 'square-check', board: 'kanban', 'kanban-board': 'kanban', projects: 'folder-kanban', project: 'folder-kanban', automation: 'workflow', flow: 'workflow', pipeline: 'workflow', branch: 'git-branch', version: 'git-branch', stack: 'layers', 'layer-group': 'layers', components: 'component', design: 'palette', colors: 'palette', colour: 'palette', color: 'palette', paint: 'paintbrush', typography: 'type', text: 'type', font: 'type',
  spreadsheet: 'sheet', columns: 'columns-3', rows: 'rows-3', 'list-bullet': 'list', 'list-ul': 'list', 'list-ol': 'list-ordered', 'numbered-list': 'list-ordered', 'format-list-bulleted': 'list', 'align-left': 'text-align-start', 'align-center': 'text-align-center', 'align-right': 'text-align-end', 'align-justify': 'text-align-justify',
  drag: 'grip-vertical', 'drag-handle': 'grip-vertical', handle: 'grip-vertical', reorder: 'grip-vertical', resize: 'scaling',
  health: 'heart-pulse', medical: 'stethoscope', doctor: 'stethoscope', medicine: 'pill', fitness: 'dumbbell', food: 'utensils', restaurant: 'utensils', dining: 'utensils', drink: 'coffee', cafe: 'coffee', travel: 'plane', flight: 'plane', airplane: 'plane', transport: 'bus', train: 'train-front', nature: 'leaf', eco: 'leaf', environment: 'leaf', tree: 'tree-deciduous', water: 'droplet', temperature: 'thermometer', speedometer: 'gauge', performance: 'gauge', meter: 'gauge', legal: 'scale', law: 'gavel', policy: 'scroll-text', contract: 'file-pen', 'id-badge': 'id-card', identity: 'id-card', fingerprint: 'fingerprint-pattern', qr: 'qr-code',
  tools: 'wrench', tool: 'wrench', maintenance: 'wrench', repair: 'wrench', service: 'wrench', build: 'hammer', manufacturing: 'factory', industry: 'factory',
  'customer-service': 'headset', 'customer-support': 'headset', helpdesk: 'headset', 'help-desk': 'headset', podcast: 'mic', broadcast: 'radio', announcement: 'megaphone', announcements: 'megaphone', campaign: 'megaphone', marketing: 'megaphone', deal: 'handshake', deals: 'handshake', partner: 'handshake', partners: 'handshake', agreement: 'handshake', community: 'users-round', social: 'share-2',
  'format-quote': 'quote', hashtag: 'hash', number: 'hash', percentage: 'percent', at: 'at-sign', mention: 'at-sign', math: 'calculator', 'archive-box': 'archive', outbox: 'send', drafts: 'mail-pen', spam: 'mail-warning', block: 'ban', blocked: 'ban', forbidden: 'ban', disabled: 'ban', prohibited: 'ban', loading: 'loader-circle', spinner: 'loader-circle', pending: 'clock', waiting: 'hourglass', empty: 'inbox', placeholder: 'circle-dashed',
};

const PREFIX = /^(?:lucide|icon|icons|fa|fas|far|fal|fab|mdi|bi|ri|ph|tabler|ti|hero|heroicon|heroicons|material|ms|mi|ion|ionicons?|feather|fi|bx|bxs|gg|iconoir|la|octicon)-/;
const SUFFIX = /-(?:icon|outline|outlined|filled|fill|solid|line|stroke|o|rounded|round|sharp|mini|micro|alt|thin|light|regular|bold|duotone|\d{2})$/;
// Canonical Lucide name for any name a model writes, or null when nothing fits.
function resolveIcon(raw) {
  if (typeof raw !== 'string' || raw.length > 200) return null;
  const I = icons(), has = (n) => I.has(n), alias = (n) => (Object.hasOwn(ICON_ALIASES, n) && has(ICON_ALIASES[n]) ? ICON_ALIASES[n] : null);
  let n = raw.trim().replace(/([a-z0-9])([A-Z])/g, '$1-$2').toLowerCase().replace(/[\s_.:/]+/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '');
  if (!n || n.length > 64) return null;
  if (Object.hasOwn(OVERRIDES, n)) return OVERRIDES[n];
  if (has(n)) return n;
  if (alias(n)) return alias(n);
  for (let i = 0; i < 3; i++) {
    const m = n.replace(PREFIX, '').replace(SUFFIX, '');
    if (m === n || !m) break;
    n = m;
    if (Object.hasOwn(OVERRIDES, n)) return OVERRIDES[n];
    if (has(n)) return n;
    if (alias(n)) return alias(n);
  }
  // Older Lucide/Feather order: "alert-circle" is now "circle-alert".
  const flip = /^(.+)-(circle|square)$/.exec(n);
  if (flip && has(`${flip[2]}-${flip[1]}`)) return `${flip[2]}-${flip[1]}`;
  const swap = /^(circle|square)-(.+)$/.exec(n);
  if (swap && has(`${swap[2]}-${swap[1]}`)) return `${swap[2]}-${swap[1]}`;
  const digits = /^(.*[a-z])(\d+)$/.exec(n);
  if (digits && has(`${digits[1]}-${digits[2]}`)) return `${digits[1]}-${digits[2]}`;
  const plain = n.replace(/-\d+$/, '');
  if (plain !== n && (has(plain) || alias(plain))) return has(plain) ? plain : alias(plain);
  if (n.endsWith('s') && has(n.slice(0, -1))) return n.slice(0, -1);
  return null;
}
const SVG_BASE = { xmlns: 'http://www.w3.org/2000/svg', width: '1em', height: '1em', viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', 'stroke-width': '2', 'stroke-linecap': 'round', 'stroke-linejoin': 'round' };
// Standalone icon markup for application code (decorative unless a label is given).
function iconSVG(name, { label = '', className = '' } = {}) {
  const used = resolveIcon(name) || FALLBACK_ICON;
  return `<svg${attrs({ ...SVG_BASE, class: className || null, ...(label ? { role: 'img', 'aria-label': label } : { 'aria-hidden': 'true' }), focusable: 'false' })}>${icons().get(used)}</svg>`;
}
const KEEP = /^(?:class|id|role|tabindex|hidden|aria-[a-z]+|data-(?!forma-)[a-z0-9-]+)$/;
function iconMarkup(el, source) {
  const name = iconAttribute(el.attribs['data-icon']) || '';
  const used = resolveIcon(name) || FALLBACK_ICON;
  const keep = {};
  for (const [k, v] of Object.entries(el.attribs)) if (KEEP.test(k)) keep[k] = v;
  const title = (el.attribs.title || '').trim().slice(0, 200);
  const named = keep['aria-label'] || keep['aria-labelledby'] || title;
  if (named) {
    keep.role ||= 'img';
    delete keep['aria-hidden'];
  } else keep['aria-hidden'] = 'true';
  return `<svg${attrs({
    ...SVG_BASE,
    ...keep,
    'data-icon': name || null,
    'data-forma-expanded': 'icon',
    'data-forma-fallback': resolveIcon(name) ? null : 'true',
    'data-forma-source': source,
    focusable: 'false',
  })}>${title ? `<title>${escapeHTML(title)}</title>` : ''}${icons().get(used)}</svg>`;
}
// Replace every text-only <i data-icon> with inline SVG. Idempotent: expanded
// output contains no <i data-icon>. Every other byte of the input is preserved.
function expandIcons(html) {
  html = String(html ?? '');
  if (!/data-icon/i.test(html)) return html;
  const edits = findElements(html, (name, a) => name === 'i' && Object.hasOwn(a, 'data-icon'))
    .filter((el) => el.textOnly)
    .map((el) => ({ start: el.start, end: el.end, text: iconMarkup(el, html.slice(el.start, el.end)) }));
  return splice(html, edits);
}
// Compact prompt list: common UI icons, every one a real Lucide name.
const ICON_PROMPT_NAMES = `house layout-dashboard layout-grid list menu search settings sliders-horizontal funnel arrow-up-down
x plus minus check check-check chevron-down chevron-up chevron-left chevron-right arrow-left arrow-right arrow-up arrow-down
arrow-up-right external-link ellipsis ellipsis-vertical maximize-2 refresh-cw log-in log-out pencil square-pen trash copy save
download upload cloud-upload share-2 send printer link paperclip eye eye-off lock lock-open key info circle-alert triangle-alert
circle-check circle-x circle-question-mark badge-check loader-circle bell mail inbox message-square message-circle phone user
users user-plus circle-user id-card shopping-cart shopping-bag store credit-card wallet receipt dollar-sign banknote tag percent
gift package truck chart-column chart-bar chart-line chart-pie trending-up trending-down activity gauge target table database
server file file-text folder folder-open clipboard-list image video camera mic book-open calendar calendar-days calendar-check
clock timer map-pin map globe building laptop monitor smartphone cloud code terminal bot star heart bookmark flag thumbs-up award
sparkles zap rocket lightbulb shield shield-check sun moon layers briefcase graduation-cap headphones kanban list-checks list-todo
play`.split(/\s+/);

module.exports = { expandIcons, iconNames, resolveIcon, iconSVG, ICON_PROMPT_NAMES, ICON_ALIASES, FALLBACK_ICON };
