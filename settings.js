'use strict';

const els = {
  form: document.getElementById('form'),
  url: document.getElementById('url'),
  latitude: document.getElementById('latitude'),
  longitude: document.getElementById('longitude'),
  timeZone: document.getElementById('timeZone'),
  fallbacks: document.getElementById('fallbacks'),
  refreshMinutes: document.getElementById('refreshMinutes'),
  staleMinutes: document.getElementById('staleMinutes'),
  forecast: document.getElementById('forecast'),
  position: document.getElementById('position'),
  inset: document.getElementById('inset'),
  width: document.getElementById('width'),
  height: document.getElementById('height'),
  notifications: document.getElementById('notifications'),
  notifyAbove: document.getElementById('notifyAbove'),
  autoStart: document.getElementById('autoStart'),
  autoStartNote: document.getElementById('autoStartNote'),
  status: document.getElementById('status'),
  cancel: document.getElementById('cancel'),
  save: document.getElementById('save')
};

const POSITION_LABELS = {
  'bottom-right': 'Bottom right',
  'top-right': 'Top right',
  'bottom-left': 'Bottom left',
  'top-left': 'Top left'
};

let packaged = true;

function setStatus(kind, html) {
  els.status.className = 'status' + (kind ? ' ' + kind : '');
  els.status.innerHTML = html;
}

function setFields(cfg) {
  els.url.value = cfg.url || '';
  els.latitude.value = cfg.latitude;
  els.longitude.value = cfg.longitude;
  els.timeZone.value = cfg.timeZone || '';
  els.fallbacks.checked = cfg.fallbacks !== false;
  els.refreshMinutes.value = cfg.refreshMinutes;
  els.staleMinutes.value = cfg.staleMinutes;
  els.forecast.checked = cfg.forecast !== false;
  els.position.value = cfg.position;
  els.inset.value = cfg.inset;
  els.width.value = cfg.width;
  els.height.value = cfg.height;
  els.notifications.checked = cfg.notifications !== false;
  els.notifyAbove.value = cfg.notifyAbove;
}

function setAutoStartState(state) {
  els.autoStart.checked = Boolean(state);
}

function collect() {
  return {
    url: els.url.value.trim(),
    latitude: Number(els.latitude.value),
    longitude: Number(els.longitude.value),
    timeZone: els.timeZone.value.trim(),
    fallbacks: els.fallbacks.checked,
    refreshMinutes: Number(els.refreshMinutes.value),
    staleMinutes: Number(els.staleMinutes.value),
    forecast: els.forecast.checked,
    position: els.position.value,
    inset: Number(els.inset.value),
    width: Number(els.width.value),
    height: Number(els.height.value),
    notifications: els.notifications.checked,
    notifyAbove: Number(els.notifyAbove.value)
  };
}

function validate(values) {
  const errors = [];
  const numeric = [
    ['latitude', values.latitude],
    ['longitude', values.longitude],
    ['refreshMinutes', values.refreshMinutes],
    ['staleMinutes', values.staleMinutes],
    ['inset', values.inset],
    ['width', values.width],
    ['height', values.height],
    ['notifyAbove', values.notifyAbove]
  ];
  for (const [key, value] of numeric) {
    const input = els[key];
    const bad = !Number.isFinite(value);
    input.classList.toggle('invalid', bad);
    if (bad) errors.push(key + ' must be a number');
  }
  const urlOk = /^https?:\/\//i.test(values.url);
  els.url.classList.toggle('invalid', !urlOk);
  if (!urlOk) errors.push('URL must start with http:// or https://');
  if (!values.timeZone) {
    els.timeZone.classList.add('invalid');
    errors.push('time zone is required');
  } else {
    els.timeZone.classList.remove('invalid');
  }
  return errors;
}

async function save(values) {
  const errors = validate(values);
  if (errors.length) {
    setStatus('error', errors[0]);
    return;
  }
  els.save.disabled = true;
  setStatus('', 'Saving…');
  try {
    const result = await window.aqiAPI.settings.save(values);
    if (!result || !result.ok) {
      setStatus('error', (result && result.error) || 'save failed');
      return;
    }
    setFields(result.config);
    setAutoStartState(result.autoStart);
    if (result.warnings && result.warnings.length) {
      setStatus(
        '',
        'Saved with notes<ul><li>' +
          result.warnings.map((w) => escapeHtml(w)).join('</li><li>') +
          '</li></ul>'
      );
    } else {
      setStatus('ok', 'Saved ✓');
    }
  } catch (err) {
    setStatus('error', String(err && err.message ? err.message : err));
  } finally {
    els.save.disabled = false;
  }
}

function escapeHtml(text) {
  return String(text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

els.form.addEventListener('submit', (e) => {
  e.preventDefault();
  save(collect());
});

els.cancel.addEventListener('click', () => {
  window.aqiAPI.settings.close();
});

els.autoStart.addEventListener('change', async () => {
  try {
    const result = await window.aqiAPI.settings.autostart(els.autoStart.checked);
    setAutoStartState(result && result.autoStart);
    if (els.autoStart.checked && !(result && result.autoStart)) {
      setStatus('error', 'Could not enable auto-start');
    }
  } catch (err) {
    setStatus('error', String(err && err.message ? err.message : err));
  }
});

window.aqiAPI.settings
  .get()
  .then((state) => {
    if (!state || !state.ok) {
      setStatus('error', 'Could not load settings');
      return;
    }
    packaged = state.packaged !== false;
    for (const value of state.positions || []) {
      const option = document.createElement('option');
      option.value = value;
      option.textContent = POSITION_LABELS[value] || value;
      els.position.appendChild(option);
    }
    if (!packaged) {
      els.autoStart.disabled = true;
      els.autoStartNote.hidden = false;
    }
    setFields(state.config);
    setAutoStartState(state.autoStart);
    setStatus('', '');
  })
  .catch((err) => {
    setStatus('error', String(err && err.message ? err.message : err));
  });
