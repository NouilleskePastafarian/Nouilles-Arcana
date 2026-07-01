// ═══════════════════════════════════════════════════════════════════════
// Mode "Alertes" — édition visuelle de Alertes.dc.html (dc-runtime).
// Réglages généraux, priorité/durée/son par type d'alerte, aperçu live
// dans la scène (iframe + blob, comme le mode Chat). Le pont Twitch
// (_connectStreamerBot) et les templates de message par type ne sont
// pas édités ici — seuls les réglages opérationnels (priorité, durée,
// son) passent par ce panneau.
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

  const ALERT_TYPES = [
    "follow", "sub", "resub", "subgift", "subgiftbomb", "bits", "cheer",
    "raid", "donation", "hypetrainLevel", "channelPoints", "host", "charity", "ban",
  ];
  const DEFAULT_PRIORITY = {
    follow: 1, channelPoints: 2, host: 2, sub: 3, resub: 3, subgift: 3,
    bits: 4, cheer: 4, donation: 6, charity: 6, hypetrainLevel: 7, subgiftbomb: 8, raid: 9, ban: 1,
  };
  const TYPE_LABELS = {
    follow: "♥ Follow", sub: "★ Sub", resub: "★ Resub", subgift: "🎁 Gift",
    subgiftbomb: "💥 Bomb", bits: "💎 Bits", cheer: "🎉 Cheer", raid: "⚔ Raid",
    donation: "$ Don", hypetrainLevel: "🚂 Hype", channelPoints: "✦ Points",
    host: "📡 Host", charity: "💝 Charity", ban: "🔨 Ban",
  };

  // Types pour lesquels le relais (nk-relay) sait construire un événement
  // de test réel (voir server/src/testMode.js — TEST_BUILDERS). Les autres
  // (cheer, donation, charity, ban) n'ont aucun événement Twitch/legacy
  // équivalent câblé côté overlay (_connectStreamerBot) : impossible de les
  // déclencher via le relais, seul l'aperçu éditeur (animation locale) marche.
  const RELAY_REACHABLE_TYPES = new Set([
    "follow", "sub", "resub", "subgift", "subgiftbomb", "bits",
    "raid", "channelPoints", "hypetrainLevel", "host",
  ]);

  const DEFAULT_ICONS = {
    follow: "♥", sub: "★", resub: "★", subgift: "🎁", subgiftbomb: "💥",
    bits: "💎", cheer: "🎉", raid: "⚔", donation: "$", hypetrainLevel: "🚂",
    channelPoints: "✦", host: "📡", charity: "💝", ban: "🔨",
  };

  // Style complet d'une alerte : position, couleurs/bordure, typographie,
  // cadre de l'icône, animation. Partagé tel quel entre le style Général
  // (cfg.style) et le style personnalisé par type (cfg.types[t].style,
  // null = utilise le Général) — c'est ce qui permet à l'onglet "Alertes"
  // d'exposer EXACTEMENT les mêmes réglages que l'onglet "Général", mais
  // scopés à un seul type quand l'override est activé.
  function defaultStyle() {
    return {
      offsetX: 0, bottomOffset: 140, alertWidth: 620,
      titleSize: 22, mainSize: 30, subSize: 16,
      borderColor: "#c8920a", bgColor: "#050912", bgOpacity: 0.96, borderRadius: 3,
      titleColor: "#c8920a", mainColor: "#f0e0b0", subColor: "#f0e0b0", subOpacity: 0.7,
      iconBoxSize: 76, iconSize: 34, iconBg: "#c8920a", iconBgOpacity: 0.09, iconBorderColor: "#c8920a",
      animIn: "slide-up", animOut: "slide-up", animDuration: 520,
    };
  }
  const ANIM_OPTIONS = [
    { value: "slide-up", label: "Glisse vers le haut" },
    { value: "slide-down", label: "Glisse vers le bas" },
    { value: "slide-left", label: "Glisse depuis la droite" },
    { value: "slide-right", label: "Glisse depuis la gauche" },
    { value: "drop", label: "Tombe du haut" },
    { value: "fade", label: "Fondu" },
    { value: "pop", label: "Zoom (pop)" },
    { value: "none", label: "Aucune (instantané)" },
  ];
  function isImagePath(v) { return typeof v === "string" && /\.(png|jpe?g|gif|webp)$/i.test(v); }
  function escapeAttr(v) { return String(v).replace(/"/g, "&quot;"); }

  // Modèle de son simplifié : un seul son par défaut pour toutes les alertes,
  // et chaque type peut avoir un son personnalisé qui l'écrase (override) —
  // pas de bibliothèque de sons multiples ni de mode simple/avancé séparé.
  // "style: null" = ce type suit le style Général ; un objet complet
  // (même forme que defaultStyle()) = override total pour ce type.
  function defaultTypeEntry(type) {
    return { priority: DEFAULT_PRIORITY[type] || 1, duration: null, sound: null, volume: null, style: null };
  }

  const DEFAULT_ALERTS_CONFIG = () => {
    const types = {};
    ALERT_TYPES.forEach((t) => { types[t] = defaultTypeEntry(t); });
    return {
      defaultDuration: 5000,
      defaultSound: { file: null, volume: 0.8 },
      style: defaultStyle(),
      icons: Object.assign({ default: "⬥" }, DEFAULT_ICONS),
      types,
    };
  };

  // ── Extraction depuis un fichier existant ──────────────────────────────
  // Cherche d'abord la balise JSON nk-alerts-config (fichiers déjà migrés
  // par cet éditeur). Sinon, se rabat sur une extraction du littéral
  // alertConfig = {...} tel qu'il existe dans le fichier d'origine, afin
  // de pouvoir ouvrir/migrer le fichier sans édition manuelle préalable.
  function extractLiteralObject(text, varName) {
    const m = text.match(new RegExp(varName + "\\s*=\\s*\\{"));
    if (!m) return null;
    let i = m.index + m[0].length - 1; // position du '{'
    let depth = 0, end = -1;
    for (let j = i; j < text.length; j++) {
      if (text[j] === "{") depth++;
      else if (text[j] === "}") { depth--; if (depth === 0) { end = j; break; } }
    }
    if (end === -1) return null;
    const literal = text.slice(i, end + 1);
    try { return new Function("return (" + literal + ")")(); } catch (e) { return null; }
  }

  // Migre une entrée de type depuis l'ancien format (sounds:[], mode simple/
  // avancé) vers le nouveau (sound:string|null unique). Transparent si déjà
  // au nouveau format (pas de champ "sounds"). Le style personnalisé (t.style,
  // absent dans toutes les versions antérieures) passe simplement à travers.
  // `type` sert à retomber sur la bonne priorité par défaut : sans lui, un
  // fichier dont les types n'avaient pas de priorité explicite se retrouvait
  // avec priorité 1 partout (defaultTypeEntry(undefined) → 1).
  function migrateTypeEntry(t, type) {
    const base = defaultTypeEntry(type);
    if (!t) return base;
    if (Array.isArray(t.sounds)) {
      return {
        priority: t.priority != null ? t.priority : base.priority,
        duration: t.duration != null ? t.duration : null,
        sound: t.sounds.length ? t.sounds[0] : null,
        volume: t.sounds.length ? (t.volume != null ? t.volume : 0.8) : null,
        style: t.style || null,
      };
    }
    return Object.assign({}, base, t);
  }

  function deepMergeTypes(defaults, extracted) {
    const out = {};
    ALERT_TYPES.forEach((t) => {
      const merged = Object.assign({}, defaultTypeEntry(t), migrateTypeEntry(extracted && extracted[t], t));
      out[t] = merged;
    });
    return out;
  }

  // Reconstruit un style complet à partir d'un objet potentiellement partiel
  // (ancien fichier avec bottomOffset/alertWidth/titleSize/mainSize/subSize
  // à plat, ou fichier déjà migré avec un sous-objet "style" complet).
  function migrateStyle(flatOrParsed, defaults) {
    const flat = {
      bottomOffset: flatOrParsed.bottomOffset,
      alertWidth:   flatOrParsed.alertWidth,
      titleSize:    flatOrParsed.titleSize,
      mainSize:     flatOrParsed.mainSize,
      subSize:      flatOrParsed.subSize,
    };
    Object.keys(flat).forEach((k) => { if (flat[k] === undefined) delete flat[k]; });
    return Object.assign({}, defaults.style, flat, flatOrParsed.style || {});
  }

  function extractConfig(html) {
    const m = html.match(/<script id="nk-alerts-config" type="application\/json">([\s\S]*?)<\/script>/);
    if (m) {
      try {
        const parsed = JSON.parse(m[1]);
        const d = DEFAULT_ALERTS_CONFIG();
        // Migration depuis l'ancien modèle simpleSound/soundMode (versions antérieures).
        const legacySimple = parsed.simpleSound || parsed.defaultSound;
        return {
          defaultDuration: parsed.defaultDuration != null ? parsed.defaultDuration : d.defaultDuration,
          defaultSound: Object.assign({}, d.defaultSound, legacySimple),
          style: migrateStyle(parsed, d),
          icons: Object.assign({}, d.icons, parsed.icons),
          types: deepMergeTypes(d, parsed.types),
        };
      } catch (e) { /* tombe sur le repli ci-dessous */ }
    }

    // Repli : fichier pas encore migré — extrait l'ancien alertConfig = {...}.
    if (!/alertConfig\s*=\s*\{/.test(html)) return null;
    const legacy = extractLiteralObject(html, "alertConfig") || {};
    const d = DEFAULT_ALERTS_CONFIG();
    return {
      defaultDuration: legacy.duration != null ? legacy.duration : d.defaultDuration,
      defaultSound: d.defaultSound,
      style: migrateStyle(legacy, d),
      icons: d.icons,
      types: d.types,
    };
  }

  // ═══════════════════════════════════════════════════════════════════════
  // SÉLECTEUR DE SON — réutilise le pattern collectMedia()/openBgPicker()
  // de mode-background.js, filtré aux extensions audio.
  // ═══════════════════════════════════════════════════════════════════════
  async function collectAudio() {
    return core.collectFiles(/\.(mp3|wav|ogg)$/i);
  }

  function openSoundPicker(onPick) {
    if (!core.getRootHandle()) { alert("Choisissez d'abord un dossier."); return; }
    const wrap = document.createElement("div");
    wrap.style.cssText = "position:absolute;inset:0;background:rgba(5,9,18,0.92);z-index:200;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:10px;";
    const title = document.createElement("div");
    title.style.cssText = "font-size:13px;color:#c8920a;";
    title.textContent = "Choisissez un fichier son (.mp3, .wav, .ogg)";
    const box = document.createElement("div");
    box.style.cssText = "width:420px;max-height:60%;background:#0d1320;border:1px solid rgba(200,146,10,0.5);border-radius:4px;overflow-y:auto;overflow-x:hidden;padding:10px;";
    wrap.appendChild(title);
    wrap.appendChild(box);
    stageOuter.appendChild(wrap);
    collectAudio().then((matches) => {
      if (!matches.length) { box.innerHTML = '<div style="padding:10px;font-size:11px;opacity:0.6;">Aucun fichier son trouvé (jusqu\'à 3 niveaux de sous-dossiers).</div>'; return; }
      box.innerHTML = "";
      matches.forEach((rootRelPath) => {
        const row = document.createElement("div");
        row.style.cssText = "padding:8px 10px;font-size:12px;cursor:pointer;border-radius:3px;word-break:break-all;";
        row.textContent = rootRelPath;
        row.onmouseenter = () => { row.style.background = "rgba(200,146,10,0.18)"; };
        row.onmouseleave = () => { row.style.background = ""; };
        row.onclick = () => {
          const finalSrc = "../".repeat(core.depthFromRoot()) + rootRelPath;
          wrap.remove();
          onPick(finalSrc);
        };
        box.appendChild(row);
      });
    });
    const close = document.createElement("button");
    close.textContent = "Annuler";
    close.style.cssText = "background:rgba(200,40,40,0.2);border:1px solid rgba(200,40,40,0.5);color:#e07070;padding:6px 14px;border-radius:3px;cursor:pointer;";
    close.onclick = () => wrap.remove();
    wrap.appendChild(close);
  }

  // ═══════════════════════════════════════════════════════════════════════
  // SÉLECTEUR D'IMAGE (icône personnalisée par type) — même pattern que
  // openSoundPicker(), filtré aux images.
  // ═══════════════════════════════════════════════════════════════════════
  async function collectImages() {
    return core.collectFiles(/\.(png|jpe?g|gif|webp)$/i);
  }

  function openImagePicker(onPick) {
    if (!core.getRootHandle()) { alert("Choisissez d'abord un dossier."); return; }
    const wrap = document.createElement("div");
    wrap.style.cssText = "position:absolute;inset:0;background:rgba(5,9,18,0.92);z-index:200;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:10px;";
    const title = document.createElement("div");
    title.style.cssText = "font-size:13px;color:#c8920a;";
    title.textContent = "Choisissez une image d'icône (.png, .jpg, .gif, .webp)";
    const box = document.createElement("div");
    box.style.cssText = "width:420px;max-height:60%;background:#0d1320;border:1px solid rgba(200,146,10,0.5);border-radius:4px;overflow-y:auto;overflow-x:hidden;padding:10px;";
    wrap.appendChild(title);
    wrap.appendChild(box);
    stageOuter.appendChild(wrap);
    collectImages().then((matches) => {
      if (!matches.length) { box.innerHTML = '<div style="padding:10px;font-size:11px;opacity:0.6;">Aucune image trouvée (jusqu\'à 3 niveaux de sous-dossiers).</div>'; return; }
      box.innerHTML = "";
      matches.forEach((rootRelPath) => {
        const row = document.createElement("div");
        row.style.cssText = "padding:8px 10px;font-size:12px;cursor:pointer;border-radius:3px;word-break:break-all;";
        row.textContent = rootRelPath;
        row.onmouseenter = () => { row.style.background = "rgba(200,146,10,0.18)"; };
        row.onmouseleave = () => { row.style.background = ""; };
        row.onclick = () => {
          const finalSrc = "../".repeat(core.depthFromRoot()) + rootRelPath;
          wrap.remove();
          onPick(finalSrc);
        };
        box.appendChild(row);
      });
    });
    const close = document.createElement("button");
    close.textContent = "Annuler";
    close.style.cssText = "background:rgba(200,40,40,0.2);border:1px solid rgba(200,40,40,0.5);color:#e07070;padding:6px 14px;border-radius:3px;cursor:pointer;";
    close.onclick = () => wrap.remove();
    wrap.appendChild(close);
  }

  // ═══════════════════════════════════════════════════════════════════════
  // PANNEAU — onglets Général / Types d'alerte
  // ═══════════════════════════════════════════════════════════════════════
  let selectedType = "follow";
  let styleSecOpen = { pos: true, colors: false, typo: false, icon: false, anim: false };

  const POSITION_FIELDS = [
    { key: "offsetX",      label: "Décalage horizontal (px) — glissez le point sur l'aperçu", min: -800, max: 800, step: 5 },
    { key: "bottomOffset", label: "Position depuis le bas (px)", min: 0, max: 400, step: 5 },
    { key: "alertWidth",   label: "Largeur du panneau (px)",     min: 300, max: 900, step: 10 },
  ];
  const TYPO_FIELDS = [
    { key: "titleSize", label: "Taille du titre (px)",         min: 10, max: 48, step: 1 },
    { key: "mainSize",  label: "Taille du nom principal (px)", min: 12, max: 60, step: 1 },
    { key: "subSize",   label: "Taille du sous-texte (px)",    min: 8, max: 32, step: 1 },
  ];
  const COLOR_NUM_FIELDS = [
    { key: "bgOpacity",     label: "Opacité du fond",        min: 0, max: 1, step: 0.01 },
    { key: "borderRadius",  label: "Arrondi des coins (px)", min: 0, max: 24, step: 1 },
    { key: "subOpacity",    label: "Opacité du sous-texte",  min: 0, max: 1, step: 0.01 },
  ];
  const ICON_NUM_FIELDS = [
    { key: "iconBoxSize",   label: "Taille du cadre icône (px)",   min: 30, max: 160, step: 2 },
    { key: "iconSize",      label: "Taille de l'icône (px)",       min: 10, max: 100, step: 1 },
    { key: "iconBgOpacity", label: "Opacité du fond de l'icône",   min: 0, max: 1, step: 0.01 },
  ];
  const ANIM_NUM_FIELDS = [
    { key: "animDuration", label: "Durée de l'animation (ms)", min: 100, max: 2000, step: 20 },
  ];
  const ALL_STYLE_NUM_FIELDS = POSITION_FIELDS.concat(TYPO_FIELDS, COLOR_NUM_FIELDS, ICON_NUM_FIELDS, ANIM_NUM_FIELDS);

  function fld(def, cfg) { return core.field(def, cfg[def.key], "alertnum"); }
  function styleFld(def, style) { return core.field(def, style[def.key], "stylenum"); }
  function colorField(key, label, value) {
    return '<div class="field"><label>' + label + '</label><input type="color" data-stylecolor="' + key + '" value="' + value + '"></div>';
  }
  function selectField(key, label, value, options) {
    let html = '<div class="field"><label>' + label + '</label><select data-styleselect="' + key + '">';
    options.forEach((o) => { html += '<option value="' + o.value + '"' + (o.value === value ? " selected" : "") + '>' + o.label + "</option>"; });
    html += "</select></div>";
    return html;
  }
  function renderDetailsSection(key, title, bodyHtml) {
    return '<details class="sec" data-sec="' + key + '"' + (styleSecOpen[key] ? " open" : "") + "><summary>" + title + "</summary><div class=\"secBody\">" + bodyHtml + "</div></details>";
  }

  // Rendu des réglages de style — RÉUTILISÉ tel quel par l'onglet Général
  // (cfg.style) ET par l'override par type dans l'onglet Alertes
  // (cfg.types[t].style) : les deux exposent exactement les mêmes champs.
  function renderStyleFields(style) {
    let html = "";
    html += renderDetailsSection("pos", "📍 Position &amp; taille",
      '<div class="hint">Glissez le point repère sur l\'aperçu pour repositionner, ou réglez précisément ici :</div>'
      + POSITION_FIELDS.map((d) => styleFld(d, style)).join(""));
    html += renderDetailsSection("colors", "🎨 Couleurs &amp; bordure",
      colorField("borderColor", "Couleur de bordure", style.borderColor)
      + colorField("bgColor", "Couleur de fond", style.bgColor)
      + COLOR_NUM_FIELDS.filter((d) => d.key !== "subOpacity").map((d) => styleFld(d, style)).join(""));
    html += renderDetailsSection("typo", "🔤 Typographie",
      TYPO_FIELDS.map((d) => styleFld(d, style)).join("")
      + colorField("titleColor", "Couleur du titre", style.titleColor)
      + colorField("mainColor", "Couleur du nom principal", style.mainColor)
      + colorField("subColor", "Couleur du sous-texte", style.subColor)
      + styleFld({ key: "subOpacity", label: "Opacité du sous-texte", min: 0, max: 1, step: 0.01 }, style));
    html += renderDetailsSection("icon", "◎ Cadre de l'icône",
      ICON_NUM_FIELDS.filter((d) => d.key !== "iconBgOpacity").map((d) => styleFld(d, style)).join("")
      + colorField("iconBg", "Couleur de fond du cadre", style.iconBg)
      + styleFld({ key: "iconBgOpacity", label: "Opacité du fond de l'icône", min: 0, max: 1, step: 0.01 }, style)
      + colorField("iconBorderColor", "Couleur de bordure du cadre", style.iconBorderColor));
    html += renderDetailsSection("anim", "🎬 Animation",
      selectField("animIn", "Entrée", style.animIn, ANIM_OPTIONS)
      + selectField("animOut", "Sortie", style.animOut, ANIM_OPTIONS)
      + ANIM_NUM_FIELDS.map((d) => styleFld(d, style)).join(""));
    return html;
  }

  function renderGeneralTab(cfg) {
    let html = "<h3>⚙ RÉGLAGES GÉNÉRAUX</h3>";
    html += '<div class="hint">Ces réglages s\'appliquent à toutes les alertes, sauf celles qui ont un style personnalisé (onglet "Alertes").</div>';

    html += "<h3>⏱ DURÉE D'AFFICHAGE PAR DÉFAUT</h3>";
    html += fld({ key: "defaultDuration", label: "Durée d'affichage par défaut (ms)", min: 1000, max: 15000, step: 250 }, cfg);

    html += '<hr style="border:none;border-top:1px solid rgba(200,146,10,0.15);margin:14px 0;">';
    html += "<h3>◎ ICÔNE PAR DÉFAUT</h3>";
    html += '<div class="hint">Utilisée en repli si un type n\'a pas d\'icône propre.</div>';
    html += '<div class="field"><label>Icône (texte/emoji)</label><input type="text" id="defaultIconInput" value="' + escapeAttr(cfg.icons.default || "") + '"></div>';

    html += '<hr style="border:none;border-top:1px solid rgba(200,146,10,0.15);margin:14px 0;">';
    html += "<h3>🔊 SON PAR DÉFAUT</h3>";
    html += '<div class="hint">Ce son joue pour toutes les alertes. Un type en particulier peut avoir son propre son à la place, réglable dans l\'onglet "Alertes".</div>';
    html += '<div class="bgName">' + (cfg.defaultSound.file || "Aucun son choisi — silencieux") + "</div>";
    html += '<button class="btn btn-main" id="btnPickDefaultSound">🔊 Choisir un son</button>';
    if (cfg.defaultSound.file) html += '<button class="btn" id="btnClearDefaultSound">✕ Retirer le son</button>';
    html += fld({ key: "volume", label: "Volume", min: 0, max: 1, step: 0.05 }, cfg.defaultSound);

    // Style (position/couleurs/typo/icône/animation) EN DERNIER — même ordre
    // que l'onglet Alertes, où le style personnalisé par type est aussi en
    // bas (cohérence demandée : la position se règle toujours au même endroit).
    html += '<hr style="border:none;border-top:1px solid rgba(200,146,10,0.15);margin:14px 0;">';
    html += "<h3>🎨 STYLE</h3>";
    html += renderStyleFields(cfg.style);
    return html;
  }

  function renderTypesTab(cfg) {
    let html = "<h3>🔔 ALERTES</h3>";
    html += '<div class="hint">Cliquez un type pour régler sa priorité, sa durée, son son, son icône et — si besoin — un style entièrement personnalisé qui remplace les réglages Généraux.</div>';
    html += '<div class="chiprow">';
    ALERT_TYPES.forEach((t) => {
      html += '<button class="chip' + (t === selectedType ? " active" : "") + '" data-select-type="' + t + '">' + (TYPE_LABELS[t] || t) + "</button>";
    });
    html += "</div>";

    const t = cfg.types[selectedType];
    html += '<div class="hint" style="color:#c8920a;font-size:11px;">Édition : <b>' + (TYPE_LABELS[selectedType] || selectedType) + "</b></div>";
    html += fld({ key: "priority", label: "Priorité (plus haut = passe avant)", min: 1, max: 10, step: 1 }, t);

    html += core.toggleSwitch("alertdur", "override", "Durée personnalisée", t.duration !== null);
    if (t.duration !== null) {
      html += fld({ key: "duration", label: "Durée (ms)", min: 1000, max: 15000, step: 250 }, t);
    } else {
      html += '<div class="hint">Utilise la durée par défaut (' + cfg.defaultDuration + ' ms), réglable dans l\'onglet Général.</div>';
    }

    html += '<hr style="border:none;border-top:1px solid rgba(200,146,10,0.15);margin:14px 0;">';
    html += "<h3>◎ ICÔNE</h3>";
    const iconVal = cfg.icons[selectedType] != null ? cfg.icons[selectedType] : (cfg.icons.default || "⬥");
    const iconIsImg = isImagePath(iconVal);
    html += '<div class="hint">Texte, emoji, ou une image importée.</div>';
    html += '<input type="text" id="iconTextInput" placeholder="♥, ★, 🔥…" value="' + (iconIsImg ? "" : escapeAttr(iconVal)) + '" style="width:100%;padding:6px 8px;margin:4px 0;background:#0d1320;border:1px solid rgba(200,146,10,0.35);color:#f0e0b0;border-radius:3px;">';
    if (iconIsImg) html += '<div class="bgName">Image : ' + iconVal + "</div>";
    html += '<button class="btn btn-main" id="btnPickIcon">🖼 Choisir une image</button>';
    if (iconIsImg) html += '<button class="btn" id="btnClearIconImg">✕ Revenir à texte/emoji</button>';

    html += '<hr style="border:none;border-top:1px solid rgba(200,146,10,0.15);margin:14px 0;">';
    html += "<h3>🔊 SON</h3>";
    html += core.toggleSwitch("soundoverride", "enable", "Son personnalisé pour ce type", !!t.sound);
    if (t.sound) {
      html += '<div class="bgName">' + t.sound + "</div>";
      html += '<button class="btn btn-main" id="btnPickTypeSound">🔊 Changer le son</button>';
      html += fld({ key: "volume", label: "Volume", min: 0, max: 1, step: 0.05 }, t);
    } else {
      html += '<div class="hint">Utilise le son par défaut (onglet Général).</div>';
    }

    html += '<hr style="border:none;border-top:1px solid rgba(200,146,10,0.15);margin:14px 0;">';
    html += "<h3>🎨 STYLE</h3>";
    html += core.toggleSwitch("styleoverride", "enable", "Style personnalisé pour cette alerte", !!t.style);
    if (t.style) {
      html += '<div class="hint">Ces réglages remplacent totalement le style Général pour ce type.</div>';
      html += renderStyleFields(t.style);
    } else {
      html += '<div class="hint">Utilise le style Général (onglet Général) : position, couleurs, typographie, icône, animation.</div>';
    }

    html += '<hr style="border:none;border-top:1px solid rgba(200,146,10,0.15);margin:14px 0;">';
    html += '<div class="hint">"▶ Tester" joue l\'animation réelle (avec son) dans l\'aperçu. "📡 Envoyer sur OBS" (en bas de l\'aperçu) la déclenche aussi sur une vraie source OBS/en stream, si le relais nk-relay tourne.</div>';
    return html;
  }

  function renderTab(tabId, cfg) {
    return tabId === "general" ? renderGeneralTab(cfg) : renderTypesTab(cfg);
  }

  function bindTab(tabId, cfg) {
    // Champs numériques (attr "alertnum") — cible cfg direct (Général),
    // cfg.defaultSound (son par défaut) ou cfg.types[selectedType] (Types).
    document.querySelectorAll("[data-alertnum]").forEach((el) => {
      el.oninput = (e) => {
        const key = el.dataset.alertnum;
        const v = parseFloat(e.target.value);
        let target = cfg;
        if (tabId === "types") target = cfg.types[selectedType];
        else if (key === "volume") target = cfg.defaultSound;
        target[key] = v;
        const def = { label: key === "priority" ? "Priorité (plus haut = passe avant)" : key === "duration" || key === "defaultDuration" ? "Durée (ms)" : "Volume" };
        if (el.previousElementSibling) el.previousElementSibling.textContent = def.label + " : " + v;
        core.markDirty();
        update(cfg);
      };
    });

    // Champs de style (numériques, couleurs, listes) — cible cfg.style
    // (Général) ou cfg.types[selectedType].style (Alertes, si override actif).
    function currentStyleTarget() {
      if (tabId === "types") return cfg.types[selectedType].style;
      return cfg.style;
    }
    document.querySelectorAll("[data-stylenum]").forEach((el) => {
      el.oninput = (e) => {
        const style = currentStyleTarget();
        if (!style) return;
        const key = el.dataset.stylenum;
        const v = parseFloat(e.target.value);
        style[key] = v;
        const def = ALL_STYLE_NUM_FIELDS.find((d) => d.key === key);
        if (def && el.previousElementSibling) el.previousElementSibling.textContent = def.label + " : " + v;
        core.markDirty();
        update(cfg);
      };
    });
    document.querySelectorAll("[data-stylecolor]").forEach((el) => {
      el.oninput = (e) => {
        const style = currentStyleTarget();
        if (!style) return;
        style[el.dataset.stylecolor] = e.target.value;
        core.markDirty();
        update(cfg);
      };
    });
    document.querySelectorAll("[data-styleselect]").forEach((el) => {
      el.onchange = (e) => {
        const style = currentStyleTarget();
        if (!style) return;
        style[el.dataset.styleselect] = e.target.value;
        core.markDirty();
        update(cfg);
      };
    });
    document.querySelectorAll("details.sec[data-sec]").forEach((d) => {
      d.ontoggle = () => { styleSecOpen[d.dataset.sec] = d.open; };
    });

    if (tabId === "general") {
      const pickBtn = $("#btnPickDefaultSound");
      if (pickBtn) pickBtn.onclick = () => openSoundPicker((path) => {
        cfg.defaultSound.file = path; core.markDirty(); core.renderPanel();
      });
      const clearBtn = $("#btnClearDefaultSound");
      if (clearBtn) clearBtn.onclick = () => { cfg.defaultSound.file = null; core.markDirty(); core.renderPanel(); };
      const defIconInput = $("#defaultIconInput");
      if (defIconInput) defIconInput.oninput = (e) => { cfg.icons.default = e.target.value; core.markDirty(); update(cfg); };
    }

    if (tabId === "types") {
      document.querySelectorAll("[data-select-type]").forEach((el) => {
        el.onclick = () => {
          selectedType = el.dataset.selectType;
          core.renderPanel();
          updateTestBarLabel();
          postToIframe({ type: "nk-test", cmd: "trigger", alertType: selectedType });
        };
      });
      document.querySelectorAll("[data-tkind='alertdur']").forEach((el) => {
        el.onclick = () => {
          const t = cfg.types[selectedType];
          t.duration = t.duration === null ? cfg.defaultDuration : null;
          core.markDirty();
          core.renderPanel();
        };
      });
      document.querySelectorAll("[data-tkind='soundoverride']").forEach((el) => {
        el.onclick = () => {
          const t = cfg.types[selectedType];
          if (t.sound) {
            t.sound = null; t.volume = null;
            core.markDirty();
            core.renderPanel();
          } else {
            openSoundPicker((path) => {
              t.sound = path;
              if (t.volume == null) t.volume = 0.8;
              core.markDirty();
              core.renderPanel();
            });
          }
        };
      });
      const pickTypeBtn = $("#btnPickTypeSound");
      if (pickTypeBtn) pickTypeBtn.onclick = () => openSoundPicker((path) => {
        cfg.types[selectedType].sound = path;
        core.markDirty();
        core.renderPanel();
      });

      document.querySelectorAll("[data-tkind='styleoverride']").forEach((el) => {
        el.onclick = () => {
          const t = cfg.types[selectedType];
          t.style = t.style ? null : JSON.parse(JSON.stringify(cfg.style));
          core.markDirty();
          core.renderPanel();
        };
      });

      const iconInput = $("#iconTextInput");
      if (iconInput) iconInput.oninput = (e) => { cfg.icons[selectedType] = e.target.value; core.markDirty(); update(cfg); };
      const pickIconBtn = $("#btnPickIcon");
      if (pickIconBtn) pickIconBtn.onclick = () => openImagePicker((path) => {
        cfg.icons[selectedType] = path; core.markDirty(); core.renderPanel();
      });
      const clearIconBtn = $("#btnClearIconImg");
      if (clearIconBtn) clearIconBtn.onclick = () => {
        cfg.icons[selectedType] = DEFAULT_ICONS[selectedType] || "⬥";
        core.markDirty();
        core.renderPanel();
      };
    }
  }

  // ═══════════════════════════════════════════════════════════════════════
  // APERÇU LIVE — iframe + blob (même pattern que mode-chat.js), avec une
  // barre de test flottante en bas au centre de la scène (même idée que le
  // bouton Tester du mode Chat) : elle joue l'animation RÉELLE (in/show/out,
  // avec le son) du type actuellement édité, puis revient à l'affichage
  // figé pour continuer à ajuster position/taille visuellement.
  // ═══════════════════════════════════════════════════════════════════════
  let iframeEl = null;
  let previewWrap = null;
  let blobUrl = null;
  let testBarEl = null, testBtnEl = null, obsBtnEl = null;

  function postToIframe(msg) {
    if (iframeEl && iframeEl.contentWindow) iframeEl.contentWindow.postMessage(msg, "*");
  }

  // ═══════════════════════════════════════════════════════════════════════
  // Connexion au relais (nk-relay) pour le bouton « Envoyer sur OBS » — se
  // connecte au MÊME serveur WS que les overlays réels (ws://127.0.0.1:8080/)
  // et envoie une requête NkTestAlert ; le relais rebroadcast un événement
  // de test réel sur TOUS les clients connectés, donc visible dans une
  // vraie source OBS/en stream (pas seulement dans l'aperçu de l'éditeur).
  // ═══════════════════════════════════════════════════════════════════════
  let relayWs = null;
  function ensureRelayWs() {
    if (relayWs && (relayWs.readyState === WebSocket.OPEN || relayWs.readyState === WebSocket.CONNECTING)) return relayWs;
    try {
      relayWs = new WebSocket("ws://127.0.0.1:8080/");
      relayWs.onclose = () => { relayWs = null; };
      relayWs.onerror = () => {};
    } catch (e) { relayWs = null; }
    return relayWs;
  }
  function closeRelayWs() {
    if (relayWs) { try { relayWs.close(); } catch (e) {} relayWs = null; }
  }
  function flashObsBtn(text, ms) {
    if (!obsBtnEl) return;
    obsBtnEl.textContent = text;
    setTimeout(updateTestBarLabel, ms || 1600);
  }
  function sendTestToObs() {
    if (!RELAY_REACHABLE_TYPES.has(selectedType)) return;
    const ws = ensureRelayWs();
    if (!ws) { flashObsBtn("⚠ Relais introuvable"); return; }
    const payload = JSON.stringify({ request: "NkTestAlert", alertType: selectedType });
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(payload);
      flashObsBtn("✓ Envoyé sur OBS");
    } else {
      flashObsBtn("… Connexion au relais");
      ws.addEventListener("open", () => { ws.send(payload); flashObsBtn("✓ Envoyé sur OBS"); }, { once: true });
      ws.addEventListener("error", () => { flashObsBtn("⚠ Relais introuvable"); }, { once: true });
    }
  }

  async function buildPreviewUrl(cfg) {
    const jsContent = await ensureSupportJs();
    const html = buildAlertsHtml(cfg, true, jsContent);
    if (blobUrl) URL.revokeObjectURL(blobUrl);
    blobUrl = URL.createObjectURL(new Blob([html], { type: "text/html" }));
    return blobUrl;
  }

  function createTestBar() {
    if (testBarEl) return;
    testBarEl = document.createElement("div");
    testBarEl.style.cssText = "position:absolute;left:50%;bottom:24px;transform:translateX(-50%);z-index:60;display:flex;gap:8px;";
    testBtnEl = document.createElement("button");
    testBtnEl.style.cssText = "padding:9px 18px;border-radius:20px;border:1px solid rgba(200,146,10,0.6);"
      + "background:#0d1320;color:#c8920a;font-size:12px;box-shadow:0 4px 14px rgba(0,0,0,0.5);cursor:pointer;";
    testBtnEl.onclick = () => postToIframe({ type: "nk-test", cmd: "trigger", alertType: selectedType });
    obsBtnEl = document.createElement("button");
    obsBtnEl.style.cssText = "padding:9px 18px;border-radius:20px;border:1px solid rgba(90,180,255,0.6);"
      + "background:#0d1320;color:#7ec4ff;font-size:12px;box-shadow:0 4px 14px rgba(0,0,0,0.5);cursor:pointer;";
    obsBtnEl.onclick = sendTestToObs;
    testBarEl.appendChild(testBtnEl);
    testBarEl.appendChild(obsBtnEl);
    stageOuter.appendChild(testBarEl);
    updateTestBarLabel();
  }

  function updateTestBarLabel() {
    if (testBtnEl) testBtnEl.textContent = "▶ Tester " + (TYPE_LABELS[selectedType] || selectedType);
    if (obsBtnEl) {
      const reachable = RELAY_REACHABLE_TYPES.has(selectedType);
      obsBtnEl.textContent = "📡 Envoyer sur OBS";
      obsBtnEl.disabled = !reachable;
      obsBtnEl.style.opacity = reachable ? "1" : "0.4";
      obsBtnEl.style.cursor = reachable ? "pointer" : "not-allowed";
      obsBtnEl.title = reachable
        ? "Envoie un vrai événement de test via le relais (nk-relay) — visible dans une vraie source OBS."
        : "Ce type n'a pas d'événement Twitch/legacy équivalent — impossible à tester via le relais.";
    }
  }

  function removeTestBar() {
    if (testBarEl) { testBarEl.remove(); testBarEl = null; testBtnEl = null; obsBtnEl = null; }
    closeRelayWs();
  }

  // ═══════════════════════════════════════════════════════════════════════
  // POINT REPÈRE DE POSITION — glisser directement sur l'aperçu pour régler
  // offsetX/bottomOffset, comme les marqueurs du mode Fond animé. La cible
  // du glisser dépend de l'onglet actif : style Général, ou style du type
  // sélectionné si son override est actif (sinon pas de point : il n'y a
  // rien à déplacer tant que l'override n'existe pas). La conversion
  // fraction→px utilise la résolution de scène configurée (core.getStageSize,
  // 1920×1080 par défaut) — l'iframe de l'aperçu remplit exactement stageInner.
  // ═══════════════════════════════════════════════════════════════════════
  let markerEl = null;
  function currentPositionTarget(cfg) {
    if (core.getActiveTab() === "types") return cfg.types[selectedType].style;
    return cfg.style;
  }
  function refreshPositionMarker() {
    if (markerEl) { markerEl.remove(); markerEl = null; }
    const cfg = core.getConfig();
    if (!cfg || !previewWrap) return;
    const target = currentPositionTarget(cfg);
    if (!target) return;
    const stage = core.getStageSize();
    const fx = Math.min(1, Math.max(0, 0.5 + target.offsetX / stage.w));
    const fy = Math.min(1, Math.max(0, 1 - target.bottomOffset / stage.h));
    markerEl = document.createElement("div");
    markerEl.className = "nk-marker";
    markerEl.style.left = (fx * 100) + "%";
    markerEl.style.top = (fy * 100) + "%";
    markerEl.style.background = "#c8920a";
    markerEl.style.zIndex = "61";
    markerEl.title = "Glissez pour repositionner l'alerte";
    markerEl.onmousedown = (e) => {
      if (e.button !== 0) return;
      core.startDrag(e, (nfx, nfy) => {
        target.offsetX = Math.round((nfx - 0.5) * stage.w);
        target.bottomOffset = Math.round((1 - nfy) * stage.h);
        markerEl.style.left = (nfx * 100) + "%";
        markerEl.style.top = (nfy * 100) + "%";
        core.markDirty();
        update(cfg);
      });
    };
    stageInner.appendChild(markerEl);
  }

  async function mount(cfg) {
    fxCanvas.style.display = "none";
    $("#bgPickerWrap").style.display = "none";
    previewWrap = document.createElement("div");
    previewWrap.id = "nkAlertsPreviewWrap";
    previewWrap.style.cssText = "position:absolute;inset:0;background:#050c18;z-index:20;overflow:hidden;";
    const ifr = document.createElement("iframe");
    ifr.style.cssText = "position:absolute;inset:0;width:100%;height:100%;border:0;";
    stageInner.appendChild(previewWrap);
    iframeEl = ifr;
    createTestBar();
    ifr.src = await buildPreviewUrl(cfg);
    previewWrap.appendChild(ifr);
    refreshPositionMarker();
  }

  function update(cfg) {
    if (!iframeEl) return;
    postToIframe({ type: "nk-test", cmd: "config", payload: { alertsConfig: cfg } });
    refreshPositionMarker();
  }

  function unmount() {
    if (previewWrap) { previewWrap.remove(); previewWrap = null; }
    iframeEl = null;
    if (blobUrl) { URL.revokeObjectURL(blobUrl); blobUrl = null; }
    removeTestBar();
    if (markerEl) { markerEl.remove(); markerEl = null; }
    fxCanvas.style.display = "";
  }

  // ═══════════════════════════════════════════════════════════════════════
  // GÉNÉRATION DU FICHIER DE SORTIE (dc-runtime, compatible Alertes.dc.html)
  // ═══════════════════════════════════════════════════════════════════════
  function buildAlertsHtml(cfg, previewMode, inlineSupportJs) {
    if (previewMode === undefined) previewMode = false;
    const supportTag = (previewMode && inlineSupportJs)
      ? '<script>' + inlineSupportJs + '<\/script>'
      : '<script src="./Nouilles-Arcana/support.js"><\/script>';
    return `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
${supportTag}
<script id="nk-alerts-config" type="application/json">${JSON.stringify(cfg)}<\/script>
</head>
<body>
<x-dc>
<helmet>
  <link href="https://fonts.googleapis.com/css2?family=Cinzel+Decorative:wght@700&family=Noto+Serif+SC:wght@300;400;600&display=swap" rel="stylesheet">
  <style>
    * { margin:0; padding:0; box-sizing:border-box; }
    html, body { width:100%; height:100%; overflow:hidden; background:transparent; }
    @keyframes iconPop   { 0%,100%{transform:scale(1);}       50%{transform:scale(1.12);} }
    @keyframes goldShine { 0%,100%{text-shadow:0 0 12px rgba(200,146,10,0.5);}  50%{text-shadow:0 0 25px rgba(200,146,10,0.9), 0 0 50px rgba(200,146,10,0.3);} }
    @keyframes shimSlide { 0%{left:-90%;} 100%{left:190%;} }
    @keyframes edgePulse { 0%,100%{opacity:0.6;} 50%{opacity:1;} }
  </style>
</helmet>

<!-- ══════════════════════════════════════════════════════════════════════
     ALERTES.DC.HTML — Overlay d'alertes Twitch pour OBS

     ▶ Taille dans OBS : 2560 × 1440 (ou votre résolution)
     ▶ Position OBS    : par-dessus tout le reste (source tout en haut)
     ▶ Test en direct  : ajoutez ?test=1 à l'URL dans OBS pour voir les boutons
     ▶ Appuyez sur [T] dans l'aperçu OBS pour cycler les alertes de test

     API (console OBS → clic droit sur source → "Interact" → console):
       window.nkAlert.trigger('follow',   { username:'pseudo' })
       window.nkAlert.trigger('sub',      { username:'pseudo', months:1 })
       window.nkAlert.trigger('raid',     { username:'pseudo', viewers:150 })
       window.nkAlert.trigger('bits',     { username:'pseudo', amount:500, message:'GG!' })
       window.nkAlert.trigger('donation', { username:'pseudo', amount:'10.00', message:'Merci' })
══════════════════════════════════════════════════════════════════════ -->

<div style="position:relative;width:100vw;height:100vh;background:transparent;pointer-events:none;">

  <!-- ══ ZONE ALERTE (bas-centre, décalage horizontal + tout le style réglables) ══ -->
  <div style="position:fixed;bottom:{{ alertBottom }}px;left:50%;transform:{{ outerTransform }};z-index:500;">
    <div style="{{ alertBoxStyle }}">

      <!-- Panneau principal -->
      <div style="{{ panelStyle }}">
        <!-- Coins ornementaux L (accent fixe, non paramétré) -->
        <div style="position:absolute;top:-7px;left:-7px;width:22px;height:22px;border-top:3px solid #c8920a;border-left:3px solid #c8920a;z-index:2;"></div>
        <div style="position:absolute;top:-7px;right:-7px;width:22px;height:22px;border-top:3px solid #c8920a;border-right:3px solid #c8920a;z-index:2;"></div>
        <div style="position:absolute;bottom:-7px;left:-7px;width:22px;height:22px;border-bottom:3px solid #c8920a;border-left:3px solid #c8920a;z-index:2;"></div>
        <div style="position:absolute;bottom:-7px;right:-7px;width:22px;height:22px;border-bottom:3px solid #c8920a;border-right:3px solid #c8920a;z-index:2;"></div>
        <!-- Lignes déco bords -->
        <div style="position:absolute;top:-3px;left:50%;transform:translateX(-50%);width:32%;height:2px;background:linear-gradient(90deg,transparent,#c8920a,transparent);z-index:2;animation:edgePulse 2s ease-in-out infinite;"></div>
        <div style="position:absolute;bottom:-3px;left:50%;transform:translateX(-50%);width:32%;height:2px;background:linear-gradient(90deg,transparent,#c8920a,transparent);z-index:2;animation:edgePulse 2s ease-in-out infinite 1s;"></div>
        <!-- Cadre intérieur -->
        <div style="position:absolute;top:6px;right:6px;bottom:6px;left:6px;border:1px solid rgba(200,146,10,0.18);border-radius:2px;pointer-events:none;"></div>
        <!-- Shimmer (conteneur clippé pour rester dans le cadre) -->
        <div style="position:absolute;inset:0;overflow:hidden;border-radius:3px;pointer-events:none;z-index:1;">
          <div style="position:absolute;top:0;height:100%;width:28%;background:linear-gradient(90deg,transparent,rgba(200,146,10,0.07),transparent);animation:shimSlide 3.5s ease-in-out infinite;"></div>
        </div>

        <!-- Contenu -->
        <div style="position:relative;z-index:2;padding:32px 44px 28px;display:flex;flex-direction:column;align-items:center;gap:16px;text-align:center;">

          <!-- Icône grand format (texte/emoji ou image importée) -->
          <div style="{{ iconBoxStyle }}">
            <sc-if value="{{ iconIsImage }}" hint-placeholder-val="{{ false }}">
              <img src="{{ iconSrc }}" style="{{ iconImgStyle }}">
            </sc-if>
            <sc-if value="{{ iconIsText }}" hint-placeholder-val="{{ true }}">
              <span>{{ alertIcon }}</span>
            </sc-if>
          </div>

          <!-- Titre alerte -->
          <div style="{{ titleStyle }}">{{ alertTitle }}</div>

          <!-- Séparateur ornemental -->
          <div style="display:flex;align-items:center;gap:10px;width:100%;padding:0 16px;">
            <div style="flex:1;height:1px;background:linear-gradient(90deg,transparent,rgba(200,146,10,0.55));"></div>
            <div style="width:6px;height:6px;border:1px solid #c8920a;transform:rotate(45deg);"></div>
            <div style="flex:1;height:1px;background:linear-gradient(90deg,rgba(200,146,10,0.55),transparent);"></div>
          </div>

          <!-- Nom principal (username / niveau) -->
          <div style="{{ mainStyle }}">{{ alertMain }}</div>

          <!-- Sous-texte (message, mois, viewers...) -->
          <sc-if value="{{ hasSub }}" hint-placeholder-val="{{ false }}">
            <div style="{{ subStyle }}">{{ alertSub }}</div>
          </sc-if>

        </div>
      </div>
    </div>
  </div>

  <!-- ══ BOUTONS DE TEST (visibles uniquement avec ?test=1 dans l'URL) ══ -->
  <sc-if value="{{ showTest }}" hint-placeholder-val="{{ false }}">
    <div style="position:fixed;bottom:18px;left:18px;display:flex;gap:6px;flex-wrap:wrap;max-width:650px;pointer-events:all;z-index:600;">
      <button onClick="{{ tFollow }}"  style="padding:6px 10px;background:rgba(200,146,10,0.18);border:1px solid rgba(200,146,10,0.5);color:#c8920a;border-radius:3px;cursor:pointer;font-size:11px;">♥ Follow</button>
      <button onClick="{{ tSub }}"     style="padding:6px 10px;background:rgba(200,146,10,0.18);border:1px solid rgba(200,146,10,0.5);color:#c8920a;border-radius:3px;cursor:pointer;font-size:11px;">★ Sub</button>
      <button onClick="{{ tResub }}"   style="padding:6px 10px;background:rgba(200,146,10,0.18);border:1px solid rgba(200,146,10,0.5);color:#c8920a;border-radius:3px;cursor:pointer;font-size:11px;">★ Resub</button>
      <button onClick="{{ tGift }}"    style="padding:6px 10px;background:rgba(200,146,10,0.18);border:1px solid rgba(200,146,10,0.5);color:#c8920a;border-radius:3px;cursor:pointer;font-size:11px;">🎁 Gift</button>
      <button onClick="{{ tBomb }}"    style="padding:6px 10px;background:rgba(200,146,10,0.18);border:1px solid rgba(200,146,10,0.5);color:#c8920a;border-radius:3px;cursor:pointer;font-size:11px;">💥 Bomb</button>
      <button onClick="{{ tBits }}"    style="padding:6px 10px;background:rgba(200,146,10,0.18);border:1px solid rgba(200,146,10,0.5);color:#c8920a;border-radius:3px;cursor:pointer;font-size:11px;">💎 Bits</button>
      <button onClick="{{ tRaid }}"    style="padding:6px 10px;background:rgba(200,146,10,0.18);border:1px solid rgba(200,146,10,0.5);color:#c8920a;border-radius:3px;cursor:pointer;font-size:11px;">⚔ Raid</button>
      <button onClick="{{ tDon }}"     style="padding:6px 10px;background:rgba(200,146,10,0.18);border:1px solid rgba(200,146,10,0.5);color:#c8920a;border-radius:3px;cursor:pointer;font-size:11px;">$ Don</button>
      <button onClick="{{ tHype }}"    style="padding:6px 10px;background:rgba(200,146,10,0.18);border:1px solid rgba(200,146,10,0.5);color:#c8920a;border-radius:3px;cursor:pointer;font-size:11px;">🚂 Hype</button>
      <button onClick="{{ tPoints }}"  style="padding:6px 10px;background:rgba(200,146,10,0.18);border:1px solid rgba(200,146,10,0.5);color:#c8920a;border-radius:3px;cursor:pointer;font-size:11px;">✦ Points</button>
      <button onClick="{{ tHost }}"    style="padding:6px 10px;background:rgba(200,146,10,0.18);border:1px solid rgba(200,146,10,0.5);color:#c8920a;border-radius:3px;cursor:pointer;font-size:11px;">📡 Host</button>
      <button onClick="{{ tCheer }}"   style="padding:6px 10px;background:rgba(200,146,10,0.18);border:1px solid rgba(200,146,10,0.5);color:#c8920a;border-radius:3px;cursor:pointer;font-size:11px;">🎉 Cheer</button>
    </div>
  </sc-if>

</div>
</x-dc>
<script type="text/x-dc" data-dc-script data-props="{&quot;$preview&quot;:{&quot;width&quot;:1280,&quot;height&quot;:720}}">
class Component extends DCLogic {

  // ═══════════════════════════════════════════════════════════════════════
  // ⚙️ CONFIGURATION DES ALERTES — générée par l'éditeur Nouilles-Arcana
  //    (mode Alertes). Modifiez-la depuis l'éditeur, pas ici directement.
  // ═══════════════════════════════════════════════════════════════════════
  alertsConfig = ${JSON.stringify(cfg)};

  // ═══════════════════════════════════════════════════════════════════════
  // 💬 MESSAGES PERSONNALISÉS PAR TYPE D'ALERTE
  // ═══════════════════════════════════════════════════════════════════════
  messages = {
    follow:         { title:'NOUVEAU FOLLOWER',   main:(d)=>d.username||'', sub:(d)=>'' },
    sub:            { title:'NOUVEL ABONNÉ',       main:(d)=>d.username||'', sub:(d)=>d.months>1 ? d.months+' mois consécutifs !' : 'Bienvenue !' },
    resub:          { title:'RESUB',               main:(d)=>d.username||'', sub:(d)=>(d.months||1)+' mois'+(d.message?' · "'+d.message+'"':'') },
    subgift:        { title:'SUB OFFERT',          main:(d)=>d.username||'', sub:(d)=>'→ offert à '+(d.recipient||'???') },
    subgiftbomb:    { title:'SUB BOMB !',          main:(d)=>d.username||'', sub:(d)=>(d.amount||1)+' subs offerts à la communauté !' },
    bits:           { title:(d)=>(d.amount||0)+' BITS', main:(d)=>d.username||'', sub:(d)=>d.message||'' },
    cheer:          { title:(d)=>(d.amount||0)+' CHEERS',main:(d)=>d.username||'',sub:(d)=>d.message||'' },
    raid:           { title:'RAID !',              main:(d)=>d.username||'', sub:(d)=>(d.viewers||0)+' viewers débarquent !' },
    donation:       { title:(d)=>'DON · '+(d.amount||0)+'€', main:(d)=>d.username||'', sub:(d)=>d.message||'' },
    hypetrainLevel: { title:'HYPE TRAIN !',        main:(d)=>'Niveau '+(d.level||1), sub:(d)=>'Allez, on continue !' },
    channelPoints:  { title:'RÉCOMPENSE',          main:(d)=>d.username||'', sub:(d)=>d.reward||'' },
    host:           { title:'HOST',                main:(d)=>d.username||'', sub:(d)=>(d.viewers||0)+' viewers' },
    charity:        { title:'DON CARITATIF',       main:(d)=>d.username||'', sub:(d)=>(d.amount||0)+'€ pour '+(d.charity||'la cause') },
    ban:            { title:'BAN',                 main:(d)=>d.username||'', sub:(d)=>'' },
  };

  // Les icônes (texte/emoji ou chemin d'image) viennent maintenant de
  // alertsConfig.icons — éditables par type dans l'onglet Alertes.

  // ═══════════════════════════════════════════════════════════════════════
  // 🚫 NE PAS MODIFIER EN DESSOUS — utilisez l'éditeur visuel
  // ═══════════════════════════════════════════════════════════════════════

  state = { phase:'hidden', current:null };
  _queue = [];
  _busy  = false;
  _ti    = 0;
  _previewMode = ${previewMode ? 'true' : 'false'};

  _demos = [
    { type:'follow',       username:'mizuuu_' },
    { type:'sub',          username:'ramen_addict', months:1 },
    { type:'resub',        username:'noodlefan', months:6, message:'Toujours là pour le chill !' },
    { type:'subgift',      username:'NoodleMaster', recipient:'zennoodles' },
    { type:'subgiftbomb',  username:'BigNoodleFan', amount:10 },
    { type:'bits',         username:'sparkle_ramen', amount:500, message:'Keep going!' },
    { type:'cheer',        username:'CheerBot', amount:1000, message:'PogChamp' },
    { type:'raid',         username:'RaidBoss', viewers:250 },
    { type:'donation',     username:'generousViewer', amount:'20.00', message:'Super stream !' },
    { type:'hypetrainLevel', level:1 },
    { type:'channelPoints',  username:'someone', reward:'Personnage aléatoire' },
    { type:'charity',      username:'Philanthrope', amount:'50.00', charity:'la Croix-Rouge' },
  ];

  componentDidMount() {
    window.nkAlert = {
      trigger: (type, data = {}) => { this._queue.push({ type, ...data }); this._next(); },
      test:    (type) => this._demo(type),
    };
    document.addEventListener('keydown', (e) => {
      if (e.key === 't' || e.key === 'T') this._demo();
    });
    const p = new URLSearchParams(window.location.search);
    if (p.get('test') === '1') setTimeout(() => this._demo(), 1000);
    if (this._previewMode) this._setupPreviewMode();
    this._connectStreamerBot();
  }

  // ── Mode aperçu (utilisé uniquement par l'éditeur) ──
  // Contrairement au flux normal (_next/_queue), l'aperçu affiche l'alerte
  // choisie IMMÉDIATEMENT et la garde ouverte indéfiniment (pas de phase
  // "out" automatique) — pour pouvoir ajuster position/taille/son en la
  // regardant, plutôt que de la voir disparaître après quelques secondes.
  _setupPreviewMode() {
    window.addEventListener('message', (ev) => {
      const d = ev.data;
      if (!d || d.type !== 'nk-test') return;
      if (d.cmd === 'config' && d.payload && d.payload.alertsConfig) {
        Object.assign(this.alertsConfig, d.payload.alertsConfig);
        this.forceUpdate();
      } else if (d.cmd === 'trigger' && d.alertType) {
        // Joue l'animation réelle (in/show/out + son) — _next() revient
        // automatiquement à l'affichage figé (_previewShow) une fois finie.
        // On force l'interruption de tout cycle en cours pour que chaque
        // clic sur "Tester" ait un effet immédiat (pas de file d'attente
        // en aperçu éditeur).
        this._queue = [];
        this._busy = false;
        this._demo(d.alertType);
      }
    });
    this._previewShow('follow');
  }

  _previewShow(type) {
    const a = this._demos.find(x => x.type === type) || { type, username: 'test_user', viewers: 50 };
    this.setState({ phase: 'show', current: { ...a } });
    this._playSound(a.type);
  }

  // ═══════════════════════════════════════════════════════════════════════
  // 🔌 PONT TWITCH via Streamer.bot (WebSocket Server)
  //    Prérequis dans Streamer.bot : onglet "Platforms" → Twitch connecté,
  //    onglet "Servers/Clients" → WebSocket Server → activé + démarré
  //    (port par défaut 8080). Rien d'autre à configurer côté Streamer.bot.
  //    Pour pointer vers un autre PC/port, ajoutez ?sbHost=IP&sbPort=PORT
  //    à l'URL de la Browser Source dans OBS.
  // ═══════════════════════════════════════════════════════════════════════
  _connectStreamerBot() {
    const params = new URLSearchParams(window.location.search);
    const host = params.get('sbHost') || '127.0.0.1';
    const port = params.get('sbPort') || '8080';
    const url  = 'ws://' + host + ':' + port + '/';

    const open = () => {
      let ws;
      try { ws = new WebSocket(url); } catch (e) { setTimeout(open, 5000); return; }

      ws.onopen = () => {
        console.log('[nkAlert] connecté à Streamer.bot');
        ws.send(JSON.stringify({
          request: 'Subscribe',
          id: 'nk-alerts',
          events: {
            Twitch: [
              'Follow', 'Sub', 'ReSub', 'GiftSub', 'GiftBomb', 'Cheer', 'Raid',
              'ChannelPointsRedemption', 'HypeTrainStart', 'HypeTrainLevelUp', 'Host'
            ]
          }
        }));
      };

      ws.onmessage = (ev) => {
        let msg;
        try { msg = JSON.parse(ev.data); } catch { return; }
        const type = msg && msg.event && msg.event.type;
        const d = (msg && msg.data) || {};
        if (!type) return;
        if (type === 'NkReload') {
          // Sauvegarde détectée côté éditeur — recharge pour reprendre la
          // config à jour. Pas en mode aperçu (déjà mis à jour en direct
          // par postMessage ; un reload y ferait juste perdre le type affiché).
          if (!this._previewMode) window.location.reload();
          return;
        }
        const u = d.user_name || d.username || d.displayName || '';
        switch (type) {
          case 'Follow':
            window.nkAlert.trigger('follow', { username: u }); break;
          case 'Sub':
            window.nkAlert.trigger('sub', { username: u, months: d.cumulative_months || 1 }); break;
          case 'ReSub':
            window.nkAlert.trigger('resub', { username: u, months: d.cumulative_months || d.months || 1, message: (d.message && d.message.text) || d.message || '' }); break;
          case 'GiftSub':
            window.nkAlert.trigger('subgift', { username: u, recipient: d.recipient_user_name || d.recipient || '' }); break;
          case 'GiftBomb':
            window.nkAlert.trigger('subgiftbomb', { username: u, amount: d.total || d.amount || 1 }); break;
          case 'Cheer':
            window.nkAlert.trigger('bits', { username: u, amount: d.bits || d.amount || 0, message: d.message || '' }); break;
          case 'Raid':
            window.nkAlert.trigger('raid', { username: d.from_broadcaster_user_name || u, viewers: d.viewers || 0 }); break;
          case 'ChannelPointsRedemption':
            window.nkAlert.trigger('channelPoints', { username: u, reward: (d.reward && d.reward.title) || d.reward_title || '' }); break;
          case 'HypeTrainStart':
          case 'HypeTrainLevelUp':
            window.nkAlert.trigger('hypetrainLevel', { level: d.level || 1 }); break;
          case 'Host':
            window.nkAlert.trigger('host', { username: u, viewers: d.viewers || 0 }); break;
        }
      };

      ws.onclose = () => setTimeout(open, 5000);
      ws.onerror = () => ws.close();
    };

    open();
  }

  _demo(type) {
    let a;
    if (type) { a = this._demos.find(x => x.type === type); }
    if (!a)   { a = this._demos[this._ti % this._demos.length]; this._ti++; }
    this._queue.push({...a});
    this._next();
  }

  // File d'attente par priorité — l'alerte de priorité la plus haute passe
  // en premier ; à priorité égale, l'ordre d'arrivée est conservé.
  _next() {
    if (this._busy || !this._queue.length) return;
    this._busy = true;
    let bestIdx = 0, bestPrio = -1;
    this._queue.forEach((a, i) => {
      const p = (this.alertsConfig.types[a.type] || {}).priority || 1;
      if (p > bestPrio) { bestPrio = p; bestIdx = i; }
    });
    const alert = this._queue.splice(bestIdx, 1)[0];
    const style = this._effectiveStyle(alert.type);
    this.setState({ phase:'in', current:alert });
    setTimeout(() => this.setState({ phase:'show' }), 50);
    const dur = this._durationFor(alert.type);
    this._playSound(alert.type);
    setTimeout(() => {
      this.setState({ phase:'out' });
      const outMs = (style.animDuration || 520) + 130;
      setTimeout(() => {
        this._busy = false;
        if (this._previewMode) {
          // Aperçu éditeur : après l'animation réelle, retour à l'affichage
          // figé du type édité pour continuer à ajuster visuellement.
          this._previewShow(alert.type);
        } else {
          this.setState({ phase:'hidden', current:null });
          this._next();
        }
      }, outMs);
    }, dur);
  }

  _durationFor(type) {
    const t = this.alertsConfig.types[type];
    return (t && t.duration != null) ? t.duration : this.alertsConfig.defaultDuration;
  }

  // Style effectif d'un type : son override complet (cfg.types[t].style)
  // s'il existe, sinon le style Général (cfg.style).
  _effectiveStyle(type) {
    const C = this.alertsConfig;
    const t = type ? C.types[type] : null;
    return (t && t.style) ? t.style : C.style;
  }

  // Icône effective : celle du type si définie, sinon l'icône de repli.
  _effectiveIcon(type) {
    const C = this.alertsConfig;
    const v = type ? C.icons[type] : null;
    return (v != null && v !== '') ? v : (C.icons.default || '⬥');
  }

  _hexToRgba(hex, a) {
    const n = parseInt(String(hex || '#000000').replace('#', ''), 16) || 0;
    const r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
    return 'rgba(' + r + ',' + g + ',' + b + ',' + (a == null ? 1 : a) + ')';
  }

  // Transform/opacité/transition selon la phase et l'animation choisie
  // (entrée/sortie/durée réglables dans l'éditeur, section "Animation").
  _alertBoxStyleFor(phase, style) {
    const durS = (style.animDuration || 520) / 1000;
    const activeAnim = phase === 'out' ? style.animOut : style.animIn;
    let transform = 'none';
    if (activeAnim === 'slide-up') {
      transform = phase === 'out' ? 'translateY(-44px)' : phase === 'in' ? 'translateY(65px)' : 'translateY(0px)';
    } else if (activeAnim === 'slide-down') {
      transform = phase === 'out' ? 'translateY(44px)' : phase === 'in' ? 'translateY(-65px)' : 'translateY(0px)';
    } else if (activeAnim === 'slide-left') {
      transform = phase === 'out' ? 'translateX(-80px)' : phase === 'in' ? 'translateX(80px)' : 'translateX(0px)';
    } else if (activeAnim === 'slide-right') {
      transform = phase === 'out' ? 'translateX(80px)' : phase === 'in' ? 'translateX(-80px)' : 'translateX(0px)';
    } else if (activeAnim === 'drop') {
      transform = phase === 'out' ? 'translateY(95px)' : phase === 'in' ? 'translateY(-140px)' : 'translateY(0px)';
    } else if (activeAnim === 'pop') {
      transform = (phase === 'out' || phase === 'in') ? 'scale(0.85)' : 'scale(1)';
    }
    return {
      opacity: (phase === 'show' || phase === 'in') ? 1 : 0,
      transform,
      transition: activeAnim === 'none' ? 'none' : ('opacity ' + durS + 's ease, transform ' + durS + 's cubic-bezier(0.34,1.56,0.64,1)'),
      pointerEvents: 'none',
    };
  }

  // Son par défaut pour toutes les alertes, sauf si ce type a un son
  // personnalisé qui l'écrase (override).
  _playSound(type) {
    const C = this.alertsConfig;
    const t = C.types[type];
    const file = (t && t.sound) ? t.sound : C.defaultSound.file;
    const vol  = (t && t.sound) ? (t.volume != null ? t.volume : 0.8) : C.defaultSound.volume;
    if (!file) return;
    try { const a = new Audio(file); a.volume = vol != null ? vol : 0.8; a.play().catch(() => {}); } catch (e) {}
  }

  _getMsg(alert) {
    if (!alert) return { title:'', main:'', sub:'' };
    const def = this.messages[alert.type];
    if (!def) return { title: alert.type.toUpperCase(), main: alert.username || '', sub: '' };
    return {
      title: typeof def.title === 'function' ? def.title(alert) : def.title,
      main:  def.main(alert),
      sub:   def.sub(alert),
    };
  }

  renderVals() {
    const { phase, current } = this.state;
    const info = this._getMsg(current);
    const params = new URLSearchParams(window.location.search);
    const type = current ? current.type : null;
    const style = this._effectiveStyle(type);
    const iconVal = current ? this._effectiveIcon(type) : (this.alertsConfig.icons.default || '⬥');
    const iconIsImage = /\.(png|jpe?g|gif|webp)$/i.test(iconVal);

    return {
      alertBoxStyle: this._alertBoxStyleFor(phase, style),
      outerTransform: 'translateX(calc(-50% + ' + (style.offsetX || 0) + 'px))',
      alertBottom: style.bottomOffset,
      panelStyle: {
        position: 'relative', width: style.alertWidth + 'px',
        border: '1.5px solid ' + style.borderColor,
        background: this._hexToRgba(style.bgColor, style.bgOpacity),
        borderRadius: style.borderRadius + 'px',
        overflow: 'visible',
        boxShadow: '0 0 50px ' + this._hexToRgba(style.borderColor, 0.28) + ', 0 0 120px ' + this._hexToRgba(style.borderColor, 0.1) + ', inset 0 0 30px ' + this._hexToRgba(style.borderColor, 0.05),
      },
      iconBoxStyle: {
        width: style.iconBoxSize + 'px', height: style.iconBoxSize + 'px',
        border: '2px solid ' + style.iconBorderColor, borderRadius: '50%',
        background: this._hexToRgba(style.iconBg, style.iconBgOpacity),
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        fontSize: style.iconSize + 'px', animation: 'iconPop 1.6s ease-in-out infinite',
        boxShadow: '0 0 20px ' + this._hexToRgba(style.iconBorderColor, 0.25), overflow: 'hidden',
      },
      iconImgStyle: { width: style.iconSize + 'px', height: style.iconSize + 'px', objectFit: 'contain' },
      iconIsImage, iconIsText: !iconIsImage,
      iconSrc: iconIsImage ? iconVal : '',
      alertIcon: iconIsImage ? '' : iconVal,
      titleStyle: { fontFamily: "'Cinzel Decorative',serif", fontSize: style.titleSize + 'px', color: style.titleColor, letterSpacing: '0.2em', animation: 'goldShine 2s ease-in-out infinite' },
      mainStyle: { fontFamily: "'Cinzel Decorative',serif", fontSize: style.mainSize + 'px', color: style.mainColor, letterSpacing: '0.07em', textShadow: '0 0 20px ' + this._hexToRgba(style.mainColor, 0.4) },
      subStyle: { fontFamily: "'Noto Serif SC',serif", fontSize: style.subSize + 'px', color: this._hexToRgba(style.subColor, style.subOpacity), letterSpacing: '0.08em', maxWidth: '460px', lineHeight: '1.7' },
      alertTitle:  info.title,
      alertMain:   info.main,
      alertSub:    info.sub,
      hasSub:      !!(info.sub && info.sub.length > 0),
      showTest:    params.get('test') === '1',
      tFollow:  () => this._demo('follow'),
      tSub:     () => this._demo('sub'),
      tResub:   () => this._demo('resub'),
      tGift:    () => this._demo('subgift'),
      tBomb:    () => this._demo('subgiftbomb'),
      tBits:    () => this._demo('bits'),
      tRaid:    () => this._demo('raid'),
      tDon:     () => this._demo('donation'),
      tHype:    () => this._demo('hypetrainLevel'),
      tPoints:  () => this._demo('channelPoints'),
      tHost:    () => this._demo('host'),
      tCheer:   () => this._demo('cheer'),
    };
  }
}
<\/script>
</body>
</html>
`;
  }

  core.registerMode("alerts", {
    id: "alerts",
    label: "🔔 Alertes",
    tabs: [
      { id: "general", label: "⚙ Général" },
      { id: "types",   label: "🔔 Alertes" },
    ],
    defaultConfig: DEFAULT_ALERTS_CONFIG,
    extractConfig,
    renderTab,
    bindTab,
    buildExportHtml: buildAlertsHtml,
    stage: { mount, update, unmount },
  });
})();
