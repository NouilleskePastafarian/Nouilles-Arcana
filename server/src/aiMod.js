// ═══════════════════════════════════════════════════════════════════════
// aiMod — le Bot du stream : assistant de chat complet, IA optionnelle.
//
// Fonctionne à trois niveaux, tous configurables dans config.json → "aiBot"
// (panneau 🤖 Bot de l'éditeur) :
//
//   1. SANS IA — toujours disponible dès que le bot est activé :
//      • Annonces automatiques dans le chat sur les événements Twitch
//        (follow, sub, resub, gift, bomb, cheer, raid…) avec des messages
//        modèles ({user}, {amount}, {viewers}…).
//      • Objectifs : annonce quand le cap de follows/subs est franchi.
//      • Mots interdits : suppression/timeout/ban instantané, sans IA.
//      • Commandes : !discord, !planning… → réponse fixe.
//
//   2. AVEC IA LOCALE (aiEnabled) — LM Studio / llama.cpp / Ollama :
//      • Modération par jugement (règles en français libre).
//      • Réponses en chat avec personnalité (mentions et/ou % spontané).
//
//   3. COMPTE DÉDIÉ (botToken/botLogin) — si l'utilisateur a créé un compte
//      Twitch pour son bot et l'a connecté dans le panneau, le bot parle et
//      modère avec CE compte (il doit être modérateur : /mod nom_du_bot).
//      Sinon, il utilise le compte du streamer.
//
// Scopes requis sur le token utilisé par le bot :
//   chat:read chat:edit moderator:manage:chat_messages moderator:manage:banned_users
// ═══════════════════════════════════════════════════════════════════════
const WebSocket = require('ws');
const logger = require('./logger');
const { makeClient } = require('./twitchApi');

const DEFAULTS = {
  enabled: false,
  // Compte dédié du bot (vide = compte du streamer)
  botLogin: '',
  botToken: '',
  botName: 'NouillesBot',

  // ── IA locale (optionnelle) ──
  aiEnabled: false,
  apiUrl: 'http://127.0.0.1:1234/v1',
  model: '',
  personality: "Tu es NouillesBot, le modérateur-mascotte du stream. Tu réponds en français, en une ou deux phrases courtes, sur un ton chaleureux et un peu taquin. Tu ne révèles jamais que tu es une IA sauf si on te le demande directement.",
  replyToMentions: true,
  replyChance: 0,
  replyCooldownSec: 20,
  maxReplyLen: 220,
  moderation: {
    enabled: true,
    action: 'timeout',
    timeoutSec: 60,
    rules: "insultes graves ou harcèlement envers quelqu'un, racisme ou discrimination, contenu sexuel explicite, spam répétitif de liens, divulgation d'informations personnelles",
  },

  // ── Assistance sans IA ──
  bannedWords: { enabled: true, words: [], action: 'timeout', timeoutSec: 600 },
  commands: [],   // [{ trigger: "!discord", reply: "Rejoins-nous : ..." }]
  announcements: {
    follow:        { enabled: true,  template: 'Merci pour le follow {user} ! 💛' },
    sub:           { enabled: true,  template: 'GG {user} pour le sub ! ⭐' },
    resub:         { enabled: true,  template: '{user} remet ça : {months} mois de sub ! ⭐' },
    subgift:       { enabled: true,  template: '{user} offre un sub à {recipient} ! 🎁' },
    giftbomb:      { enabled: true,  template: '{user} lâche {amount} subs pour le chat ! 💥' },
    cheer:         { enabled: true,  template: 'Merci {user} pour les {amount} bits ! 💎' },
    raid:          { enabled: true,  template: 'Bienvenue aux {viewers} raiders de {user} ! ⚔' },
    channelPoints: { enabled: false, template: '{user} utilise ses points : {reward} ✦' },
    hypetrain:     { enabled: false, template: 'HYPE TRAIN niveau {level} !! 🚂' },
  },
  goals: {
    follows: { enabled: false, target: 0, template: '🎉 Objectif follows atteint : {current} ! Merci tout le monde !' },
    subs:    { enabled: false, target: 0, template: '🎉 Objectif subs atteint : {current} ! Vous êtes incroyables !' },
  },
};

function deepMerge(base, extra) {
  const out = Object.assign({}, base);
  for (const k of Object.keys(extra || {})) {
    if (extra[k] && typeof extra[k] === 'object' && !Array.isArray(extra[k]) && base[k] && typeof base[k] === 'object' && !Array.isArray(base[k])) {
      out[k] = deepMerge(base[k], extra[k]);
    } else if (extra[k] !== undefined && extra[k] !== null) {
      out[k] = extra[k];
    }
  }
  return out;
}

// ⚠ Gardé en phase avec js/bot-panel.js (simulateur de l'éditeur) — même
// rendu de template et même normalisation des mots interdits des deux côtés.
function renderTemplate(tpl, vars) {
  return String(tpl || '').replace(/\{(\w+)\}/g, (m, k) => (vars[k] !== undefined && vars[k] !== null) ? String(vars[k]) : m);
}
function normalizeWord(s) {
  return String(s).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
}
function findBannedWord(text, words) {
  const norm = ' ' + normalizeWord(text).replace(/[^a-z0-9]+/g, ' ') + ' ';
  for (const w of words) {
    const nw = normalizeWord(w).trim();
    if (!nw) continue;
    if (norm.indexOf(' ' + nw + ' ') !== -1) return w;
  }
  return null;
}

// ── Parsing IRC minimal (même logique que l'overlay chat) ────────────────
function parseIrcLine(line) {
  let tags = {};
  let rest = line;
  if (line[0] === '@') {
    const sp = line.indexOf(' ');
    line.slice(1, sp).split(';').forEach((kv) => {
      const i = kv.indexOf('=');
      tags[kv.slice(0, i)] = kv.slice(i + 1);
    });
    rest = line.slice(sp + 1);
  }
  const m = rest.match(/^:(\S+) (\S+) (\S+)(?: :([\s\S]*))?$/);
  if (!m) return null;
  return { tags, prefix: m[1], cmd: m[2], target: m[3], message: m[4] || '' };
}

async function startAiMod(cfg, api, broadcasterId) {
  const conf = deepMerge(DEFAULTS, cfg.aiBot || {});
  // Compat : les anciens configs utilisaient "enabled" pour dire "IA active".
  if (cfg.aiBot && cfg.aiBot.enabled && cfg.aiBot.aiEnabled === undefined) conf.aiEnabled = true;

  if (!conf.enabled) {
    logger.info('Bot désactivé (aiBot.enabled=false dans config.json).');
    return null;
  }

  const channel = String(cfg.twitchChannel || cfg.twitchLogin).toLowerCase().replace(/^#/, '');
  const streamerLogin = String(cfg.twitchLogin).toLowerCase();

  // ── Compte utilisé par le bot ──────────────────────────────────────────
  const hasBotAccount = !!(conf.botToken && conf.botLogin);
  let ircLogin = hasBotAccount ? String(conf.botLogin).toLowerCase() : streamerLogin;
  const ircToken = hasBotAccount ? conf.botToken.replace(/^oauth:/, '') : cfg.bearerToken;
  const botNameLc = String(conf.botName || ircLogin).toLowerCase();
  const whichPanel = hasBotAccount ? 'panneau 🤖 Bot (Compte du bot)' : 'panneau ⚙ Twitch (Déconnecter puis Se connecter)';

  // Validation du token AVANT la connexion IRC : un token émis avant l'ajout
  // du bot n'a pas les scopes chat:* et Twitch répond "Login unsuccessful"
  // sans plus de détail — on préfère diagnostiquer ici avec la vraie cause
  // plutôt que de boucler sur des reconnexions vouées à l'échec.
  try {
    const res = await fetch('https://id.twitch.tv/oauth2/validate', {
      headers: { Authorization: 'OAuth ' + ircToken },
    });
    if (!res.ok) {
      logger.error('Bot : token ' + (hasBotAccount ? 'du compte "' + conf.botLogin + '"' : 'de votre compte')
        + ' invalide ou expiré (HTTP ' + res.status + ') — bot désactivé. Reconnectez-vous via le ' + whichPanel + ' puis redémarrez OBS.');
      return null;
    }
    const d = await res.json();
    const scopes = d.scopes || [];
    const missChat = ['chat:read', 'chat:edit'].filter((s) => scopes.indexOf(s) === -1);
    const missMod = ['moderator:manage:chat_messages', 'moderator:manage:banned_users'].filter((s) => scopes.indexOf(s) === -1);
    if (missChat.length) {
      logger.error('Bot : le token ' + (hasBotAccount ? 'du compte "' + conf.botLogin + '"' : 'de votre compte')
        + ' n\'a pas les scopes ' + missChat.join(' ') + ' (il date d\'avant l\'ajout du bot) — bot désactivé.'
        + ' Reconnectez-vous via le ' + whichPanel + ' puis redémarrez OBS.');
      return null;
    }
    if (missMod.length) {
      logger.warn('Bot : scopes de modération manquants (' + missMod.join(' ') + ') — annonces et commandes OK,'
        + ' mais pas de timeout/suppression. Reconnectez-vous via le ' + whichPanel + ' pour tout activer.');
    }
    // Le NICK IRC doit être le propriétaire réel du token — corrige un
    // éventuel pseudo mal saisi.
    const tokenLogin = String(d.login || '').toLowerCase();
    if (tokenLogin && tokenLogin !== ircLogin) {
      logger.warn('Bot : le token appartient à "' + tokenLogin + '" (config : "' + ircLogin + '") — utilisation de "' + tokenLogin + '".');
      ircLogin = tokenLogin;
    }
  } catch (e) {
    logger.error('Bot : impossible de valider le token Twitch (' + (e && e.message) + ') — bot désactivé pour cette session.');
    return null;
  }

  // Client Helix de modération : celui du compte qui agit (moderator_id doit
  // correspondre au propriétaire du token).
  let modApi = api;
  let moderatorId = broadcasterId;
  if (hasBotAccount) {
    try {
      modApi = makeClient(Object.assign({}, cfg, { bearerToken: ircToken }), () => {});
      moderatorId = await modApi.getBroadcasterId(); // id du COMPTE DU BOT (propriétaire du token)
      logger.info('Bot : compte dédié "' + conf.botLogin + '" (id ' + moderatorId + ') — pensez à le rendre modérateur (/mod ' + conf.botLogin + ').');
    } catch (e) {
      logger.warn('Bot : token du compte dédié invalide (' + e.message + ') — repli sur le compte du streamer. Reconnectez le compte du bot dans le panneau 🤖 Bot.');
      modApi = api;
      moderatorId = broadcasterId;
    }
  }

  let ws = null;
  let llmFailures = 0;
  let pendingLlm = 0;
  let lastReply = 0;
  const MAX_PENDING = 6;
  const history = [];
  const HISTORY_MAX = 12;
  const goalsFired = { follows: false, subs: false };

  const features = [];
  if (Object.keys(conf.announcements).some((k) => conf.announcements[k].enabled)) features.push('annonces');
  if (conf.goals.follows.enabled || conf.goals.subs.enabled) features.push('objectifs');
  if (conf.bannedWords.enabled && conf.bannedWords.words.length) features.push(conf.bannedWords.words.length + ' mot(s) interdit(s)');
  if (conf.commands.length) features.push(conf.commands.length + ' commande(s)');
  if (conf.aiEnabled) features.push('IA (' + conf.apiUrl + ')');
  logger.info('Bot actif : "' + conf.botName + '" sur #' + channel
    + (hasBotAccount ? ' via le compte ' + conf.botLogin : ' via votre compte')
    + ' · ' + (features.length ? features.join(' · ') : 'aucune fonction activée'));

  // ── File d'envoi (Twitch limite ~20 msg/30s) ──────────────────────────
  const sendQueue = [];
  let sendTimer = null;
  function sendChat(text) {
    const clean = String(text).replace(/[\r\n]+/g, ' ').trim().slice(0, 450);
    if (!clean) return;
    sendQueue.push(clean);
    if (sendQueue.length > 10) sendQueue.shift(); // ne jamais accumuler un retard absurde
    pumpQueue();
  }
  function pumpQueue() {
    if (sendTimer || !sendQueue.length) return;
    if (!ws || ws.readyState !== WebSocket.OPEN) return;
    ws.send('PRIVMSG #' + channel + ' :' + sendQueue.shift());
    sendTimer = setTimeout(() => { sendTimer = null; pumpQueue(); }, 1700);
  }

  // ── Annonces d'événements Twitch (via le relais, pas besoin d'IA) ─────
  function announce(key, vars) {
    const a = conf.announcements[key];
    if (!a || !a.enabled || !a.template) return;
    const msg = renderTemplate(a.template, vars);
    sendChat(msg);
    logger.info('Bot → annonce ' + key + ' : ' + msg);
  }

  function onRelayEvent(obj) {
    const type = obj && obj.event && obj.event.type;
    const d = (obj && obj.data) || {};
    if (!type) return;
    const u = d.user_name || d.from_broadcaster_user_name || '';
    switch (type) {
      case 'Follow':   announce('follow',   { user: u }); break;
      case 'Sub':      announce('sub',      { user: u, months: d.cumulative_months || 1 }); break;
      case 'ReSub':    announce('resub',    { user: u, months: d.cumulative_months || 1, message: d.message || '' }); break;
      case 'GiftSub':  announce('subgift',  { user: u, recipient: d.recipient_user_name || '' }); break;
      case 'GiftBomb': announce('giftbomb', { user: u, amount: d.total || d.amount || 1 }); break;
      case 'Cheer':    announce('cheer',    { user: u, amount: d.bits || 0, message: d.message || '' }); break;
      case 'Raid':     announce('raid',     { user: u, viewers: d.viewers || 0 }); break;
      case 'ChannelPointsRedemption':
        announce('channelPoints', { user: u, reward: (d.reward && d.reward.title) || '' }); break;
      case 'HypeTrainStart':
      case 'HypeTrainLevelUp':
        announce('hypetrain', { level: d.level || 1 }); break;
      case 'Custom':
        if (d.event === 'nkWidgetUpdate' && d.data) checkGoals(d.data);
        break;
    }
  }

  function checkGoals(data) {
    const g = conf.goals;
    if (g.follows.enabled && g.follows.target > 0 && !goalsFired.follows && data.followCurrent >= g.follows.target) {
      goalsFired.follows = true;
      const msg = renderTemplate(g.follows.template, { current: data.followCurrent, target: g.follows.target });
      sendChat(msg);
      logger.info('Bot → objectif follows atteint (' + data.followCurrent + '/' + g.follows.target + ').');
    }
    if (g.subs.enabled && g.subs.target > 0 && !goalsFired.subs && data.subCurrent >= g.subs.target) {
      goalsFired.subs = true;
      const msg = renderTemplate(g.subs.template, { current: data.subCurrent, target: g.subs.target });
      sendChat(msg);
      logger.info('Bot → objectif subs atteint (' + data.subCurrent + '/' + g.subs.target + ').');
    }
  }

  // ── Actions de modération ──────────────────────────────────────────────
  async function applyAction(action, timeoutSec, msgId, userId, user, reason) {
    try {
      if (action === 'delete' && msgId) {
        await modApi.deleteChatMessage(broadcasterId, msgId, moderatorId);
        logger.info('Bot : message de ' + user + ' supprimé — ' + reason);
      } else if (userId) {
        // 'ban' = timeout sans durée (bannissement permanent côté Helix)
        await modApi.timeoutUser(broadcasterId, userId, action === 'ban' ? null : timeoutSec, reason, moderatorId);
        logger.info('Bot : ' + (action === 'ban' ? 'ban permanent' : 'timeout ' + timeoutSec + 's') + ' pour ' + user + ' — ' + reason);
      }
    } catch (e) {
      logger.warn('Bot : action de modération impossible (' + (e && e.message) + ') — '
        + (hasBotAccount ? 'le compte du bot est-il modérateur (/mod ' + conf.botLogin + ') ?' : 'le token a-t-il les scopes moderator:manage:* ?'));
    }
  }

  // ── IA locale ──────────────────────────────────────────────────────────
  async function llm(messages, maxTokens, asJson) {
    const ctrl = new AbortController();
    const to = setTimeout(() => ctrl.abort(), 30000);
    try {
      const res = await fetch(conf.apiUrl.replace(/\/$/, '') + '/chat/completions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: conf.model || 'local-model',
          messages,
          temperature: asJson ? 0.1 : 0.8,
          max_tokens: maxTokens,
          stream: false,
        }),
        signal: ctrl.signal,
      });
      if (!res.ok) throw new Error('HTTP ' + res.status + ' ' + (await res.text().catch(() => '')).slice(0, 200));
      const d = await res.json();
      llmFailures = 0;
      return (d.choices && d.choices[0] && d.choices[0].message && d.choices[0].message.content) || '';
    } finally {
      clearTimeout(to);
    }
  }
  function logLlmError(e) {
    llmFailures++;
    if (llmFailures === 1 || llmFailures % 20 === 0) {
      logger.warn('Bot IA : appel au serveur IA échoué (' + conf.apiUrl + ') — ' + (e && e.message ? e.message : e)
        + (llmFailures === 1 ? ' · LM Studio/llama.cpp est-il lancé avec le serveur activé ?' : ' (×' + llmFailures + ')'));
    }
  }

  async function aiModerate(msgId, userId, user, text) {
    const sys = 'Tu es un modérateur de chat Twitch strict mais juste. '
      + 'Règles du salon — sont INTERDITS : ' + conf.moderation.rules + '. '
      + 'Analyse le message et réponds UNIQUEMENT avec un objet JSON compact, sans aucun autre texte : '
      + '{"action":"ok"} si le message est acceptable, '
      + '{"action":"flag","raison":"explication très courte"} s\'il enfreint les règles. '
      + 'Le second degré, les taquineries amicales et le langage familier sont ACCEPTABLES. En cas de doute, choisis "ok".';
    let verdict = null;
    try {
      const out = await llm([
        { role: 'system', content: sys },
        { role: 'user', content: user + ': ' + text },
      ], 80, true);
      const m = out.match(/\{[\s\S]*\}/);
      if (m) verdict = JSON.parse(m[0]);
    } catch (e) { logLlmError(e); return; }
    if (!verdict || verdict.action !== 'flag') return;
    await applyAction(conf.moderation.action, conf.moderation.timeoutSec, msgId, userId, user,
      'Bot IA : ' + (verdict.raison || 'message contraire aux règles'));
  }

  async function aiReply(user, text) {
    lastReply = Date.now(); // posé AVANT la génération pour bloquer les doublons
    const context = history.slice(-8).map((h) => h.user + ': ' + h.text).join('\n');
    const sys = conf.personality
      + '\nTu participes au chat Twitch de ' + (cfg.twitchLogin || 'ce stream') + '. '
      + 'Réponds au dernier message en ' + Math.max(60, conf.maxReplyLen) + ' caractères MAXIMUM, une seule ligne, sans préfixer ta réponse par ton nom.';
    try {
      const out = await llm([
        { role: 'system', content: sys },
        { role: 'user', content: 'Derniers messages du chat :\n' + context + '\n\nMessage auquel tu réponds — ' + user + ': ' + text },
      ], 120, false);
      const clean = out.trim().replace(/^["']|["']$/g, '').slice(0, conf.maxReplyLen);
      if (clean) {
        sendChat(clean);
        logger.info('Bot IA → chat : ' + clean);
      }
    } catch (e) { logLlmError(e); }
  }

  // ── Traitement des messages du chat ────────────────────────────────────
  function onPrivmsg(msg) {
    const user = msg.tags['display-name'] || msg.prefix.split('!')[0] || '';
    const userLc = user.toLowerCase();
    const text = msg.message || '';
    const msgId = msg.tags['id'];
    const userId = msg.tags['user-id'];
    const isMod = msg.tags['mod'] === '1' || (msg.tags['badges'] || '').indexOf('broadcaster') !== -1;
    const isSelf = userLc === ircLogin || userLc === botNameLc;

    history.push({ user, text });
    if (history.length > HISTORY_MAX) history.shift();
    if (isSelf) return;

    // 1) Mots interdits — instantané, sans IA. Modos et streamer épargnés.
    if (conf.bannedWords.enabled && conf.bannedWords.words.length && !isMod && userLc !== streamerLogin) {
      const hit = findBannedWord(text, conf.bannedWords.words);
      if (hit) {
        applyAction(conf.bannedWords.action, conf.bannedWords.timeoutSec, msgId, userId, user, 'Bot : mot interdit ("' + hit + '")');
        return; // pas d'annonce/réponse sur un message sanctionné
      }
    }

    // 2) Commandes fixes (!discord…) — pour tout le monde.
    const firstWord = text.trim().split(/\s+/)[0].toLowerCase();
    const cmd = conf.commands.find((c) => c.trigger && firstWord === c.trigger.toLowerCase());
    if (cmd && cmd.reply) {
      sendChat(renderTemplate(cmd.reply, { user }));
      return;
    }

    // 3) Modération IA (si activée) — modos et streamer épargnés.
    if (conf.aiEnabled && conf.moderation.enabled && !isMod && userLc !== streamerLogin && pendingLlm < MAX_PENDING) {
      pendingLlm++;
      aiModerate(msgId, userId, user, text).finally(() => { pendingLlm--; });
    }

    // 4) Réponses IA (mention du nom du bot, ou % spontané).
    if (conf.aiEnabled) {
      const mentioned = conf.replyToMentions && text.toLowerCase().indexOf(botNameLc) !== -1;
      const spontaneous = conf.replyChance > 0 && Math.random() * 100 < conf.replyChance;
      const cooled = Date.now() - lastReply > conf.replyCooldownSec * 1000;
      if ((mentioned || spontaneous) && cooled) aiReply(user, text);
    }
  }

  // ── Connexion IRC ──────────────────────────────────────────────────────
  // `stopped` coupe la reconnexion automatique : posé par stop() et après
  // 3 refus d'authentification d'affilée (inutile d'insister, le token est
  // en cause — le message d'erreur dit déjà quoi faire).
  let stopped = false;
  let authFails = 0;
  function connect() {
    if (stopped) return;
    try { ws = new WebSocket('wss://irc-ws.chat.twitch.tv:443'); }
    catch (e) { setTimeout(connect, 5000); return; }

    ws.on('open', () => {
      ws.send('CAP REQ :twitch.tv/tags twitch.tv/commands');
      ws.send('PASS oauth:' + ircToken);
      ws.send('NICK ' + ircLogin);
      ws.send('JOIN #' + channel);
      logger.info('Bot : connecté au chat #' + channel + ' en tant que ' + ircLogin + '.');
      pumpQueue();
    });

    ws.on('message', (data) => {
      String(data).split('\r\n').filter(Boolean).forEach((line) => {
        if (line.startsWith('PING')) { ws.send('PONG :tmi.twitch.tv'); return; }
        const msg = parseIrcLine(line);
        if (!msg) return;
        if (msg.cmd === 'PRIVMSG') { authFails = 0; onPrivmsg(msg); }
        else if (msg.cmd === 'NOTICE' && /login|auth/i.test(msg.message)) {
          authFails++;
          logger.error('Bot : authentification chat refusée (' + msg.message + ') — reconnectez-vous via le ' + whichPanel + '.');
          if (authFails >= 3) {
            stopped = true;
            logger.error('Bot : 3 refus d\'authentification — abandon des reconnexions pour cette session. Corrigez le token puis redémarrez OBS.');
          }
        }
      });
    });

    ws.on('close', () => { if (!stopped) setTimeout(connect, 5000); });
    ws.on('error', () => { try { ws.close(); } catch (e) {} });
  }

  connect();
  return {
    onRelayEvent,
    stop: () => { stopped = true; try { ws && ws.close(); } catch (e) {} },
  };
}

module.exports = { startAiMod, AI_BOT_DEFAULTS: DEFAULTS };
