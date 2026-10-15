// -----------------------------------------------------------------------------
// Home Assistant MQTT discovery messages -> normalized entity configs (pure).
//
//   <prefix>/<component>/[<node_id>/]<object_id>/config   one entity
//   <prefix>/device/<object_id>/config                    one device, its
//                                                         entities in `cmps`
//
// Payloads may use the abbreviated keys of Home Assistant ("stat_t" for
// "state_topic", "dev" for "device"...) and the "~" base topic. An empty
// payload removes what the topic announced. The tables below mirror
// homeassistant/components/mqtt/abbreviations.py.
// -----------------------------------------------------------------------------

export const ABBREVIATIONS = {
  act_t: 'action_topic',
  act_tpl: 'action_template',
  atype: 'automation_type',
  avty: 'availability',
  avty_mode: 'availability_mode',
  avty_t: 'availability_topic',
  avty_tpl: 'availability_template',
  away_mode_cmd_t: 'away_mode_command_topic',
  away_mode_stat_t: 'away_mode_state_topic',
  away_mode_stat_tpl: 'away_mode_state_template',
  b_tpl: 'blue_template',
  bri_cmd_t: 'brightness_command_topic',
  bri_cmd_tpl: 'brightness_command_template',
  bri_scl: 'brightness_scale',
  bri_stat_t: 'brightness_state_topic',
  bri_tpl: 'brightness_template',
  bri_val_tpl: 'brightness_value_template',
  clr_temp_cmd_tpl: 'color_temp_command_template',
  clr_temp_cmd_t: 'color_temp_command_topic',
  clr_temp_k: 'color_temp_kelvin',
  clr_temp_stat_t: 'color_temp_state_topic',
  clr_temp_tpl: 'color_temp_template',
  clr_temp_val_tpl: 'color_temp_value_template',
  clrm: 'color_mode',
  clrm_stat_t: 'color_mode_state_topic',
  clrm_val_tpl: 'color_mode_value_template',
  cmd_off_tpl: 'command_off_template',
  cmd_on_tpl: 'command_on_template',
  cmd_t: 'command_topic',
  cmd_tpl: 'command_template',
  cmps: 'components',
  cod_arm_req: 'code_arm_required',
  cod_dis_req: 'code_disarm_required',
  cod_form: 'code_format',
  cod_trig_req: 'code_trigger_required',
  cont_type: 'content_type',
  curr_hum_t: 'current_humidity_topic',
  curr_hum_tpl: 'current_humidity_template',
  curr_temp_t: 'current_temperature_topic',
  curr_temp_tpl: 'current_temperature_template',
  def_ent_id: 'default_entity_id',
  dev: 'device',
  dev_cla: 'device_class',
  dir_cmd_t: 'direction_command_topic',
  dir_cmd_tpl: 'direction_command_template',
  dir_stat_t: 'direction_state_topic',
  dir_val_tpl: 'direction_value_template',
  dsp_prc: 'display_precision',
  e: 'encoding',
  en: 'enabled_by_default',
  ent_cat: 'entity_category',
  ent_pic: 'entity_picture',
  evt_typ: 'event_types',
  exp_aft: 'expire_after',
  fanspd_lst: 'fan_speed_list',
  flsh_tlng: 'flash_time_long',
  flsh_tsht: 'flash_time_short',
  fx_cmd_t: 'effect_command_topic',
  fx_cmd_tpl: 'effect_command_template',
  fx_list: 'effect_list',
  fx_stat_t: 'effect_state_topic',
  fx_tpl: 'effect_template',
  fx_val_tpl: 'effect_value_template',
  fan_mode_cmd_tpl: 'fan_mode_command_template',
  fan_mode_cmd_t: 'fan_mode_command_topic',
  fan_mode_stat_tpl: 'fan_mode_state_template',
  fan_mode_stat_t: 'fan_mode_state_topic',
  frc_upd: 'force_update',
  g_tpl: 'green_template',
  hs_cmd_t: 'hs_command_topic',
  hs_cmd_tpl: 'hs_command_template',
  hs_stat_t: 'hs_state_topic',
  hs_val_tpl: 'hs_value_template',
  ic: 'icon',
  init: 'initial',
  hum_cmd_t: 'target_humidity_command_topic',
  hum_cmd_tpl: 'target_humidity_command_template',
  hum_stat_t: 'target_humidity_state_topic',
  hum_state_tpl: 'target_humidity_state_template',
  json_attr: 'json_attributes',
  json_attr_t: 'json_attributes_topic',
  json_attr_tpl: 'json_attributes_template',
  l_ver_t: 'latest_version_topic',
  l_ver_tpl: 'latest_version_template',
  lrst_t: 'last_reset_topic',
  lrst_val_tpl: 'last_reset_value_template',
  max: 'max',
  min: 'min',
  max_hum: 'max_humidity',
  min_hum: 'min_humidity',
  max_k: 'max_kelvin',
  min_k: 'min_kelvin',
  max_mirs: 'max_mireds',
  min_mirs: 'min_mireds',
  max_temp: 'max_temp',
  min_temp: 'min_temp',
  migr_discvry: 'migrate_discovery',
  mode: 'mode',
  mode_cmd_tpl: 'mode_command_template',
  mode_cmd_t: 'mode_command_topic',
  mode_stat_tpl: 'mode_state_template',
  mode_stat_t: 'mode_state_topic',
  modes: 'modes',
  name: 'name',
  o: 'origin',
  obj_id: 'object_id',
  off_dly: 'off_delay',
  on_cmd_type: 'on_command_type',
  ops: 'options',
  opt: 'optimistic',
  osc_cmd_t: 'oscillation_command_topic',
  osc_cmd_tpl: 'oscillation_command_template',
  osc_stat_t: 'oscillation_state_topic',
  osc_val_tpl: 'oscillation_value_template',
  p: 'platform',
  pct_cmd_t: 'percentage_command_topic',
  pct_cmd_tpl: 'percentage_command_template',
  pct_stat_t: 'percentage_state_topic',
  pct_val_tpl: 'percentage_value_template',
  pl: 'payload',
  pl_arm_away: 'payload_arm_away',
  pl_arm_custom_b: 'payload_arm_custom_bypass',
  pl_arm_home: 'payload_arm_home',
  pl_arm_nite: 'payload_arm_night',
  pl_arm_vacation: 'payload_arm_vacation',
  pl_avail: 'payload_available',
  pl_cln_sp: 'payload_clean_spot',
  pl_cls: 'payload_close',
  pl_dir_fwd: 'payload_direction_forward',
  pl_dir_rev: 'payload_direction_reverse',
  pl_disarm: 'payload_disarm',
  pl_home: 'payload_home',
  pl_inst: 'payload_install',
  pl_loc: 'payload_locate',
  pl_lock: 'payload_lock',
  pl_not_avail: 'payload_not_available',
  pl_not_home: 'payload_not_home',
  pl_off: 'payload_off',
  pl_on: 'payload_on',
  pl_open: 'payload_open',
  pl_osc_off: 'payload_oscillation_off',
  pl_osc_on: 'payload_oscillation_on',
  pl_paus: 'payload_pause',
  pl_prs: 'payload_press',
  pl_ret: 'payload_return_to_base',
  pl_rst: 'payload_reset',
  pl_rst_hum: 'payload_reset_humidity',
  pl_rst_mode: 'payload_reset_mode',
  pl_rst_pct: 'payload_reset_percentage',
  pl_rst_pr_mode: 'payload_reset_preset_mode',
  pl_stop: 'payload_stop',
  pl_stop_tilt: 'payload_stop_tilt',
  pl_strt: 'payload_start',
  pl_toff: 'payload_turn_off',
  pl_ton: 'payload_turn_on',
  pl_trig: 'payload_trigger',
  pl_unlk: 'payload_unlock',
  pos: 'reports_position',
  pos_clsd: 'position_closed',
  pos_open: 'position_open',
  pos_t: 'position_topic',
  pos_tpl: 'position_template',
  pow_cmd_t: 'power_command_topic',
  pow_cmd_tpl: 'power_command_template',
  pr_mode_cmd_t: 'preset_mode_command_topic',
  pr_mode_cmd_tpl: 'preset_mode_command_template',
  pr_mode_stat_t: 'preset_mode_state_topic',
  pr_mode_val_tpl: 'preset_mode_value_template',
  pr_modes: 'preset_modes',
  ptrn: 'pattern',
  r_tpl: 'red_template',
  rel_s: 'release_summary',
  rel_u: 'release_url',
  ret: 'retain',
  rgb_cmd_t: 'rgb_command_topic',
  rgb_cmd_tpl: 'rgb_command_template',
  rgb_stat_t: 'rgb_state_topic',
  rgb_val_tpl: 'rgb_value_template',
  rgbw_cmd_t: 'rgbw_command_topic',
  rgbw_cmd_tpl: 'rgbw_command_template',
  rgbw_stat_t: 'rgbw_state_topic',
  rgbw_val_tpl: 'rgbw_value_template',
  rgbww_cmd_t: 'rgbww_command_topic',
  rgbww_cmd_tpl: 'rgbww_command_template',
  rgbww_stat_t: 'rgbww_state_topic',
  rgbww_val_tpl: 'rgbww_value_template',
  send_cmd_t: 'send_command_topic',
  send_if_off: 'send_if_off',
  set_fan_spd_t: 'set_fan_speed_topic',
  set_pos_t: 'set_position_topic',
  set_pos_tpl: 'set_position_template',
  sfx_cmd_t: 'swing_horizontal_mode_command_topic',
  spd_rng_max: 'speed_range_max',
  spd_rng_min: 'speed_range_min',
  src_type: 'source_type',
  stat_cla: 'state_class',
  stat_clsd: 'state_closed',
  stat_closing: 'state_closing',
  stat_jam: 'state_jammed',
  stat_locked: 'state_locked',
  stat_locking: 'state_locking',
  stat_off: 'state_off',
  stat_on: 'state_on',
  stat_open: 'state_open',
  stat_opening: 'state_opening',
  stat_stopped: 'state_stopped',
  stat_unlocked: 'state_unlocked',
  stat_unlocking: 'state_unlocking',
  stat_t: 'state_topic',
  stat_tpl: 'state_template',
  stat_val_tpl: 'state_value_template',
  step: 'step',
  stype: 'subtype',
  sug_dsp_prc: 'suggested_display_precision',
  sup_clrm: 'supported_color_modes',
  sup_dur: 'support_duration',
  sup_feat: 'supported_features',
  sup_vol: 'support_volume_set',
  swing_mode_cmd_tpl: 'swing_mode_command_template',
  swing_mode_cmd_t: 'swing_mode_command_topic',
  swing_mode_stat_tpl: 'swing_mode_state_template',
  swing_mode_stat_t: 'swing_mode_state_topic',
  swing_modes: 'swing_modes',
  t: 'topic',
  temp_cmd_tpl: 'temperature_command_template',
  temp_cmd_t: 'temperature_command_topic',
  temp_hi_cmd_tpl: 'temperature_high_command_template',
  temp_hi_cmd_t: 'temperature_high_command_topic',
  temp_hi_stat_tpl: 'temperature_high_state_template',
  temp_hi_stat_t: 'temperature_high_state_topic',
  temp_lo_cmd_tpl: 'temperature_low_command_template',
  temp_lo_cmd_t: 'temperature_low_command_topic',
  temp_lo_stat_tpl: 'temperature_low_state_template',
  temp_lo_stat_t: 'temperature_low_state_topic',
  temp_stat_tpl: 'temperature_state_template',
  temp_stat_t: 'temperature_state_topic',
  temp_unit: 'temperature_unit',
  tilt_clsd_val: 'tilt_closed_value',
  tilt_cmd_t: 'tilt_command_topic',
  tilt_cmd_tpl: 'tilt_command_template',
  tilt_inv_stat: 'tilt_invert_state',
  tilt_max: 'tilt_max',
  tilt_min: 'tilt_min',
  tilt_opnd_val: 'tilt_opened_value',
  tilt_opt: 'tilt_optimistic',
  tilt_status_t: 'tilt_status_topic',
  tilt_status_tpl: 'tilt_status_template',
  tit: 'title',
  trns: 'transition',
  uniq_id: 'unique_id',
  unit_of_meas: 'unit_of_measurement',
  url_t: 'url_topic',
  url_tpl: 'url_template',
  val_tpl: 'value_template',
  whit_cmd_t: 'white_command_topic',
  whit_scl: 'white_scale',
  xy_cmd_t: 'xy_command_topic',
  xy_cmd_tpl: 'xy_command_template',
  xy_stat_t: 'xy_state_topic',
  xy_val_tpl: 'xy_value_template',
};

export const DEVICE_ABBREVIATIONS = {
  cns: 'connections',
  cu: 'configuration_url',
  hw: 'hw_version',
  ids: 'identifiers',
  mdl: 'model',
  mdl_id: 'model_id',
  mf: 'manufacturer',
  name: 'name',
  sa: 'suggested_area',
  sn: 'serial_number',
  sw: 'sw_version',
};

export const ORIGIN_ABBREVIATIONS = {
  name: 'name',
  sw: 'sw_version',
  url: 'support_url',
};

/** The MQTT platforms of Home Assistant, as they appear in discovery topics. */
export const COMPONENTS = [
  'alarm_control_panel',
  'binary_sensor',
  'button',
  'camera',
  'climate',
  'cover',
  'device_automation',
  'device_tracker',
  'event',
  'fan',
  'humidifier',
  'image',
  'lawn_mower',
  'light',
  'lock',
  'notify',
  'number',
  'scene',
  'select',
  'sensor',
  'siren',
  'switch',
  'tag',
  'text',
  'update',
  'vacuum',
  'valve',
  'water_heater',
];

const ID = '[a-zA-Z0-9_-]+';

/**
 * Parses a discovery topic.
 * @returns {{ component, nodeId, objectId, key } | null} `key` identifies what
 * the topic announces, null for a topic that is not a discovery config.
 */
export function parseDiscoveryTopic(topic, prefix) {
  if (typeof topic !== 'string' || !topic.startsWith(`${prefix}/`)) {
    return null;
  }
  const rest = topic.slice(prefix.length + 1);
  const match = new RegExp(`^(${ID})/(?:(${ID})/)?(${ID})/config$`).exec(rest);
  if (!match) {
    return null;
  }
  const [, component, nodeId, objectId] = match;
  if (component !== 'device' && !COMPONENTS.includes(component)) {
    return null;
  }
  return {
    component,
    nodeId: nodeId ?? null,
    objectId,
    key: nodeId ? `${component}/${nodeId}/${objectId}` : `${component}/${objectId}`,
  };
}

function expandKeys(object, table) {
  const out = {};
  for (const [key, value] of Object.entries(object)) {
    out[table[key] ?? key] = value;
  }
  return out;
}

/** Applies the "~" base topic to every *topic key (HA: starts or ends with "~"). */
function applyBaseTopic(config, base) {
  if (typeof base !== 'string') {
    return config;
  }
  const replace = (value) => {
    if (typeof value !== 'string') {
      return value;
    }
    if (value.startsWith('~')) {
      return base + value.slice(1);
    }
    if (value.endsWith('~')) {
      return value.slice(0, -1) + base;
    }
    return value;
  };
  const out = { ...config };
  for (const [key, value] of Object.entries(out)) {
    if (key === 'topic' || key.endsWith('_topic')) {
      out[key] = replace(value);
    }
  }
  if (Array.isArray(out.availability)) {
    out.availability = out.availability.map((a) =>
      a && typeof a === 'object' ? { ...a, topic: replace(a.topic) } : a,
    );
  }
  return out;
}

/** Expands the abbreviations of one entity config (and of its device and origin blocks). */
export function expandConfig(raw) {
  const config = expandKeys(raw, ABBREVIATIONS);
  if (config.device && typeof config.device === 'object') {
    config.device = expandKeys(config.device, DEVICE_ABBREVIATIONS);
  }
  if (config.origin && typeof config.origin === 'object') {
    config.origin = expandKeys(config.origin, ORIGIN_ABBREVIATIONS);
  }
  if (Array.isArray(config.availability)) {
    config.availability = config.availability
      .filter((a) => a && typeof a === 'object')
      .map((a) => expandKeys(a, ABBREVIATIONS));
  }
  return applyBaseTopic(config, config['~']);
}

/** The availability of an entity, normalized to a list of checks. */
export function availabilityOf(config) {
  const entries = [];
  if (typeof config.availability_topic === 'string') {
    entries.push({
      topic: config.availability_topic,
      payload_available: config.payload_available ?? 'online',
      payload_not_available: config.payload_not_available ?? 'offline',
      value_template: config.availability_template,
    });
  }
  for (const a of config.availability ?? []) {
    if (typeof a.topic === 'string') {
      entries.push({
        topic: a.topic,
        payload_available: a.payload_available ?? 'online',
        payload_not_available: a.payload_not_available ?? 'offline',
        value_template: a.value_template,
      });
    }
  }
  return { entries, mode: config.availability_mode ?? 'latest' };
}

const parseJson = (payload) => {
  try {
    const value = JSON.parse(payload);
    return value && typeof value === 'object' && !Array.isArray(value) ? value : null;
  } catch {
    return null;
  }
};

/**
 * Turns one discovery message into the entity configs it announces.
 * @returns {{ removed: string[], entities: object[], error?: string }}
 *   `removed`: the entity keys to forget; `entities`: { key, component,
 *   objectId, config } to (re)declare. A device message replaces all the
 *   components it held before: the caller forgets `${key}/` + anything.
 */
export function parseDiscoveryMessage(topicInfo, payload) {
  const text = Buffer.isBuffer(payload) ? payload.toString('utf8') : String(payload ?? '');
  if (text.trim() === '') {
    return {
      removed: [topicInfo.key],
      entities: [],
      removesChildren: topicInfo.component === 'device',
    };
  }
  const raw = parseJson(text);
  if (!raw) {
    return { removed: [], entities: [], error: 'payload is not a JSON object' };
  }
  if (topicInfo.component !== 'device') {
    return {
      removed: [],
      entities: [
        {
          key: topicInfo.key,
          component: topicInfo.component,
          objectId: topicInfo.objectId,
          nodeId: topicInfo.nodeId,
          config: expandConfig(raw),
        },
      ],
    };
  }
  // Device-based discovery: shared options at the root, one entry per component.
  const root = expandKeys(raw, ABBREVIATIONS);
  const components = root.components;
  if (!components || typeof components !== 'object') {
    return { removed: [], entities: [], error: 'device discovery without components' };
  }
  const shared = { ...root };
  delete shared.components;
  const entities = [];
  const removed = [];
  for (const [id, componentRaw] of Object.entries(components)) {
    if (!componentRaw || typeof componentRaw !== 'object' || !/^[a-zA-Z0-9_-]+$/.test(id)) {
      continue;
    }
    const merged = expandConfig({ ...shared, ...componentRaw });
    const key = `${topicInfo.key}/${id}`;
    const component = merged.platform;
    // A component reduced to its platform is a removal (HA 2024.11 contract).
    if (Object.keys(componentRaw).every((k) => k === 'p' || k === 'platform')) {
      removed.push(key);
      continue;
    }
    if (!COMPONENTS.includes(component)) {
      continue;
    }
    delete merged.platform;
    entities.push({ key, component, objectId: id, nodeId: topicInfo.objectId, config: merged });
  }
  return { removed, entities, replacesChildren: true };
}
