// ═══════════════════════════════════════════════════════════════════════
// Client WebSocket EventSub — wss://eventsub.wss.twitch.tv/ws
//
// Protocole :
//  1. session_welcome -> payload.session.id + keepalive_timeout_seconds
//  2. Pour chaque type d'événement, POST /helix/eventsub/subscriptions
//     avec transport websocket + session_id.
//  3. session_keepalive -> reset du timer d'inactivité.
//  4. session_reconnect -> ouvrir une NOUVELLE socket vers reconnect_url,
//     ne fermer l'ancienne qu'une fois la nouvelle en session_welcome
//     (sinon on perd les abonnements en vol).
//  5. notification -> metadata.subscription_type + payload.event.
//  6. revocation -> log, ne plus retenter ce type jusqu'au redémarrage.
// ═══════════════════════════════════════════════════════════════════════
const WebSocket = require('ws');
const logger = require('./logger');
const { translate } = require('./translate');
const { TokenInvalidError } = require('./twitchApi');

const DEFAULT_URL = 'wss://eventsub.wss.twitch.tv/ws';

// condition varie selon le type ; voir tableau du plan.
function buildSubscriptions(broadcasterId) {
  return [
    { type: 'channel.follow', version: '2', condition: { broadcaster_user_id: broadcasterId, moderator_user_id: broadcasterId } },
    { type: 'channel.subscribe', version: '1', condition: { broadcaster_user_id: broadcasterId } },
    { type: 'channel.subscription.message', version: '1', condition: { broadcaster_user_id: broadcasterId } },
    { type: 'channel.subscription.gift', version: '1', condition: { broadcaster_user_id: broadcasterId } },
    { type: 'channel.cheer', version: '1', condition: { broadcaster_user_id: broadcasterId } },
    { type: 'channel.raid', version: '1', condition: { to_broadcaster_user_id: broadcasterId } },
    { type: 'channel.channel_points_custom_reward_redemption.add', version: '1', condition: { broadcaster_user_id: broadcasterId } },
    // v1 retiré par Twitch le 22/01/2026 — v2 est la seule version valide désormais.
    { type: 'channel.hype_train.begin', version: '2', condition: { broadcaster_user_id: broadcasterId } },
    { type: 'channel.hype_train.progress', version: '2', condition: { broadcaster_user_id: broadcasterId } },
  ];
}

function start(opts) {
  const { api, broadcasterId, onEvent, onTokenInvalid, url } = opts;
  const wsUrl = url || DEFAULT_URL;
  let socket = null;
  let keepaliveTimer = null;
  let stopped = false;
  let deadToken = false;

  async function subscribeAll(sessionId) {
    const subs = buildSubscriptions(broadcasterId);
    for (const s of subs) {
      try {
        await api.createEventSubSubscription(s.type, s.version, s.condition, sessionId);
      } catch (e) {
        if (e instanceof TokenInvalidError) {
          deadToken = true;
          if (onTokenInvalid) onTokenInvalid();
          return;
        }
        logger.warn(`Abonnement EventSub échoué pour ${s.type} : ${e.message}`);
      }
    }
    logger.info('Abonnements EventSub créés (' + subs.length + ' types demandés).');
  }

  function resetKeepalive(timeoutSeconds) {
    if (keepaliveTimer) clearTimeout(keepaliveTimer);
    if (!timeoutSeconds) return;
    keepaliveTimer = setTimeout(() => {
      logger.warn('EventSub : pas de signal depuis ' + timeoutSeconds + 's, reconnexion.');
      reconnect(wsUrl);
    }, (timeoutSeconds + 10) * 1000);
  }

  function handleMessage(raw, isReconnectTarget, oldSocket) {
    let msg;
    try { msg = JSON.parse(raw); } catch (e) { return; }
    const type = msg.metadata && msg.metadata.message_type;

    if (type === 'session_welcome') {
      const session = msg.payload.session;
      resetKeepalive(session.keepalive_timeout_seconds);
      if (isReconnectTarget && oldSocket) {
        try { oldSocket.close(); } catch (e) {}
      }
      if (!isReconnectTarget) {
        subscribeAll(session.id);
      }
      return;
    }

    if (type === 'session_keepalive') {
      resetKeepalive(90); // Twitch renvoie normalement le timeout à chaque welcome ; 90s de secours
      return;
    }

    if (type === 'session_reconnect') {
      const reconnectUrl = msg.payload.session.reconnect_url;
      logger.info('EventSub demande une reconnexion vers une nouvelle session.');
      connect(reconnectUrl, true, socket);
      return;
    }

    if (type === 'notification') {
      resetKeepalive(90);
      const subType = msg.metadata.subscription_type;
      const ev = msg.payload.event;
      try {
        translate(subType, ev, onEvent);
      } catch (e) {
        logger.warn('Erreur de traduction événement ' + subType + ' : ' + e.message);
      }
      return;
    }

    if (type === 'revocation') {
      logger.warn('Abonnement révoqué : ' + (msg.payload.subscription && msg.payload.subscription.type) +
        ' (raison: ' + (msg.payload.subscription && msg.payload.subscription.status) + ')');
      return;
    }
  }

  function connect(targetUrl, isReconnectTarget, oldSocket) {
    if (stopped || deadToken) return;
    let sock;
    try {
      sock = new WebSocket(targetUrl);
    } catch (e) {
      logger.error('Connexion EventSub impossible : ' + e.message);
      scheduleReconnect();
      return;
    }
    if (!isReconnectTarget) socket = sock;

    sock.on('message', (raw) => handleMessage(raw, isReconnectTarget, oldSocket));
    sock.on('close', () => {
      if (sock === socket) {
        if (keepaliveTimer) clearTimeout(keepaliveTimer);
        if (!stopped && !deadToken) scheduleReconnect();
      }
    });
    sock.on('error', (e) => {
      logger.warn('Erreur socket EventSub : ' + e.message);
    });

    if (isReconnectTarget) {
      // devient la socket active une fois qu'elle atteint session_welcome (voir handleMessage)
      sock.on('open', () => { socket = sock; });
    }
  }

  function reconnect(targetUrl) {
    scheduleReconnect(targetUrl);
  }

  let reconnectTimer = null;
  function scheduleReconnect(targetUrl) {
    if (reconnectTimer) return;
    reconnectTimer = setTimeout(() => {
      reconnectTimer = null;
      connect(targetUrl || wsUrl, false, null);
    }, 5000);
  }

  connect(wsUrl, false, null);

  return {
    stop() {
      stopped = true;
      if (keepaliveTimer) clearTimeout(keepaliveTimer);
      if (reconnectTimer) clearTimeout(reconnectTimer);
      if (socket) try { socket.close(); } catch (e) {}
    },
  };
}

module.exports = { start };
