import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  availabilityOf,
  expandConfig,
  parseDiscoveryMessage,
  parseDiscoveryTopic,
} from '../src/discovery.js';
import { DEVICE_BASED, TASMOTA } from './fixtures/announcements.js';

test('discovery topics, with and without node id, and the device form', () => {
  assert.deepEqual(
    parseDiscoveryTopic('homeassistant/sensor/salon/temperature/config', 'homeassistant'),
    {
      component: 'sensor',
      nodeId: 'salon',
      objectId: 'temperature',
      key: 'sensor/salon/temperature',
    },
  );
  assert.equal(
    parseDiscoveryTopic('homeassistant/switch/A4CF12_RL_1/config', 'homeassistant').key,
    'switch/A4CF12_RL_1',
  );
  assert.equal(
    parseDiscoveryTopic('homeassistant/device/heater01/config', 'homeassistant').component,
    'device',
  );
  assert.equal(parseDiscoveryTopic('custom/prefix/sensor/x/config', 'custom/prefix').objectId, 'x');
  // Not discovery configs.
  assert.equal(parseDiscoveryTopic('homeassistant/status', 'homeassistant'), null);
  assert.equal(parseDiscoveryTopic('homeassistant/sensor/x/state', 'homeassistant'), null);
  assert.equal(
    parseDiscoveryTopic('homeassistant/unknown_platform/x/config', 'homeassistant'),
    null,
  );
  assert.equal(parseDiscoveryTopic('homeassistant/sensor/a b/config', 'homeassistant'), null);
  assert.equal(parseDiscoveryTopic('other/sensor/x/config', 'homeassistant'), null);
});

test('abbreviations and the "~" base topic are expanded', () => {
  const config = expandConfig(JSON.parse(TASMOTA[0].payload));
  assert.equal(config.command_topic, 'tasmota_A4CF12/cmnd/POWER');
  assert.equal(config.state_topic, 'tasmota_A4CF12/tele/STATE');
  assert.equal(config.availability_topic, 'tasmota_A4CF12/tele/LWT');
  assert.equal(config.value_template, '{{value_json.POWER}}');
  assert.equal(config.unique_id, 'A4CF12_RL_1');
  assert.deepEqual(config.device.identifiers, ['A4CF12']);
  assert.equal(config.device.model, 'Sonoff Pow R2');
  assert.equal(config.name, null);
  // A "~" at the end appends the base, and the availability list is expanded too.
  const list = expandConfig({
    '~': 'base',
    stat_t: 'state/~',
    avty: [{ t: '~/lwt', pl_avail: 'up' }],
  });
  assert.equal(list.state_topic, 'state/base');
  assert.deepEqual(list.availability, [{ topic: 'base/lwt', payload_available: 'up' }]);
});

test('availability: single topic or list, with the HA defaults', () => {
  assert.deepEqual(availabilityOf(expandConfig(JSON.parse(TASMOTA[0].payload))).entries, [
    {
      topic: 'tasmota_A4CF12/tele/LWT',
      payload_available: 'Online',
      payload_not_available: 'Offline',
      value_template: undefined,
    },
  ]);
  const listed = availabilityOf({
    availability: [{ topic: 'a' }, { topic: 'b' }],
    availability_mode: 'all',
  });
  assert.equal(listed.mode, 'all');
  assert.deepEqual(
    listed.entries.map((e) => [e.topic, e.payload_available]),
    [
      ['a', 'online'],
      ['b', 'online'],
    ],
  );
});

test('an entity config, an empty payload, a broken one', () => {
  const info = parseDiscoveryTopic(TASMOTA[1].topic, 'homeassistant');
  const parsed = parseDiscoveryMessage(info, Buffer.from(TASMOTA[1].payload));
  assert.equal(parsed.entities.length, 1);
  assert.equal(parsed.entities[0].config.device_class, 'power');
  assert.deepEqual(parseDiscoveryMessage(info, ''), {
    removed: ['sensor/A4CF12_ENERGY_Power'],
    entities: [],
    removesChildren: false,
  });
  assert.match(parseDiscoveryMessage(info, '{not json').error, /JSON/);
  assert.match(parseDiscoveryMessage(info, '[1,2]').error, /JSON/);
});

test('device-based discovery: shared options, components, removals', () => {
  const info = parseDiscoveryTopic(DEVICE_BASED[0].topic, 'homeassistant');
  const parsed = parseDiscoveryMessage(info, DEVICE_BASED[0].payload);
  assert.equal(parsed.replacesChildren, true);
  assert.deepEqual(
    parsed.entities.map((e) => [
      e.key,
      e.component,
      e.config.state_topic,
      e.config.device.name,
      e.config.origin.name,
    ]),
    [
      ['device/heater01/flow', 'sensor', 'ebusd/heater/state', 'Chaudière', 'ebusd'],
      ['device/heater01/pump', 'binary_sensor', 'ebusd/heater/state', 'Chaudière', 'ebusd'],
    ],
  );
  assert.equal(parsed.entities[0].config.platform, undefined, 'the platform key is consumed');
  // A component reduced to its platform is removed.
  const removal = parseDiscoveryMessage(
    info,
    JSON.stringify({ dev: { ids: 'heater01' }, cmps: { pump: { p: 'binary_sensor' } } }),
  );
  assert.deepEqual(removal.removed, ['device/heater01/pump']);
  assert.equal(parseDiscoveryMessage(info, '').removesChildren, true);
  assert.match(parseDiscoveryMessage(info, '{"dev":{}}').error, /components/);
});
