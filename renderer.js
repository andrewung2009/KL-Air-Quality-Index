'use strict';

const els = {
  card: document.getElementById('card'),
  badge: document.getElementById('badge'),
  time: document.getElementById('time'),
  stale: document.getElementById('stale'),
  aqi: document.getElementById('aqi'),
  category: document.getElementById('category'),
  pm: document.getElementById('pm'),
  range: document.getElementById('range'),
  error: document.getElementById('error')
};

let settings = {
  staleMinutes: 20,
  timeZone: 'Asia/Kuala_Lumpur',
  clickThrough: false,
  range: true,
  notifications: true
};
let lastPayload = null;

const SOURCE_LABELS = { iqair: 'IQAir', proxy: 'proxy', est: 'est.' };

const ERROR_LABELS = [
  [/ENOTFOUND|ECONNREFUSED|ECONNRESET|EAI_AGAIN|fetch failed|network/i, 'no network'],
  [/deadline|timed?[- ]?out|TIMEOUT/i, 'timed out'],
  [/429|rate limit/i, 'rate limited'],
  [/checkpoint|truncated page|Vercel/i, 'site blocked us'],
  [/JSON-LD|pattern not found|observation/i, 'page changed'],
  [/HTTP 5\d\d/i, 'source down'],
  [/circuit open/i, 'source paused']
];

function friendlyError(raw) {
  const msg = String(raw || 'error');
  for (const [pattern, label] of ERROR_LABELS) {
    if (pattern.test(msg)) return label;
  }
  return 'failed';
}

function formatAge(ms) {
  const total = Math.max(0, Math.floor(ms / 60000));
  if (total < 1) return 'now';
  if (total < 60) return total + 'm';
  const hours = Math.floor(total / 60);
  const minutes = total % 60;
  return hours + 'h' + (minutes ? ' ' + minutes + 'm' : '');
}

function formatObserved(observedAt) {
  if (!observedAt) return '--:--';
  const date = new Date(observedAt);
  if (!Number.isNaN(date.getTime()) && /\d{4}-\d{2}-\d{2}T/.test(observedAt)) {
    try {
      return new Intl.DateTimeFormat('en-GB', {
        hour: '2-digit',
        minute: '2-digit',
        hour12: false,
        timeZone: settings.timeZone
      }).format(date);
    } catch (e) {
      return observedAt;
    }
  }
  const short = String(observedAt).match(/(\d{1,2}:\d{2})/);
  return short ? short[1] : observedAt;
}

function isStale(data) {
  if (!data || !data.fetchedAt) return false;
  const ageMs = Date.now() - new Date(data.fetchedAt).getTime();
  return ageMs > (settings.staleMinutes || 20) * 60 * 1000;
}

function applyClickThrough() {
  document.body.dataset.clickthrough = settings.clickThrough ? 'true' : 'false';
}

function todayInTimeZone() {
  try {
    return new Intl.DateTimeFormat('en-CA', { timeZone: settings.timeZone }).format(new Date());
  } catch (e) {
    return new Date().toISOString().slice(0, 10);
  }
}

function renderRange(payload) {
  const data = payload && payload.dayRange;
  const show =
    settings.range !== false &&
    data &&
    Number.isFinite(Number(data.high)) &&
    Number.isFinite(Number(data.low)) &&
    data.date === todayInTimeZone();
  els.range.hidden = !show;
  if (show) {
    els.range.textContent = '▲' + Math.round(data.high) + ' ▼' + Math.round(data.low);
    els.range.title =
      "Observed today: high " + Math.round(data.high) + ' · low ' + Math.round(data.low);
  } else {
    els.range.textContent = '';
  }
}

function showError(raw) {
  els.error.hidden = false;
  els.error.textContent = friendlyError(raw);
  els.error.title = String(raw || '');
}

function hideError() {
  els.error.hidden = true;
  els.error.textContent = '';
  els.error.title = '';
}

function render(payload) {
  if (payload) lastPayload = payload;
  if (payload && payload.settings) settings = payload.settings;
  applyClickThrough();
  renderRange(payload || lastPayload);

  const data = payload && (payload.data || payload.lastGood);
  const failed = Boolean(payload && payload.ok === false);
  const hasError = failed && Boolean(payload && payload.error);

  if (!data || !data.category) {
    els.card.dataset.state = failed ? 'error' : 'loading';
    els.aqi.textContent = '--';
    els.category.hidden = true;
    els.pm.textContent = 'PM2.5 -- µg/m³';
    els.time.textContent = '--:--';
    els.badge.textContent = 'AQI';
    els.badge.dataset.source = '';
    els.stale.hidden = true;
    if (hasError) {
      showError(payload.error);
    } else {
      els.error.hidden = false;
      els.error.textContent = failed ? '' : 'starting…';
      els.error.title = '';
    }
    return;
  }

  els.card.dataset.state = 'ok';
  els.card.style.setProperty('--card-color', data.category.color);
  els.card.style.setProperty('--card-text', data.category.text);

  els.aqi.textContent = String(data.aqi);
  els.category.textContent = data.category.short || data.category.label;
  els.category.hidden = false;
  els.pm.textContent =
    data.pm25 === null || data.pm25 === undefined
      ? 'PM2.5 -- µg/m³'
      : 'PM2.5 ' + data.pm25 + ' µg/m³';
  els.time.textContent = formatObserved(data.observedAt);
  els.badge.textContent = SOURCE_LABELS[data.source] || data.source;
  els.badge.dataset.source = data.source;

  if (hasError) {
    showError(payload.error);
    els.stale.hidden = true;
  } else {
    hideError();
    const stale = isStale(data);
    els.stale.hidden = !stale;
    if (stale) {
      els.stale.textContent = formatAge(Date.now() - new Date(data.fetchedAt).getTime());
      els.stale.title = 'Last updated ' + data.fetchedAt;
    } else {
      els.stale.textContent = '●';
      els.stale.title = 'Data is fresh';
    }
  }
}

window.aqiAPI.onUpdate(render);

document.getElementById('card').addEventListener('contextmenu', (e) => {
  e.preventDefault();
});

setInterval(() => {
  if (lastPayload) render(lastPayload);
}, 60000);

render({ lastGood: null });

window.aqiAPI
  .getState()
  .then((state) => {
    if (state) render(state);
  })
  .catch(() => {});
