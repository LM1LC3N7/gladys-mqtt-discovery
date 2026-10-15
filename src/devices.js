// -----------------------------------------------------------------------------
// Entities -> Gladys devices, and the routing tables of the MQTT messages (pure).
//
// Home Assistant groups entities by their `device` block (identifiers or
// connections): one Gladys device per HA device, one or more features per
// entity. An entity without a device block is a device of its own. External
// ids are built from the identifiers the devices publish themselves, so they
// survive restarts, renames and re-announcements.
// -----------------------------------------------------------------------------

import { createHash } from 'node:crypto';
import { availabilityOf } from './discovery.js';
import { mapEntity } from './mapping.js';

export const DEVICE_TYPE = 'mqtt';
const MAX_ID = 64;

/** A stable, external-id-safe version of an identifier (a hash keeps it unique). */
export function safeId(raw) {
  const s = String(raw);
  const cleaned = s.replace(/[^A-Za-z0-9_.-]/g, '_');
  if (cleaned === s && cleaned.length <= MAX_ID) {
    return cleaned;
  }
  const hash = createHash('sha1').update(s).digest('hex').slice(0, 8);
  return `${cleaned.slice(0, MAX_ID - 9)}_${hash}`;
}

const firstString = (value) => {
  const list = Array.isArray(value) ? value : [value];
  return list.find((v) => (typeof v === 'string' && v.trim() !== '') || typeof v === 'number');
};

/** The key of the HA device an entity belongs to. */
export function deviceKeyOf(entity) {
  const device = entity.config.device;
  if (device && typeof device === 'object') {
    const identifier = firstString(device.identifiers);
    if (identifier !== undefined) {
      return { key: `id:${identifier}`, platformId: safeId(identifier) };
    }
    const connection = (Array.isArray(device.connections) ? device.connections : []).find(
      (c) => Array.isArray(c) && c.length === 2,
    );
    if (connection) {
      const id = `${connection[0]}_${connection[1]}`;
      return { key: `cn:${id}`, platformId: safeId(id) };
    }
  }
  const own = entity.config.unique_id ?? entity.key;
  return { key: `entity:${own}`, platformId: safeId(`e_${own}`) };
}

const humanize = (id) =>
  String(id ?? '')
    .replace(/[_-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^./, (c) => c.toUpperCase());

/** Name of an entity inside its device: `name: null` is the device's main entity. */
export function entityName(entity, deviceName) {
  const { name } = entity.config;
  if (name === null) {
    return deviceName;
  }
  if (typeof name === 'string' && name.trim() !== '') {
    return name.trim().slice(0, 100);
  }
  return humanize(entity.config.object_id ?? entity.objectId) || deviceName;
}

/** Devices that the native Gladys integrations already handle. */
export function isZigbee2mqtt(entity) {
  const origin = entity.config.origin?.name;
  if (typeof origin === 'string' && origin.toLowerCase() === 'zigbee2mqtt') {
    return true;
  }
  const identifier = firstString(entity.config.device?.identifiers);
  return typeof identifier === 'string' && identifier.startsWith('zigbee2mqtt_');
}

function deviceParams(info, origin) {
  const params = [
    ['MANUFACTURER', info?.manufacturer],
    ['MODEL', info?.model],
    ['SW_VERSION', info?.sw_version],
    ['HW_VERSION', info?.hw_version],
    ['SUGGESTED_AREA', info?.suggested_area],
    ['ORIGIN', origin?.name],
  ];
  return params
    .filter(([, value]) => typeof value === 'string' || typeof value === 'number')
    .map(([name, value]) => ({ name, value: String(value).slice(0, 200) }));
}

const push = (map, key, value) => {
  if (!map.has(key)) {
    map.set(key, []);
  }
  map.get(key).push(value);
};

/** Drops the undefined fields: Gladys stores what it receives. */
const compact = (object) =>
  Object.fromEntries(Object.entries(object).filter(([, v]) => v !== undefined));

/**
 * Builds the Gladys devices and the routing tables from the known entities.
 * @param {object} gladys the SDK client (for the external ids)
 * @param {object[]} entities { key, component, objectId, config }
 * @param {{ ignoreZigbee2mqtt?: boolean }} options
 */
export function buildModel(gladys, entities, { ignoreZigbee2mqtt = true } = {}) {
  const groups = new Map();
  const skipped = [];
  for (const entity of entities) {
    if (entity.config.enabled_by_default === false) {
      skipped.push({ key: entity.key, reason: 'disabled by default' });
      continue;
    }
    if (ignoreZigbee2mqtt && isZigbee2mqtt(entity)) {
      skipped.push({ key: entity.key, reason: 'Zigbee2MQTT device' });
      continue;
    }
    const { key, platformId } = deviceKeyOf(entity);
    if (!groups.has(key)) {
      groups.set(key, { key, platformId, info: null, origin: null, entities: [] });
    }
    const group = groups.get(key);
    group.entities.push(entity);
    group.info ??= entity.config.device ?? null;
    group.origin ??= entity.config.origin ?? null;
  }

  const devices = [];
  const routes = new Map();
  const triggerRoutes = new Map();
  const availabilityRoutes = new Map();
  const writers = new Map();
  const optimistic = new Set();
  const throttled = new Set();
  const availability = new Map();
  const errors = [];

  for (const group of groups.values()) {
    const ids = gladys.externalIds(DEVICE_TYPE, group.platformId);
    const sorted = [...group.entities].sort((a, b) => a.key.localeCompare(b.key));
    const main = sorted.find((e) => e.config.name === null) ?? sorted[0];
    const deviceName =
      (typeof group.info?.name === 'string' && group.info.name.trim()) ||
      (typeof main.config.name === 'string' && main.config.name.trim()) ||
      humanize(main.config.object_id ?? main.objectId) ||
      group.platformId;
    const context = {
      hasSwitch: sorted.some((e) => e.component === 'switch' || e.component === 'light'),
    };
    const features = [];
    const seen = new Set();
    const checks = [];
    for (const entity of sorted) {
      const name = entityName(entity, deviceName);
      const mapped = mapEntity({ ...entity, name }, context);
      if (mapped.error) {
        errors.push({ key: entity.key, error: mapped.error });
        continue;
      }
      // Device triggers of one device share a feature per button (subtype).
      const prefix =
        entity.component === 'device_automation'
          ? ''
          : `${safeId(entity.config.unique_id ?? entity.key)}:`;
      const featureId = (key) => ids.feature(`${prefix}${key}`);
      for (const f of mapped.features) {
        const external = featureId(f.key);
        if (seen.has(external)) {
          continue;
        }
        seen.add(external);
        features.push(
          compact({
            name: f.name,
            external_id: external,
            category: f.category,
            type: f.type,
            unit: f.unit,
            min: f.min,
            max: f.max,
            step: f.step,
            read_only: f.read_only,
            has_feedback: f.has_feedback,
            keep_history: f.keep_history,
            supported_options: f.supported_options,
          }),
        );
        // Measurements may arrive every second: they are throttled, events are not.
        if (f.read_only && !['binary', 'push', 'click', 'text'].includes(f.type)) {
          throttled.add(external);
        }
      }
      for (const r of mapped.readers) {
        push(routes, r.topic, {
          deviceId: ids.device,
          entityKey: entity.key,
          read: (payload) => r.read(payload).map((s) => ({ ...s, featureId: featureId(s.key) })),
        });
      }
      for (const t of mapped.triggers) {
        push(triggerRoutes, t.topic, {
          deviceId: ids.device,
          entityKey: entity.key,
          match: (payload) => {
            const hit = t.match(payload);
            return hit ? { ...hit, featureId: featureId(hit.featureKey) } : null;
          },
        });
      }
      for (const [key, write] of Object.entries(mapped.writers)) {
        writers.set(featureId(key), write);
      }
      for (const key of mapped.optimistic) {
        optimistic.add(featureId(key));
      }
      const avail = availabilityOf(entity.config);
      if (avail.entries.length > 0) {
        checks.push({ entityKey: entity.key, ...avail });
        for (const entry of avail.entries) {
          push(availabilityRoutes, entry.topic, {
            deviceId: ids.device,
            entityKey: entity.key,
            entry,
          });
        }
      }
    }
    if (features.length === 0) {
      continue;
    }
    availability.set(ids.device, checks);
    devices.push({
      name: deviceName.slice(0, 100),
      external_id: ids.device,
      features,
      params: deviceParams(group.info, group.origin),
      should_poll: false,
    });
  }
  devices.sort((a, b) => a.name.localeCompare(b.name));
  return {
    devices,
    routes,
    triggerRoutes,
    availabilityRoutes,
    writers,
    optimistic,
    throttled,
    availability,
    errors,
    skipped,
  };
}

/** Whether an MQTT topic matches a subscription pattern (+ and # wildcards). */
export function topicMatches(pattern, topic) {
  if (pattern === topic) {
    return true;
  }
  const p = pattern.split('/');
  const t = topic.split('/');
  for (let i = 0; i < p.length; i += 1) {
    if (p[i] === '#') {
      // "a/#" also matches "a" (MQTT 3.1.1, 4.7.1.2); "#" is only valid last.
      return i === p.length - 1;
    }
    if (i >= t.length || (p[i] !== '+' && p[i] !== t[i])) {
      return false;
    }
  }
  return p.length === t.length;
}

export const hasWildcard = (topic) => topic.includes('+') || topic.includes('#');

/** The routes of a topic: its exact ones, then those of the matching wildcard patterns. */
export function routesFor(map, topic) {
  const out = [...(map.get(topic) ?? [])];
  for (const [pattern, routes] of map) {
    if (pattern !== topic && hasWildcard(pattern) && topicMatches(pattern, topic)) {
      out.push(...routes);
    }
  }
  return out;
}

/**
 * Whether a device is reachable: every entity is available when its checks
 * say so (mode `latest`: the last message wins, `all`/`any` as in HA), and the
 * device is reachable when one of its entities is. `seen` holds the last
 * availability value per `${entityKey}|${topic}` (true/false, absent = unknown).
 */
export function deviceAvailable(checks, seen) {
  if (!checks || checks.length === 0) {
    return true;
  }
  let known = false;
  for (const check of checks) {
    const values = check.entries
      .map((entry) => seen.get(`${check.entityKey}|${entry.topic}`))
      .filter((v) => v !== undefined);
    if (values.length === 0) {
      continue;
    }
    known = true;
    let available;
    if (check.mode === 'all') {
      available = values.length === check.entries.length && values.every((v) => v.value);
    } else if (check.mode === 'any') {
      available = values.some((v) => v.value);
    } else {
      available = values.reduce((a, b) => (b.at >= a.at ? b : a)).value;
    }
    if (available) {
      return true;
    }
  }
  return !known;
}
