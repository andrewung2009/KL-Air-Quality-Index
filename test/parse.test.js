'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { parseJsonLd, isBlockedPage } = require('../fetcher');

function observationHtml(nodes) {
  const doc = Array.isArray(nodes) ? { '@graph': nodes } : nodes;
  return (
    '<html><head><title>air</title></head><body>' +
    'x'.repeat(120000) +
    '<script type="application/ld+json">' +
    JSON.stringify(doc) +
    '</script></body></html>'
  );
}

test('extracts AQI and PM2.5 from an @graph Observation', () => {
  const html = observationHtml([
    { '@type': 'WebPage' },
    {
      '@type': 'Observation',
      observationDate: '2026-10-10T02:00:00.000Z',
      variableMeasured: [
        { name: 'US Air Quality Index', value: 65 },
        { name: 'PM2.5', value: '18.2' }
      ]
    }
  ]);
  const parsed = parseJsonLd(html);
  assert.equal(parsed.aqi, 65);
  assert.equal(parsed.pm25, 18.2);
  assert.equal(parsed.observedAt, '2026-10-10T02:00:00.000Z');
});

test('handles a bare Observation without @graph', () => {
  const html = observationHtml({
    '@type': 'Observation',
    variableMeasured: [{ name: 'Air Quality Index', value: 120 }]
  });
  const parsed = parseJsonLd(html);
  assert.equal(parsed.aqi, 120);
  assert.equal(parsed.pm25, null);
  assert.equal(parsed.observedAt, null);
});

test('skips malformed JSON-LD blocks and finds a later valid one', () => {
  const html =
    '<html><body>' +
    'x'.repeat(120000) +
    '<script type="application/ld+json">{ nope</script>' +
    '<script type="application/ld+json">' +
    JSON.stringify({
      '@type': 'Observation',
      variableMeasured: [{ name: 'US Air Quality Index', value: 42 }]
    }) +
    '</script></body></html>';
  assert.equal(parseJsonLd(html).aqi, 42);
});

test('returns null when no Observation exists', () => {
  const html = observationHtml({ '@type': 'WebPage', name: 'nothing here' });
  assert.equal(parseJsonLd(html), null);
  assert.equal(parseJsonLd('<html>' + 'x'.repeat(120000) + '</html>'), null);
});

test('ignores Observations without usable measurements', () => {
  const html = observationHtml([
    { '@type': 'Observation', variableMeasured: 'not-an-array' },
    { '@type': 'Observation', variableMeasured: [{ name: 'Temperature', value: 31 }] }
  ]);
  assert.equal(parseJsonLd(html), null);
});

test('isBlockedPage flags checkpoints and truncated pages', () => {
  assert.equal(isBlockedPage(null), true);
  assert.equal(isBlockedPage(''), true);
  assert.equal(isBlockedPage('Vercel Security Checkpoint - please wait'), true);
  assert.equal(isBlockedPage('Just a moment... checking your browser'), true);
  assert.equal(isBlockedPage('short'), true);
  assert.equal(isBlockedPage('x'.repeat(100000)), false);
});
