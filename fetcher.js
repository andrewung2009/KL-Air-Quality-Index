'use strict';

const { loadConfig } = require('./defaults');

const initialLoad = loadConfig(__dirname);
let CONFIG = initialLoad.config;
const CONFIG_WARNINGS = initialLoad.warnings;

function configure(config) {
  if (config && typeof config === 'object' && !Array.isArray(config)) {
    CONFIG = config;
  }
}

const USER_AGENTS = [
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Safari/605.1.15',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:132.0) Gecko/20100101 Firefox/132.0'
];

const MINUTE = 60 * 1000;
const CHAIN_BUDGET_MS = 90000;
const MIN_STEP_MS = 1500;
const PRIMARY_FAILURE_LIMIT = 3;
const PRIMARY_SKIP_MS = 30 * MINUTE;

let primaryFailures = 0;
let primarySkipUntil = 0;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function remainingMs(deadline) {
  return deadline - Date.now();
}

function timeoutSignal(deadline, capMs) {
  const ms = Math.min(capMs, remainingMs(deadline));
  if (ms < MIN_STEP_MS) {
    const err = new Error('fetch chain deadline exceeded (' + Math.round(CHAIN_BUDGET_MS / 1000) + 's)');
    err.deadline = true;
    err.retryable = false;
    throw err;
  }
  return AbortSignal.timeout(ms);
}

function openMeteoUrl() {
  return (
    'https://air-quality-api.open-meteo.com/v1/air-quality' +
    '?latitude=' + encodeURIComponent(CONFIG.latitude) +
    '&longitude=' + encodeURIComponent(CONFIG.longitude) +
    '&current=us_aqi,pm2_5&timezone=' + encodeURIComponent(CONFIG.timeZone)
  );
}

function jinaUrl() {
  return 'https://r.jina.ai/' + CONFIG.url;
}

function classify(aqi) {
  if (aqi <= 50) return { label: 'Good', short: 'Good', color: '#00e400', text: '#0b0b0b' };
  if (aqi <= 100) return { label: 'Moderate', short: 'Moderate', color: '#ffee00', text: '#0b0b0b' };
  if (aqi <= 150)
    return { label: 'Unhealthy for Sensitive Groups', short: 'Sensitive', color: '#ff7e00', text: '#0b0b0b' };
  if (aqi <= 200) return { label: 'Unhealthy', short: 'Unhealthy', color: '#ff0000', text: '#ffffff' };
  if (aqi <= 300)
    return { label: 'Very Unhealthy', short: 'V. Unhealthy', color: '#8f3f97', text: '#ffffff' };
  return { label: 'Hazardous', short: 'Hazardous', color: '#7e0023', text: '#ffffff' };
}

function finalize(aqi, pm25, observedAt, source, fetchedAt) {
  return {
    aqi: Math.round(aqi),
    pm25: pm25 === null || pm25 === undefined ? null : Math.round(pm25 * 10) / 10,
    category: classify(Math.round(aqi)),
    observedAt: observedAt || null,
    source,
    fetchedAt: fetchedAt || new Date().toISOString()
  };
}

function isBlockedPage(html) {
  if (!html) return true;
  if (html.includes('Vercel Security Checkpoint')) return true;
  if (html.includes('Just a moment...')) return true;
  return html.length < 100000;
}

function parseJsonLd(html) {
  const re = /<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  let match;
  while ((match = re.exec(html)) !== null) {
    let obj;
    try {
      obj = JSON.parse(match[1].trim());
    } catch (e) {
      continue;
    }
    const graph = obj && Array.isArray(obj['@graph']) ? obj['@graph'] : [obj];
    for (const node of graph) {
      if (!node || typeof node !== 'object' || node['@type'] !== 'Observation') continue;
      const measured = node.variableMeasured;
      if (!Array.isArray(measured)) continue;
      let aqi = null;
      let pm25 = null;
      for (const item of measured) {
        if (!item || item.value === null || item.value === undefined) continue;
        const value = Number(item.value);
        if (!Number.isFinite(value)) continue;
        const name = String(item.name || '');
        if (/Air Quality Index/i.test(name)) aqi = value;
        else if (/PM2\.5/i.test(name)) pm25 = value;
      }
      if (aqi !== null) {
        return { aqi, pm25, observedAt: node.observationDate || null };
      }
    }
  }
  return null;
}

function notePrimaryFailure() {
  primaryFailures += 1;
  if (primaryFailures >= PRIMARY_FAILURE_LIMIT) {
    primarySkipUntil = Date.now() + PRIMARY_SKIP_MS;
  }
}

function primaryIsOpen() {
  return Date.now() < primarySkipUntil;
}

function primarySkipMinutesLeft() {
  return Math.max(1, Math.ceil((primarySkipUntil - Date.now()) / MINUTE));
}

async function fetchIqairOnce(attempt, deadline) {
  const res = await fetch(CONFIG.url, {
    redirect: 'follow',
    signal: timeoutSignal(deadline, 30000),
    headers: {
      'User-Agent': USER_AGENTS[attempt % USER_AGENTS.length],
      Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      'Accept-Language': 'en-US,en;q=0.9',
      'Cache-Control': 'no-cache',
      Pragma: 'no-cache'
    }
  });
  if (res.status === 429) {
    throw Object.assign(new Error('HTTP 429 rate limited'), { retryable: true, wait: true });
  }
  if (!res.ok) {
    throw Object.assign(new Error('HTTP ' + res.status), { retryable: res.status >= 500 });
  }
  const html = await res.text();
  if (isBlockedPage(html)) {
    throw Object.assign(
      new Error('bot checkpoint / truncated page (' + html.length + ' bytes)'),
      { retryable: true, wait: true }
    );
  }
  const parsed = parseJsonLd(html);
  if (!parsed) {
    throw Object.assign(new Error('JSON-LD observation not found in page'), { retryable: false });
  }
  return parsed;
}

async function fetchIqair(deadline = Date.now() + CHAIN_BUDGET_MS) {
  let lastError = new Error('iqair: not attempted');
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const parsed = await fetchIqairOnce(attempt, deadline);
      primaryFailures = 0;
      primarySkipUntil = 0;
      return finalize(parsed.aqi, parsed.pm25, parsed.observedAt, 'iqair');
    } catch (err) {
      lastError = err;
      if (err.retryable === false || err.deadline) break;
      if (attempt < 2) {
        const wait = (err.wait ? 9000 : 4000) + Math.floor(Math.random() * 8000) + attempt * 6000;
        if (wait >= remainingMs(deadline)) break;
        await sleep(wait);
      }
    }
  }
  notePrimaryFailure();
  throw lastError;
}

async function fetchJinaOnce(attempt, deadline) {
  const res = await fetch(jinaUrl(), {
    redirect: 'follow',
    signal: timeoutSignal(deadline, 45000),
    headers: {
      Accept: 'text/plain',
      'User-Agent': USER_AGENTS[attempt % USER_AGENTS.length]
    }
  });
  if (res.status === 403 || res.status === 429 || res.status >= 500) {
    throw Object.assign(new Error('jina: HTTP ' + res.status), { retryable: true });
  }
  if (!res.ok) throw new Error('jina: HTTP ' + res.status);
  const text = await res.text();
  const aqiMatch = text.match(/\n(\d{1,3})\s*\n+\s*US AQI/i);
  if (!aqiMatch) {
    throw Object.assign(new Error('jina: AQI pattern not found'), { retryable: true });
  }
  const pmMatch = text.match(/Main pollutant:\s*\n+\s*PM2\.5\s*\n+\s*([\d.]+)/i);
  const timeMatch = text.match(/(\d{1,2}:\d{2})\s*,\s*([A-Za-z]{3}\s+\d{1,2})/);
  const observedAt = timeMatch ? timeMatch[1] + ' ' + timeMatch[2] : null;
  return finalize(Number(aqiMatch[1]), pmMatch ? Number(pmMatch[1]) : null, observedAt, 'proxy');
}

async function fetchJina(deadline = Date.now() + CHAIN_BUDGET_MS) {
  let lastError = new Error('jina: not attempted');
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      return await fetchJinaOnce(attempt, deadline);
    } catch (err) {
      lastError = err;
      if (err.retryable === false || err.deadline) break;
      if (attempt < 2) {
        const wait = 5000 + Math.floor(Math.random() * 9000) + attempt * 5000;
        if (wait >= remainingMs(deadline)) break;
        await sleep(wait);
      }
    }
  }
  throw lastError;
}

async function fetchOpenMeteo(deadline = Date.now() + CHAIN_BUDGET_MS) {
  const res = await fetch(openMeteoUrl(), { signal: timeoutSignal(deadline, 30000) });
  if (!res.ok) throw new Error('open-meteo: HTTP ' + res.status);
  const json = await res.json();
  const current = json && json.current;
  if (!current || !Number.isFinite(current.us_aqi)) {
    throw new Error('open-meteo: no us_aqi in response');
  }
  return finalize(current.us_aqi, current.pm25 ?? current.pm2_5, current.time, 'est');
}

async function runStep(label, fn, errors, deadline) {
  if (remainingMs(deadline) < MIN_STEP_MS) {
    errors.push('deadline exceeded before next source');
    const err = new Error(errors.join(' | '));
    err.deadline = true;
    throw err;
  }
  try {
    return await fn();
  } catch (err) {
    errors.push(label ? label + ': ' + err.message : err.message);
    if (err.deadline) {
      const wrapped = new Error(errors.join(' | '));
      wrapped.deadline = true;
      throw wrapped;
    }
    return null;
  }
}

async function fetchAQI(options) {
  const opts = options || {};
  const allowFallbacks = opts.fallbacks !== false && CONFIG.fallbacks !== false;
  const bypassCircuit = opts.bypassCircuit === true;
  const budget = Number(opts.budgetMs) > 0 ? Number(opts.budgetMs) : CHAIN_BUDGET_MS;
  const deadline = Date.now() + budget;
  const errors = [];

  if (bypassCircuit || !primaryIsOpen()) {
    const primary = await runStep('iqair', () => fetchIqair(deadline), errors, deadline);
    if (primary) return primary;
  } else {
    errors.push('iqair: circuit open, ' + primarySkipMinutesLeft() + 'm left');
  }

  if (!allowFallbacks) {
    throw new Error(errors.join(' | '));
  }

  const proxied = await runStep('', () => fetchJina(deadline), errors, deadline);
  if (proxied) return proxied;

  const estimated = await runStep('', () => fetchOpenMeteo(deadline), errors, deadline);
  if (estimated) return estimated;

  throw new Error(errors.join(' | '));
}

module.exports = {
  fetchAQI,
  configure,
  classify,
  fetchIqair,
  fetchJina,
  fetchOpenMeteo,
  isBlockedPage,
  parseJsonLd,
  CHAIN_BUDGET_MS,
  MINUTE
};

if (require.main === module) {
  for (const warning of CONFIG_WARNINGS) console.error('config warning:', warning);
  fetchAQI()
    .then((data) => {
      console.log(JSON.stringify({ data }, null, 2));
      process.exit(0);
    })
    .catch((err) => {
      console.error('ALL SOURCES FAILED:', err.message);
      process.exit(1);
    });
}
