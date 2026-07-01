// ═══════════════════════════════════════════════════════════════════════
// Mode --test : simule un événement de chaque type toutes les 2s, sans
// toucher à Twitch (pas d'auth Helix, pas de connexion EventSub). Permet
// de vérifier que le format JSON du relais passe correctement par le
// code de parsing déjà existant dans Alertes.dc.html / Barre Widgets.dc.html.
// ═══════════════════════════════════════════════════════════════════════
const { legacy } = require('./translate');

// Un « builder » par type d'alerte éditeur (mode-alerts.js) qui a un
// équivalent réel côté Twitch/legacy Streamer.bot — utilisé à la fois par
// la boucle --test ci-dessous ET par le bouton « Envoyer sur OBS » de
// l'éditeur (voir onTestAlert dans index.js). Les types sans équivalent
// (donation, charity, ban, cheer — jamais câblé côté overlay) ne sont pas
// listés : le bouton de l'éditeur les désactive côté client pour cette
// raison.
const TEST_BUILDERS = {
  follow:         () => legacy('Follow', { user_name: 'TestFollower' }),
  sub:            () => legacy('Sub', { user_name: 'TestSub', cumulative_months: 1 }),
  resub:          () => legacy('ReSub', { user_name: 'TestReSub', cumulative_months: 6, message: 'Merci pour le stream !' }),
  subgift:        () => legacy('GiftSub', { user_name: 'TestGifter', recipient_user_name: 'TestRecipient' }),
  subgiftbomb:    () => legacy('GiftBomb', { user_name: 'TestBigGifter', total: 5 }),
  bits:           () => legacy('Cheer', { user_name: 'TestCheerer', bits: 250, message: 'Prends des bits !' }),
  raid:           () => legacy('Raid', { from_broadcaster_user_name: 'TestRaider', viewers: 42 }),
  channelPoints:  () => legacy('ChannelPointsRedemption', { user_name: 'TestRedeemer', reward: { title: 'Récompense test' } }),
  hypetrainLevel: () => legacy('HypeTrainLevelUp', { level: 2 }),
  host:           () => legacy('Host', { user_name: 'TestHoster', viewers: 30 }),
};

function buildTestEventForAlertType(alertType) {
  const b = TEST_BUILDERS[alertType];
  return b ? b() : null;
}

const EVENTS = Object.keys(TEST_BUILDERS).map((k) => TEST_BUILDERS[k]());

const WIDGET_EVENT = {
  event: { type: 'Custom', source: 'General' },
  data: {
    event: 'nkWidgetUpdate',
    data: { viewerCount: 87, gameName: 'Just Chatting', streamTitle: 'Stream de test', followCurrent: 1234, subCurrent: 56 },
  },
};

function startTestMode(broadcast, logger) {
  logger.info('Mode --test actif : simulation d\'événements Twitch, aucune connexion réelle.');
  broadcast(WIDGET_EVENT);
  let i = 0;
  const timer = setInterval(() => {
    broadcast(EVENTS[i % EVENTS.length]);
    logger.info('Événement test émis : ' + EVENTS[i % EVENTS.length].event.type);
    i++;
  }, 2000);
  return { stop() { clearInterval(timer); } };
}

module.exports = { startTestMode, buildTestEventForAlertType };
