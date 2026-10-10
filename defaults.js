'use strict';

const fs = require('fs');
const path = require('path');

const DEFAULTS = {
  url: 'https://www.iqair.com/air-quality/malaysia/kuala-lumpur/kuala-lumpur',
  latitude: 3.139,
  longitude: 101.6869,
  refreshMinutes: 10,
  staleMinutes: 20,
  position: 'bottom-right',
  inset: 16,
  width: 224,
  height: 96,
  timeZone: 'Asia/Kuala_Lumpur',
  fallbacks: true,
  clickThrough: false,
  transparent: false,
  focusable: false,
  notifications: true,
  notifyAbove: 0,
  range: true
};

const POSITIONS = ['bottom-right', 'top-right', 'bottom-left', 'top-left'];
const OVERRIDE_KEYS = ['position', 'refreshMinutes', 'clickThrough'];

function pickNumber(value, min, max, fallback, label, warnings) {
  const n = Number(value);
  if (Number.isFinite(n) && n >= min && n <= max) return n;
  warnings.push('invalid ' + label + ' (' + JSON.stringify(value) + '); using ' + fallback);
  return fallback;
}

function toBool(value, fallback) {
  if (typeof value === 'boolean') return value;
  if (value === undefined || value === null) return fallback;
  return !(value === false || value === 'false' || value === 0);
}

function validTimeZone(tz) {
  if (typeof tz !== 'string' || !tz) return false;
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz });
    return true;
  } catch (err) {
    return false;
  }
}

function loadConfig(dir, overrides) {
  const configPath = path.join(dir || __dirname, 'config.json');
  const warnings = [];
  let user = {};

  try {
    const parsed = JSON.parse(fs.readFileSync(configPath, 'utf8').replace(/^\uFEFF/, ''));
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      user = parsed;
    } else {
      warnings.push('config.json must contain a JSON object; using defaults');
    }
  } catch (err) {
    warnings.push('config.json unreadable (' + err.message + '); using defaults');
  }

  const ov = overrides && typeof overrides === 'object' ? overrides : {};
  for (const key of Object.keys(ov)) {
    if (OVERRIDE_KEYS.includes(key)) {
      user[key] = ov[key];
    } else {
      warnings.push('unknown state override "' + key + '" ignored');
    }
  }

  if (Object.prototype.hasOwnProperty.call(user, 'forecast')) {
    if (!Object.prototype.hasOwnProperty.call(user, 'range')) {
      user.range = user.forecast;
    }
    delete user.forecast;
  }

  for (const key of Object.keys(user)) {
    if (!Object.prototype.hasOwnProperty.call(DEFAULTS, key)) {
      warnings.push('unknown config key "' + key + '" ignored');
    }
  }

  const config = Object.assign({}, DEFAULTS, user);

  config.width = pickNumber(config.width, 160, 600, DEFAULTS.width, 'width', warnings);
  config.height = pickNumber(config.height, 64, 400, DEFAULTS.height, 'height', warnings);
  config.refreshMinutes = pickNumber(
    config.refreshMinutes,
    1,
    1440,
    DEFAULTS.refreshMinutes,
    'refreshMinutes',
    warnings
  );
  config.staleMinutes = pickNumber(
    config.staleMinutes,
    1,
    14400,
    DEFAULTS.staleMinutes,
    'staleMinutes',
    warnings
  );
  config.inset = pickNumber(config.inset, 0, 400, DEFAULTS.inset, 'inset', warnings);
  config.notifyAbove = pickNumber(
    config.notifyAbove,
    0,
    500,
    DEFAULTS.notifyAbove,
    'notifyAbove',
    warnings
  );
  config.latitude = pickNumber(config.latitude, -90, 90, DEFAULTS.latitude, 'latitude', warnings);
  config.longitude = pickNumber(
    config.longitude,
    -180,
    180,
    DEFAULTS.longitude,
    'longitude',
    warnings
  );

  if (config.staleMinutes < config.refreshMinutes) {
    warnings.push(
      'staleMinutes (' + config.staleMinutes + ') is below refreshMinutes (' +
        config.refreshMinutes + '); using ' + config.refreshMinutes
    );
    config.staleMinutes = config.refreshMinutes;
  }

  if (!POSITIONS.includes(config.position)) {
    warnings.push('invalid position "' + config.position + '"; using ' + DEFAULTS.position);
    config.position = DEFAULTS.position;
  }
  if (typeof config.url !== 'string' || !/^https?:\/\//i.test(config.url)) {
    warnings.push('invalid url; using the default IQAir page');
    config.url = DEFAULTS.url;
  }
  if (!validTimeZone(config.timeZone)) {
    warnings.push('invalid timeZone "' + config.timeZone + '"; using ' + DEFAULTS.timeZone);
    config.timeZone = DEFAULTS.timeZone;
  }

  config.fallbacks = toBool(config.fallbacks, DEFAULTS.fallbacks);
  config.clickThrough = toBool(config.clickThrough, DEFAULTS.clickThrough);
  config.transparent = toBool(config.transparent, DEFAULTS.transparent);
  config.focusable = toBool(config.focusable, DEFAULTS.focusable);
  config.notifications = toBool(config.notifications, DEFAULTS.notifications);
  config.range = toBool(config.range, DEFAULTS.range);

  return { config, warnings, configPath };
}

function isDayRange(value) {
  return Boolean(
    value &&
      typeof value === 'object' &&
      typeof value.date === 'string' &&
      /^\d{4}-\d{2}-\d{2}$/.test(value.date) &&
      Number.isFinite(Number(value.high)) &&
      Number.isFinite(Number(value.low))
  );
}

function updateDayRange(prev, aqi, date) {
  if (aqi === null || aqi === undefined || aqi === '') {
    return isDayRange(prev) ? prev : null;
  }
  const value = Number(aqi);
  if (!Number.isFinite(value) || typeof date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return isDayRange(prev) ? prev : null;
  }
  if (!isDayRange(prev) || prev.date !== date) {
    return { date, high: Math.round(value), low: Math.round(value) };
  }
  return {
    date,
    high: Math.round(Math.max(Number(prev.high), value)),
    low: Math.round(Math.min(Number(prev.low), value))
  };
}

module.exports = { DEFAULTS, POSITIONS, OVERRIDE_KEYS, loadConfig, isDayRange, updateDayRange };
