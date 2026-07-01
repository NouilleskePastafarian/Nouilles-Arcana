// ═══════════════════════════════════════════════════════════════════════
// Appels Helix REST — auth par token utilisateur uniquement (pas de
// client secret, cohérent avec le flux OAuth implicit-grant déjà en
// place côté éditeur).
// ═══════════════════════════════════════════════════════════════════════
const logger = require('./logger');

const HELIX = 'https://api.twitch.tv/helix';

class TokenInvalidError extends Error {}

function makeClient(cfg, onTokenInvalid) {
  async function call(path, opts) {
    opts = opts || {};
    const res = await fetch(HELIX + path, {
      method: opts.method || 'GET',
      headers: Object.assign(
        {
          'Client-Id': cfg.twitchClientId,
          Authorization: 'Bearer ' + cfg.bearerToken,
          'Content-Type': 'application/json',
        },
        opts.headers || {}
      ),
      body: opts.body ? JSON.stringify(opts.body) : undefined,
    });

    if (res.status === 401) {
      logger.error('Token Twitch invalide/expiré — reconnectez-vous via le panneau Twitch de l\'éditeur.');
      if (onTokenInvalid) onTokenInvalid();
      throw new TokenInvalidError('401 sur ' + path);
    }
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      throw new Error(`Helix ${path} -> HTTP ${res.status} ${body}`);
    }
    if (res.status === 204) return null;
    return res.json();
  }

  return {
    async getBroadcasterId() {
      const d = await call('/users');
      const user = d.data && d.data[0];
      if (!user) throw new Error('Impossible de résoudre l\'utilisateur Twitch (token/login invalide ?)');
      return user.id;
    },

    async getStreamInfo(broadcasterId) {
      const d = await call('/streams?user_id=' + broadcasterId);
      const s = d.data && d.data[0];
      return s
        ? { live: true, viewerCount: s.viewer_count, gameName: s.game_name, title: s.title }
        : { live: false, viewerCount: 0, gameName: '', title: '' };
    },

    async getChannelInfo(broadcasterId) {
      const d = await call('/channels?broadcaster_id=' + broadcasterId);
      const c = d.data && d.data[0];
      return c ? { gameName: c.game_name, title: c.title } : { gameName: '', title: '' };
    },

    async getFollowerCount(broadcasterId) {
      const d = await call('/channels/followers?broadcaster_id=' + broadcasterId + '&first=1');
      return typeof d.total === 'number' ? d.total : 0;
    },

    async getSubscriberCount(broadcasterId) {
      try {
        const d = await call('/subscriptions?broadcaster_id=' + broadcasterId + '&first=1');
        return typeof d.total === 'number' ? d.total : 0;
      } catch (e) {
        // channel:read:subscriptions peut manquer sur d'anciens tokens — non bloquant.
        return 0;
      }
    },

    // ── Modération (utilisée par le bot) — moderator_id doit être le
    //    propriétaire du token utilisé : le streamer (implicitement mod de sa
    //    chaîne) ou le compte dédié du bot (à rendre mod via /mod).
    async deleteChatMessage(broadcasterId, messageId, moderatorId) {
      return call('/moderation/chat?broadcaster_id=' + broadcasterId
        + '&moderator_id=' + (moderatorId || broadcasterId)
        + '&message_id=' + encodeURIComponent(messageId), { method: 'DELETE' });
    },

    // durationSec null/absent = bannissement permanent (comportement Helix).
    async timeoutUser(broadcasterId, userId, durationSec, reason, moderatorId) {
      const data = { user_id: userId, reason: String(reason || '').slice(0, 500) };
      if (durationSec != null) data.duration = durationSec;
      return call('/moderation/bans?broadcaster_id=' + broadcasterId + '&moderator_id=' + (moderatorId || broadcasterId), {
        method: 'POST',
        body: { data },
      });
    },

    async createEventSubSubscription(type, version, condition, sessionId) {
      return call('/eventsub/subscriptions', {
        method: 'POST',
        body: {
          type,
          version,
          condition,
          transport: { method: 'websocket', session_id: sessionId },
        },
      });
    },
  };
}

module.exports = { makeClient, TokenInvalidError };
