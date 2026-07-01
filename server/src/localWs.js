// ═══════════════════════════════════════════════════════════════════════
// Serveur WebSocket local 127.0.0.1:PORT — c'est à ce serveur que se
// connectent Alertes.dc.html et Barre Widgets.dc.html (ws://127.0.0.1:8080/
// par défaut, déjà codé en dur côté overlays), ET l'éditeur Nouilles-Arcana
// (mode-alerts.js) pour le bouton « Envoyer sur OBS ». Requêtes acceptées :
//   - DoAction        : déclenche un refresh immédiat (déjà attendu par
//                        Barre Widgets au chargement de la scène).
//   - NkTestAlert     : { alertType } — envoyé par l'éditeur pour rejouer
//                        une alerte de test EN CONDITIONS RÉELLES sur tous
//                        les clients connectés (donc visible dans une vraie
//                        source OBS, pas seulement dans l'aperçu éditeur).
//   - NkReload        : envoyé par l'éditeur juste après une sauvegarde
//                        réussie — rebroadcast un événement que les overlays
//                        (Alertes/Barre Widgets) écoutent pour se recharger
//                        automatiquement (les sources navigateur OBS ne
//                        relisent jamais le fichier tout seules autrement).
// ═══════════════════════════════════════════════════════════════════════
const { WebSocketServer } = require('ws');
const logger = require('./logger');

function startLocalServer(port, onDoAction, onTestAlert, onReload) {
  const wss = new WebSocketServer({ host: '127.0.0.1', port });
  const clients = new Set();

  wss.on('connection', (socket) => {
    clients.add(socket);
    logger.info('Source OBS connectée (' + clients.size + ' active(s)).');

    socket.on('message', (raw) => {
      try {
        const msg = JSON.parse(raw);
        if (msg.request === 'DoAction' && onDoAction) onDoAction();
        else if (msg.request === 'NkTestAlert' && onTestAlert) onTestAlert(msg.alertType);
        else if (msg.request === 'NkReload' && onReload) onReload();
      } catch (e) { /* message non-JSON, ignoré */ }
    });

    socket.on('close', () => {
      clients.delete(socket);
      logger.info('Source OBS déconnectée (' + clients.size + ' active(s)).');
    });
  });

  wss.on('error', (e) => {
    logger.error('Serveur WS local : ' + e.message +
      (e.code === 'EADDRINUSE' ? ' — le port ' + port + ' est déjà utilisé (une autre instance tourne ?).' : ''));
  });

  logger.info('Serveur relais local en écoute sur ws://127.0.0.1:' + port + '/');

  return {
    broadcast(obj) {
      const json = JSON.stringify(obj);
      for (const c of clients) {
        if (c.readyState === c.OPEN) c.send(json);
      }
    },
    clientCount() { return clients.size; },
    close() { wss.close(); },
  };
}

module.exports = { startLocalServer };
