// ═══════════════════════════════════════════════════════════════════════
// NK.config — Paramètres globaux Twitch.
// Sauvegarde dans config.json à la racine du projet via FSA.
// ═══════════════════════════════════════════════════════════════════════

// ┌─────────────────────────────────────────────────────────────────────┐
// │  CONFIGURATION DU DÉVELOPPEUR  (à remplir une seule fois)          │
// │                                                                     │
// │  1. Créez une app sur https://dev.twitch.tv/console/apps/create    │
// │     • Nom : votre choix                                            │
// │     • Catégorie : Application Integration                          │
// │     • URL de redirection OAuth :                                    │
// │       https://VOTRE_PSEUDO.github.io/Nouilles-Arcana/              │
// │                oauth-callback.html                                  │
// │                                                                     │
// │  2. Copiez le Client ID affiché et collez-le ci-dessous.          │
// │  3. Renseignez aussi TWITCH_REDIRECT avec votre URL GitHub Pages.  │
// │                                                                     │
// │  Ces deux valeurs sont embarquées dans le projet et partagées par  │
// │  tous vos utilisateurs — ils n'ont rien à configurer eux-mêmes.   │
// └─────────────────────────────────────────────────────────────────────┘
const TWITCH_CLIENT_ID  = "";   // ex: "a1b2c3d4e5f6789abcdef0123456789"
const TWITCH_REDIRECT   = "https://NouilleskePastafarian.github.io/Nouilles-Arcana/oauth-callback.html";

// Scopes demandés lors de la connexion. Les quatre derniers servent au
// Bot IA (lire/écrire le chat, supprimer un message, timeout) — les tokens
// émis avant leur ajout déclenchent l'avertissement "Reconnexion nécessaire".
const TWITCH_SCOPES = "bits:read channel:read:subscriptions moderator:read:followers channel:read:hype_train channel:read:redemptions"
  + " chat:read chat:edit moderator:manage:chat_messages moderator:manage:banned_users";

(function () {
  "use strict";

  // Défauts du Bot — miroir de server/src/aiMod.js (DEFAULTS). Le panneau
  // 🤖 Bot (js/bot-panel.js) les consomme via NK.aiBotDefaults.
  const AI_BOT_DEFAULTS = {
    enabled: false,
    botLogin: "",
    botToken: "",
    botName: "NouillesBot",
    aiEnabled: false,
    apiUrl: "http://127.0.0.1:1234/v1",
    model: "",
    personality: "Tu es NouillesBot, le modérateur-mascotte du stream. Tu réponds en français, en une ou deux phrases courtes, sur un ton chaleureux et un peu taquin. Tu ne révèles jamais que tu es une IA sauf si on te le demande directement.",
    replyToMentions: true,
    replyChance: 0,
    replyCooldownSec: 20,
    maxReplyLen: 220,
    moderation: {
      enabled: true,
      action: "timeout",
      timeoutSec: 60,
      rules: "insultes graves ou harcèlement envers quelqu'un, racisme ou discrimination, contenu sexuel explicite, spam répétitif de liens, divulgation d'informations personnelles",
    },
    bannedWords: { enabled: true, words: [], action: "timeout", timeoutSec: 600 },
    commands: [],
    announcements: {
      follow:        { enabled: true,  template: "Merci pour le follow {user} ! 💛" },
      sub:           { enabled: true,  template: "GG {user} pour le sub ! ⭐" },
      resub:         { enabled: true,  template: "{user} remet ça : {months} mois de sub ! ⭐" },
      subgift:       { enabled: true,  template: "{user} offre un sub à {recipient} ! 🎁" },
      giftbomb:      { enabled: true,  template: "{user} lâche {amount} subs pour le chat ! 💥" },
      cheer:         { enabled: true,  template: "Merci {user} pour les {amount} bits ! 💎" },
      raid:          { enabled: true,  template: "Bienvenue aux {viewers} raiders de {user} ! ⚔" },
      channelPoints: { enabled: false, template: "{user} utilise ses points : {reward} ✦" },
      hypetrain:     { enabled: false, template: "HYPE TRAIN niveau {level} !! 🚂" },
    },
    goals: {
      follows: { enabled: false, target: 0, template: "🎉 Objectif follows atteint : {current} ! Merci tout le monde !" },
      subs:    { enabled: false, target: 0, template: "🎉 Objectif subs atteint : {current} ! Vous êtes incroyables !" },
    },
  };

  // Fusion profonde d'un aiBot partiel avec les défauts (aussi utilisée par
  // le panneau 🤖 Bot). Compat : "enabled" seul signifiait autrefois IA active.
  function mergeAiBot(raw) {
    raw = raw || {};
    const deep = (base, extra) => {
      const out = { ...base };
      Object.keys(extra || {}).forEach((k) => {
        if (extra[k] && typeof extra[k] === "object" && !Array.isArray(extra[k]) && base[k] && typeof base[k] === "object" && !Array.isArray(base[k])) {
          out[k] = deep(base[k], extra[k]);
        } else if (extra[k] !== undefined && extra[k] !== null) {
          out[k] = extra[k];
        }
      });
      return out;
    };
    const merged = deep(AI_BOT_DEFAULTS, raw);
    if (raw.enabled && raw.aiEnabled === undefined) merged.aiEnabled = true;
    return merged;
  }
  NK.aiBotDefaults = AI_BOT_DEFAULTS;
  NK.mergeAiBot = mergeAiBot;

  const RESOLUTION_PRESETS = [
    { label: "1080p (1920×1080)", w: 1920, h: 1080 },
    { label: "1440p (2560×1440)", w: 2560, h: 1440 },
    { label: "4K (3840×2160)",    w: 3840, h: 2160 },
    { label: "Vertical (1080×1920)", w: 1080, h: 1920 },
  ];

  const DEFAULT = {
    twitchChannel  : "",
    twitchToken    : "",
    twitchLogin    : "",
    twitchClientId : "",
    resolution     : { w: 1920, h: 1080 },
    aiBot          : AI_BOT_DEFAULTS,
  };

  let _data      = { ...DEFAULT };
  let _callbacks = [];

  // ── API publique ──────────────────────────────────────────────────────
  NK.config = {
    get()         { return { ..._data }; },
    onChange(cb)  { _callbacks.push(cb); return () => { _callbacks = _callbacks.filter(f => f !== cb); }; },
    async reload(){ await _load(); },
    async save(patch) { Object.assign(_data, patch); await _persist(); _notify(); },
  };

  function _notify() {
    _callbacks.forEach(cb => { try { cb({ ..._data }); } catch (e) {} });
  }

  async function _load() {
    const root = NK.core.getRootHandle();
    if (!root) return;
    try {
      const fh   = await root.getFileHandle("config.json");
      const file = await fh.getFile();
      const parsed = JSON.parse(await file.text());
      _data = { ...DEFAULT, ...parsed };
      // Fusions profondes : un config.json partiel ne doit pas perdre les
      // défauts imbriqués.
      _data.aiBot = mergeAiBot(parsed.aiBot);
      _data.resolution = { ...DEFAULT.resolution, ...(parsed.resolution || {}) };
      _notify();
    } catch (e) { /* pas encore créé */ }
  }

  async function _persist() {
    const root = NK.core.getRootHandle();
    if (!root) { alert("Ouvrez d'abord un dossier de projet."); throw new Error("Pas de dossier ouvert"); }
    const fh = await root.getFileHandle("config.json", { create: true });
    const w  = await fh.createWritable();
    await w.write(JSON.stringify(_data, null, 2));
    await w.close();
  }

  document.addEventListener("nk-folder-opened", () => _load());

  // La résolution configurée pilote la taille de la scène de l'éditeur.
  NK.config.onChange((cfg) => {
    if (cfg.resolution) NK.core.setStageSize(cfg.resolution.w, cfg.resolution.h);
  });

  // ── Bouton toolbar ────────────────────────────────────────────────────
  function addToolbarButton() {
    const toolbar  = document.querySelector("#toolbar");
    const firstSep = toolbar.querySelector(".sep");

    const sep = document.createElement("div"); sep.className = "sep";
    const btn = document.createElement("div");
    btn.id            = "nkConfigBtn";
    btn.style.cssText = "font-size:12px;cursor:pointer;padding:6px 10px;border-radius:3px;"
      + "background:rgba(200,146,10,0.1);border:1px solid rgba(200,146,10,0.35);white-space:nowrap;";
    btn.title         = "Configuration Twitch";
    btn.textContent   = "⚙ Twitch";
    btn.onclick       = openPanel;
    toolbar.insertBefore(btn, firstSep);
    toolbar.insertBefore(sep, firstSep);

    NK.config.onChange(cfg => {
      if (cfg.twitchLogin) {
        btn.textContent  = "✓ " + cfg.twitchLogin;
        btn.style.color  = "#8fd080";
        btn.style.borderColor = "rgba(143,208,128,0.5)";
      } else {
        btn.textContent  = "⚙ Twitch";
        btn.style.color  = "";
        btn.style.borderColor = "rgba(200,146,10,0.35)";
      }
    });
  }

  // ── Panneau ───────────────────────────────────────────────────────────
  const PANEL_ID = "nkConfigPanel";
  let _oauthMsgHandler = null;

  async function openPanel() {
    if (document.getElementById(PANEL_ID)) return;
    await _load();
    _renderPanel();
  }

  function closePanel() {
    const el = document.getElementById(PANEL_ID);
    if (el) el.remove();
    if (_oauthMsgHandler) {
      window.removeEventListener("message", _oauthMsgHandler);
      _oauthMsgHandler = null;
    }
  }

  function _getEffectiveClientId() {
    return TWITCH_CLIENT_ID || _data.twitchClientId || localStorage.getItem('nk-twitch-client-id') || '';
  }

  function _renderPanel() {
    const cfg         = _data;
    const connected   = !!(cfg.twitchToken && cfg.twitchLogin);
    const clientId    = _getEffectiveClientId();
    const hasClientId = !!clientId;
    const callbackUrl = TWITCH_REDIRECT;

    const gold   = "#c8920a";
    const goldBd = "rgba(200,146,10,0.4)";
    const goldBg = "rgba(200,146,10,0.1)";
    const inpCss = "background:#0a1322;border:1px solid " + goldBd
      + ";color:#f0e0b0;border-radius:3px;padding:7px 9px;font-size:12px;"
      + "font-family:monospace;box-sizing:border-box;width:100%;";
    const btnPurple = "background:rgba(145,70,255,0.18);border:1px solid rgba(145,70,255,0.5);"
      + "color:#bf9fff;border-radius:3px;padding:6px 12px;cursor:pointer;font-size:11px;"
      + "white-space:nowrap;flex-shrink:0;";

    const overlay = document.createElement("div");
    overlay.id    = PANEL_ID;
    overlay.style.cssText = "position:fixed;inset:0;background:rgba(5,9,18,0.92);"
      + "z-index:1000;display:flex;align-items:center;justify-content:center;";
    overlay.addEventListener("click", e => { if (e.target === overlay) closePanel(); });

    const panel = document.createElement("div");
    panel.style.cssText = "background:#0d1320;border:1px solid " + goldBd + ";"
      + "border-radius:8px;padding:26px;width:480px;max-height:90vh;overflow-y:auto;"
      + "color:#f0e0b0;font-family:'Segoe UI',sans-serif;";

    // ── Assistant pas-à-pas ─────────────────────────────────────────────
    // Chaque étape affiche son état (✓ fait / ● à faire) pour qu'on sache
    // toujours où on en est, et l'étape 2 (création de l'app Twitch) est
    // détaillée champ par champ — c'est là que tout le monde se perd.
    const step1Done = !!cfg.twitchChannel;
    const step2Done = hasClientId;
    const step3Done = connected;
    const stepBadge = (done, n) => done
      ? `<span style="display:inline-flex;align-items:center;justify-content:center;width:22px;height:22px;border-radius:50%;background:rgba(143,208,128,0.15);border:1px solid rgba(143,208,128,0.5);color:#8fd080;font-size:12px;flex-shrink:0;">✓</span>`
      : `<span style="display:inline-flex;align-items:center;justify-content:center;width:22px;height:22px;border-radius:50%;background:${goldBg};border:1px solid ${goldBd};color:${gold};font-size:12px;flex-shrink:0;">${n}</span>`;
    const stepHead = (done, n, title, note) =>
      `<div style="display:flex;align-items:center;gap:10px;margin-bottom:10px;">${stepBadge(done, n)}
        <span style="font-size:12px;font-weight:bold;color:${done ? "#8fd080" : gold};letter-spacing:0.03em;">${title}</span>
        ${note ? `<span style="font-size:10px;opacity:0.45;">${note}</span>` : ""}
      </div>`;
    const subStep = (txt) => `<div style="display:flex;gap:8px;font-size:11px;line-height:1.6;margin-bottom:7px;"><span style="color:${gold};flex-shrink:0;">▸</span><span>${txt}</span></div>`;

    let html = `
      <h2 style="font-size:14px;color:${gold};margin-bottom:8px;letter-spacing:0.04em;">⚙ Connexion Twitch — pas à pas</h2>
      <div style="font-size:11px;opacity:0.55;line-height:1.6;margin-bottom:20px;">
        L'<b>étape 1 suffit pour l'overlay Chat</b>. Les étapes 2 à 4 servent aux
        alertes, aux widgets en direct (follows, subs, viewers…) et au bot IA —
        à faire une seule fois.
      </div>

      <!-- ══ Résolution du stream ══ -->
      <div style="border:1px solid ${goldBd};border-radius:6px;padding:14px;margin-bottom:14px;">
        <div style="display:flex;align-items:center;gap:10px;margin-bottom:10px;">
          <span style="font-size:14px;">🖥</span>
          <span style="font-size:12px;font-weight:bold;color:${gold};letter-spacing:0.03em;">Résolution du stream</span>
          <span style="font-size:10px;opacity:0.45;">la scène de l'éditeur travaille dans ce format</span>
        </div>
        <div style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:8px;">
          ${RESOLUTION_PRESETS.map((p) => `<button type="button" class="resPreset" data-w="${p.w}" data-h="${p.h}"
            style="background:${(cfg.resolution && cfg.resolution.w === p.w && cfg.resolution.h === p.h) ? "rgba(200,146,10,0.35)" : goldBg};border:1px solid ${goldBd};color:${gold};border-radius:3px;padding:5px 10px;cursor:pointer;font-size:10px;">${p.label}</button>`).join("")}
        </div>
        <div style="display:flex;gap:8px;align-items:center;">
          <input id="cfgResW" type="number" min="320" max="7680" value="${esc((cfg.resolution || {}).w || 1920)}" style="${inpCss}width:90px;">
          <span style="opacity:0.5;">×</span>
          <input id="cfgResH" type="number" min="320" max="4320" value="${esc((cfg.resolution || {}).h || 1080)}" style="${inpCss}width:90px;">
          <span style="font-size:10px;opacity:0.4;flex:1;">Réglez la même valeur que la résolution de base (canvas) d'OBS. Vos fichiers déjà créés s'adaptent automatiquement.</span>
        </div>
      </div>

      <!-- ══ ÉTAPE 1 · Chaîne ══ -->
      <div style="border:1px solid ${step1Done ? "rgba(143,208,128,0.3)" : goldBd};border-radius:6px;padding:14px;margin-bottom:14px;">
        ${stepHead(step1Done, 1, "Votre chaîne Twitch", "obligatoire · suffit pour le Chat")}
        <input id="cfgChannel" type="text" value="${esc(cfg.twitchChannel)}"
          placeholder="votre_pseudo_twitch (ex: nouilleske)" style="${inpCss}">
        <div style="font-size:10px;opacity:0.45;margin-top:5px;line-height:1.5;">
          C'est le nom qui apparaît dans l'adresse de votre chaîne : twitch.tv/<b>votre_pseudo</b>.
          Cliquez "Enregistrer" en bas une fois rempli.
        </div>
      </div>

      <!-- ══ ÉTAPE 2 · Créer l'application Twitch ══ -->
      <div style="border:1px solid ${step2Done ? "rgba(143,208,128,0.3)" : goldBd};border-radius:6px;padding:14px;margin-bottom:14px;">
        ${stepHead(step2Done, 2, "Créer votre application Twitch", "5 min · une seule fois")}
        ${step2Done ? `<div style="font-size:11px;color:#8fd080;margin-bottom:10px;">✓ Client ID enregistré — cette étape est faite. Dépliez pour revoir les instructions.</div>` : ""}
        <details ${step2Done ? "" : "open"} style="margin-bottom:10px;">
          <summary style="font-size:11px;color:${gold};cursor:pointer;user-select:none;margin-bottom:8px;">Instructions détaillées</summary>
          <div style="padding:4px 0 0 2px;">
            ${subStep(`Ouvrez <a href="https://dev.twitch.tv/console/apps/create" target="_blank" style="color:#bf9fff;">dev.twitch.tv/console/apps/create</a> et connectez-vous avec votre compte Twitch habituel (activez la double authentification si Twitch vous le demande — c'est obligatoire pour créer une app).`)}
            ${subStep(`<b>Nom</b> : ce que vous voulez, ex. <code style="color:${gold};">Nouilles Arcana Overlay</code> (doit être unique sur Twitch — ajoutez votre pseudo si le nom est pris).`)}
            ${subStep(`<b>URL de redirection OAuth</b> : collez exactement l'URL ci-dessous (bouton 📋) puis cliquez <b>Ajouter</b> :`)}
            <div style="display:flex;gap:6px;align-items:stretch;margin:4px 0 10px 20px;">
              <div id="cfgCallbackUrl"
                style="background:#0a1322;border:1px solid ${goldBd};border-radius:3px;
                padding:7px 9px;font-size:10px;font-family:monospace;word-break:break-all;
                color:#f0e0b0;flex:1;line-height:1.5;">${esc(callbackUrl)}</div>
              <button id="cfgCopyCallback" style="${btnPurple}">📋 Copier</button>
            </div>
            ${subStep(`<b>Catégorie</b> : choisissez <b>Application Integration</b>. · <b>Type de client</b> : <b>Public</b>.`)}
            ${subStep(`Cochez le captcha puis cliquez <b>Créer</b>. Twitch affiche alors la page de votre app.`)}
            ${subStep(`Sur cette page, copiez l'<b>Identifiant client</b> (Client ID) — une longue suite de lettres et chiffres. <i>Le "secret client" n'est PAS nécessaire, ne le générez pas.</i>`)}
          </div>
        </details>
        <label style="font-size:10px;opacity:0.6;display:block;margin-bottom:6px;">
          Collez le Client ID ici :
        </label>
        <input id="cfgClientId" type="text"
          value="${esc(clientId)}"
          placeholder="ex: a1b2c3d4e5f6789abcdef0123456789"
          ${TWITCH_CLIENT_ID ? 'disabled title="Client ID intégré dans le code source"' : ''}
          style="${inpCss}${TWITCH_CLIENT_ID ? 'opacity:0.55;cursor:not-allowed;' : ''}">
        ${step2Done ? "" : `<div style="font-size:10px;opacity:0.45;margin-top:5px;">Puis cliquez "Enregistrer" en bas — le bouton de connexion de l'étape 3 apparaîtra.</div>`}
      </div>

      <!-- ══ ÉTAPE 3 · Autoriser l'accès ══ -->
      <div style="border:1px solid ${step3Done ? "rgba(143,208,128,0.3)" : goldBd};border-radius:6px;padding:14px;margin-bottom:14px;">
        ${stepHead(step3Done, 3, "Autoriser l'accès à votre chaîne", "alertes, follows, subs…")}
    `;

    // ── État de connexion (contenu de l'étape 3) ───────────────────────
    if (connected) {
      html += `
        <div style="background:rgba(143,208,128,0.07);border:1px solid rgba(143,208,128,0.28);
          border-radius:6px;padding:14px 16px;margin-bottom:12px;">
          <div style="color:#8fd080;font-size:13px;font-weight:bold;margin-bottom:4px;">
            ✓ Connecté en tant que ${esc(cfg.twitchLogin)}
          </div>
          <div style="font-size:11px;opacity:0.55;">Tout est prêt : les alertes et les widgets peuvent utiliser cette connexion.</div>
        </div>
        <div id="cfgScopeWarning"></div>
        <button id="cfgDisconnect"
          style="background:rgba(200,40,40,0.1);border:1px solid rgba(200,40,40,0.35);
          color:#e07070;border-radius:3px;padding:7px 14px;cursor:pointer;font-size:11px;">
          Déconnecter
        </button>
      `;
    } else if (hasClientId) {
      html += `
        <div style="font-size:11px;opacity:0.6;margin-bottom:12px;line-height:1.6;">
          Une fenêtre Twitch va s'ouvrir : vérifiez que c'est bien votre compte,
          cliquez <b>Autoriser</b>, la fenêtre se ferme toute seule et vous êtes connecté.
        </div>
        <button id="cfgOAuth"
          style="width:100%;background:rgba(145,70,255,0.18);border:1px solid rgba(145,70,255,0.5);
          color:#bf9fff;border-radius:5px;padding:12px;font-size:13px;cursor:pointer;
          font-family:'Segoe UI',sans-serif;margin-bottom:6px;">
          🟣 &nbsp; Se connecter avec Twitch
        </button>
        <div id="cfgOAuthStatus" style="font-size:11px;min-height:20px;margin-bottom:2px;line-height:1.5;"></div>
      `;
    } else {
      html += `
        <div style="font-size:11px;opacity:0.4;line-height:1.6;font-style:italic;">
          Terminez d'abord l'étape 2 (Client ID) — le bouton de connexion apparaîtra ici.
        </div>
      `;
    }
    html += `</div>`; // fin étape 3

    // ── ÉTAPE 4 · Relais OBS (plug-and-play) ────────────────────────────
    html += `
      <div style="border:1px solid ${goldBd};border-radius:6px;padding:14px;margin-bottom:14px;">
        ${stepHead(false, 4, "Lancer le relais avec OBS", "démarre/s'arrête tout seul avec OBS")}
        <div style="font-size:11px;opacity:0.6;line-height:1.6;margin-bottom:10px;">
          Le relais (nk-relay) est le petit programme qui relie Twitch à vos overlays
          (alertes, widgets en direct, bot IA). Grâce au script OBS ci-dessous, il se lance
          <b>automatiquement à l'ouverture d'OBS</b> et se ferme avec lui — rien à penser.
        </div>
        <details>
          <summary style="font-size:11px;color:${gold};cursor:pointer;user-select:none;margin-bottom:8px;">Instructions détaillées</summary>
          <div style="padding:4px 0 0 2px;">
            ${subStep(`<b>Une seule fois</b> : double-cliquez sur <code style="color:${gold};">Nouilles-Arcana/server/build.bat</code> et attendez « Build termine ». Ça fabrique <code style="color:${gold};">server/dist/nk-relay.exe</code>. (À refaire uniquement après une mise à jour du projet.)`)}
            ${subStep(`Dans OBS : menu <b>Outils → Scripts</b> → bouton <b>+</b> → sélectionnez <code style="color:${gold};">Nouilles-Arcana/obs/nk-relay.lua</code>.`)}
            ${subStep(`Dans les propriétés du script, champ <b>« Dossier du projet »</b> : choisissez le dossier qui contient <code style="color:${gold};">config.json</code> — c'est le dossier <b>parent</b> de Nouilles-Arcana, PAS Nouilles-Arcana lui-même.`)}
            ${subStep(`Redémarrez OBS (ou cliquez le bouton <b>« Tester la connexion »</b> du script) : le relais tourne alors en arrière-plan, sans fenêtre.`)}
            ${subStep(`En cas de doute : le fichier <code style="color:${gold};">nk-relay.log</code> apparaît à côté de config.json et raconte tout ce que fait le relais (connexion Twitch, alertes reçues, bot IA…).`)}
          </div>
        </details>
      </div>
    `;

    // ── 🤖 Bot : renvoi vers son panneau dédié ──────────────────────────
    html += `
      <div style="border:1px solid rgba(145,70,255,0.35);border-radius:6px;padding:14px;margin-bottom:14px;">
        <div style="display:flex;align-items:center;gap:10px;">
          <span style="font-size:16px;">🤖</span>
          <div style="flex:1;">
            <div style="font-size:12px;font-weight:bold;color:#bf9fff;letter-spacing:0.03em;margin-bottom:3px;">Bot du stream</div>
            <div style="font-size:10px;opacity:0.5;line-height:1.5;">Annonces automatiques, mots interdits, commandes, IA locale, compte dédié…
            Tout se configure et se teste dans le panneau <b>🤖 Bot</b> de la barre d'outils.</div>
          </div>
        </div>
      </div>
    `;

    // ── Dépannage ────────────────────────────────────────────────────────
    html += `
      <details style="margin-bottom:16px;">
        <summary style="font-size:11px;color:${gold};cursor:pointer;user-select:none;">🛟 Ça ne marche pas ? Dépannage</summary>
        <div style="font-size:11px;line-height:1.7;opacity:0.75;padding:10px 2px 0;">
          <b>« redirect_uri does not match »</b> — l'URL de redirection dans votre app Twitch n'est pas
          exactement celle de l'étape 2. Retournez sur
          <a href="https://dev.twitch.tv/console/apps" target="_blank" style="color:#bf9fff;">dev.twitch.tv/console/apps</a>
          → Gérer → recollez l'URL (sans espace ni / en trop) → Enregistrer.<br><br>
          <b>« invalid client »</b> — le Client ID est mal copié (caractère manquant ou espace).
          Recopiez-le depuis la page de votre app.<br><br>
          <b>La fenêtre ne s'ouvre pas</b> — votre navigateur bloque les popups :
          autorisez-les pour cette page (icône dans la barre d'adresse), puis recliquez.<br><br>
          <b>La fenêtre s'ouvre mais rien ne se passe après "Autoriser"</b> — la page de retour
          (oauth-callback.html) doit être accessible en ligne (GitHub Pages). Vérifiez que
          l'URL de l'étape 2 s'ouvre dans un onglet sans erreur 404.<br><br>
          <b>« Reconnexion nécessaire »</b> — une mise à jour a ajouté de nouvelles permissions.
          Cliquez Déconnecter puis reconnectez-vous, c'est tout.<br><br>
          <b>Les alertes ne se déclenchent pas en stream</b> — la connexion sert au relais
          (nk-relay) : vérifiez qu'il est lancé (script OBS de l'étape 4 ou nk-relay.exe) et que la
          Browser Source pointe vers le bon fichier.<br><br>
          <b>Le relais ne démarre pas avec OBS</b> — ouvrez Outils → Scripts, sélectionnez
          nk-relay.lua et regardez le journal des scripts : il dit précisément ce qui manque
          (exe non compilé, mauvais dossier de projet, config.json absent).<br><br>
          <b>Le bot IA ne modère pas / ne répond pas</b> — 1) le serveur IA local doit être
          lancé (LM Studio : onglet Developer → Start Server) ; 2) le relais doit avoir été
          redémarré après activation du bot (redémarrez OBS) ; 3) le token doit avoir les
          nouveaux scopes chat/modération — si l'avertissement « Reconnexion nécessaire »
          s'affiche ci-dessus, déconnectez/reconnectez ; 4) le détail est dans nk-relay.log.
        </div>
      </details>
    `;

    // ── Boutons du bas ──────────────────────────────────────────────────
    html += `
      <div id="cfgStatus" style="font-size:11px;min-height:18px;margin-bottom:14px;line-height:1.5;"></div>
      <div style="display:flex;gap:8px;justify-content:flex-end;">
        <button id="cfgCancel"
          style="background:rgba(200,40,40,0.1);border:1px solid rgba(200,40,40,0.35);
          color:#e07070;border-radius:3px;padding:8px 16px;cursor:pointer;font-size:11px;">
          Fermer
        </button>
        <button id="cfgSave"
          style="background:rgba(200,146,10,0.18);border:1px solid rgba(200,146,10,0.6);
          color:${gold};border-radius:3px;padding:8px 20px;cursor:pointer;
          font-size:12px;font-weight:bold;">
          Enregistrer
        </button>
      </div>
    `;

    panel.innerHTML = html;
    overlay.appendChild(panel);
    document.body.appendChild(overlay);

    // ── Liaisons ─────────────────────────────────────────────────────────
    function setStatus(h) {
      const el = document.getElementById("cfgStatus");
      if (el) el.innerHTML = h;
    }

    document.getElementById("cfgCancel").onclick = closePanel;

    document.getElementById("cfgSave").onclick = async () => {
      const btn = document.getElementById("cfgSave");
      btn.disabled    = true;
      btn.textContent = "…";
      try {
        // Persiste le Client ID dans config.json (lisible par le serveur relais headless)
        // et dans localStorage (fallback/compat si le dossier n'est pas encore ouvert).
        let cid = "";
        if (!TWITCH_CLIENT_ID) {
          cid = (document.getElementById("cfgClientId") || {}).value.trim() || "";
          if (cid) localStorage.setItem('nk-twitch-client-id', cid);
          else localStorage.removeItem('nk-twitch-client-id');
        }
        const resW = parseInt((document.getElementById("cfgResW") || {}).value, 10) || 1920;
        const resH = parseInt((document.getElementById("cfgResH") || {}).value, 10) || 1080;
        await NK.config.save({
          twitchChannel:  document.getElementById("cfgChannel").value.trim(),
          twitchClientId: TWITCH_CLIENT_ID || cid,
          resolution: { w: Math.max(320, resW), h: Math.max(320, resH) },
        });
        closePanel();
        // Ré-ouvre si le clientId vient d'être renseigné (pour afficher le bouton OAuth)
        if (!hasClientId && _getEffectiveClientId()) openPanel();
      } catch (e) {
        btn.disabled    = false;
        btn.textContent = "Enregistrer";
        setStatus(`<span style="color:#e07070;">⚠ ${esc(e.message)}</span>`);
      }
    };

    // Copier URL callback
    const copyCallbackBtn = document.getElementById("cfgCopyCallback");
    if (copyCallbackBtn) {
      copyCallbackBtn.onclick = () => {
        navigator.clipboard.writeText(callbackUrl).then(() => {
          copyCallbackBtn.textContent = "✓ Copié !";
          setTimeout(() => { copyCallbackBtn.textContent = "📋 Copier"; }, 2000);
        });
      };
    }

    // Déconnecter
    const disconnectBtn = document.getElementById("cfgDisconnect");
    if (disconnectBtn) {
      disconnectBtn.onclick = async () => {
        await NK.config.save({ twitchToken: "", twitchLogin: "" });
        closePanel(); _renderPanel();
      };
    }

    // Bouton OAuth
    const oauthBtn = document.getElementById("cfgOAuth");
    if (oauthBtn) {
      oauthBtn.onclick = () => _startOAuth(oauthBtn);
    }

    // Préréglages de résolution → remplissent les champs largeur/hauteur.
    document.querySelectorAll("#" + PANEL_ID + " .resPreset").forEach((b) => {
      b.onclick = () => {
        const w = document.getElementById("cfgResW"), h = document.getElementById("cfgResH");
        if (w) w.value = b.dataset.w;
        if (h) h.value = b.dataset.h;
      };
    });

    // Détection de scopes manquants (ex: ajout ultérieur de channel:read:redemptions) —
    // les tokens déjà émis ne gagnent pas rétroactivement un nouveau scope.
    if (connected) _checkScopes(cfg.twitchToken);
  }

  async function _checkScopes(token) {
    const el = document.getElementById("cfgScopeWarning");
    if (!el || !token) return;
    try {
      const res = await fetch("https://id.twitch.tv/oauth2/validate", {
        headers: { Authorization: "OAuth " + token.replace(/^oauth:/, "") },
      });
      if (!res.ok) return;
      const d = await res.json();
      const granted = d.scopes || [];
      const missing = TWITCH_SCOPES.split(" ").filter(s => granted.indexOf(s) === -1);
      if (!missing.length) return;
      el.innerHTML = `
        <div style="background:rgba(255,200,0,0.06);border:1px solid rgba(255,200,0,0.25);
          border-radius:5px;padding:10px 12px;margin-bottom:12px;font-size:11px;line-height:1.6;">
          <span style="color:#f0c040;">⚠ Reconnexion nécessaire</span> pour activer :
          ${esc(missing.join(", "))} — cliquez "Déconnecter" puis reconnectez-vous.
        </div>
      `;
    } catch (e) { /* pas critique — pas de connexion réseau, on ignore */ }
  }

  // ── Flux OAuth générique (réutilisé par le panneau 🤖 Bot pour le compte
  //    dédié du bot). onDone(token, login, errMsg) — token SANS préfixe oauth:.
  NK.twitchOAuth = function (onDone) {
    const cid = _getEffectiveClientId();
    if (!cid) { onDone(null, null, "Client ID manquant — faites d'abord l'étape 2 du panneau ⚙ Twitch."); return; }
    const url = "https://id.twitch.tv/oauth2/authorize"
      + "?client_id="    + encodeURIComponent(cid)
      + "&redirect_uri=" + encodeURIComponent(TWITCH_REDIRECT)
      + "&response_type=token"
      + "&scope="        + encodeURIComponent(TWITCH_SCOPES)
      + "&force_verify=true";
    window.open(url, "twitch-oauth", "width=560,height=700,left=300,top=150");
    const handler = async (e) => {
      if (!e.data || e.data.type !== "nk-oauth-token") return;
      window.removeEventListener("message", handler);
      const token = e.data.token;
      try {
        const res = await fetch("https://id.twitch.tv/oauth2/validate", { headers: { Authorization: "OAuth " + token } });
        if (!res.ok) { onDone(null, null, "Twitch a refusé le token — réessayez."); return; }
        const d = await res.json();
        onDone(token, d.login, null);
      } catch (err) { onDone(null, null, err.message); }
    };
    window.addEventListener("message", handler);
  };

  // ── Flux OAuth popup ──────────────────────────────────────────────────
  function _startOAuth(btn) {
    const effectiveClientId = _getEffectiveClientId();
    const url = "https://id.twitch.tv/oauth2/authorize"
      + "?client_id="    + encodeURIComponent(effectiveClientId)
      + "&redirect_uri=" + encodeURIComponent(TWITCH_REDIRECT)
      + "&response_type=token"
      + "&scope="        + encodeURIComponent(TWITCH_SCOPES)
      + "&force_verify=true";

    if (btn) {
      btn.disabled     = true;
      btn.style.opacity = "0.6";
      btn.textContent  = "En attente de la connexion Twitch…";
    }
    const statusEl = document.getElementById("cfgOAuthStatus");
    if (statusEl) statusEl.innerHTML = '<span style="opacity:0.55;">Fenêtre Twitch ouverte — cliquez "Autoriser", cette fenêtre se fermera automatiquement.</span>';

    window.open(url, "twitch-oauth", "width=560,height=700,left=300,top=150");

    if (_oauthMsgHandler) window.removeEventListener("message", _oauthMsgHandler);
    _oauthMsgHandler = async (e) => {
      if (!e.data || e.data.type !== "nk-oauth-token") return;
      window.removeEventListener("message", _oauthMsgHandler);
      _oauthMsgHandler = null;

      if (statusEl) statusEl.innerHTML = '<span style="opacity:0.55;">Token reçu, vérification…</span>';
      const token = e.data.token;
      try {
        const res = await fetch("https://id.twitch.tv/oauth2/validate", {
          headers: { Authorization: "OAuth " + token },
        });
        if (res.ok) {
          const d = await res.json();
          await NK.config.save({ twitchToken: "oauth:" + token, twitchLogin: d.login });
          closePanel();
          _renderPanel();
        } else {
          if (statusEl) statusEl.innerHTML = '<span style="color:#e07070;">✗ Connexion échouée. Réessayez.</span>';
          if (btn) { btn.disabled = false; btn.style.opacity = "1"; btn.textContent = "🟣  Se connecter avec Twitch"; }
        }
      } catch (e2) {
        if (statusEl) statusEl.innerHTML = `<span style="color:#e07070;">⚠ ${esc(e2.message)}</span>`;
      }
    };
    window.addEventListener("message", _oauthMsgHandler);
  }

  function esc(str) {
    return String(str || "")
      .replace(/&/g, "&amp;").replace(/</g, "&lt;")
      .replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  }

  addToolbarButton();
})();
