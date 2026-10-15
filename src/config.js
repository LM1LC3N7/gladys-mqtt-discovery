// -----------------------------------------------------------------------------
// The configuration of the manifest `config_schema`, normalized.
// -----------------------------------------------------------------------------

import { SENSOR_INTERVAL } from './constants.js';

/** Defaults, mirrored by the manifest (checked by test/manifest.test.js). */
export const DEFAULTS = {
  broker_url: '',
  username: '',
  password: '',
  discovery_prefix: 'homeassistant',
  verify_certificate: true,
  ignore_zigbee2mqtt: true,
  sensor_interval: SENSOR_INTERVAL.default,
};

const SCHEMES = ['mqtt:', 'mqtts:', 'ws:', 'wss:', 'tcp:', 'ssl:'];

/**
 * The broker URL, completed: "192.168.1.10" -> "mqtt://192.168.1.10".
 * @returns {{ url: string } | { error: string }}
 */
export function parseBrokerUrl(raw) {
  const text = String(raw ?? '').trim();
  if (text === '') {
    return { error: 'empty' };
  }
  const withScheme = /^[a-z]+:\/\//i.test(text) ? text : `mqtt://${text}`;
  let url;
  try {
    url = new URL(withScheme);
  } catch {
    return { error: 'invalid' };
  }
  if (!SCHEMES.includes(url.protocol) || !url.hostname) {
    return { error: 'invalid' };
  }
  if (url.username || url.password) {
    // Credentials belong to their own fields (the secret one is never shown again).
    return { error: 'credentials' };
  }
  return { url: url.toString().replace(/\/$/, '') };
}

/** The discovery prefix: no wildcard, no leading or trailing slash. */
export function normalizePrefix(raw) {
  const text = String(raw ?? '')
    .trim()
    .replace(/^\/+|\/+$/g, '');
  if (text === '' || /[#+]/.test(text)) {
    return DEFAULTS.discovery_prefix;
  }
  return text;
}

export function normalizeConfig(raw = {}) {
  const given = Object.fromEntries(
    Object.entries(raw ?? {}).filter(([, v]) => v !== null && v !== undefined),
  );
  const c = { ...DEFAULTS, ...given };
  const broker = parseBrokerUrl(c.broker_url);
  const interval = Number(c.sensor_interval);
  return {
    brokerUrl: broker.url,
    brokerError: broker.error,
    username: String(c.username ?? '').trim(),
    password: String(c.password ?? ''),
    prefix: normalizePrefix(c.discovery_prefix),
    verifyCertificate: c.verify_certificate !== false,
    ignoreZigbee2mqtt: c.ignore_zigbee2mqtt !== false,
    sensorInterval: Number.isFinite(interval)
      ? Math.max(SENSOR_INTERVAL.min, Math.min(SENSOR_INTERVAL.max, Math.round(interval)))
      : SENSOR_INTERVAL.default,
  };
}
