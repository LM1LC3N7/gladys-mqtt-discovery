import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeConfig, normalizePrefix, parseBrokerUrl } from '../src/config.js';

test('broker addresses', () => {
  assert.deepEqual(parseBrokerUrl('192.168.1.10'), { url: 'mqtt://192.168.1.10' });
  assert.deepEqual(parseBrokerUrl(' mqtt://broker.lan:1884 '), { url: 'mqtt://broker.lan:1884' });
  assert.deepEqual(parseBrokerUrl('mqtts://broker.lan:8883'), { url: 'mqtts://broker.lan:8883' });
  assert.deepEqual(parseBrokerUrl('ws://broker.lan:9001/mqtt'), {
    url: 'ws://broker.lan:9001/mqtt',
  });
  assert.deepEqual(parseBrokerUrl(''), { error: 'empty' });
  assert.deepEqual(parseBrokerUrl('http://broker.lan'), { error: 'invalid' });
  assert.deepEqual(parseBrokerUrl('mqtt://user:pass@broker.lan'), { error: 'credentials' });
});

test('discovery prefix', () => {
  assert.equal(normalizePrefix(' /custom/ha/ '), 'custom/ha');
  assert.equal(normalizePrefix(''), 'homeassistant');
  assert.equal(normalizePrefix('home/#'), 'homeassistant');
});

test('defaults and bounds', () => {
  const config = normalizeConfig({ broker_url: 'host', sensor_interval: 9999, password: null });
  assert.equal(config.brokerUrl, 'mqtt://host');
  assert.equal(config.prefix, 'homeassistant');
  assert.equal(config.sensorInterval, 300);
  assert.equal(config.verifyCertificate, true);
  assert.equal(config.ignoreZigbee2mqtt, true);
  assert.equal(config.password, '');
  assert.equal(normalizeConfig({ sensor_interval: 'x' }).sensorInterval, 10);
});
