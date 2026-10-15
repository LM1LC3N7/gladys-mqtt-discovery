import { parseDiscoveryMessage, parseDiscoveryTopic } from '../../src/discovery.js';

/** The entities announced by fixture messages, as the app keeps them. */
export function entitiesOf(messages, prefix = 'homeassistant') {
  const entities = new Map();
  for (const { topic, payload } of messages) {
    const info = parseDiscoveryTopic(topic, prefix);
    const result = parseDiscoveryMessage(info, payload);
    for (const key of result.removed) {
      entities.delete(key);
    }
    for (const entity of result.entities) {
      entities.set(entity.key, entity);
    }
  }
  return [...entities.values()];
}
