# CLAUDE.md

Project rules for coding assistants (Claude Code reads this file) and for
human contributors. Read **[TODO.md](./TODO.md) first**: status, decisions
already taken and the next milestones.

## What this is

A Gladys Assistant **external integration** of type `device`: a Node.js
service (Node 22+, ESM, no build step) in its own sandboxed Docker container,
talking to Gladys through `@gladysassistant/integration-sdk` (v0.15). It
connects to the user's MQTT broker, reads the Home Assistant MQTT discovery
announcements, and turns them into Gladys devices, states, commands and a
`device_trigger` scene trigger. Not affiliated with Home Assistant.

## Commands

```bash
npm install
npm test                                  # node --test, the built-in runner
node --test test/app.test.js              # one file
npm run lint                              # ESLint
npm run format:check                      # Prettier, as the CI runs it
npm run format                            # Prettier, fix in place
npm run audit                             # npm audit --omit=dev
npx github:GladysAssistant/integration-store .   # store admission checks
```

Run `format:check`, `lint`, `test` and `audit` before every commit.

## Architecture

```
index.js            SDK bootstrap only
src/handlers.js     every SDK handler -> the app (shared with the tests)
src/app.js          MqttDiscoveryApp: broker lifecycle, subscriptions,
                    message routing, commands, buttons, transports
src/discovery.js    discovery topics/payloads -> entity configs (pure)
src/mapping.js      entity -> features, readers, writers, triggers (pure)
src/devices.js      entities -> Gladys devices + routing tables (pure)
src/template.js     safe Jinja subset (pure)
src/publisher.js    states within the Gladys rate limit
src/mqtt.js         the only network access (mqtt.js)
src/config.js       config_schema normalized
src/constants.js    manifest keys, limits, timings
src/i18n.js         runtime texts (en/fr)
test/fixtures/      discovery payloads shaped like real firmwares
test/helpers/       a fake mqtt.js client; Gladys is the SDK's fake
```

## Rules

- **External ids are forever**: device = `mqtt:<HA device identifier>`, feature
  = `<entity unique_id>:<key>`. Never change how they are built.
- Manifest keys (`test_connection`, `request_announce`, `device_trigger` and
  its fields) are frozen: users store them.
- Container limits: 256 MB RAM, 0.5 CPU, read-only rootfs, only `/data`
  writable, bridge network (unicast to the LAN only, no USB, no Bluetooth).
- Gladys rate limits: 300 states/min, 300 scene events/min.
- Never log or put in a status message a password or a secret config value.
- Templates are interpreted, never evaluated as code.
- Code, comments, README in English; `docs/en.md` and `docs/fr.md` kept in sync.
