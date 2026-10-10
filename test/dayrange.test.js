'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { updateDayRange, isDayRange, loadConfig } = require('../defaults');
const fs = require('fs');
const os = require('os');
const path = require('path');

test('first reading of the day seeds the range', () => {
  assert.deepEqual(updateDayRange(null, 100, '2026-10-10'), {
    date: '2026-10-10',
    high: 100,
    low: 100
  });
});

test('later readings widen the range in the right direction', () => {
  let range = updateDayRange(null, 100, '2026-10-10');
  range = updateDayRange(range, 150, '2026-10-10');
  assert.deepEqual(range, { date: '2026-10-10', high: 150, low: 100 });
  range = updateDayRange(range, 60, '2026-10-10');
  assert.deepEqual(range, { date: '2026-10-10', high: 150, low: 60 });
  range = updateDayRange(range, 120, '2026-10-10');
  assert.deepEqual(range, { date: '2026-10-10', high: 150, low: 60 });
});

test('a new date resets the range', () => {
  const yesterday = { date: '2026-10-09', high: 250, low: 30 };
  assert.deepEqual(updateDayRange(yesterday, 80, '2026-10-10'), {
    date: '2026-10-10',
    high: 80,
    low: 80
  });
});

test('readings are rounded to whole AQI values', () => {
  assert.deepEqual(updateDayRange(null, 100.6, '2026-10-10'), {
    date: '2026-10-10',
    high: 101,
    low: 101
  });
});

test('invalid readings leave the previous range untouched', () => {
  const prev = { date: '2026-10-10', high: 120, low: 90 };
  assert.equal(updateDayRange(prev, NaN, '2026-10-10'), prev);
  assert.equal(updateDayRange(prev, null, '2026-10-10'), prev);
  assert.equal(updateDayRange(prev, 100, 'nonsense'), prev);
  assert.equal(updateDayRange('junk', NaN, '2026-10-10'), null);
});

test('isDayRange validates shape and date format', () => {
  assert.equal(isDayRange({ date: '2026-10-10', high: 1, low: 2 }), true);
  assert.equal(isDayRange({ date: '2026/10/10', high: 1, low: 2 }), false);
  assert.equal(isDayRange({ date: '2026-10-10', high: 1 }), false);
  assert.equal(isDayRange(null), false);
  assert.equal(isDayRange('x'), false);
});

test('legacy forecast config key maps onto range without warnings', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'aqi-range-'));
  try {
    fs.writeFileSync(path.join(dir, 'config.json'), JSON.stringify({ forecast: false }));
    const { config, warnings } = loadConfig(dir);
    assert.equal(config.range, false);
    assert.deepEqual(warnings, []);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('an explicit range key wins over the legacy forecast key', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'aqi-range-'));
  try {
    fs.writeFileSync(
      path.join(dir, 'config.json'),
      JSON.stringify({ forecast: false, range: true })
    );
    const { config } = loadConfig(dir);
    assert.equal(config.range, true);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
