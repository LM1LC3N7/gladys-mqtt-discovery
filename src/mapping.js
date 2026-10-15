// -----------------------------------------------------------------------------
// One Home Assistant MQTT entity -> Gladys features, readers and writers (pure).
//
// For each supported component, `mapEntity` returns:
//   features  the Gladys features (key relative to the device),
//   readers   { topic, read(payload) -> [{ key, state } | { key, text }] },
//   writers   { [featureKey]: (value) -> [{ topic, payload, retain, qos }] },
//   triggers  { topic, match(payload) -> { type, subtype, payload } | null }
//             for device triggers and event entities (scene triggers).
// A reader returns an empty list when the message is not for this entity
// (a template skipped it, an unknown payload): nothing is published then.
// The categories and value conventions follow the Gladys core (the same
// mappings as its Zigbee2MQTT service, see server/utils/constants.js).
// -----------------------------------------------------------------------------

import {
  DEVICE_FEATURE_CATEGORIES as C,
  DEVICE_FEATURE_TYPES as T,
  DEVICE_FEATURE_UNITS as U,
} from '@gladysassistant/integration-sdk';
import { TemplateError, checkTemplate, payloadVars, render } from './template.js';

// Value enums of the Gladys core (server/utils/constants.js).
export const COVER_STATE = { STOP: 0, OPEN: 1, CLOSE: -1 };
export const LOCK_STATE = { UNLOCKED: 0, LOCKED: 1, ACTIVITY: 2, ERROR: 3 };
export const THERMOSTAT_MODE = { OFF: 0, HEATING: 1, COOLING: 2, AUTO: 3 };
export const THERMOSTAT_OPERATING_STATE = { IDLE: 0, HEATING: 1, COOLING: 2 };
export const THERMOSTAT_PRESET = { SCHEDULE: 0, FROST: 1, AWAY: 2, ECO: 3, NIGHT: 4, COMFORT: 5 };
export const BUTTON_STATUS = {
  CLICK: 1,
  DOUBLE_CLICK: 2,
  LONG_CLICK_PRESS: 3,
  LONG_CLICK_RELEASE: 4,
  LONG_CLICK: 6,
  ON: 7,
  OFF: 8,
  TRIPLE: 18,
  QUADRUPLE: 19,
  RELEASE: 20,
  SHAKE: 22,
  INITIAL_PRESS: 47,
  LONG_PRESS: 48,
  SHORT_RELEASE: 49,
  LONG_RELEASE: 50,
  DOUBLE_PRESS: 51,
};

/** The components this integration turns into Gladys features. */
export const SUPPORTED_COMPONENTS = [
  'binary_sensor',
  'button',
  'climate',
  'cover',
  'device_automation',
  'event',
  'fan',
  'light',
  'lock',
  'number',
  'scene',
  'select',
  'sensor',
  'siren',
  'switch',
  'text',
];

const UNAVAILABLE = new Set(['', 'unknown', 'unavailable', 'none', 'null', 'nan']);
const MAX_TEXT = 1000;

// --- Units and sensor classes --------------------------------------------------

const UNITS = {
  '°C': U.CELSIUS,
  '°F': U.FAHRENHEIT,
  K: U.KELVIN,
  '%': U.PERCENT,
  Pa: U.PASCAL,
  hPa: U.HECTO_PASCAL,
  kPa: U.KILO_PASCAL,
  bar: U.BAR,
  mbar: U.MILLIBAR,
  psi: U.PSI,
  lx: U.LUX,
  ppm: U.PPM,
  ppb: U.PPB,
  W: U.WATT,
  kW: U.KILOWATT,
  Wh: U.WATT_HOUR,
  kWh: U.KILOWATT_HOUR,
  MWh: U.MEGAWATT_HOUR,
  A: U.AMPERE,
  mA: U.MILLI_AMPERE,
  V: U.VOLT,
  mV: U.MILLI_VOLT,
  VA: U.VOLT_AMPERE,
  kVA: U.KILOVOLT_AMPERE,
  var: U.VOLT_AMPERE_REACTIVE,
  mm: U.MM,
  cm: U.CM,
  m: U.M,
  km: U.KM,
  in: U.INCH,
  ft: U.FEET,
  mi: U.MILE,
  '°': U.DEGREE,
  L: U.LITER,
  mL: U.MILLILITER,
  'm³': U.CUBIC_METER,
  'm³/h': U.CUBIC_METER_PER_HOUR,
  '€': U.EURO,
  EUR: U.EURO,
  $: U.DOLLAR,
  USD: U.DOLLAR,
  '£': U.POUND_STERLING,
  GBP: U.POUND_STERLING,
  'm/s': U.METER_PER_SECOND,
  'km/h': U.KILOMETER_PER_HOUR,
  mph: U.MILE_PER_HOUR,
  'ft/s': U.FEET_PER_SECOND,
  'mm/h': U.MILLIMETER_PER_HOUR,
  'mm/d': U.MILLIMETER_PER_DAY,
  'UV index': U.UV_INDEX,
  μs: U.MICROSECONDS,
  ms: U.MILLISECONDS,
  s: U.SECONDS,
  min: U.MINUTES,
  h: U.HOURS,
  d: U.DAYS,
  w: U.WEEKS,
  bit: U.BIT,
  kbit: U.KILOBIT,
  Mbit: U.MEGABIT,
  Gbit: U.GIGABIT,
  B: U.BYTE,
  kB: U.KILOBYTE,
  KB: U.KILOBYTE,
  MB: U.MEGABYTE,
  GB: U.GIGABYTE,
  TB: U.TERABYTE,
  'bit/s': U.BITS_PER_SECOND,
  'kbit/s': U.KILOBITS_PER_SECOND,
  'Mbit/s': U.MEGABITS_PER_SECOND,
  'Gbit/s': U.GIGABITS_PER_SECOND,
  'B/s': U.BYTES_PER_SECOND,
  'kB/s': U.KILOBYTES_PER_SECOND,
  'MB/s': U.MEGABYTES_PER_SECOND,
  'GB/s': U.GIGABYTES_PER_SECOND,
  'µg/m³': U.MICROGRAM_PER_CUBIC_METER,
  'μg/m³': U.MICROGRAM_PER_CUBIC_METER,
  'mg/m³': U.MILLIGRAM_PER_CUBIC_METER,
  'Bq/m³': U.BECQUEREL_PER_CUBIC_METER,
  dB: U.DECIBEL,
  dBA: U.DECIBEL,
  AQI: U.AQI,
  'gCO2eq/kWh': U.GRAM_CO2_EQ_PER_KILOWATT_HOUR,
};

export const unitOf = (unit) => (typeof unit === 'string' ? UNITS[unit.trim()] : undefined);

const decimal = (category, extra = {}) => ({ category, type: T.SENSOR.DECIMAL, ...extra });

/** HA sensor device_class -> Gladys category/type (unit from the payload). */
const SENSOR_CLASSES = {
  temperature: decimal(C.TEMPERATURE_SENSOR, { min: -100, max: 150 }),
  humidity: decimal(C.HUMIDITY_SENSOR, { min: 0, max: 100 }),
  moisture: decimal(C.SOIL_MOISTURE_SENSOR, { min: 0, max: 100 }),
  pressure: decimal(C.PRESSURE_SENSOR, { min: 0, max: 10_000 }),
  atmospheric_pressure: decimal(C.PRESSURE_SENSOR, { min: 0, max: 10_000 }),
  illuminance: decimal(C.LIGHT_SENSOR, { min: 0, max: 200_000 }),
  battery: { category: C.BATTERY, type: T.BATTERY.INTEGER, min: 0, max: 100, integer: true },
  carbon_dioxide: decimal(C.CO2_SENSOR, { min: 0, max: 100_000 }),
  carbon_monoxide: decimal(C.CO_SENSOR, { min: 0, max: 100_000 }),
  pm25: decimal(C.PM25_SENSOR, { min: 0, max: 10_000 }),
  pm10: decimal(C.PM10_SENSOR, { min: 0, max: 10_000 }),
  volatile_organic_compounds: {
    category: C.VOC_SENSOR,
    type: T.VOC_SENSOR.DECIMAL,
    min: 0,
    max: 100_000,
  },
  volatile_organic_compounds_parts: {
    category: C.VOC_SENSOR,
    type: T.VOC_SENSOR.DECIMAL,
    min: 0,
    max: 100_000,
  },
  nitrogen_dioxide: decimal(C.NO2_SENSOR, { min: 0, max: 100_000 }),
  ozone: decimal(C.O3_SENSOR, { min: 0, max: 100_000 }),
  sulphur_dioxide: decimal(C.SO2_SENSOR, { min: 0, max: 100_000 }),
  aqi: {
    category: C.AIRQUALITY_SENSOR,
    type: T.AIRQUALITY_SENSOR.AQI,
    min: 0,
    max: 1000,
    unit: U.AQI,
  },
  distance: decimal(C.DISTANCE_SENSOR, { min: 0, max: 1_000_000 }),
  speed: { category: C.SPEED_SENSOR, type: T.SPEED_SENSOR.DECIMAL, min: 0, max: 10_000 },
  wind_speed: { category: C.SPEED_SENSOR, type: T.SPEED_SENSOR.DECIMAL, min: 0, max: 10_000 },
  precipitation: {
    category: C.PRECIPITATION_SENSOR,
    type: T.PRECIPITATION_SENSOR.DECIMAL,
    min: 0,
    max: 100_000,
  },
  precipitation_intensity: {
    category: C.PRECIPITATION_SENSOR,
    type: T.PRECIPITATION_SENSOR.DECIMAL,
    min: 0,
    max: 10_000,
  },
  volume: { category: C.VOLUME_SENSOR, type: T.VOLUME_SENSOR.DECIMAL, min: 0, max: 1e12 },
  volume_storage: { category: C.VOLUME_SENSOR, type: T.VOLUME_SENSOR.DECIMAL, min: 0, max: 1e12 },
  water: { category: C.VOLUME_SENSOR, type: T.VOLUME_SENSOR.DECIMAL, min: 0, max: 1e12 },
  gas: { category: C.VOLUME_SENSOR, type: T.VOLUME_SENSOR.DECIMAL, min: 0, max: 1e12 },
  duration: { category: C.DURATION, type: T.DURATION.DECIMAL, min: 0, max: 1e12 },
  data_size: { category: C.DATA, type: T.DATA.SIZE, min: 0, max: 1e15 },
  data_rate: { category: C.DATARATE, type: T.DATARATE.RATE, min: 0, max: 1e12 },
  sound_pressure: decimal(C.NOISE_SENSOR, { min: 0, max: 200 }),
  ph: { category: C.PH_SENSOR, type: T.PH_SENSOR.DECIMAL, min: 0, max: 14 },
  monetary: { category: C.CURRENCY, type: T.CURRENCY.DECIMAL, min: -1e12, max: 1e12 },
};

/** Units that tell the measure when a sensor declares no device_class. */
const CLASS_BY_UNIT = {
  '°C': 'temperature',
  '°F': 'temperature',
  lx: 'illuminance',
  hPa: 'pressure',
  mbar: 'pressure',
  W: 'power',
  kW: 'power',
  Wh: 'energy',
  kWh: 'energy',
  V: 'voltage',
  A: 'current',
};

const ENERGY_CLASSES = ['power', 'energy', 'voltage', 'current'];

/**
 * Category and type of a numeric sensor.
 * @param {object} c the entity config
 * @param {{ hasSwitch: boolean }} context the device context: power, energy,
 *   voltage and current of a plug are `switch` features (like the core's
 *   Zigbee2MQTT mapping), a meter's are `energy-sensor` ones.
 */
export function sensorKind(c, context = {}) {
  const deviceClass = c.device_class ?? CLASS_BY_UNIT[c.unit_of_measurement];
  const unit = unitOf(c.unit_of_measurement);
  if (deviceClass === 'temperature' && c.entity_category === 'diagnostic') {
    return {
      category: C.DEVICE_TEMPERATURE_SENSOR,
      type: T.SENSOR.DECIMAL,
      unit,
      min: -100,
      max: 150,
    };
  }
  if (ENERGY_CLASSES.includes(deviceClass)) {
    const total = c.state_class === 'total_increasing' || c.state_class === 'total';
    if (context.hasSwitch) {
      const type = {
        power: T.SWITCH.POWER,
        energy: T.SWITCH.ENERGY,
        voltage: T.SWITCH.VOLTAGE,
        current: T.SWITCH.CURRENT,
      }[deviceClass];
      return { category: C.SWITCH, type, unit, min: 0, max: 1e9 };
    }
    if (deviceClass === 'energy') {
      return {
        category: C.ENERGY_SENSOR,
        type: total ? T.ENERGY_SENSOR.INDEX : T.ENERGY_SENSOR.ENERGY,
        unit,
        min: 0,
        max: 1e12,
      };
    }
    const type = {
      power: T.ENERGY_SENSOR.POWER,
      voltage: T.ENERGY_SENSOR.VOLTAGE,
      current: T.ENERGY_SENSOR.CURRENT,
    }[deviceClass];
    return {
      category: C.ENERGY_SENSOR,
      type,
      unit,
      min: deviceClass === 'power' ? -1e9 : 0,
      max: 1e9,
    };
  }
  if (c.unit_of_measurement === 'UV index') {
    return {
      category: C.UV_SENSOR,
      type: T.UV_SENSOR.INTEGER,
      unit: U.UV_INDEX,
      min: 0,
      max: 20,
      integer: true,
    };
  }
  const known = SENSOR_CLASSES[deviceClass];
  if (known) {
    return { ...known, unit: known.unit ?? unit };
  }
  return { category: C.UNKNOWN, type: T.UNKNOWN.UNKNOWN, unit, min: -1e12, max: 1e12 };
}

/** A sensor is numeric when it says so: a unit, a state class, a numeric device class. */
export function isNumericSensor(c) {
  if (c.device_class === 'enum' || c.device_class === 'timestamp' || c.device_class === 'date') {
    return false;
  }
  if (Array.isArray(c.options)) {
    return false;
  }
  return (
    c.unit_of_measurement !== undefined ||
    c.state_class !== undefined ||
    c.suggested_display_precision !== undefined ||
    c.device_class !== undefined
  );
}

/** HA binary_sensor device_class -> Gladys category (1 = on = open, motion, leak...). */
const BINARY_CLASSES = {
  motion: C.MOTION_SENSOR,
  occupancy: C.MOTION_SENSOR,
  presence: C.MOTION_SENSOR,
  moving: C.MOTION_SENSOR,
  door: C.OPENING_SENSOR,
  window: C.OPENING_SENSOR,
  opening: C.OPENING_SENSOR,
  garage_door: C.OPENING_SENSOR,
  moisture: C.LEAK_SENSOR,
  smoke: C.SMOKE_SENSOR,
  carbon_monoxide: C.CO_SENSOR,
  battery: C.BATTERY_LOW,
  tamper: C.TAMPER,
  vibration: C.VIBRATION_SENSOR,
};

// --- Helpers -----------------------------------------------------------------

/** Renders a value template, or passes the payload through when there is none. */
function valueOf(template, payload) {
  if (template === undefined || template === null) {
    return { text: payload, skipped: false };
  }
  return render(template, payloadVars(payload));
}

function toNumber(text) {
  const s = String(text).trim();
  if (UNAVAILABLE.has(s.toLowerCase())) {
    return undefined;
  }
  const n = Number(s);
  return Number.isFinite(n) ? n : undefined;
}

const str = (v, fallback) => (v === undefined || v === null ? fallback : String(v));
const qosOf = (c) => (Number.isInteger(c.qos) && c.qos >= 0 && c.qos <= 2 ? c.qos : 0);

/** A publication on the command topic (command_template applied with `value`). */
function command(c, topic, value, template, extraVars = {}) {
  const payload =
    template === undefined || template === null
      ? str(value, '')
      : render(template, { value, ...extraVars }).text;
  return { topic, payload, retain: c.retain === true, qos: qosOf(c) };
}

function feature(key, name, spec) {
  return {
    key,
    name,
    category: spec.category,
    type: spec.type,
    unit: spec.unit,
    min: spec.min ?? 0,
    max: spec.max ?? 1,
    step: spec.step,
    read_only: spec.read_only ?? true,
    has_feedback: spec.has_feedback ?? false,
    keep_history: spec.keep_history ?? true,
    supported_options: spec.supported_options,
  };
}

/** Checks every template of a config at discovery time (a broken one rejects the entity). */
function checkTemplates(c) {
  for (const [key, value] of Object.entries(c)) {
    if ((key.endsWith('_template') || key === 'value_template') && typeof value === 'string') {
      checkTemplate(value);
    }
  }
}

const reader = (topic, read) => (typeof topic === 'string' && topic ? [{ topic, read }] : []);

/** Integer RGB (Gladys) <-> components. */
export const rgbToInt = (r, g, b) =>
  (Math.max(0, Math.min(255, Math.round(r))) << 16) +
  (Math.max(0, Math.min(255, Math.round(g))) << 8) +
  Math.max(0, Math.min(255, Math.round(b)));
export const intToRgb = (value) => [(value >> 16) & 255, (value >> 8) & 255, value & 255];

/** Hue (0-360), saturation (0-100) at full value -> RGB. */
export function hsToRgb(h, s) {
  const sat = Math.max(0, Math.min(100, s)) / 100;
  const k = (n) => (n + h / 60) % 6;
  const f = (n) => 255 * (1 - sat * Math.max(0, Math.min(k(n), 4 - k(n), 1)));
  return [f(5), f(3), f(1)];
}

/** RGB -> hue (0-360), saturation (0-100). */
export function rgbToHs(r, g, b) {
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const d = max - min;
  let h = 0;
  if (d !== 0) {
    if (max === r) h = ((g - b) / d) % 6;
    else if (max === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
  }
  h = Math.round((h * 60 + 360) % 360);
  const s = max === 0 ? 0 : Math.round((d / max) * 100);
  return [h, s];
}

/** CIE xy -> RGB (sRGB, full brightness). */
export function xyToRgb(x, y) {
  const z = 1 - x - y;
  const Y = 1;
  const X = y === 0 ? 0 : (Y / y) * x;
  const Z = y === 0 ? 0 : (Y / y) * z;
  let r = X * 1.656492 - Y * 0.354851 - Z * 0.255038;
  let g = -X * 0.707196 + Y * 1.655397 + Z * 0.036152;
  let b = X * 0.051713 - Y * 0.121364 + Z * 1.01153;
  const gamma = (v) => (v <= 0.0031308 ? 12.92 * v : 1.055 * v ** (1 / 2.4) - 0.055);
  [r, g, b] = [gamma(r), gamma(g), gamma(b)].map((v) => Math.max(0, v));
  const max = Math.max(r, g, b, 1e-9);
  return [r, g, b].map((v) => (v / max) * 255);
}

/** RGB -> CIE xy. */
export function rgbToXy(r, g, b) {
  const lin = (v) => {
    const c = v / 255;
    return c > 0.04045 ? ((c + 0.055) / 1.055) ** 2.4 : c / 12.92;
  };
  const [R, G, B] = [lin(r), lin(g), lin(b)];
  const X = R * 0.664511 + G * 0.154324 + B * 0.162028;
  const Y = R * 0.283881 + G * 0.668433 + B * 0.047685;
  const Z = R * 0.000088 + G * 0.07231 + B * 0.986039;
  const sum = X + Y + Z;
  return sum === 0 ? [0, 0] : [Number((X / sum).toFixed(4)), Number((Y / sum).toFixed(4))];
}

const MIRED_KELVIN = (v) => Math.round(1_000_000 / v);

/** Gladys BUTTON_STATUS of a Home Assistant trigger / event type. */
export function buttonValue(type) {
  const t = String(type ?? '').toLowerCase();
  const table = {
    button_short_press: BUTTON_STATUS.CLICK,
    press: BUTTON_STATUS.CLICK,
    single: BUTTON_STATUS.CLICK,
    single_press: BUTTON_STATUS.CLICK,
    click: BUTTON_STATUS.CLICK,
    button_short_release: BUTTON_STATUS.SHORT_RELEASE,
    button_double_press: BUTTON_STATUS.DOUBLE_CLICK,
    double: BUTTON_STATUS.DOUBLE_CLICK,
    double_press: BUTTON_STATUS.DOUBLE_CLICK,
    button_triple_press: BUTTON_STATUS.TRIPLE,
    triple: BUTTON_STATUS.TRIPLE,
    triple_press: BUTTON_STATUS.TRIPLE,
    button_quadruple_press: BUTTON_STATUS.QUADRUPLE,
    quadruple: BUTTON_STATUS.QUADRUPLE,
    button_long_press: BUTTON_STATUS.LONG_CLICK_PRESS,
    long: BUTTON_STATUS.LONG_CLICK,
    long_press: BUTTON_STATUS.LONG_CLICK_PRESS,
    hold: BUTTON_STATUS.LONG_CLICK_PRESS,
    button_long_release: BUTTON_STATUS.LONG_CLICK_RELEASE,
    long_release: BUTTON_STATUS.LONG_CLICK_RELEASE,
    release: BUTTON_STATUS.RELEASE,
    turn_on: BUTTON_STATUS.ON,
    on: BUTTON_STATUS.ON,
    turn_off: BUTTON_STATUS.OFF,
    off: BUTTON_STATUS.OFF,
    shake: BUTTON_STATUS.SHAKE,
  };
  return table[t] ?? BUTTON_STATUS.CLICK;
}

// --- Components ----------------------------------------------------------------

function mapSensor(e, ctx) {
  const c = e.config;
  const numeric = isNumericSensor(c);
  if (!numeric) {
    return {
      features: [
        feature('state', e.name, {
          category: C.TEXT,
          type: T.TEXT.TEXT,
          min: 0,
          max: 0,
          keep_history: false,
        }),
      ],
      readers: reader(c.state_topic, (payload) => {
        const v = valueOf(c.value_template, payload);
        if (v.skipped || UNAVAILABLE.has(v.text.trim().toLowerCase())) {
          return [];
        }
        return [{ key: 'state', text: v.text.slice(0, MAX_TEXT) }];
      }),
    };
  }
  const kind = sensorKind(c, ctx);
  return {
    features: [feature('state', e.name, { ...kind, step: undefined })],
    readers: reader(c.state_topic, (payload) => {
      const v = valueOf(c.value_template, payload);
      const n = v.skipped ? undefined : toNumber(v.text);
      if (n === undefined) {
        return [];
      }
      return [{ key: 'state', state: kind.integer ? Math.round(n) : n }];
    }),
  };
}

function mapBinarySensor(e) {
  const c = e.config;
  const on = str(c.payload_on, 'ON');
  const off = str(c.payload_off, 'OFF');
  const category = BINARY_CLASSES[c.device_class] ?? C.INPUT;
  const type = category === C.INPUT ? T.INPUT.BINARY : T.SENSOR.BINARY;
  const offDelay = Number.isFinite(c.off_delay) && c.off_delay > 0 ? c.off_delay : undefined;
  return {
    features: [feature('state', e.name, { category, type, min: 0, max: 1 })],
    readers: reader(c.state_topic, (payload) => {
      const v = valueOf(c.value_template, payload);
      if (v.skipped) {
        return [];
      }
      if (v.text === on) {
        return [{ key: 'state', state: 1, offDelay }];
      }
      if (v.text === off) {
        return [{ key: 'state', state: 0 }];
      }
      return [];
    }),
  };
}

/** A two-state actuator: switch, siren, fan power. */
function onOff(e, { key, name, category, type }) {
  const c = e.config;
  const payloadOn = str(c.payload_on, 'ON');
  const payloadOff = str(c.payload_off, 'OFF');
  const stateOn = str(c.state_on, payloadOn);
  const stateOff = str(c.state_off, payloadOff);
  const hasState = typeof c.state_topic === 'string';
  return {
    features: [
      feature(key, name, {
        category,
        type,
        min: 0,
        max: 1,
        read_only: typeof c.command_topic !== 'string',
        has_feedback: hasState,
      }),
    ],
    readers: reader(c.state_topic, (payload) => {
      const v = valueOf(c.value_template ?? c.state_value_template, payload);
      if (v.skipped) {
        return [];
      }
      if (v.text === stateOn) {
        return [{ key, state: 1 }];
      }
      if (v.text === stateOff) {
        return [{ key, state: 0 }];
      }
      return [];
    }),
    writers:
      typeof c.command_topic === 'string'
        ? {
            [key]: (value) => [
              command(
                c,
                c.command_topic,
                Number(value) >= 1 ? payloadOn : payloadOff,
                c.command_template,
              ),
            ],
          }
        : {},
    optimistic: !hasState ? [key] : [],
  };
}

function mapSwitch(e) {
  return onOff(e, { key: 'state', name: e.name, category: C.SWITCH, type: T.SWITCH.BINARY });
}

function mapSiren(e) {
  return onOff(e, { key: 'state', name: e.name, category: C.SIREN, type: T.SIREN.BINARY });
}

function mapFan(e) {
  const c = e.config;
  const base = onOff(e, { key: 'state', name: e.name, category: C.SWITCH, type: T.SWITCH.BINARY });
  if (typeof c.percentage_command_topic !== 'string') {
    return base;
  }
  const min = Number.isFinite(c.speed_range_min) ? c.speed_range_min : 1;
  const max = Number.isFinite(c.speed_range_max) ? c.speed_range_max : 100;
  const toPercent = (raw) => Math.round(((raw - min + 1) / (max - min + 1)) * 100);
  const fromPercent = (pct) => (pct <= 0 ? 0 : Math.round((pct / 100) * (max - min + 1) + min - 1));
  base.features.push(
    feature('percentage', `${e.name} %`, {
      category: C.FAN,
      type: T.FAN.PERCENT,
      unit: U.PERCENT,
      min: 0,
      max: 100,
      read_only: false,
      has_feedback: typeof c.percentage_state_topic === 'string',
    }),
  );
  base.readers.push(
    ...reader(c.percentage_state_topic, (payload) => {
      const v = valueOf(c.percentage_value_template, payload);
      const n = v.skipped ? undefined : toNumber(v.text);
      return n === undefined ? [] : [{ key: 'percentage', state: n <= 0 ? 0 : toPercent(n) }];
    }),
  );
  base.writers.percentage = (value) => [
    command(
      c,
      c.percentage_command_topic,
      fromPercent(Number(value)),
      c.percentage_command_template,
    ),
  ];
  return base;
}

function mapLight(e) {
  const schema = e.config.schema ?? 'default';
  if (schema === 'json') {
    return mapJsonLight(e);
  }
  if (schema === 'template') {
    return mapTemplateLight(e);
  }
  return mapDefaultLight(e);
}

function colorTempBounds(c) {
  if (c.color_temp_kelvin === true) {
    const minK = Number.isFinite(c.min_kelvin) ? c.min_kelvin : 2000;
    const maxK = Number.isFinite(c.max_kelvin) ? c.max_kelvin : 6535;
    return { min: MIRED_KELVIN(maxK), max: MIRED_KELVIN(minK), kelvin: true };
  }
  return {
    min: Number.isFinite(c.min_mireds) ? c.min_mireds : 153,
    max: Number.isFinite(c.max_mireds) ? c.max_mireds : 500,
    kelvin: false,
  };
}

const lightFeatures = (e, { brightness, scale, colorTemp, color, hasState }) => {
  const features = [
    feature('state', e.name, {
      category: C.LIGHT,
      type: T.LIGHT.BINARY,
      min: 0,
      max: 1,
      read_only: false,
      has_feedback: hasState,
    }),
  ];
  if (brightness) {
    features.push(
      feature('brightness', `${e.name} brightness`, {
        category: C.LIGHT,
        type: T.LIGHT.BRIGHTNESS,
        min: 0,
        max: scale,
        read_only: false,
        has_feedback: hasState,
      }),
    );
  }
  if (colorTemp) {
    features.push(
      feature('color_temp', `${e.name} color temperature`, {
        category: C.LIGHT,
        type: T.LIGHT.TEMPERATURE,
        min: colorTemp.min,
        max: colorTemp.max,
        read_only: false,
        has_feedback: hasState,
      }),
    );
  }
  if (color) {
    features.push(
      feature('color', `${e.name} color`, {
        category: C.LIGHT,
        type: T.LIGHT.COLOR,
        min: 0,
        max: 16777215,
        read_only: false,
        has_feedback: hasState,
      }),
    );
  }
  return features;
};

function mapDefaultLight(e) {
  const c = e.config;
  const payloadOn = str(c.payload_on, 'ON');
  const payloadOff = str(c.payload_off, 'OFF');
  const scale = Number.isFinite(c.brightness_scale) ? c.brightness_scale : 255;
  const colorTemp = typeof c.color_temp_command_topic === 'string' ? colorTempBounds(c) : null;
  const colorTopic = ['rgb', 'hs', 'xy'].find((m) => typeof c[`${m}_command_topic`] === 'string');
  const hasState = typeof c.state_topic === 'string';
  const onType = c.on_command_type ?? 'last';
  const out = {
    features: lightFeatures(e, {
      brightness: typeof c.brightness_command_topic === 'string',
      scale,
      colorTemp,
      color: Boolean(colorTopic),
      hasState,
    }),
    readers: [],
    writers: {},
    optimistic: hasState ? [] : ['state'],
  };
  out.readers.push(
    ...reader(c.state_topic, (payload) => {
      const v = valueOf(c.state_value_template, payload);
      if (v.skipped) {
        return [];
      }
      if (v.text === payloadOn || v.text.toLowerCase() === 'on') {
        return [{ key: 'state', state: 1 }];
      }
      if (v.text === payloadOff || v.text.toLowerCase() === 'off') {
        return [{ key: 'state', state: 0 }];
      }
      return [];
    }),
    ...reader(c.brightness_state_topic, (payload) => {
      const v = valueOf(c.brightness_value_template, payload);
      const n = v.skipped ? undefined : toNumber(v.text);
      return n === undefined ? [] : [{ key: 'brightness', state: n }];
    }),
    ...reader(c.color_temp_state_topic, (payload) => {
      const v = valueOf(c.color_temp_value_template, payload);
      const n = v.skipped ? undefined : toNumber(v.text);
      if (n === undefined || n <= 0) {
        return [];
      }
      return [{ key: 'color_temp', state: colorTemp?.kelvin ? MIRED_KELVIN(n) : n }];
    }),
    ...reader(c.rgb_state_topic, (payload) => {
      const v = valueOf(c.rgb_value_template, payload);
      const parts = v.skipped ? [] : v.text.split(',').map(Number);
      return parts.length === 3 && parts.every(Number.isFinite)
        ? [{ key: 'color', state: rgbToInt(...parts) }]
        : [];
    }),
    ...reader(c.hs_state_topic, (payload) => {
      const v = valueOf(c.hs_value_template, payload);
      const parts = v.skipped ? [] : v.text.split(',').map(Number);
      return parts.length === 2 && parts.every(Number.isFinite)
        ? [{ key: 'color', state: rgbToInt(...hsToRgb(parts[0], parts[1])) }]
        : [];
    }),
    ...reader(c.xy_state_topic, (payload) => {
      const v = valueOf(c.xy_value_template, payload);
      const parts = v.skipped ? [] : v.text.split(',').map(Number);
      return parts.length === 2 && parts.every(Number.isFinite)
        ? [{ key: 'color', state: rgbToInt(...xyToRgb(parts[0], parts[1])) }]
        : [];
    }),
  );
  const turnOn = () => command(c, c.command_topic, payloadOn);
  const withOn = (messages) =>
    onType === 'first'
      ? [turnOn(), ...messages]
      : onType === 'brightness'
        ? messages
        : [...messages, turnOn()];
  if (typeof c.command_topic === 'string') {
    out.writers.state = (value) => [
      command(c, c.command_topic, Number(value) >= 1 ? payloadOn : payloadOff),
    ];
  }
  if (typeof c.brightness_command_topic === 'string') {
    out.writers.brightness = (value) => {
      const level = Math.round(Number(value));
      if (level <= 0 && typeof c.command_topic === 'string') {
        return [command(c, c.command_topic, payloadOff)];
      }
      const message = command(c, c.brightness_command_topic, level, c.brightness_command_template);
      return typeof c.command_topic === 'string' && onType !== 'brightness'
        ? withOn([message])
        : [message];
    };
  }
  if (colorTemp) {
    out.writers.color_temp = (value) => {
      const mired = Math.round(Number(value));
      const sent = colorTemp.kelvin ? MIRED_KELVIN(mired) : mired;
      const message = command(c, c.color_temp_command_topic, sent, c.color_temp_command_template);
      return typeof c.command_topic === 'string' ? withOn([message]) : [message];
    };
  }
  if (colorTopic) {
    out.writers.color = (value) => {
      const [r, g, b] = intToRgb(Math.round(Number(value)));
      let message;
      if (colorTopic === 'rgb') {
        message = command(c, c.rgb_command_topic, `${r},${g},${b}`, c.rgb_command_template, {
          red: r,
          green: g,
          blue: b,
        });
      } else if (colorTopic === 'hs') {
        const [h, s] = rgbToHs(r, g, b);
        message = command(c, c.hs_command_topic, `${h},${s}`, c.hs_command_template, {
          hue: h,
          sat: s,
        });
      } else {
        const [x, y] = rgbToXy(r, g, b);
        message = command(c, c.xy_command_topic, `${x},${y}`, c.xy_command_template, { x, y });
      }
      return typeof c.command_topic === 'string' ? withOn([message]) : [message];
    };
  }
  return out;
}

const COLOR_MODES = ['hs', 'xy', 'rgb', 'rgbw', 'rgbww'];

function mapJsonLight(e) {
  const c = e.config;
  const modes = Array.isArray(c.supported_color_modes) ? c.supported_color_modes : [];
  const scale = Number.isFinite(c.brightness_scale) ? c.brightness_scale : 255;
  const brightness = c.brightness === true || modes.some((m) => m !== 'onoff');
  const colorTemp =
    modes.includes('color_temp') || c.color_temp === true ? colorTempBounds(c) : null;
  const colorMode =
    modes.find((m) => COLOR_MODES.includes(m)) ??
    (c.rgb === true ? 'rgb' : c.hs === true ? 'hs' : c.xy === true ? 'xy' : null);
  const hasState = typeof c.state_topic === 'string';
  const out = {
    features: lightFeatures(e, {
      brightness,
      scale,
      colorTemp,
      color: Boolean(colorMode),
      hasState,
    }),
    readers: reader(c.state_topic, (payload) => {
      let json;
      try {
        json = JSON.parse(String(payload));
      } catch {
        return [];
      }
      if (!json || typeof json !== 'object') {
        return [];
      }
      const states = [];
      if (json.state === 'ON' || json.state === 'OFF') {
        states.push({ key: 'state', state: json.state === 'ON' ? 1 : 0 });
      }
      if (brightness && Number.isFinite(json.brightness)) {
        states.push({ key: 'brightness', state: json.brightness });
      }
      if (colorTemp && Number.isFinite(json.color_temp) && json.color_temp > 0) {
        states.push({
          key: 'color_temp',
          state: colorTemp.kelvin ? MIRED_KELVIN(json.color_temp) : json.color_temp,
        });
      }
      const col = json.color;
      if (colorMode && col && typeof col === 'object' && json.color_mode !== 'color_temp') {
        let rgb;
        if ([col.r, col.g, col.b].every(Number.isFinite)) {
          rgb = [col.r, col.g, col.b];
        } else if ([col.h, col.s].every(Number.isFinite)) {
          rgb = hsToRgb(col.h, col.s);
        } else if ([col.x, col.y].every(Number.isFinite)) {
          rgb = xyToRgb(col.x, col.y);
        }
        if (rgb) {
          states.push({ key: 'color', state: rgbToInt(...rgb) });
        }
      }
      return states;
    }),
    writers: {},
    optimistic: hasState ? [] : ['state'],
  };
  if (typeof c.command_topic !== 'string') {
    return out;
  }
  const send = (body) => [command(c, c.command_topic, JSON.stringify(body))];
  out.writers.state = (value) => send({ state: Number(value) >= 1 ? 'ON' : 'OFF' });
  if (brightness) {
    out.writers.brightness = (value) => {
      const level = Math.round(Number(value));
      return send(level <= 0 ? { state: 'OFF' } : { state: 'ON', brightness: level });
    };
  }
  if (colorTemp) {
    out.writers.color_temp = (value) => {
      const mired = Math.round(Number(value));
      return send({ state: 'ON', color_temp: colorTemp.kelvin ? MIRED_KELVIN(mired) : mired });
    };
  }
  if (colorMode) {
    out.writers.color = (value) => {
      const [r, g, b] = intToRgb(Math.round(Number(value)));
      if (colorMode === 'hs') {
        const [h, s] = rgbToHs(r, g, b);
        return send({ state: 'ON', color: { h, s } });
      }
      if (colorMode === 'xy') {
        const [x, y] = rgbToXy(r, g, b);
        return send({ state: 'ON', color: { x, y } });
      }
      return send({ state: 'ON', color: { r, g, b } });
    };
  }
  return out;
}

function mapTemplateLight(e) {
  const c = e.config;
  const brightness = typeof c.brightness_template === 'string';
  const colorTemp = typeof c.color_temp_template === 'string' ? colorTempBounds(c) : null;
  const color = ['red_template', 'green_template', 'blue_template'].every(
    (k) => typeof c[k] === 'string',
  );
  const hasState = typeof c.state_topic === 'string' && typeof c.state_template === 'string';
  const out = {
    features: lightFeatures(e, { brightness, scale: 255, colorTemp, color, hasState }),
    readers: [],
    writers: {},
    optimistic: hasState ? [] : ['state'],
  };
  if (typeof c.state_topic === 'string') {
    out.readers.push(
      ...reader(c.state_topic, (payload) => {
        const vars = payloadVars(payload);
        const states = [];
        const rendered = (template) => {
          const r = render(template, vars);
          return r.skipped ? undefined : r.text.trim();
        };
        if (c.state_template) {
          const s = rendered(c.state_template)?.toLowerCase();
          if (s === 'on' || s === 'off') {
            states.push({ key: 'state', state: s === 'on' ? 1 : 0 });
          }
        }
        if (brightness) {
          const n = toNumber(rendered(c.brightness_template) ?? '');
          if (n !== undefined) states.push({ key: 'brightness', state: n });
        }
        if (colorTemp) {
          const n = toNumber(rendered(c.color_temp_template) ?? '');
          if (n !== undefined && n > 0) states.push({ key: 'color_temp', state: n });
        }
        if (color) {
          const rgb = ['red_template', 'green_template', 'blue_template'].map((k) =>
            toNumber(rendered(c[k]) ?? ''),
          );
          if (rgb.every((v) => v !== undefined))
            states.push({ key: 'color', state: rgbToInt(...rgb) });
        }
        return states;
      }),
    );
  }
  if (typeof c.command_topic !== 'string' || typeof c.command_on_template !== 'string') {
    return out;
  }
  const on = (vars) => [
    {
      topic: c.command_topic,
      payload: render(c.command_on_template, { state: 'on', ...vars }).text,
      retain: c.retain === true,
      qos: qosOf(c),
    },
  ];
  out.writers.state = (value) =>
    Number(value) >= 1
      ? on({})
      : [
          {
            topic: c.command_topic,
            payload: render(c.command_off_template ?? 'off', { state: 'off' }).text,
            retain: c.retain === true,
            qos: qosOf(c),
          },
        ];
  if (brightness) out.writers.brightness = (value) => on({ brightness: Math.round(Number(value)) });
  if (colorTemp) out.writers.color_temp = (value) => on({ color_temp: Math.round(Number(value)) });
  if (color) {
    out.writers.color = (value) => {
      const [red, green, blue] = intToRgb(Math.round(Number(value)));
      const [hue, sat] = rgbToHs(red, green, blue);
      return on({ red, green, blue, hue, sat });
    };
  }
  return out;
}

function mapCover(e) {
  const c = e.config;
  const category = ['curtain'].includes(c.device_class) ? C.CURTAIN : C.SHUTTER;
  const types = category === C.CURTAIN ? T.CURTAIN : T.SHUTTER;
  const hasCommand = typeof c.command_topic === 'string';
  const hasState = typeof c.state_topic === 'string';
  const positionOpen = Number.isFinite(c.position_open) ? c.position_open : 100;
  const positionClosed = Number.isFinite(c.position_closed) ? c.position_closed : 0;
  const toPercent = (raw) =>
    Math.round(((raw - positionClosed) / (positionOpen - positionClosed)) * 100);
  const fromPercent = (pct) =>
    Math.round(positionClosed + (pct / 100) * (positionOpen - positionClosed));
  const hasPosition =
    typeof c.position_topic === 'string' || typeof c.set_position_topic === 'string';
  const features = [];
  if (hasCommand || hasState) {
    features.push(
      feature('state', e.name, {
        category,
        type: types.STATE,
        min: -1,
        max: 1,
        read_only: !hasCommand,
        has_feedback: hasState,
        keep_history: false,
      }),
    );
  }
  if (hasPosition) {
    features.push(
      feature('position', `${e.name} position`, {
        category,
        type: types.POSITION,
        unit: U.PERCENT,
        min: 0,
        max: 100,
        read_only: typeof c.set_position_topic !== 'string',
        has_feedback: typeof c.position_topic === 'string',
      }),
    );
  }
  const states = {
    [str(c.state_open, 'open')]: COVER_STATE.OPEN,
    [str(c.state_opening, 'opening')]: COVER_STATE.OPEN,
    [str(c.state_closed, 'closed')]: COVER_STATE.CLOSE,
    [str(c.state_closing, 'closing')]: COVER_STATE.CLOSE,
    [str(c.state_stopped, 'stopped')]: COVER_STATE.STOP,
  };
  const out = {
    features,
    readers: [
      ...reader(c.state_topic, (payload) => {
        const v = valueOf(c.value_template, payload);
        if (v.skipped) {
          return [];
        }
        const state = states[v.text];
        return state === undefined ? [] : [{ key: 'state', state }];
      }),
      ...reader(c.position_topic, (payload) => {
        const v = valueOf(c.position_template, payload);
        const n = v.skipped ? undefined : toNumber(v.text);
        return n === undefined
          ? []
          : [{ key: 'position', state: Math.max(0, Math.min(100, toPercent(n))) }];
      }),
    ],
    writers: {},
  };
  if (hasCommand) {
    const open = c.payload_open === null ? null : str(c.payload_open, 'OPEN');
    const close = c.payload_close === null ? null : str(c.payload_close, 'CLOSE');
    const stop = c.payload_stop === null ? null : str(c.payload_stop, 'STOP');
    out.writers.state = (value) => {
      const v = Math.round(Number(value));
      const payload = v === COVER_STATE.OPEN ? open : v === COVER_STATE.CLOSE ? close : stop;
      if (payload === null) {
        throw new Error('this cover does not accept that command');
      }
      return [command(c, c.command_topic, payload)];
    };
  }
  if (typeof c.set_position_topic === 'string') {
    out.writers.position = (value) => {
      const position = fromPercent(Math.max(0, Math.min(100, Number(value))));
      return [command(c, c.set_position_topic, position, c.set_position_template, { position })];
    };
  }
  return out;
}

function mapLock(e) {
  const c = e.config;
  const hasState = typeof c.state_topic === 'string';
  const states = {
    [str(c.state_locked, 'LOCKED')]: LOCK_STATE.LOCKED,
    [str(c.state_unlocked, 'UNLOCKED')]: LOCK_STATE.UNLOCKED,
    [str(c.state_locking, 'LOCKING')]: LOCK_STATE.ACTIVITY,
    [str(c.state_unlocking, 'UNLOCKING')]: LOCK_STATE.ACTIVITY,
    [str(c.state_opening, 'OPENING')]: LOCK_STATE.ACTIVITY,
    [str(c.state_jammed, 'JAMMED')]: LOCK_STATE.ERROR,
  };
  const features = [];
  if (typeof c.command_topic === 'string') {
    features.push(
      feature('lock', e.name, {
        category: C.LOCK,
        type: T.LOCK.BINARY,
        min: 0,
        max: 1,
        read_only: false,
        has_feedback: hasState,
      }),
    );
  }
  if (hasState) {
    features.push(
      feature('lock_state', `${e.name} state`, {
        category: C.LOCK,
        type: T.LOCK.STATE,
        min: 0,
        max: 3,
      }),
    );
  }
  return {
    features,
    readers: reader(c.state_topic, (payload) => {
      const v = valueOf(c.value_template, payload);
      const state = v.skipped ? undefined : states[v.text];
      if (state === undefined) {
        return [];
      }
      const out = [{ key: 'lock_state', state }];
      if (state === LOCK_STATE.LOCKED || state === LOCK_STATE.UNLOCKED) {
        out.push({ key: 'lock', state });
      }
      return out.filter((s) => features.some((f) => f.key === s.key));
    }),
    writers:
      typeof c.command_topic === 'string'
        ? {
            lock: (value) => [
              command(
                c,
                c.command_topic,
                Number(value) >= 1 ? str(c.payload_lock, 'LOCK') : str(c.payload_unlock, 'UNLOCK'),
                c.command_template,
              ),
            ],
          }
        : {},
  };
}

/** HA button and scene: a command without state, a Gladys push button. */
function mapPress(e, defaultPayload, payloadKey) {
  const c = e.config;
  if (typeof c.command_topic !== 'string') {
    return { features: [], readers: [] };
  }
  return {
    features: [
      feature('press', e.name, {
        category: C.BUTTON,
        type: T.BUTTON.PUSH,
        min: 0,
        max: 1,
        read_only: false,
        keep_history: false,
      }),
    ],
    readers: [],
    writers: {
      press: () => [
        command(c, c.command_topic, str(c[payloadKey], defaultPayload), c.command_template),
      ],
    },
  };
}

function mapNumber(e) {
  const c = e.config;
  const min = Number.isFinite(c.min) ? c.min : 1;
  const max = Number.isFinite(c.max) ? c.max : 100;
  const unit = unitOf(c.unit_of_measurement);
  // A number is a free setting (an offset, a duration, a level): Gladys has no
  // generic writable number, so it stays in the unknown category, with its unit.
  return {
    features: [
      feature('value', e.name, {
        category: C.UNKNOWN,
        type: T.UNKNOWN.UNKNOWN,
        unit,
        min,
        max,
        step: Number.isFinite(c.step) && c.step > 0 ? c.step : undefined,
        read_only: typeof c.command_topic !== 'string',
        has_feedback: typeof c.state_topic === 'string',
      }),
    ],
    readers: reader(c.state_topic, (payload) => {
      const v = valueOf(c.value_template, payload);
      const n = v.skipped ? undefined : toNumber(v.text);
      return n === undefined ? [] : [{ key: 'value', state: n }];
    }),
    writers:
      typeof c.command_topic === 'string'
        ? { value: (value) => [command(c, c.command_topic, Number(value), c.command_template)] }
        : {},
  };
}

function mapSelect(e) {
  const c = e.config;
  const options = (Array.isArray(c.options) ? c.options : []).map(String).slice(0, 100);
  return {
    features: [
      feature('option', e.name, {
        category: C.TEXT,
        type: T.TEXT.SELECT,
        min: 0,
        max: 0,
        read_only: typeof c.command_topic !== 'string',
        has_feedback: typeof c.state_topic === 'string',
        keep_history: false,
        supported_options: options.map((value, i) => ({
          value,
          label: { en: value },
          sort_order: i + 1,
        })),
      }),
    ],
    readers: reader(c.state_topic, (payload) => {
      const v = valueOf(c.value_template, payload);
      return v.skipped || !options.includes(v.text) ? [] : [{ key: 'option', text: v.text }];
    }),
    writers:
      typeof c.command_topic === 'string'
        ? {
            option: (value) => {
              if (!options.includes(String(value))) {
                throw new Error(`unknown option ${value}`);
              }
              return [command(c, c.command_topic, String(value), c.command_template)];
            },
          }
        : {},
  };
}

function mapText(e) {
  const c = e.config;
  return {
    features: [
      feature('text', e.name, {
        category: C.TEXT,
        type: T.TEXT.TEXT,
        min: 0,
        max: 0,
        read_only: typeof c.command_topic !== 'string',
        has_feedback: typeof c.state_topic === 'string',
        keep_history: false,
      }),
    ],
    readers: reader(c.state_topic, (payload) => {
      const v = valueOf(c.value_template, payload);
      return v.skipped ? [] : [{ key: 'text', text: v.text.slice(0, MAX_TEXT) }];
    }),
    writers:
      typeof c.command_topic === 'string'
        ? { text: (value) => [command(c, c.command_topic, String(value), c.command_template)] }
        : {},
  };
}

const HVAC_MODES = {
  off: THERMOSTAT_MODE.OFF,
  heat: THERMOSTAT_MODE.HEATING,
  cool: THERMOSTAT_MODE.COOLING,
  auto: THERMOSTAT_MODE.AUTO,
  heat_cool: THERMOSTAT_MODE.AUTO,
};
const HVAC_ACTIONS = {
  off: THERMOSTAT_OPERATING_STATE.IDLE,
  idle: THERMOSTAT_OPERATING_STATE.IDLE,
  heating: THERMOSTAT_OPERATING_STATE.HEATING,
  preheating: THERMOSTAT_OPERATING_STATE.HEATING,
  defrosting: THERMOSTAT_OPERATING_STATE.HEATING,
  cooling: THERMOSTAT_OPERATING_STATE.COOLING,
};
const PRESETS = {
  schedule: THERMOSTAT_PRESET.SCHEDULE,
  auto: THERMOSTAT_PRESET.SCHEDULE,
  program: THERMOSTAT_PRESET.SCHEDULE,
  frost: THERMOSTAT_PRESET.FROST,
  frost_protection: THERMOSTAT_PRESET.FROST,
  antifrost: THERMOSTAT_PRESET.FROST,
  away: THERMOSTAT_PRESET.AWAY,
  vacation: THERMOSTAT_PRESET.AWAY,
  eco: THERMOSTAT_PRESET.ECO,
  sleep: THERMOSTAT_PRESET.NIGHT,
  night: THERMOSTAT_PRESET.NIGHT,
  comfort: THERMOSTAT_PRESET.COMFORT,
  home: THERMOSTAT_PRESET.COMFORT,
};

function mapClimate(e) {
  const c = e.config;
  const features = [];
  const readers = [];
  const writers = {};
  const temperatureUnit = c.temperature_unit === 'F' ? U.FAHRENHEIT : U.CELSIUS;
  if (typeof c.current_temperature_topic === 'string') {
    features.push(
      feature('current_temperature', `${e.name} temperature`, {
        category: C.TEMPERATURE_SENSOR,
        type: T.SENSOR.DECIMAL,
        unit: temperatureUnit,
        min: -100,
        max: 150,
      }),
    );
    readers.push(
      ...reader(c.current_temperature_topic, (payload) => {
        const v = valueOf(c.current_temperature_template, payload);
        const n = v.skipped ? undefined : toNumber(v.text);
        return n === undefined ? [] : [{ key: 'current_temperature', state: n }];
      }),
    );
  }
  if (
    typeof c.temperature_command_topic === 'string' ||
    typeof c.temperature_state_topic === 'string'
  ) {
    features.push(
      feature('target_temperature', `${e.name} setpoint`, {
        category: C.THERMOSTAT,
        type: T.THERMOSTAT.TARGET_TEMPERATURE,
        unit: temperatureUnit,
        min: Number.isFinite(c.min_temp) ? c.min_temp : 7,
        max: Number.isFinite(c.max_temp) ? c.max_temp : 35,
        step:
          Number.isFinite(c.temp_step) && c.temp_step > 0
            ? c.temp_step
            : Number.isFinite(c.precision)
              ? c.precision
              : 0.5,
        read_only: typeof c.temperature_command_topic !== 'string',
        has_feedback: typeof c.temperature_state_topic === 'string',
      }),
    );
    readers.push(
      ...reader(c.temperature_state_topic, (payload) => {
        const v = valueOf(c.temperature_state_template, payload);
        const n = v.skipped ? undefined : toNumber(v.text);
        return n === undefined ? [] : [{ key: 'target_temperature', state: n }];
      }),
    );
    if (typeof c.temperature_command_topic === 'string') {
      writers.target_temperature = (value) => [
        command(c, c.temperature_command_topic, Number(value), c.temperature_command_template),
      ];
    }
  }
  const modes = (
    Array.isArray(c.modes) ? c.modes : ['auto', 'off', 'cool', 'heat', 'dry', 'fan_only']
  ).filter((m) => m in HVAC_MODES);
  if (
    (typeof c.mode_command_topic === 'string' || typeof c.mode_state_topic === 'string') &&
    modes.length
  ) {
    const supported = [...new Set(modes.map((m) => HVAC_MODES[m]))];
    features.push(
      feature('mode', `${e.name} mode`, {
        category: C.THERMOSTAT,
        type: T.THERMOSTAT.MODE,
        min: 0,
        max: 3,
        read_only: typeof c.mode_command_topic !== 'string',
        has_feedback: typeof c.mode_state_topic === 'string',
        keep_history: false,
        supported_options: supported.map((value, i) => ({ value, sort_order: i + 1 })),
      }),
    );
    readers.push(
      ...reader(c.mode_state_topic, (payload) => {
        const v = valueOf(c.mode_state_template, payload);
        const mode = v.skipped ? undefined : HVAC_MODES[v.text.trim()];
        return mode === undefined ? [] : [{ key: 'mode', state: mode }];
      }),
    );
    if (typeof c.mode_command_topic === 'string') {
      writers.mode = (value) => {
        const wanted = Math.round(Number(value));
        const mode = modes.find((m) => HVAC_MODES[m] === wanted);
        if (!mode) {
          throw new Error(`mode ${value} is not supported by this thermostat`);
        }
        return [command(c, c.mode_command_topic, mode, c.mode_command_template)];
      };
    }
  }
  if (typeof c.action_topic === 'string') {
    features.push(
      feature('action', `${e.name} activity`, {
        category: C.THERMOSTAT,
        type: T.THERMOSTAT.OPERATING_STATE,
        min: 0,
        max: 2,
      }),
    );
    readers.push(
      ...reader(c.action_topic, (payload) => {
        const v = valueOf(c.action_template, payload);
        const action = v.skipped ? undefined : HVAC_ACTIONS[v.text.trim()];
        return action === undefined ? [] : [{ key: 'action', state: action }];
      }),
    );
  }
  const presets = (Array.isArray(c.preset_modes) ? c.preset_modes : []).filter((p) => p in PRESETS);
  if (
    (typeof c.preset_mode_command_topic === 'string' ||
      typeof c.preset_mode_state_topic === 'string') &&
    presets.length
  ) {
    const supported = [...new Set(presets.map((p) => PRESETS[p]))];
    features.push(
      feature('preset', `${e.name} preset`, {
        category: C.THERMOSTAT,
        type: T.THERMOSTAT.PRESET,
        min: 0,
        max: 5,
        read_only: typeof c.preset_mode_command_topic !== 'string',
        has_feedback: typeof c.preset_mode_state_topic === 'string',
        keep_history: false,
        supported_options: supported.map((value, i) => ({ value, sort_order: i + 1 })),
      }),
    );
    readers.push(
      ...reader(c.preset_mode_state_topic, (payload) => {
        const v = valueOf(c.preset_mode_value_template, payload);
        const preset = v.skipped ? undefined : PRESETS[v.text.trim()];
        return preset === undefined ? [] : [{ key: 'preset', state: preset }];
      }),
    );
    if (typeof c.preset_mode_command_topic === 'string') {
      writers.preset = (value) => {
        const wanted = Math.round(Number(value));
        const preset = presets.find((p) => PRESETS[p] === wanted);
        if (!preset) {
          throw new Error(`preset ${value} is not supported by this thermostat`);
        }
        return [command(c, c.preset_mode_command_topic, preset, c.preset_mode_command_template)];
      };
    }
  }
  return { features, readers, writers };
}

/** HA event entity: a button feature + a scene trigger per event type. */
function mapEvent(e) {
  const c = e.config;
  const types = (Array.isArray(c.event_types) ? c.event_types : []).map(String);
  return {
    features: [
      feature('event', e.name, {
        category: C.BUTTON,
        type: T.BUTTON.CLICK,
        min: 0,
        max: 255,
        keep_history: true,
      }),
    ],
    readers: [],
    triggers: reader(c.state_topic, (payload) => {
      const v = valueOf(c.value_template, payload);
      if (v.skipped) {
        return null;
      }
      let json;
      try {
        json = JSON.parse(v.text);
      } catch {
        return null;
      }
      const type = json?.event_type;
      if (typeof type !== 'string' || (types.length > 0 && !types.includes(type))) {
        return null;
      }
      return {
        type,
        subtype: e.name,
        payload: v.text,
        featureKey: 'event',
        value: buttonValue(type),
      };
    }).map(({ topic, read }) => ({ topic, match: read })),
  };
}

/** HA device trigger: one button feature per subtype, a scene trigger per message. */
function mapDeviceTrigger(e) {
  const c = e.config;
  if (c.automation_type !== 'trigger' || typeof c.topic !== 'string') {
    return { features: [], readers: [] };
  }
  const type = str(c.type, 'button_short_press');
  const subtype = str(c.subtype, 'button_1');
  const key = `trigger_${subtype.replace(/[^A-Za-z0-9_-]/g, '_').slice(0, 40)}`;
  return {
    features: [
      feature(key, subtype.replace(/_/g, ' '), {
        category: C.BUTTON,
        type: T.BUTTON.CLICK,
        min: 0,
        max: 255,
      }),
    ],
    readers: [],
    triggers: [
      {
        topic: c.topic,
        match: (payload) => {
          const v = valueOf(c.value_template, payload);
          if (v.skipped) {
            return null;
          }
          if (c.payload !== undefined && c.payload !== null && v.text !== String(c.payload)) {
            return null;
          }
          return { type, subtype, payload: v.text, featureKey: key, value: buttonValue(type) };
        },
      },
    ],
  };
}

const MAPPERS = {
  binary_sensor: mapBinarySensor,
  button: (e) => mapPress(e, 'PRESS', 'payload_press'),
  climate: mapClimate,
  cover: mapCover,
  device_automation: mapDeviceTrigger,
  event: mapEvent,
  fan: mapFan,
  light: mapLight,
  lock: mapLock,
  number: mapNumber,
  scene: (e) => mapPress(e, 'ON', 'payload_on'),
  select: mapSelect,
  sensor: mapSensor,
  siren: mapSiren,
  switch: mapSwitch,
  text: mapText,
};

/**
 * Maps one entity. `e`: { component, config, name }, `ctx`: the device context.
 * @returns the mapped entity, or { error } when it cannot be used.
 */
export function mapEntity(e, ctx = {}) {
  const mapper = MAPPERS[e.component];
  if (!mapper) {
    return { error: `the ${e.component} component is not supported yet` };
  }
  try {
    checkTemplates(e.config);
    const mapped = mapper(e, ctx);
    return {
      features: mapped.features ?? [],
      readers: mapped.readers ?? [],
      writers: mapped.writers ?? {},
      triggers: mapped.triggers ?? [],
      optimistic: mapped.optimistic ?? [],
    };
  } catch (err) {
    if (err instanceof TemplateError) {
      return { error: `unsupported template: ${err.message}` };
    }
    throw err;
  }
}
