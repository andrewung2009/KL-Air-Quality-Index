'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { fetchForecast, configure } = require('../fetcher');

const TZ = 'Asia/Kuala_Lumpur';

function todayInTz() {
  return new Intl.DateTimeFormat('en-CA', { timeZone: TZ }).format(new Date());
}

function stubFetch(handler) {
  global.fetch = async (url) => handler(String(url));
}

function jsonResponse(body, ok = true, status = 200) {
  return { ok, status, json: async () => body };
}

test.before(() => {
  configure({ latitude: 3.139, longitude: 101.6869, timeZone: TZ, fallbacks: true });
});

test.afterEach(() => {
  delete global.fetch;
});

test('keeps only today\'s hours in the configured timezone and rounds high/low', async () => {
  const today = todayInTz();
  stubFetch(() =>
    jsonResponse({
      hourly: {
        time: [today + 'T01:00', today + 'T02:00', today + 'T03:00', '2099-01-01T10:00'],
        us_aqi: [120.4, 58.6, 99, 400]
      }
    })
  );
  const forecast = await fetchForecast(Date.now() + 15000);
  assert.equal(forecast.date, today);
  assert.equal(forecast.high, 120);
  assert.equal(forecast.low, 59);
  assert.equal(forecast.source, 'forecast');
});

test('skips non-numeric hourly values', async () => {
  const today = todayInTz();
  stubFetch(() =>
    jsonResponse({
      hourly: {
        time: [today + 'T05:00', today + 'T06:00', today + 'T07:00'],
        us_aqi: [null, 77, 'not-a-number']
      }
    })
  );
  const forecast = await fetchForecast(Date.now() + 15000);
  assert.equal(forecast.high, 77);
  assert.equal(forecast.low, 77);
});

test('throws when today has no hourly readings', async () => {
  stubFetch(() =>
    jsonResponse({
      hourly: {
        time: ['2099-01-01T00:00'],
        us_aqi: [10]
      }
    })
  );
  await assert.rejects(fetchForecast(Date.now() + 15000), /no hourly us_aqi/);
});

test('throws when the API responds with an error status', async () => {
  stubFetch(() => jsonResponse(null, false, 503));
  await assert.rejects(fetchForecast(Date.now() + 15000), /HTTP 503/);
});

test('throws when the response shape is unusable', async () => {
  stubFetch(() => jsonResponse({}));
  await assert.rejects(fetchForecast(Date.now() + 15000), /no hourly us_aqi/);
});
