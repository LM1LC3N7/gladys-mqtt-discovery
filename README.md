# gladys-mqtt-discovery

[Gladys Assistant](https://gladysassistant.com) external integration for the
devices that announce themselves on an MQTT broker in the **Home Assistant
MQTT discovery** format: Tasmota (SetOption19 1), ESPHome, OpenBeken, Valetudo,
ESPSomfy RTS, ebusd, EMS-ESP, OpenMQTTGateway and Theengs (Bluetooth sensors),
rtl_433... It connects to the user's broker, turns every announced device into
a Gladys device of the Discovery tab, routes the state messages and sends the
commands back. Not affiliated with Home Assistant.

User documentation: [docs/en.md](docs/en.md) · [docs/fr.md](docs/fr.md).

> Work in progress (0.1, not published to the store yet): announced on the
> [Gladys forum](https://community.gladysassistant.com/t/integrations-home-assistant-les-plus-populaires-candidates-pour-des-integrations-externes-gladys/10385/159).

## How it works

```
Gladys ⇄ SDK ⇄ src/handlers.js ⇄ src/app.js (MqttDiscoveryApp) ⇄ src/mqtt.js ⇄ broker
                                   ├─ src/discovery.js  topics + payloads -> entity configs (pure)
                                   ├─ src/mapping.js    one entity -> features, readers, writers (pure)
                                   ├─ src/devices.js    entities -> Gladys devices + routing tables (pure)
                                   ├─ src/template.js   safe Jinja subset for the templates (pure)
                                   └─ src/publisher.js  states within 300/min, sensor throttling
```

- **Discovery**: subscribes to `<prefix>/+/+/config` and `<prefix>/+/+/+/config`
  (entity and device-based discovery, abbreviated keys, `~` base topic). A
  burst of retained configs is debounced (1.5 s), then the devices are
  published and the state, trigger and availability topics (wildcards included)
  are subscribed to, and only those.
- **Devices**: one Gladys device per HA `device` block (identifiers, else
  connections), one per entity otherwise. External ids come from the device
  identifiers and the entity `unique_id`: stable across restarts.
- **States**: kept per feature, sent only for the devices the user created,
  deduplicated (`publishChangedStates`), budgeted at 250/min, measurements
  throttled to the configured interval. A device created later receives the
  last values read.
- **Commands**: `onSetValue` -> the writer of the feature -> one or more MQTT
  publications (`command_template`, light schemas, `on_command_type`...).
- **Triggers**: `device_automation` and `event` entities fire the
  `device_trigger` scene trigger and update a button feature.
- **Templates** are tokenized, parsed and walked: no `eval`, bounded size and
  steps, Python semantics where devices rely on them.

## Development

```bash
npm install
npm test                                        # node --test, no network
npm run lint && npm run format:check
npm run audit
npx github:GladysAssistant/integration-store .  # store admission checks
```

`test/fixtures/announcements.js` holds discovery payloads shaped like the ones
real firmwares publish. The integration was also run against a real Mosquitto
2 broker (retained configs, states, commands, availability, triggers, both
buttons, removal).

## Releasing

**Actions → Release → Run workflow** (patch / minor / major): bumps the
version in `package.json` and the manifest, rolls `CHANGELOG.md`, tags, builds
the multi-arch image to GHCR and publishes the GitHub Release. The
`gladys-assistant-integration` topic is added at the first real release only.

## License

Apache-2.0.
