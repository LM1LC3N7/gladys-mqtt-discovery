# Découverte MQTT (format Home Assistant)

> **Retirée : utilisez l'intégration MQTT de Gladys.** Depuis Gladys 4.86,
> l'intégration « Appareils virtuels MQTT » du cœur lit les annonces de
> découverte Home Assistant de son broker et propose les appareils dans son
> onglet Découverte. Cette intégration faisait doublon : elle n'est plus listée
> dans le store. Si vous l'avez installée, désinstallez-la, sinon chaque
> appareil apparaîtrait en double.

De nombreux firmwares et passerelles **s'annoncent eux-mêmes** sur un broker
MQTT, au format de découverte de Home Assistant : chaque appareil publie la
description de ses capteurs et de ses commandes sous `homeassistant/…/config`.
Cette intégration se connecte à **votre** broker, lit ces annonces et propose
chaque appareil dans l'onglet **Découverte** de Gladys, prêt à être ajouté.
Sans lien avec Home Assistant : seul le format des messages est le même.

> **Version de développement (0.1).** Développée et testée contre un vrai
> broker Mosquitto avec des annonces Tasmota, ESPHome, OpenMQTTGateway et
> ebusd simulées, pas encore avec tous les firmwares. Vos retours (et les
> annonces de vos appareils) sont les bienvenus sur le dépôt GitHub.

## Ce que vous obtenez

| Composant Home Assistant     | Dans Gladys                                                                                           |
| ---------------------------- | ----------------------------------------------------------------------------------------------------- |
| `sensor`                     | capteur de la bonne catégorie (température, humidité, puissance, énergie, CO₂, batterie…), ou texte   |
| `binary_sensor`              | mouvement, ouverture, fuite, fumée, CO, batterie faible, sabotage, vibration ou entrée                |
| `switch`, `siren`, `fan`     | interrupteur (et vitesse en % pour un ventilateur)                                                    |
| `light`                      | lampe : marche/arrêt, luminosité, température de couleur et couleur (schémas default, json, template) |
| `cover`                      | volet ou rideau : ouvrir, fermer, stop, position                                                      |
| `lock`                       | serrure : verrouiller, déverrouiller, état détaillé (en mouvement, bloquée)                           |
| `climate`                    | thermostat : consigne, température ambiante, mode, préréglage, activité                               |
| `select`, `text`, `number`   | liste de choix, texte, réglage numérique                                                              |
| `button`, `scene`            | bouton poussoir                                                                                       |
| `device_automation`, `event` | bouton de télécommande (un par touche) et déclencheur de scène **Déclencheur d'un appareil MQTT**     |

Les entités d'un même appareil Home Assistant (même bloc `device`) forment
**un seul appareil Gladys**. Les entités désactivées par défaut
(`enabled_by_default: false`, souvent des diagnostics) sont laissées de côté.

## Appareils compatibles

Tout ce qui publie la découverte MQTT de Home Assistant, par exemple :

- **Tasmota** : `SetOption19 1` dans la console (découverte « legacy »).
- **ESPHome** : un bloc `mqtt:` dans la configuration (la découverte est active par défaut).
- **OpenBeken**, **Valetudo** (aspirateurs libérés), **ESPSomfy RTS** (volets Somfy RTS).
- **ebusd** (chaudières Saunier Duval, Vaillant, Bulex…), **EMS-ESP** (Buderus, Bosch, Nefit).
- **OpenMQTTGateway** et **Theengs Gateway** : vos capteurs **Bluetooth** (Xiaomi,
  Govee, Inkbird, BTHome…) via un ESP32, alors que le conteneur de l'intégration
  n'a pas accès au Bluetooth.
- **rtl_433** avec son script `rtl_433_mqtt_hass.py`.

**Zigbee2MQTT** publie aussi ce format, mais Gladys a sa propre intégration
Zigbee2MQTT : l'option « Ignorer les appareils Zigbee2MQTT » (activée par
défaut) évite les doublons.

## Installation

1. Un broker MQTT joignable depuis la machine Gladys : celui de l'intégration
   MQTT de Gladys, ou le vôtre (Mosquitto…).
2. Dans la configuration, saisissez l'**adresse du broker** vue depuis la
   machine Gladys : son **adresse IP sur le réseau local**, pas `localhost`
   (l'intégration tourne dans son propre conteneur). Exemples :
   `mqtt://192.168.1.10:1883`, `mqtts://broker.lan:8883`,
   `ws://192.168.1.10:9001/mqtt`.
3. L'utilisateur et le mot de passe, si votre broker en demande.
4. Cliquez sur **Tester la connexion** : le nombre d'annonces reçues et
   d'appareils s'affiche.
5. Ouvrez l'onglet **Découverte** et ajoutez les appareils voulus.

Rien n'apparaît ? Activez la découverte Home Assistant sur vos appareils, puis
cliquez sur **Demander aux appareils de s'annoncer** : l'intégration publie
`online` sur `homeassistant/status`, le signal auquel la plupart des firmwares
répondent en republiant leurs annonces.

## Options

| Option                            | Par défaut      | Rôle                                                                                    |
| --------------------------------- | --------------- | --------------------------------------------------------------------------------------- |
| Préfixe de découverte             | `homeassistant` | à changer seulement si vos appareils publient ailleurs                                  |
| Vérifier le certificat TLS        | oui             | à désactiver pour un broker au certificat auto-signé de votre réseau                    |
| Ignorer les appareils Zigbee2MQTT | oui             | évite les doublons avec l'intégration Zigbee2MQTT de Gladys                             |
| Intervalle minimum d'un capteur   | 10 s            | un compteur qui publie chaque seconde n'est enregistré qu'à ce rythme (dernière valeur) |

Les interrupteurs, boutons, détecteurs de mouvement et d'ouverture ne sont
jamais retardés. Gladys accepte 300 états par minute et par intégration :
l'intégration ne renvoie que les valeurs qui changent, et répartit le reste.

## Scènes

- Les **boutons de télécommande** (`device_automation`, `event`) deviennent des
  fonctionnalités « bouton » : utilisez-les comme n'importe quel bouton dans le
  déclencheur « Changement d'état d'un appareil » (clic, double clic, appui
  long…).
- Le déclencheur **Déclencheur d'un appareil MQTT** reçoit chaque appui, filtrable
  par appareil, type (`button_short_press`…) et sous-type (`button_1`…), avec le
  message reçu dans `payload`.
- Les détecteurs avec un `off_delay` (sonnette radio, détecteur 433 MHz)
  repassent à 0 tout seuls après le délai annoncé.

## Fonctionnement

L'intégration s'abonne à `homeassistant/+/+/config` et
`homeassistant/+/+/+/config` (dont le format « device » de Home Assistant
2024.11), lit les annonces retenues sur le broker, construit les appareils, puis
s'abonne aux seuls topics d'état utiles. Les templates des annonces
(`value_template`, `command_template`…) sont interprétés par un sous-ensemble sûr
de Jinja : les filtres et expressions courants (`value_json.x`, `float`, `round`,
`is_defined`, conditions…), sans jamais exécuter de code. Une annonce vide retire
l'appareil de la Découverte. La disponibilité (`availability`) s'affiche sur le
badge de l'appareil (local / injoignable).

## Dépannage

- **« Le broker MQTT est injoignable »** : vérifiez l'adresse IP et le port, et
  que le broker accepte les connexions du réseau local (`listener 1883` dans
  Mosquitto 2).
- **« a refusé la connexion »** : utilisateur ou mot de passe incorrect, ou
  ACL qui interdit la lecture de `homeassistant/#`.
- **Un appareil manque** : cliquez sur **Tester la connexion**, le résumé
  indique les entités non prises en charge (aspirateur, alarme… pas encore) ;
  le détail est dans les logs de l'intégration.
- **Une valeur ne se met pas à jour** : le template de l'annonce n'est peut-être
  pas encore pris en charge ; les logs l'indiquent une fois par entité.

## Confidentialité

Tout reste sur votre réseau : l'intégration ne parle qu'à votre broker MQTT. Le
mot de passe est stocké comme secret par Gladys et n'apparaît jamais dans les
logs.
