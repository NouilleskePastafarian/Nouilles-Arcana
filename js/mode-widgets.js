// ═══════════════════════════════════════════════════════════════════════
// Mode "Widgets" — édition visuelle de Barre Widgets.dc.html (dc-runtime).
// Deux onglets : "Widgets" (catalogue unique — créer/renommer/dupliquer/
// supprimer, configurer en profondeur chaque type) et "Barres" (4 sections
// Bas/Haut/Gauche/Droite — activer, dimensionner, choisir quels widgets du
// catalogue y apparaissent, style individuel qui surcharge le style
// Général). Aperçu live des barres ACTIVÉES uniquement (une iframe blob par
// barre active), pour refléter exactement ce qui est réellement visible
// dans OBS. Le pont Twitch (_connectStreamerBot) alimente automatiquement
// les widgets "compteur"/"subathon" en plus du flux streamData existant.
// ═══════════════════════════════════════════════════════════════════════
(function () {
  "use strict";
  const core = NK.core;
  const $ = core.$;
  const stageOuter = core.stageOuter;
  const stageInner = core.stageInner;
  const fxCanvas = core.fxCanvas;

  const ensureSupportJs = () => core.ensureSupportJs();

  const BAR_IDS = ["bottom", "top", "left", "right"];
  const BAR_LABELS = { bottom: "Bas", top: "Haut", left: "Gauche", right: "Droite" };

  const WIDGET_KINDS = [
    { value: "simple",   label: "Valeur simple" },
    { value: "progress", label: "Progression" },
    { value: "clock",    label: "Horloge (uptime)" },
    { value: "counter",  label: "Compteur manuel" },
    { value: "subathon", label: "Subathon" },
  ];
  const KNOWN_DATA_KEYS = ["viewerCount", "gameName", "streamTitle", "lastFollow", "lastSub", "lastDonation", "musicTitle"];

  function escapeAttr(v) { return String(v == null ? "" : v).replace(/"/g, "&quot;"); }
  function slugify(label, existingIds) {
    let base = String(label || "widget").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "widget";
    let id = base, n = 1;
    while (existingIds.has(id)) { id = base + "-" + (++n); }
    existingIds.add(id);
    return id;
  }

  // ═══════════════════════════════════════════════════════════════════════
  // DÉFAUTS PAR TYPE DE WIDGET
  // ═══════════════════════════════════════════════════════════════════════
  function defaultWidgetFor(kind, id) {
    const base = { id: id || null, kind, label: "Nouveau widget", width: null };
    if (kind === "simple")   return Object.assign(base, { dataKey: "viewerCount" });
    if (kind === "progress") return Object.assign(base, { currentKey: "followCurrent", targetKey: "followTarget" });
    if (kind === "clock")    return Object.assign(base, { showDays: true });
    if (kind === "counter")  return Object.assign(base, { valueType: "number", initialValue: 0, step: 1 });
    if (kind === "subathon") {
      return Object.assign(base, {
        startSec: 7200, showDays: true,
        timePerFollow: 30, timePerSub: 300, timePerResub: 300, timePerGiftSub: 300,
        timePerBits: 60, bitsUnit: 100, timePerDonation: 60, donationUnit: 5, timePerRaid: 60,
      });
    }
    return base;
  }

  function seedWidgets() {
    return [
      Object.assign(defaultWidgetFor("clock", "uptime"), { label: "UPTIME", width: 230 }),
      Object.assign(defaultWidgetFor("simple", "stream"), { label: "STREAM", dataKey: "streamTitle" }),
      Object.assign(defaultWidgetFor("simple", "jeu"), { label: "JEU", dataKey: "gameName" }),
      Object.assign(defaultWidgetFor("simple", "viewers"), { label: "VIEWERS", dataKey: "viewerCount", width: 160 }),
      Object.assign(defaultWidgetFor("simple", "dernier-follow"), { label: "DERNIER FOLLOW", dataKey: "lastFollow" }),
      Object.assign(defaultWidgetFor("simple", "dernier-sub"), { label: "DERNIER SUB", dataKey: "lastSub" }),
      Object.assign(defaultWidgetFor("simple", "dernier-don"), { label: "DERNIER DON", dataKey: "lastDonation" }),
      Object.assign(defaultWidgetFor("progress", "objectif-follows"), { label: "OBJECTIF FOLLOWS", currentKey: "followCurrent", targetKey: "followTarget", width: 250 }),
      Object.assign(defaultWidgetFor("counter", "morts"), { label: "MORTS", width: 150 }),
      Object.assign(defaultWidgetFor("simple", "musique"), { label: "MUSIQUE", dataKey: "musicTitle" }),
      Object.assign(defaultWidgetFor("progress", "objectif-subs"), { label: "OBJECTIF SUBS", currentKey: "subCurrent", targetKey: "subTarget", width: 250 }),
      Object.assign(defaultWidgetFor("counter", "essais-boss"), { label: "ESSAIS BOSS", width: 150 }),
      Object.assign(defaultWidgetFor("counter", "boss-actuel"), { label: "BOSS ACTUEL", valueType: "text", initialValue: "Malenia" }),
      Object.assign(defaultWidgetFor("subathon", "subathon"), { label: "TEMPS RESTANT" }),
    ];
  }

  function defaultBarStyle() {
    return {
      borderColor: '#c8920a', borderOpacity: 0.70, borderInnerOpacity: 0.22, borderWidth: '1.5px',
      barBg: '#060b16', barBgOpacity: 0.75, widgetBg: '#060b16', widgetBgOpacity: 0.94,
      labelColor: 'rgba(200,146,10,0.58)', labelSize: 10,
      valueColor: '#f0e0b0', valueSize: 18, valueFont: "'Cinzel Decorative', serif",
      progressFill: 'linear-gradient(90deg,#5a3200,#c8920a,#f0b030)',
      cornerSize: 13, padding: 5,
    };
  }
  function defaultBar(widgetIds, extra) {
    return Object.assign({ enabled: false, thickness: 70, length: 100, align: "center", widgetIds: widgetIds.slice(), style: null }, extra || {});
  }

  const DEFAULT_WIDGETS_CONFIG = () => ({
    barStyle: defaultBarStyle(),
    widgets: seedWidgets(),
    bars: {
      bottom: defaultBar(["viewers", "dernier-follow", "dernier-sub", "objectif-follows"], { enabled: true, thickness: 70 }),
      top:    defaultBar(["uptime", "stream", "viewers"], { thickness: 80 }),
      left:   defaultBar(["uptime", "jeu", "morts"], { thickness: 220 }),
      right:  defaultBar([]),
    },
    streamData: {
      streamTitle: 'Chill & Noodles', gameName: '…', viewerCount: '…',
      lastFollow: '–', lastSub: '–', lastDonation: 'NoodleMaster · 10€', musicTitle: 'Lo-fi Ramen Beats',
      followCurrent: 0, followTarget: 1500, subCurrent: 0, subTarget: 100,
    },
  });

  // ── Extraction / migration depuis un fichier existant ──────────────────
  function extractLiteralObject(text, varName) {
    const m = text.match(new RegExp(varName + "\\s*=\\s*\\{"));
    if (!m) return null;
    let i = m.index + m[0].length - 1;
    let depth = 0, end = -1;
    for (let j = i; j < text.length; j++) {
      if (text[j] === "{") depth++;
      else if (text[j] === "}") { depth--; if (depth === 0) { end = j; break; } }
    }
    if (end === -1) return null;
    const literal = text.slice(i, end + 1);
    try { return new Function("return (" + literal + ")")(); } catch (e) { return null; }
  }

  // Convertit l'ANCIEN modèle (chaque barre porte sa propre copie complète du
  // catalogue avec enabled:true/false) vers le NOUVEAU modèle (un catalogue
  // unique cfg.widgets, chaque barre référence juste les ids qu'elle utilise).
  // Les widgets "simple" pointant vers une donnée manuelle (deathCount,
  // tryCount, customValue) deviennent des "counter" pilotables en direct au
  // lieu d'une valeur figée dans le fichier — c'était un vrai manque (aucun
  // moyen de les faire évoluer pendant le live sans réouvrir l'éditeur).
  const MANUAL_KEYS_TO_COUNTER = { deathCount: true, tryCount: true, customValue: true };

  function migrateOldBars(oldBars, oldStreamData, oldTimerCfg) {
    const widgets = [];
    const idByLabel = new Map();
    const idsUsed = new Set();

    function ensureWidget(oldW) {
      const key = oldW.label || oldW.type;
      if (idByLabel.has(key)) return idByLabel.get(key);
      const id = slugify(oldW.label || oldW.type, idsUsed);
      let kind = oldW.type === "timer" ? "clock" : oldW.type === "progress" ? "progress" : "simple";
      if (kind === "simple" && MANUAL_KEYS_TO_COUNTER[oldW.valueKey]) kind = "counter";
      const w = Object.assign(defaultWidgetFor(kind, id), { label: oldW.label || id, width: oldW.width != null ? oldW.width : null });
      if (kind === "simple") w.dataKey = oldW.valueKey || "viewerCount";
      if (kind === "progress") { w.currentKey = oldW.currentKey || "followCurrent"; w.targetKey = oldW.targetKey || "followTarget"; }
      if (kind === "counter" && oldStreamData) {
        const raw = oldStreamData[oldW.valueKey];
        w.valueType = typeof raw === "number" ? "number" : "text";
        w.initialValue = raw != null ? raw : (w.valueType === "number" ? 0 : "");
      }
      widgets.push(w);
      idByLabel.set(key, id);
      return id;
    }

    // Enregistre TOUS les widgets rencontrés, même désactivés partout — sinon
    // un widget jamais activé (mais personnalisé) disparaîtrait silencieusement
    // du catalogue au lieu de rester disponible pour être activé plus tard.
    const bars = {};
    BAR_IDS.forEach((pos) => {
      const oldBar = oldBars && oldBars[pos];
      const list = (oldBar && oldBar.widgetList) || [];
      list.forEach(ensureWidget);
      const widgetIds = list.filter((w) => w.enabled).map((w) => idByLabel.get(w.label || w.type));
      bars[pos] = defaultBar(widgetIds, {
        enabled: widgetIds.length > 0,
        thickness: (oldBar && oldBar.height != null) ? oldBar.height : 70,
      });
    });

    // Widget dédié pour l'ancien réglage global timerCfg (mode uptime OU
    // subathon partagé par tous les widgets "timer") — s'il existe un widget
    // "clock" issu de la migration (label UPTIME typiquement) et que l'ancien
    // mode était "subathon", on le convertit en widget subathon à part entière
    // pour qu'il porte sa propre config riche (temps par follow/sub/etc.).
    if (oldTimerCfg && oldTimerCfg.mode === "subathon") {
      widgets.forEach((w) => {
        if (w.kind === "clock") {
          const sub = defaultWidgetFor("subathon", w.id);
          sub.label = w.label;
          sub.width = w.width;
          sub.startSec = oldTimerCfg.startSec != null ? oldTimerCfg.startSec : sub.startSec;
          sub.showDays = oldTimerCfg.showDays !== false;
          Object.assign(w, sub);
        }
      });
    } else if (oldTimerCfg && oldTimerCfg.showDays === false) {
      widgets.forEach((w) => { if (w.kind === "clock") w.showDays = false; });
    }

    // Si aucun widget "timer" n'existait dans l'ancien fichier mais qu'un
    // timerCfg était configuré, on l'ajoute quand même au catalogue (désactivé
    // partout) pour ne rien perdre silencieusement.
    if (oldTimerCfg && !widgets.some((w) => w.kind === "clock" || w.kind === "subathon")) {
      const id = slugify(oldTimerCfg.label || "uptime", idsUsed);
      const w = oldTimerCfg.mode === "subathon"
        ? Object.assign(defaultWidgetFor("subathon", id), { label: oldTimerCfg.label || "UPTIME", startSec: oldTimerCfg.startSec, showDays: oldTimerCfg.showDays !== false })
        : Object.assign(defaultWidgetFor("clock", id), { label: oldTimerCfg.label || "UPTIME", showDays: oldTimerCfg.showDays !== false });
      widgets.push(w);
    }

    return { widgets, bars };
  }

  function extractConfig(html) {
    const m = html.match(/<script id="nk-widgets-config" type="application\/json">([\s\S]*?)<\/script>/);
    if (m) {
      try {
        const parsed = JSON.parse(m[1]);
        const d = DEFAULT_WIDGETS_CONFIG();
        // Déjà au nouveau format (a un tableau "widgets" à plat) ?
        if (Array.isArray(parsed.widgets)) {
          const bars = {};
          BAR_IDS.forEach((pos) => {
            const pb = parsed.bars && parsed.bars[pos];
            bars[pos] = Object.assign(defaultBar([]), pb || {});
          });
          return {
            barStyle: Object.assign({}, d.barStyle, parsed.barStyle),
            widgets: parsed.widgets,
            bars,
            streamData: Object.assign({}, d.streamData, parsed.streamData),
          };
        }
        // Ancien format (bars[pos].widgetList complet + style + timerCfg).
        const migrated = migrateOldBars(parsed.bars, parsed.streamData, parsed.timerCfg);
        return {
          barStyle: Object.assign({}, d.barStyle, parsed.style),
          widgets: migrated.widgets,
          bars: migrated.bars,
          streamData: Object.assign({}, d.streamData, parsed.streamData),
        };
      } catch (e) { /* tombe sur le repli ci-dessous */ }
    }

    // Repli : fichier jamais migré du tout (très ancien littéral JS).
    if (!/style\s*=\s*\{/.test(html) || !/barConfigs\s*=\s*\{/.test(html)) return null;
    const d = DEFAULT_WIDGETS_CONFIG();
    const legacyStyle = extractLiteralObject(html, "style");
    const legacyBars = extractLiteralObject(html, "barConfigs");
    const legacyData = extractLiteralObject(html, "streamData");
    const legacyTimer = extractLiteralObject(html, "timerCfg");
    const migrated = migrateOldBars(legacyBars, legacyData, legacyTimer);
    return {
      barStyle: Object.assign({}, d.barStyle, legacyStyle),
      widgets: migrated.widgets,
      bars: migrated.bars,
      streamData: Object.assign({}, d.streamData, legacyData),
    };
  }

  // ═══════════════════════════════════════════════════════════════════════
  // CHAMPS DE STYLE DE BARRE — partagés entre le style Général (cfg.barStyle)
  // et l'override par barre (cfg.bars[pos].style), même principe que le
  // style d'alerte : une seule fonction de rendu réutilisée partout.
  // ═══════════════════════════════════════════════════════════════════════
  const BARSTYLE_COLOR_FIELDS = [
    { key: "borderColor", label: "Couleur de bordure" },
    { key: "barBg",       label: "Couleur fond de barre" },
    { key: "widgetBg",    label: "Couleur fond de widget" },
    { key: "valueColor",  label: "Couleur des valeurs" },
  ];
  const BARSTYLE_NUM_FIELDS = [
    { key: "borderOpacity",      label: "Opacité bordure",         min: 0, max: 1, step: 0.01 },
    { key: "borderInnerOpacity", label: "Opacité cadre intérieur", min: 0, max: 1, step: 0.01 },
    { key: "barBgOpacity",       label: "Opacité fond de barre",   min: 0, max: 1, step: 0.01 },
    { key: "widgetBgOpacity",    label: "Opacité fond de widget",  min: 0, max: 1, step: 0.01 },
    { key: "labelSize",          label: "Taille des labels (px)",  min: 6, max: 24, step: 1 },
    { key: "valueSize",          label: "Taille des valeurs (px)", min: 8, max: 40, step: 1 },
    { key: "cornerSize",         label: "Taille des coins (px)",   min: 0, max: 30, step: 1 },
    { key: "padding",            label: "Espacement (px)",         min: 0, max: 20, step: 1 },
  ];
  const ALL_BARSTYLE_NUM_FIELDS = BARSTYLE_NUM_FIELDS;

  function renderBarStyleFields(style, forId) {
    let html = "";
    BARSTYLE_COLOR_FIELDS.forEach((def) => {
      html += '<div class="field"><label>' + def.label + '</label><input type="color" data-barstylefor="' + forId + '" data-barstylecolor="' + def.key + '" value="' + style[def.key] + '"></div>';
    });
    BARSTYLE_NUM_FIELDS.forEach((def) => {
      html += core.field(def, style[def.key], "barstylenum-" + forId);
    });
    html += '<div class="field"><label>Couleur des labels (CSS)</label><input type="text" data-barstylefor="' + forId + '" data-barstyletext="labelColor" value="' + escapeAttr(style.labelColor) + '"></div>';
    html += '<div class="field"><label>Police des valeurs (CSS font-family)</label><input type="text" data-barstylefor="' + forId + '" data-barstyletext="valueFont" value="' + escapeAttr(style.valueFont) + '"></div>';
    html += '<div class="field"><label>Épaisseur de bordure (CSS, ex: 1.5px)</label><input type="text" data-barstylefor="' + forId + '" data-barstyletext="borderWidth" value="' + escapeAttr(style.borderWidth) + '"></div>';
    html += '<div class="field"><label>Dégradé de progression (CSS)</label><input type="text" data-barstylefor="' + forId + '" data-barstyletext="progressFill" value="' + escapeAttr(style.progressFill) + '"></div>';
    return html;
  }

  // ═══════════════════════════════════════════════════════════════════════
  // ONGLET "BARRES" — Général (style de base) + 4 sections par barre
  // ═══════════════════════════════════════════════════════════════════════
  let barSecOpen = { general: false, bottom: true, top: false, left: false, right: false };
  let barStyleOverrideOpen = { bottom: false, top: false, left: false, right: false };

  function renderBarSection(pos, cfg) {
    const bar = cfg.bars[pos];
    let html = '<details class="sec" data-barsec="' + pos + '"' + (barSecOpen[pos] ? " open" : "") + '><summary>' + BAR_LABELS[pos] + (bar.enabled ? " ✓" : "") + '</summary><div class="secBody">';
    html += core.toggleSwitch("barenable", pos, "Activer cette barre (visible dans l'aperçu et sur la scène)", bar.enabled);
    html += core.field({ key: "thickness", label: "Épaisseur (px)", min: 20, max: 300, step: 5 }, bar.thickness, "barnum-" + pos);
    html += core.field({ key: "length", label: "Longueur (%)", min: 10, max: 100, step: 1 }, bar.length, "barnum-" + pos);
    html += '<div class="field"><label>Alignement le long de la barre</label><select data-baralign="' + pos + '">'
      + ["start", "center", "end"].map((a) => '<option value="' + a + '"' + (bar.align === a ? " selected" : "") + '>' + (a === "start" ? "Début" : a === "end" ? "Fin" : "Centré") + "</option>").join("")
      + "</select></div>";

    // URL exacte à mettre dans la Browser Source OBS pour CETTE barre.
    const fileName = core.$("#currentFile").textContent || "Barre Widgets.html";
    html += '<div class="hint" style="font-family:monospace;background:rgba(200,146,10,0.07);padding:6px;border-radius:3px;word-break:break-all;">Source OBS : …/' + escapeAttr(fileName) + '?bar=' + pos + '</div>';

    // La liste reflète l'ORDRE RÉEL d'affichage (bar.widgetIds), pas l'ordre
    // du catalogue — c'est ce qui rend le réordonnancement visible dans le
    // panneau et pas seulement dans l'aperçu. Les widgets non utilisés par
    // cette barre sont listés après, grisés.
    const byId = {};
    cfg.widgets.forEach((w) => { byId[w.id] = w; });
    const activeList = bar.widgetIds.map((id) => byId[id]).filter(Boolean);
    const inactiveList = cfg.widgets.filter((w) => bar.widgetIds.indexOf(w.id) === -1);
    const orderHint = (pos === "left" || pos === "right") ? "l'ordre ci-dessous = de haut en bas" : "l'ordre ci-dessous = de gauche à droite";
    html += '<div class="hint">Widgets affichés dans cette barre (' + orderHint + ') — glissez ⠿ ou utilisez ▲▼ pour réordonner :</div>';
    html += '<div id="widgetPickList-' + pos + '">';
    activeList.forEach((w, order) => {
      const last = order === activeList.length - 1;
      html += '<div class="dnd-row" draggable="true" data-barwidget="' + pos + ':' + w.id + '" style="display:flex;align-items:center;gap:6px;padding:5px 4px;border-bottom:1px solid rgba(255,255,255,0.05);font-size:11px;cursor:grab;">'
        + '<span style="opacity:0.5;flex-shrink:0;">⠿</span>'
        + '<span style="opacity:0.45;flex-shrink:0;font-family:monospace;width:16px;text-align:right;">' + (order + 1) + '</span>'
        + core.toggleSwitch("barwidgetpick", pos + ":" + w.id, "", true)
        + '<span style="flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">' + escapeAttr(w.label || w.id) + " · " + w.kind + "</span>"
        + '<button class="chip" data-barmove="' + pos + ':' + w.id + ':up" title="Monter"' + (order === 0 ? ' disabled style="opacity:0.25;cursor:default;"' : "") + '>▲</button>'
        + '<button class="chip" data-barmove="' + pos + ':' + w.id + ':down" title="Descendre"' + (last ? ' disabled style="opacity:0.25;cursor:default;"' : "") + '>▼</button>'
        + "</div>";
    });
    inactiveList.forEach((w) => {
      html += '<div style="display:flex;align-items:center;gap:6px;padding:5px 4px;border-bottom:1px solid rgba(255,255,255,0.05);font-size:11px;opacity:0.55;">'
        + '<span style="width:12px;flex-shrink:0;"></span>'
        + '<span style="width:16px;flex-shrink:0;"></span>'
        + core.toggleSwitch("barwidgetpick", pos + ":" + w.id, "", false)
        + '<span style="flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">' + escapeAttr(w.label || w.id) + " · " + w.kind + "</span>"
        + "</div>";
    });
    html += "</div>";

    html += '<hr style="border:none;border-top:1px solid rgba(200,146,10,0.15);margin:12px 0;">';
    html += core.toggleSwitch("barstyleoverride", pos, "Style personnalisé pour cette barre", !!bar.style);
    if (bar.style) {
      html += '<div class="hint">Remplace le style Général ci-dessus pour cette barre uniquement.</div>';
      html += renderBarStyleFields(bar.style, pos);
    } else {
      html += '<div class="hint">Utilise le style Général.</div>';
    }
    html += "</div></details>";
    return html;
  }

  function renderBarsTab(cfg) {
    let html = "<h3>▭ BARRES</h3>";
    html += '<div class="hint">Une source OBS <b>par barre activée</b>, avec <code>?bar=bottom</code>, <code>?bar=top</code>, <code>?bar=left</code> ou <code>?bar=right</code> dans l\'URL (les alias français <code>?bar=bas/haut/gauche/droite</code> marchent aussi). L\'URL exacte est affichée dans chaque section ci-dessous. Sans paramètre, c\'est la barre du bas qui s\'affiche.</div>';
    html += '<details class="sec" data-barsec="general"' + (barSecOpen.general ? " open" : "") + '><summary>Style Général (base pour toutes les barres)</summary><div class="secBody">';
    html += renderBarStyleFields(cfg.barStyle, "general");
    html += "</div></details>";
    BAR_IDS.forEach((pos) => { html += renderBarSection(pos, cfg); });
    return html;
  }

  function bindBarsTab(cfg) {
    document.querySelectorAll("details.sec[data-barsec]").forEach((d) => {
      // update() en plus : l'aperçu surligne la barre dont la section est
      // ouverte, il doit donc suivre l'ouverture/fermeture des sections.
      d.ontoggle = () => { barSecOpen[d.dataset.barsec] = d.open; update(cfg); };
    });

    document.querySelectorAll("[data-barmove]").forEach((el) => {
      if (el.disabled) return;
      el.onclick = () => {
        const parts = el.dataset.barmove.split(":");
        const pos = parts[0], id = parts[1], dir = parts[2];
        const arr = cfg.bars[pos].widgetIds;
        const i = arr.indexOf(id);
        const j = dir === "up" ? i - 1 : i + 1;
        if (i === -1 || j < 0 || j >= arr.length) return;
        arr.splice(i, 1);
        arr.splice(j, 0, id);
        core.markDirty();
        core.renderPanel();
      };
    });

    document.querySelectorAll("[data-tkind='barenable']").forEach((el) => {
      el.onclick = () => {
        const pos = el.dataset.tkey;
        cfg.bars[pos].enabled = !cfg.bars[pos].enabled;
        core.markDirty();
        core.renderPanel();
      };
    });

    BAR_IDS.forEach((pos) => {
      document.querySelectorAll("[data-barnum-" + pos + "]").forEach((el) => {
        el.oninput = (e) => {
          const key = el.getAttribute("data-barnum-" + pos);
          const v = parseFloat(e.target.value);
          cfg.bars[pos][key] = v;
          if (el.previousElementSibling) {
            const lbl = key === "thickness" ? "Épaisseur (px)" : "Longueur (%)";
            el.previousElementSibling.textContent = lbl + " : " + v;
          }
          core.markDirty();
          update(cfg);
        };
      });
    });

    document.querySelectorAll("[data-baralign]").forEach((el) => {
      el.onchange = (e) => { cfg.bars[el.dataset.baralign].align = e.target.value; core.markDirty(); update(cfg); };
    });

    document.querySelectorAll("[data-tkind='barwidgetpick']").forEach((el) => {
      el.onclick = () => {
        const [pos, id] = el.dataset.tkey.split(":");
        const bar = cfg.bars[pos];
        const idx = bar.widgetIds.indexOf(id);
        if (idx === -1) bar.widgetIds.push(id);
        else bar.widgetIds.splice(idx, 1);
        core.markDirty();
        core.renderPanel();
      };
    });

    document.querySelectorAll("[data-tkind='barstyleoverride']").forEach((el) => {
      el.onclick = () => {
        const pos = el.dataset.tkey;
        cfg.bars[pos].style = cfg.bars[pos].style ? null : JSON.parse(JSON.stringify(cfg.barStyle));
        core.markDirty();
        core.renderPanel();
      };
    });

    // Champs de style (couleurs/texte/numériques), ciblés par data-barstylefor.
    function targetStyleFor(forId) { return forId === "general" ? cfg.barStyle : cfg.bars[forId].style; }
    document.querySelectorAll("[data-barstylecolor]").forEach((el) => {
      el.oninput = (e) => { const t = targetStyleFor(el.dataset.barstylefor); if (t) { t[el.dataset.barstylecolor] = e.target.value; core.markDirty(); update(cfg); } };
    });
    document.querySelectorAll("[data-barstyletext]").forEach((el) => {
      el.onchange = (e) => { const t = targetStyleFor(el.dataset.barstylefor); if (t) { t[el.dataset.barstyletext] = e.target.value; core.markDirty(); update(cfg); } };
    });
    BAR_IDS.concat(["general"]).forEach((forId) => {
      document.querySelectorAll("[data-barstylenum-" + forId + "]").forEach((el) => {
        el.oninput = (e) => {
          const t = targetStyleFor(forId);
          if (!t) return;
          const key = el.getAttribute("data-barstylenum-" + forId);
          const v = parseFloat(e.target.value);
          t[key] = v;
          const def = ALL_BARSTYLE_NUM_FIELDS.find((d) => d.key === key);
          if (def && el.previousElementSibling) el.previousElementSibling.textContent = def.label + " : " + v;
          core.markDirty();
          update(cfg);
        };
      });
    });

    // Glisser-déposer pour réordonner les widgets ACTIFS de chaque barre.
    BAR_IDS.forEach((pos) => {
      const list = $("#widgetPickList-" + pos);
      if (!list) return;
      let dragId = null;
      list.querySelectorAll(".dnd-row[draggable='true']").forEach((row) => {
        row.ondragstart = () => { dragId = row.dataset.barwidget.split(":")[1]; row.style.opacity = "0.4"; };
        row.ondragend = () => { row.style.opacity = "1"; };
        row.ondragover = (e) => { e.preventDefault(); };
        row.ondrop = (e) => {
          e.preventDefault();
          const targetId = row.dataset.barwidget.split(":")[1];
          if (dragId === null || dragId === targetId) return;
          const arr = cfg.bars[pos].widgetIds;
          const from = arr.indexOf(dragId), to = arr.indexOf(targetId);
          if (from === -1 || to === -1) return;
          arr.splice(from, 1);
          arr.splice(to, 0, dragId);
          core.markDirty();
          core.renderPanel();
        };
      });
    });
  }

  // ═══════════════════════════════════════════════════════════════════════
  // ONGLET "WIDGETS" — catalogue unique (ajout/renommage/duplication/
  // suppression) + éditeur profond par type + référence API.
  // ═══════════════════════════════════════════════════════════════════════
  let selectedWidgetId = null;

  function apiHintFor(w) {
    if (w.kind === "subathon") {
      return "window.nkWidgets.subathon('" + w.id + "').add(secondes) · .set(secondes) · .pause() · .resume() · .reset() · .isPaused()\n"
        + "Incrémenté automatiquement sur Follow/Sub/Resub/GiftSub/GiftBomb/Cheer/Raid (relais nk-relay). Les dons n'ont pas d'événement Twitch natif : appelez .add() manuellement (console OBS, StreamDeck, etc.) pour ceux-ci.";
    }
    if (w.kind === "counter") {
      return "window.nkWidgets.counter('" + w.id + "').increment(n) · .decrement(n) · .set(valeur) · .get()\n"
        + "Valeur persistée (survit aux rechargements OBS). Utilisez la console OBS (clic droit sur la source → Interact) ou une touche StreamDeck qui exécute du JS.";
    }
    if (w.kind === "clock") {
      return "window.nkWidgets.clock().reset()\n"
        + "Horloge d'uptime partagée : un seul départ pour tous les widgets horloge du fichier.";
    }
    return "Alimenté automatiquement par le relais (nk-relay) via streamData." + (w.kind === "progress" ? (w.currentKey + " / " + w.targetKey) : w.dataKey) + " — aucune action manuelle.";
  }

  function renderWidgetKindFields(w) {
    let html = "";
    if (w.kind === "simple") {
      html += '<div class="field"><label>Clé de donnée (streamData)</label><input type="text" id="wEditDataKey" list="wKnownKeys" value="' + escapeAttr(w.dataKey) + '"></div>';
      html += '<datalist id="wKnownKeys">' + KNOWN_DATA_KEYS.map((k) => '<option value="' + k + '">').join("") + "</datalist>";
    } else if (w.kind === "progress") {
      html += '<div class="field"><label>Clé valeur actuelle</label><input type="text" id="wEditCurrentKey" value="' + escapeAttr(w.currentKey) + '"></div>';
      html += '<div class="field"><label>Clé objectif</label><input type="text" id="wEditTargetKey" value="' + escapeAttr(w.targetKey) + '"></div>';
    } else if (w.kind === "clock") {
      html += core.toggleSwitch("wkindtoggle", "showDays", "Afficher jours/semaines si > 24h", w.showDays);
    } else if (w.kind === "counter") {
      html += '<div class="chiprow">';
      html += '<button class="chip' + (w.valueType === "number" ? " active" : "") + '" data-widget-valuetype="number">Nombre</button>';
      html += '<button class="chip' + (w.valueType === "text" ? " active" : "") + '" data-widget-valuetype="text">Texte</button>';
      html += "</div>";
      html += '<div class="field"><label>Valeur de départ</label><input type="text" id="wEditInitialValue" value="' + escapeAttr(w.initialValue) + '"></div>';
      if (w.valueType === "number") html += core.field({ key: "step", label: "Pas d'incrément/décrément", min: 1, max: 100, step: 1 }, w.step, "widgetkindnum");
    } else if (w.kind === "subathon") {
      html += core.field({ key: "startSec", label: "Durée initiale (s)", min: 0, max: 86400, step: 60 }, w.startSec, "widgetkindnum");
      html += core.toggleSwitch("wkindtoggle", "showDays", "Afficher jours/semaines si > 24h", w.showDays);
      html += '<hr style="border:none;border-top:1px solid rgba(200,146,10,0.15);margin:10px 0;">';
      html += '<div class="hint">Temps ajouté par événement (secondes) :</div>';
      html += core.field({ key: "timePerFollow", label: "Par follow (s)", min: 0, max: 3600, step: 5 }, w.timePerFollow, "widgetkindnum");
      html += core.field({ key: "timePerSub", label: "Par sub (s)", min: 0, max: 3600, step: 5 }, w.timePerSub, "widgetkindnum");
      html += core.field({ key: "timePerResub", label: "Par resub (s)", min: 0, max: 3600, step: 5 }, w.timePerResub, "widgetkindnum");
      html += core.field({ key: "timePerGiftSub", label: "Par sub offert (s)", min: 0, max: 3600, step: 5 }, w.timePerGiftSub, "widgetkindnum");
      html += core.field({ key: "timePerBits", label: "Par tranche de bits (s)", min: 0, max: 3600, step: 5 }, w.timePerBits, "widgetkindnum");
      html += core.field({ key: "bitsUnit", label: "Taille de la tranche de bits", min: 1, max: 10000, step: 10 }, w.bitsUnit, "widgetkindnum");
      html += core.field({ key: "timePerDonation", label: "Par tranche de don (s)", min: 0, max: 3600, step: 5 }, w.timePerDonation, "widgetkindnum");
      html += core.field({ key: "donationUnit", label: "Taille de la tranche de don (€)", min: 1, max: 1000, step: 1 }, w.donationUnit, "widgetkindnum");
      html += core.field({ key: "timePerRaid", label: "Par raid reçu (s)", min: 0, max: 3600, step: 5 }, w.timePerRaid, "widgetkindnum");
    }
    return html;
  }

  function renderWidgetEditor(w) {
    let html = '<div style="border:1px solid rgba(200,146,10,0.35);border-radius:4px;padding:10px;margin-top:10px;">';
    html += '<div class="field"><label>Nom</label><input type="text" id="wEditLabel" value="' + escapeAttr(w.label) + '"></div>';
    html += '<div class="hint">Type :</div><div class="chiprow">';
    WIDGET_KINDS.forEach((k) => { html += '<button class="chip' + (w.kind === k.value ? " active" : "") + '" data-widget-kind="' + k.value + '">' + k.label + "</button>"; });
    html += "</div>";
    html += renderWidgetKindFields(w);
    html += '<div class="field"><label>Largeur fixe en px (vide = espace flexible)</label><input type="number" id="wEditWidth" value="' + (w.width != null ? w.width : "") + '" placeholder="flex"></div>';
    html += '<hr style="border:none;border-top:1px solid rgba(200,146,10,0.15);margin:10px 0;">';
    html += '<div class="hint" style="font-family:monospace;white-space:pre-wrap;font-size:10px;">' + escapeAttr(apiHintFor(w)) + "</div>";
    html += '<div style="display:flex;gap:6px;margin-top:8px;">';
    html += '<button class="btn" id="btnDupWidget">📄 Dupliquer</button>';
    html += '<button class="btn btn-danger" id="btnDelWidget">🗑 Supprimer</button>';
    html += "</div></div>";
    return html;
  }

  function renderWidgetsTab(cfg) {
    let html = "<h3>◆ WIDGETS — " + cfg.widgets.length + "</h3>";
    html += '<div class="hint">Créez, renommez, dupliquez ou supprimez des widgets ici — activez-les ensuite dans l\'onglet Barres.</div>';
    html += '<div class="chiprow">';
    cfg.widgets.forEach((w) => { html += '<button class="chip' + (w.id === selectedWidgetId ? " active" : "") + '" data-select-widget="' + w.id + '">' + escapeAttr(w.label || w.id) + "</button>"; });
    html += "</div>";
    html += '<div class="chiprow" style="margin-top:6px;">';
    WIDGET_KINDS.forEach((k) => { html += '<button class="btn" data-add-widget="' + k.value + '">+ ' + k.label + "</button>"; });
    html += "</div>";

    const w = cfg.widgets.find((x) => x.id === selectedWidgetId);
    if (w) html += renderWidgetEditor(w);
    return html;
  }

  function bindWidgetsTab(cfg) {
    document.querySelectorAll("[data-select-widget]").forEach((el) => {
      el.onclick = () => { selectedWidgetId = el.dataset.selectWidget; core.renderPanel(); };
    });
    document.querySelectorAll("[data-add-widget]").forEach((el) => {
      el.onclick = () => {
        const kind = el.dataset.addWidget;
        const idsUsed = new Set(cfg.widgets.map((w) => w.id));
        const id = slugify("nouveau-" + kind, idsUsed);
        const w = defaultWidgetFor(kind, id);
        w.label = "Nouveau " + (WIDGET_KINDS.find((k) => k.value === kind) || {}).label;
        cfg.widgets.push(w);
        selectedWidgetId = id;
        core.markDirty();
        core.renderPanel();
      };
    });

    if (!selectedWidgetId) return;
    const w = cfg.widgets.find((x) => x.id === selectedWidgetId);
    if (!w) return;

    const labelInput = $("#wEditLabel");
    if (labelInput) labelInput.onchange = (e) => { w.label = e.target.value; core.markDirty(); update(cfg); };

    document.querySelectorAll("[data-widget-kind]").forEach((el) => {
      el.onclick = () => {
        const newKind = el.dataset.widgetKind;
        if (newKind === w.kind) return;
        const fresh = defaultWidgetFor(newKind, w.id);
        fresh.label = w.label; fresh.width = w.width;
        Object.keys(w).forEach((k) => delete w[k]);
        Object.assign(w, fresh);
        core.markDirty();
        core.renderPanel();
      };
    });

    const dataKeyInput = $("#wEditDataKey");
    if (dataKeyInput) dataKeyInput.onchange = (e) => { w.dataKey = e.target.value; core.markDirty(); update(cfg); };
    const curKeyInput = $("#wEditCurrentKey");
    if (curKeyInput) curKeyInput.onchange = (e) => { w.currentKey = e.target.value; core.markDirty(); update(cfg); };
    const tgtKeyInput = $("#wEditTargetKey");
    if (tgtKeyInput) tgtKeyInput.onchange = (e) => { w.targetKey = e.target.value; core.markDirty(); update(cfg); };
    const widthInput = $("#wEditWidth");
    if (widthInput) widthInput.onchange = (e) => { const v = e.target.value.trim(); w.width = v === "" ? null : parseInt(v, 10); core.markDirty(); update(cfg); };
    const initValInput = $("#wEditInitialValue");
    if (initValInput) initValInput.onchange = (e) => { w.initialValue = w.valueType === "number" ? (parseFloat(e.target.value) || 0) : e.target.value; core.markDirty(); update(cfg); };

    document.querySelectorAll("[data-widget-valuetype]").forEach((el) => {
      el.onclick = () => { w.valueType = el.dataset.widgetValuetype; core.markDirty(); core.renderPanel(); };
    });
    document.querySelectorAll("[data-tkind='wkindtoggle']").forEach((el) => {
      el.onclick = () => { w[el.dataset.tkey] = !w[el.dataset.tkey]; core.markDirty(); core.renderPanel(); };
    });
    document.querySelectorAll("[data-widgetkindnum]").forEach((el) => {
      el.oninput = (e) => {
        const key = el.dataset.widgetkindnum;
        const v = parseFloat(e.target.value);
        w[key] = v;
        if (el.previousElementSibling) {
          const label = el.previousElementSibling.textContent.replace(/:\s*[-\d.]+$/, ": " + v);
          el.previousElementSibling.textContent = label;
        }
        core.markDirty();
        update(cfg);
      };
    });

    const dupBtn = $("#btnDupWidget");
    if (dupBtn) dupBtn.onclick = () => {
      const idsUsed = new Set(cfg.widgets.map((x) => x.id));
      const clone = JSON.parse(JSON.stringify(w));
      clone.id = slugify(w.label + "-copie", idsUsed);
      clone.label = w.label + " (copie)";
      cfg.widgets.push(clone);
      selectedWidgetId = clone.id;
      core.markDirty();
      core.renderPanel();
    };
    const delBtn = $("#btnDelWidget");
    if (delBtn) delBtn.onclick = () => {
      if (!confirm('Supprimer définitivement le widget "' + (w.label || w.id) + '" ?\nIl sera aussi retiré de toutes les barres qui l\'utilisent. Cette action est irréversible (sauvegarde automatique).')) return;
      const idx = cfg.widgets.indexOf(w);
      cfg.widgets.splice(idx, 1);
      BAR_IDS.forEach((pos) => {
        const arr = cfg.bars[pos].widgetIds;
        const i = arr.indexOf(w.id);
        if (i !== -1) arr.splice(i, 1);
      });
      selectedWidgetId = null;
      core.markDirty();
      core.renderPanel();
    };
  }

  function renderTab(tabId, cfg) {
    return tabId === "widgets" ? renderWidgetsTab(cfg) : renderBarsTab(cfg);
  }
  function bindTab(tabId, cfg) {
    if (tabId === "widgets") bindWidgetsTab(cfg);
    else bindBarsTab(cfg);
  }

  // ═══════════════════════════════════════════════════════════════════════
  // APERÇU LIVE — une iframe blob par barre ACTIVÉE uniquement (reflète
  // exactement ce qui serait réellement visible dans OBS, plutôt que les 4
  // barres systématiquement comme avant — c'était la source de la confusion
  // "j'ai des widgets partout alors que je n'ai que la barre du bas active").
  // ═══════════════════════════════════════════════════════════════════════
  // <iframe> est un élément remplacé en CSS — pour un élément remplacé
  // positionné en absolute avec width/height:auto, left+right (ou top+bottom)
  // ne "remplissent" PAS l'espace comme pour un <div> ordinaire : ça ne
  // s'applique qu'aux éléments non remplacés. Sans largeur/hauteur EXPLICITE,
  // l'iframe retombe sur sa taille par défaut du navigateur (300×150px), ce
  // qui donnait une barre minuscule collée dans un coin au lieu de couvrir
  // toute la largeur/hauteur de la scène — confirmé en inspectant le DOM réel.
  const BAR_EDGE_STYLE = {
    bottom: (h) => "position:absolute;left:0;right:0;bottom:0;width:100%;height:" + h + "px;",
    top:    (h) => "position:absolute;left:0;right:0;top:0;width:100%;height:" + h + "px;",
    left:   (h) => "position:absolute;top:0;bottom:0;left:0;height:100%;width:" + h + "px;",
    right:  (h) => "position:absolute;top:0;bottom:0;right:0;height:100%;width:" + h + "px;",
  };
  let iframes = {};
  let blobUrls = [];
  let previewGen = 0;

  function revokeBlobUrls() {
    blobUrls.forEach((u) => URL.revokeObjectURL(u));
    blobUrls = [];
  }

  async function renderPreviewIframes(cfg) {
    const gen = ++previewGen;
    const jsContent = await ensureSupportJs();
    if (gen !== previewGen) return; // appel plus récent en vol, on abandonne

    Object.values(iframes).forEach((ifr) => ifr.remove());
    iframes = {};
    revokeBlobUrls();
    stageInner.querySelectorAll(".nk-widgets-empty-hint").forEach((el) => el.remove());

    BAR_IDS.filter((pos) => cfg.bars[pos].enabled).forEach((pos) => {
      const html = buildBarsHtml(cfg, true, jsContent, pos);
      const url = URL.createObjectURL(new Blob([html], { type: "text/html" }));
      blobUrls.push(url);
      const ifr = document.createElement("iframe");
      // Surligne la barre dont la section est ouverte dans l'onglet Barres —
      // l'ancienne comparaison (pos === onglet actif) ne matchait jamais car
      // les ids d'onglets sont "bars"/"widgets", pas des positions.
      const active = core.getActiveTab() === "bars" && !!barSecOpen[pos];
      ifr.style.cssText = BAR_EDGE_STYLE[pos](cfg.bars[pos].thickness) + "border:0;pointer-events:none;"
        + (active ? "outline:2px dashed #c8920a;outline-offset:-2px;" : "");
      ifr.src = url;
      stageInner.appendChild(ifr);
      iframes[pos] = ifr;
    });

    if (!BAR_IDS.some((pos) => cfg.bars[pos].enabled)) {
      const hint = document.createElement("div");
      hint.className = "nk-widgets-empty-hint";
      hint.style.cssText = "position:absolute;inset:0;display:flex;align-items:center;justify-content:center;color:rgba(240,224,176,0.4);font-size:13px;pointer-events:none;";
      hint.textContent = "Aucune barre activée — activez-en une dans l'onglet Barres.";
      stageInner.appendChild(hint);
    }
  }

  let updateDebounce = null;
  function scheduleUpdate(cfg) {
    clearTimeout(updateDebounce);
    updateDebounce = setTimeout(() => renderPreviewIframes(cfg), 120);
  }

  async function mount(cfg) {
    fxCanvas.style.display = "none";
    $("#bgPickerWrap").style.display = "none";
    await renderPreviewIframes(cfg);
  }

  function update(cfg) {
    scheduleUpdate(cfg);
  }

  function unmount() {
    previewGen++;
    clearTimeout(updateDebounce);
    Object.values(iframes).forEach((ifr) => ifr.remove());
    iframes = {};
    revokeBlobUrls();
    stageInner.querySelectorAll(".nk-widgets-empty-hint").forEach((el) => el.remove());
    fxCanvas.style.display = "";
  }

  // ═══════════════════════════════════════════════════════════════════════
  // GÉNÉRATION DU FICHIER DE SORTIE (dc-runtime, compatible Barre Widgets.dc.html)
  // ═══════════════════════════════════════════════════════════════════════
  function buildBarsHtml(cfg, previewMode, inlineSupportJs, forcedBarId) {
    const supportTag = (previewMode && inlineSupportJs)
      ? '<script>' + inlineSupportJs + '<\/script>'
      : '<script src="./Nouilles-Arcana/support.js"><\/script>';
    return `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
${supportTag}
<script id="nk-widgets-config" type="application/json">${JSON.stringify(cfg)}<\/script>
</head>
<body>
<x-dc>
<helmet>
  <link href="https://fonts.googleapis.com/css2?family=Cinzel+Decorative:wght@700&family=Noto+Serif+SC:wght@300;400;600&display=swap" rel="stylesheet">
  <style>
    * { margin:0; padding:0; box-sizing:border-box; }
    html, body { width:100%; height:100%; overflow:hidden; background:transparent; }
    @keyframes barShimmer { 0%{left:-80%;} 100%{left:180%;} }
    @keyframes progGlow   { 0%,100%{filter:brightness(1);} 50%{filter:brightness(1.45);} }
    @keyframes innerGlow  { 0%,100%{opacity:0.5;} 50%{opacity:1;} }
  </style>
</helmet>

<!-- ══════════════════════════════════════════════════════════════════════
     BARRE WIDGETS.DC.HTML — Overlay de barres de widgets pour OBS

     ▶ Une source OBS PAR BARRE ACTIVÉE, avec ?bar=bottom/top/left/right
       dans l'URL de la Browser Source (ex: ...Barre Widgets.dc.html?bar=top).
       Sans le paramètre, "bottom" est utilisé par défaut.

     API (console OBS → clic droit sur source → "Interact" → console) :
       window.nkWidgets.subathon('<id>').add(secondes) / .set() / .pause() / .resume() / .reset()
       window.nkWidgets.counter('<id>').increment(n) / .decrement(n) / .set(valeur) / .get()
       window.nkWidgets.clock().reset()
     (les <id> exacts sont visibles dans l'éditeur, onglet Widgets)
══════════════════════════════════════════════════════════════════════ -->

<div style="position:relative;width:100vw;height:100vh;background:transparent;pointer-events:none;">

  <div id="nk-bar" style="pointer-events:all;">
    <div id="nk-edge" style="position:absolute;left:0;right:0;top:0;height:1px;z-index:5;pointer-events:none;"></div>
    <div style="position:absolute;top:0;bottom:0;width:8%;background:linear-gradient(90deg,transparent,rgba(200,146,10,0.04),transparent);animation:barShimmer 14s ease-in-out infinite;pointer-events:none;z-index:5;"></div>
    <sc-for list="{{ widgets }}" as="w" hint-placeholder-count="6">
      <div style="{{ w.outerStyle }}">
        <div style="{{ w.innerBox }}">
          <div style="position:absolute;top:-5px;left:-5px;width:{{ cs }}px;height:{{ cs }}px;border-top:{{ bw }} solid {{ bc }};border-left:{{ bw }} solid {{ bc }};z-index:3;pointer-events:none;"></div>
          <div style="position:absolute;top:-5px;right:-5px;width:{{ cs }}px;height:{{ cs }}px;border-top:{{ bw }} solid {{ bc }};border-right:{{ bw }} solid {{ bc }};z-index:3;pointer-events:none;"></div>
          <div style="position:absolute;bottom:-5px;left:-5px;width:{{ cs }}px;height:{{ cs }}px;border-bottom:{{ bw }} solid {{ bc }};border-left:{{ bw }} solid {{ bc }};z-index:3;pointer-events:none;"></div>
          <div style="position:absolute;bottom:-5px;right:-5px;width:{{ cs }}px;height:{{ cs }}px;border-bottom:{{ bw }} solid {{ bc }};border-right:{{ bw }} solid {{ bc }};z-index:3;pointer-events:none;"></div>
          <div style="position:absolute;top:-5px;left:50%;margin-left:-4px;width:7px;height:7px;background:{{ barBg }};border:{{ bw }} solid {{ bc }};transform:rotate(45deg);z-index:4;pointer-events:none;"></div>
          <div style="position:absolute;bottom:-5px;left:50%;margin-left:-4px;width:7px;height:7px;background:{{ barBg }};border:{{ bw }} solid {{ bc }};transform:rotate(45deg);z-index:4;pointer-events:none;"></div>
          <div style="position:absolute;top:50%;margin-top:-3px;left:-3px;width:5px;height:6px;background:{{ barBg }};border-top:{{ bw }} solid {{ bc }};border-bottom:{{ bw }} solid {{ bc }};z-index:4;pointer-events:none;"></div>
          <div style="position:absolute;top:50%;margin-top:-3px;right:-3px;width:5px;height:6px;background:{{ barBg }};border-top:{{ bw }} solid {{ bc }};border-bottom:{{ bw }} solid {{ bc }};z-index:4;pointer-events:none;"></div>
          <div style="position:absolute;top:5px;right:5px;bottom:5px;left:5px;border:1px solid {{ bci }};border-radius:1px;z-index:0;pointer-events:none;animation:innerGlow 4s ease-in-out infinite;"></div>

          <div style="position:relative;z-index:1;width:100%;height:100%;display:flex;align-items:center;justify-content:center;padding:0 8px;overflow:hidden;">
            <sc-if value="{{ w.isSimple }}" hint-placeholder-val="{{ true }}">
              <div style="display:flex;flex-direction:column;align-items:center;justify-content:center;gap:2px;text-align:center;width:100%;overflow:hidden;">
                <span style="font-family:'Noto Serif SC',serif;font-size:{{ lblSz }};color:{{ lblC }};letter-spacing:0.14em;white-space:nowrap;text-transform:uppercase;display:block;">{{ w.label }}</span>
                <span style="font-family:{{ valF }};font-size:{{ valSz }};color:{{ valC }};white-space:nowrap;text-shadow:0 0 10px rgba(200,146,10,0.28);overflow:hidden;text-overflow:ellipsis;max-width:100%;display:block;">{{ w.value }}</span>
              </div>
            </sc-if>

            <sc-if value="{{ w.isProgress }}" hint-placeholder-val="{{ false }}">
              <div style="display:flex;flex-direction:column;align-items:center;justify-content:center;gap:3px;text-align:center;width:100%;overflow:hidden;">
                <span style="font-family:'Noto Serif SC',serif;font-size:{{ lblSz }};color:{{ lblC }};letter-spacing:0.14em;white-space:nowrap;text-transform:uppercase;">{{ w.label }}</span>
                <div style="width:90%;height:5px;background:rgba(200,146,10,0.12);border-radius:3px;overflow:hidden;animation:progGlow 3s ease-in-out infinite;">
                  <div style="{{ w.fill }}"></div>
                </div>
                <span style="font-family:'Noto Serif SC',serif;font-size:{{ lblSz }};color:{{ bc }};letter-spacing:0.1em;">{{ w.progress }}</span>
              </div>
            </sc-if>
          </div>
        </div>
      </div>
    </sc-for>
  </div>

</div>
</x-dc>
<script type="text/x-dc" data-dc-script data-props="{&quot;$preview&quot;:{&quot;width&quot;:1280,&quot;height&quot;:720}}">
class Component extends DCLogic {

  // ═══════════════════════════════════════════════════════════════════════
  // ⚙️ CONFIGURATION — générée par l'éditeur Nouilles-Arcana (mode Widgets).
  //    Modifiez-la depuis l'éditeur, pas ici directement.
  // ═══════════════════════════════════════════════════════════════════════
  widgetsConfig = ${JSON.stringify(cfg)};

  // ═══════════════════════════════════════════════════════════════════════
  // 🚫 NE PAS MODIFIER EN DESSOUS — utilisez l'éditeur visuel
  // ═══════════════════════════════════════════════════════════════════════
  state = { tick: 0 };
  _barId = 'bottom';
  _bar = null;
  _widgetsById = {};
  _uptimeBase = 0;
  _previewMode = ${previewMode ? 'true' : 'false'};

  componentDidMount() {
    const forcedBar = ${forcedBarId ? JSON.stringify(forcedBarId) : 'null'};
    const p = new URLSearchParams(window.location.search);
    // Accepte ?bar=… (anglais ou français) et aussi #… en secours — OBS
    // accepte les query strings, mais le hash est plus simple à taper à la
    // main sur un chemin file://.
    const ALIAS = { bas:'bottom', haut:'top', gauche:'left', droite:'right' };
    let rawBar = forcedBar || p.get('bar') || (window.location.hash || '').replace(/^#/, '') || 'bottom';
    rawBar = (ALIAS[rawBar] || rawBar).toLowerCase();
    this._barId = this.widgetsConfig.bars[rawBar] ? rawBar : 'bottom';
    this._bar = this.widgetsConfig.bars[this._barId];

    this.widgetsConfig.widgets.forEach((w) => { this._widgetsById[w.id] = w; });

    let upStart = this._sget('nk_uptime_start');
    if (!upStart) { upStart = String(Date.now()); this._sset('nk_uptime_start', upStart); }
    this._uptimeBase = parseInt(upStart, 10);

    this.widgetsConfig.widgets.forEach((w) => {
      if (w.kind === 'subathon' && !this._sget('nk_subathon_end_' + w.id)) {
        this._sset('nk_subathon_end_' + w.id, String(Date.now() + w.startSec * 1000));
      }
      if (w.kind === 'counter' && this._sget('nk_counter_' + w.id) === null) {
        this._sset('nk_counter_' + w.id, String(w.initialValue));
      }
    });

    this._setupApi();
    this._applyLayout();
    this.forceUpdate();
    this._connectStreamerBot();

    this._iv = setInterval(() => this.forceUpdate(), 1000);
  }

  componentWillUnmount() { clearInterval(this._iv); }

  // ═══════════════════════════════════════════════════════════════════════
  // 💾 STOCKAGE SÛR — dans l'aperçu éditeur, la page est chargée depuis un
  //    blob: (origine opaque) et le navigateur bloque tout accès à
  //    localStorage (SecurityError), ce qui plantait componentDidMount et
  //    laissait l'aperçu totalement vide. On retombe sur une mémoire en RAM
  //    dans ce cas précis ; dans le fichier réel exporté (chargé en file://
  //    ou http:// par OBS), localStorage fonctionne normalement et persiste
  //    vraiment entre les rechargements.
  // ═══════════════════════════════════════════════════════════════════════
  _sget(key) {
    try { return localStorage.getItem(key); } catch (e) { return (this._mem && key in this._mem) ? this._mem[key] : null; }
  }
  _sset(key, val) {
    try { localStorage.setItem(key, val); } catch (e) { this._mem = this._mem || {}; this._mem[key] = String(val); }
  }
  _sdel(key) {
    try { localStorage.removeItem(key); } catch (e) { if (this._mem) delete this._mem[key]; }
  }

  // ═══════════════════════════════════════════════════════════════════════
  // 🔧 API PUBLIQUE — window.nkWidgets.* (voir aussi l'onglet Widgets de
  //    l'éditeur pour la référence exacte par widget).
  // ═══════════════════════════════════════════════════════════════════════
  _setupApi() {
    const self = this;
    window.nkWidgets = {
      subathon: (id) => ({
        add: (s) => self._subathonAdd(id, s),
        set: (s) => { self._sset('nk_subathon_end_' + id, String(Date.now() + s * 1000)); self.forceUpdate(); },
        pause: () => {
          if (self._sget('nk_subathon_paused_' + id)) return;
          const end = parseInt(self._sget('nk_subathon_end_' + id) || '0', 10);
          self._sset('nk_subathon_remaining_' + id, String(Math.max(0, end - Date.now())));
          self._sset('nk_subathon_paused_' + id, '1');
          self.forceUpdate();
        },
        resume: () => {
          if (!self._sget('nk_subathon_paused_' + id)) return;
          const remaining = parseInt(self._sget('nk_subathon_remaining_' + id) || '0', 10);
          self._sset('nk_subathon_end_' + id, String(Date.now() + remaining));
          self._sdel('nk_subathon_paused_' + id);
          self._sdel('nk_subathon_remaining_' + id);
          self.forceUpdate();
        },
        reset: () => {
          const w = self._widgetsById[id];
          self._sdel('nk_subathon_paused_' + id);
          self._sdel('nk_subathon_remaining_' + id);
          self._sset('nk_subathon_end_' + id, String(Date.now() + (w ? w.startSec : 0) * 1000));
          self.forceUpdate();
        },
        isPaused: () => !!self._sget('nk_subathon_paused_' + id),
      }),
      counter: (id) => ({
        get: () => self._sget('nk_counter_' + id),
        set: (v) => { self._sset('nk_counter_' + id, String(v)); self.forceUpdate(); },
        increment: (n) => {
          const w = self._widgetsById[id];
          const cur = Number(self._sget('nk_counter_' + id)) || 0;
          self._sset('nk_counter_' + id, String(cur + (n != null ? n : (w ? w.step : 1))));
          self.forceUpdate();
        },
        decrement: (n) => {
          const w = self._widgetsById[id];
          const cur = Number(self._sget('nk_counter_' + id)) || 0;
          self._sset('nk_counter_' + id, String(cur - (n != null ? n : (w ? w.step : 1))));
          self.forceUpdate();
        },
      }),
      clock: () => ({
        reset: () => { const n = String(Date.now()); self._sset('nk_uptime_start', n); self._uptimeBase = Date.now(); self.forceUpdate(); },
      }),
    };
  }

  _subathonAdd(id, seconds) {
    if (this._sget('nk_subathon_paused_' + id)) {
      const cur = parseInt(this._sget('nk_subathon_remaining_' + id) || '0', 10);
      this._sset('nk_subathon_remaining_' + id, String(cur + seconds * 1000));
    } else {
      const key = 'nk_subathon_end_' + id;
      const base = parseInt(this._sget(key) || '0', 10) || Date.now();
      this._sset(key, String(base + seconds * 1000));
    }
    this.forceUpdate();
  }

  // ═══════════════════════════════════════════════════════════════════════
  // 🔌 PONT TWITCH via le relais (nk-relay) — met à jour lastFollow/lastSub,
  //    incrémente tous les widgets subathon selon leur config par événement,
  //    et applique les mises à jour périodiques (viewers/jeu/objectifs).
  // ═══════════════════════════════════════════════════════════════════════
  ACTION_NAME = 'Push Viewer Count';

  _connectStreamerBot() {
    const params = new URLSearchParams(window.location.search);
    const host = params.get('sbHost') || '127.0.0.1';
    const port = params.get('sbPort') || '8080';
    const url  = 'ws://' + host + ':' + port + '/';

    const open = () => {
      let ws;
      try { ws = new WebSocket(url); } catch (e) { setTimeout(open, 5000); return; }

      ws.onopen = () => {
        console.log('[nkWidgets] connecté au relais');
        ws.send(JSON.stringify({
          request: 'Subscribe',
          id: 'nk-widgets',
          events: {
            Twitch:  ['Follow', 'Sub', 'ReSub', 'GiftSub', 'GiftBomb', 'Cheer', 'Raid'],
            General: ['Custom'],
          }
        }));
        ws.send(JSON.stringify({
          request: 'DoAction',
          action: { name: this.ACTION_NAME },
          id: 'nk-init',
        }));
      };

      ws.onmessage = (ev) => {
        let msg;
        try { msg = JSON.parse(ev.data); } catch { return; }
        const type   = msg && msg.event && msg.event.type;
        const source = msg && msg.event && msg.event.source;
        const d = (msg && msg.data) || {};
        if (!type) return;

        if (type === 'NkReload') { if (!this._previewMode) window.location.reload(); return; }

        if (source === 'Twitch') {
          const u = d.user_name || d.username || d.displayName || '';
          if (type === 'Follow') this.widgetsConfig.streamData.lastFollow = u;
          if (type === 'Sub' || type === 'ReSub' || type === 'GiftSub') this.widgetsConfig.streamData.lastSub = u;

          this.widgetsConfig.widgets.filter((w) => w.kind === 'subathon').forEach((w) => {
            if (type === 'Follow')   this._subathonAdd(w.id, w.timePerFollow || 0);
            if (type === 'Sub')      this._subathonAdd(w.id, w.timePerSub || 0);
            if (type === 'ReSub')    this._subathonAdd(w.id, w.timePerResub || 0);
            if (type === 'GiftSub')  this._subathonAdd(w.id, w.timePerGiftSub || 0);
            if (type === 'GiftBomb') this._subathonAdd(w.id, (w.timePerGiftSub || 0) * (d.total || d.amount || 1));
            if (type === 'Cheer')    this._subathonAdd(w.id, Math.floor((d.bits || 0) / (w.bitsUnit || 100)) * (w.timePerBits || 0));
            if (type === 'Raid')     this._subathonAdd(w.id, w.timePerRaid || 0);
          });
          this.forceUpdate();
          return;
        }

        if (source === 'General' && type === 'Custom' && d.event === 'nkWidgetUpdate' && d.data) {
          Object.assign(this.widgetsConfig.streamData, d.data);
          this.forceUpdate();
        }
      };

      ws.onclose = () => setTimeout(open, 5000);
      ws.onerror = () => ws.close();
    };

    open();
  }

  _fmt(ts, showDays) {
    const wk = Math.floor(ts / 604800);
    const d  = Math.floor((ts % 604800) / 86400);
    const h  = Math.floor((ts % 86400)  / 3600);
    const m  = Math.floor((ts % 3600)   / 60);
    const s  = Math.floor(ts % 60);
    const pad = (n) => String(n).padStart(2, '0');
    let str = '';
    if (showDays) {
      if (wk > 0) str += wk + 'sem ';
      if (d  > 0) str += d  + 'j ';
    }
    return str + pad(h) + ':' + pad(m) + ':' + pad(s);
  }

  _hex2rgb(hex) {
    const n = parseInt(String(hex).replace('#',''), 16) || 0;
    return ((n>>16)&255) + ',' + ((n>>8)&255) + ',' + (n&255);
  }
  _rgba(hex, a) { return 'rgba(' + this._hex2rgb(hex) + ',' + a + ')'; }

  _applyLayout() {
    const bar  = document.getElementById('nk-bar');
    const edge = document.getElementById('nk-edge');
    if (!bar || !this._bar) return;
    const pos = this._barId;
    const S = this._bar.style || this.widgetsConfig.barStyle;

    if (!this._bar.enabled) { bar.style.display = 'none'; if (edge) edge.style.display = 'none'; return; }

    const t = this._bar.thickness;
    const len = this._bar.length != null ? this._bar.length : 100;
    const align = this._bar.align || 'center';
    const isH = pos === 'top' || pos === 'bottom';
    const bg  = this._rgba(S.barBg, S.barBgOpacity);
    const bdr = '1px solid ' + this._rgba(S.borderColor, S.borderOpacity);

    Object.assign(bar.style, {
      position: 'fixed', zIndex: '200', background: bg,
      display: 'flex', alignItems: 'stretch', overflow: 'visible',
      top: '', bottom: '', left: '', right: '', width: '', height: '', transform: '',
    });
    bar.style.borderTop    = pos === 'bottom' ? bdr : 'none';
    bar.style.borderBottom = pos === 'top'    ? bdr : 'none';
    bar.style.borderRight  = pos === 'left'   ? bdr : 'none';
    bar.style.borderLeft   = pos === 'right'  ? bdr : 'none';

    if (isH) {
      bar.style.flexDirection = 'row';
      bar.style.height = t + 'px';
      bar.style.width = len + '%';
      bar.style.top = pos === 'bottom' ? '' : '0';
      bar.style.bottom = pos === 'top' ? '' : '0';
      // "left:50% + translateX(-50%)" ne centre correctement qu'un élément
      // dont la largeur est intrinsèque — ici la largeur est déjà len% (pas
      // auto), donc cette combinaison décalait la barre hors écran (moitié
      // invisible) dès que len < 100. Centrage calculé directement en % :
      // pour len=100 -> left:0 (pas de décalage) ; pour len=50 -> left:25%.
      if (align === 'start') { bar.style.left = '0'; }
      else if (align === 'end') { bar.style.right = '0'; }
      else { bar.style.left = ((100 - len) / 2) + '%'; }
      if (edge) {
        Object.assign(edge.style, {
          display: 'block',
          top: pos === 'bottom' ? '0' : 'auto', bottom: pos === 'top' ? '0' : 'auto',
          left: '0', right: '0', height: '1px', width: 'auto',
          background: 'linear-gradient(90deg,transparent,' + this._rgba(S.borderColor, 0.75) + ' 20%,' + this._rgba(S.borderColor, 0.75) + ' 80%,transparent)',
        });
      }
    } else {
      bar.style.flexDirection = 'column';
      bar.style.width = t + 'px';
      bar.style.height = len + '%';
      bar.style.left = pos === 'right' ? '' : '0';
      bar.style.right = pos === 'left' ? '' : '0';
      if (align === 'start') { bar.style.top = '0'; }
      else if (align === 'end') { bar.style.bottom = '0'; }
      else { bar.style.top = ((100 - len) / 2) + '%'; }
      if (edge) edge.style.display = 'none';
    }
  }

  renderVals() {
    const bar = this._bar || this.widgetsConfig.bars.bottom;
    const S = bar.style || this.widgetsConfig.barStyle;
    const d = this.widgetsConfig.streamData;
    const P = S.padding;
    const bg = this._rgba(S.widgetBg, S.widgetBgOpacity);
    const bc = this._rgba(S.borderColor, S.borderOpacity);
    const bci = this._rgba(S.borderColor, S.borderInnerOpacity);
    const isH = this._barId === 'top' || this._barId === 'bottom';

    const widgets = (bar.widgetIds || []).map((id) => this._widgetsById[id]).filter(Boolean).map((w, i) => {
      const fixedDim = w.width != null ? (w.width + P * 2) : null;
      const outerStyle = Object.assign(
        { position: 'relative', flexShrink: 0, overflow: 'visible', padding: P + 'px' },
        { [isH ? 'height' : 'width']: '100%' },
        fixedDim != null ? { [isH ? 'width' : 'height']: fixedDim + 'px' } : { flex: '1', [isH ? 'minWidth' : 'minHeight']: '80px' }
      );
      const innerBox = {
        position: 'relative', width: '100%', height: '100%',
        border: S.borderWidth + ' solid ' + bc, background: bg, borderRadius: '2px',
        display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'visible',
      };

      let label = w.label || '', value = '–';
      if (w.kind === 'clock') {
        value = this._fmt(Math.floor((Date.now() - this._uptimeBase) / 1000), w.showDays);
      } else if (w.kind === 'subathon') {
        const paused = this._sget('nk_subathon_paused_' + w.id);
        const ms = paused
          ? parseInt(this._sget('nk_subathon_remaining_' + w.id) || '0', 10)
          : Math.max(0, parseInt(this._sget('nk_subathon_end_' + w.id) || '0', 10) - Date.now());
        value = this._fmt(Math.floor(ms / 1000), w.showDays) + (paused ? ' ⏸' : '');
      } else if (w.kind === 'counter') {
        const raw = this._sget('nk_counter_' + w.id);
        value = raw != null ? raw : String(w.initialValue);
      } else if (w.kind === 'simple') {
        value = String(d[w.dataKey] !== undefined ? d[w.dataKey] : '–');
      }

      const base = { id: 'w' + i, label, value, isSimple: w.kind !== 'progress', isProgress: w.kind === 'progress', outerStyle, innerBox };

      if (w.kind === 'progress') {
        const cur = Number(d[w.currentKey]) || 0;
        const tgt = Math.max(1, Number(d[w.targetKey]) || 1);
        const pct = Math.min(100, Math.round(cur / tgt * 100));
        return Object.assign({}, base, {
          progress: cur + ' / ' + tgt,
          fill: { width: pct + '%', height: '100%', background: S.progressFill, borderRadius: '3px', boxShadow: '0 0 6px rgba(200,146,10,0.4)', transition: 'width 0.7s ease' },
        });
      }
      return base;
    });

    return {
      widgets,
      cs: S.cornerSize, bw: S.borderWidth, bc, bci,
      barBg: this._rgba(S.barBg, S.barBgOpacity),
      lblSz: S.labelSize + 'px', lblC: S.labelColor,
      valSz: S.valueSize + 'px', valC: S.valueColor, valF: S.valueFont,
    };
  }
}
<\/script>
</body>
</html>
`;
  }

  core.registerMode("widgets", {
    id: "widgets",
    label: "📊 Widgets",
    tabs: [
      { id: "bars",    label: "▭ Barres" },
      { id: "widgets", label: "◆ Widgets" },
    ],
    defaultConfig: DEFAULT_WIDGETS_CONFIG,
    extractConfig,
    renderTab,
    bindTab,
    buildExportHtml: buildBarsHtml,
    stage: { mount, update, unmount },
  });
})();
