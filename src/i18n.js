// -----------------------------------------------------------------------------
// Texts shown in Gladys (connection status, buttons), in English and French.
// -----------------------------------------------------------------------------

const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;

export const T = {
  notConfigured: {
    en: 'Type the address of your MQTT broker in the configuration (for example mqtt://192.168.1.10:1883).',
    fr: "Saisissez l'adresse de votre broker MQTT dans la configuration (par exemple mqtt://192.168.1.10:1883).",
  },
  badUrl: (reason) =>
    reason === 'credentials'
      ? {
          en: 'Put the user name and the password in their own fields, not in the broker address.',
          fr: "Mettez l'utilisateur et le mot de passe dans leurs champs, pas dans l'adresse du broker.",
        }
      : {
          en: 'The broker address is not valid: use mqtt://host:1883, mqtts://host:8883 or ws://host:port/path.',
          fr: "L'adresse du broker n'est pas valide : utilisez mqtt://hôte:1883, mqtts://hôte:8883 ou ws://hôte:port/chemin.",
        },
  connecting: {
    en: 'Connecting to the MQTT broker…',
    fr: 'Connexion au broker MQTT…',
  },
  connected: (devices, entities) => ({
    en: `Connected to the broker: ${plural(devices, 'device', 'devices')} announced (${plural(entities, 'entity', 'entities')}). Open Discovery to add them.`,
    fr: `Connecté au broker : ${plural(devices, 'appareil annoncé', 'appareils annoncés')} (${plural(entities, 'entité', 'entités')}). Ouvrez Découverte pour les ajouter.`,
  }),
  noAnnouncement: (prefix) => ({
    en: `Connected to the broker, but nothing is announced under "${prefix}/". Turn on Home Assistant discovery on your devices, or press "Ask the devices to announce themselves".`,
    fr: `Connecté au broker, mais rien n'est annoncé sous « ${prefix}/ ». Activez la découverte Home Assistant sur vos appareils, ou utilisez « Demander aux appareils de s'annoncer ».`,
  }),
  unreachable: (message) => ({
    en: `The MQTT broker is unreachable: ${message}. Retrying every few seconds.`,
    fr: `Le broker MQTT est injoignable : ${message}. Nouvel essai toutes les quelques secondes.`,
  }),
  refused: (message) => ({
    en: `The MQTT broker refused the connection: ${message}. Check the user name and the password.`,
    fr: `Le broker MQTT a refusé la connexion : ${message}. Vérifiez l'utilisateur et le mot de passe.`,
  }),
  test: {
    ok: (entities, devices, components) => ({
      en: `Connection OK. ${plural(entities, 'discovery config', 'discovery configs')} received, ${plural(devices, 'device', 'devices')}${components ? ` (${components})` : ''}.`,
      fr: `Connexion OK. ${plural(entities, 'configuration de découverte reçue', 'configurations de découverte reçues')}, ${plural(devices, 'appareil', 'appareils')}${components ? ` (${components})` : ''}.`,
    }),
    empty: (prefix) => ({
      en: `Connection OK, but no discovery config under "${prefix}/" (retained messages). Check the prefix, or ask the devices to announce themselves.`,
      fr: `Connexion OK, mais aucune configuration de découverte sous « ${prefix}/ » (messages retenus). Vérifiez le préfixe, ou demandez aux appareils de s'annoncer.`,
    }),
    unsupported: (count) => ({
      en: ` ${plural(count, 'entity is', 'entities are')} not supported yet (see the logs).`,
      fr: ` ${plural(count, "entité n'est", 'entités ne sont')} pas encore prise${count === 1 ? '' : 's'} en charge (voir les logs).`,
    }),
  },
  announced: (prefix) => ({
    en: `"online" sent on ${prefix}/status: the devices that follow it announce themselves again. Open Discovery in a few seconds.`,
    fr: `« online » envoyé sur ${prefix}/status : les appareils qui le suivent s'annoncent à nouveau. Ouvrez Découverte dans quelques secondes.`,
  }),
  notConnected: {
    en: 'Not connected to the broker yet: check the configuration and the status above.',
    fr: "Pas encore connecté au broker : vérifiez la configuration et l'état ci-dessus.",
  },
};
