// ═══════════════════════════════════════════════════════════════════════
// Panneau 🤖 Bot — configuration complète du bot du stream + simulateur.
//
// Colonne gauche : toute la config (compte dédié, annonces, objectifs,
// mots interdits, commandes, IA locale), enregistrée dans config.json
// (section aiBot) et lue par le relais (server/src/aiMod.js).
//
// Colonne droite : un chat simulé qui rejoue la VRAIE logique du bot avec
// les réglages actuels du formulaire (même non enregistrés) :
//   • taper un message → mots interdits (sanction affichée), commandes !xxx,
//     et vraies réponses IA si le serveur local est joignable ;
//   • boutons d'événements → l'annonce exactement telle qu'elle partirait.
//
// ⚠ renderTemplate() et findBannedWord() sont des copies conformes de
// server/src/aiMod.js — garder les deux en phase.
// ═══════════════════════════════════════════════════════════════════════
(function () {
  "use strict";

  const PANEL_ID = "nkBotPanel";
  const gold = "#c8920a";
  const goldBd = "rgba(200,146,10,0.4)";
  const purple = "#bf9fff";
  const purpleBd = "rgba(145,70,255,0.45)";
  const inpCss = "background:#0a1322;border:1px solid " + goldBd
    + ";color:#f0e0b0;border-radius:3px;padding:6px 8px;font-size:11px;"
    + "font-family:monospace;box-sizing:border-box;width:100%;";
  const areaCss = inpCss + "resize:vertical;min-height:52px;font-family:'Segoe UI',sans-serif;";
  const btnPurple = "background:rgba(145,70,255,0.18);border:1px solid " + purpleBd + ";"
    + "color:" + purple + ";border-radius:3px;padding:5px 10px;cursor:pointer;font-size:10px;white-space:nowrap;";
  const btnGold = "background:rgba(200,146,10,0.15);border:1px solid " + goldBd + ";"
    + "color:" + gold + ";border-radius:3px;padding:5px 10px;cursor:pointer;font-size:10px;white-space:nowrap;";

  function esc(str) {
    return String(str == null ? "" : str)
      .replace(/&/g, "&amp;").replace(/</g, "&lt;")
      .replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  }

  // ── Copies conformes de server/src/aiMod.js ─────────────────────────────
  function renderTemplate(tpl, vars) {
    return String(tpl || "").replace(/\{(\w+)\}/g, (m, k) => (vars[k] !== undefined && vars[k] !== null) ? String(vars[k]) : m);
  }
  function normalizeWord(s) {
    return String(s).toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
  }
  function findBannedWord(text, words) {
    const norm = " " + normalizeWord(text).replace(/[^a-z0-9]+/g, " ") + " ";
    for (const w of words) {
      const nw = normalizeWord(w).trim();
      if (!nw) continue;
      if (norm.indexOf(" " + nw + " ") !== -1) return w;
    }
    return null;
  }

  const ANNOUNCE_DEFS = [
    { key: "follow",        label: "♥ Nouveau follower",  vars: "{user}" },
    { key: "sub",           label: "★ Nouveau sub",        vars: "{user} {months}" },
    { key: "resub",         label: "★ Resub",              vars: "{user} {months} {message}" },
    { key: "subgift",       label: "🎁 Sub offert",        vars: "{user} {recipient}" },
    { key: "giftbomb",      label: "💥 Rafale de subs",    vars: "{user} {amount}" },
    { key: "cheer",         label: "💎 Bits",              vars: "{user} {amount} {message}" },
    { key: "raid",          label: "⚔ Raid",               vars: "{user} {viewers}" },
    { key: "channelPoints", label: "✦ Points de chaîne",   vars: "{user} {reward}" },
    { key: "hypetrain",     label: "🚂 Hype train",        vars: "{level}" },
  ];
  const SIM_EVENTS = [
    { key: "follow",        label: "♥ Follow",  vars: { user: "Nouille_Fan" } },
    { key: "sub",           label: "★ Sub",     vars: { user: "Ramen_Lover", months: 1 } },
    { key: "resub",         label: "★ Resub",   vars: { user: "Fidele_Du_Bouillon", months: 7, message: "toujours là !" } },
    { key: "subgift",       label: "🎁 Gift",   vars: { user: "GenereuxGourmet", recipient: "PetitNouveau" } },
    { key: "giftbomb",      label: "💥 Bomb",   vars: { user: "BigSpender", amount: 10 } },
    { key: "cheer",         label: "💎 Bits",   vars: { user: "Etinceleuse", amount: 500, message: "GG !" } },
    { key: "raid",          label: "⚔ Raid",    vars: { user: "StreamVoisin", viewers: 142 } },
  ];

  // État du panneau (survit tant que la page vit, pas au-delà)
  let acctToken = "";  // token du compte dédié (format oauth:xxx en stockage)
  let acctLogin = "";
  let cmds = [];       // [{trigger, reply}]
  let simHistory = [];

  // ── Bouton dans la barre d'outils ───────────────────────────────────────
  (function addToolbarButton() {
    const toolbar = document.querySelector("#toolbar");
    const configBtn = document.getElementById("nkConfigBtn");
    const btn = document.createElement("div");
    btn.id = "nkBotBtn";
    btn.style.cssText = "font-size:12px;cursor:pointer;padding:6px 10px;border-radius:3px;"
      + "background:rgba(145,70,255,0.12);border:1px solid " + purpleBd + ";white-space:nowrap;color:" + purple + ";";
    btn.title = "Bot du stream — annonces, modération, IA locale";
    btn.textContent = "🤖 Bot";
    btn.onclick = openPanel;
    // Juste après le bouton ⚙ Twitch pour regrouper la configuration.
    if (configBtn && configBtn.nextSibling) toolbar.insertBefore(btn, configBtn.nextSibling);
    else toolbar.appendChild(btn);
  })();

  async function openPanel() {
    if (document.getElementById(PANEL_ID)) return;
    await NK.config.reload();
    render();
  }
  function closePanel() {
    const el = document.getElementById(PANEL_ID);
    if (el) el.remove();
  }

  // ═════════════════════════════════════════════════════════════════════
  // RENDU
  // ═════════════════════════════════════════════════════════════════════
  function render() {
    const bot = NK.mergeAiBot(NK.config.get().aiBot);
    acctToken = bot.botToken || "";
    acctLogin = bot.botLogin || "";
    cmds = (bot.commands || []).map((c) => ({ trigger: c.trigger || "", reply: c.reply || "" }));
    simHistory = [];

    const overlay = document.createElement("div");
    overlay.id = PANEL_ID;
    overlay.style.cssText = "position:fixed;inset:0;background:rgba(5,9,18,0.92);z-index:1000;display:flex;align-items:center;justify-content:center;";
    overlay.addEventListener("click", (e) => { if (e.target === overlay) closePanel(); });

    const panel = document.createElement("div");
    panel.style.cssText = "background:#0d1320;border:1px solid " + purpleBd + ";border-radius:8px;"
      + "width:min(960px, 96vw);height:min(720px, 92vh);display:flex;flex-direction:column;overflow:hidden;"
      + "color:#f0e0b0;font-family:'Segoe UI',sans-serif;";

    const sec = (title, body, open) =>
      `<details ${open ? "open" : ""} style="border:1px solid ${goldBd};border-radius:5px;margin-bottom:10px;">
        <summary style="padding:9px 12px;font-size:11px;color:${gold};cursor:pointer;user-select:none;background:rgba(200,146,10,0.06);">${title}</summary>
        <div style="padding:10px 12px;">${body}</div>
      </details>`;
    const chkRow = (id, label, checked, hint) =>
      `<label style="display:flex;align-items:flex-start;gap:8px;font-size:11px;margin-bottom:8px;cursor:pointer;">
        <input type="checkbox" id="${id}" ${checked ? "checked" : ""} style="accent-color:${gold};margin-top:2px;">
        <span>${label}${hint ? `<br><span style="opacity:0.45;font-size:10px;">${hint}</span>` : ""}</span>
      </label>`;
    const lbl = (t) => `<label style="font-size:10px;opacity:0.6;display:block;margin-bottom:3px;">${t}</label>`;

    // ── Sections de config ──
    const acctBody = `
      <div id="bpAcctStatus" style="font-size:11px;line-height:1.6;margin-bottom:8px;"></div>
      <div style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:8px;">
        <button type="button" id="bpAcctConnect" style="${btnPurple}">🟣 Connecter le compte du bot</button>
        <button type="button" id="bpAcctRemove" style="${btnGold}">✕ Utiliser mon compte à la place</button>
      </div>
      <div style="font-size:10px;opacity:0.45;line-height:1.6;">
        Créez un compte Twitch normal pour votre bot (pseudo à son nom), rendez-le modérateur
        de votre chaîne en tapant <code style="color:${gold};">/mod pseudo_du_bot</code> dans votre chat,
        puis cliquez « Connecter » : dans la fenêtre Twitch, <b>connectez-vous avec le compte du bot</b>
        (pas le vôtre). Sans compte dédié, le bot parle avec votre compte — ça marche aussi.
      </div>
      <details style="margin-top:10px;border-top:1px solid rgba(145,70,255,0.2);padding-top:8px;">
        <summary style="font-size:10px;color:${purple};cursor:pointer;user-select:none;">
          🕶 La fenêtre Twitch ouvre <b>votre</b> compte au lieu de celui du bot ?
        </summary>
        <div style="font-size:10px;opacity:0.75;line-height:1.8;padding:8px 0 2px;">
          C'est normal : Twitch réutilise la session de votre navigateur. La solution est de passer
          par une <b>fenêtre de navigation privée</b>, qui n'a aucune session mémorisée :<br>
          <b>1.</b> <button type="button" id="bpAcctCopyUrl" style="${btnPurple}">📋 Copier le lien de connexion</button>
          <span id="bpAcctCopyStatus"></span><br>
          <b>2.</b> Ouvrez une fenêtre privée — <code style="color:${gold};">Ctrl+Maj+N</code> (Chrome/Edge)
          ou <code style="color:${gold};">Ctrl+Maj+P</code> (Firefox) — et collez-y le lien.<br>
          <b>3.</b> Connectez-vous avec le <b>compte du bot</b> puis cliquez « Autoriser ».<br>
          <b>4.</b> La page affiche un code de connexion — copiez-le et collez-le ici :
          <div style="display:flex;gap:6px;margin-top:6px;">
            <input type="text" id="bpAcctPaste" placeholder="collez le code de connexion ici" style="${inpCss}flex:1;">
            <button type="button" id="bpAcctPasteOk" style="${btnPurple}">Valider</button>
          </div>
          <div id="bpAcctPasteStatus" style="min-height:14px;margin-top:4px;"></div>
        </div>
      </details>`;

    const annBody = `
      <div style="font-size:10px;opacity:0.5;margin-bottom:8px;line-height:1.5;">Le bot écrit ces messages dans le chat quand l'événement arrive — aucune IA nécessaire. Variables entre accolades remplacées automatiquement.</div>
      ${ANNOUNCE_DEFS.map((a) => `
        <div style="display:flex;align-items:center;gap:8px;margin-bottom:7px;">
          <input type="checkbox" id="bpAnn_${a.key}" ${bot.announcements[a.key].enabled ? "checked" : ""} style="accent-color:${gold};flex-shrink:0;">
          <span style="font-size:10px;width:118px;flex-shrink:0;" title="Variables : ${esc(a.vars)}">${a.label}</span>
          <input type="text" id="bpAnnT_${a.key}" value="${esc(bot.announcements[a.key].template)}" title="Variables : ${esc(a.vars)}" style="${inpCss}flex:1;">
        </div>`).join("")}`;

    const goalBody = `
      <div style="font-size:10px;opacity:0.5;margin-bottom:8px;line-height:1.5;">Annonce unique quand le cap est franchi (compteurs du relais, rafraîchis toutes les 30 s). Variables : {current} {target}.</div>
      <div style="display:flex;align-items:center;gap:8px;margin-bottom:7px;">
        <input type="checkbox" id="bpGoalF" ${bot.goals.follows.enabled ? "checked" : ""} style="accent-color:${gold};">
        <span style="font-size:10px;width:70px;">Follows ≥</span>
        <input type="number" id="bpGoalFT" min="0" value="${esc(bot.goals.follows.target)}" style="${inpCss}width:80px;">
        <input type="text" id="bpGoalFM" value="${esc(bot.goals.follows.template)}" style="${inpCss}flex:1;">
      </div>
      <div style="display:flex;align-items:center;gap:8px;">
        <input type="checkbox" id="bpGoalS" ${bot.goals.subs.enabled ? "checked" : ""} style="accent-color:${gold};">
        <span style="font-size:10px;width:70px;">Subs ≥</span>
        <input type="number" id="bpGoalST" min="0" value="${esc(bot.goals.subs.target)}" style="${inpCss}width:80px;">
        <input type="text" id="bpGoalSM" value="${esc(bot.goals.subs.template)}" style="${inpCss}flex:1;">
      </div>`;

    const banBody = `
      ${chkRow("bpBanEnabled", "Sanctionner automatiquement ces mots (sans IA, instantané)", bot.bannedWords.enabled, "vous et vos modérateurs n'êtes jamais sanctionnés")}
      ${lbl("Un mot ou une expression par ligne (accents et majuscules ignorés)")}
      <textarea id="bpBanWords" style="${areaCss}margin-bottom:8px;" placeholder="mot1&#10;expression interdite&#10;mot2">${esc((bot.bannedWords.words || []).join("\n"))}</textarea>
      <div style="display:flex;gap:8px;align-items:center;">
        ${lbl("Sanction")}
        <select id="bpBanAction" style="${inpCss}width:auto;flex:1;">
          <option value="timeout" ${bot.bannedWords.action === "timeout" ? "selected" : ""}>Timeout</option>
          <option value="delete" ${bot.bannedWords.action === "delete" ? "selected" : ""}>Supprimer le message</option>
          <option value="ban" ${bot.bannedWords.action === "ban" ? "selected" : ""}>Ban permanent</option>
        </select>
        <span style="font-size:10px;opacity:0.6;">durée (s)</span>
        <input type="number" id="bpBanTimeout" min="5" value="${esc(bot.bannedWords.timeoutSec)}" style="${inpCss}width:80px;">
      </div>`;

    const cmdBody = `
      <div style="font-size:10px;opacity:0.5;margin-bottom:8px;line-height:1.5;">Réponses fixes aux commandes tapées dans le chat (ex : !discord). Variable disponible : {user}.</div>
      <div id="bpCmdList"></div>
      <button type="button" id="bpCmdAdd" style="${btnGold}">+ Ajouter une commande</button>`;

    const aiBody = `
      ${chkRow("bpAiEnabled", "<b>Utiliser une IA locale</b> (modération par jugement + réponses en chat)", bot.aiEnabled, "LM Studio, llama.cpp, Ollama… gratuit et privé, tourne sur votre machine")}
      ${lbl("Serveur IA local (API compatible OpenAI)")}
      <input type="text" id="bpApiUrl" value="${esc(bot.apiUrl)}" style="${inpCss}margin-bottom:5px;">
      <div style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:6px;">
        <button type="button" class="bpPreset" data-url="http://127.0.0.1:1234/v1" style="${btnPurple}">LM Studio</button>
        <button type="button" class="bpPreset" data-url="http://127.0.0.1:8080/v1" style="${btnPurple}">llama.cpp</button>
        <button type="button" class="bpPreset" data-url="http://127.0.0.1:11434/v1" style="${btnPurple}">Ollama</button>
        <button type="button" id="bpAiTest" style="${btnPurple}">🔌 Tester</button>
      </div>
      <div id="bpAiTestStatus" style="font-size:10px;min-height:14px;margin-bottom:8px;line-height:1.5;"></div>
      ${lbl("Nom du modèle (vide = modèle chargé par défaut)")}
      <input type="text" id="bpModel" value="${esc(bot.model)}" placeholder="ex: hermes-3-llama-3.1-8b" style="${inpCss}margin-bottom:8px;">
      ${lbl("Personnalité (consigne donnée à l'IA)")}
      <textarea id="bpPersonality" style="${areaCss}margin-bottom:10px;">${esc(bot.personality)}</textarea>
      <div style="border-top:1px solid rgba(145,70,255,0.2);padding-top:8px;margin-bottom:8px;">
        <div style="font-size:11px;color:${purple};margin-bottom:6px;">🛡 Modération par l'IA</div>
        ${chkRow("bpAiModEnabled", "L'IA juge chaque message selon vos règles", bot.moderation.enabled)}
        <div style="display:flex;gap:8px;align-items:center;margin-bottom:8px;">
          <select id="bpAiModAction" style="${inpCss}width:auto;flex:1;">
            <option value="timeout" ${bot.moderation.action !== "delete" ? "selected" : ""}>Timeout</option>
            <option value="delete" ${bot.moderation.action === "delete" ? "selected" : ""}>Supprimer le message</option>
          </select>
          <span style="font-size:10px;opacity:0.6;">durée (s)</span>
          <input type="number" id="bpAiModTimeout" min="5" value="${esc(bot.moderation.timeoutSec)}" style="${inpCss}width:80px;">
        </div>
        ${lbl("Ce qui est interdit dans votre chat (en français, l'IA s'y réfère)")}
        <textarea id="bpAiRules" style="${areaCss}">${esc(bot.moderation.rules)}</textarea>
      </div>
      <div style="border-top:1px solid rgba(145,70,255,0.2);padding-top:8px;">
        <div style="font-size:11px;color:${purple};margin-bottom:6px;">💬 Participation au chat</div>
        ${chkRow("bpReplyMentions", "Répondre quand on mentionne son nom", bot.replyToMentions)}
        <div style="display:flex;gap:8px;align-items:center;">
          <span style="font-size:10px;opacity:0.6;">Réponse spontanée (%)</span>
          <input type="number" id="bpReplyChance" min="0" max="100" value="${esc(bot.replyChance)}" style="${inpCss}width:70px;">
          <span style="font-size:10px;opacity:0.6;">délai mini (s)</span>
          <input type="number" id="bpCooldown" min="1" value="${esc(bot.replyCooldownSec)}" style="${inpCss}width:70px;">
        </div>
      </div>`;

    panel.innerHTML = `
      <div style="display:flex;align-items:center;gap:10px;padding:14px 18px;border-bottom:1px solid ${purpleBd};flex-shrink:0;">
        <span style="font-size:18px;">🤖</span>
        <div style="flex:1;">
          <div style="font-size:14px;color:${purple};font-weight:bold;letter-spacing:0.03em;">Bot du stream</div>
          <div style="font-size:10px;opacity:0.5;">Annonces · objectifs · mots interdits · commandes · IA locale — tourne dans le relais (nk-relay), redémarrez OBS après enregistrement.</div>
        </div>
        <button id="bpClose" style="background:rgba(200,40,40,0.1);border:1px solid rgba(200,40,40,0.35);color:#e07070;border-radius:3px;padding:7px 14px;cursor:pointer;font-size:11px;">Fermer</button>
      </div>
      <div style="flex:1;display:flex;min-height:0;">
        <div id="bpLeft" style="flex:1.15;overflow-y:auto;padding:14px;border-right:1px solid ${purpleBd};">
          <div id="bpScopeWarn"></div>
          ${chkRow("bpEnabled", "<b>Activer le bot</b>", bot.enabled, "prend effet au prochain démarrage du relais (redémarrez OBS après avoir enregistré)")}
          ${sec("👤 Compte du bot", acctBody, false)}
          ${sec("📣 Annonces automatiques (sans IA)", annBody, true)}
          ${sec("🎯 Objectifs", goalBody, false)}
          ${sec("⛔ Mots interdits (sans IA)", banBody, false)}
          ${sec("❗ Commandes (!discord…)", cmdBody, false)}
          ${sec("🧠 IA locale (optionnel)", aiBody, false)}
          <div id="bpSaveStatus" style="font-size:11px;min-height:16px;margin-bottom:8px;"></div>
          <button id="bpSave" style="width:100%;background:rgba(200,146,10,0.18);border:1px solid rgba(200,146,10,0.6);color:${gold};border-radius:5px;padding:11px;font-size:13px;font-weight:bold;cursor:pointer;">💾 Enregistrer le bot</button>
        </div>
        <div style="flex:1;display:flex;flex-direction:column;min-width:0;background:#0a0e16;">
          <div style="padding:10px 14px;border-bottom:1px solid rgba(145,70,255,0.25);font-size:11px;color:${purple};flex-shrink:0;">
            🧪 Aperçu — discutez avec votre bot (utilise les réglages ci-contre, même non enregistrés)
          </div>
          <div style="padding:8px 10px;display:flex;gap:5px;flex-wrap:wrap;border-bottom:1px solid rgba(255,255,255,0.06);flex-shrink:0;">
            ${SIM_EVENTS.map((e2) => `<button type="button" class="bpSimEvent" data-key="${e2.key}" style="${btnGold}">${e2.label}</button>`).join("")}
            <button type="button" id="bpSimGoal" style="${btnGold}">🎯 Objectif atteint</button>
          </div>
          <div id="bpChatLog" style="flex:1;overflow-y:auto;padding:12px;font-size:12px;line-height:1.5;"></div>
          <div style="padding:10px;border-top:1px solid rgba(255,255,255,0.08);display:flex;gap:6px;flex-shrink:0;">
            <input type="text" id="bpSimUser" value="Viewer_Test" title="Pseudo du spectateur simulé" style="${inpCss}width:110px;">
            <input type="text" id="bpSimInput" placeholder="Écrire dans le chat de test… (Entrée pour envoyer)" style="${inpCss}flex:1;">
            <button type="button" id="bpSimSend" style="${btnPurple}">Envoyer</button>
          </div>
        </div>
      </div>`;

    overlay.appendChild(panel);
    document.body.appendChild(overlay);
    bind();
    renderCmdList();
    refreshAcctStatus();
    checkBotScopes();
    simSystem("Bienvenue dans le chat de test ! Tapez un message, un mot interdit, une commande, ou mentionnez « " + (bot.botName || "le bot") + " ». Les boutons du haut simulent les événements Twitch.");
  }

  // ═════════════════════════════════════════════════════════════════════
  // COLLECTE DU FORMULAIRE → objet aiBot (utilisé par Enregistrer ET par
  // le simulateur, pour que le test reflète toujours ce qu'on voit).
  // ═════════════════════════════════════════════════════════════════════
  function collect() {
    const D = NK.aiBotDefaults;
    const num = (id, dflt) => { const el = document.getElementById(id); const v = parseFloat(el && el.value); return isNaN(v) ? dflt : v; };
    const txt = (id, dflt) => { const el = document.getElementById(id); return el ? el.value : dflt; };
    const chk = (id, dflt) => { const el = document.getElementById(id); return el ? el.checked : dflt; };

    const announcements = {};
    ANNOUNCE_DEFS.forEach((a) => {
      announcements[a.key] = {
        enabled: chk("bpAnn_" + a.key, D.announcements[a.key].enabled),
        template: txt("bpAnnT_" + a.key, D.announcements[a.key].template),
      };
    });

    return {
      enabled: chk("bpEnabled", false),
      botLogin: acctLogin,
      botToken: acctToken,
      botName: acctLogin || NK.config.get().twitchLogin || D.botName,
      aiEnabled: chk("bpAiEnabled", false),
      apiUrl: (txt("bpApiUrl", D.apiUrl) || D.apiUrl).trim().replace(/\/$/, ""),
      model: txt("bpModel", "").trim(),
      personality: txt("bpPersonality", D.personality),
      replyToMentions: chk("bpReplyMentions", true),
      replyChance: Math.max(0, Math.min(100, num("bpReplyChance", 0))),
      replyCooldownSec: Math.max(1, num("bpCooldown", 20)),
      maxReplyLen: D.maxReplyLen,
      moderation: {
        enabled: chk("bpAiModEnabled", true),
        action: txt("bpAiModAction", "timeout"),
        timeoutSec: Math.max(5, num("bpAiModTimeout", 60)),
        rules: txt("bpAiRules", D.moderation.rules),
      },
      bannedWords: {
        enabled: chk("bpBanEnabled", true),
        words: txt("bpBanWords", "").split(/\n+/).map((w) => w.trim()).filter(Boolean),
        action: txt("bpBanAction", "timeout"),
        timeoutSec: Math.max(5, num("bpBanTimeout", 600)),
      },
      commands: cmds.filter((c) => c.trigger.trim() && c.reply.trim())
        .map((c) => ({ trigger: c.trigger.trim().startsWith("!") ? c.trigger.trim() : "!" + c.trigger.trim(), reply: c.reply.trim() })),
      announcements,
      goals: {
        follows: { enabled: chk("bpGoalF", false), target: num("bpGoalFT", 0), template: txt("bpGoalFM", D.goals.follows.template) },
        subs:    { enabled: chk("bpGoalS", false), target: num("bpGoalST", 0), template: txt("bpGoalSM", D.goals.subs.template) },
      },
    };
  }

  // ═════════════════════════════════════════════════════════════════════
  // LIAISONS
  // ═════════════════════════════════════════════════════════════════════
  function bind() {
    document.getElementById("bpClose").onclick = closePanel;

    document.getElementById("bpSave").onclick = async () => {
      const st = document.getElementById("bpSaveStatus");
      try {
        await NK.config.save({ aiBot: collect() });
        st.innerHTML = '<span style="color:#8fd080;">✓ Enregistré dans config.json — redémarrez OBS (ou le relais) pour appliquer.</span>';
      } catch (e) {
        st.innerHTML = '<span style="color:#e07070;">⚠ ' + esc(e.message) + "</span>";
      }
    };

    // Compte dédié
    document.getElementById("bpAcctConnect").onclick = () => {
      const st = document.getElementById("bpAcctStatus");
      st.innerHTML = '<span style="opacity:0.55;">Fenêtre Twitch ouverte — connectez-vous avec le COMPTE DU BOT puis autorisez…</span>';
      NK.twitchOAuth((token, login, err) => {
        if (err || !token) { st.innerHTML = '<span style="color:#e07070;">✗ ' + esc(err || "Échec") + "</span>"; return; }
        acctToken = "oauth:" + token;
        acctLogin = login;
        refreshAcctStatus();
        checkBotScopes();
      });
    };
    document.getElementById("bpAcctRemove").onclick = () => { acctToken = ""; acctLogin = ""; refreshAcctStatus(); checkBotScopes(); };

    // Connexion via fenêtre privée : copie du lien + collage manuel du token.
    document.getElementById("bpAcctCopyUrl").onclick = async () => {
      const st = document.getElementById("bpAcctCopyStatus");
      const url = NK.twitchOAuthUrl && NK.twitchOAuthUrl();
      if (!url) { st.innerHTML = '<span style="color:#e07070;">⚠ Client ID manquant — faites l\'étape 2 du panneau ⚙ Twitch.</span>'; return; }
      try { await navigator.clipboard.writeText(url); st.innerHTML = '<span style="color:#8fd080;">✓ lien copié</span>'; }
      catch (e) { window.prompt("Copiez ce lien :", url); }
    };
    document.getElementById("bpAcctPasteOk").onclick = async () => {
      const st = document.getElementById("bpAcctPasteStatus");
      const raw = (document.getElementById("bpAcctPaste").value || "").trim();
      // Accepte le code nu, "oauth:xxx", ou l'URL complète collée entière.
      let token = raw.replace(/^oauth:/, "");
      const m = raw.match(/access_token=(\w+)/);
      if (m) token = m[1];
      if (!token) { st.innerHTML = '<span style="color:#e07070;">Collez d\'abord le code affiché par la page de connexion.</span>'; return; }
      st.innerHTML = '<span style="opacity:0.55;">Vérification auprès de Twitch…</span>';
      try {
        const res = await fetch("https://id.twitch.tv/oauth2/validate", { headers: { Authorization: "OAuth " + token } });
        if (!res.ok) { st.innerHTML = '<span style="color:#e07070;">✗ Code invalide ou expiré — refaites les étapes 1 à 4.</span>'; return; }
        const d = await res.json();
        acctToken = "oauth:" + token;
        acctLogin = d.login;
        document.getElementById("bpAcctPaste").value = "";
        st.innerHTML = '<span style="color:#8fd080;">✓ Compte <b>' + esc(d.login) + '</b> connecté — n\'oubliez pas 💾 Enregistrer.</span>';
        refreshAcctStatus();
        checkBotScopes();
      } catch (e) {
        st.innerHTML = '<span style="color:#e07070;">⚠ ' + esc(e.message) + "</span>";
      }
    };

    // Commandes
    document.getElementById("bpCmdAdd").onclick = () => { cmds.push({ trigger: "!", reply: "" }); renderCmdList(); };

    // IA : préréglages + test
    document.querySelectorAll("#" + PANEL_ID + " .bpPreset").forEach((b) => {
      b.onclick = () => { document.getElementById("bpApiUrl").value = b.dataset.url; };
    });
    document.getElementById("bpAiTest").onclick = async () => {
      const st = document.getElementById("bpAiTestStatus");
      const url = (document.getElementById("bpApiUrl").value || "").trim().replace(/\/$/, "");
      st.innerHTML = '<span style="opacity:0.55;">Connexion à ' + esc(url) + "…</span>";
      try {
        const ctrl = new AbortController();
        setTimeout(() => ctrl.abort(), 5000);
        const res = await fetch(url + "/models", { signal: ctrl.signal });
        const d = await res.json();
        const names = (d.data || []).map((m) => m.id).slice(0, 3).join(", ");
        st.innerHTML = '<span style="color:#8fd080;">✓ Serveur IA joignable' + (names ? " · " + esc(names) : "") + "</span>";
      } catch (e) {
        st.innerHTML = '<span style="color:#f0c040;">⚠ Injoignable depuis l\'éditeur — serveur lancé ? (certains bloquent les pages web via CORS ; le relais, lui, y accédera quand même)</span>';
      }
    };

    // Simulateur
    document.querySelectorAll("#" + PANEL_ID + " .bpSimEvent").forEach((b) => {
      b.onclick = () => simEvent(b.dataset.key);
    });
    document.getElementById("bpSimGoal").onclick = () => {
      const c = collect();
      const g = c.goals.follows.enabled ? c.goals.follows : c.goals.subs.enabled ? c.goals.subs : null;
      if (!g) { simSystem("Aucun objectif activé — cochez-en un dans la section 🎯 Objectifs."); return; }
      simBot(renderTemplate(g.template, { current: g.target || 100, target: g.target || 100 }), c);
    };
    const send = () => {
      const inp = document.getElementById("bpSimInput");
      const user = (document.getElementById("bpSimUser").value || "Viewer_Test").trim();
      const text = inp.value.trim();
      if (!text) return;
      inp.value = "";
      simMessage(user, text);
    };
    document.getElementById("bpSimSend").onclick = send;
    document.getElementById("bpSimInput").onkeydown = (e) => { if (e.key === "Enter") send(); };
  }

  // Vérifie que le token que le bot utilisera (compte dédié si connecté,
  // sinon le vôtre) porte bien les scopes chat/modération — un token émis
  // avant l'ajout du bot ne les a pas, et le relais refuse alors de démarrer
  // le bot (même diagnostic que server/src/aiMod.js, mais visible ici).
  async function checkBotScopes() {
    const el = document.getElementById("bpScopeWarn");
    if (!el) return;
    el.innerHTML = "";
    const usingBotAcct = !!(acctToken && acctLogin);
    const tok = (usingBotAcct ? acctToken : NK.config.get().twitchToken || "").replace(/^oauth:/, "");
    if (!tok) return; // pas connecté du tout — le panneau ⚙ s'en charge
    try {
      const res = await fetch("https://id.twitch.tv/oauth2/validate", { headers: { Authorization: "OAuth " + tok } });
      const need = ["chat:read", "chat:edit", "moderator:manage:chat_messages", "moderator:manage:banned_users"];
      let text = null;
      if (!res.ok) {
        text = usingBotAcct
          ? "Le token du compte du bot est invalide ou expiré — reconnectez-le ci-dessous (section 👤 Compte du bot)."
          : "Votre token Twitch est invalide ou expiré — reconnectez-vous via le panneau ⚙ Twitch.";
      } else {
        const d = await res.json();
        const missing = need.filter((s) => (d.scopes || []).indexOf(s) === -1);
        if (missing.length) {
          text = (usingBotAcct
            ? "Le compte du bot a été connecté sans les autorisations chat (" + missing.join(", ") + ") — reconnectez-le (section 👤 Compte du bot)."
            : "Votre connexion Twitch date d'avant l'ajout du bot : il manque " + missing.join(", ")
              + ". Le bot NE POURRA PAS écrire dans le chat. Ouvrez ⚙ Twitch → Déconnecter → Se connecter, puis redémarrez OBS.");
        }
      }
      if (text) {
        el.innerHTML = '<div style="background:rgba(224,112,112,0.08);border:1px solid rgba(224,112,112,0.4);'
          + 'border-radius:5px;padding:10px 12px;margin-bottom:12px;font-size:11px;line-height:1.6;">'
          + '<span style="color:#e07070;font-weight:bold;">⚠ Le bot ne pourra pas se connecter au chat</span><br>'
          + esc(text) + "</div>";
      }
    } catch (e) { /* hors-ligne — le relais fera le même diagnostic dans nk-relay.log */ }
  }

  function refreshAcctStatus() {
    const st = document.getElementById("bpAcctStatus");
    if (!st) return;
    st.innerHTML = acctLogin
      ? '<span style="color:#8fd080;">✓ Compte dédié connecté : <b>' + esc(acctLogin) + '</b></span> <span style="opacity:0.45;">— rendez-le modérateur : /mod ' + esc(acctLogin) + "</span>"
      : '<span style="opacity:0.55;">Aucun compte dédié — le bot utilisera votre compte (' + esc(NK.config.get().twitchLogin || "non connecté") + ").</span>";
  }

  function renderCmdList() {
    const wrap = document.getElementById("bpCmdList");
    if (!wrap) return;
    wrap.innerHTML = cmds.map((c, i) => `
      <div style="display:flex;gap:6px;margin-bottom:6px;align-items:center;">
        <input type="text" data-cmdtrig="${i}" value="${esc(c.trigger)}" placeholder="!discord" style="${inpCss}width:110px;">
        <input type="text" data-cmdreply="${i}" value="${esc(c.reply)}" placeholder="Rejoins le serveur : …" style="${inpCss}flex:1;">
        <button type="button" data-cmddel="${i}" style="background:rgba(200,40,40,0.15);border:1px solid rgba(200,40,40,0.4);color:#e07070;border-radius:3px;padding:5px 8px;cursor:pointer;font-size:10px;">✕</button>
      </div>`).join("") || '<div style="font-size:10px;opacity:0.4;margin-bottom:8px;">Aucune commande pour l\'instant.</div>';
    wrap.querySelectorAll("[data-cmdtrig]").forEach((el) => { el.oninput = () => { cmds[+el.dataset.cmdtrig].trigger = el.value; }; });
    wrap.querySelectorAll("[data-cmdreply]").forEach((el) => { el.oninput = () => { cmds[+el.dataset.cmdreply].reply = el.value; }; });
    wrap.querySelectorAll("[data-cmddel]").forEach((el) => { el.onclick = () => { cmds.splice(+el.dataset.cmddel, 1); renderCmdList(); }; });
  }

  // ═════════════════════════════════════════════════════════════════════
  // SIMULATEUR — même pipeline que server/src/aiMod.js (onPrivmsg)
  // ═════════════════════════════════════════════════════════════════════
  function chatLine(html) {
    const log = document.getElementById("bpChatLog");
    if (!log) return null;
    const div = document.createElement("div");
    div.style.cssText = "margin-bottom:7px;word-break:break-word;";
    div.innerHTML = html;
    log.appendChild(div);
    log.scrollTop = log.scrollHeight;
    return div;
  }
  function simSystem(text) {
    chatLine('<span style="opacity:0.45;font-style:italic;font-size:11px;">— ' + esc(text) + "</span>");
  }
  function simAction(text) {
    chatLine('<span style="color:#ff7d7d;font-size:11px;">🛡 ' + esc(text) + "</span>");
  }
  function simBot(text, cfg) {
    const name = (cfg && (cfg.botLogin || cfg.botName)) || "Bot";
    chatLine('<span style="color:' + purple + ';font-weight:bold;">🤖 ' + esc(name) + '</span> <span>' + esc(text) + "</span>");
  }
  function simViewer(user, text, struck) {
    chatLine('<span style="color:#7ec4ff;font-weight:bold;">' + esc(user) + "</span> "
      + '<span style="' + (struck ? "text-decoration:line-through;opacity:0.45;" : "") + '">' + esc(text) + "</span>");
  }

  function simEvent(key) {
    const c = collect();
    const def = SIM_EVENTS.find((e) => e.key === key);
    simSystem("Événement Twitch simulé : " + def.label);
    const a = c.announcements[key];
    if (a && a.enabled && a.template) simBot(renderTemplate(a.template, def.vars), c);
    else simSystem("(annonce « " + def.label + " » désactivée — le bot ne dirait rien)");
  }

  async function simMessage(user, text) {
    const c = collect();
    simHistory.push({ user, text });
    if (simHistory.length > 12) simHistory.shift();

    // 1) Mots interdits — sanction immédiate, comme sur le vrai chat.
    if (c.bannedWords.enabled && c.bannedWords.words.length) {
      const hit = findBannedWord(text, c.bannedWords.words);
      if (hit) {
        simViewer(user, text, true);
        const actionTxt = c.bannedWords.action === "delete" ? "message supprimé"
          : c.bannedWords.action === "ban" ? user + " banni définitivement"
          : "timeout " + c.bannedWords.timeoutSec + "s pour " + user;
        simAction(actionTxt + ' — mot interdit ("' + hit + '")');
        return;
      }
    }
    simViewer(user, text, false);

    // 2) Commandes fixes.
    const firstWord = text.trim().split(/\s+/)[0].toLowerCase();
    const cmd = c.commands.find((x) => x.trigger && firstWord === x.trigger.toLowerCase());
    if (cmd) { simBot(renderTemplate(cmd.reply, { user }), c); return; }

    // 3) IA — modération réelle puis réponse réelle si le serveur répond.
    if (!c.aiEnabled) {
      if (text.toLowerCase().indexOf((c.botName || "").toLowerCase()) !== -1) {
        simSystem("IA désactivée — activez « IA locale » pour de vraies réponses ici.");
      }
      return;
    }
    const typing = chatLine('<span style="opacity:0.4;font-size:11px;">🤖 réfléchit…</span>');
    try {
      // Modération IA (mêmes prompts que le relais)
      if (c.moderation.enabled) {
        const verdict = await llmCall(c, [
          { role: "system", content: 'Tu es un modérateur de chat Twitch strict mais juste. Règles du salon — sont INTERDITS : ' + c.moderation.rules + '. Analyse le message et réponds UNIQUEMENT avec un objet JSON compact, sans aucun autre texte : {"action":"ok"} si le message est acceptable, {"action":"flag","raison":"explication très courte"} s\'il enfreint les règles. Le second degré, les taquineries amicales et le langage familier sont ACCEPTABLES. En cas de doute, choisis "ok".' },
          { role: "user", content: user + ": " + text },
        ], 80, true);
        const m = String(verdict).match(/\{[\s\S]*\}/);
        const v = m ? JSON.parse(m[0]) : null;
        if (v && v.action === "flag") {
          if (typing) typing.remove();
          simAction((c.moderation.action === "delete" ? "message supprimé" : "timeout " + c.moderation.timeoutSec + "s pour " + user)
            + " — IA : " + (v.raison || "contraire aux règles"));
          return;
        }
      }
      // Réponse (mention ou spontané — dans le test, on répond aussi aux mentions)
      const mentioned = c.replyToMentions && text.toLowerCase().indexOf((c.botName || "").toLowerCase()) !== -1;
      const spontaneous = c.replyChance > 0 && Math.random() * 100 < c.replyChance;
      if (mentioned || spontaneous) {
        const context = simHistory.slice(-8).map((h) => h.user + ": " + h.text).join("\n");
        const out = await llmCall(c, [
          { role: "system", content: c.personality + "\nTu participes au chat Twitch de " + (NK.config.get().twitchLogin || "ce stream") + ". Réponds au dernier message en " + Math.max(60, c.maxReplyLen) + " caractères MAXIMUM, une seule ligne, sans préfixer ta réponse par ton nom." },
          { role: "user", content: "Derniers messages du chat :\n" + context + "\n\nMessage auquel tu réponds — " + user + ": " + text },
        ], 120, false);
        if (typing) typing.remove();
        const clean = String(out).trim().replace(/^["']|["']$/g, "").slice(0, c.maxReplyLen);
        if (clean) { simBot(clean, c); simHistory.push({ user: c.botName, text: clean }); }
        return;
      }
      if (typing) typing.remove();
    } catch (e) {
      if (typing) typing.remove();
      simSystem("Serveur IA injoignable (" + (e && e.message ? e.message : e) + ") — lancez LM Studio/llama.cpp, ou testez avec 🔌 Tester. (Un blocage CORS ici n'empêche PAS le vrai bot de fonctionner via le relais.)");
    }
  }

  async function llmCall(c, messages, maxTokens, asJson) {
    const ctrl = new AbortController();
    const to = setTimeout(() => ctrl.abort(), 30000);
    try {
      const res = await fetch(c.apiUrl.replace(/\/$/, "") + "/chat/completions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ model: c.model || "local-model", messages, temperature: asJson ? 0.1 : 0.8, max_tokens: maxTokens, stream: false }),
        signal: ctrl.signal,
      });
      if (!res.ok) throw new Error("HTTP " + res.status);
      const d = await res.json();
      return (d.choices && d.choices[0] && d.choices[0].message && d.choices[0].message.content) || "";
    } finally {
      clearTimeout(to);
    }
  }

  NK.botPanel = { open: openPanel };
})();
