// A fake mqtt.js client: what the app subscribed to and published, and the
// broker side (connect, deliver a message, fail).

import { EventEmitter } from 'node:events';

export class FakeMqttClient extends EventEmitter {
  constructor(config) {
    super();
    this.config = config;
    this.connected = false;
    this.subscriptions = new Set();
    this.published = [];
    this.ended = false;
  }

  subscribe(topics, options, callback) {
    for (const topic of [].concat(topics)) {
      this.subscriptions.add(topic);
    }
    callback?.(null, []);
  }

  unsubscribe(topics) {
    for (const topic of [].concat(topics)) {
      this.subscriptions.delete(topic);
    }
  }

  publish(topic, payload, options, callback) {
    this.published.push({ topic, payload: String(payload), ...options });
    callback?.();
  }

  end() {
    this.ended = true;
    this.connected = false;
  }

  // --- The broker side ---
  open() {
    this.connected = true;
    this.emit('connect');
  }

  close() {
    this.connected = false;
    this.emit('close');
  }

  deliver(topic, payload) {
    this.emit('message', topic, Buffer.from(payload));
  }
}

/** A connect function for the app, keeping every client it creates. */
export function fakeConnector() {
  const clients = [];
  const connect = (config) => {
    const client = new FakeMqttClient(config);
    clients.push(client);
    return client;
  };
  return { clients, connect };
}

/** Lets the pending promises settle (no timer involved). */
export const settle = async (rounds = 10) => {
  for (let i = 0; i < rounds; i += 1) {
    await new Promise((resolve) => setImmediate(resolve));
  }
};
