// ═══════════════════════════════════════════════════════════════════════
// Mode "Chat" — overlay de chat Twitch (dc-runtime). Panneau Apparence /
// Messages, export compatible avec Chat Overlay.dc.html, et aperçu live
// testable directement dans la scène de l'éditeur (faux messages simulés
// + boutons Tester/Arrêter/Réinitialiser), sans connexion Twitch réelle
// ni reload pendant l'édition.
// ═══════════════════════════════════════════════════════════════════════
(function () {
  "use strict";
  const core = NK.core;
  const $ = core.$;
  const stageOuter = core.stageOuter;
  const stageInner = core.stageInner;
  const fxCanvas = core.fxCanvas;

  // Contenu de support.js, inliné dans la preview blob (helper partagé).
  const ensureSupportJs = () => core.ensureSupportJs();

  const CHAT_KEYS = ["channel", "messageLimit", "fallbackColor", "usernameFont", "messageFont",
    "usernameSize", "messageSize", "showBadges", "messageExpiry", "expiryDuration", "expiryFade", "messageDirection",
    "messageColor", "letterSpacing", "wordSpacing", "lineHeight", "msgGap", "msgAlign", "msgAnim",
    "msgBgColor", "msgBgAlpha", "msgBgRadius", "msgPadding"];
  const FRAME_KEYS = ["borderRadius", "borderWidth", "borderColor", "borderAlpha", "bgColor", "bgAlpha",
    "showGlow", "showOrnaments", "headerHeight", "titleText", "titleSize", "titleSpacing",
    "padding", "paddingLeft", "paddingRight"];

  const DEFAULT_CHAT_CONFIG = () => ({
    channel: "nouilleske",
    messageLimit: 40,
    fallbackColor: "#f0e0b0",
    usernameFont: "'Cinzel Decorative', serif",
    messageFont: "'Noto Serif SC', serif",
    usernameSize: 13,
    messageSize: 14,
    showBadges: true,
    // Messages — comportement temporel
    messageExpiry: false,
    expiryDuration: 30,     // secondes avant que le message commence à disparaître
    expiryFade: 3,          // secondes du fondu
    messageDirection: "bottom", // "bottom" = récents en bas, "top" = récents en haut
    // Messages — mise en forme fine
    messageColor: "#f0e0b0",
    letterSpacing: 0,       // em
    wordSpacing: 0,         // px
    lineHeight: 1.6,
    msgGap: 12,             // px entre deux messages
    msgAlign: "left",       // left | center | right
    msgAnim: "slide-up",    // slide-up | slide-left | slide-right | fade | pop | none
    // Bulle de message (fond individuel par message)
    msgBgColor: "4,9,18",
    msgBgAlpha: 0,          // 0 = pas de bulle
    msgBgRadius: 8,
    msgPadding: 6,
    // Aperçu éditeur (n'affecte pas OBS — la taille réelle se règle dans OBS)
    previewW: 420,
    previewH: 800,
    // Cadre
    borderRadius: 18,
    borderWidth: 0,
    borderColor: "200,146,10",
    borderAlpha: 0.65,
    bgColor: "4,9,18",
    bgAlpha: 0,
    showGlow: false,
    showOrnaments: false,
    headerHeight: 56,
    titleText: "CHAT",
    titleSize: 20,
    titleSpacing: 0.32,
    padding: 16,
    paddingLeft: 16,
    paddingRight: 16,
  });

  function extractConfig(html) {
    const m = html.match(/<script id="nk-chat-config" type="application\/json">([\s\S]*?)<\/script>/);
    if (!m) return null;
    try {
      const parsed = JSON.parse(m[1]);
      return { ...DEFAULT_CHAT_CONFIG(), ...parsed };
    } catch (e) { return null; }
  }

  function splitChat(cfg) { const o = {}; CHAT_KEYS.forEach((k) => { o[k] = cfg[k]; }); return o; }
  function splitFrame(cfg) { const o = {}; FRAME_KEYS.forEach((k) => { o[k] = cfg[k]; }); return o; }

  // ═══════════════════════════════════════════════════════════════════════
  // PANNEAU — onglets Tout / Apparence / Messages
  // ═══════════════════════════════════════════════════════════════════════
  const NUM_FIELDS_FRAME = [
    { key:"borderRadius",  label:"Arrondi des coins (px)",        min:0,   max:60,  step:1    }, // [0]
    { key:"borderWidth",   label:"Épaisseur de bordure (px)",     min:0,   max:10,  step:1    }, // [1]
    { key:"borderAlpha",   label:"Opacité bordure",               min:0,   max:1,   step:0.01 }, // [2]
    { key:"bgAlpha",       label:"Opacité du fond",               min:0,   max:1,   step:0.01 }, // [3]
    { key:"headerHeight",  label:"Hauteur de l'en-tête (px)",     min:0,   max:120, step:1    }, // [4]
    { key:"titleSize",     label:"Taille du titre (px)",          min:8,   max:48,  step:1    }, // [5]
    { key:"titleSpacing",  label:"Espacement des lettres (em)",   min:0,   max:1,   step:0.01 }, // [6]
    { key:"padding",       label:"Marge verticale (px)",          min:0,   max:60,  step:1    }, // [7]
    { key:"paddingLeft",   label:"Marge gauche (px)",             min:0,   max:120, step:1    }, // [8]
    { key:"paddingRight",  label:"Marge droite (px)",             min:0,   max:120, step:1    }, // [9]
  ];
  const NUM_FIELDS_MESSAGES = [
    { key:"messageLimit",    label:"Messages conservés",        min:5,   max:150, step:1   }, // [0]
    { key:"usernameSize",    label:"Taille du pseudo (px)",     min:8,   max:36,  step:1   }, // [1]
    { key:"messageSize",     label:"Taille du message (px)",    min:8,   max:36,  step:1   }, // [2]
    { key:"expiryDuration",  label:"Durée d'affichage (s)",     min:5,   max:120, step:1   }, // [3]
    { key:"expiryFade",      label:"Durée du fondu (s)",        min:0.5, max:30,  step:0.5 }, // [4]
    { key:"letterSpacing",   label:"Espacement des lettres (em)", min:0, max:0.3, step:0.005 }, // [5]
    { key:"wordSpacing",     label:"Espacement des mots (px)",  min:0,   max:24,  step:0.5 }, // [6]
    { key:"lineHeight",      label:"Espacement des lignes",     min:1,   max:3,   step:0.05 }, // [7]
    { key:"msgGap",          label:"Écart entre messages (px)", min:0,   max:40,  step:1   }, // [8]
    { key:"msgBgAlpha",      label:"Opacité de la bulle (0 = sans bulle)", min:0, max:1, step:0.01 }, // [9]
    { key:"msgBgRadius",     label:"Arrondi de la bulle (px)",  min:0,   max:30,  step:1   }, // [10]
    { key:"msgPadding",      label:"Marge interne de la bulle (px)", min:0, max:24, step:1 }, // [11]
  ];
  const NUM_FIELDS_PREVIEW = [
    { key:"previewW", label:"Largeur de l'aperçu (px)",  min:200, max:1400, step:10 },
    { key:"previewH", label:"Hauteur de l'aperçu (px)",  min:200, max:1080, step:10 },
  ];
  const MSG_ANIM_OPTIONS = [
    { value:"slide-up",    label:"Glisse vers le haut" },
    { value:"slide-left",  label:"Arrive de la droite" },
    { value:"slide-right", label:"Arrive de la gauche" },
    { value:"fade",        label:"Fondu" },
    { value:"pop",         label:"Zoom (pop)" },
    { value:"none",        label:"Aucune (instantané)" },
  ];

  function escapeAttr(v) { return String(v == null ? "" : v).replace(/"/g, "&quot;"); }
  function fld(def, cfg) { return core.field(def, cfg[def.key], "chatkey"); }

  function renderToutTab(cfg) {
    let html = "<h3>🎬 APERÇU</h3>";
    html += '<div class="hint">Aperçu live dans la scène, à droite. Utilisez les boutons en bas de la scène pour simuler des messages de test sans toucher au vrai chat Twitch.</div>';
    html += '<div class="bgName">Salon Twitch : <b>' + escapeAttr(cfg.channel) + "</b></div>";
    html += '<div class="hint">' + (cfg.showBadges ? "Badges activés" : "Badges désactivés") + " · Limite : " + cfg.messageLimit + " messages";
    if (cfg.messageExpiry) html += " · Expiration : " + cfg.expiryDuration + "s + fondu " + cfg.expiryFade + "s";
    html += ".</div>";
    html += '<details class="sec" data-sec="chatPreviewSize" open><summary>Taille de l\'aperçu (dans l\'éditeur)</summary><div class="secBody">';
    html += '<div class="hint">Réglez ici les mêmes dimensions que votre Browser Source OBS pour voir exactement le rendu final. Ça ne change rien au fichier exporté.</div>';
    NUM_FIELDS_PREVIEW.forEach((def) => { html += fld(def, cfg); });
    html += "</div></details>";
    return html;
  }

  function renderFrameTab(cfg) {
    let html = "<h3>🎨 APPARENCE</h3>";

    html += '<details class="sec" data-sec="chatBg" open><summary>Fond</summary><div class="secBody">';
    html += '<div class="field"><label>Couleur du fond</label><input type="color" id="chatBgColor" value="' + core.rgbToHex(cfg.bgColor) + '"></div>';
    html += fld(NUM_FIELDS_FRAME[3], cfg);
    html += "</div></details>";

    html += '<details class="sec" data-sec="chatHeader" open><summary>En-tête</summary><div class="secBody">';
    html += '<div class="field"><label>Titre</label><input type="text" id="chatTitleText" value="' + escapeAttr(cfg.titleText) + '"></div>';
    html += fld(NUM_FIELDS_FRAME[4], cfg);
    html += fld(NUM_FIELDS_FRAME[5], cfg);
    html += fld(NUM_FIELDS_FRAME[6], cfg);
    html += "</div></details>";

    html += '<details class="sec" data-sec="chatBorder" open><summary>Bordure</summary><div class="secBody">';
    html += '<div class="field"><label>Couleur de bordure</label><input type="color" id="chatBorderColor" value="' + core.rgbToHex(cfg.borderColor) + '"></div>';
    html += fld(NUM_FIELDS_FRAME[1], cfg);
    html += fld(NUM_FIELDS_FRAME[2], cfg);
    html += fld(NUM_FIELDS_FRAME[0], cfg);
    html += "</div></details>";

    html += '<details class="sec" data-sec="chatFx" open><summary>Effets</summary><div class="secBody">';
    html += core.toggleSwitch("chattoggle", "showGlow", "Lueur pulsante autour du cadre", cfg.showGlow);
    html += core.toggleSwitch("chattoggle", "showOrnaments", "Coins et traits ornementaux", cfg.showOrnaments);
    html += fld(NUM_FIELDS_FRAME[7], cfg);
    html += fld(NUM_FIELDS_FRAME[8], cfg);
    html += fld(NUM_FIELDS_FRAME[9], cfg);
    html += "</div></details>";

    return html;
  }

  function renderMessagesTab(cfg) {
    let html = "<h3>💬 MESSAGES</h3>";

    html += '<div class="field"><label>Salon Twitch</label><input type="text" id="chatChannel" value="' + escapeAttr(cfg.channel) + '"></div>';
    html += fld(NUM_FIELDS_MESSAGES[0], cfg);
    html += core.toggleSwitch("chattoggle", "showBadges", "Afficher les badges (modo, VIP, abonné…)", cfg.showBadges);

    // Direction & alignement
    html += '<div class="field"><label>Direction des messages</label><div class="chiprow">';
    html += '<button class="chip' + (cfg.messageDirection !== "top" ? " active" : "") + '" data-chatdir="bottom">↑ Récents en bas</button>';
    html += '<button class="chip' + (cfg.messageDirection === "top" ? " active" : "") + '" data-chatdir="top">↓ Récents en haut</button>';
    html += "</div></div>";
    html += '<div class="field"><label>Alignement des messages</label><div class="chiprow">';
    html += '<button class="chip' + (cfg.msgAlign !== "center" && cfg.msgAlign !== "right" ? " active" : "") + '" data-chatalign="left">⯇ Bord gauche</button>';
    html += '<button class="chip' + (cfg.msgAlign === "center" ? " active" : "") + '" data-chatalign="center">▣ Centré</button>';
    html += '<button class="chip' + (cfg.msgAlign === "right" ? " active" : "") + '" data-chatalign="right">⯈ Bord droit</button>';
    html += "</div></div>";

    // Animation d'apparition
    html += '<div class="field"><label>Apparition d\'un message</label><select id="chatMsgAnim">';
    MSG_ANIM_OPTIONS.forEach((o) => { html += '<option value="' + o.value + '"' + (o.value === cfg.msgAnim ? " selected" : "") + '>' + o.label + "</option>"; });
    html += "</select></div>";
    html += fld(NUM_FIELDS_MESSAGES[8], cfg); // écart entre messages

    // Expiration
    html += core.toggleSwitch("chattoggle", "messageExpiry", "Expiration automatique des messages", cfg.messageExpiry);
    if (cfg.messageExpiry) {
      html += fld(NUM_FIELDS_MESSAGES[3], cfg);
      html += fld(NUM_FIELDS_MESSAGES[4], cfg);
    }

    html += '<details class="sec" data-sec="chatPseudo" open><summary>Pseudo</summary><div class="secBody">';
    html += '<div class="field"><label>Police (CSS font-family)</label><input type="text" id="chatUsernameFont" value="' + escapeAttr(cfg.usernameFont) + '"></div>';
    html += fld(NUM_FIELDS_MESSAGES[1], cfg);
    html += '<div class="field"><label>Couleur de secours (sans couleur Twitch)</label><input type="color" id="chatFallbackColor" value="' + escapeAttr(cfg.fallbackColor) + '"></div>';
    html += "</div></details>";

    html += '<details class="sec" data-sec="chatMsg" open><summary>Texte du message</summary><div class="secBody">';
    html += '<div class="field"><label>Police (CSS font-family)</label><input type="text" id="chatMessageFont" value="' + escapeAttr(cfg.messageFont) + '"></div>';
    html += fld(NUM_FIELDS_MESSAGES[2], cfg);
    html += '<div class="field"><label>Couleur du texte</label><input type="color" id="chatMessageColor" value="' + escapeAttr(cfg.messageColor) + '"></div>';
    html += fld(NUM_FIELDS_MESSAGES[5], cfg); // lettres
    html += fld(NUM_FIELDS_MESSAGES[6], cfg); // mots
    html += fld(NUM_FIELDS_MESSAGES[7], cfg); // lignes
    html += "</div></details>";

    html += '<details class="sec" data-sec="chatBubble" open><summary>Bulle de message (fond individuel)</summary><div class="secBody">';
    html += '<div class="field"><label>Couleur de la bulle</label><input type="color" id="chatMsgBgColor" value="' + core.rgbToHex(cfg.msgBgColor) + '"></div>';
    html += fld(NUM_FIELDS_MESSAGES[9], cfg);
    html += fld(NUM_FIELDS_MESSAGES[10], cfg);
    html += fld(NUM_FIELDS_MESSAGES[11], cfg);
    html += "</div></details>";

    return html;
  }

  function renderTab(tabId, cfg) {
    if (tabId === "tout") return renderToutTab(cfg);
    if (tabId === "frame") return renderFrameTab(cfg);
    return renderMessagesTab(cfg);
  }

  function bindTab(tabId, cfg) {
    document.querySelectorAll("[data-tkind='chattoggle']").forEach((el) => {
      el.onclick = () => {
        const key = el.dataset.tkey;
        cfg[key] = !cfg[key];
        el.classList.toggle("on", cfg[key]);
        core.markDirty();
        // Re-render le panneau pour afficher/masquer les sliders d'expiration
        if (key === "messageExpiry") { core.renderPanel(); return; }
        update(cfg);
      };
    });
    document.querySelectorAll("[data-chatdir]").forEach((el) => {
      el.onclick = () => {
        cfg.messageDirection = el.dataset.chatdir;
        core.markDirty();
        core.renderPanel(); // met à jour les chips actives + pousse la config
      };
    });
    document.querySelectorAll("[data-chatalign]").forEach((el) => {
      el.onclick = () => {
        cfg.msgAlign = el.dataset.chatalign;
        core.markDirty();
        core.renderPanel();
      };
    });
    const msgAnimSelect = $("#chatMsgAnim");
    if (msgAnimSelect) msgAnimSelect.onchange = (e) => { cfg.msgAnim = e.target.value; core.markDirty(); update(cfg); };
    document.querySelectorAll("details.sec[data-sec]").forEach((d) => {
      d.ontoggle = () => {};
    });
    document.querySelectorAll("[data-chatkey]").forEach((el) => {
      const allDefs = NUM_FIELDS_FRAME.concat(NUM_FIELDS_MESSAGES, NUM_FIELDS_PREVIEW);
      const def = allDefs.find((d) => d.key === el.dataset.chatkey);
      el.oninput = (e) => {
        const v = parseFloat(e.target.value);
        cfg[el.dataset.chatkey] = v;
        if (def && el.previousElementSibling) el.previousElementSibling.textContent = def.label + " : " + v;
        core.markDirty();
        update(cfg);
      };
    });
    const bgColorInput = $("#chatBgColor");
    if (bgColorInput) bgColorInput.oninput = (e) => { cfg.bgColor = core.hexToRgb(e.target.value); core.markDirty(); update(cfg); };
    const borderColorInput = $("#chatBorderColor");
    if (borderColorInput) borderColorInput.oninput = (e) => { cfg.borderColor = core.hexToRgb(e.target.value); core.markDirty(); update(cfg); };
    const fallbackColorInput = $("#chatFallbackColor");
    if (fallbackColorInput) fallbackColorInput.oninput = (e) => { cfg.fallbackColor = e.target.value; core.markDirty(); update(cfg); };
    const messageColorInput = $("#chatMessageColor");
    if (messageColorInput) messageColorInput.oninput = (e) => { cfg.messageColor = e.target.value; core.markDirty(); update(cfg); };
    const msgBgColorInput = $("#chatMsgBgColor");
    if (msgBgColorInput) msgBgColorInput.oninput = (e) => { cfg.msgBgColor = core.hexToRgb(e.target.value); core.markDirty(); update(cfg); };
    const titleTextInput = $("#chatTitleText");
    if (titleTextInput) titleTextInput.onchange = (e) => { cfg.titleText = e.target.value; core.markDirty(); update(cfg); };
    const channelInput = $("#chatChannel");
    if (channelInput) channelInput.onchange = (e) => { cfg.channel = (e.target.value || "nouilleske").toLowerCase().replace(/^#/, ""); core.markDirty(); core.renderPanel(); };
    const usernameFontInput = $("#chatUsernameFont");
    if (usernameFontInput) usernameFontInput.onchange = (e) => { cfg.usernameFont = e.target.value; core.markDirty(); update(cfg); };
    const messageFontInput = $("#chatMessageFont");
    if (messageFontInput) messageFontInput.onchange = (e) => { cfg.messageFont = e.target.value; core.markDirty(); update(cfg); };
  }

  // ═══════════════════════════════════════════════════════════════════════
  // APERÇU LIVE — iframe + 3 boutons (Tester / Arrêter / Réinitialiser)
  // ═══════════════════════════════════════════════════════════════════════
  let iframeEl = null;
  let previewWrap = null;
  let blobUrl = null;
  let playing = false;
  let previewMsgCount = 0;
  let testBarEl = null, testBtnPlay = null, testBtnStop = null, testBtnReset = null;
  let msgCountListener = null;

  function postToIframe(msg) {
    if (iframeEl && iframeEl.contentWindow) iframeEl.contentWindow.postMessage(msg, "*");
  }

  async function buildPreviewUrl(cfg) {
    const jsContent = await ensureSupportJs();
    const html = buildChatHtml(cfg, true, jsContent);
    if (blobUrl) URL.revokeObjectURL(blobUrl);
    blobUrl = URL.createObjectURL(new Blob([html], { type: "text/html" }));
    return blobUrl;
  }

  function createTestBar() {
    if (testBarEl) return;
    testBarEl = document.createElement("div");
    testBarEl.id = "nkChatTestBar";
    testBarEl.style.cssText = "position:absolute; left:50%; bottom:24px; transform:translateX(-50%); z-index:60; display:flex; gap:8px;";

    const btnBase = "padding:9px 16px; border-radius:20px; border:1px solid rgba(200,146,10,0.6); background:#0d1320; color:#c8920a; font-size:12px; box-shadow:0 4px 14px rgba(0,0,0,0.5); transition:opacity 0.15s;";

    testBtnPlay = document.createElement("button");
    testBtnPlay.textContent = "▶ Tester";
    testBtnPlay.style.cssText = btnBase;
    testBtnPlay.onclick = () => { playing = true; postToIframe({ type: "nk-test", cmd: "play" }); updateTestBar(); };

    testBtnStop = document.createElement("button");
    testBtnStop.textContent = "⏹ Arrêter";
    testBtnStop.style.cssText = btnBase;
    testBtnStop.onclick = () => { playing = false; postToIframe({ type: "nk-test", cmd: "pause" }); updateTestBar(); };

    testBtnReset = document.createElement("button");
    testBtnReset.textContent = "↺ Réinitialiser";
    testBtnReset.style.cssText = btnBase;
    testBtnReset.onclick = () => {
      playing = false;
      previewMsgCount = 0;
      postToIframe({ type: "nk-test", cmd: "reset" });
      updateTestBar();
    };

    testBarEl.append(testBtnPlay, testBtnStop, testBtnReset);
    stageOuter.appendChild(testBarEl);

    msgCountListener = (ev) => {
      if (!ev.data || ev.data.type !== "nk-preview-count") return;
      previewMsgCount = ev.data.count;
      updateTestBar();
    };
    window.addEventListener("message", msgCountListener);
    updateTestBar();
  }

  function updateTestBar() {
    if (!testBtnPlay) return;
    testBtnPlay.disabled = playing;
    testBtnPlay.style.opacity = playing ? "0.4" : "1";
    testBtnPlay.style.cursor = playing ? "not-allowed" : "pointer";
    testBtnStop.disabled = !playing;
    testBtnStop.style.opacity = !playing ? "0.4" : "1";
    testBtnStop.style.cursor = !playing ? "not-allowed" : "pointer";
    testBtnReset.disabled = previewMsgCount === 0;
    testBtnReset.style.opacity = previewMsgCount === 0 ? "0.4" : "1";
    testBtnReset.style.cursor = previewMsgCount === 0 ? "not-allowed" : "pointer";
  }

  function removeTestBar() {
    if (testBarEl) { testBarEl.remove(); testBarEl = null; testBtnPlay = null; testBtnStop = null; testBtnReset = null; }
    if (msgCountListener) { window.removeEventListener("message", msgCountListener); msgCountListener = null; }
    playing = false;
    previewMsgCount = 0;
  }

  async function mount(cfg) {
    fxCanvas.style.display = "none";
    $("#bgPickerWrap").style.display = "none";

    previewWrap = document.createElement("div");
    previewWrap.id = "nkChatPreviewWrap";
    previewWrap.style.cssText = "position:absolute; left:50%; top:50%; transform:translate(-50%,-50%); width:" + (cfg.previewW || 420) + "px; height:" + (cfg.previewH || 800) + "px; "
      + "background-image:linear-gradient(45deg,#1c2330 25%,transparent 25%),linear-gradient(-45deg,#1c2330 25%,transparent 25%),linear-gradient(45deg,transparent 75%,#1c2330 75%),linear-gradient(-45deg,transparent 75%,#1c2330 75%); "
      + "background-size:20px 20px; background-position:0 0,0 10px,10px -10px,-10px 0px; background-color:#0a0e16; box-shadow:0 0 0 1px rgba(200,146,10,0.4); z-index:20; overflow:hidden;";
    const ifr = document.createElement("iframe");
    ifr.style.cssText = "position:absolute; inset:0; width:100%; height:100%; border:0;";
    stageInner.appendChild(previewWrap);
    iframeEl = ifr;
    playing = false;
    previewMsgCount = 0;
    createTestBar();
    // Lecture de support.js via FSA (fonctionne aussi bien en file:// qu'en http://)
    // puis injection dans le blob — évite toute requête réseau depuis le blob: URL.
    ifr.src = await buildPreviewUrl(cfg);
    previewWrap.appendChild(ifr);
  }

  function update(cfg) {
    if (previewWrap) {
      previewWrap.style.width = (cfg.previewW || 420) + "px";
      previewWrap.style.height = (cfg.previewH || 800) + "px";
    }
    if (!iframeEl) return;
    postToIframe({ type: "nk-test", cmd: "config", payload: { chatConfig: splitChat(cfg), frameConfig: splitFrame(cfg) } });
  }

  function unmount() {
    if (previewWrap) { previewWrap.remove(); previewWrap = null; }
    iframeEl = null;
    if (blobUrl) { URL.revokeObjectURL(blobUrl); blobUrl = null; }
    removeTestBar();
    fxCanvas.style.display = "";
  }

  // ═══════════════════════════════════════════════════════════════════════
  // GÉNÉRATION DU FICHIER DE SORTIE (dc-runtime, compatible Chat Overlay.dc.html)
  // ═══════════════════════════════════════════════════════════════════════
  function buildChatHtml(cfg, previewMode, inlineSupportJs) {
    if (previewMode === undefined) previewMode = false;
    const C = splitChat(cfg), F = splitFrame(cfg);
    const supportTag = (previewMode && inlineSupportJs)
      ? '<script>' + inlineSupportJs + '<\/script>'
      : '<script src="./Nouilles-Arcana/support.js"><\/script>';
    return `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
${supportTag}
<script id="nk-chat-config" type="application/json">${JSON.stringify(cfg)}<\/script>
</head>
<body>
<x-dc>
<helmet>
  <link href="https://fonts.googleapis.com/css2?family=Cinzel+Decorative:wght@700&family=Noto+Serif+SC:wght@300;400&display=swap" rel="stylesheet">
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    html, body { width: 100%; height: 100%; overflow: hidden; background: transparent; }
    @keyframes chatGlow {
      0%, 100% { box-shadow: 0 0 14px rgba(200,146,10,0.2), inset 0 0 22px rgba(200,146,10,0.03); }
      50%       { box-shadow: 0 0 28px rgba(200,146,10,0.44), inset 0 0 28px rgba(200,146,10,0.07); }
    }
    @keyframes shimSlide {
      0%   { left: -80%; }
      100% { left: 180%; }
    }
    @keyframes spark {
      0%, 100% { opacity: 0.35; }
      50%       { opacity: 1; }
    }
    @keyframes scanLine {
      0%   { transform: translateY(-100%); opacity: 0; }
      10%  { opacity: 0.06; }
      90%  { opacity: 0.06; }
      100% { transform: translateY(100%); opacity: 0; }
    }
    @keyframes msgIn {
      0%   { opacity: 0; transform: translateY(6px); }
      100% { opacity: 1; transform: translateY(0); }
    }
    @keyframes msgInLeft {
      0%   { opacity: 0; transform: translateX(26px); }
      100% { opacity: 1; transform: translateX(0); }
    }
    @keyframes msgInRight {
      0%   { opacity: 0; transform: translateX(-26px); }
      100% { opacity: 1; transform: translateX(0); }
    }
    @keyframes msgInPop {
      0%   { opacity: 0; transform: scale(0.7); }
      100% { opacity: 1; transform: scale(1); }
    }
    @keyframes msgInFade {
      0%   { opacity: 0; }
      100% { opacity: 1; }
    }
  </style>
</helmet>

<!-- ══════════════════════════════════════════════════════════
     CHAT OVERLAY STANDALONE — généré par Editeur.html (mode Chat)
     Utilisez ce fichier comme Browser Source séparé dans OBS
     pour positionner le chat indépendamment du fond animé.
     Dimensionnez la source à la taille souhaitée dans OBS.
══════════════════════════════════════════════════════════ -->

<div style="position:relative; width:100vw; height:100vh; background:transparent; overflow:hidden;">

  <!-- Cadre principal chat -->
  <div style="{{ glowStyle }}">

    <!-- Fond foncé + bordure or -->
    <div style="position:absolute; top:0; right:0; bottom:0; left:0; border:{{ borderW }}px solid {{ borderColor }}; background:{{ bgColor }}; border-radius:{{ frameRadius }}px;"></div>

    <!-- Ligne de scan subtile -->
    <div style="position:absolute; top:0; right:0; bottom:0; left:0; overflow:hidden; pointer-events:none; z-index:1; border-radius:{{ frameRadius }}px;">
      <div style="position:absolute; left:0; right:0; height:2px; background:linear-gradient(90deg,transparent,rgba(200,146,10,0.08),transparent); animation:scanLine 12s linear infinite;"></div>
    </div>

    <!-- ── Coins et traits ornementaux (désactivables via frameConfig.showOrnaments) ── -->
    <sc-if value="{{ showOrnaments }}" hint-placeholder-val="{{ true }}">
      <div style="position:absolute; top:-6px; left:-6px; width:24px; height:24px; border-top:2.5px solid #c8920a; border-left:2.5px solid #c8920a; z-index:3;"></div>
      <div style="position:absolute; top:-6px; right:-6px; width:24px; height:24px; border-top:2.5px solid #c8920a; border-right:2.5px solid #c8920a; z-index:3;"></div>
      <div style="position:absolute; bottom:-6px; left:-6px; width:24px; height:24px; border-bottom:2.5px solid #c8920a; border-left:2.5px solid #c8920a; z-index:3;"></div>
      <div style="position:absolute; bottom:-6px; right:-6px; width:24px; height:24px; border-bottom:2.5px solid #c8920a; border-right:2.5px solid #c8920a; z-index:3;"></div>
      <div style="position:absolute; top:-2px; left:50%; transform:translateX(-50%); width:30%; height:2px; background:linear-gradient(90deg,transparent,rgba(200,146,10,0.88),transparent); z-index:3;"></div>
      <div style="position:absolute; top:-2px; left:14%; width:8%; height:1px; background:rgba(200,146,10,0.38); z-index:3;"></div>
      <div style="position:absolute; top:-2px; right:14%; width:8%; height:1px; background:rgba(200,146,10,0.38); z-index:3;"></div>
      <div style="position:absolute; bottom:-2px; left:50%; transform:translateX(-50%); width:30%; height:2px; background:linear-gradient(90deg,transparent,rgba(200,146,10,0.88),transparent); z-index:3;"></div>
    </sc-if>

    <!-- ── En-tête CHAT ── -->
    <div style="position:relative; z-index:4; height:{{ headerHeight }}px; border-bottom:1px solid rgba(200,146,10,0.28); border-radius:{{ frameRadius }}px {{ frameRadius }}px 0 0; overflow:hidden; flex-shrink:0; display:flex; align-items:center; justify-content:center;">
      <!-- Shimmer -->
      <div style="position:absolute; top:0; width:45%; height:100%; background:linear-gradient(90deg,transparent,rgba(200,146,10,0.2),transparent); animation:shimSlide 5.5s ease-in-out infinite; pointer-events:none;"></div>
      <!-- Texte -->
      <div style="display:flex; align-items:center; justify-content:center; gap:12px; position:relative; z-index:1;">
        <span style="color:rgba(200,146,10,0.42); font-size:{{ titleSize }}px; animation:spark 3s ease-in-out infinite;">⬥</span>
        <span style="font-family:'Cinzel Decorative',serif; color:#c8920a; font-size:{{ titleSize }}px; letter-spacing:{{ titleSpacing }}em; text-shadow:0 0 14px rgba(200,146,10,0.54);">{{ titleText }}</span>
        <span style="color:rgba(200,146,10,0.42); font-size:{{ titleSize }}px; animation:spark 3s ease-in-out infinite 1.5s;">⬥</span>
      </div>
    </div>

    <!-- ── Zone de contenu chat ── -->
    <div style="position:absolute; top:{{ headerHeight }}px; right:0; bottom:0; left:0; overflow:hidden; z-index:4; border-radius:0 0 {{ frameRadius }}px {{ frameRadius }}px;">

      <!-- État vide -->
      <sc-if value="{{ !hasMessages }}" hint-placeholder-val="{{ true }}">
        <div style="position:absolute; top:0; right:0; bottom:0; left:0; display:flex; flex-direction:column; align-items:center; justify-content:center; gap:16px; pointer-events:none;">
          <div style="width:50px; height:50px; border:1.5px solid rgba(200,146,10,0.18); border-radius:50%; display:flex; align-items:center; justify-content:center;">
            <span style="color:rgba(200,146,10,0.25); font-size:24px;">面</span>
          </div>
          <div style="color:rgba(200,146,10,0.18); font-family:'Noto Serif SC',serif; font-size:12px; text-align:center; line-height:2.4; letter-spacing:0.08em;">
            EN ATTENTE DE MESSAGES<br>
            <span style="font-size:10px; opacity:0.75;">Connexion au chat de #{{ channel }}…</span>
          </div>
        </div>
      </sc-if>

      <!-- Liste des messages -->
      <div style="position:absolute; top:0; right:0; bottom:0; left:0; display:flex; flex-direction:{{ msgFlexDir }}; align-items:{{ msgAlignItems }}; gap:{{ msgGap }}px; padding:{{ msgPaddingV }}px {{ msgPaddingRight }}px {{ msgPaddingV }}px {{ msgPaddingLeft }}px; overflow:hidden;">
        <sc-for list="{{ messages }}" as="m" hint-placeholder-count="0">
          <div style="animation:{{ msgAnimCss }}; opacity:{{ m.opacity }}; transition:opacity 0.5s; flex-shrink:0; max-width:100%; background:{{ msgBubbleBg }}; border-radius:{{ msgBubbleRadius }}px; padding:{{ msgBubblePad }}px; text-align:{{ msgTextAlign }};">
            <sc-for list="{{ m.badges }}" as="b" hint-placeholder-count="0">
              <span title="{{ b.setId }}" style="display:inline-flex;align-items:center;justify-content:center;width:{{ uSize }}px;height:{{ uSize }}px;font-size:{{ uSize }}px;line-height:1;vertical-align:middle;margin-right:4px;filter:drop-shadow(0 0 4px rgba(200,146,10,0.5));">{{ b.icon }}</span>
            </sc-for>
            <span style="font-family:{{ uFont }};font-size:{{ uSize }}px;color:{{ m.color }};letter-spacing:0.03em;text-shadow:0 0 8px rgba(200,146,10,0.25);">{{ m.author }}</span>
            <span style="font-family:{{ mFont }};font-size:{{ mSize }}px;color:{{ msgColor }};line-height:{{ mLine }};letter-spacing:{{ mLetter }}em;word-spacing:{{ mWord }}px;word-break:break-word;">
              <sc-for list="{{ m.parts }}" as="p" hint-placeholder-count="0">
                <sc-if value="{{ p.isEmote }}" hint-placeholder-val="{{ false }}">
                  <img src="{{ p.url }}" alt="{{ p.value }}" style="height:{{ mSize }}px;vertical-align:middle;margin:0 2px;">
                </sc-if>
                <sc-if value="{{ p.isText }}" hint-placeholder-val="{{ true }}">
                  <span> {{ p.value }} </span>
                </sc-if>
              </sc-for>
            </span>
          </div>
        </sc-for>
      </div>

    </div>

  </div>

</div>
</x-dc>
<script type="text/x-dc" data-dc-script data-props="{&quot;$preview&quot;:{&quot;width&quot;:420,&quot;height&quot;:800}}">
class Component extends DCLogic {

  // ═══════════════════════════════════════════════════════════════════════
  // ⚙️ CONFIGURATION DU CHAT — générée par Editeur.html (mode Chat)
  // ═══════════════════════════════════════════════════════════════════════
  chatConfig = {
    channel:          ${JSON.stringify(C.channel)},
    messageLimit:     ${JSON.stringify(C.messageLimit)},
    fallbackColor:    ${JSON.stringify(C.fallbackColor)},
    usernameFont:     ${JSON.stringify(C.usernameFont)},
    messageFont:      ${JSON.stringify(C.messageFont)},
    usernameSize:     ${JSON.stringify(C.usernameSize)},
    messageSize:      ${JSON.stringify(C.messageSize)},
    showBadges:       ${JSON.stringify(C.showBadges)},
    messageExpiry:    ${JSON.stringify(C.messageExpiry)},
    expiryDuration:   ${JSON.stringify(C.expiryDuration)},
    expiryFade:       ${JSON.stringify(C.expiryFade)},
    messageDirection: ${JSON.stringify(C.messageDirection)},
    messageColor:     ${JSON.stringify(C.messageColor)},
    letterSpacing:    ${JSON.stringify(C.letterSpacing)},
    wordSpacing:      ${JSON.stringify(C.wordSpacing)},
    lineHeight:       ${JSON.stringify(C.lineHeight)},
    msgGap:           ${JSON.stringify(C.msgGap)},
    msgAlign:         ${JSON.stringify(C.msgAlign)},
    msgAnim:          ${JSON.stringify(C.msgAnim)},
    msgBgColor:       ${JSON.stringify(C.msgBgColor)},
    msgBgAlpha:       ${JSON.stringify(C.msgBgAlpha)},
    msgBgRadius:      ${JSON.stringify(C.msgBgRadius)},
    msgPadding:       ${JSON.stringify(C.msgPadding)},
  };

  // ═══════════════════════════════════════════════════════════════════════
  // 🖼️ APPARENCE DU CADRE
  // ═══════════════════════════════════════════════════════════════════════
  frameConfig = {
    borderRadius:  ${JSON.stringify(F.borderRadius)},
    borderWidth:   ${JSON.stringify(F.borderWidth)},
    borderColor:   ${JSON.stringify(F.borderColor)},
    borderAlpha:   ${JSON.stringify(F.borderAlpha)},
    bgColor:       ${JSON.stringify(F.bgColor)},
    bgAlpha:       ${JSON.stringify(F.bgAlpha)},
    showGlow:      ${JSON.stringify(F.showGlow)},
    showOrnaments: ${JSON.stringify(F.showOrnaments)},
    headerHeight:  ${JSON.stringify(F.headerHeight)},
    titleText:     ${JSON.stringify(F.titleText)},
    titleSize:     ${JSON.stringify(F.titleSize)},
    titleSpacing:  ${JSON.stringify(F.titleSpacing)},
    padding:       ${JSON.stringify(F.padding)},
    paddingLeft:   ${JSON.stringify(F.paddingLeft)},
    paddingRight:  ${JSON.stringify(F.paddingRight)},
  };

  badgeIcons = {
    broadcaster:       '🎥',
    moderator:          '🛡️',
    vip:                 '💎',
    subscriber:         '⭐',
    founder:             '🏆',
    partner:             '✓',
    staff:               '⚙️',
    admin:               '🛠️',
    global_mod:         '🌐',
    premium:             '👑',
    turbo:               '⚡',
    'sub-gifter':       '🎁',
    'sub-gift-leader': '🎁',
    'bits-leader':      '💠',
    bits:                '💠',
    'hype-train':       '🚂',
  };

  // ═══════════════════════════════════════════════════════════════════════
  // 🚫 NE PAS MODIFIER EN DESSOUS — utilisez l'éditeur visuel
  // ═══════════════════════════════════════════════════════════════════════
  state = { messages: [] };
  _channel = '';
  _previewMode = ${previewMode ? 'true' : 'false'};
  _fakeTimer = null;
  _expiryInterval = null;

  componentDidMount() {
    const params = new URLSearchParams(window.location.search);
    this._channel = (params.get('channel') || this.chatConfig.channel || '').toLowerCase().replace(/^#/, '');
    if (this._previewMode) {
      this._setupPreviewMode();
    } else {
      this._connectChat();
    }
    this._startExpiryTimer();
  }

  // ── Minuterie d'expiration des messages ──
  _startExpiryTimer() {
    clearInterval(this._expiryInterval);
    this._expiryInterval = setInterval(() => this._tickExpiry(), 500);
  }
  _tickExpiry() {
    const C = this.chatConfig;
    if (!C.messageExpiry) return;
    const now = Date.now();
    const durMs = (C.expiryDuration || 30) * 1000;
    const fadeMs = (C.expiryFade || 3) * 1000;
    let changed = false;
    const alive = this.state.messages.filter((m) => {
      const age = now - (m.timestamp || now);
      return age < durMs + fadeMs;
    });
    if (alive.length !== this.state.messages.length) changed = true;
    alive.forEach((m) => {
      const age = now - (m.timestamp || now);
      const op = age >= durMs ? Math.max(0, 1 - (age - durMs) / fadeMs) : 1;
      if (Math.abs((m.opacity || 1) - op) > 0.005) { m.opacity = op; changed = true; }
    });
    if (changed) this.setState({ messages: alive });
  }

  // ── Mode test (utilisé uniquement par l'aperçu de l'éditeur) ──
  _setupPreviewMode() {
    window.addEventListener('message', (ev) => {
      const d = ev.data;
      if (!d || d.type !== 'nk-test') return;
      if (d.cmd === 'config') {
        if (d.payload && d.payload.chatConfig) Object.assign(this.chatConfig, d.payload.chatConfig);
        if (d.payload && d.payload.frameConfig) Object.assign(this.frameConfig, d.payload.frameConfig);
        this.forceUpdate();
      } else if (d.cmd === 'play') {
        this._startFakeMessages();
      } else if (d.cmd === 'pause') {
        this._stopFakeMessages();
      } else if (d.cmd === 'reset') {
        this._stopFakeMessages();
        this.setState({ messages: [] });
        window.parent.postMessage({ type: 'nk-preview-count', count: 0 }, '*');
      }
    });
  }

  _startFakeMessages() {
    if (this._fakeTimer) return;
    const tick = () => {
      this._pushFakeMessage();
      this._fakeTimer = setTimeout(tick, 1200 + Math.random() * 2600);
    };
    tick();
  }
  _stopFakeMessages() {
    clearTimeout(this._fakeTimer);
    this._fakeTimer = null;
  }
  _pushFakeMessage() {
    const users = ['Lyra_', 'Kael99', 'NouilleFan', 'ViewerXP', 'MagicMoss', 'Tenshi_', 'Korrigan', 'PixelPirate'];
    const colors = ['#ff7f50', '#9b59b6', '#2ecc71', '#3498db', '#e91e63', '#f1c40f', '#1abc9c'];
    const phrases = ['Salut tout le monde !', 'GG bien joué', 'haha trop drôle', 'Pog', 'ce stream est top', 'quelqu\\'un sait quelle heure il est ?', '+1', 'première fois ici, ça envoie !'];
    const author = users[Math.floor(Math.random() * users.length)];
    const color = colors[Math.floor(Math.random() * colors.length)];
    const value = phrases[Math.floor(Math.random() * phrases.length)];
    const badges = (this.chatConfig.showBadges && Math.random() < 0.3) ? [{ setId: 'subscriber', icon: this.badgeIcons.subscriber }] : [];
    const entry = { id: 'demo-' + Date.now() + '-' + Math.random(), author, color, parts: [{ isText: true, isEmote: false, value }], badges, timestamp: Date.now(), opacity: 1 };
    const list = [entry, ...this.state.messages].slice(0, this.chatConfig.messageLimit);
    this.setState({ messages: list });
    window.parent.postMessage({ type: 'nk-preview-count', count: list.length }, '*');
  }

  _parseBadges(badgesTag) {
    if (!badgesTag || !this.chatConfig.showBadges) return [];
    return badgesTag.split(',').map((b) => {
      const setId = b.split('/')[0];
      return { setId, icon: this.badgeIcons[setId] || '⬥' };
    });
  }

  _connectChat() {
    const open = () => {
      let ws;
      try { ws = new WebSocket('wss://irc-ws.chat.twitch.tv:443'); } catch (e) { setTimeout(open, 5000); return; }

      ws.onopen = () => {
        console.log('[nkChat] connexion au chat de #' + this._channel);
        ws.send('CAP REQ :twitch.tv/tags twitch.tv/commands');
        ws.send('PASS SCHMOOPIIE');
        ws.send('NICK justinfan' + Math.floor(10000 + Math.random() * 89999));
        ws.send('JOIN #' + this._channel);
      };

      ws.onmessage = (ev) => {
        String(ev.data).split('\\r\\n').filter(Boolean).forEach((line) => this._handleLine(ws, line));
      };

      ws.onclose = () => setTimeout(open, 4000);
      ws.onerror = () => ws.close();
    };

    open();
  }

  _handleLine(ws, line) {
    if (line.startsWith('PING')) { ws.send('PONG :tmi.twitch.tv'); return; }
    const msg = this._parseIRC(line);
    if (!msg || msg.cmd !== 'PRIVMSG') return;

    const author = msg.tags['display-name'] || (msg.prefix.split('!')[0]) || 'anonyme';
    const color  = (msg.tags['color'] && msg.tags['color'].length) ? msg.tags['color'] : this.chatConfig.fallbackColor;
    const parts  = this._splitEmotes(msg.message, msg.tags['emotes']);
    const badges = this._parseBadges(msg.tags['badges']);
    const entry  = { id: msg.tags['id'] || (Date.now() + '-' + Math.random()), author, color, parts, badges, timestamp: Date.now(), opacity: 1 };

    const list = [entry, ...this.state.messages].slice(0, this.chatConfig.messageLimit);
    this.setState({ messages: list });
  }

  _parseIRC(line) {
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
    const m = rest.match(/^:(\\S+) (\\S+) (\\S+) :([\\s\\S]*)$/);
    if (!m) return null;
    return { tags, prefix: m[1], cmd: m[2], target: m[3], message: m[4] };
  }

  _splitEmotes(text, emotesTag) {
    if (!emotesTag) return [{ isText: true, isEmote: false, value: text }];
    const ranges = [];
    emotesTag.split('/').forEach((part) => {
      const i = part.indexOf(':');
      if (i < 0) return;
      const id = part.slice(0, i);
      part.slice(i + 1).split(',').forEach((pos) => {
        const [s, e] = pos.split('-').map(Number);
        if (!isNaN(s) && !isNaN(e)) ranges.push({ id, s, e });
      });
    });
    if (!ranges.length) return [{ isText: true, isEmote: false, value: text }];
    ranges.sort((a, b) => a.s - b.s);
    const chars = Array.from(text);
    const out = [];
    let cur = 0;
    ranges.forEach((r) => {
      if (r.s > cur) out.push({ isText: true, isEmote: false, value: chars.slice(cur, r.s).join('') });
      out.push({
        isText: false, isEmote: true, value: chars.slice(r.s, r.e + 1).join(''),
        url: 'https://static-cdn.jtvnw.net/emoticons/v2/' + r.id + '/default/dark/2.0',
      });
      cur = r.e + 1;
    });
    if (cur < chars.length) out.push({ isText: true, isEmote: false, value: chars.slice(cur).join('') });
    return out;
  }

  renderVals() {
    const C = this.chatConfig;
    const F = this.frameConfig;
    return {
      messages:    this.state.messages,
      hasMessages: this.state.messages.length > 0,
      channel:     this._channel,
      uFont: C.usernameFont, uSize: C.usernameSize,
      mFont: C.messageFont,  mSize: C.messageSize,

      msgFlexDir:     C.messageDirection === 'top' ? 'column' : 'column-reverse',
      msgPaddingV:    F.padding,
      msgPaddingLeft: F.paddingLeft !== undefined ? F.paddingLeft : F.padding,
      msgPaddingRight: F.paddingRight !== undefined ? F.paddingRight : F.padding,

      msgAlignItems: C.msgAlign === 'right' ? 'flex-end' : C.msgAlign === 'center' ? 'center' : 'flex-start',
      msgTextAlign:  C.msgAlign === 'right' ? 'right' : C.msgAlign === 'center' ? 'center' : 'left',
      msgGap:        C.msgGap != null ? C.msgGap : 12,
      msgAnimCss:    C.msgAnim === 'none' ? 'none'
                     : (C.msgAnim === 'slide-left' ? 'msgInLeft' : C.msgAnim === 'slide-right' ? 'msgInRight'
                     : C.msgAnim === 'pop' ? 'msgInPop' : C.msgAnim === 'fade' ? 'msgInFade' : 'msgIn') + ' 0.35s ease',
      msgBubbleBg:     'rgba(' + (C.msgBgColor || '4,9,18') + ',' + (C.msgBgAlpha != null ? C.msgBgAlpha : 0) + ')',
      msgBubbleRadius: C.msgBgRadius != null ? C.msgBgRadius : 8,
      msgBubblePad:    C.msgBgAlpha > 0 ? (C.msgPadding != null ? C.msgPadding : 6) : 0,
      msgColor:      C.messageColor || '#f0e0b0',
      mLetter:       C.letterSpacing || 0,
      mWord:         C.wordSpacing || 0,
      mLine:         C.lineHeight || 1.6,

      frameRadius:   F.borderRadius,
      borderW:       F.borderWidth,
      borderColor:   'rgba(' + F.borderColor + ',' + F.borderAlpha + ')',
      bgColor:       'rgba(' + F.bgColor + ',' + F.bgAlpha + ')',
      glowStyle:     'position:absolute;top:0;right:0;bottom:0;left:0;border-radius:' + F.borderRadius + 'px;'
                     + (F.showGlow ? 'animation:chatGlow 5s ease-in-out infinite;' : ''),
      showOrnaments: F.showOrnaments,
      headerHeight:  F.headerHeight,
      titleText:     F.titleText,
      titleSize:     F.titleSize,
      titleSpacing:  F.titleSpacing,
      padding:       F.padding,
    };
  }
}
<\/script>
</body>
</html>
`;
  }

  core.registerMode("chat", {
    id: "chat",
    label: "💬 Chat",
    tabs: [
      { id: "tout",     label: "🎬 Tout" },
      { id: "frame",    label: "🎨 Apparence" },
      { id: "messages", label: "💬 Messages" },
    ],
    defaultConfig: DEFAULT_CHAT_CONFIG,
    extractConfig,
    renderTab,
    bindTab,
    buildExportHtml: buildChatHtml,
    stage: { mount, update, unmount },
  });
})();
