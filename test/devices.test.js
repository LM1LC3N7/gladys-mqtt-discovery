import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  DEVICE_FEATURE_CATEGORIES as C,
  DEVICE_FEATURE_TYPES as T,
} from '@gladysassistant/integration-sdk';
import { createFakeGladys } from '@gladysassistant/integration-sdk/testing';
import { buildModel, deviceAvailable, routesFor, safeId, topicMatches } from '../src/devices.js';
import {
  ALL,
  DEVICE_BASED,
  ESPHOME,
  OPENMQTTGATEWAY,
  REMOTE,
  TASMOTA,
  ZIGBEE2MQTT,
} from './fixtures/announcements.js';
import { entitiesOf } from './helpers/entities.js';

const gladys = createFakeGladys();

test('one Gladys device per HA device, named after it, with stable ids', () => {
  const model = buildModel(gladys, entitiesOf(TASMOTA));
  assert.equal(model.devices.length, 1);
  const [plug] = model.devices;
  assert.equal(plug.name, 'Prise salon');
  assert.equal(plug.external_id, 'ext:test-integration:mqtt:A4CF12');
  assert.deepEqual(
    plug.features.map((f) => [
      f.external_id.split(':').slice(4).join(':'),
      f.name,
      f.category,
      f.type,
    ]),
    [
      ['A4CF12_ENERGY_Power:state', 'ENERGY Power', C.SWITCH, T.SWITCH.POWER],
      ['A4CF12_ENERGY_Total:state', 'ENERGY Total', C.SWITCH, T.SWITCH.ENERGY],
      // name: null -> the main entity carries the device name
      ['A4CF12_RL_1:state', 'Prise salon', C.SWITCH, T.SWITCH.BINARY],
    ],
  );
  assert.deepEqual(plug.params, [
    { name: 'MANUFACTURER', value: 'Tasmota' },
    { name: 'MODEL', value: 'Sonoff Pow R2' },
    { name: 'SW_VERSION', value: '14.2.0' },
  ]);
  assert.equal(plug.should_poll, false);
  // Built twice, same ids: they are what Gladys keys the history on.
  assert.deepEqual(buildModel(gladys, entitiesOf(TASMOTA)).devices, model.devices);
});

test('routes: every state topic, shared topics, availability, writers, throttling', () => {
  const model = buildModel(gladys, entitiesOf(TASMOTA));
  assert.deepEqual([...model.routes.keys()].sort(), [
    'tasmota_A4CF12/tele/SENSOR',
    'tasmota_A4CF12/tele/STATE',
  ]);
  assert.equal(model.routes.get('tasmota_A4CF12/tele/SENSOR').length, 2);
  const states = model.routes
    .get('tasmota_A4CF12/tele/SENSOR')
    .flatMap((r) => r.read('{"ENERGY":{"Power":12,"Total":3.5}}'));
  assert.deepEqual(
    states.map((s) => [s.featureId.split(':').pop(), s.state]),
    [
      ['state', 12],
      ['state', 3.5],
    ],
  );
  assert.ok(model.availabilityRoutes.has('tasmota_A4CF12/tele/LWT'));
  assert.ok(model.writers.has('ext:test-integration:mqtt:A4CF12:A4CF12_RL_1:state'));
  assert.ok(model.throttled.has('ext:test-integration:mqtt:A4CF12:A4CF12_ENERGY_Power:state'));
  assert.ok(!model.throttled.has('ext:test-integration:mqtt:A4CF12:A4CF12_RL_1:state'));
});

test('skipped: Zigbee2MQTT devices (option) and entities disabled by default', () => {
  const model = buildModel(gladys, entitiesOf([...ESPHOME, ZIGBEE2MQTT]));
  assert.deepEqual(
    model.devices.map((d) => d.name),
    ['salon'],
  );
  assert.deepEqual(model.skipped.map((s) => s.reason).sort(), [
    'Zigbee2MQTT device',
    'disabled by default',
  ]);
  const kept = buildModel(gladys, entitiesOf([ZIGBEE2MQTT]), { ignoreZigbee2mqtt: false });
  assert.equal(kept.devices.length, 1);
});

test('device triggers of a remote share one feature per button', () => {
  const model = buildModel(gladys, entitiesOf(REMOTE));
  assert.equal(model.devices.length, 1);
  assert.deepEqual(
    model.devices[0].features.map((f) => f.external_id),
    ['ext:test-integration:mqtt:remote1:trigger_button_1'],
  );
  assert.equal(model.triggerRoutes.get('remote1/action').length, 2);
});

test('device-based discovery and wildcard state topics', () => {
  const boiler = buildModel(gladys, entitiesOf(DEVICE_BASED)).devices[0];
  assert.equal(boiler.name, 'Chaudière');
  assert.deepEqual(
    boiler.params.find((p) => p.name === 'ORIGIN'),
    { name: 'ORIGIN', value: 'ebusd' },
  );
  const omg = buildModel(gladys, entitiesOf(OPENMQTTGATEWAY));
  const routes = routesFor(omg.routes, 'home/OMG_ESP32/BTtoMQTT/A4C138AABBCC');
  assert.equal(routes.length, 2);
  const states = routes.flatMap((r) => r.read('{"id":"A4:C1:38:AA:BB:CC","tempc":21.3}'));
  assert.deepEqual(
    states.map((s) => s.state),
    [21.3],
    'the humidity entity skips this message',
  );
});

test('the whole fixture set builds without errors', () => {
  const model = buildModel(gladys, entitiesOf(ALL));
  assert.deepEqual(model.errors, []);
  // Sorted for humans (case-insensitive), like the Discovery tab lists them.
  assert.deepEqual(
    model.devices.map((d) => d.name),
    [
      'Chaudière',
      'LYWSD03MMC-AABBCC',
      'Mode VMC',
      'Prise salon',
      'salon',
      'Sonnette',
      'Télécommande',
      'Thermostat',
      'Volet salon',
    ],
  );
  for (const device of model.devices) {
    for (const f of device.features) {
      assert.ok(Number.isFinite(f.min) && Number.isFinite(f.max), `${f.external_id}: min/max`);
      assert.ok(f.external_id.startsWith(`${device.external_id}:`));
    }
  }
});

test('safe ids and topic patterns', () => {
  assert.equal(safeId('A4CF12_RL_1'), 'A4CF12_RL_1');
  const mac = safeId('mac:aa:bb');
  assert.match(mac, /^mac_aa_bb_[0-9a-f]{8}$/);
  assert.notEqual(safeId('a:b'), safeId('a_b'), 'a cleaned id never collides with a raw one');
  assert.ok(safeId('x'.repeat(200)).length <= 64);
  assert.ok(topicMatches('+/+/BTtoMQTT/AA', 'home/gw/BTtoMQTT/AA'));
  assert.ok(topicMatches('a/#', 'a'));
  assert.ok(topicMatches('a/#', 'a/b/c'));
  assert.ok(!topicMatches('a/+', 'a/b/c'));
  assert.ok(!topicMatches('a/b', 'a/c'));
});

test('availability: latest message wins, a device is up when one entity is', () => {
  const checks = [{ entityKey: 'e1', mode: 'latest', entries: [{ topic: 'a' }, { topic: 'b' }] }];
  assert.equal(deviceAvailable(checks, new Map()), true, 'unknown: considered available');
  const seen = new Map([
    ['e1|a', { value: true, at: 1 }],
    ['e1|b', { value: false, at: 2 }],
  ]);
  assert.equal(deviceAvailable(checks, seen), false);
  assert.equal(deviceAvailable([{ ...checks[0], mode: 'any' }], seen), true);
  assert.equal(deviceAvailable([{ ...checks[0], mode: 'all' }], seen), false);
});
