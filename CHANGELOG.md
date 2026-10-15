# Changelog

All notable changes to this integration are documented in this file. The format
follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project
uses [semantic versioning](https://semver.org/).

Describe each change under `## [Unreleased]` as you make it. The Release
workflow moves that section under the version it ships, and the section becomes
the notes of the version's GitHub Release.

## [Unreleased]

### Added

- Connection to the user's MQTT broker (mqtt, mqtts, ws, wss; user name and
  password; TLS verification can be turned off for a self-signed broker).
- Home Assistant MQTT discovery: entity and device-based announcements,
  abbreviated keys, `~` base topic, removal by empty payload.
- Devices for `sensor`, `binary_sensor`, `switch`, `light` (default, json and
  template schemas), `cover`, `lock`, `climate`, `fan`, `siren`, `select`,
  `text`, `number`, `button`, `scene`, `event` and `device_automation`.
- The templates of the announcements, interpreted by a safe Jinja subset.
- The availability of the devices on their transport badge.
- The "MQTT device trigger" scene trigger for remotes and device events.
- "Test the connection" and "Ask the devices to announce themselves" buttons.
- Zigbee2MQTT devices left out by default, to avoid duplicates with the Gladys
  Zigbee2MQTT integration.
- Sensor readings throttled to a configurable interval, all states within the
  Gladys rate limit.

[Unreleased]: https://github.com/LM1LC3N7/gladys-mqtt-discovery/commits/main
