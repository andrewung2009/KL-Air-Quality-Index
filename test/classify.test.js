'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { classify } = require('../fetcher');

test('US AQI breakpoint boundaries map to the right category', () => {
  assert.equal(classify(0).label, 'Good');
  assert.equal(classify(50).label, 'Good');
  assert.equal(classify(51).label, 'Moderate');
  assert.equal(classify(100).label, 'Moderate');
  assert.equal(classify(101).label, 'Unhealthy for Sensitive Groups');
  assert.equal(classify(150).label, 'Unhealthy for Sensitive Groups');
  assert.equal(classify(151).label, 'Unhealthy');
  assert.equal(classify(200).label, 'Unhealthy');
  assert.equal(classify(201).label, 'Very Unhealthy');
  assert.equal(classify(300).label, 'Very Unhealthy');
  assert.equal(classify(301).label, 'Hazardous');
  assert.equal(classify(500).label, 'Hazardous');
});

test('short labels and colours match the EPA palette', () => {
  assert.equal(classify(20).short, 'Good');
  assert.equal(classify(20).color, '#00e400');
  assert.equal(classify(75).short, 'Moderate');
  assert.equal(classify(75).color, '#ffee00');
  assert.equal(classify(120).short, 'Sensitive');
  assert.equal(classify(120).color, '#ff7e00');
  assert.equal(classify(180).short, 'Unhealthy');
  assert.equal(classify(180).color, '#ff0000');
  assert.equal(classify(250).short, 'V. Unhealthy');
  assert.equal(classify(250).color, '#8f3f97');
  assert.equal(classify(400).short, 'Hazardous');
  assert.equal(classify(400).color, '#7e0023');
});

test('text colour keeps contrast on every category', () => {
  for (const aqi of [10, 75, 120, 180, 250, 400]) {
    const cat = classify(aqi);
    assert.ok(cat.text === '#0b0b0b' || cat.text === '#ffffff', cat.label + ' has a text colour');
  }
  assert.equal(classify(10).text, '#0b0b0b');
  assert.equal(classify(180).text, '#ffffff');
});
