// -----------------------------------------------------------------------------
// Discovery announcements shaped like the ones real firmwares publish
// (abbreviated keys, "~" base topics, shared state topics, wildcards), and the
// state messages that go with them.
// -----------------------------------------------------------------------------

const json = (value) => JSON.stringify(value);

/** Tasmota with SetOption19 1 (legacy Home Assistant discovery). */
export const TASMOTA = [
  {
    topic: 'homeassistant/switch/A4CF12_RL_1/config',
    payload: json({
      name: null,
      '~': 'tasmota_A4CF12/',
      cmd_t: '~cmnd/POWER',
      stat_t: '~tele/STATE',
      val_tpl: '{{value_json.POWER}}',
      pl_off: 'OFF',
      pl_on: 'ON',
      avty_t: '~tele/LWT',
      pl_avail: 'Online',
      pl_not_avail: 'Offline',
      uniq_id: 'A4CF12_RL_1',
      dev: {
        ids: ['A4CF12'],
        name: 'Prise salon',
        mdl: 'Sonoff Pow R2',
        sw: '14.2.0',
        mf: 'Tasmota',
      },
    }),
  },
  {
    topic: 'homeassistant/sensor/A4CF12_ENERGY_Power/config',
    payload: json({
      name: 'ENERGY Power',
      stat_t: 'tasmota_A4CF12/tele/SENSOR',
      avty_t: 'tasmota_A4CF12/tele/LWT',
      pl_avail: 'Online',
      pl_not_avail: 'Offline',
      uniq_id: 'A4CF12_ENERGY_Power',
      dev: { ids: ['A4CF12'] },
      unit_of_meas: 'W',
      dev_cla: 'power',
      stat_cla: 'measurement',
      val_tpl: "{{value_json['ENERGY']['Power']}}",
    }),
  },
  {
    topic: 'homeassistant/sensor/A4CF12_ENERGY_Total/config',
    payload: json({
      name: 'ENERGY Total',
      stat_t: 'tasmota_A4CF12/tele/SENSOR',
      uniq_id: 'A4CF12_ENERGY_Total',
      dev: { ids: ['A4CF12'] },
      unit_of_meas: 'kWh',
      dev_cla: 'energy',
      stat_cla: 'total_increasing',
      val_tpl: "{{value_json['ENERGY']['Total']}}",
    }),
  },
];

/** ESPHome: plain payloads, JSON light, device identifiers as a string. */
export const ESPHOME = [
  {
    topic: 'homeassistant/sensor/salon/temperature/config',
    payload: json({
      dev_cla: 'temperature',
      unit_of_meas: '°C',
      stat_cla: 'measurement',
      name: 'Temperature',
      stat_t: 'salon/sensor/temperature/state',
      avty_t: 'salon/status',
      uniq_id: 'ESPsensortemperature',
      dev: {
        ids: 'a4cf12e0d1c2',
        name: 'salon',
        sw: 'esphome v2025.9.0',
        mdl: 'esp32dev',
        mf: 'espressif',
      },
    }),
  },
  {
    topic: 'homeassistant/light/salon/led/config',
    payload: json({
      name: 'LED',
      stat_t: 'salon/light/led/state',
      cmd_t: 'salon/light/led/command',
      avty_t: 'salon/status',
      schema: 'json',
      brightness: true,
      sup_clrm: ['rgb', 'color_temp'],
      min_mirs: 153,
      max_mirs: 370,
      uniq_id: 'ESPlightled',
      dev: { ids: 'a4cf12e0d1c2', name: 'salon' },
    }),
  },
  {
    topic: 'homeassistant/sensor/salon/uptime/config',
    payload: json({
      name: 'Uptime',
      stat_t: 'salon/sensor/uptime/state',
      uniq_id: 'ESPsensoruptime',
      ent_cat: 'diagnostic',
      en: false,
      dev: { ids: 'a4cf12e0d1c2', name: 'salon' },
    }),
  },
];

/** OpenMQTTGateway: one wildcard topic shared by the entities of a BLE sensor. */
export const OPENMQTTGATEWAY = [
  {
    topic: 'homeassistant/sensor/A4C138AABBCC-tempc/config',
    payload: json({
      stat_t: '+/+/BTtoMQTT/A4C138AABBCC',
      dev_cla: 'temperature',
      unit_of_meas: '°C',
      name: 'temp',
      uniq_id: 'A4C138AABBCC-tempc',
      val_tpl: '{{ value_json.tempc | is_defined }}',
      stat_cla: 'measurement',
      dev: {
        ids: ['A4C138AABBCC'],
        cns: [['mac', 'A4C138AABBCC']],
        mf: 'Xiaomi',
        mdl: 'LYWSD03MMC',
        name: 'LYWSD03MMC-AABBCC',
        via_device: 'OMG_ESP32',
      },
    }),
  },
  {
    topic: 'homeassistant/sensor/A4C138AABBCC-hum/config',
    payload: json({
      stat_t: '+/+/BTtoMQTT/A4C138AABBCC',
      dev_cla: 'humidity',
      unit_of_meas: '%',
      name: 'hum',
      uniq_id: 'A4C138AABBCC-hum',
      val_tpl: '{{ value_json.hum | is_defined }}',
      dev: { ids: ['A4C138AABBCC'] },
    }),
  },
];

/** Device-based discovery (Home Assistant 2024.11): shared state topic, `cmps`. */
export const DEVICE_BASED = [
  {
    topic: 'homeassistant/device/heater01/config',
    payload: json({
      dev: { ids: 'heater01', name: 'Chaudière', mf: 'Saunier Duval' },
      o: { name: 'ebusd', sw: '25.1' },
      stat_t: 'ebusd/heater/state',
      cmps: {
        flow: {
          p: 'sensor',
          name: 'Flow temperature',
          dev_cla: 'temperature',
          unit_of_meas: '°C',
          val_tpl: '{{ value_json.flow }}',
          uniq_id: 'heater01_flow',
        },
        pump: {
          p: 'binary_sensor',
          name: 'Pump',
          dev_cla: 'running',
          val_tpl: '{{ value_json.pump }}',
          pl_on: 'on',
          pl_off: 'off',
          uniq_id: 'heater01_pump',
        },
      },
    }),
  },
];

export const COVER = {
  topic: 'homeassistant/cover/shutter1/config',
  payload: json({
    name: 'Volet salon',
    uniq_id: 'shutter1',
    cmd_t: 'shutter/1/set',
    stat_t: 'shutter/1/state',
    pos_t: 'shutter/1/position',
    set_pos_t: 'shutter/1/position/set',
    dev_cla: 'shutter',
  }),
};

export const CLIMATE = {
  topic: 'homeassistant/climate/th1/config',
  payload: json({
    name: 'Thermostat',
    uniq_id: 'th1',
    curr_temp_t: 'th1/current',
    temp_cmd_t: 'th1/target/set',
    temp_stat_t: 'th1/target',
    mode_cmd_t: 'th1/mode/set',
    mode_stat_t: 'th1/mode',
    modes: ['off', 'heat'],
    pr_mode_cmd_t: 'th1/preset/set',
    pr_mode_stat_t: 'th1/preset',
    pr_modes: ['eco', 'comfort', 'boost'],
    min_temp: 5,
    max_temp: 30,
    temp_step: 0.5,
  }),
};

export const REMOTE = [
  {
    topic: 'homeassistant/device_automation/remote1/single/config',
    payload: json({
      atype: 'trigger',
      type: 'button_short_press',
      stype: 'button_1',
      pl: 'single',
      t: 'remote1/action',
      dev: { ids: ['remote1'], name: 'Télécommande' },
    }),
  },
  {
    topic: 'homeassistant/device_automation/remote1/hold/config',
    payload: json({
      atype: 'trigger',
      type: 'button_long_press',
      stype: 'button_1',
      pl: 'hold',
      t: 'remote1/action',
      dev: { ids: ['remote1'], name: 'Télécommande' },
    }),
  },
];

export const ZIGBEE2MQTT = {
  topic: 'homeassistant/sensor/0x00158d0001a2b3c4/temperature/config',
  payload: json({
    name: 'Temperature',
    stat_t: 'zigbee2mqtt/bedroom',
    val_tpl: '{{ value_json.temperature }}',
    unit_of_meas: '°C',
    dev_cla: 'temperature',
    uniq_id: '0x00158d0001a2b3c4_temperature_zigbee2mqtt',
    o: { name: 'Zigbee2MQTT', sw: '2.6.0' },
    dev: { ids: ['zigbee2mqtt_0x00158d0001a2b3c4'], name: 'bedroom' },
  }),
};

export const DOORBELL = {
  topic: 'homeassistant/binary_sensor/rf_doorbell/config',
  payload: json({
    name: 'Sonnette',
    uniq_id: 'rf_doorbell',
    stat_t: 'rf/received',
    val_tpl: '{{ value_json.Data }}',
    pl_on: 'A1B2C3',
    pl_off: 'never',
    off_dly: 5,
    dev_cla: 'motion',
  }),
};

export const SELECT = {
  topic: 'homeassistant/select/vmc/mode/config',
  payload: json({
    name: 'Mode VMC',
    uniq_id: 'vmc_mode',
    cmd_t: 'vmc/mode/set',
    stat_t: 'vmc/mode',
    ops: ['eco', 'comfort', 'boost'],
  }),
};

export const ALL = [
  ...TASMOTA,
  ...ESPHOME,
  ...OPENMQTTGATEWAY,
  ...DEVICE_BASED,
  COVER,
  CLIMATE,
  ...REMOTE,
  ZIGBEE2MQTT,
  DOORBELL,
  SELECT,
];
