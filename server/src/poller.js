// ═══════════════════════════════════════════════════════════════════════
// Poll périodique (viewers/jeu/titre/follows/subs) — EventSub n'a pas
// d'événement pour le nombre de viewers en direct, donc on interroge
// Helix toutes les 30s et on diffuse dans le format exact attendu par
// Barre Widgets.dc.html (event.type='Custom', event.source='General',
// data.event='nkWidgetUpdate', data.data={...}).
// ═══════════════════════════════════════════════════════════════════════
const logger = require('./logger');

const POLL_INTERVAL_MS = 30000;

function startPoller(api, broadcasterId, broadcast) {
  let timer = null;
  let stopped = false;

  async function tick() {
    try {
      const stream = await api.getStreamInfo(broadcasterId);
      let gameName = stream.gameName;
      let title = stream.title;
      if (!stream.live) {
        const chan = await api.getChannelInfo(broadcasterId);
        gameName = chan.gameName;
        title = chan.title;
      }
      const [followCurrent, subCurrent] = await Promise.all([
        api.getFollowerCount(broadcasterId),
        api.getSubscriberCount(broadcasterId),
      ]);

      broadcast({
        event: { type: 'Custom', source: 'General' },
        data: {
          event: 'nkWidgetUpdate',
          data: {
            viewerCount: stream.viewerCount,
            gameName,
            streamTitle: title,
            followCurrent,
            subCurrent,
          },
        },
      });
    } catch (e) {
      logger.warn('Poll widgets échoué : ' + e.message);
    } finally {
      if (!stopped) timer = setTimeout(tick, POLL_INTERVAL_MS);
    }
  }

  tick(); // premier refresh immédiat au démarrage

  return {
    refreshNow() {
      if (timer) clearTimeout(timer); // évite un double timer qui dériverait le cycle 30s
      tick();
    },
    stop() { stopped = true; if (timer) clearTimeout(timer); },
  };
}

module.exports = { startPoller };
