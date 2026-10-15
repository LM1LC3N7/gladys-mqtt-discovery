// -----------------------------------------------------------------------------
// Keys shared with the manifest (frozen: users store them in their scenes and
// configuration) and the tuning of the integration.
// -----------------------------------------------------------------------------

/** Manifest `actions` keys. */
export const ACTIONS = {
  TEST: 'test_connection',
  ANNOUNCE: 'request_announce',
};

/** Manifest `scene_triggers` keys. */
export const SCENE_TRIGGERS = {
  DEVICE_TRIGGER: 'device_trigger',
};

/** Sensor throttling bounds (seconds), mirrored by the manifest. */
export const SENSOR_INTERVAL = { min: 0, max: 300, default: 10 };

export const LIMITS = {
  /** Gladys accepts 300 states per minute: keep a margin for the other paths. */
  statesPerMinute: 250,
  /** Gladys accepts 300 scene events per minute. */
  eventsPerMinute: 250,
  /** Discovery configs kept in memory (one per entity). */
  entities: 5000,
  /** Size of a discovery or state payload read (bytes). */
  payloadBytes: 256 * 1024,
  /** Scene event strings. */
  eventText: 1000,
};

export const TIMINGS = {
  /** Discovery messages arrive in bursts (retained configs): wait for the burst to end. */
  rebuildDebounce: 1500,
  /** The pending states are sent at this pace. */
  flushInterval: 1000,
  /** An unchanged value is re-sent this often, so it stays recently dated in Gladys. */
  stateHeartbeat: 30 * 60_000,
  /** How long the connection test listens to the retained discovery configs. */
  testListen: 3000,
  /** Broker connection timeout. */
  connectTimeout: 10_000,
  /** Delay between two reconnection attempts. */
  reconnectPeriod: 5000,
};
