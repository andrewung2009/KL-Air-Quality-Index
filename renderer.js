'use strict';

const els = {
  card: document.getElementById('card'),
  badge: document.getElementById('badge'),
  time: document.getElementById('time'),
  stale: document.getElementById('stale'),
  aqi: document.getElementById('aqi'),
  category: document.getElementById('category'),
  pm: document.getElementById('pm'),
  error: document.getElementById('error')
};

let settings = { staleMinutes: 20, timeZone: 'Asia/Kuala_Lumpur' };

const SOURCE_LABELS = { iqair: 'IQAir', proxy: 'proxy', est: 'est.' };

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

function render(payload) {
  if (payload && payload.settings) settings = payload.settings;

  const data = payload && (payload.data || payload.lastGood);
  const failed = payload && payload.ok === false;

  if (!data) {
    els.card.dataset.state = 'error';
    els.aqi.textContent = '--';
    els.category.hidden = true;
    els.pm.textContent = 'PM2.5 -- µg/m³';
    els.time.textContent = '--:--';
    els.badge.textContent = 'AQI';
    els.error.hidden = false;
    els.error.textContent = failed ? (payload.error || 'error').slice(0, 46) : 'starting…';
    els.stale.hidden = true;
    return;
  }

  els.card.dataset.state = 'ok';
  els.card.style.setProperty('--card-color', data.category.color);
  els.card.style.setProperty('--card-text', data.category.text);

  els.aqi.textContent = String(data.aqi);
  els.category.textContent = data.category.short || data.category.label;
  els.category.hidden = failed;
  els.pm.textContent =
    data.pm25 === null || data.pm25 === undefined
      ? 'PM2.5 -- µg/m³'
      : 'PM2.5 ' + data.pm25 + ' µg/m³';
  els.time.textContent = formatObserved(data.observedAt);
  els.badge.textContent = SOURCE_LABELS[data.source] || data.source;
  els.badge.dataset.source = data.source;

  const stale = isStale(data) || failed;
  els.stale.hidden = !stale;
  els.error.hidden = !failed;
  els.error.textContent = failed ? String(payload.error || '').slice(0, 46) : '';
}

window.aqiAPI.onUpdate(render);

document.getElementById('card').addEventListener('contextmenu', (e) => {
  e.preventDefault();
});

render({ ok: false, lastGood: null });

window.aqiAPI
  .getState()
  .then((state) => {
    if (state && state.data) render(state);
  })
  .catch(() => {});
