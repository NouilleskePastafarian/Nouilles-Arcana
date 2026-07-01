// ═══════════════════════════════════════════════════════════════════════
// nk-relay — relais local Twitch pour les overlays Nouilles-Arcana.
// Remplace Streamer.bot : se connecte à Twitch (EventSub + Helix) avec le
// token OAuth déjà stocké dans config.json, et rebroadcast les événements
// sur ws://127.0.0.1:8080/ dans le format que Alertes.dc.html et
// Barre Widgets.dc.html savent déjà lire — zéro changement côté overlays.
//
// Usage : nk-relay.exe --config "chemin\config.json" [--port 8080] [--test]
// ═══════════════════════════════════════════════════════════════════════
const logger = require('./logger');
const { loadConfig } = require('./config');
const { makeClient } = require('./twitchApi');
const { startLocalServer } = require('./localWs');
const { startPoller } = require('./poller');
const eventsub = require('./eventsub');
const { startTestMode, buildTestEventForAlertType } = require('./testMode');
const { startAiMod } = require('./aiMod');

function parseArgs(argv) {
  const args = { port: 8080, test: false, config: null };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--config') args.config = argv[++i];
    else if (argv[i] === '--port') args.port = parseInt(argv[++i], 10) || 8080;
    else if (argv[i] === '--test') args.test = true;
    else if (argv[i] === '--eventsub-url') args.eventsubUrl = argv[++i]; // dérogation pour tests Twitch CLI
  }
  return args;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));

  if (!args.config) {
    process.stderr.write('Usage: nk-relay.exe --config "chemin\\config.json" [--port 8080] [--test]\n');
    process.exit(1);
  }

  logger.init(args.config);
  logger.info('=== nk-relay démarrage ===');

  // `local` est assigné plus bas (branche --test ou branche live) avant que
  // onTestAlert puisse être appelé — capturé par référence de variable, pas
  // par valeur, donc peu importe l'ordre tant que l'appel arrive après.
  let local;

  // Déclenché par le bouton « Envoyer sur OBS » de l'éditeur Nouilles-Arcana
  // (NkTestAlert) — rebroadcast un événement de test réel sur tous les
  // clients connectés, y compris une vraie source OBS.
  const onTestAlert = (alertType) => {
    const ev = buildTestEventForAlertType(alertType);
    if (!ev) { logger.warn('Test manuel ignoré : aucun événement pour le type "' + alertType + '".'); return; }
    logger.info('Test manuel déclenché depuis l\'éditeur : ' + alertType);
    local.broadcast(ev);
  };

  // Déclenché juste après une sauvegarde réussie côté éditeur — rebroadcast
  // un signal que les overlays écoutent pour se recharger tout seuls.
  const onReload = () => {
    logger.info('Rechargement demandé par l\'éditeur (fichier sauvegardé).');
    local.broadcast({ event: { type: 'NkReload', source: 'Editor' }, data: {} });
  };

  // Mode test : aucun accès Twitch, juste le serveur local + événements simulés.
  if (args.test) {
    local = startLocalServer(args.port, () => {}, onTestAlert, onReload);
    startTestMode(local.broadcast, logger);
    logger.info('Prêt (mode test). Ouvrez Alertes.dc.html / Barre Widgets.dc.html dans un navigateur pour observer.');
    return;
  }

  let cfg;
  try {
    cfg = loadConfig(args.config);
  } catch (e) {
    logger.error(e.message);
    process.exit(1);
  }

  let deadToken = false;
  const onTokenInvalid = () => { deadToken = true; };
  const api = makeClient(cfg, onTokenInvalid);

  let broadcasterId;
  try {
    broadcasterId = await api.getBroadcasterId();
  } catch (e) {
    logger.error('Démarrage impossible : ' + e.message);
    process.exit(1);
  }
  logger.info('Chaîne résolue : ' + cfg.twitchLogin + ' (id ' + broadcasterId + ')');

  local = startLocalServer(args.port, () => poller && poller.refreshNow(), onTestAlert, onReload);

  // Le bot voit passer TOUT ce qui part vers les overlays (événements Twitch
  // traduits + données du poller pour les objectifs) — mais PAS les alertes
  // de test de l'éditeur (onTestAlert passe par local.broadcast directement),
  // pour ne pas poster de fausses annonces dans le vrai chat pendant qu'on
  // règle ses alertes.
  let bot = null;
  const broadcast = (obj) => {
    local.broadcast(obj);
    if (bot) { try { bot.onRelayEvent(obj); } catch (e) { logger.warn('Bot : erreur sur événement — ' + e.message); } }
  };

  const poller = startPoller(api, broadcasterId, broadcast);

  eventsub.start({
    api,
    broadcasterId,
    url: args.eventsubUrl,
    onEvent: (obj) => {
      // Trace explicite pour pouvoir confirmer, log en main, que c'est bien
      // CE relais (et pas une autre source) qui a émis une alerte donnée.
      const who = obj.data.user_name || obj.data.from_broadcaster_user_name || '';
      logger.info('Événement Twitch reçu : ' + obj.event.type + (who ? ' (' + who + ')' : ''));
      broadcast(obj);
    },
    onTokenInvalid,
  });

  // Bot du stream (optionnel — aiBot.enabled dans config.json). Isolé dans
  // un try : un souci côté bot ne doit jamais faire tomber le relais des
  // alertes/widgets.
  try {
    bot = await startAiMod(cfg, api, broadcasterId);
  } catch (e) {
    logger.error('Bot : démarrage impossible — ' + e.message);
  }

  logger.info('Relais opérationnel. En attente d\'événements Twitch et de sources OBS.');

  process.on('SIGINT', () => process.exit(0));
  process.on('SIGTERM', () => process.exit(0));
  process.on('uncaughtException', (e) => logger.error('Exception non gérée : ' + e.stack));
  process.on('unhandledRejection', (e) => logger.error('Rejet de promesse non géré : ' + e));
}

main().catch((e) => {
  logger.error('Erreur fatale au démarrage : ' + e.stack);
  process.exit(1);
});
