import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  DEVICE_FEATURE_CATEGORIES as C,
  DEVICE_FEATURE_TYPES as T,
  DEVICE_FEATURE_UNITS as U,
} from '@gladysassistant/integration-sdk';
import { expandConfig } from '../src/discovery.js';
import {
  BUTTON_STATUS,
  COVER_STATE,
  LOCK_STATE,
  THERMOSTAT_MODE,
  THERMOSTAT_PRESET,
  hsToRgb,
  intToRgb,
  mapEntity,
  rgbToHs,
  rgbToInt,
  rgbToXy,
  sensorKind,
  xyToRgb,
} from '../src/mapping.js';
import {
  CLIMATE,
  COVER,
  DOORBELL,
  ESPHOME,
  REMOTE,
  SELECT,
  TASMOTA,
} from './fixtures/announcements.js';

const entity = (component, raw, name = 'Thing') => ({ component, config: expandConfig(raw), name });
const fromFixture = (component, message, name) =>
  entity(component, JSON.parse(message.payload), name);
const read = (mapped, topic, payload) =>
  mapped.readers.filter((r) => r.topic === topic).flatMap((r) => r.read(payload));

test('numeric sensors: class, unit, template, unavailable values', () => {
  const mapped = mapEntity(fromFixture('sensor', TASMOTA[1], 'Power'));
  assert.deepEqual(
    [mapped.features[0].category, mapped.features[0].type, mapped.features[0].unit],
    [C.ENERGY_SENSOR, T.ENERGY_SENSOR.POWER, U.WATT],
  );
  assert.deepEqual(read(mapped, 'tasmota_A4CF12/tele/SENSOR', '{"ENERGY":{"Power":42.5}}'), [
    { key: 'state', state: 42.5 },
  ]);
  assert.deepEqual(read(mapped, 'tasmota_A4CF12/tele/SENSOR', '{"Wifi":{"RSSI":80}}'), []);

  const temperature = mapEntity(fromFixture('sensor', ESPHOME[0]));
  assert.equal(temperature.features[0].category, C.TEMPERATURE_SENSOR);
  assert.equal(temperature.features[0].unit, U.CELSIUS);
  assert.deepEqual(read(temperature, 'salon/sensor/temperature/state', '21.4'), [
    { key: 'state', state: 21.4 },
  ]);
  assert.deepEqual(read(temperature, 'salon/sensor/temperature/state', 'unavailable'), []);
  assert.deepEqual(read(temperature, 'salon/sensor/temperature/state', 'nan'), []);
});

test('energy features: a plug reports switch features, a meter an index', () => {
  const total = { dev_cla: 'energy', unit_of_meas: 'kWh', stat_cla: 'total_increasing' };
  assert.deepEqual(
    [
      sensorKind(expandConfig(total), { hasSwitch: true }).category,
      sensorKind(expandConfig(total), { hasSwitch: true }).type,
    ],
    [C.SWITCH, T.SWITCH.ENERGY],
  );
  const meter = sensorKind(expandConfig(total), { hasSwitch: false });
  assert.deepEqual(
    [meter.category, meter.type, meter.unit],
    [C.ENERGY_SENSOR, T.ENERGY_SENSOR.INDEX, U.KILOWATT_HOUR],
  );
  // No class: the unit tells.
  assert.equal(sensorKind(expandConfig({ unit_of_meas: '°C' })).category, C.TEMPERATURE_SENSOR);
  // A diagnostic temperature stays out of the room average.
  assert.equal(
    sensorKind(expandConfig({ dev_cla: 'temperature', ent_cat: 'diagnostic' })).category,
    C.DEVICE_TEMPERATURE_SENSOR,
  );
  assert.equal(
    sensorKind(expandConfig({ dev_cla: 'battery', unit_of_meas: '%' })).type,
    T.BATTERY.INTEGER,
  );
  assert.equal(sensorKind(expandConfig({ unit_of_meas: 'dBm' })).category, C.UNKNOWN);
});

test('text sensors: no unit, no class, published as text', () => {
  const mapped = mapEntity(entity('sensor', { stat_t: 'x/state' }, 'Firmware'));
  assert.deepEqual([mapped.features[0].category, mapped.features[0].type], [C.TEXT, T.TEXT.TEXT]);
  assert.deepEqual(read(mapped, 'x/state', 'v1.2'), [{ key: 'state', text: 'v1.2' }]);
  const enumSensor = mapEntity(entity('sensor', { stat_t: 'x', dev_cla: 'enum', ops: ['a', 'b'] }));
  assert.equal(enumSensor.features[0].category, C.TEXT);
});

test('binary sensors: payloads, classes, off delay', () => {
  const doorbell = mapEntity(fromFixture('binary_sensor', DOORBELL));
  assert.equal(doorbell.features[0].category, C.MOTION_SENSOR);
  assert.deepEqual(read(doorbell, 'rf/received', '{"Data":"A1B2C3"}'), [
    { key: 'state', state: 1, offDelay: 5 },
  ]);
  assert.deepEqual(read(doorbell, 'rf/received', '{"Data":"FFFFFF"}'), []);
  const door = mapEntity(entity('binary_sensor', { stat_t: 'd', dev_cla: 'door' }));
  assert.equal(door.features[0].category, C.OPENING_SENSOR);
  assert.deepEqual(read(door, 'd', 'ON'), [{ key: 'state', state: 1, offDelay: undefined }]);
  assert.deepEqual(read(door, 'd', 'OFF'), [{ key: 'state', state: 0 }]);
  const plain = mapEntity(entity('binary_sensor', { stat_t: 'p' }));
  assert.deepEqual([plain.features[0].category, plain.features[0].type], [C.INPUT, T.INPUT.BINARY]);
});

test('switches: Tasmota state template, command payloads, optimistic without state', () => {
  const mapped = mapEntity(fromFixture('switch', TASMOTA[0], 'Prise'));
  assert.deepEqual(
    [mapped.features[0].category, mapped.features[0].read_only, mapped.features[0].has_feedback],
    [C.SWITCH, false, true],
  );
  assert.deepEqual(read(mapped, 'tasmota_A4CF12/tele/STATE', '{"POWER":"ON","Wifi":{}}'), [
    { key: 'state', state: 1 },
  ]);
  assert.deepEqual(mapped.writers.state(0), [
    { topic: 'tasmota_A4CF12/cmnd/POWER', payload: 'OFF', retain: false, qos: 0 },
  ]);
  const blind = mapEntity(
    entity('switch', { cmd_t: 'relay/set', pl_on: '1', pl_off: '0', ret: true, qos: 1 }),
  );
  assert.deepEqual(blind.optimistic, ['state']);
  assert.deepEqual(blind.writers.state(1), [
    { topic: 'relay/set', payload: '1', retain: true, qos: 1 },
  ]);
});

test('JSON lights (ESPHome): state, brightness, color, color temperature', () => {
  const mapped = mapEntity(fromFixture('light', ESPHOME[1], 'LED'));
  assert.deepEqual(
    mapped.features.map((f) => [f.key, f.type, f.min, f.max]),
    [
      ['state', T.LIGHT.BINARY, 0, 1],
      ['brightness', T.LIGHT.BRIGHTNESS, 0, 255],
      ['color_temp', T.LIGHT.TEMPERATURE, 153, 370],
      ['color', T.LIGHT.COLOR, 0, 16777215],
    ],
  );
  assert.deepEqual(
    read(
      mapped,
      'salon/light/led/state',
      '{"state":"ON","brightness":128,"color_mode":"rgb","color":{"r":255,"g":0,"b":0}}',
    ),
    [
      { key: 'state', state: 1 },
      { key: 'brightness', state: 128 },
      { key: 'color', state: 0xff0000 },
    ],
  );
  const send = (key, value) => JSON.parse(mapped.writers[key](value)[0].payload);
  assert.deepEqual(send('state', 0), { state: 'OFF' });
  assert.deepEqual(send('brightness', 200), { state: 'ON', brightness: 200 });
  assert.deepEqual(send('brightness', 0), { state: 'OFF' });
  assert.deepEqual(send('color', 0x00ff00), { state: 'ON', color: { r: 0, g: 255, b: 0 } });
  assert.deepEqual(send('color_temp', 250), { state: 'ON', color_temp: 250 });
});

test('default-schema lights: separate topics, on_command_type', () => {
  const raw = {
    cmd_t: 'l/set',
    stat_t: 'l/state',
    bri_cmd_t: 'l/bri/set',
    bri_stat_t: 'l/bri',
    bri_scl: 100,
    rgb_cmd_t: 'l/rgb/set',
    rgb_stat_t: 'l/rgb',
  };
  const mapped = mapEntity(entity('light', raw));
  assert.equal(mapped.features.find((f) => f.key === 'brightness').max, 100);
  assert.deepEqual(read(mapped, 'l/rgb', '0,0,255'), [{ key: 'color', state: 255 }]);
  // "last" (default): the value, then ON.
  assert.deepEqual(
    mapped.writers.brightness(40).map((m) => [m.topic, m.payload]),
    [
      ['l/bri/set', '40'],
      ['l/set', 'ON'],
    ],
  );
  assert.deepEqual(
    mapped.writers.color(0x102030).map((m) => [m.topic, m.payload]),
    [
      ['l/rgb/set', '16,32,48'],
      ['l/set', 'ON'],
    ],
  );
  const first = mapEntity(entity('light', { ...raw, on_cmd_type: 'brightness' }));
  assert.deepEqual(
    first.writers.brightness(40).map((m) => m.topic),
    ['l/bri/set'],
  );
  assert.deepEqual(
    first.writers.brightness(0).map((m) => [m.topic, m.payload]),
    [['l/set', 'OFF']],
  );
});

test('covers: state, position, commands', () => {
  const mapped = mapEntity(fromFixture('cover', COVER, 'Volet'));
  assert.deepEqual(
    mapped.features.map((f) => [f.key, f.category, f.type]),
    [
      ['state', C.SHUTTER, T.SHUTTER.STATE],
      ['position', C.SHUTTER, T.SHUTTER.POSITION],
    ],
  );
  assert.deepEqual(read(mapped, 'shutter/1/state', 'closing'), [
    { key: 'state', state: COVER_STATE.CLOSE },
  ]);
  assert.deepEqual(read(mapped, 'shutter/1/position', '42'), [{ key: 'position', state: 42 }]);
  assert.equal(mapped.writers.state(COVER_STATE.OPEN)[0].payload, 'OPEN');
  assert.equal(mapped.writers.state(COVER_STATE.STOP)[0].payload, 'STOP');
  assert.deepEqual(
    [mapped.writers.position(30)[0].topic, mapped.writers.position(30)[0].payload],
    ['shutter/1/position/set', '30'],
  );
  // Inverted position range (some motors count 0 = open).
  const inverted = mapEntity(
    entity('cover', { pos_t: 'p', set_pos_t: 'p/set', pos_open: 0, pos_clsd: 100 }),
  );
  assert.deepEqual(read(inverted, 'p', '0'), [{ key: 'position', state: 100 }]);
  assert.equal(inverted.writers.position(100)[0].payload, '0');
  const noStop = mapEntity(entity('cover', { cmd_t: 'c', pl_stop: null }));
  assert.throws(() => noStop.writers.state(COVER_STATE.STOP));
});

test('locks: command and detailed state', () => {
  const mapped = mapEntity(entity('lock', { cmd_t: 'lock/set', stat_t: 'lock/state' }));
  assert.deepEqual(read(mapped, 'lock/state', 'LOCKED'), [
    { key: 'lock_state', state: LOCK_STATE.LOCKED },
    { key: 'lock', state: 1 },
  ]);
  assert.deepEqual(read(mapped, 'lock/state', 'JAMMED'), [
    { key: 'lock_state', state: LOCK_STATE.ERROR },
  ]);
  assert.equal(mapped.writers.lock(0)[0].payload, 'UNLOCK');
});

test('climate: setpoint, current temperature, modes and presets the device supports', () => {
  const mapped = mapEntity(fromFixture('climate', CLIMATE, 'Thermostat'));
  const byKey = Object.fromEntries(mapped.features.map((f) => [f.key, f]));
  assert.deepEqual(Object.keys(byKey), [
    'current_temperature',
    'target_temperature',
    'mode',
    'preset',
  ]);
  assert.deepEqual(
    [byKey.target_temperature.min, byKey.target_temperature.max, byKey.target_temperature.step],
    [5, 30, 0.5],
  );
  assert.deepEqual(
    byKey.mode.supported_options.map((o) => o.value),
    [THERMOSTAT_MODE.OFF, THERMOSTAT_MODE.HEATING],
  );
  // "boost" has no Gladys preset: left out.
  assert.deepEqual(
    byKey.preset.supported_options.map((o) => o.value),
    [THERMOSTAT_PRESET.ECO, THERMOSTAT_PRESET.COMFORT],
  );
  assert.deepEqual(read(mapped, 'th1/mode', 'heat'), [
    { key: 'mode', state: THERMOSTAT_MODE.HEATING },
  ]);
  assert.deepEqual(read(mapped, 'th1/current', '19.5'), [
    { key: 'current_temperature', state: 19.5 },
  ]);
  assert.equal(mapped.writers.mode(THERMOSTAT_MODE.OFF)[0].payload, 'off');
  assert.throws(() => mapped.writers.mode(THERMOSTAT_MODE.COOLING), /not supported/);
  assert.equal(mapped.writers.target_temperature(20.5)[0].payload, '20.5');
  assert.equal(mapped.writers.preset(THERMOSTAT_PRESET.ECO)[0].payload, 'eco');
});

test('selects: the options of the device, free text refused', () => {
  const mapped = mapEntity(fromFixture('select', SELECT, 'Mode'));
  assert.deepEqual(
    mapped.features[0].supported_options.map((o) => o.value),
    ['eco', 'comfort', 'boost'],
  );
  assert.deepEqual(read(mapped, 'vmc/mode', 'boost'), [{ key: 'option', text: 'boost' }]);
  assert.deepEqual(read(mapped, 'vmc/mode', 'turbo'), []);
  assert.equal(mapped.writers.option('eco')[0].payload, 'eco');
  assert.throws(() => mapped.writers.option('turbo'));
});

test('device triggers: one button feature per subtype, matched on the payload', () => {
  const short = mapEntity(fromFixture('device_automation', REMOTE[0]));
  assert.deepEqual(
    short.features.map((f) => [f.key, f.category, f.type]),
    [['trigger_button_1', C.BUTTON, T.BUTTON.CLICK]],
  );
  const [trigger] = short.triggers;
  assert.equal(trigger.topic, 'remote1/action');
  assert.deepEqual(trigger.match('single'), {
    type: 'button_short_press',
    subtype: 'button_1',
    payload: 'single',
    featureKey: 'trigger_button_1',
    value: BUTTON_STATUS.CLICK,
  });
  assert.equal(trigger.match('hold'), null);
  const long = mapEntity(fromFixture('device_automation', REMOTE[1]));
  assert.equal(long.triggers[0].match('hold').value, BUTTON_STATUS.LONG_CLICK_PRESS);
});

test('event entities', () => {
  const mapped = mapEntity(
    entity('event', { stat_t: 'ev', evt_typ: ['press', 'double_press'] }, 'Bouton'),
  );
  assert.equal(
    mapped.triggers[0].match('{"event_type":"double_press"}').value,
    BUTTON_STATUS.DOUBLE_CLICK,
  );
  assert.equal(mapped.triggers[0].match('{"event_type":"other"}'), null);
});

test('unsupported components and broken templates are reported, not thrown', () => {
  assert.match(mapEntity(entity('vacuum', {})).error, /not supported/);
  assert.match(
    mapEntity(entity('sensor', { stat_t: 'x', val_tpl: '{{ value | ' })).error,
    /template/,
  );
});

test('color conversions', () => {
  assert.deepEqual(intToRgb(rgbToInt(12, 34, 56)), [12, 34, 56]);
  assert.deepEqual(hsToRgb(0, 100).map(Math.round), [255, 0, 0]);
  assert.deepEqual(rgbToHs(0, 0, 255), [240, 100]);
  const [x, y] = rgbToXy(255, 0, 0);
  const back = xyToRgb(x, y).map(Math.round);
  assert.ok(back[0] === 255 && back[1] < 40 && back[2] < 40, `red survives xy: ${back}`);
});
