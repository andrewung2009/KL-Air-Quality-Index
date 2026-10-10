'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { fetchAQI, configure } = require('../fetcher');

const PAGE =
  '<html><head></head><body>' +
  'x'.repeat(120000) +
  '<script type="application/ld+json">' +
  JSON.stringify({
    '@type': 'Observation',
    observationDate: '2026-10-10T02:00:00.000Z',
    variableMeasured: [
      { name: 'US Air Quality Index', value: 65 },
      { name: 'PM2.5', value: 18.2 }
    ]
  }) +
  '</script></body></html>';

const JINA_TEXT =
  'header\n65\n\nUS AQI\nMain pollutant:\n\nPM2.5\n\n18.2\n10:00, Oct 10';

function response({ ok = true, status = 200, text, json } = {}) {
  return {
    ok,
    status,
    text: async () => text || '',
    json: async () => json
  };
}

function stubFetch(routes) {
  global.fetch = async (url) => {
    const u = String(url);
    for (const [match, res] of routes) {
      if (u.startsWith(match) || (!match.startsWith('http') && u.includes(match))) {
        return typeof res === 'function' ? res(u) : res;
      }
    }
    throw new Error('unexpected fetch: ' + u);
  };
}

const NOT_FOUND = response({ ok: false, status: 404 });
const IQAIR = 'https://example.com';
const JINA = 'https://r.jina.ai/';
const OPEN_METEO = 'https://air-quality-api.open-meteo.com/';

test.before(() => {
  configure({
    url: 'https://example.com/iqair-page',
    latitude: 3.139,
    longitude: 101.6869,
    timeZone: 'Asia/Kuala_Lumpur',
    fallbacks: true
  });
});

test.afterEach(() => {
  delete global.fetch;
});

test('returns the IQAir observation when the page parses', async () => {
  stubFetch([[IQAIR, response({ text: PAGE })]]);
  const data = await fetchAQI({ bypassCircuit: true, budgetMs: 4000 });
  assert.equal(data.source, 'iqair');
  assert.equal(data.aqi, 65);
  assert.equal(data.pm25, 18.2);
  assert.equal(data.category.label, 'Moderate');
});

test('falls through to the jina proxy when IQAir hard-fails', async () => {
  stubFetch([
    [JINA, response({ text: JINA_TEXT })],
    [IQAIR, NOT_FOUND]
  ]);
  const data = await fetchAQI({ bypassCircuit: true, budgetMs: 4000 });
  assert.equal(data.source, 'proxy');
  assert.equal(data.aqi, 65);
  assert.equal(data.pm25, 18.2);
});

test('falls through to Open-Meteo when both page sources fail', async () => {
  stubFetch([
    [OPEN_METEO, response({ json: { current: { us_aqi: 77, pm25: 20 } } })],
    [JINA, NOT_FOUND],
    [IQAIR, NOT_FOUND]
  ]);
  const data = await fetchAQI({ bypassCircuit: true, budgetMs: 4000 });
  assert.equal(data.source, 'est');
  assert.equal(data.aqi, 77);
  assert.equal(data.pm25, 20);
  assert.equal(data.category.label, 'Moderate');
});

test('fallbacks:false fails fast instead of walking the chain', async () => {
  stubFetch([[IQAIR, NOT_FOUND]]);
  await assert.rejects(
    fetchAQI({ fallbacks: false, bypassCircuit: true, budgetMs: 4000 }),
    /iqair: HTTP 404/
  );
});

test('collects per-source labels when everything fails', async () => {
  stubFetch([
    [OPEN_METEO, response({ ok: false, status: 500 })],
    [JINA, NOT_FOUND],
    [IQAIR, NOT_FOUND]
  ]);
  await assert.rejects(fetchAQI({ bypassCircuit: true, budgetMs: 4000 }), (err) => {
    assert.match(err.message, /iqair: HTTP 404/);
    assert.match(err.message, /jina: HTTP 404/);
    assert.match(err.message, /open-meteo: HTTP 500/);
    return true;
  });
});

test('open-meteo without us_aqi is treated as a failure', async () => {
  stubFetch([
    [OPEN_METEO, response({ json: { current: {} } })],
    [JINA, NOT_FOUND],
    [IQAIR, NOT_FOUND]
  ]);
  await assert.rejects(fetchAQI({ bypassCircuit: true, budgetMs: 4000 }), /no us_aqi/);
});
