// -----------------------------------------------------------------------------
// End to end: the real SDK wiring (src/handlers.js) against the SDK's fake
// Gladys, and a fake broker. Timers are mocked: the rebuild debounce and the
// state flush run when the test ticks.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DEVICE_TRANSPORTS } from '@gladysassistant/integration-sdk';
import { createFakeGladys } from '@gladysassistant/integration-sdk/testing';
import { MqttDiscoveryApp } from '../src/app.js';
import { ACTIONS, SCENE_TRIGGERS, TIMINGS } from '../src/constants.js';
import { registerHandlers } from '../src/handlers.js';
import { ALL, DOORBELL, REMOTE, TASMOTA } from './fixtures/announcements.js';
import { fakeConnector, settle } from './helpers/fakeMqtt.js';

const PLUG = 'ext:test-integration:mqtt:A4CF12';
const POWER = `${PLUG}:A4CF12_ENERGY_Power:state`;
const RELAY = `${PLUG}:A4CF12_RL_1:state`;

async function setup(t, config = { broker_url: '192.168.1.10' }) {
  t.mock.timers.enable({ apis: ['setTimeout', 'setInterval', 'Date'], now: 1_760_000_000_000 });
  const gladys = createFakeGladys({ config });
  const broker = fakeConnector();
  const app = new MqttDiscoveryApp({ gladys, connect: broker.connect, now: () => Date.now() });
  registerHandlers(gladys, app);
  await gladys.connect();
  t.after(() => app.stop());
  const tick = async (ms) => {
    t.mock.timers.tick(ms);
    await settle();
  };
  return { gladys, app, broker, tick };
}

/** Connects the broker and announces the fixtures, then lets the rebuild run. */
async function announce(ctx, messages = ALL) {
  const client = ctx.broker.clients[0];
  client.open();
  await settle();
  for (const m of messages) {
    client.deliver(m.topic, m.payload);
  }
  await ctx.tick(TIMINGS.rebuildDebounce);
  return client;
}

const deviceNamed = (gladys, name) => gladys.fake.discoveredDevices.find((d) => d.name === name);

test('announcements become Gladys devices, states flow once the device is created', async (t) => {
  const ctx = await setup(t);
  const { gladys } = ctx;
  const client = ctx.broker.clients[0];
  assert.equal(client.config.brokerUrl, 'mqtt://192.168.1.10');
  await announce(ctx);
  assert.ok(client.subscriptions.has('homeassistant/+/+/config'));
  assert.ok(client.subscriptions.has('homeassistant/+/+/+/config'));
  assert.ok(client.subscriptions.has('tasmota_A4CF12/tele/SENSOR'));
  assert.ok(
    client.subscriptions.has('+/+/BTtoMQTT/A4C138AABBCC'),
    'wildcard topics are subscribed as is',
  );
  assert.equal(gladys.fake.discoveredDevices.length, 9);
  assert.equal(gladys.fake.connectionStatus.connected, true);
  assert.match(gladys.fake.connectionStatus.message.en, /9 devices announced/);

  // Before the device exists in Gladys, nothing is sent; its last values are kept.
  client.deliver('tasmota_A4CF12/tele/SENSOR', '{"ENERGY":{"Power":42,"Total":1.5}}');
  await ctx.tick(TIMINGS.flushInterval);
  assert.equal(gladys.fake.states.length, 0);

  await gladys.fake.deviceCreated(deviceNamed(gladys, 'Prise salon'));
  await ctx.tick(TIMINGS.flushInterval);
  assert.equal(gladys.fake.lastState(POWER), 42, 'the value read before the creation is sent');

  client.deliver('tasmota_A4CF12/tele/STATE', '{"POWER":"ON"}');
  client.deliver('tasmota_A4CF12/tele/SENSOR', '{"ENERGY":{"Power":43,"Total":1.5}}');
  await ctx.tick(TIMINGS.flushInterval);
  assert.equal(gladys.fake.lastState(RELAY), 1, 'events are never throttled');
  assert.equal(gladys.fake.lastState(POWER), 42, 'a measurement waits for the sensor interval');
  await ctx.tick(10_000);
  assert.equal(gladys.fake.lastState(POWER), 43);
});

test('commands are published on the command topic', async (t) => {
  const ctx = await setup(t);
  const { gladys } = ctx;
  const client = await announce(ctx, TASMOTA);
  const plug = deviceNamed(gladys, 'Prise salon');
  await gladys.fake.deviceCreated(plug);
  const relay = plug.features.find((f) => f.external_id === RELAY);
  const ack = await gladys.fake.setValue(plug, relay, 0);
  assert.equal(ack.success, true);
  assert.deepEqual(client.published.at(-1), {
    topic: 'tasmota_A4CF12/cmnd/POWER',
    payload: 'OFF',
    qos: 0,
    retain: false,
  });
  const power = plug.features.find((f) => f.external_id === POWER);
  const refused = await gladys.fake.setValue(plug, power, 1);
  assert.equal(refused.success, false, 'a sensor cannot be controlled');
  client.close();
  const offline = await gladys.fake.setValue(plug, relay, 1);
  assert.equal(offline.success, false);
  assert.match(offline.error, /not connected/);
});

test('availability drives the transport badge of the created devices', async (t) => {
  const ctx = await setup(t);
  const { gladys } = ctx;
  const client = await announce(ctx, TASMOTA);
  await gladys.fake.deviceCreated(deviceNamed(gladys, 'Prise salon'));
  const badge = (transport) => ({ device_external_id: PLUG, transport });
  client.deliver('tasmota_A4CF12/tele/LWT', 'Offline');
  await settle();
  assert.deepEqual(gladys.fake.transports.at(-1), badge(DEVICE_TRANSPORTS.UNREACHABLE));
  client.deliver('tasmota_A4CF12/tele/LWT', 'Online');
  await settle();
  assert.deepEqual(gladys.fake.transports.at(-1), badge(DEVICE_TRANSPORTS.LOCAL));
  const count = gladys.fake.transports.length;
  client.deliver('tasmota_A4CF12/tele/LWT', 'Online');
  await settle();
  assert.equal(gladys.fake.transports.length, count, 'an unchanged badge is not sent again');
  client.close();
  await settle();
  assert.deepEqual(gladys.fake.transports.at(-1), badge(DEVICE_TRANSPORTS.UNREACHABLE));
});

test('device triggers fire the scene trigger, and the button feature of a created remote', async (t) => {
  const ctx = await setup(t);
  const { gladys } = ctx;
  const client = await announce(ctx, REMOTE);
  const remote = deviceNamed(gladys, 'Télécommande');
  client.deliver('remote1/action', 'single');
  await settle();
  assert.deepEqual(gladys.fake.sceneEvents.at(-1), {
    key: SCENE_TRIGGERS.DEVICE_TRIGGER,
    data: {
      device: remote.external_id,
      type: 'button_short_press',
      subtype: 'button_1',
      payload: 'single',
    },
  });
  await gladys.fake.deviceCreated(remote);
  client.deliver('remote1/action', 'hold');
  await ctx.tick(TIMINGS.flushInterval);
  assert.equal(gladys.fake.lastState(remote.features[0].external_id), 3, 'long press');
  client.deliver('remote1/action', 'nothing we know');
  await settle();
  assert.equal(gladys.fake.sceneEvents.length, 2);

  // Two presses in a row are two states, even in the same flush window.
  const button = remote.features[0].external_id;
  const before = gladys.fake.states.filter((s) => s.device_feature_external_id === button).length;
  client.deliver('remote1/action', 'single');
  client.deliver('remote1/action', 'single');
  await ctx.tick(TIMINGS.flushInterval);
  const presses = gladys.fake.states.filter((s) => s.device_feature_external_id === button);
  assert.equal(presses.length - before, 2);
  assert.deepEqual(
    presses.slice(-2).map((s) => s.state),
    [1, 1],
  );
});

test('off_delay turns a binary sensor back off', async (t) => {
  const ctx = await setup(t);
  const { gladys } = ctx;
  const client = await announce(ctx, [DOORBELL]);
  const doorbell = deviceNamed(gladys, 'Sonnette');
  await gladys.fake.deviceCreated(doorbell);
  client.deliver('rf/received', '{"Data":"A1B2C3"}');
  await ctx.tick(TIMINGS.flushInterval);
  assert.equal(gladys.fake.lastState(doorbell.features[0].external_id), 1);
  await ctx.tick(4000);
  assert.equal(gladys.fake.lastState(doorbell.features[0].external_id), 1);
  // The off delay ends, then the next flush sends the 0.
  await ctx.tick(1000);
  await ctx.tick(TIMINGS.flushInterval);
  assert.equal(gladys.fake.lastState(doorbell.features[0].external_id), 0);
});

test('an empty retained config removes the device', async (t) => {
  const ctx = await setup(t);
  const { gladys } = ctx;
  const client = await announce(ctx, TASMOTA);
  assert.equal(gladys.fake.discoveredDevices.length, 1);
  for (const m of TASMOTA) {
    client.deliver(m.topic, '');
  }
  await ctx.tick(TIMINGS.rebuildDebounce);
  assert.equal(gladys.fake.discoveredDevices.length, 0);
  assert.ok(!client.subscriptions.has('tasmota_A4CF12/tele/SENSOR'), 'its topics are unsubscribed');
  assert.match(gladys.fake.connectionStatus.message.en, /nothing is announced/);
});

test('no broker address: the status says what to type, nothing connects', async (t) => {
  const { gladys, broker } = await setup(t, {});
  assert.equal(broker.clients.length, 0);
  assert.equal(gladys.fake.connectionStatus.connected, false);
  assert.match(gladys.fake.connectionStatus.message.fr, /adresse de votre broker/);
});

test('credentials in the broker address are refused', async (t) => {
  const { gladys, broker } = await setup(t, { broker_url: 'mqtt://user:secret@host' });
  assert.equal(broker.clients.length, 0);
  assert.match(gladys.fake.connectionStatus.message.en, /own fields/);
});

test('a refused connection says so', async (t) => {
  const { gladys, broker } = await setup(t, {
    broker_url: 'host',
    username: 'u',
    password: 'wrong',
  });
  const err = Object.assign(new Error('Connection refused: Bad username or password'), { code: 4 });
  broker.clients[0].emit('error', err);
  await settle();
  assert.equal(gladys.fake.connectionStatus.connected, false);
  assert.match(
    gladys.fake.connectionStatus.message.en,
    /refused the connection: bad user name or password/,
  );
  assert.equal(broker.clients[0].config.password, 'wrong');
});

test('"Test the connection" reads the retained configs with a separate client', async (t) => {
  const ctx = await setup(t);
  await announce(ctx, []);
  const pending = ctx.gladys.fake.action(ACTIONS.TEST);
  await settle();
  const probe = ctx.broker.clients.at(-1);
  assert.notEqual(probe, ctx.broker.clients[0]);
  probe.open();
  for (const m of [...TASMOTA, ...REMOTE]) {
    probe.deliver(m.topic, m.payload);
  }
  await ctx.tick(TIMINGS.testListen);
  const ack = await pending;
  assert.equal(ack.success, true);
  assert.match(
    ack.data.message.en,
    /Connection OK\. 5 discovery configs received, 2 devices \(2 sensor, 2 device_automation, 1 switch\)/,
  );
  assert.equal(probe.ended, true);
});

test('"Ask the devices to announce themselves" publishes the birth message', async (t) => {
  const ctx = await setup(t);
  const notYet = await ctx.gladys.fake.action(ACTIONS.ANNOUNCE);
  assert.match(notYet.data.message.en, /Not connected/);
  const client = await announce(ctx, []);
  const ack = await ctx.gladys.fake.action(ACTIONS.ANNOUNCE);
  assert.match(ack.data.message.en, /homeassistant\/status/);
  assert.deepEqual(client.published.at(-1), {
    topic: 'homeassistant/status',
    payload: 'online',
    qos: 0,
    retain: false,
  });
});

test('a new configuration reconnects with a fresh client', async (t) => {
  const ctx = await setup(t);
  await announce(ctx, TASMOTA);
  await ctx.gladys.fake.configUpdated({
    broker_url: 'mqtts://broker.lan:8883',
    verify_certificate: false,
  });
  assert.equal(ctx.broker.clients[0].ended, true);
  const second = ctx.broker.clients[1];
  assert.equal(second.config.brokerUrl, 'mqtts://broker.lan:8883');
  assert.equal(second.config.verifyCertificate, false);
});
