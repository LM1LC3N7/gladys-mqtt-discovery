// -----------------------------------------------------------------------------
// The integration: one connection to the user's MQTT broker, the discovery
// configs it holds (retained), the Gladys devices built from them, the state,
// trigger and availability messages routed to those devices, and the commands
// sent back. index.js only wires the SDK handlers to it.
// -----------------------------------------------------------------------------

import { DEVICE_TRANSPORTS, createLogger } from '@gladysassistant/integration-sdk';
import { normalizeConfig } from './config.js';
import { LIMITS, SCENE_TRIGGERS, TIMINGS } from './constants.js';
import { buildModel, deviceAvailable, routesFor } from './devices.js';
import { parseDiscoveryMessage, parseDiscoveryTopic } from './discovery.js';
import { T } from './i18n.js';
import { connectBroker, errorReason, isRefusal, tooLarge } from './mqtt.js';
import { StatePublisher } from './publisher.js';
import { TemplateError, payloadVars, render } from './template.js';

const discoveryTopics = (prefix) => [`${prefix}/+/+/config`, `${prefix}/+/+/+/config`];
const cut = (text, max) => (text.length > max ? text.slice(0, max) : text);

/** Publishes on the broker, as a promise (mqtt.js uses a callback). */
const publish = (client, topic, payload, options) =>
  new Promise((resolve, reject) => {
    client.publish(topic, payload, options, (err) => (err ? reject(err) : resolve()));
  });

export class MqttDiscoveryApp {
  constructor({
    gladys,
    logger = createLogger({ name: 'mqtt-discovery' }),
    connect = connectBroker,
    now = Date.now,
    timers = globalThis,
  }) {
    this.gladys = gladys;
    this.logger = logger;
    this.connect = connect;
    this.now = now;
    this.timers = timers;
    this.config = normalizeConfig();
    /** discovery key -> entity { key, component, objectId, config } */
    this.entities = new Map();
    this.model = buildModel(gladys, []);
    this.client = null;
    this.subscribed = new Set();
    /** `${entityKey}|${topic}` -> { value: boolean, at } */
    this.availabilitySeen = new Map();
    /** deviceId -> transport last published */
    this.transports = new Map();
    /** featureId -> last value read, sent when the user creates the device */
    this.lastValues = new Map();
    this.created = new Set();
    this.offTimers = new Map();
    this.rebuildTimer = undefined;
    this.generation = 0;
    this.lastStatus = undefined;
    this.warned = new Set();
    this.publisher = new StatePublisher({ gladys, logger, now, timers });
  }

  // --- Lifecycle -------------------------------------------------------------

  async start(raw = {}) {
    this.stop();
    const generation = this.generation;
    this.config = normalizeConfig(raw);
    this.refreshCreated();
    if (this.config.brokerError) {
      await this.setStatus(
        false,
        this.config.brokerError === 'empty' ? T.notConfigured : T.badUrl(this.config.brokerError),
      );
      return;
    }
    await this.setStatus(false, T.connecting);
    this.publisher.configure({
      intervalSeconds: this.config.sensorInterval,
      throttled: this.model.throttled,
    });
    this.publisher.start();
    const client = this.connect(this.config);
    this.client = client;
    const current = () => generation === this.generation && this.client === client;
    client.on('connect', () => {
      if (current()) {
        this.onConnect().catch((err) => this.logger.error(`After connection: ${err.message}`));
      }
    });
    client.on('message', (topic, payload) => {
      if (current()) {
        this.onMessage(topic, payload);
      }
    });
    client.on('error', (err) => {
      if (current()) {
        const reason = errorReason(err);
        this.logger.warn(`MQTT broker: ${reason}`);
        this.setStatus(false, isRefusal(err) ? T.refused(reason) : T.unreachable(reason));
      }
    });
    client.on('close', () => {
      if (current()) {
        this.subscribed.clear();
        this.publishAllTransports(false).catch(() => {});
      }
    });
  }

  stop() {
    this.generation += 1;
    this.timers.clearTimeout(this.rebuildTimer);
    this.rebuildTimer = undefined;
    for (const timer of this.offTimers.values()) {
      this.timers.clearTimeout(timer);
    }
    this.offTimers.clear();
    this.publisher.stop();
    if (this.client) {
      this.client.removeAllListeners?.();
      this.client.on?.('error', () => {});
      this.client.end(true);
      this.client = null;
    }
    this.subscribed.clear();
  }

  async setStatus(connected, message) {
    const key = JSON.stringify([connected, message ?? null]);
    if (key === this.lastStatus) {
      return;
    }
    this.lastStatus = key;
    await this.gladys
      .setConnectionStatus(connected, message)
      .catch((err) => this.logger.warn(`setConnectionStatus failed: ${err.message}`));
  }

  warnOnce(key, message) {
    if (!this.warned.has(key)) {
      this.warned.add(key);
      this.logger.warn(message);
    }
  }

  async onConnect() {
    this.logger.info(`Connected to ${this.config.brokerUrl}`);
    this.subscribed.clear();
    this.syncSubscriptions();
    await this.setStatus(true, this.statusMessage());
    await this.publishAllTransports(true);
  }

  statusMessage() {
    return this.model.devices.length > 0
      ? T.connected(this.model.devices.length, this.entities.size)
      : T.noAnnouncement(this.config.prefix);
  }

  // --- Subscriptions ---------------------------------------------------------

  wantedTopics() {
    return new Set([
      ...discoveryTopics(this.config.prefix),
      ...this.model.routes.keys(),
      ...this.model.triggerRoutes.keys(),
      ...this.model.availabilityRoutes.keys(),
    ]);
  }

  syncSubscriptions() {
    const client = this.client;
    if (!client?.connected) {
      return;
    }
    const wanted = this.wantedTopics();
    const added = [...wanted].filter((t) => !this.subscribed.has(t));
    const removed = [...this.subscribed].filter((t) => !wanted.has(t));
    if (added.length > 0) {
      client.subscribe(added, { qos: 0 }, (err) => {
        if (err) {
          this.logger.warn(`Subscription failed: ${err.message}`);
        }
      });
    }
    if (removed.length > 0) {
      client.unsubscribe(removed);
    }
    this.subscribed = wanted;
  }

  // --- Messages --------------------------------------------------------------

  onMessage(topic, payload) {
    if (tooLarge(payload)) {
      this.warnOnce(
        `large:${topic}`,
        `Message on ${topic} ignored: larger than ${LIMITS.payloadBytes} bytes`,
      );
      return;
    }
    const info = parseDiscoveryTopic(topic, this.config.prefix);
    if (info) {
      this.onDiscovery(info, payload);
      return;
    }
    const text = Buffer.isBuffer(payload) ? payload.toString('utf8') : String(payload ?? '');
    this.onAvailability(topic, text);
    this.onState(topic, text);
    this.onTrigger(topic, text);
  }

  onDiscovery(info, payload) {
    const result = parseDiscoveryMessage(info, payload);
    if (result.error) {
      this.warnOnce(
        `discovery:${info.key}:${result.error}`,
        `Discovery ${info.key} ignored: ${result.error}`,
      );
      return;
    }
    let changed = false;
    if (result.replacesChildren || result.removesChildren) {
      for (const key of this.entities.keys()) {
        if (key.startsWith(`${info.key}/`)) {
          this.entities.delete(key);
          changed = true;
        }
      }
    }
    for (const key of result.removed) {
      changed = this.entities.delete(key) || changed;
    }
    for (const entity of result.entities) {
      if (!this.entities.has(entity.key) && this.entities.size >= LIMITS.entities) {
        this.warnOnce(
          'too-many',
          `More than ${LIMITS.entities} entities announced: the next ones are ignored`,
        );
        continue;
      }
      const previous = this.entities.get(entity.key);
      if (!previous || JSON.stringify(previous.config) !== JSON.stringify(entity.config)) {
        this.entities.set(entity.key, entity);
        changed = true;
      }
    }
    if (changed) {
      this.scheduleRebuild();
    }
  }

  scheduleRebuild() {
    this.timers.clearTimeout(this.rebuildTimer);
    const generation = this.generation;
    this.rebuildTimer = this.timers.setTimeout(() => {
      this.rebuildTimer = undefined;
      if (generation === this.generation) {
        this.rebuild().catch((err) =>
          this.logger.error(`Rebuilding the devices failed: ${err.message}`),
        );
      }
    }, TIMINGS.rebuildDebounce);
  }

  async rebuild() {
    this.model = buildModel(this.gladys, [...this.entities.values()], {
      ignoreZigbee2mqtt: this.config.ignoreZigbee2mqtt,
    });
    for (const { key, error } of this.model.errors) {
      this.warnOnce(`map:${key}:${error}`, `${key}: ${error}`);
    }
    this.publisher.configure({
      intervalSeconds: this.config.sensorInterval,
      throttled: this.model.throttled,
    });
    this.syncSubscriptions();
    await this.gladys
      .publishDiscoveredDevices(this.model.devices)
      .catch((err) => this.logger.warn(`Publishing the discovered devices failed: ${err.message}`));
    if (this.client?.connected) {
      await this.setStatus(true, this.statusMessage());
    }
    await this.publishAllTransports(Boolean(this.client?.connected));
  }

  onState(topic, text) {
    for (const route of routesFor(this.model.routes, topic)) {
      let states;
      try {
        states = route.read(text);
      } catch (err) {
        if (err instanceof TemplateError) {
          this.warnOnce(
            `tpl:${route.entityKey}:${err.message}`,
            `${route.entityKey}: template error, ${err.message}`,
          );
          continue;
        }
        throw err;
      }
      for (const s of states) {
        const value = s.text !== undefined ? { text: s.text } : { state: s.state };
        this.record(s.featureId, value);
        if (s.offDelay) {
          this.scheduleOff(s.featureId, s.offDelay);
        } else {
          this.cancelOff(s.featureId);
        }
      }
    }
  }

  /** Keeps the value, and sends it when the device exists in Gladys. */
  record(featureId, value) {
    this.lastValues.set(featureId, value);
    if (this.created.has(featureId)) {
      this.publisher.push(featureId, value);
    }
  }

  scheduleOff(featureId, seconds) {
    this.cancelOff(featureId);
    this.offTimers.set(
      featureId,
      this.timers.setTimeout(() => {
        this.offTimers.delete(featureId);
        this.record(featureId, { state: 0 });
      }, seconds * 1000),
    );
  }

  cancelOff(featureId) {
    const timer = this.offTimers.get(featureId);
    if (timer) {
      this.timers.clearTimeout(timer);
      this.offTimers.delete(featureId);
    }
  }

  onTrigger(topic, text) {
    for (const route of routesFor(this.model.triggerRoutes, topic)) {
      let hit;
      try {
        hit = route.match(text);
      } catch (err) {
        if (err instanceof TemplateError) {
          this.warnOnce(
            `tpl:${route.entityKey}:${err.message}`,
            `${route.entityKey}: template error, ${err.message}`,
          );
          continue;
        }
        throw err;
      }
      if (!hit) {
        continue;
      }
      if (this.created.has(hit.featureId)) {
        this.publisher.push(hit.featureId, { state: hit.value });
      }
      this.gladys
        .publishSceneEvent(SCENE_TRIGGERS.DEVICE_TRIGGER, {
          device: route.deviceId,
          type: cut(String(hit.type), LIMITS.eventText),
          subtype: cut(String(hit.subtype), LIMITS.eventText),
          payload: cut(String(hit.payload), LIMITS.eventText),
        })
        .catch((err) => this.logger.warn(`Scene event failed: ${err.message}`));
    }
  }

  onAvailability(topic, text) {
    const routes = routesFor(this.model.availabilityRoutes, topic);
    if (routes.length === 0) {
      return;
    }
    const touched = new Set();
    for (const { deviceId, entityKey, entry } of routes) {
      let value = text;
      if (entry.value_template) {
        try {
          const r = render(entry.value_template, payloadVars(text));
          if (r.skipped) {
            continue;
          }
          value = r.text;
        } catch (err) {
          this.warnOnce(
            `avty:${entityKey}`,
            `${entityKey}: availability template error, ${err.message}`,
          );
          continue;
        }
      }
      const available =
        value === String(entry.payload_available)
          ? true
          : value === String(entry.payload_not_available)
            ? false
            : undefined;
      if (available === undefined) {
        continue;
      }
      // Keyed by the declared topic (a pattern may hide behind a wildcard).
      this.availabilitySeen.set(`${entityKey}|${entry.topic}`, {
        value: available,
        at: this.now(),
      });
      touched.add(deviceId);
    }
    for (const deviceId of touched) {
      this.publishTransport(deviceId).catch((err) =>
        this.logger.warn(`Transport badge failed: ${err.message}`),
      );
    }
  }

  transportOf(deviceId, brokerConnected) {
    if (!brokerConnected) {
      return DEVICE_TRANSPORTS.UNREACHABLE;
    }
    return deviceAvailable(this.model.availability.get(deviceId), this.availabilitySeen)
      ? DEVICE_TRANSPORTS.LOCAL
      : DEVICE_TRANSPORTS.UNREACHABLE;
  }

  async publishTransport(deviceId) {
    if (!this.createdDevices().has(deviceId)) {
      return;
    }
    const transport = this.transportOf(deviceId, Boolean(this.client?.connected));
    if (this.transports.get(deviceId) === transport) {
      return;
    }
    this.transports.set(deviceId, transport);
    await this.gladys.publishTransports([{ external_id: deviceId, transport }]);
  }

  async publishAllTransports(brokerConnected) {
    const entries = [];
    for (const deviceId of this.createdDevices()) {
      if (!this.model.availability.has(deviceId)) {
        continue;
      }
      const transport = this.transportOf(deviceId, brokerConnected);
      if (this.transports.get(deviceId) !== transport) {
        this.transports.set(deviceId, transport);
        entries.push({ external_id: deviceId, transport });
      }
    }
    for (let i = 0; i < entries.length; i += 100) {
      await this.gladys
        .publishTransports(entries.slice(i, i + 100))
        .catch((err) => this.logger.warn(`Transport badges failed: ${err.message}`));
    }
  }

  // --- Devices created by the user ---------------------------------------------

  createdDevices() {
    return new Set((this.gladys.devices ?? []).map((d) => d.external_id));
  }

  refreshCreated() {
    this.created = new Set(
      (this.gladys.devices ?? []).flatMap((d) => (d.features ?? []).map((f) => f.external_id)),
    );
  }

  async deviceCreated(device) {
    this.refreshCreated();
    this.transports.delete(device?.external_id);
    for (const f of device?.features ?? []) {
      const value = this.lastValues.get(f.external_id);
      if (value) {
        this.publisher.push(f.external_id, value);
      }
    }
    if (device?.external_id) {
      await this.publishTransport(device.external_id).catch(() => {});
    }
  }

  async deviceDeleted(device) {
    this.refreshCreated();
    if (device?.external_id) {
      this.transports.delete(device.external_id);
      this.publisher.forget(device.external_id);
    }
  }

  // --- Commands --------------------------------------------------------------

  async setValue(device, feature, value) {
    const client = this.client;
    if (!client?.connected) {
      throw new Error('the MQTT broker is not connected');
    }
    const write = this.model.writers.get(feature.external_id);
    if (!write) {
      throw new Error(`${feature.name ?? feature.external_id} cannot be controlled`);
    }
    const messages = write(value);
    for (const m of messages) {
      await publish(client, m.topic, m.payload, { qos: m.qos, retain: m.retain });
    }
    this.logger.debug(`Sent ${messages.length} message(s) for ${feature.external_id}`);
    if (this.model.optimistic.has(feature.external_id)) {
      this.record(feature.external_id, { state: Number(value) });
    }
  }

  // --- Configuration screen buttons ------------------------------------------

  /** Connects with the saved configuration, reads the retained discovery configs, counts them. */
  testConnection() {
    const config = this.config;
    if (config.brokerError) {
      return Promise.resolve(
        config.brokerError === 'empty' ? T.notConfigured : T.badUrl(config.brokerError),
      );
    }
    return new Promise((resolve) => {
      const seen = new Map();
      let probe;
      let timer;
      const finish = (answer) => {
        this.timers.clearTimeout(timer);
        probe?.removeAllListeners?.();
        probe?.on?.('error', () => {});
        probe?.end(true);
        resolve(answer);
      };
      try {
        probe = this.connect({ ...config });
      } catch (err) {
        finish(T.unreachable(errorReason(err)));
        return;
      }
      timer = this.timers.setTimeout(
        () => finish(T.unreachable('timeout')),
        TIMINGS.connectTimeout + 1000,
      );
      probe.on('error', (err) => {
        const reason = errorReason(err);
        finish(isRefusal(err) ? T.refused(reason) : T.unreachable(reason));
      });
      probe.on('message', (topic, payload) => {
        const info = parseDiscoveryTopic(topic, config.prefix);
        if (info && payload?.length > 0 && !tooLarge(payload)) {
          seen.set(info.key, { info, payload });
        }
      });
      probe.on('connect', () => {
        probe.subscribe(discoveryTopics(config.prefix), { qos: 0 });
        this.timers.clearTimeout(timer);
        timer = this.timers.setTimeout(() => finish(this.testSummary(seen)), TIMINGS.testListen);
      });
    });
  }

  testSummary(seen) {
    if (seen.size === 0) {
      return T.test.empty(this.config.prefix);
    }
    const entities = [...seen.values()].flatMap(
      ({ info, payload }) => parseDiscoveryMessage(info, payload).entities,
    );
    const model = buildModel(this.gladys, entities, {
      ignoreZigbee2mqtt: this.config.ignoreZigbee2mqtt,
    });
    const counts = new Map();
    for (const e of entities) {
      counts.set(e.component, (counts.get(e.component) ?? 0) + 1);
    }
    const components = [...counts.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 8)
      .map(([component, n]) => `${n} ${component}`)
      .join(', ');
    const ok = T.test.ok(entities.length, model.devices.length, components);
    if (model.errors.length === 0) {
      return ok;
    }
    for (const { key, error } of model.errors) {
      this.logger.warn(`${key}: ${error}`);
    }
    const extra = T.test.unsupported(model.errors.length);
    return { en: ok.en + extra.en, fr: ok.fr + extra.fr };
  }

  /** Publishes "online" on <prefix>/status, the birth message devices answer to. */
  async requestAnnounce() {
    const client = this.client;
    if (!client?.connected) {
      return T.notConnected;
    }
    await publish(client, `${this.config.prefix}/status`, 'online', { qos: 0, retain: false });
    return T.announced(this.config.prefix);
  }
}
