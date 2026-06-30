// ═══════════════════════════════════════════════════════════════════════
// Mode "Fond animé" — fond (image/vidéo) + lueurs + vapeur + pétales.
// Logique déplacée telle quelle depuis l'ancien Editeur.html monolithique,
// simplement reliée au registre de modes de NK.core.
// ═══════════════════════════════════════════════════════════════════════
(function () {
  "use strict";
  const core = NK.core;
  const $ = core.$;
  const stageOuter = core.stageOuter;
  const stageInner = core.stageInner;
  const fxCanvas = core.fxCanvas;
  const ctx = fxCanvas.getContext("2d");

  const DEFAULT_CONFIG = () => ({
    background: null,
    lights: [],
    steam: [],   // [{ id, x, y, count, minR, maxR, opacity }]
    petals: { enabled:false, count:40, minSize:4, maxSize:10, hueMin:340, hueMax:365, opacityMin:0.15, opacityMax:0.5 },
  });

  let vis = { lights:true, steam:true, petals:true, markers:true };
  let secOpen = { vis:true, posApp:true, behavior:false, clip:false, steamSettings:true, steamClip:false, petalsSettings:true, petalsClip:false };
  let selectedLightIdx = -1;
  let selectedSteamIdx = -1;
  let clipboard = null; // { type:'light'|'steam', data:{...} }
  let clipBoxHidden = false;
  let lastClipKey = "";
  let lastRenderedTab = null;
  let mounted = false;

  function lightBehaviorCss(l) {
    if (l.pulse === false) return "opacity:" + l.opMax + ";";
    return "--op-min:" + l.opMin + ";--op-max:" + l.opMax + ";animation:glowPulse " + l.duration + "s ease-in-out infinite " + l.delay + "s;";
  }
  function defaultVisFor(tab) {
    if (tab === "tout")   return { lights:true,  steam:true,  petals:true,  markers:true };
    if (tab === "lights") return { lights:true,  steam:false, petals:false, markers:true };
    if (tab === "steam")  return { lights:false, steam:true,  petals:false, markers:true };
    return { lights:false, steam:false, petals:true, markers:false }; // petals
  }

  function extractConfig(html) {
    const m = html.match(/<script id="nk-config" type="application\/json">([\s\S]*?)<\/script>/);
    if (!m) return null;
    try {
      const parsed = JSON.parse(m[1]);
      const d = DEFAULT_CONFIG();
      let steam = parsed.steam;
      if (steam && !Array.isArray(steam)) {
        steam = steam.enabled ? [{ id:"vapeur-1", x:steam.x, y:steam.y, count:steam.count, minR:steam.minR, maxR:steam.maxR, opacity:steam.opacity }] : [];
      }
      return {
        background: parsed.background || d.background,
        lights: parsed.lights || d.lights,
        steam: steam || d.steam,
        petals: { ...d.petals, ...parsed.petals },
      };
    } catch (e) { return null; }
  }

  // ── Fond ──
  async function collectMedia() {
    const matches = [];
    const rootHandle = core.getRootHandle();
    async function walk(handle, prefix, depth) {
      for await (const [name, h] of handle.entries()) {
        const rel = prefix + name;
        if (h.kind === "file" && /\.(png|jpe?g|webp|gif|mp4|webm|mov)$/i.test(name)) matches.push(rel);
        else if (h.kind === "directory" && depth < 3) await walk(h, rel + "/", depth + 1);
      }
    }
    await walk(rootHandle, "", 0);
    return matches;
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
    // src est relatif au répertoire du fichier de scène — les "../" au début
    // représentent la remontée vers la racine; on les supprime pour obtenir
    // le chemin relatif à la racine du projet.
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
  // CADRE DE DÉCOUPE — réutilisé par les lueurs, la vapeur et les pétales.
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
      wrap.style.cssText = "position:absolute;left:" + (c.left*100) + "%;top:" + (c.top*100) + "%;width:" + (c.w*100) + "%;height:" + (c.h*100) + "%;overflow:hidden;pointer-events:none;z-index:11;";
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
  // VAPEUR — liste de sources, chacune avec sa propre position
  // ═══════════════════════════════════════════════════════════════════════
  function renderSteamOverlay() {
    const cfg = core.getConfig();
    if (!vis.steam || !vis.markers) return;
    cfg.steam.forEach((s, i) => {
      const marker = document.createElement("div");
      marker.className = "nk-marker";
      marker.style.left = (s.x * 100) + "%";
      marker.style.top = (s.y * 100) + "%";
      marker.style.background = i === selectedSteamIdx ? "#fff" : "rgba(90,200,255,0.9)";
      marker.title = s.id;
      marker.onmousedown = (e) => { if (e.button === 0) core.startDrag(e, (fx, fy) => {
        cfg.steam[i].x = Math.round(fx * 1000) / 1000;
        cfg.steam[i].y = Math.round(fy * 1000) / 1000;
        core.markDirty(); refreshOverlay(); seedParticles();
      }); };
      marker.onclick = () => {
        if (selectedSteamIdx === i) clipBoxHidden = !clipBoxHidden;
        else { selectedSteamIdx = i; clipBoxHidden = false; }
        if (core.getActiveTab() !== "steam") core.setActiveTab("steam");
        else core.renderPanel();
      };
      marker.oncontextmenu = (e) => {
        e.preventDefault(); e.stopPropagation();
        selectedSteamIdx = i; refreshOverlay();
        core.showCtxMenu(e.clientX, e.clientY, [
          { label: "📄 Dupliquer", onClick: () => duplicateSteamSrc(i) },
          { label: "✂ Copier", onClick: () => { clipboard = { type:"steam", data: JSON.parse(JSON.stringify(cfg.steam[i])) }; } },
          { label: "🗑 Supprimer", onClick: () => removeSteamSrc(i) },
        ]);
      };
      stageInner.appendChild(marker);
    });

    if (selectedSteamIdx >= 0 && cfg.steam[selectedSteamIdx] && cfg.steam[selectedSteamIdx].clip) {
      const s = cfg.steam[selectedSteamIdx];
      renderClipBox("steam:" + selectedSteamIdx, s.clip, (left, top) => {
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

  // ═══════════════════════════════════════════════════════════════════════
  // PÉTALES — découpe globale (une seule zone, pas de marqueur de position)
  // ═══════════════════════════════════════════════════════════════════════
  function renderPetalsOverlay() {
    const cfg = core.getConfig();
    if (core.getActiveTab() !== "petals" || !cfg.petals.clip) return;
    const p = cfg.petals;
    renderClipBox("petals", p.clip, (left, top) => {
      p.clip.left = Math.round(left * 1000) / 1000;
      p.clip.top = Math.round(top * 1000) / 1000;
      core.markDirty(); refreshOverlay(); seedParticles(); core.renderPanel();
    }, (w, h) => {
      p.clip.w = Math.max(0.02, Math.round(w * 1000) / 1000);
      p.clip.h = Math.max(0.02, Math.round(h * 1000) / 1000);
      core.markDirty(); refreshOverlay(); seedParticles(); core.renderPanel();
    });
  }
  function newSteamAt(fx, fy) {
    const cfg = core.getConfig();
    const s = { id:"vapeur-" + (cfg.steam.length+1), x: Math.round(fx*1000)/1000, y: Math.round(fy*1000)/1000, count:18, minR:9, maxR:14, opacity:0.15 };
    cfg.steam.push(s);
    selectedSteamIdx = cfg.steam.length - 1;
    core.markDirty(); core.renderPanel(); seedParticles();
  }
  function duplicateSteamSrc(i) {
    const cfg = core.getConfig();
    const clone = JSON.parse(JSON.stringify(cfg.steam[i]));
    clone.id = clone.id + "-copie";
    clone.x = Math.min(1, clone.x + 0.03);
    cfg.steam.splice(i + 1, 0, clone);
    selectedSteamIdx = i + 1;
    core.markDirty(); core.renderPanel(); seedParticles();
  }
  function removeSteamSrc(i) {
    const cfg = core.getConfig();
    cfg.steam.splice(i, 1);
    if (selectedSteamIdx === i) selectedSteamIdx = -1;
    else if (selectedSteamIdx > i) selectedSteamIdx--;
    core.markDirty(); core.renderPanel(); seedParticles();
  }
  function pasteSteamAt(fx, fy) {
    if (!clipboard || clipboard.type !== "steam") return;
    const cfg = core.getConfig();
    const clone = JSON.parse(JSON.stringify(clipboard.data));
    clone.id = clone.id + "-collee";
    clone.x = Math.round(fx*1000)/1000;
    clone.y = Math.round(fy*1000)/1000;
    cfg.steam.push(clone);
    selectedSteamIdx = cfg.steam.length - 1;
    core.markDirty(); core.renderPanel(); seedParticles();
  }

  function refreshOverlay() {
    stageInner.querySelectorAll(".nk-light-wrap, .nk-marker, .nk-clipbox").forEach((el) => el.remove());
    renderLightOverlay();
    renderSteamOverlay();
    renderPetalsOverlay();
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
      core.showCtxMenu(e.clientX, e.clientY, [
        { label: "+ Ajouter une vapeur ici", onClick: () => newSteamAt(fx, fy) },
        { label: "📋 Coller ici", disabled: !(clipboard && clipboard.type === "steam"), onClick: () => pasteSteamAt(fx, fy) },
      ]);
    } else if (activeTab === "tout") {
      core.showCtxMenu(e.clientX, e.clientY, [
        { label: "+ Ajouter une lueur ici", onClick: () => { newLightAt(fx, fy); core.setActiveTab("lights"); } },
        { label: "+ Ajouter une vapeur ici", onClick: () => { newSteamAt(fx, fy); core.setActiveTab("steam"); } },
      ]);
    }
    // Pas de menu sur l'onglet Pétales : cet effet n'a pas de position ponctuelle.
  });

  // ═══════════════════════════════════════════════════════════════════════
  // PARTICULES — pétales + vapeur (toutes sources), repère fixe 1920×1080
  // ═══════════════════════════════════════════════════════════════════════
  let petals = [], steamParts = [];

  function seedParticles() {
    const cfg = core.getConfig();
    if (!cfg) return;
    petals = cfg.petals.enabled ? Array.from({ length: cfg.petals.count }, () => mkPetal(cfg)) : [];
    steamParts = [];
    cfg.steam.forEach((s, si) => { for (let i = 0; i < s.count; i++) steamParts.push(mkSteam(cfg, si)); });
  }
  function petalsBox(cfg) {
    const c = cfg.petals.clip || { left:0, top:0, w:1, h:1 };
    return { left: c.left*1920, top: c.top*1080, w: c.w*1920, h: c.h*1080 };
  }
  function mkPetal(cfg) {
    const p = cfg.petals;
    const b = petalsBox(cfg);
    return { x: b.left + Math.random()*b.w, y: b.top + Math.random()*b.h, sz: p.minSize + Math.random()*(p.maxSize-p.minSize), vx:-0.5+Math.random()*1.1, vy:0.4+Math.random()*1.1, rot: Math.random()*Math.PI*2, rv:-0.04+Math.random()*0.08, a: p.opacityMin + Math.random()*(p.opacityMax-p.opacityMin), h: p.hueMin + Math.random()*(p.hueMax-p.hueMin) };
  }
  function mkSteam(cfg, si) {
    const s = cfg.steam[si];
    return { si, x: 1920*s.x + (Math.random()-0.5)*1920*0.04, y: 1080*s.y, r: s.minR + Math.random()*(s.maxR-s.minR), vx:(Math.random()-0.5)*0.3, vy:-(0.4+Math.random()*0.9), life: Math.random(), lv:0.003+Math.random()*0.004, ma: s.opacity * (0.5 + Math.random()) };
  }

  function tick() {
    requestAnimationFrame(tick);
    if (core.getModeId() !== "background") return;
    const cfg = core.getConfig();
    if (!cfg) return;
    ctx.clearRect(0, 0, 1920, 1080);
    const showPetals = vis.petals, showSteam = vis.steam;

    const pb = petalsBox(cfg);
    ctx.save();
    if (cfg.petals.clip) { ctx.beginPath(); ctx.rect(pb.left, pb.top, pb.w, pb.h); ctx.clip(); }
    for (const p of petals) {
      p.x += p.vx; p.y += p.vy; p.rot += p.rv;
      if (p.y > pb.top + pb.h + 20) { p.y = pb.top - 20; p.x = pb.left + Math.random()*pb.w; }
      if (p.x < pb.left - 20) p.x = pb.left + pb.w + 20;
      if (p.x > pb.left + pb.w + 20) p.x = pb.left - 20;
      if (!showPetals) continue;
      ctx.save(); ctx.translate(p.x,p.y); ctx.rotate(p.rot); ctx.globalAlpha=p.a; ctx.fillStyle="hsl("+p.h+",62%,82%)";
      for (const dx of [-p.sz*0.26, p.sz*0.26]) { ctx.beginPath(); ctx.ellipse(dx,-p.sz*0.52,p.sz*0.28,p.sz*0.58,0,0,Math.PI*2); ctx.fill(); }
      ctx.restore();
    }
    ctx.restore();

    for (let i=0;i<steamParts.length;i++) {
      const s = steamParts[i];
      s.life += s.lv; s.x += s.vx; s.y += s.vy; s.r += 0.12;
      if (s.life >= 1) steamParts[i] = mkSteam(cfg, s.si);
    }
    if (showSteam) {
      cfg.steam.forEach((src, si) => {
        ctx.save();
        if (src.clip) { ctx.beginPath(); ctx.rect(src.clip.left*1920, src.clip.top*1080, src.clip.w*1920, src.clip.h*1080); ctx.clip(); }
        steamParts.forEach((s) => {
          if (s.si !== si || s.life >= 1) return;
          const a = (s.life < 0.35 ? s.life/0.35 : (1-s.life)/0.65) * s.ma;
          ctx.save(); ctx.globalAlpha=a;
          const g = ctx.createRadialGradient(s.x,s.y,0,s.x,s.y,s.r);
          g.addColorStop(0,"rgba(255,248,235,0.95)"); g.addColorStop(1,"rgba(255,248,235,0)");
          ctx.fillStyle=g; ctx.beginPath(); ctx.arc(s.x,s.y,s.r,0,Math.PI*2); ctx.fill(); ctx.restore();
        });
        ctx.restore();
      });
    }
  }
  tick();

  // ═══════════════════════════════════════════════════════════════════════
  // PANNEAU — onglets Tout / Lueurs / Vapeur / Pétales
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
  const STEAM_FIELD_DEFS = [
    { key:"x", label:"Position gauche (x)", min:0, max:1, step:0.005 },
    { key:"y", label:"Position haut (y)", min:0, max:1, step:0.005 },
    { key:"count", label:"Nombre de particules", min:1, max:60, step:1 },
    { key:"minR", label:"Taille minimum", min:2, max:30, step:1 },
    { key:"maxR", label:"Taille maximum", min:2, max:40, step:1 },
    { key:"opacity", label:"Opacité", min:0, max:1, step:0.01 },
  ];

  function renderVisToggles(which) {
    const labels = { lights:"Lueurs", steam:"Vapeur", petals:"Pétales", markers:"Points repères (édition)" };
    let html = '<details class="sec" data-sec="vis"' + (secOpen.vis ? " open" : "") + '><summary>👁 Affichage sur la scène</summary><div class="secBody">';
    which.forEach((k) => { html += core.toggleSwitch("vis", k, labels[k], vis[k]); });
    html += "</div></details>";
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
      html += '<div class="field"><label>Nom</label><input type="text" id="lightName" value="' + l.id + '"></div>';
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
        html += '<div class="hint">Glissez le rectangle en pointillés dans la scène (✕ pour le masquer sans le désactiver), ou réglez ici :</div>';
        CLIP_FIELD_DEFS.forEach((def) => { html += core.field(def, l.clip[def.key], "clipkey"); });
      }
      html += "</div></details>";
      html += '<button class="btn btn-main" id="btnDupLight">📄 Dupliquer</button>';
      html += '<button class="btn btn-danger" id="btnRemoveLight">🗑 Supprimer cette lueur</button>';
    }
    return html;
  }

  function renderSteamTab(cfg) {
    let html = renderVisToggles(["steam", "markers"]);
    html += "<h3>♨ VAPEUR — " + cfg.steam.length + "</h3>";
    html += '<div class="hint">Clic droit sur un point ou sur la scène : dupliquer / copier / coller / ajouter.</div>';
    html += '<div class="chiprow">';
    cfg.steam.forEach((s, i) => { html += '<button class="chip' + (i === selectedSteamIdx ? " active" : "") + '" data-select-steam="' + i + '">' + s.id + "</button>"; });
    html += '</div><button class="btn btn-main" id="btnAddSteam">+ Ajouter une vapeur</button>';

    const s = selectedSteamIdx >= 0 ? cfg.steam[selectedSteamIdx] : null;
    if (s) {
      html += '<details class="sec" data-sec="steamSettings"' + (secOpen.steamSettings ? " open" : "") + '><summary>Réglages</summary><div class="secBody">';
      html += '<div class="field"><label>Nom</label><input type="text" id="steamName" value="' + s.id + '"></div>';
      STEAM_FIELD_DEFS.forEach((def) => { html += core.field(def, s[def.key], "steamkey"); });
      html += "</div></details>";
      html += '<details class="sec" data-sec="steamClip"' + (secOpen.steamClip ? " open" : "") + '><summary>Zone de découpe (limiter le débordement)</summary><div class="secBody">';
      html += core.toggleSwitch("steamclip", "enable", "Activer la découpe", !!s.clip);
      if (s.clip) {
        html += '<div class="hint">Glissez le rectangle en pointillés dans la scène (✕ pour le masquer sans le désactiver), ou réglez ici :</div>';
        CLIP_FIELD_DEFS.forEach((def) => { html += core.field(def, s.clip[def.key], "steamclipkey"); });
      }
      html += "</div></details>";
      html += '<button class="btn btn-main" id="btnDupSteam">📄 Dupliquer</button>';
      html += '<button class="btn btn-danger" id="btnRemoveSteam">🗑 Supprimer cette vapeur</button>';
    }
    return html;
  }

  function renderPetalsTab(cfg) {
    const p = cfg.petals;
    let html = renderVisToggles(["petals"]);
    html += "<h3>🌸 PÉTALES (effet de chute)</h3>";
    html += '<div class="hint">Effet de chute sans point unique — utilisez la zone de découpe ci-dessous pour confiner où les pétales tombent.</div>';
    html += core.toggleSwitch("petals", "enabled", "Activés", p.enabled);
    html += '<details class="sec" data-sec="petalsSettings"' + (secOpen.petalsSettings ? " open" : "") + '><summary>Réglages</summary><div class="secBody">';
    [
      { key:"count", label:"Nombre de pétales", min:0, max:150, step:1 },
      { key:"minSize", label:"Taille minimum", min:1, max:20, step:0.5 },
      { key:"maxSize", label:"Taille maximum", min:1, max:30, step:0.5 },
      { key:"hueMin", label:"Teinte — minimum (0-360)", min:0, max:360, step:1 },
      { key:"hueMax", label:"Teinte — maximum (0-360)", min:0, max:360, step:1 },
      { key:"opacityMin", label:"Opacité — minimum", min:0, max:1, step:0.01 },
      { key:"opacityMax", label:"Opacité — maximum", min:0, max:1, step:0.01 },
    ].forEach((def) => { html += core.field(def, p[def.key], "petalkey"); });
    html += "</div></details>";
    html += '<details class="sec" data-sec="petalsClip"' + (secOpen.petalsClip ? " open" : "") + '><summary>Zone de découpe (limiter où ça tombe)</summary><div class="secBody">';
    html += core.toggleSwitch("petalsclip", "enable", "Activer la découpe", !!p.clip);
    if (p.clip) {
      html += '<div class="hint">Glissez le rectangle en pointillés dans la scène (✕ pour le masquer sans le désactiver), ou réglez ici :</div>';
      CLIP_FIELD_DEFS.forEach((def) => { html += core.field(def, p.clip[def.key], "petalclipkey"); });
    }
    html += "</div></details>";
    return html;
  }

  function renderTab(tabId, cfg) {
    if (tabId !== lastRenderedTab) { vis = defaultVisFor(tabId); lastRenderedTab = tabId; }
    if (tabId === "tout") return renderToutTab(cfg);
    if (tabId === "lights") return renderLightsTab(cfg);
    if (tabId === "steam") return renderSteamTab(cfg);
    return renderPetalsTab(cfg);
  }

  function bindTab(tabId, cfg) {
    // Toggles "bouton glissant" génériques (affichage, découpe, pétales activés)
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
          else l.clip = { left: Math.max(0, l.left - l.w/2), top: Math.max(0, l.top - l.h/2), w: l.w, h: l.h };
          secOpen.clip = !!l.clip;
          core.markDirty(); core.renderPanel();
        } else if (kind === "pulse") {
          const l = cfg.lights[selectedLightIdx];
          l.pulse = !(l.pulse !== false); // bascule, true par défaut si absent
          core.markDirty(); core.renderPanel(); refreshOverlay();
        } else if (kind === "steamclip") {
          const s = cfg.steam[selectedSteamIdx];
          if (s.clip) delete s.clip;
          else s.clip = { left: Math.max(0, s.x - 0.1), top: Math.max(0, s.y - 0.3), w: 0.2, h: 0.4 };
          secOpen.steamClip = !!s.clip;
          core.markDirty(); core.renderPanel();
        } else if (kind === "petalsclip") {
          const p = cfg.petals;
          if (p.clip) delete p.clip;
          else p.clip = { left:0, top:0, w:1, h:1 };
          secOpen.petalsClip = !!p.clip;
          core.markDirty(); core.renderPanel(); seedParticles();
        } else if (kind === "petals") {
          cfg.petals.enabled = !cfg.petals.enabled;
          el.classList.toggle("on", cfg.petals.enabled);
          core.markDirty(); seedParticles();
        }
      };
    });

    document.querySelectorAll("details.sec[data-sec]").forEach((d) => {
      d.ontoggle = () => { secOpen[d.dataset.sec] = d.open; };
    });

    document.querySelectorAll("[data-select-light]").forEach((el) => { el.onclick = () => { selectedLightIdx = parseInt(el.dataset.selectLight, 10); core.renderPanel(); }; });
    document.querySelectorAll("[data-select-steam]").forEach((el) => { el.onclick = () => { selectedSteamIdx = parseInt(el.dataset.selectSteam, 10); core.renderPanel(); }; });

    const addBtn = $("#btnAddLight"); if (addBtn) addBtn.onclick = () => newLightAt(0.5, 0.5);
    const dupBtn = $("#btnDupLight"); if (dupBtn) dupBtn.onclick = () => duplicateLight(selectedLightIdx);
    const rmBtn = $("#btnRemoveLight"); if (rmBtn) rmBtn.onclick = () => removeLight(selectedLightIdx);

    const addSteamBtn = $("#btnAddSteam"); if (addSteamBtn) addSteamBtn.onclick = () => newSteamAt(0.5, 0.5);
    const dupSteamBtn = $("#btnDupSteam"); if (dupSteamBtn) dupSteamBtn.onclick = () => duplicateSteamSrc(selectedSteamIdx);
    const rmSteamBtn = $("#btnRemoveSteam"); if (rmSteamBtn) rmSteamBtn.onclick = () => removeSteamSrc(selectedSteamIdx);

    const nameInput = $("#lightName");
    if (nameInput) nameInput.onchange = (e) => { cfg.lights[selectedLightIdx].id = e.target.value || cfg.lights[selectedLightIdx].id; core.markDirty(); core.renderPanel(); };
    const steamNameInput = $("#steamName");
    if (steamNameInput) steamNameInput.onchange = (e) => { cfg.steam[selectedSteamIdx].id = e.target.value || cfg.steam[selectedSteamIdx].id; core.markDirty(); core.renderPanel(); };
    const colorInput = $("#lightColor");
    if (colorInput) colorInput.oninput = (e) => { cfg.lights[selectedLightIdx].colorRgb = core.hexToRgb(e.target.value); core.markDirty(); refreshOverlay(); };

    document.querySelectorAll("[data-key]").forEach((el) => {
      const def = FIELD_DEFS.find((d) => d.key === el.dataset.key) || FIELD_DEFS_BEHAVIOR.find((d) => d.key === el.dataset.key);
      el.oninput = (e) => {
        const v = parseFloat(e.target.value);
        cfg.lights[selectedLightIdx][el.dataset.key] = v;
        if (def && el.previousElementSibling) el.previousElementSibling.textContent = def.label + " : " + v;
        core.markDirty(); refreshOverlay();
      };
    });
    document.querySelectorAll("[data-clipkey]").forEach((el) => {
      const def = CLIP_FIELD_DEFS.find((d) => d.key === el.dataset.clipkey);
      el.oninput = (e) => {
        const v = parseFloat(e.target.value);
        cfg.lights[selectedLightIdx].clip[el.dataset.clipkey] = v;
        if (def && el.previousElementSibling) el.previousElementSibling.textContent = def.label + " : " + v;
        core.markDirty(); refreshOverlay();
      };
    });
    document.querySelectorAll("[data-steamclipkey]").forEach((el) => {
      const def = CLIP_FIELD_DEFS.find((d) => d.key === el.dataset.steamclipkey);
      el.oninput = (e) => {
        const v = parseFloat(e.target.value);
        cfg.steam[selectedSteamIdx].clip[el.dataset.steamclipkey] = v;
        if (def && el.previousElementSibling) el.previousElementSibling.textContent = def.label + " : " + v;
        core.markDirty(); refreshOverlay();
      };
    });
    document.querySelectorAll("[data-petalclipkey]").forEach((el) => {
      const def = CLIP_FIELD_DEFS.find((d) => d.key === el.dataset.petalclipkey);
      el.oninput = (e) => {
        const v = parseFloat(e.target.value);
        cfg.petals.clip[el.dataset.petalclipkey] = v;
        if (def && el.previousElementSibling) el.previousElementSibling.textContent = def.label + " : " + v;
        core.markDirty(); seedParticles();
      };
    });
    document.querySelectorAll("[data-steamkey]").forEach((el) => {
      const def = STEAM_FIELD_DEFS.find((d) => d.key === el.dataset.steamkey);
      el.oninput = (e) => {
        const v = parseFloat(e.target.value);
        cfg.steam[selectedSteamIdx][el.dataset.steamkey] = v;
        if (def && el.previousElementSibling) el.previousElementSibling.textContent = def.label + " : " + v;
        core.markDirty(); refreshOverlay(); seedParticles();
      };
    });
    document.querySelectorAll("[data-petalkey]").forEach((el) => {
      el.oninput = (e) => {
        const v = parseFloat(e.target.value);
        cfg.petals[el.dataset.petalkey] = v;
        if (el.previousElementSibling) {
          const label = el.previousElementSibling.textContent.replace(/:\s*[-\d.]+$/, ": " + v);
          el.previousElementSibling.textContent = label;
        }
        core.markDirty(); seedParticles();
      };
    });
  }

  function onDeleteKey(cfg) {
    const activeTab = core.getActiveTab();
    if (activeTab === "lights" && selectedLightIdx >= 0) { removeLight(selectedLightIdx); return true; }
    if (activeTab === "steam" && selectedSteamIdx >= 0) { removeSteamSrc(selectedSteamIdx); return true; }
    return false;
  }

  // ═══════════════════════════════════════════════════════════════════════
  // GÉNÉRATION DU FICHIER DE SORTIE
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
      return '<div style="position:absolute;left:' + (c.left*100) + "%;top:" + (c.top*100) + "%;width:" + (c.w*100) + "%;height:" + (c.h*100) + '%;overflow:hidden;pointer-events:none;z-index:11;">'
        + '<div style="position:absolute;left:' + relLeft + "%;top:" + relTop + "%;width:" + relW + "%;height:" + relH + "%;transform:translate(-50%,-50%);background:" + grad + ";" + lightBehaviorCss(l) + '"></div></div>';
    }).join("\n  ");

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
      + "<script>\n" + sceneEngineJs() + "\n<" + "/script>\n"
      + "</body>\n</html>\n";
  }

  function sceneEngineJs() {
    return [
      "(function(){",
      "var cfg = JSON.parse(document.getElementById('nk-config').textContent);",
      "var canvas = document.getElementById('nk-fx');",
      "function resize(){ canvas.width = window.innerWidth; canvas.height = window.innerHeight; }",
      "resize(); window.addEventListener('resize', resize);",
      "var ctx = canvas.getContext('2d');",
      "function petalsBox(W,H){ var c=cfg.petals.clip||{left:0,top:0,w:1,h:1}; return {left:c.left*W,top:c.top*H,w:c.w*W,h:c.h*H}; }",
      "function mkPetal(W,H){ var p=cfg.petals; var b=petalsBox(W,H); return {x:b.left+Math.random()*b.w,y:b.top+Math.random()*b.h,sz:p.minSize+Math.random()*(p.maxSize-p.minSize),vx:-0.5+Math.random()*1.1,vy:0.4+Math.random()*1.1,rot:Math.random()*Math.PI*2,rv:-0.04+Math.random()*0.08,a:p.opacityMin+Math.random()*(p.opacityMax-p.opacityMin),h:p.hueMin+Math.random()*(p.hueMax-p.hueMin)}; }",
      "function mkSteam(si){ var s=cfg.steam[si]; return {si:si,x:canvas.width*s.x+(Math.random()-0.5)*canvas.width*0.04,y:canvas.height*s.y,r:s.minR+Math.random()*(s.maxR-s.minR),vx:(Math.random()-0.5)*0.3,vy:-(0.4+Math.random()*0.9),life:Math.random(),lv:0.003+Math.random()*0.004,ma:s.opacity*(0.5+Math.random())}; }",
      "var petals = cfg.petals.enabled ? Array.from({length:cfg.petals.count}, function(){ return mkPetal(canvas.width,canvas.height); }) : [];",
      "var steam = [];",
      "(cfg.steam||[]).forEach(function(s,si){ for (var i=0;i<s.count;i++) steam.push(mkSteam(si)); });",
      "function tick(){",
      "  var W=canvas.width, H=canvas.height; ctx.clearRect(0,0,W,H);",
      "  var pb=petalsBox(W,H);",
      "  ctx.save(); if (cfg.petals.clip) { ctx.beginPath(); ctx.rect(pb.left,pb.top,pb.w,pb.h); ctx.clip(); }",
      "  for (var i=0;i<petals.length;i++){ var p=petals[i]; p.x+=p.vx;p.y+=p.vy;p.rot+=p.rv; if(p.y>pb.top+pb.h+20){p.y=pb.top-20;p.x=pb.left+Math.random()*pb.w;} if(p.x<pb.left-20)p.x=pb.left+pb.w+20; if(p.x>pb.left+pb.w+20)p.x=pb.left-20;",
      "    ctx.save(); ctx.translate(p.x,p.y); ctx.rotate(p.rot); ctx.globalAlpha=p.a; ctx.fillStyle='hsl('+p.h+',62%,82%)';",
      "    [-p.sz*0.26,p.sz*0.26].forEach(function(dx){ ctx.beginPath(); ctx.ellipse(dx,-p.sz*0.52,p.sz*0.28,p.sz*0.58,0,0,Math.PI*2); ctx.fill(); });",
      "    ctx.restore(); }",
      "  ctx.restore();",
      "  for (var j=0;j<steam.length;j++){ var s=steam[j]; s.life+=s.lv;s.x+=s.vx;s.y+=s.vy;s.r+=0.12; if(s.life>=1){ steam[j]=mkSteam(s.si); } }",
      "  (cfg.steam||[]).forEach(function(src,si){",
      "    ctx.save(); if (src.clip) { ctx.beginPath(); ctx.rect(src.clip.left*W,src.clip.top*H,src.clip.w*W,src.clip.h*H); ctx.clip(); }",
      "    steam.forEach(function(s){ if (s.si!==si || s.life>=1) return;",
      "      var a=(s.life<0.35? s.life/0.35 : (1-s.life)/0.65)*s.ma;",
      "      ctx.save(); ctx.globalAlpha=a; var g=ctx.createRadialGradient(s.x,s.y,0,s.x,s.y,s.r); g.addColorStop(0,'rgba(255,248,235,0.95)'); g.addColorStop(1,'rgba(255,248,235,0)'); ctx.fillStyle=g; ctx.beginPath(); ctx.arc(s.x,s.y,s.r,0,Math.PI*2); ctx.fill(); ctx.restore();",
      "    });",
      "    ctx.restore();",
      "  });",
      "  requestAnimationFrame(tick);",
      "}",
      "tick();",
      "})();",
    ].join("\n");
  }

  // ═══════════════════════════════════════════════════════════════════════
  // CYCLE DE VIE (montage/démontage de la scène pour ce mode)
  // ═══════════════════════════════════════════════════════════════════════
  function mount(cfg) {
    mounted = true;
    lastRenderedTab = null;
    selectedLightIdx = -1;
    selectedSteamIdx = -1;
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
      { id: "steam", label: "♨ Vapeur" },
      { id: "petals", label: "🌸 Pétales" },
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
