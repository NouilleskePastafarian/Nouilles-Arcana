// ═══════════════════════════════════════════════════════════════════════
// Mode "Fond animé" — fond (image/vidéo) + lueurs + particules + ambiance.
//
// • Lueurs      : halos lumineux DOM (pulsation, découpe rect/ellipse).
// • Particules  : sources ponctuelles (vapeur, étincelles, bulles,
//                 lucioles, poussière) — ex-onglet "Vapeur".
// • Ambiance    : couches plein-écran ou confinées (pétales, pluie, neige,
//                 feuilles, brouillard, étoiles) — ex-onglet "Pétales".
//                 Plusieurs couches cumulables (ex: pluie + brouillard).
//
// Le moteur de rendu canvas (NkFxEngine) est UNIQUE : l'éditeur l'utilise
// directement pour l'aperçu, et l'export embarque son code source
// (NkFxEngine.toString()) dans le fichier généré — aucune divergence
// possible entre ce qu'on voit dans l'éditeur et ce que rend OBS.
// ═══════════════════════════════════════════════════════════════════════
(function () {
  "use strict";
  const core = NK.core;
  const $ = core.$;
  const stageOuter = core.stageOuter;
  const stageInner = core.stageInner;
  const fxCanvas = core.fxCanvas;

  // ═══════════════════════════════════════════════════════════════════════
  // MOTEUR D'EFFETS PARTAGÉ — 100% autonome (aucune référence à l'éditeur),
  // car son code source est inliné tel quel dans les fichiers exportés.
  // getCfg() → config courante ou null (rien à dessiner) ;
  // getVis() → { steam:bool, petals:bool } (visibilité par famille d'effet).
  // ═══════════════════════════════════════════════════════════════════════
  function NkFxEngine(canvas, getCfg, getVis) {
    var ctx = canvas.getContext("2d");
    var parts = [];   // particules ponctuelles (une entrée par particule, .si = index source)
    var amb = [];     // particules d'ambiance (.li = index de couche)
    var R = Math.random;

    function hex2rgb(hex) {
      var n = parseInt(String(hex || "#ffffff").replace("#", ""), 16) || 0;
      return ((n >> 16) & 255) + "," + ((n >> 8) & 255) + "," + (n & 255);
    }
    function rgba(hex, a) { return "rgba(" + hex2rgb(hex) + "," + a + ")"; }
    function applyClip(clip, W, H) {
      if (!clip) return;
      ctx.beginPath();
      if (clip.shape === "ellipse") {
        ctx.ellipse((clip.left + clip.w / 2) * W, (clip.top + clip.h / 2) * H, clip.w / 2 * W, clip.h / 2 * H, 0, 0, Math.PI * 2);
      } else {
        ctx.rect(clip.left * W, clip.top * H, clip.w * W, clip.h * H);
      }
      ctx.clip();
    }
    function boxOf(clip, W, H) {
      var c = clip || { left: 0, top: 0, w: 1, h: 1 };
      return { left: c.left * W, top: c.top * H, w: c.w * W, h: c.h * H };
    }

    // ── Particules ponctuelles ──────────────────────────────────────────
    function mkParticle(src, si, W, H) {
      var t = src.type || "vapeur";
      var speed = src.speed != null ? src.speed : 1;
      var spread = src.spread != null ? src.spread : 0.04;
      var r = src.minR + R() * Math.max(0, src.maxR - src.minR);
      var p = {
        si: si, type: t,
        x: W * src.x + (R() - 0.5) * W * spread,
        y: H * src.y,
        r: r, life: R(), phase: R() * 6.283,
        ma: src.opacity * (0.5 + R()),
      };
      if (t === "vapeur") {
        p.vx = (R() - 0.5) * 0.3; p.vy = -(0.4 + R() * 0.9) * speed; p.lv = 0.003 + R() * 0.004;
      } else if (t === "etincelles") {
        p.r = Math.max(1, r * 0.35); p.vx = (R() - 0.5) * 1.4; p.vy = -(1.2 + R() * 1.8) * speed; p.lv = 0.006 + R() * 0.008;
      } else if (t === "bulles") {
        p.vx = 0; p.vy = -(0.3 + R() * 0.6) * speed; p.lv = 0.002 + R() * 0.003;
      } else if (t === "lucioles") {
        p.x = W * src.x + (R() - 0.5) * W * spread * 5;
        p.y = H * src.y + (R() - 0.5) * H * 0.12;
        p.vx = (R() - 0.5) * 0.4 * speed; p.vy = (R() - 0.5) * 0.4 * speed; p.lv = 0.001 + R() * 0.002;
        p.r = Math.max(1.5, r * 0.3);
      } else if (t === "poussiere") {
        p.x = W * src.x + (R() - 0.5) * W * spread * 5;
        p.y = H * src.y + (R() - 0.5) * H * 0.2;
        p.vx = (R() - 0.5) * 0.2; p.vy = (0.05 + R() * 0.25) * speed; p.lv = 0.0015 + R() * 0.002;
        p.r = Math.max(0.5, r * 0.15);
      }
      return p;
    }

    function drawParticle(p, src) {
      var col = src.color || "#fff8eb";
      var a;
      if (p.type === "vapeur") {
        a = (p.life < 0.35 ? p.life / 0.35 : (1 - p.life) / 0.65) * p.ma;
        var g = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, p.r);
        g.addColorStop(0, rgba(col, 0.95)); g.addColorStop(1, rgba(col, 0));
        ctx.globalAlpha = Math.max(0, a);
        ctx.fillStyle = g; ctx.beginPath(); ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2); ctx.fill();
      } else if (p.type === "etincelles") {
        a = Math.max(0, (1 - p.life)) * p.ma * (0.55 + 0.45 * R());
        ctx.globalAlpha = a;
        ctx.fillStyle = rgba(col, 1);
        ctx.beginPath(); ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2); ctx.fill();
        ctx.globalAlpha = a * 0.35;
        ctx.beginPath(); ctx.arc(p.x, p.y, p.r * 2.6, 0, Math.PI * 2); ctx.fill();
      } else if (p.type === "bulles") {
        a = p.life < 0.88 ? p.ma : p.ma * (1 - (p.life - 0.88) / 0.12);
        ctx.globalAlpha = Math.max(0, a);
        ctx.strokeStyle = rgba(col, 0.9); ctx.lineWidth = 1.4;
        ctx.beginPath(); ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2); ctx.stroke();
        ctx.beginPath(); ctx.arc(p.x - p.r * 0.35, p.y - p.r * 0.35, p.r * 0.22, 0, Math.PI * 2);
        ctx.fillStyle = rgba(col, 0.7); ctx.fill();
      } else if (p.type === "lucioles") {
        a = p.ma * (0.25 + 0.75 * Math.abs(Math.sin(p.life * 28 + p.phase)));
        var g2 = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, p.r * 3);
        g2.addColorStop(0, rgba(col, 0.95)); g2.addColorStop(1, rgba(col, 0));
        ctx.globalAlpha = Math.max(0, a);
        ctx.fillStyle = g2; ctx.beginPath(); ctx.arc(p.x, p.y, p.r * 3, 0, Math.PI * 2); ctx.fill();
      } else if (p.type === "poussiere") {
        a = (p.life < 0.25 ? p.life / 0.25 : (1 - p.life) / 0.75) * p.ma * 0.8;
        ctx.globalAlpha = Math.max(0, a);
        ctx.fillStyle = rgba(col, 1);
        ctx.beginPath(); ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2); ctx.fill();
      }
      ctx.globalAlpha = 1;
    }

    function stepParticle(p, src) {
      p.life += p.lv;
      if (p.type === "vapeur") { p.x += p.vx; p.y += p.vy; p.r += 0.12; }
      else if (p.type === "etincelles") { p.x += p.vx + Math.sin(p.life * 40 + p.phase) * 0.3; p.y += p.vy; }
      else if (p.type === "bulles") { p.x += Math.sin(p.life * 10 + p.phase) * 0.45; p.y += p.vy; }
      else if (p.type === "lucioles") {
        var sp = (src.speed != null ? src.speed : 1) * 0.5;
        p.vx = Math.max(-sp, Math.min(sp, p.vx + (R() - 0.5) * 0.05));
        p.vy = Math.max(-sp, Math.min(sp, p.vy + (R() - 0.5) * 0.05));
        p.x += p.vx; p.y += p.vy;
      }
      else if (p.type === "poussiere") { p.x += p.vx; p.y += p.vy; }
    }

    // ── Couches d'ambiance ──────────────────────────────────────────────
    function mkAmb(layer, li, W, H) {
      var b = boxOf(layer.clip, W, H);
      var speed = layer.speed != null ? layer.speed : 1;
      var wind = layer.wind != null ? layer.wind : 0;
      var sz = layer.minSize + R() * Math.max(0, layer.maxSize - layer.minSize);
      var a = layer.opacityMin + R() * Math.max(0, layer.opacityMax - layer.opacityMin);
      var p = { li: li, type: layer.type, x: b.left + R() * b.w, y: b.top + R() * b.h, sz: sz, a: a, phase: R() * 6.283 };
      if (layer.type === "petales" || layer.type === "feuilles") {
        p.vx = wind * 0.6 - 0.5 + R() * 1.1; p.vy = (0.4 + R() * 1.1) * speed;
        p.rot = R() * Math.PI * 2; p.rv = -0.04 + R() * 0.08;
        p.h = (layer.hueMin != null ? layer.hueMin : 0) + R() * Math.max(0, (layer.hueMax != null ? layer.hueMax : 360) - (layer.hueMin != null ? layer.hueMin : 0));
      } else if (layer.type === "pluie") {
        p.vx = wind * 2; p.vy = (9 + R() * 6) * speed;
      } else if (layer.type === "neige") {
        p.vx = wind * 0.5; p.vy = (0.3 + R() * 0.7) * speed; p.sway = 0.3 + R() * 0.7;
      } else if (layer.type === "brouillard") {
        p.vx = ((0.1 + R() * 0.25) * (wind >= 0 ? 1 : -1) + wind * 0.2) * speed;
      } else if (layer.type === "etoiles") {
        p.tw = 0.6 + R() * 2;
      }
      return p;
    }

    function stepAmb(p, layer, b) {
      var t = layer.type;
      if (t === "petales" || t === "feuilles") {
        p.x += p.vx + (t === "feuilles" ? Math.sin(p.phase + p.y * 0.01) * 0.5 : 0);
        p.y += p.vy; p.rot += p.rv;
        if (p.y > b.top + b.h + 20) { p.y = b.top - 20; p.x = b.left + R() * b.w; }
        if (p.x < b.left - 20) p.x = b.left + b.w + 20;
        if (p.x > b.left + b.w + 20) p.x = b.left - 20;
      } else if (t === "pluie") {
        p.x += p.vx; p.y += p.vy;
        if (p.y > b.top + b.h + 30) { p.y = b.top - 30; p.x = b.left + R() * b.w; }
        if (p.x < b.left - 30) p.x = b.left + b.w + 30;
        if (p.x > b.left + b.w + 30) p.x = b.left - 30;
      } else if (t === "neige") {
        p.y += p.vy; p.x += Math.sin(p.y * 0.01 + p.phase) * p.sway + p.vx;
        if (p.y > b.top + b.h + 10) { p.y = b.top - 10; p.x = b.left + R() * b.w; }
        if (p.x < b.left - 10) p.x = b.left + b.w + 10;
        if (p.x > b.left + b.w + 10) p.x = b.left - 10;
      } else if (t === "brouillard") {
        p.x += p.vx;
        if (p.vx >= 0 && p.x - p.sz > b.left + b.w) p.x = b.left - p.sz;
        if (p.vx < 0 && p.x + p.sz < b.left) p.x = b.left + b.w + p.sz;
      }
      // etoiles : immobile
    }

    function drawAmb(p, layer, now) {
      var t = layer.type;
      var col = layer.color || "#ffffff";
      if (t === "petales") {
        ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(p.rot); ctx.globalAlpha = p.a;
        ctx.fillStyle = "hsl(" + p.h + ",62%,82%)";
        var dxs = [-p.sz * 0.26, p.sz * 0.26];
        for (var i = 0; i < 2; i++) { ctx.beginPath(); ctx.ellipse(dxs[i], -p.sz * 0.52, p.sz * 0.28, p.sz * 0.58, 0, 0, Math.PI * 2); ctx.fill(); }
        ctx.restore();
      } else if (t === "feuilles") {
        ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(p.rot); ctx.globalAlpha = p.a;
        ctx.fillStyle = "hsl(" + p.h + ",58%,48%)";
        ctx.beginPath(); ctx.ellipse(0, 0, p.sz * 0.32, p.sz * 0.62, 0, 0, Math.PI * 2); ctx.fill();
        ctx.strokeStyle = "hsl(" + p.h + ",50%,32%)"; ctx.lineWidth = 0.8;
        ctx.beginPath(); ctx.moveTo(0, -p.sz * 0.62); ctx.lineTo(0, p.sz * 0.62); ctx.stroke();
        ctx.restore();
      } else if (t === "pluie") {
        ctx.globalAlpha = p.a;
        ctx.strokeStyle = rgba(col, 0.9); ctx.lineWidth = 1.2;
        ctx.beginPath(); ctx.moveTo(p.x, p.y); ctx.lineTo(p.x - p.vx * 0.8, p.y - p.sz); ctx.stroke();
        ctx.globalAlpha = 1;
      } else if (t === "neige") {
        ctx.globalAlpha = p.a;
        ctx.fillStyle = rgba(col, 1);
        ctx.beginPath(); ctx.arc(p.x, p.y, p.sz * 0.5, 0, Math.PI * 2); ctx.fill();
        ctx.globalAlpha = 1;
      } else if (t === "brouillard") {
        var g = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, p.sz);
        g.addColorStop(0, rgba(col, p.a)); g.addColorStop(1, rgba(col, 0));
        ctx.fillStyle = g;
        ctx.beginPath(); ctx.arc(p.x, p.y, p.sz, 0, Math.PI * 2); ctx.fill();
      } else if (t === "etoiles") {
        var a = layer.opacityMin + (layer.opacityMax - layer.opacityMin) * (0.5 + 0.5 * Math.sin(now * p.tw + p.phase));
        ctx.globalAlpha = Math.max(0, a);
        ctx.fillStyle = rgba(col, 1);
        ctx.beginPath(); ctx.arc(p.x, p.y, p.sz * 0.5, 0, Math.PI * 2); ctx.fill();
        ctx.globalAlpha = 1;
      }
    }

    function seed() {
      var cfg = getCfg();
      parts = []; amb = [];
      if (!cfg) return;
      (cfg.particles || []).forEach(function (src, si) {
        for (var i = 0; i < src.count; i++) parts.push(mkParticle(src, si, canvas.width, canvas.height));
      });
      (cfg.ambiances || []).forEach(function (layer, li) {
        if (layer.enabled === false) return;
        for (var i = 0; i < layer.count; i++) amb.push(mkAmb(layer, li, canvas.width, canvas.height));
      });
    }

    function tick() {
      requestAnimationFrame(tick);
      var cfg = getCfg();
      var W = canvas.width, H = canvas.height;
      ctx.clearRect(0, 0, W, H);
      if (!cfg) return;
      var vis = getVis();
      var now = (typeof performance !== "undefined" ? performance.now() : Date.now()) * 0.001;

      // Ambiances (une passe de clip par couche)
      (cfg.ambiances || []).forEach(function (layer, li) {
        if (layer.enabled === false) return;
        var b = boxOf(layer.clip, W, H);
        var mine = [];
        for (var i = 0; i < amb.length; i++) if (amb[i].li === li) mine.push(amb[i]);
        ctx.save();
        if (layer.clip) applyClip(layer.clip, W, H);
        for (var j = 0; j < mine.length; j++) {
          stepAmb(mine[j], layer, b);
          if (vis.petals) drawAmb(mine[j], layer, now);
        }
        ctx.restore();
      });

      // Particules ponctuelles
      for (var k = 0; k < parts.length; k++) {
        var p = parts[k];
        var src = (cfg.particles || [])[p.si];
        if (!src) continue;
        stepParticle(p, src);
        if (p.life >= 1) parts[k] = mkParticle(src, p.si, W, H);
      }
      if (vis.steam) {
        (cfg.particles || []).forEach(function (src, si) {
          ctx.save();
          if (src.clip) applyClip(src.clip, W, H);
          for (var i = 0; i < parts.length; i++) {
            if (parts[i].si !== si || parts[i].life >= 1) continue;
            drawParticle(parts[i], src);
          }
          ctx.restore();
        });
      }
    }
    tick();
    return { seed: seed };
  }

  // ═══════════════════════════════════════════════════════════════════════
  // TYPES & DÉFAUTS
  // ═══════════════════════════════════════════════════════════════════════
  const PARTICLE_TYPES = [
    { value: "vapeur",     label: "♨ Vapeur" },
    { value: "etincelles", label: "🔥 Étincelles" },
    { value: "bulles",     label: "🫧 Bulles" },
    { value: "lucioles",   label: "✨ Lucioles" },
    { value: "poussiere",  label: "🌫 Poussière" },
  ];
  const PARTICLE_TYPE_DEFAULTS = {
    vapeur:     { count: 18, minR: 9,  maxR: 14, opacity: 0.15, color: "#fff8eb", speed: 1, spread: 0.04 },
    etincelles: { count: 26, minR: 4,  maxR: 9,  opacity: 0.7,  color: "#ffb340", speed: 1, spread: 0.03 },
    bulles:     { count: 14, minR: 3,  maxR: 10, opacity: 0.5,  color: "#9fd8ff", speed: 1, spread: 0.05 },
    lucioles:   { count: 12, minR: 4,  maxR: 9,  opacity: 0.8,  color: "#ffe08a", speed: 1, spread: 0.08 },
    poussiere:  { count: 40, minR: 3,  maxR: 8,  opacity: 0.35, color: "#ffffff", speed: 1, spread: 0.12 },
  };

  const AMBIANCE_TYPES = [
    { value: "petales",    label: "🌸 Pétales" },
    { value: "pluie",      label: "🌧 Pluie" },
    { value: "neige",      label: "❄ Neige" },
    { value: "feuilles",   label: "🍂 Feuilles" },
    { value: "brouillard", label: "🌫 Brouillard" },
    { value: "etoiles",    label: "⭐ Étoiles" },
  ];
  const AMBIANCE_TYPE_DEFAULTS = {
    petales:    { count: 40,  minSize: 4,   maxSize: 10,  hueMin: 340, hueMax: 365, opacityMin: 0.15, opacityMax: 0.5,  speed: 1, wind: 0,   color: "#ffd7e6" },
    pluie:      { count: 120, minSize: 10,  maxSize: 22,  hueMin: 0,   hueMax: 360, opacityMin: 0.12, opacityMax: 0.35, speed: 1, wind: -1,  color: "#9fc4ff" },
    neige:      { count: 90,  minSize: 2,   maxSize: 6,   hueMin: 0,   hueMax: 360, opacityMin: 0.25, opacityMax: 0.8,  speed: 1, wind: 0,   color: "#ffffff" },
    feuilles:   { count: 25,  minSize: 8,   maxSize: 16,  hueMin: 15,  hueMax: 45,  opacityMin: 0.3,  opacityMax: 0.8,  speed: 1, wind: 0.5, color: "#d99a3d" },
    brouillard: { count: 8,   minSize: 140, maxSize: 280, hueMin: 0,   hueMax: 360, opacityMin: 0.04, opacityMax: 0.1,  speed: 1, wind: 0.3, color: "#cdd6e0" },
    etoiles:    { count: 60,  minSize: 1,   maxSize: 3,   hueMin: 0,   hueMax: 360, opacityMin: 0.05, opacityMax: 0.9,  speed: 1, wind: 0,   color: "#ffffff" },
  };
  function ambianceLabel(type) { const t = AMBIANCE_TYPES.find((x) => x.value === type); return t ? t.label : type; }
  function particleLabel(type) { const t = PARTICLE_TYPES.find((x) => x.value === type); return t ? t.label : type; }

  const DEFAULT_CONFIG = () => ({
    background: null,
    lights: [],
    particles: [],   // [{ id, type, x, y, count, minR, maxR, opacity, color, speed, spread, clip? }]
    ambiances: [],   // [{ id, type, enabled, count, minSize, maxSize, hueMin, hueMax, color, opacityMin, opacityMax, speed, wind, clip? }]
  });

  // vis.steam pilote les Particules, vis.petals l'Ambiance — les clés
  // historiques sont conservées pour ne pas casser l'état/les fichiers.
  let vis = { lights:true, steam:true, petals:true, markers:true };
  let secOpen = { vis:true, posApp:true, behavior:false, clip:false, partSettings:true, partClip:false, ambSettings:true, ambClip:false };
  let selectedLightIdx = -1;
  let selectedPartIdx = -1;
  let selectedAmbIdx = -1;
  let clipboard = null; // { type:'light'|'particle', data:{...} }
  let clipBoxHidden = false;
  let lastClipKey = "";
  let lastRenderedTab = null;
  let mounted = false;

  function escapeAttr(v) { return String(v == null ? "" : v).replace(/"/g, "&quot;").replace(/</g, "&lt;"); }

  function lightBehaviorCss(l) {
    if (l.pulse === false) return "opacity:" + l.opMax + ";";
    return "--op-min:" + l.opMin + ";--op-max:" + l.opMax + ";animation:glowPulse " + l.duration + "s ease-in-out infinite " + l.delay + "s;";
  }
  function defaultVisFor(tab) {
    if (tab === "tout")   return { lights:true,  steam:true,  petals:true,  markers:true };
    if (tab === "lights") return { lights:true,  steam:false, petals:false, markers:true };
    if (tab === "steam")  return { lights:false, steam:true,  petals:false, markers:true };
    return { lights:false, steam:false, petals:true, markers:false }; // ambiance
  }

  function normalizeClip(clip) {
    if (!clip) return clip;
    if (!clip.shape) clip.shape = "rect";
    return clip;
  }

  // ── Extraction / migration depuis un fichier existant ──────────────────
  function extractConfig(html) {
    const m = html.match(/<script id="nk-config" type="application\/json">([\s\S]*?)<\/script>/);
    if (!m) return null;
    try {
      const parsed = JSON.parse(m[1]);
      const d = DEFAULT_CONFIG();

      // Particules : nouveau format direct, sinon migration de "steam"
      // (tableau, ou très ancien objet unique).
      let particles = parsed.particles;
      if (!Array.isArray(particles)) {
        let steam = parsed.steam;
        if (steam && !Array.isArray(steam)) {
          steam = steam.enabled ? [{ id:"vapeur-1", x:steam.x, y:steam.y, count:steam.count, minR:steam.minR, maxR:steam.maxR, opacity:steam.opacity }] : [];
        }
        particles = (steam || []).map((s) => Object.assign({}, PARTICLE_TYPE_DEFAULTS.vapeur, s, { type: s.type || "vapeur" }));
      }
      particles.forEach((s) => {
        const td = PARTICLE_TYPE_DEFAULTS[s.type] || PARTICLE_TYPE_DEFAULTS.vapeur;
        if (s.color == null) s.color = td.color;
        if (s.speed == null) s.speed = td.speed;
        if (s.spread == null) s.spread = td.spread;
        normalizeClip(s.clip);
      });

      // Ambiances : nouveau format direct, sinon migration de "petals".
      let ambiances = parsed.ambiances;
      if (!Array.isArray(ambiances)) {
        ambiances = [];
        const p = parsed.petals;
        if (p && (p.enabled || p.count)) {
          ambiances.push(Object.assign({}, AMBIANCE_TYPE_DEFAULTS.petales, {
            id: "ambiance-1", type: "petales", enabled: !!p.enabled,
            count: p.count, minSize: p.minSize, maxSize: p.maxSize,
            hueMin: p.hueMin, hueMax: p.hueMax, opacityMin: p.opacityMin, opacityMax: p.opacityMax,
            clip: p.clip || undefined,
          }));
        }
      }
      ambiances.forEach((l) => {
        const td = AMBIANCE_TYPE_DEFAULTS[l.type] || AMBIANCE_TYPE_DEFAULTS.petales;
        if (l.enabled == null) l.enabled = true;
        ["count","minSize","maxSize","hueMin","hueMax","opacityMin","opacityMax","speed","wind","color"].forEach((k) => {
          if (l[k] == null) l[k] = td[k];
        });
        normalizeClip(l.clip);
      });

      (parsed.lights || []).forEach((l) => normalizeClip(l.clip));

      return {
        background: parsed.background || d.background,
        lights: parsed.lights || d.lights,
        particles,
        ambiances,
      };
    } catch (e) { return null; }
  }

  // ── Fond ──
  async function collectMedia() {
    return core.collectFiles(/\.(png|jpe?g|webp|gif|mp4|webm|mov)$/i);
  }

  function openBgPicker() {
    if (core.getModeId() !== "background") return;
    if (!core.getRootHandle()) { alert("Choisissez d'abord un dossier."); return; }
    const wrap = $("#bgPicker"), list = $("#bgPickerList");
    list.innerHTML = '<div style="padding:10px;font-size:11px;opacity:0.6;">Recherche en cours…</div>';
    wrap.style.display = "flex";
    collectMedia().then((matches) => {
      if (!matches.length) { list.innerHTML = '<div style="padding:10px;font-size:11px;">Aucune image/vidéo trouvée (jusqu\'à 3 niveaux de sous-dossiers).</div>'; return; }
      list.innerHTML = "";
      matches.forEach((rootRelPath) => {
        const row = document.createElement("div");
        row.className = "row";
        row.textContent = rootRelPath;
        row.onclick = async () => {
          const cfg = core.getConfig();
          const upDepth = core.depthFromRoot();
          const finalSrc = "../".repeat(upDepth) + rootRelPath;
          const type = /\.(mp4|webm|mov)$/i.test(rootRelPath) ? "video" : "image";
          cfg.background = { type, src: finalSrc };
          wrap.style.display = "none";
          core.markDirty();
          await loadBackground(cfg);
          core.renderPanel();
        };
        list.appendChild(row);
      });
    });
  }
  $("#btnClosePicker").onclick = () => { $("#bgPicker").style.display = "none"; };
  $("#bgPickerBtn").onclick = openBgPicker;

  // Résout un chemin de fond (relatif au fichier de scène) en blob URL
  // en naviguant depuis le rootHandle — contourne les problèmes de chemin
  // relatif quand l'éditeur n'est pas à la racine du projet.
  async function resolveBgBlob(src) {
    const rootHandle = core.getRootHandle();
    if (!rootHandle || !src) return null;
    const rootRelPath = src.replace(/^(\.\.\/)+/, "");
    const parts = rootRelPath.split("/").filter(Boolean);
    if (!parts.length) return null;
    let dir = rootHandle;
    try {
      for (let i = 0; i < parts.length - 1; i++) {
        dir = await dir.getDirectoryHandle(parts[i]);
      }
      const fileHandle = await dir.getFileHandle(parts[parts.length - 1]);
      const file = await fileHandle.getFile();
      return URL.createObjectURL(file);
    } catch (e) { return null; }
  }

  async function loadBackground(cfg) {
    stageInner.querySelectorAll(".bgEl").forEach((el) => el.remove());
    $("#stageEmpty").style.display = cfg.background ? "none" : "flex";
    if (!cfg.background) return;
    const el = document.createElement(cfg.background.type === "video" ? "video" : "img");
    el.className = "bgEl";
    if (cfg.background.type === "video") { el.autoplay = true; el.loop = true; el.muted = true; el.playsInline = true; }
    const blobSrc = await resolveBgBlob(cfg.background.src);
    el.src = blobSrc || cfg.background.src;
    stageInner.insertBefore(el, fxCanvas);
  }

  // ═══════════════════════════════════════════════════════════════════════
  // CADRE DE DÉCOUPE — réutilisé par lueurs, particules et ambiances.
  // ═══════════════════════════════════════════════════════════════════════
  function renderClipBox(key, clipObj, onMove, onResize) {
    if (key !== lastClipKey) { clipBoxHidden = false; lastClipKey = key; }
    if (clipBoxHidden) return;
    const box = document.createElement("div");
    box.className = "nk-clipbox";
    box.style.left = (clipObj.left * 100) + "%";
    box.style.top = (clipObj.top * 100) + "%";
    box.style.width = (clipObj.w * 100) + "%";
    box.style.height = (clipObj.h * 100) + "%";
    if (clipObj.shape === "ellipse") box.style.borderRadius = "50%";
    box.onmousedown = (e) => {
      if (e.target.classList.contains("handle") || e.target.classList.contains("clipClose") || e.button !== 0) return;
      const rect = stageInner.getBoundingClientRect();
      const offX = (e.clientX - rect.left) / rect.width - clipObj.left;
      const offY = (e.clientY - rect.top) / rect.height - clipObj.top;
      core.startDrag(e, (fx, fy) => onMove(fx - offX, fy - offY));
    };
    const handle = document.createElement("div");
    handle.className = "handle";
    handle.onmousedown = (e) => { e.stopPropagation(); core.startDrag(e, (fx, fy) => onResize(fx, fy)); };
    const close = document.createElement("div");
    close.className = "clipClose";
    close.textContent = "✕";
    close.title = "Masquer le cadre (la découpe reste active)";
    close.onclick = (e) => { e.stopPropagation(); clipBoxHidden = true; refreshOverlay(); };
    box.appendChild(handle);
    box.appendChild(close);
    stageInner.appendChild(box);
  }

  // ═══════════════════════════════════════════════════════════════════════
  // LUEURS
  // ═══════════════════════════════════════════════════════════════════════
  function renderLightOverlay() {
    const cfg = core.getConfig();
    if (!vis.lights) return;
    cfg.lights.forEach((l, i) => {
      const c = l.clip || { left:0, top:0, w:1, h:1 };
      const wrap = document.createElement("div");
      wrap.className = "nk-light-wrap";
      wrap.style.cssText = "position:absolute;left:" + (c.left*100) + "%;top:" + (c.top*100) + "%;width:" + (c.w*100) + "%;height:" + (c.h*100) + "%;overflow:hidden;pointer-events:none;z-index:11;"
        + (l.clip && l.clip.shape === "ellipse" ? "border-radius:50%;" : "");
      const relLeft = (l.left - c.left) / c.w * 100, relTop = (l.top - c.top) / c.h * 100;
      const relW = l.w / c.w * 100, relH = l.h / c.h * 100;
      const grad = "radial-gradient(ellipse, rgba(" + l.colorRgb + "," + l.peakAlpha + ") 0%, rgba(" + l.colorRgb + "," + l.midAlpha + ") 45%, transparent 70%)";
      const inner = document.createElement("div");
      inner.style.cssText = "position:absolute;left:" + relLeft + "%;top:" + relTop + "%;width:" + relW + "%;height:" + relH + "%;transform:translate(-50%,-50%);background:" + grad + ";" + lightBehaviorCss(l);
      wrap.appendChild(inner);
      stageInner.appendChild(wrap);

      if (!vis.markers) return;
      const marker = document.createElement("div");
      marker.className = "nk-marker";
      marker.style.left = (l.left * 100) + "%";
      marker.style.top = (l.top * 100) + "%";
      marker.style.background = i === selectedLightIdx ? "#fff" : "rgba(200,146,10,0.9)";
      marker.title = l.id;
      marker.onmousedown = (e) => { if (e.button === 0) core.startDrag(e, (fx, fy) => {
        cfg.lights[i].left = Math.round(fx * 1000) / 1000;
        cfg.lights[i].top = Math.round(fy * 1000) / 1000;
        core.markDirty(); refreshOverlay();
      }); };
      marker.onclick = () => {
        if (selectedLightIdx === i) clipBoxHidden = !clipBoxHidden;
        else { selectedLightIdx = i; clipBoxHidden = false; }
        if (core.getActiveTab() !== "lights") core.setActiveTab("lights");
        else core.renderPanel();
      };
      marker.oncontextmenu = (e) => {
        e.preventDefault(); e.stopPropagation();
        selectedLightIdx = i; refreshOverlay();
        core.showCtxMenu(e.clientX, e.clientY, [
          { label: "📄 Dupliquer", onClick: () => duplicateLight(i) },
          { label: "✂ Copier", onClick: () => { clipboard = { type:"light", data: JSON.parse(JSON.stringify(cfg.lights[i])) }; } },
          { label: "🗑 Supprimer", onClick: () => removeLight(i) },
        ]);
      };
      stageInner.appendChild(marker);
    });

    if (selectedLightIdx >= 0 && cfg.lights[selectedLightIdx] && cfg.lights[selectedLightIdx].clip) {
      const l = cfg.lights[selectedLightIdx];
      renderClipBox("light:" + selectedLightIdx, l.clip, (left, top) => {
        l.clip.left = Math.round(left * 1000) / 1000;
        l.clip.top = Math.round(top * 1000) / 1000;
        core.markDirty(); refreshOverlay(); core.renderPanel();
      }, (w, h) => {
        l.clip.w = Math.max(0.02, Math.round(w * 1000) / 1000);
        l.clip.h = Math.max(0.02, Math.round(h * 1000) / 1000);
        core.markDirty(); refreshOverlay(); core.renderPanel();
      });
    }
  }

  function newLightAt(fx, fy) {
    const cfg = core.getConfig();
    const l = { id:"nouvelle-lueur-" + (cfg.lights.length+1), left: Math.round(fx*1000)/1000, top: Math.round(fy*1000)/1000, w:0.15, h:0.15, colorRgb:"255,160,50", peakAlpha:0.3, midAlpha:0.08, opMin:0.5, opMax:1, duration:4, delay:0 };
    cfg.lights.push(l);
    selectedLightIdx = cfg.lights.length - 1;
    core.markDirty(); core.renderPanel();
  }
  function duplicateLight(i) {
    const cfg = core.getConfig();
    const clone = JSON.parse(JSON.stringify(cfg.lights[i]));
    clone.id = clone.id + "-copie";
    clone.left = Math.min(1, clone.left + 0.03);
    clone.top = Math.min(1, clone.top + 0.03);
    cfg.lights.splice(i + 1, 0, clone);
    selectedLightIdx = i + 1;
    core.markDirty(); core.renderPanel();
  }
  function removeLight(i) {
    const cfg = core.getConfig();
    cfg.lights.splice(i, 1);
    if (selectedLightIdx === i) selectedLightIdx = -1;
    else if (selectedLightIdx > i) selectedLightIdx--;
    core.markDirty(); core.renderPanel();
  }
  function pasteLightAt(fx, fy) {
    if (!clipboard || clipboard.type !== "light") return;
    const cfg = core.getConfig();
    const clone = JSON.parse(JSON.stringify(clipboard.data));
    clone.id = clone.id + "-collee";
    clone.left = Math.round(fx*1000)/1000;
    clone.top = Math.round(fy*1000)/1000;
    cfg.lights.push(clone);
    selectedLightIdx = cfg.lights.length - 1;
    core.markDirty(); core.renderPanel();
  }

  // ═══════════════════════════════════════════════════════════════════════
  // PARTICULES — sources ponctuelles, marqueurs de position
  // ═══════════════════════════════════════════════════════════════════════
  function renderParticlesOverlay() {
    const cfg = core.getConfig();
    if (!vis.steam || !vis.markers) return;
    cfg.particles.forEach((s, i) => {
      const marker = document.createElement("div");
      marker.className = "nk-marker";
      marker.style.left = (s.x * 100) + "%";
      marker.style.top = (s.y * 100) + "%";
      marker.style.background = i === selectedPartIdx ? "#fff" : "rgba(90,200,255,0.9)";
      marker.title = s.id;
      marker.onmousedown = (e) => { if (e.button === 0) core.startDrag(e, (fx, fy) => {
        cfg.particles[i].x = Math.round(fx * 1000) / 1000;
        cfg.particles[i].y = Math.round(fy * 1000) / 1000;
        core.markDirty(); refreshOverlay(); seedParticles();
      }); };
      marker.onclick = () => {
        if (selectedPartIdx === i) clipBoxHidden = !clipBoxHidden;
        else { selectedPartIdx = i; clipBoxHidden = false; }
        if (core.getActiveTab() !== "steam") core.setActiveTab("steam");
        else core.renderPanel();
      };
      marker.oncontextmenu = (e) => {
        e.preventDefault(); e.stopPropagation();
        selectedPartIdx = i; refreshOverlay();
        core.showCtxMenu(e.clientX, e.clientY, [
          { label: "📄 Dupliquer", onClick: () => duplicateParticleSrc(i) },
          { label: "✂ Copier", onClick: () => { clipboard = { type:"particle", data: JSON.parse(JSON.stringify(cfg.particles[i])) }; } },
          { label: "🗑 Supprimer", onClick: () => removeParticleSrc(i) },
        ]);
      };
      stageInner.appendChild(marker);
    });

    if (selectedPartIdx >= 0 && cfg.particles[selectedPartIdx] && cfg.particles[selectedPartIdx].clip) {
      const s = cfg.particles[selectedPartIdx];
      renderClipBox("particle:" + selectedPartIdx, s.clip, (left, top) => {
        s.clip.left = Math.round(left * 1000) / 1000;
        s.clip.top = Math.round(top * 1000) / 1000;
        core.markDirty(); refreshOverlay(); core.renderPanel();
      }, (w, h) => {
        s.clip.w = Math.max(0.02, Math.round(w * 1000) / 1000);
        s.clip.h = Math.max(0.02, Math.round(h * 1000) / 1000);
        core.markDirty(); refreshOverlay(); core.renderPanel();
      });
    }
  }

  function newParticleAt(fx, fy, type) {
    const cfg = core.getConfig();
    const t = type || "vapeur";
    const s = Object.assign({}, PARTICLE_TYPE_DEFAULTS[t], {
      id: t + "-" + (cfg.particles.length + 1), type: t,
      x: Math.round(fx*1000)/1000, y: Math.round(fy*1000)/1000,
    });
    cfg.particles.push(s);
    selectedPartIdx = cfg.particles.length - 1;
    core.markDirty(); core.renderPanel(); seedParticles();
  }
  function duplicateParticleSrc(i) {
    const cfg = core.getConfig();
    const clone = JSON.parse(JSON.stringify(cfg.particles[i]));
    clone.id = clone.id + "-copie";
    clone.x = Math.min(1, clone.x + 0.03);
    cfg.particles.splice(i + 1, 0, clone);
    selectedPartIdx = i + 1;
    core.markDirty(); core.renderPanel(); seedParticles();
  }
  function removeParticleSrc(i) {
    const cfg = core.getConfig();
    cfg.particles.splice(i, 1);
    if (selectedPartIdx === i) selectedPartIdx = -1;
    else if (selectedPartIdx > i) selectedPartIdx--;
    core.markDirty(); core.renderPanel(); seedParticles();
  }
  function pasteParticleAt(fx, fy) {
    if (!clipboard || clipboard.type !== "particle") return;
    const cfg = core.getConfig();
    const clone = JSON.parse(JSON.stringify(clipboard.data));
    clone.id = clone.id + "-collee";
    clone.x = Math.round(fx*1000)/1000;
    clone.y = Math.round(fy*1000)/1000;
    cfg.particles.push(clone);
    selectedPartIdx = cfg.particles.length - 1;
    core.markDirty(); core.renderPanel(); seedParticles();
  }

  // ═══════════════════════════════════════════════════════════════════════
  // AMBIANCE — couches sans position ponctuelle ; découpe par couche
  // ═══════════════════════════════════════════════════════════════════════
  function renderAmbianceOverlay() {
    const cfg = core.getConfig();
    if (core.getActiveTab() !== "petals") return;
    const l = selectedAmbIdx >= 0 ? cfg.ambiances[selectedAmbIdx] : null;
    if (!l || !l.clip) return;
    renderClipBox("ambiance:" + selectedAmbIdx, l.clip, (left, top) => {
      l.clip.left = Math.round(left * 1000) / 1000;
      l.clip.top = Math.round(top * 1000) / 1000;
      core.markDirty(); refreshOverlay(); seedParticles(); core.renderPanel();
    }, (w, h) => {
      l.clip.w = Math.max(0.02, Math.round(w * 1000) / 1000);
      l.clip.h = Math.max(0.02, Math.round(h * 1000) / 1000);
      core.markDirty(); refreshOverlay(); seedParticles(); core.renderPanel();
    });
  }

  function newAmbiance(type) {
    const cfg = core.getConfig();
    const t = type || "petales";
    const l = Object.assign({}, AMBIANCE_TYPE_DEFAULTS[t], {
      id: "ambiance-" + (cfg.ambiances.length + 1), type: t, enabled: true,
    });
    cfg.ambiances.push(l);
    selectedAmbIdx = cfg.ambiances.length - 1;
    core.markDirty(); core.renderPanel(); seedParticles();
  }
  function duplicateAmbiance(i) {
    const cfg = core.getConfig();
    const clone = JSON.parse(JSON.stringify(cfg.ambiances[i]));
    clone.id = clone.id + "-copie";
    cfg.ambiances.splice(i + 1, 0, clone);
    selectedAmbIdx = i + 1;
    core.markDirty(); core.renderPanel(); seedParticles();
  }
  function removeAmbiance(i) {
    const cfg = core.getConfig();
    cfg.ambiances.splice(i, 1);
    if (selectedAmbIdx === i) selectedAmbIdx = -1;
    else if (selectedAmbIdx > i) selectedAmbIdx--;
    core.markDirty(); core.renderPanel(); seedParticles();
  }

  function refreshOverlay() {
    stageInner.querySelectorAll(".nk-light-wrap, .nk-marker, .nk-clipbox").forEach((el) => el.remove());
    renderLightOverlay();
    renderParticlesOverlay();
    renderAmbianceOverlay();
  }

  stageOuter.addEventListener("contextmenu", (e) => {
    if (core.getModeId() !== "background") return;
    if (e.target.closest(".nk-marker")) return;
    e.preventDefault();
    const rect = stageInner.getBoundingClientRect();
    const fx = Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width));
    const fy = Math.min(1, Math.max(0, (e.clientY - rect.top) / rect.height));
    const activeTab = core.getActiveTab();
    if (activeTab === "lights") {
      core.showCtxMenu(e.clientX, e.clientY, [
        { label: "+ Ajouter une lueur ici", onClick: () => newLightAt(fx, fy) },
        { label: "📋 Coller ici", disabled: !(clipboard && clipboard.type === "light"), onClick: () => pasteLightAt(fx, fy) },
      ]);
    } else if (activeTab === "steam") {
      const items = PARTICLE_TYPES.map((t) => ({ label: "+ " + t.label + " ici", onClick: () => newParticleAt(fx, fy, t.value) }));
      items.push({ label: "📋 Coller ici", disabled: !(clipboard && clipboard.type === "particle"), onClick: () => pasteParticleAt(fx, fy) });
      core.showCtxMenu(e.clientX, e.clientY, items);
    } else if (activeTab === "tout") {
      core.showCtxMenu(e.clientX, e.clientY, [
        { label: "+ Ajouter une lueur ici", onClick: () => { newLightAt(fx, fy); core.setActiveTab("lights"); } },
        { label: "+ Ajouter des particules ici", onClick: () => { newParticleAt(fx, fy); core.setActiveTab("steam"); } },
      ]);
    }
    // Pas de menu sur l'onglet Ambiance : ces effets n'ont pas de position ponctuelle.
  });

  // ═══════════════════════════════════════════════════════════════════════
  // MOTEUR DANS L'ÉDITEUR — instance unique branchée sur le canvas de scène
  // ═══════════════════════════════════════════════════════════════════════
  const engine = NkFxEngine(
    fxCanvas,
    () => (core.getModeId() === "background" ? core.getConfig() : null),
    () => ({ steam: vis.steam, petals: vis.petals })
  );
  function seedParticles() { engine.seed(); }
  // Changement de résolution de la scène → re-semer dans le nouveau repère.
  document.addEventListener("nk-stage-resized", () => seedParticles());

  // ═══════════════════════════════════════════════════════════════════════
  // PANNEAU — onglets Tout / Lueurs / Particules / Ambiance
  // ═══════════════════════════════════════════════════════════════════════
  const FIELD_DEFS = [
    { key:"left", label:"Position gauche", min:0, max:1, step:0.005 },
    { key:"top", label:"Position haut", min:0, max:1, step:0.005 },
    { key:"w", label:"Largeur", min:0.01, max:1, step:0.005 },
    { key:"h", label:"Hauteur", min:0.01, max:1, step:0.005 },
    { key:"peakAlpha", label:"Intensité cœur", min:0, max:1, step:0.01 },
    { key:"midAlpha", label:"Intensité mi-distance", min:0, max:1, step:0.01 },
  ];
  const FIELD_DEFS_BEHAVIOR = [
    { key:"opMin", label:"Pulse — minimum", min:0, max:1, step:0.01 },
    { key:"opMax", label:"Pulse — maximum", min:0, max:1, step:0.01 },
    { key:"duration", label:"Durée du pulse (s)", min:0.5, max:15, step:0.1 },
    { key:"delay", label:"Délai avant pulse (s)", min:0, max:10, step:0.1 },
  ];
  const CLIP_FIELD_DEFS = [
    { key:"left", label:"Découpe — gauche", min:0, max:1, step:0.005 },
    { key:"top", label:"Découpe — haut", min:0, max:1, step:0.005 },
    { key:"w", label:"Découpe — largeur", min:0.02, max:1, step:0.005 },
    { key:"h", label:"Découpe — hauteur", min:0.02, max:1, step:0.005 },
  ];
  const PART_FIELD_DEFS = [
    { key:"x", label:"Position gauche (x)", min:0, max:1, step:0.005 },
    { key:"y", label:"Position haut (y)", min:0, max:1, step:0.005 },
    { key:"count", label:"Nombre de particules", min:1, max:120, step:1 },
    { key:"minR", label:"Taille minimum", min:1, max:40, step:1 },
    { key:"maxR", label:"Taille maximum", min:1, max:60, step:1 },
    { key:"opacity", label:"Opacité", min:0, max:1, step:0.01 },
    { key:"speed", label:"Vitesse", min:0.1, max:3, step:0.05 },
    { key:"spread", label:"Dispersion (largeur d'émission)", min:0, max:0.3, step:0.005 },
  ];
  const AMB_FIELD_DEFS = [
    { key:"count", label:"Densité (nombre)", min:0, max:300, step:1 },
    { key:"minSize", label:"Taille minimum", min:1, max:300, step:1 },
    { key:"maxSize", label:"Taille maximum", min:1, max:400, step:1 },
    { key:"speed", label:"Vitesse", min:0.1, max:3, step:0.05 },
    { key:"wind", label:"Vent (négatif = vers la gauche)", min:-4, max:4, step:0.1 },
    { key:"opacityMin", label:"Opacité — minimum", min:0, max:1, step:0.01 },
    { key:"opacityMax", label:"Opacité — maximum", min:0, max:1, step:0.01 },
  ];
  const AMB_HUE_DEFS = [
    { key:"hueMin", label:"Teinte — minimum (0-360)", min:0, max:360, step:1 },
    { key:"hueMax", label:"Teinte — maximum (0-360)", min:0, max:360, step:1 },
  ];

  function renderVisToggles(which) {
    const labels = { lights:"Lueurs", steam:"Particules", petals:"Ambiance", markers:"Points repères (édition)" };
    let html = '<details class="sec" data-sec="vis"' + (secOpen.vis ? " open" : "") + '><summary>👁 Affichage sur la scène</summary><div class="secBody">';
    which.forEach((k) => { html += core.toggleSwitch("vis", k, labels[k], vis[k]); });
    html += "</div></details>";
    return html;
  }

  // Chips Rectangle/Ellipse pour la forme d'une zone de découpe.
  function renderClipShapeChips(clip, attr) {
    if (!clip) return "";
    let html = '<div class="field"><label>Forme de la zone</label><div class="chiprow">';
    html += '<button class="chip' + (clip.shape !== "ellipse" ? " active" : "") + '" data-' + attr + '="rect">▭ Rectangle</button>';
    html += '<button class="chip' + (clip.shape === "ellipse" ? " active" : "") + '" data-' + attr + '="ellipse">◯ Ellipse</button>';
    html += "</div></div>";
    return html;
  }

  function renderToutTab(cfg) {
    let html = renderVisToggles(["lights", "steam", "petals", "markers"]);
    html += "<h3>🎬 COMPOSITION COMPLÈTE</h3>";
    html += '<div class="hint">Vue d\'ensemble du rendu final. Cliquez un point sur la scène pour l\'éditer — ça bascule automatiquement sur son onglet.</div>';
    if (cfg.background) {
      html += '<div class="bgName">' + cfg.background.type + " — " + cfg.background.src + "</div>";
      if (cfg.background.type === "image") {
        const existing = stageInner.querySelector(".bgEl");
        const thumb = existing ? existing.src : cfg.background.src;
        html += '<img class="bgThumb" src="' + thumb + '" alt="">';
      }
    } else {
      html += '<div class="hint">Aucun fond choisi — utilisez le bouton "🖼 Choisir le fond" en haut de la fenêtre.</div>';
    }
    html += '<div class="hint">' + cfg.lights.length + " lueur(s) · " + cfg.particles.length + " source(s) de particules · " + cfg.ambiances.length + " couche(s) d'ambiance.</div>";
    return html;
  }

  function renderLightsTab(cfg) {
    let html = renderVisToggles(["lights", "markers"]);
    html += "<h3>💡 LUEURS — " + cfg.lights.length + "</h3>";
    html += '<div class="hint">Clic droit sur un point ou sur la scène : dupliquer / copier / coller / ajouter.</div>';
    html += '<div class="chiprow">';
    cfg.lights.forEach((l, i) => { html += '<button class="chip' + (i === selectedLightIdx ? " active" : "") + '" data-select-light="' + i + '">' + l.id + "</button>"; });
    html += '</div><button class="btn btn-main" id="btnAddLight">+ Ajouter une lueur</button>';

    const l = selectedLightIdx >= 0 ? cfg.lights[selectedLightIdx] : null;
    if (l) {
      const pulseOn = l.pulse !== false;
      html += '<div class="hint" style="color:#c8920a;font-size:11px;">Édition : <b>' + l.id + "</b></div>";
      html += '<details class="sec" data-sec="posApp"' + (secOpen.posApp ? " open" : "") + '><summary>Position &amp; apparence</summary><div class="secBody">';
      html += '<div class="field"><label>Nom</label><input type="text" id="lightName" value="' + escapeAttr(l.id) + '"></div>';
      html += '<div class="field"><label>Couleur</label><input type="color" id="lightColor" value="' + core.rgbToHex(l.colorRgb) + '"></div>';
      FIELD_DEFS.forEach((def) => { html += core.field(def, l[def.key], "key"); });
      html += "</div></details>";
      html += '<details class="sec" data-sec="behavior"' + (secOpen.behavior ? " open" : "") + '><summary>Comportement</summary><div class="secBody">';
      html += core.toggleSwitch("pulse", "enable", "Pulsation (sinon intensité fixe)", pulseOn);
      if (pulseOn) {
        FIELD_DEFS_BEHAVIOR.forEach((def) => { html += core.field(def, l[def.key], "key"); });
      } else {
        html += '<div class="hint">Lueur fixe à l\'intensité "cœur" ci-dessus, sans animation.</div>';
      }
      html += "</div></details>";
      html += '<details class="sec" data-sec="clip"' + (secOpen.clip ? " open" : "") + '><summary>Zone de découpe (limiter le débordement)</summary><div class="secBody">';
      html += core.toggleSwitch("clip", "enable", "Activer la découpe", !!l.clip);
      if (l.clip) {
        html += renderClipShapeChips(l.clip, "lightclipshape");
        html += '<div class="hint">Glissez le cadre en pointillés dans la scène (✕ pour le masquer sans le désactiver), ou réglez ici :</div>';
        CLIP_FIELD_DEFS.forEach((def) => { html += core.field(def, l.clip[def.key], "clipkey"); });
      }
      html += "</div></details>";
      html += '<button class="btn btn-main" id="btnDupLight">📄 Dupliquer</button>';
      html += '<button class="btn btn-danger" id="btnRemoveLight">🗑 Supprimer cette lueur</button>';
    }
    return html;
  }

  function renderParticlesTab(cfg) {
    let html = renderVisToggles(["steam", "markers"]);
    html += "<h3>✨ PARTICULES — " + cfg.particles.length + "</h3>";
    html += '<div class="hint">Sources ponctuelles : vapeur, étincelles, bulles, lucioles, poussière. Clic droit sur la scène pour en ajouter une à un endroit précis.</div>';
    html += '<div class="chiprow">';
    cfg.particles.forEach((s, i) => { html += '<button class="chip' + (i === selectedPartIdx ? " active" : "") + '" data-select-part="' + i + '">' + s.id + "</button>"; });
    html += "</div>";
    html += '<div class="chiprow">';
    PARTICLE_TYPES.forEach((t) => { html += '<button class="btn" style="width:auto;padding:6px 10px;" data-add-part="' + t.value + '">+ ' + t.label + "</button>"; });
    html += "</div>";

    const s = selectedPartIdx >= 0 ? cfg.particles[selectedPartIdx] : null;
    if (s) {
      html += '<div class="hint" style="color:#c8920a;font-size:11px;">Édition : <b>' + s.id + "</b></div>";
      html += '<details class="sec" data-sec="partSettings"' + (secOpen.partSettings ? " open" : "") + '><summary>Réglages</summary><div class="secBody">';
      html += '<div class="field"><label>Nom</label><input type="text" id="partName" value="' + escapeAttr(s.id) + '"></div>';
      html += '<div class="hint">Type :</div><div class="chiprow">';
      PARTICLE_TYPES.forEach((t) => { html += '<button class="chip' + (s.type === t.value ? " active" : "") + '" data-part-type="' + t.value + '">' + t.label + "</button>"; });
      html += "</div>";
      html += '<div class="field"><label>Couleur</label><input type="color" id="partColor" value="' + (s.color || "#ffffff") + '"></div>';
      PART_FIELD_DEFS.forEach((def) => { html += core.field(def, s[def.key], "partkey"); });
      html += "</div></details>";
      html += '<details class="sec" data-sec="partClip"' + (secOpen.partClip ? " open" : "") + '><summary>Zone de découpe (limiter le débordement)</summary><div class="secBody">';
      html += core.toggleSwitch("partclip", "enable", "Activer la découpe", !!s.clip);
      if (s.clip) {
        html += renderClipShapeChips(s.clip, "partclipshape");
        html += '<div class="hint">Glissez le cadre en pointillés dans la scène (✕ pour le masquer sans le désactiver), ou réglez ici :</div>';
        CLIP_FIELD_DEFS.forEach((def) => { html += core.field(def, s.clip[def.key], "partclipkey"); });
      }
      html += "</div></details>";
      html += '<button class="btn btn-main" id="btnDupPart">📄 Dupliquer</button>';
      html += '<button class="btn btn-danger" id="btnRemovePart">🗑 Supprimer cette source</button>';
    }
    return html;
  }

  function renderAmbianceTab(cfg) {
    let html = renderVisToggles(["petals"]);
    html += "<h3>🌦 AMBIANCE — " + cfg.ambiances.length + " couche(s)</h3>";
    html += '<div class="hint">Effets d\'atmosphère plein écran (ou confinés par découpe). Cumulables : ex. pluie + brouillard + feuilles.</div>';
    html += '<div class="chiprow">';
    cfg.ambiances.forEach((l, i) => {
      html += '<button class="chip' + (i === selectedAmbIdx ? " active" : "") + '" data-select-amb="' + i + '">' + (l.enabled === false ? "⏸ " : "") + l.id + " · " + ambianceLabel(l.type).replace(/^\S+\s/, "") + "</button>";
    });
    html += "</div>";
    html += '<div class="chiprow">';
    AMBIANCE_TYPES.forEach((t) => { html += '<button class="btn" style="width:auto;padding:6px 10px;" data-add-amb="' + t.value + '">+ ' + t.label + "</button>"; });
    html += "</div>";

    const l = selectedAmbIdx >= 0 ? cfg.ambiances[selectedAmbIdx] : null;
    if (l) {
      html += '<div class="hint" style="color:#c8920a;font-size:11px;">Édition : <b>' + l.id + "</b></div>";
      html += core.toggleSwitch("ambenabled", "enable", "Couche activée", l.enabled !== false);
      html += '<details class="sec" data-sec="ambSettings"' + (secOpen.ambSettings ? " open" : "") + '><summary>Réglages</summary><div class="secBody">';
      html += '<div class="field"><label>Nom</label><input type="text" id="ambName" value="' + escapeAttr(l.id) + '"></div>';
      html += '<div class="hint">Type :</div><div class="chiprow">';
      AMBIANCE_TYPES.forEach((t) => { html += '<button class="chip' + (l.type === t.value ? " active" : "") + '" data-amb-type="' + t.value + '">' + t.label + "</button>"; });
      html += "</div>";
      if (l.type === "petales" || l.type === "feuilles") {
        AMB_HUE_DEFS.forEach((def) => { html += core.field(def, l[def.key], "ambkey"); });
      } else {
        html += '<div class="field"><label>Couleur</label><input type="color" id="ambColor" value="' + (l.color || "#ffffff") + '"></div>';
      }
      AMB_FIELD_DEFS.forEach((def) => { html += core.field(def, l[def.key], "ambkey"); });
      html += "</div></details>";
      html += '<details class="sec" data-sec="ambClip"' + (secOpen.ambClip ? " open" : "") + '><summary>Zone de découpe (limiter où ça tombe)</summary><div class="secBody">';
      html += core.toggleSwitch("ambclip", "enable", "Activer la découpe", !!l.clip);
      if (l.clip) {
        html += renderClipShapeChips(l.clip, "ambclipshape");
        html += '<div class="hint">Glissez le cadre en pointillés dans la scène (✕ pour le masquer sans le désactiver), ou réglez ici :</div>';
        CLIP_FIELD_DEFS.forEach((def) => { html += core.field(def, l.clip[def.key], "ambclipkey"); });
      }
      html += "</div></details>";
      html += '<button class="btn btn-main" id="btnDupAmb">📄 Dupliquer</button>';
      html += '<button class="btn btn-danger" id="btnRemoveAmb">🗑 Supprimer cette couche</button>';
    }
    return html;
  }

  function renderTab(tabId, cfg) {
    if (tabId !== lastRenderedTab) { vis = defaultVisFor(tabId); lastRenderedTab = tabId; }
    if (tabId === "tout") return renderToutTab(cfg);
    if (tabId === "lights") return renderLightsTab(cfg);
    if (tabId === "steam") return renderParticlesTab(cfg);
    return renderAmbianceTab(cfg);
  }

  function bindTab(tabId, cfg) {
    // Toggles "bouton glissant" génériques
    document.querySelectorAll("[data-tkind]").forEach((el) => {
      el.onclick = () => {
        const kind = el.dataset.tkind, key = el.dataset.tkey;
        if (kind === "vis") {
          vis[key] = !vis[key];
          el.classList.toggle("on", vis[key]);
          refreshOverlay();
        } else if (kind === "clip") {
          const l = cfg.lights[selectedLightIdx];
          if (l.clip) delete l.clip;
          else l.clip = { shape:"rect", left: Math.max(0, l.left - l.w/2), top: Math.max(0, l.top - l.h/2), w: l.w, h: l.h };
          secOpen.clip = !!l.clip;
          core.markDirty(); core.renderPanel();
        } else if (kind === "pulse") {
          const l = cfg.lights[selectedLightIdx];
          l.pulse = !(l.pulse !== false); // bascule, true par défaut si absent
          core.markDirty(); core.renderPanel(); refreshOverlay();
        } else if (kind === "partclip") {
          const s = cfg.particles[selectedPartIdx];
          if (s.clip) delete s.clip;
          else s.clip = { shape:"rect", left: Math.max(0, s.x - 0.1), top: Math.max(0, s.y - 0.3), w: 0.2, h: 0.4 };
          secOpen.partClip = !!s.clip;
          core.markDirty(); core.renderPanel();
        } else if (kind === "ambclip") {
          const l = cfg.ambiances[selectedAmbIdx];
          if (l.clip) delete l.clip;
          else l.clip = { shape:"rect", left:0, top:0, w:1, h:1 };
          secOpen.ambClip = !!l.clip;
          core.markDirty(); core.renderPanel(); seedParticles();
        } else if (kind === "ambenabled") {
          const l = cfg.ambiances[selectedAmbIdx];
          l.enabled = l.enabled === false;
          core.markDirty(); core.renderPanel(); seedParticles();
        }
      };
    });

    document.querySelectorAll("details.sec[data-sec]").forEach((d) => {
      d.ontoggle = () => { secOpen[d.dataset.sec] = d.open; };
    });

    document.querySelectorAll("[data-select-light]").forEach((el) => { el.onclick = () => { selectedLightIdx = parseInt(el.dataset.selectLight, 10); core.renderPanel(); }; });
    document.querySelectorAll("[data-select-part]").forEach((el) => { el.onclick = () => { selectedPartIdx = parseInt(el.dataset.selectPart, 10); core.renderPanel(); }; });
    document.querySelectorAll("[data-select-amb]").forEach((el) => { el.onclick = () => { selectedAmbIdx = parseInt(el.dataset.selectAmb, 10); core.renderPanel(); }; });

    const addBtn = $("#btnAddLight"); if (addBtn) addBtn.onclick = () => newLightAt(0.5, 0.5);
    const dupBtn = $("#btnDupLight"); if (dupBtn) dupBtn.onclick = () => duplicateLight(selectedLightIdx);
    const rmBtn = $("#btnRemoveLight"); if (rmBtn) rmBtn.onclick = () => removeLight(selectedLightIdx);

    document.querySelectorAll("[data-add-part]").forEach((el) => { el.onclick = () => newParticleAt(0.5, 0.5, el.dataset.addPart); });
    const dupPartBtn = $("#btnDupPart"); if (dupPartBtn) dupPartBtn.onclick = () => duplicateParticleSrc(selectedPartIdx);
    const rmPartBtn = $("#btnRemovePart"); if (rmPartBtn) rmPartBtn.onclick = () => removeParticleSrc(selectedPartIdx);

    document.querySelectorAll("[data-add-amb]").forEach((el) => { el.onclick = () => newAmbiance(el.dataset.addAmb); });
    const dupAmbBtn = $("#btnDupAmb"); if (dupAmbBtn) dupAmbBtn.onclick = () => duplicateAmbiance(selectedAmbIdx);
    const rmAmbBtn = $("#btnRemoveAmb"); if (rmAmbBtn) rmAmbBtn.onclick = () => removeAmbiance(selectedAmbIdx);

    // Changement de type — applique les défauts du nouveau type mais garde
    // identité, position et découpe (on ne perd pas son placement).
    document.querySelectorAll("[data-part-type]").forEach((el) => {
      el.onclick = () => {
        const s = cfg.particles[selectedPartIdx];
        if (!s || s.type === el.dataset.partType) return;
        const keep = { id: s.id, x: s.x, y: s.y, clip: s.clip };
        Object.assign(s, PARTICLE_TYPE_DEFAULTS[el.dataset.partType], keep, { type: el.dataset.partType });
        core.markDirty(); core.renderPanel(); seedParticles();
      };
    });
    document.querySelectorAll("[data-amb-type]").forEach((el) => {
      el.onclick = () => {
        const l = cfg.ambiances[selectedAmbIdx];
        if (!l || l.type === el.dataset.ambType) return;
        const keep = { id: l.id, enabled: l.enabled, clip: l.clip };
        Object.assign(l, AMBIANCE_TYPE_DEFAULTS[el.dataset.ambType], keep, { type: el.dataset.ambType });
        core.markDirty(); core.renderPanel(); seedParticles();
      };
    });

    // Forme des zones de découpe (rect/ellipse)
    function bindClipShape(attr, getClip, after) {
      document.querySelectorAll("[data-" + attr + "]").forEach((el) => {
        el.onclick = () => {
          const clip = getClip();
          if (!clip) return;
          clip.shape = el.getAttribute("data-" + attr);
          core.markDirty(); core.renderPanel();
          if (after) after();
        };
      });
    }
    bindClipShape("lightclipshape", () => (cfg.lights[selectedLightIdx] || {}).clip, refreshOverlay);
    bindClipShape("partclipshape", () => (cfg.particles[selectedPartIdx] || {}).clip, refreshOverlay);
    bindClipShape("ambclipshape", () => (cfg.ambiances[selectedAmbIdx] || {}).clip, () => { refreshOverlay(); seedParticles(); });

    const nameInput = $("#lightName");
    if (nameInput) nameInput.onchange = (e) => { cfg.lights[selectedLightIdx].id = e.target.value || cfg.lights[selectedLightIdx].id; core.markDirty(); core.renderPanel(); };
    const partNameInput = $("#partName");
    if (partNameInput) partNameInput.onchange = (e) => { cfg.particles[selectedPartIdx].id = e.target.value || cfg.particles[selectedPartIdx].id; core.markDirty(); core.renderPanel(); };
    const ambNameInput = $("#ambName");
    if (ambNameInput) ambNameInput.onchange = (e) => { cfg.ambiances[selectedAmbIdx].id = e.target.value || cfg.ambiances[selectedAmbIdx].id; core.markDirty(); core.renderPanel(); };
    const colorInput = $("#lightColor");
    if (colorInput) colorInput.oninput = (e) => { cfg.lights[selectedLightIdx].colorRgb = core.hexToRgb(e.target.value); core.markDirty(); refreshOverlay(); };
    const partColorInput = $("#partColor");
    if (partColorInput) partColorInput.oninput = (e) => { cfg.particles[selectedPartIdx].color = e.target.value; core.markDirty(); };
    const ambColorInput = $("#ambColor");
    if (ambColorInput) ambColorInput.oninput = (e) => { cfg.ambiances[selectedAmbIdx].color = e.target.value; core.markDirty(); };

    function bindSlider(attr, defs, apply) {
      document.querySelectorAll("[data-" + attr + "]").forEach((el) => {
        const key = el.getAttribute("data-" + attr);
        const def = defs.find((d) => d.key === key);
        el.oninput = (e) => {
          const v = parseFloat(e.target.value);
          apply(key, v);
          if (def && el.previousElementSibling) el.previousElementSibling.textContent = def.label + " : " + v;
          core.markDirty();
        };
      });
    }
    bindSlider("key", FIELD_DEFS.concat(FIELD_DEFS_BEHAVIOR), (k, v) => { cfg.lights[selectedLightIdx][k] = v; refreshOverlay(); });
    bindSlider("clipkey", CLIP_FIELD_DEFS, (k, v) => { cfg.lights[selectedLightIdx].clip[k] = v; refreshOverlay(); });
    bindSlider("partkey", PART_FIELD_DEFS, (k, v) => { cfg.particles[selectedPartIdx][k] = v; refreshOverlay(); seedParticles(); });
    bindSlider("partclipkey", CLIP_FIELD_DEFS, (k, v) => { cfg.particles[selectedPartIdx].clip[k] = v; refreshOverlay(); });
    bindSlider("ambkey", AMB_FIELD_DEFS.concat(AMB_HUE_DEFS), (k, v) => { cfg.ambiances[selectedAmbIdx][k] = v; seedParticles(); });
    bindSlider("ambclipkey", CLIP_FIELD_DEFS, (k, v) => { cfg.ambiances[selectedAmbIdx].clip[k] = v; refreshOverlay(); seedParticles(); });
  }

  function onDeleteKey(cfg) {
    const activeTab = core.getActiveTab();
    if (activeTab === "lights" && selectedLightIdx >= 0) { removeLight(selectedLightIdx); return true; }
    if (activeTab === "steam" && selectedPartIdx >= 0) { removeParticleSrc(selectedPartIdx); return true; }
    if (activeTab === "petals" && selectedAmbIdx >= 0) { removeAmbiance(selectedAmbIdx); return true; }
    return false;
  }

  // ═══════════════════════════════════════════════════════════════════════
  // GÉNÉRATION DU FICHIER DE SORTIE — embarque le MÊME moteur (NkFxEngine)
  // que l'aperçu, via son code source.
  // ═══════════════════════════════════════════════════════════════════════
  function buildSceneHtml(cfg) {
    const bgTag = !cfg.background ? "" :
      cfg.background.type === "video"
        ? '<video src="' + cfg.background.src + '" autoplay loop muted playsinline style="position:absolute;inset:0;width:100%;height:100%;object-fit:cover;z-index:1;"></video>'
        : '<img src="' + cfg.background.src + '" alt="" style="position:absolute;inset:0;width:100%;height:100%;object-fit:cover;z-index:1;">';

    const lightsHtml = cfg.lights.map((l) => {
      const c = l.clip || { left:0, top:0, w:1, h:1 };
      const relLeft = (l.left - c.left) / c.w * 100, relTop = (l.top - c.top) / c.h * 100;
      const relW = l.w / c.w * 100, relH = l.h / c.h * 100;
      const grad = "radial-gradient(ellipse, rgba(" + l.colorRgb + "," + l.peakAlpha + ") 0%, rgba(" + l.colorRgb + "," + l.midAlpha + ") 45%, transparent 70%)";
      const round = (l.clip && l.clip.shape === "ellipse") ? "border-radius:50%;" : "";
      return '<div style="position:absolute;left:' + (c.left*100) + "%;top:" + (c.top*100) + "%;width:" + (c.w*100) + "%;height:" + (c.h*100) + '%;overflow:hidden;pointer-events:none;z-index:11;' + round + '">'
        + '<div style="position:absolute;left:' + relLeft + "%;top:" + relTop + "%;width:" + relW + "%;height:" + relH + "%;transform:translate(-50%,-50%);background:" + grad + ";" + lightBehaviorCss(l) + '"></div></div>';
    }).join("\n  ");

    const bootJs = [
      NkFxEngine.toString(),
      "(function(){",
      "var cfg = JSON.parse(document.getElementById('nk-config').textContent);",
      "var canvas = document.getElementById('nk-fx');",
      "function resize(){ canvas.width = window.innerWidth; canvas.height = window.innerHeight; }",
      "resize();",
      "var engine = NkFxEngine(canvas, function(){ return cfg; }, function(){ return { steam:true, petals:true }; });",
      "engine.seed();",
      "window.addEventListener('resize', function(){ resize(); engine.seed(); });",
      "})();",
    ].join("\n");

    return "<!DOCTYPE html>\n<html>\n<head>\n<meta charset=\"utf-8\">\n<style>\n"
      + "*{margin:0;padding:0;box-sizing:border-box;}\nhtml,body{width:100%;height:100%;overflow:hidden;background:#050c18;}\n"
      + "@keyframes glowPulse{0%,100%{opacity:var(--op-min,0.5);}50%{opacity:var(--op-max,1);}}\n"
      + "</style>\n</head>\n<body>\n"
      + '<script id="nk-config" type="application/json">' + JSON.stringify(cfg) + "<" + "/script>\n"
      + '<div style="position:relative;width:100vw;height:100vh;overflow:hidden;background:#050c18;">\n'
      + "  " + bgTag + "\n"
      + '  <div style="position:absolute;inset:0;background:radial-gradient(ellipse 78% 68% at 50% 42%, transparent 36%, rgba(4,8,16,0.38) 100%); pointer-events:none; z-index:8;"></div>\n'
      + '  <canvas id="nk-fx" style="position:absolute;inset:0;width:100%;height:100%;pointer-events:none;z-index:10;"></canvas>\n'
      + "  " + lightsHtml + "\n"
      + "</div>\n"
      + "<script>\n" + bootJs + "\n<" + "/script>\n"
      + "</body>\n</html>\n";
  }

  // ═══════════════════════════════════════════════════════════════════════
  // CYCLE DE VIE (montage/démontage de la scène pour ce mode)
  // ═══════════════════════════════════════════════════════════════════════
  function mount(cfg) {
    mounted = true;
    lastRenderedTab = null;
    selectedLightIdx = -1;
    selectedPartIdx = -1;
    selectedAmbIdx = -1;
    fxCanvas.style.display = "";
    $("#bgPickerWrap").style.display = "flex";
    loadBackground(cfg); // async fire-and-forget — l'image/vidéo se charge indépendamment
    seedParticles();
  }
  function update(cfg) {
    if (!mounted) return;
    refreshOverlay();
  }
  function unmount() {
    mounted = false;
    stageInner.querySelectorAll(".bgEl, .nk-light-wrap, .nk-marker, .nk-clipbox").forEach((el) => el.remove());
    fxCanvas.style.display = "none";
    $("#bgPickerWrap").style.display = "none";
  }

  core.registerMode("background", {
    id: "background",
    label: "🖼 Fond animé",
    tabs: [
      { id: "tout", label: "🎬 Tout" },
      { id: "lights", label: "💡 Lueurs" },
      { id: "steam", label: "✨ Particules" },
      { id: "petals", label: "🌦 Ambiance" },
    ],
    defaultConfig: DEFAULT_CONFIG,
    extractConfig,
    renderTab,
    bindTab,
    buildExportHtml: buildSceneHtml,
    stage: { mount, update, unmount },
    onDeleteKey,
  });
})();
