'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { loadConfig, DEFAULTS, POSITIONS, OVERRIDE_KEYS } = require('../defaults');

function withConfigFile(contents, fn) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'aqi-config-'));
  try {
    if (contents !== undefined) {
      const text = typeof contents === 'string' ? contents : JSON.stringify(contents);
      fs.writeFileSync(path.join(dir, 'config.json'), text);
    }
    return fn(dir);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

test('missing config file falls back to defaults with a warning', () => {
  withConfigFile(undefined, (dir) => {
    const { config, warnings } = loadConfig(dir);
    assert.equal(warnings.length, 1);
    assert.match(warnings[0], /unreadable/);
    assert.equal(config.refreshMinutes, DEFAULTS.refreshMinutes);
    assert.equal(config.position, DEFAULTS.position);
    assert.equal(config.focusable, false);
    assert.equal(config.notifications, true);
    assert.equal(config.range, true);
    assert.equal(config.notifyAbove, 0);
  });
});

test('valid partial config is merged onto defaults', () => {
  withConfigFile({ refreshMinutes: 5, position: 'top-left' }, (dir) => {
    const { config, warnings } = loadConfig(dir);
    assert.deepEqual(warnings, []);
    assert.equal(config.refreshMinutes, 5);
    assert.equal(config.position, 'top-left');
    assert.equal(config.width, DEFAULTS.width);
    assert.equal(config.timeZone, 'Asia/Kuala_Lumpur');
  });
});

test('malformed JSON warns and uses defaults', () => {
  withConfigFile('{ not json', (dir) => {
    const { config, warnings } = loadConfig(dir);
    assert.equal(warnings.length, 1);
    assert.match(warnings[0], /unreadable/);
    assert.equal(config.refreshMinutes, DEFAULTS.refreshMinutes);
  });
});

test('non-object JSON warns and uses defaults', () => {
  withConfigFile('[1,2,3]', (dir) => {
    const { config, warnings } = loadConfig(dir);
    assert.equal(warnings.length, 1);
    assert.match(warnings[0], /must contain a JSON object/);
    assert.equal(config.position, DEFAULTS.position);
  });
});

test('unknown config keys are ignored with a warning', () => {
  withConfigFile({ colour: 'red', refreshMinutes: 15 }, (dir) => {
    const { config, warnings } = loadConfig(dir);
    assert.ok(warnings.some((w) => /unknown config key "colour"/.test(w)));
    assert.equal(config.refreshMinutes, 15);
  });
});

test('out-of-range numbers fall back to defaults with warnings', () => {
  withConfigFile({ width: 10, height: 9999, refreshMinutes: 0, inset: -5, notifyAbove: 999 }, (dir) => {
    const { config, warnings } = loadConfig(dir);
    assert.equal(config.width, DEFAULTS.width);
    assert.equal(config.height, DEFAULTS.height);
    assert.equal(config.refreshMinutes, DEFAULTS.refreshMinutes);
    assert.equal(config.inset, DEFAULTS.inset);
    assert.equal(config.notifyAbove, 0);
    assert.equal(warnings.length, 5);
  });
});

test('staleMinutes below refreshMinutes is raised to match', () => {
  withConfigFile({ refreshMinutes: 30, staleMinutes: 10 }, (dir) => {
    const { config, warnings } = loadConfig(dir);
    assert.equal(config.staleMinutes, 30);
    assert.ok(warnings.some((w) => /staleMinutes.*below refreshMinutes/.test(w)));
  });
});

test('invalid position, url and timeZone fall back with warnings', () => {
  withConfigFile({ position: 'middle', url: 'ftp://x', timeZone: 'Mars/Olympus' }, (dir) => {
    const { config, warnings } = loadConfig(dir);
    assert.equal(config.position, 'bottom-right');
    assert.equal(config.url, DEFAULTS.url);
    assert.equal(config.timeZone, DEFAULTS.timeZone);
    assert.ok(warnings.some((w) => /invalid position/.test(w)));
    assert.ok(warnings.some((w) => /invalid url/.test(w)));
    assert.ok(warnings.some((w) => /invalid timeZone/.test(w)));
  });
});

test('boolean fields coerce stringy values', () => {
  withConfigFile(
    { clickThrough: 'false', transparent: 'true', focusable: 0, notifications: 'yes' },
    (dir) => {
      const { config } = loadConfig(dir);
      assert.equal(config.clickThrough, false);
      assert.equal(config.transparent, true);
      assert.equal(config.focusable, false);
      assert.equal(config.notifications, true);
    }
  );
});

test('valid override keys win over the file, unknown ones warn', () => {
  withConfigFile({ position: 'top-right', refreshMinutes: 60 }, (dir) => {
    const { config, warnings } = loadConfig(dir, { position: 'bottom-left', nonsense: 1 });
    assert.equal(config.position, 'bottom-left');
    assert.equal(config.refreshMinutes, 60);
    assert.ok(warnings.some((w) => /unknown state override "nonsense"/.test(w)));
    assert.ok(OVERRIDE_KEYS.includes('position'));
    assert.ok(POSITIONS.includes('bottom-left'));
  });
});
