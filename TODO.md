# TODO — MQTT Discovery v1

Handoff document: what is done, what was decided, what comes next. Keep it
up to date at the end of every milestone.

## Withdrawn (2026-10-15)

The integration duplicates a Gladys core feature: since Gladys 4.86 (PR
GladysAssistant/Gladys#2805, August 2026) the built-in MQTT integration reads
`homeassistant/#` and offers the devices in its Discovery tab (sensor,
binary_sensor, switch, light, cover, lock, climate, button). It was in the
forum's list of candidate modules (P1 no. 110), picked on 2026-10-15, and
withdrawn the same day after review (forum topic 10385, posts 159, 168, 178
struck through). The `gladys-assistant-integration` topic is removed; the
milestones below are abandoned.

What this code does beyond the core, should someone want to contribute it to
Gladys instead: a safe Jinja subset for the templates, `command_template`,
the `availability` topics, a configurable discovery prefix, the Zigbee2MQTT
filter, `device_automation`/`event` as a scene trigger, and the `fan`,
`number`, `scene`, `select`, `siren` and `text` components.

## Working method

- One milestone at a time, one commit per milestone, tests green before moving on.
- After each milestone: `npm run format:check`, `npm run lint`, `npm test`,
  `npm audit`, then update README, `docs/en.md`, `docs/fr.md`, `CHANGELOG.md`
  and this file.
- The `gladys-assistant-integration` topic is added at the first real release
  only (before, the store would list an empty integration).

## Status

- [x] **Milestone 1 — core** (2026-10-15): discovery (entity + device-based,
      abbreviations, `~`), safe Jinja subset, mapping of 16 components,
      device grouping, routing (wildcards), states within the rate limit,
      commands, availability badge, `device_trigger`, both buttons, manifest,
      docs en/fr. 72 unit tests; run against a real Mosquitto 2 broker.
- [ ] **Milestone 2 — real devices**: collect announcements from testers
      (Tasmota, ESPHome, OpenBeken, Valetudo, ESPSomfy RTS, ebusd, EMS-ESP,
      OpenMQTTGateway, Theengs, rtl_433) as fixtures; fix what differs.
- [ ] **Milestone 3 — more components**: `vacuum` (Valetudo), `alarm_control_panel`,
      `water_heater`, `humidifier`, `valve`, `device_tracker`, `camera` (MQTT image),
      `json_attributes_topic` as text features (opt-in).
- [ ] **Milestone 4 — first release**: cover image, Docker image build check,
      `npx github:GladysAssistant/integration-store .`, Release workflow,
      topic, GHCR package public.

## Forum

No dedicated topic for this integration. Once the 10 integrations claimed on
2026-10-15 are published, a single recap message in the general thread
(/t/10385) lists each of them with its version and capabilities.

## Decisions

- One Gladys device per HA `device` block; entities without one are devices of
  their own. `enabled_by_default: false` entities are skipped.
- Power/energy/voltage/current of a device that has a switch or a light are
  `switch` features (like the core Zigbee2MQTT mapping); a meter's are
  `energy-sensor` ones, a `total`/`total_increasing` energy being an `index`.
- Zigbee2MQTT announcements are skipped by default (Gladys has its own
  integration).
- States are only sent for the devices the user created; the last value read
  is sent at creation.
- Retained configs removed while the integration was disconnected stay known
  until an empty config arrives (non-retained announcements must not vanish on
  a reconnection).
- `<prefix>/status` = `online` is only published on demand (button), never at
  startup: a Home Assistant may share the broker.
