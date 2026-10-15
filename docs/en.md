# MQTT Discovery (Home Assistant format)

> **Withdrawn: use the MQTT integration of Gladys instead.** Since Gladys 4.86,
> the built-in MQTT integration reads the Home Assistant discovery
> announcements of its broker and offers the devices in its Discovery tab.
> This integration duplicated that feature: it is no longer listed in the
> store. If you installed it, uninstall it, otherwise every device would show
> up twice.

Many firmwares and bridges **announce themselves** on an MQTT broker in the
Home Assistant discovery format: each device publishes the description of its
sensors and commands under `homeassistant/…/config`. This integration connects
to **your** broker, reads those announcements and offers every device in the
**Discovery** tab of Gladys, ready to be added. Not affiliated with Home
Assistant: only the message format is shared.

> **Development version (0.1).** Developed and tested against a real Mosquitto
> broker with simulated Tasmota, ESPHome, OpenMQTTGateway and ebusd
> announcements, not yet with every firmware. Your feedback (and the
> announcements of your devices) are welcome on the GitHub repository.

## What you get

| Home Assistant component     | In Gladys                                                                                     |
| ---------------------------- | --------------------------------------------------------------------------------------------- |
| `sensor`                     | a sensor of the right category (temperature, humidity, power, energy, CO₂, battery…), or text |
| `binary_sensor`              | motion, opening, leak, smoke, CO, low battery, tamper, vibration or input                     |
| `switch`, `siren`, `fan`     | a switch (and a speed in % for a fan)                                                         |
| `light`                      | a light: on/off, brightness, color temperature and color (default, json and template schemas) |
| `cover`                      | a shutter or a curtain: open, close, stop, position                                           |
| `lock`                       | a lock: lock, unlock, detailed state (moving, jammed)                                         |
| `climate`                    | a thermostat: setpoint, room temperature, mode, preset, activity                              |
| `select`, `text`, `number`   | a choice list, a text, a numeric setting                                                      |
| `button`, `scene`            | a push button                                                                                 |
| `device_automation`, `event` | a remote button (one per key) and the **MQTT device trigger** scene trigger                   |

The entities of one Home Assistant device (same `device` block) make **one
Gladys device**. Entities disabled by default (`enabled_by_default: false`,
usually diagnostics) are left out.

## Compatible devices

Anything that publishes Home Assistant MQTT discovery, for example:

- **Tasmota**: `SetOption19 1` in the console (legacy discovery).
- **ESPHome**: an `mqtt:` block in the configuration (discovery is on by default).
- **OpenBeken**, **Valetudo** (freed robot vacuums), **ESPSomfy RTS** (Somfy RTS shutters).
- **ebusd** (Saunier Duval, Vaillant, Bulex… boilers), **EMS-ESP** (Buderus, Bosch, Nefit).
- **OpenMQTTGateway** and **Theengs Gateway**: your **Bluetooth** sensors (Xiaomi,
  Govee, Inkbird, BTHome…) through an ESP32, although the integration container
  has no Bluetooth access.
- **rtl_433** with its `rtl_433_mqtt_hass.py` script.

**Zigbee2MQTT** publishes this format too, but Gladys has its own Zigbee2MQTT
integration: the "Leave out the Zigbee2MQTT devices" option (on by default)
avoids duplicates.

## Installation

1. An MQTT broker reachable from the Gladys machine: the one of the Gladys MQTT
   integration, or your own (Mosquitto…).
2. In the configuration, type the **broker address** as seen from the Gladys
   machine: its **LAN IP address**, not `localhost` (the integration runs in its
   own container). Examples: `mqtt://192.168.1.10:1883`,
   `mqtts://broker.lan:8883`, `ws://192.168.1.10:9001/mqtt`.
3. The user name and password, if your broker requires them.
4. Click **Test the connection**: the number of announcements and devices
   received is shown.
5. Open the **Discovery** tab and add the devices you want.

Nothing shows up? Turn on Home Assistant discovery on your devices, then click
**Ask the devices to announce themselves**: the integration publishes `online`
on `homeassistant/status`, the signal most firmwares answer by publishing their
announcements again.

## Options

| Option                            | Default         | Purpose                                                                    |
| --------------------------------- | --------------- | -------------------------------------------------------------------------- |
| Discovery prefix                  | `homeassistant` | change it only if your devices publish elsewhere                           |
| Verify the TLS certificate        | on              | turn off for a broker with a self-signed certificate on your network       |
| Leave out the Zigbee2MQTT devices | on              | avoids duplicates with the Gladys Zigbee2MQTT integration                  |
| Minimum interval of a sensor      | 10 s            | a meter publishing every second is recorded at this pace only (last value) |

Switches, buttons, motion and opening sensors are never delayed. Gladys accepts
300 states per minute per integration: the integration only sends the values
that change, and spreads the rest.

## Scenes

- **Remote buttons** (`device_automation`, `event`) become "button" features:
  use them like any button in the "Device state change" trigger (click, double
  click, long press…).
- The **MQTT device trigger** scene trigger receives every press, filtered by
  device, type (`button_short_press`…) and subtype (`button_1`…), with the
  received message in `payload`.
- Sensors announcing an `off_delay` (radio doorbell, 433 MHz detector) go back
  to 0 by themselves after that delay.

## How it works

The integration subscribes to `homeassistant/+/+/config` and
`homeassistant/+/+/+/config` (including the Home Assistant 2024.11 "device"
format), reads the announcements retained on the broker, builds the devices,
then subscribes to the state topics it needs only. The templates of the
announcements (`value_template`, `command_template`…) are interpreted by a safe
subset of Jinja: the common filters and expressions (`value_json.x`, `float`,
`round`, `is_defined`, conditions…), without ever running code. An empty
announcement removes the device from Discovery. Availability shows on the
device badge (local / unreachable).

## Troubleshooting

- **"The MQTT broker is unreachable"**: check the IP address and port, and that
  the broker accepts connections from the LAN (`listener 1883` in Mosquitto 2).
- **"refused the connection"**: wrong user name or password, or an ACL denying
  read access to `homeassistant/#`.
- **A device is missing**: click **Test the connection**, the summary lists the
  entities not supported yet (vacuum, alarm… not yet); the details are in the
  integration logs.
- **A value does not update**: the template of the announcement may not be
  supported yet; the logs say so once per entity.

## Privacy

Everything stays on your network: the integration only talks to your MQTT
broker. The password is stored as a secret by Gladys and never appears in the
logs.
