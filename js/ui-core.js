// ═══════════════════════════════════════════════════════════════════════
// NK.core — explorateur de fichiers, zoom/pan, session, registre de modes,
// cycle de vie des fichiers (ouvrir/sauver/fermer/créer). Générique : ne
// connaît rien des fonds animés ni du chat — chaque mode (mode-*.js)
// s'enregistre via NK.core.registerMode() et fournit ses propres écrans.
// ═══════════════════════════════════════════════════════════════════════
window.NK = window.NK || {};
NK.modes = {};
NK.modeOrder = [];

NK.core = (function () {
  "use strict";

  const $ = (sel) => document.querySelector(sel);

  // ── État explorateur / fichier ──
  let rootHandle = null;
  let dirStack = [];
  let pathParts = [];
  let currentHandle = null;
  let currentName = "";
  let dirty = false;
  let saveTimer = null;
  let selectedEntries = [];
  let currentEntries = [];
  let lastClickedIdx = -1;

  // ── État mode courant ──
  let modeId = null;
  let config = null;
  let activeTab = null;

  // ── Zoom / pan ──
  let zoom = 1, panX = 0, panY = 0, userZoomed = false;
  let panning = false, panStartX = 0, panStartY = 0, panOrigX = 0, panOrigY = 0;

  const stageOuter = $("#stageOuter");
  const stageInner = $("#stageInner");
  const fxCanvas = $("#fxCanvas");

  function currentDir() { return dirStack[dirStack.length - 1]; }
  function depthFromRoot() { return dirStack.length - 1; }
  function getModeId() { return modeId; }
  function getMode() { return modeId ? NK.modes[modeId] : null; }
  function getConfig() { return config; }
  function getActiveTab() { return activeTab; }
  function isDirty() { return dirty; }

  function registerMode(id, def) {
    NK.modes[id] = def;
    NK.modeOrder.push(id);
  }

  function markDirty() { dirty = true; updateSaveStatus("● modification en cours…"); scheduleAutoSave(); }
  function updateSaveStatus(text) { $("#saveStatus").textContent = currentHandle ? (text || (dirty ? "● non sauvegardé" : "✓ à jour")) : ""; }
  function scheduleAutoSave() { if (!currentHandle) return; clearTimeout(saveTimer); saveTimer = setTimeout(() => saveFile(true), 1200); }

  // ═══════════════════════════════════════════════════════════════════════
  // ZOOM & PANORAMIQUE
  // ═══════════════════════════════════════════════════════════════════════
  function applyTransform() {
    stageInner.style.transform = "translate(" + panX + "px," + panY + "px) scale(" + zoom + ")";
    $("#zoomSlider").value = Math.round(zoom * 100);
    $("#zoomLabel").textContent = Math.round(zoom * 100) + "%";
  }
  function zoomFit() {
    const r = stageOuter.getBoundingClientRect();
    zoom = Math.min(r.width / 1920, r.height / 1080);
    panX = (r.width - 1920 * zoom) / 2;
    panY = (r.height - 1080 * zoom) / 2;
    userZoomed = false;
    applyTransform();
  }
  function setZoom(z) {
    z = Math.min(3, Math.max(0.25, z));
    const r = stageOuter.getBoundingClientRect();
    const cx = r.width / 2, cy = r.height / 2;
    const logX = (cx - panX) / zoom, logY = (cy - panY) / zoom;
    zoom = z;
    panX = cx - logX * zoom;
    panY = cy - logY * zoom;
    userZoomed = true;
    applyTransform();
  }

  $("#zoomSlider").oninput = (e) => setZoom(parseInt(e.target.value, 10) / 100);
  $("#zoomIn").onclick = () => setZoom(zoom * 1.2);
  $("#zoomOut").onclick = () => setZoom(zoom / 1.2);
  $("#zoomFit").onclick = zoomFit;
  window.addEventListener("resize", () => { if (!userZoomed) zoomFit(); });

  stageOuter.addEventListener("wheel", (e) => {
    e.preventDefault();
    const r = stageOuter.getBoundingClientRect();
    const mx = e.clientX - r.left, my = e.clientY - r.top;
    const logX = (mx - panX) / zoom, logY = (my - panY) / zoom;
    zoom = Math.min(3, Math.max(0.25, zoom * (e.deltaY < 0 ? 1.1 : 1 / 1.1)));
    panX = mx - logX * zoom;
    panY = my - logY * zoom;
    userZoomed = true;
    applyTransform();
  }, { passive: false });

  stageOuter.addEventListener("mousedown", (e) => {
    if (e.button !== 1) return;
    e.preventDefault();
    panning = true;
    panStartX = e.clientX; panStartY = e.clientY;
    panOrigX = panX; panOrigY = panY;
    stageOuter.style.cursor = "grabbing";
  });
  window.addEventListener("mousemove", (e) => {
    if (!panning) return;
    panX = panOrigX + (e.clientX - panStartX);
    panY = panOrigY + (e.clientY - panStartY);
    applyTransform();
  });
  window.addEventListener("mouseup", () => { panning = false; stageOuter.style.cursor = "default"; });
  stageOuter.addEventListener("auxclick", (e) => { if (e.button === 1) e.preventDefault(); });

  // ═══════════════════════════════════════════════════════════════════════
  // SUPPRESSION CLAVIER (touche Suppr)
  // ═══════════════════════════════════════════════════════════════════════
  window.addEventListener("keydown", (e) => {
    if (e.key !== "Delete") return;
    const tag = document.activeElement && document.activeElement.tagName;
    if (tag === "INPUT" || tag === "TEXTAREA") return;
    const mode = getMode();
    if (mode && mode.onDeleteKey && mode.onDeleteKey(config)) { e.preventDefault(); return; }
    if (selectedEntries.length) { deleteSelectedEntry(); e.preventDefault(); }
  });

  // ═══════════════════════════════════════════════════════════════════════
  // PERSISTANCE DE SESSION (IndexedDB)
  // ═══════════════════════════════════════════════════════════════════════
  const DB_NAME = "nk-editor", STORE = "session";
  function idbOpen() {
    return new Promise((res, rej) => {
      const r = indexedDB.open(DB_NAME, 1);
      r.onupgradeneeded = () => r.result.createObjectStore(STORE);
      r.onsuccess = () => res(r.result);
      r.onerror = () => rej(r.error);
    });
  }
  async function idbSet(key, val) {
    const db = await idbOpen();
    return new Promise((res, rej) => {
      const tx = db.transaction(STORE, "readwrite");
      tx.objectStore(STORE).put(val, key);
      tx.oncomplete = () => res();
      tx.onerror = () => rej(tx.error);
    });
  }
  async function idbGet(key) {
    const db = await idbOpen();
    return new Promise((res, rej) => {
      const tx = db.transaction(STORE, "readonly");
      const rq = tx.objectStore(STORE).get(key);
      rq.onsuccess = () => res(rq.result);
      rq.onerror = () => rej(rq.error);
    });
  }
  function saveSession() { idbSet("session", { root: rootHandle, pathParts, fileName: currentName }).catch(() => {}); }

  async function trySilentResume() {
    let sess;
    try { sess = await idbGet("session"); } catch (e) { return; }
    if (!sess || !sess.root) return;
    const granted = await sess.root.queryPermission({ mode: "readwrite" });
    if (granted === "granted") {
      await resumeSession(sess);
    } else {
      $("#resumeBanner").style.display = "flex";
      $("#btnResume").onclick = async () => {
        const perm = await sess.root.requestPermission({ mode: "readwrite" });
        if (perm === "granted") { $("#resumeBanner").style.display = "none"; await resumeSession(sess); }
      };
    }
  }
  async function resumeSession(sess) {
    rootHandle = sess.root;
    dirStack = [rootHandle];
    pathParts = [sess.pathParts && sess.pathParts[0] || "(racine)"];
    try {
      for (let i = 1; i < (sess.pathParts || []).length; i++) {
        const sub = await currentDir().getDirectoryHandle(sess.pathParts[i]);
        dirStack.push(sub);
        pathParts.push(sess.pathParts[i]);
      }
    } catch (e) { /* dossier déplacé/supprimé entre-temps */ }
    setFolderOpenUi();
    await refreshFileList();
    if (sess.fileName) {
      try {
        const fh = await currentDir().getFileHandle(sess.fileName);
        await openFile(sess.fileName, fh);
      } catch (e) { /* fichier supprimé entre-temps */ }
    }
  }

  // ═══════════════════════════════════════════════════════════════════════
  // DOSSIER & NAVIGATION
  // ═══════════════════════════════════════════════════════════════════════
  if (!window.showDirectoryPicker) {
    alert("Ce navigateur ne supporte pas l'accès au système de fichiers. Ouvrez ce fichier avec Microsoft Edge ou Google Chrome.");
  }

  function setFolderOpenUi() {
    $("#folderIndicator").textContent = "📁 " + pathParts.join(" / ");
    $("#btnNewFileExp").disabled = false;
    $("#btnNewFolderExp").disabled = false;
    document.dispatchEvent(new CustomEvent("nk-folder-opened"));
  }

  $("#folderIndicator").onclick = async () => {
    try {
      rootHandle = await window.showDirectoryPicker();
      dirStack = [rootHandle];
      pathParts = [rootHandle.name || "(racine)"];
      setFolderOpenUi();
      $("#resumeBanner").style.display = "none";
      saveSession();
      await refreshFileList();
    } catch (e) { /* annulé */ }
  };
  $("#btnDismissResume").onclick = () => { $("#resumeBanner").style.display = "none"; };

  function renderBreadcrumb() {
    const el = $("#breadcrumb");
    el.innerHTML = "";
    pathParts.forEach((name, i) => {
      const span = document.createElement("span");
      span.className = "crumb";
      span.textContent = (i === 0 ? "🏠 " : "") + name;
      span.onclick = async () => {
        dirStack = dirStack.slice(0, i + 1);
        pathParts = pathParts.slice(0, i + 1);
        selectedEntries = [];
        lastClickedIdx = -1;
        updateActionButtons();
        saveSession();
        await refreshFileList();
      };
      el.appendChild(span);
      if (i < pathParts.length - 1) {
        const sep = document.createElement("span");
        sep.textContent = " / ";
        sep.style.opacity = "0.4";
        el.appendChild(sep);
      }
    });
  }

  function isSameEntry(a, b) { return a.name === b.name && a.kind === b.kind; }
  function isEntrySelected(entry) { return selectedEntries.some((se) => isSameEntry(se, entry)); }

  async function detectFileMode(handle) {
    try {
      const file = await handle.getFile();
      const text = await file.text();
      if (text.includes('"nk-chat-config"')) return "chat";
      if (text.includes('"nk-config"')) return "background";
    } catch (e) {}
    return null;
  }

  function updateActionButtons() {
    const n = selectedEntries.length;
    $("#btnDeleteExp").disabled = n === 0;
    $("#btnDeleteExp").textContent = n > 1 ? "🗑 Supprimer la sélection (" + n + ")" : "🗑 Supprimer la sélection";
    $("#btnRenameExp").disabled = n !== 1;
  }

  let _listGen = 0;
  async function refreshFileList() {
    const gen = ++_listGen;
    renderBreadcrumb();
    const list = $("#fileList");
    list.innerHTML = "";
    const dirs = [], files = [];
    for await (const [name, handle] of currentDir().entries()) {
      if (gen !== _listGen) return;
      if (handle.kind === "directory") dirs.push({ name, handle, kind:"directory" });
      else if (/\.(html|htm)$/i.test(name)) files.push({ name, handle, kind:"file" });
    }
    dirs.sort((a, b) => a.name.localeCompare(b.name));
    files.sort((a, b) => a.name.localeCompare(b.name));
    const fileModes = await Promise.all(files.map((f) => detectFileMode(f.handle)));
    if (gen !== _listGen) return;
    currentEntries = dirs.concat(files);
    selectedEntries = selectedEntries.filter((se) => currentEntries.some((e) => isSameEntry(e, se)));
    updateActionButtons();

    if (!currentEntries.length) {
      list.innerHTML = '<div class="empty">Dossier vide. Créez un fichier ou un sous-dossier ci-dessous.</div>';
      return;
    }

    currentEntries.forEach((entry, idx) => {
      const div = document.createElement("div");
      const isOpenFile = entry.kind === "file" && entry.name === currentName;
      const isSelected = isEntrySelected(entry);
      div.className = "item" + (isOpenFile ? " open" : isSelected ? " selected" : "");
      let icon;
      if (entry.kind === "directory") {
        icon = "📁 ";
      } else {
        const mode = fileModes[idx - dirs.length];
        icon = mode === "chat" ? "💬 " : mode === "background" ? "🖼 " : "📄 ";
      }
      div.textContent = icon + entry.name;
      div.onclick = (e) => {
        if (e.ctrlKey || e.metaKey) {
          if (isEntrySelected(entry)) selectedEntries = selectedEntries.filter((se) => !isSameEntry(se, entry));
          else selectedEntries.push(entry);
        } else if (e.shiftKey && lastClickedIdx >= 0) {
          const a = Math.min(lastClickedIdx, idx), b = Math.max(lastClickedIdx, idx);
          selectedEntries = currentEntries.slice(a, b + 1);
        } else {
          selectedEntries = [entry];
        }
        lastClickedIdx = idx;
        updateActionButtons();
        refreshFileList();
      };
      div.ondblclick = async () => {
        if (entry.kind === "directory") {
          dirStack.push(entry.handle);
          pathParts.push(entry.name);
          selectedEntries = [];
          lastClickedIdx = -1;
          updateActionButtons();
          saveSession();
          await refreshFileList();
        } else {
          await openFile(entry.name, entry.handle);
        }
      };
      div.oncontextmenu = (e) => {
        e.preventDefault(); e.stopPropagation();
        if (!isEntrySelected(entry)) selectedEntries = [entry];
        lastClickedIdx = idx;
        updateActionButtons(); refreshFileList();
        const items = [];
        if (selectedEntries.length === 1) {
          if (entry.kind === "directory") items.push({ label: "➡ Entrer", onClick: () => div.ondblclick() });
          else items.push({ label: "📂 Ouvrir", onClick: () => div.ondblclick() });
          items.push({ label: "📄 Dupliquer", onClick: () => duplicateEntry(entry) });
          items.push({ label: "✏ Renommer", onClick: () => renameSelectedEntry() });
        }
        items.push({ label: "🗑 Supprimer" + (selectedEntries.length > 1 ? " (" + selectedEntries.length + ")" : ""), onClick: () => deleteSelectedEntry() });
        showCtxMenu(e.clientX, e.clientY, items);
      };
      list.appendChild(div);
    });
  }

  async function entryExists(name) {
    try { await currentDir().getFileHandle(name); return true; } catch (e1) {
      try { await currentDir().getDirectoryHandle(name); return true; } catch (e2) { return false; }
    }
  }

  async function duplicateEntry(entry) {
    if (entry.kind === "file") {
      const file = await entry.handle.getFile();
      const text = await file.text();
      let newName = entry.name.replace(/(\.[^.]+)$/, " (copie)$1");
      let n = 1;
      while (await entryExists(newName)) { n++; newName = entry.name.replace(/(\.[^.]+)$/, " (copie " + n + ")$1"); }
      const newHandle = await currentDir().getFileHandle(newName, { create: true });
      const w = await newHandle.createWritable();
      await w.write(text);
      await w.close();
    } else {
      let newName = entry.name + " (copie)";
      let n = 1;
      while (await entryExists(newName)) { n++; newName = entry.name + " (copie " + n + ")"; }
      const newDir = await currentDir().getDirectoryHandle(newName, { create: true });
      await copyDirRecursive(entry.handle, newDir);
    }
    refreshFileList();
  }
  async function copyDirRecursive(srcDir, destDir) {
    for await (const [name, handle] of srcDir.entries()) {
      if (handle.kind === "file") {
        const file = await handle.getFile();
        const text = await file.text();
        const newFile = await destDir.getFileHandle(name, { create: true });
        const w = await newFile.createWritable();
        await w.write(text);
        await w.close();
      } else {
        const newSub = await destDir.getDirectoryHandle(name, { create: true });
        await copyDirRecursive(handle, newSub);
      }
    }
  }

  $("#btnNewFolderExp").onclick = async () => {
    const name = prompt("Nom du nouveau dossier :", "Nouveau dossier");
    if (!name) return;
    await currentDir().getDirectoryHandle(name, { create: true });
    refreshFileList();
  };

  async function deleteSelectedEntry() {
    if (!selectedEntries.length) return;
    const label = selectedEntries.length === 1
      ? (selectedEntries[0].kind === "directory" ? "le dossier" : "le fichier") + ' "' + selectedEntries[0].name + '"'
      : selectedEntries.length + " éléments";
    if (!confirm("Supprimer définitivement " + label + " ? Cette action est irréversible.")) return;
    for (const entry of selectedEntries) {
      await currentDir().removeEntry(entry.name, { recursive: true });
      if (entry.kind === "file" && entry.name === currentName) closeCurrentFile();
    }
    selectedEntries = [];
    updateActionButtons();
    refreshFileList();
  }
  $("#btnDeleteExp").onclick = deleteSelectedEntry;

  async function renameSelectedEntry() {
    if (selectedEntries.length !== 1) return;
    const entry = selectedEntries[0];
    const newName = prompt("Nouveau nom :", entry.name);
    if (!newName || newName === entry.name) return;
    if (await entryExists(newName)) { alert('"' + newName + '" existe déjà dans ce dossier.'); return; }
    if (entry.kind === "file") {
      const file = await entry.handle.getFile();
      const text = await file.text();
      const newHandle = await currentDir().getFileHandle(newName, { create: true });
      const w = await newHandle.createWritable();
      await w.write(text);
      await w.close();
      await currentDir().removeEntry(entry.name);
      if (entry.name === currentName) {
        currentHandle = newHandle;
        currentName = newName;
        $("#currentFile").textContent = newName;
        saveSession();
      }
    } else {
      const newDir = await currentDir().getDirectoryHandle(newName, { create: true });
      await copyDirRecursive(entry.handle, newDir);
      await currentDir().removeEntry(entry.name, { recursive: true });
    }
    selectedEntries = [{ name: newName, kind: entry.kind }];
    updateActionButtons();
    refreshFileList();
  }
  $("#btnRenameExp").onclick = renameSelectedEntry;

  // ═══════════════════════════════════════════════════════════════════════
  // CYCLE DE VIE DU FICHIER COURANT — délègue tout le contenu au mode actif
  // ═══════════════════════════════════════════════════════════════════════
  function rebuildTabsUi(mode) {
    const tabsEl = $("#tabs");
    tabsEl.innerHTML = "";
    if (!mode) return;
    mode.tabs.forEach((t) => {
      const btn = document.createElement("button");
      btn.dataset.tab = t.id;
      btn.textContent = t.label;
      if (t.id === activeTab) btn.classList.add("active");
      btn.onclick = () => setActiveTab(t.id);
      tabsEl.appendChild(btn);
    });
  }

  function setActiveTab(id) {
    activeTab = id;
    document.querySelectorAll("#tabs button").forEach((b) => b.classList.toggle("active", b.dataset.tab === id));
    renderPanel();
  }

  function renderPanel() {
    const body = $("#panelBody");
    const mode = getMode();
    if (!mode || !config) { body.innerHTML = ""; return; }
    body.innerHTML = mode.renderTab(activeTab, config);
    if (mode.bindTab) mode.bindTab(activeTab, config);
    if (mode.stage && mode.stage.update) mode.stage.update(config);
  }

  function closeCurrentFile() {
    const mode = getMode();
    if (mode && mode.stage && mode.stage.unmount) mode.stage.unmount();
    modeId = null;
    config = null;
    activeTab = null;
    currentHandle = null;
    currentName = "";
    $("#currentFile").textContent = "Aucun fichier ouvert";
    $("#saveStatus").textContent = "";
    $("#stageEmpty").style.display = "flex";
    rebuildTabsUi(null);
    renderPanel();
  }

  async function openFile(name, handle) {
    if (dirty) await saveFile(true);
    const file = await handle.getFile();
    const text = await file.text();

    let foundId = null, parsed = null;
    for (const id of NK.modeOrder) {
      const p = NK.modes[id].extractConfig(text);
      if (p) { foundId = id; parsed = p; break; }
    }
    if (!foundId) {
      alert('"' + name + '" n\'a pas été créé par cet éditeur (pas de configuration reconnue). Vous pouvez le supprimer ou le réorganiser depuis l\'explorateur, mais pas l\'éditer visuellement ici.');
      return;
    }

    const prevMode = getMode();
    if (prevMode && prevMode.stage && prevMode.stage.unmount) prevMode.stage.unmount();

    currentHandle = handle;
    currentName = name;
    modeId = foundId;
    config = parsed;
    activeTab = NK.modes[modeId].tabs[0].id;
    dirty = false;
    $("#currentFile").textContent = name;
    $("#stageEmpty").style.display = "none";
    updateSaveStatus();
    saveSession();
    refreshFileList();
    rebuildTabsUi(NK.modes[modeId]);
    if (NK.modes[modeId].stage && NK.modes[modeId].stage.mount) NK.modes[modeId].stage.mount(config);
    renderPanel();
    if (!userZoomed) zoomFit();
  }

  function showNewFileModal() {
    return new Promise((resolve) => {
      const overlay = document.createElement("div");
      overlay.style.cssText = "position:absolute;inset:0;background:rgba(5,9,18,0.92);z-index:200;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:14px;";
      const title = document.createElement("div");
      title.style.cssText = "font-size:13px;color:#c8920a;";
      title.textContent = "Quel type de fichier voulez-vous créer ?";
      overlay.appendChild(title);
      const row = document.createElement("div");
      row.style.cssText = "display:flex;gap:12px;";
      NK.modeOrder.forEach((id) => {
        const mode = NK.modes[id];
        const btn = document.createElement("button");
        btn.className = "btn btn-main";
        btn.style.cssText = "width:auto;padding:14px 22px;font-size:13px;";
        btn.textContent = mode.label;
        btn.onclick = () => { overlay.remove(); resolve(id); };
        row.appendChild(btn);
      });
      overlay.appendChild(row);
      const cancel = document.createElement("button");
      cancel.className = "close";
      cancel.style.cssText = "background:rgba(200,40,40,0.2);border:1px solid rgba(200,40,40,0.5);color:#e07070;padding:6px 14px;border-radius:3px;cursor:pointer;";
      cancel.textContent = "Annuler";
      cancel.onclick = () => { overlay.remove(); resolve(null); };
      overlay.appendChild(cancel);
      stageOuter.appendChild(overlay);
    });
  }

  $("#btnNewFileExp").onclick = async () => {
    const chosenId = await showNewFileModal();
    if (!chosenId) return;
    if (dirty) await saveFile(true);
    const defaultName = chosenId === "background" ? "Nouveau Fond.html" : "Nouveau Chat.html";
    const name = prompt("Nom du nouveau fichier (ex: " + defaultName + ") :", defaultName);
    if (!name) return;
    const fileName = /\.(html|htm)$/i.test(name) ? name : name + ".html";
    let handle;
    try { handle = await currentDir().getFileHandle(fileName, { create: true }); }
    catch (e) { alert("Impossible de créer ce fichier : " + e.message); return; }

    const prevMode = getMode();
    if (prevMode && prevMode.stage && prevMode.stage.unmount) prevMode.stage.unmount();

    currentHandle = handle;
    currentName = fileName;
    modeId = chosenId;
    config = NK.modes[modeId].defaultConfig();
    activeTab = NK.modes[modeId].tabs[0].id;
    dirty = true;
    $("#currentFile").textContent = fileName;
    $("#stageEmpty").style.display = "none";
    updateSaveStatus();
    rebuildTabsUi(NK.modes[modeId]);
    if (NK.modes[modeId].stage && NK.modes[modeId].stage.mount) NK.modes[modeId].stage.mount(config);
    await saveFile();
    saveSession();
    refreshFileList();
    renderPanel();
  };

  async function saveFile(isAuto) {
    if (!currentHandle || !modeId) return;
    clearTimeout(saveTimer);
    try {
      const html = NK.modes[modeId].buildExportHtml(config);
      const writable = await currentHandle.createWritable();
      await writable.write(html);
      await writable.close();
      dirty = false;
      updateSaveStatus(isAuto ? "✓ sauvegardé automatiquement" : "✓ sauvegardé");
    } catch (e) {
      updateSaveStatus("⚠ échec de la sauvegarde : " + e.message);
    }
  }
  window.addEventListener("visibilitychange", () => { if (document.visibilityState === "hidden" && dirty) saveFile(true); });
  window.addEventListener("beforeunload", (e) => { if (dirty) { saveFile(true); e.preventDefault(); e.returnValue = ""; } });

  // ── Menu contextuel générique ──
  const ctxMenuEl = $("#ctxMenu");
  function showCtxMenu(x, y, items) {
    ctxMenuEl.innerHTML = "";
    items.forEach((it) => {
      const div = document.createElement("div");
      div.className = "mi" + (it.disabled ? " disabled" : "");
      div.textContent = it.label;
      if (!it.disabled) div.onclick = () => { hideCtxMenu(); it.onClick(); };
      ctxMenuEl.appendChild(div);
    });
    ctxMenuEl.style.left = x + "px";
    ctxMenuEl.style.top = y + "px";
    ctxMenuEl.style.display = "block";
  }
  function hideCtxMenu() { ctxMenuEl.style.display = "none"; }
  window.addEventListener("click", hideCtxMenu);
  window.addEventListener("keydown", (e) => { if (e.key === "Escape") hideCtxMenu(); });

  function startDrag(e, onMove) {
    e.preventDefault(); e.stopPropagation();
    const rect = stageInner.getBoundingClientRect();
    const step = (ev) => {
      const fx = Math.min(1, Math.max(0, (ev.clientX - rect.left) / rect.width));
      const fy = Math.min(1, Math.max(0, (ev.clientY - rect.top) / rect.height));
      onMove(fx, fy);
    };
    const stop = () => { window.removeEventListener("mousemove", step); window.removeEventListener("mouseup", stop); };
    window.addEventListener("mousemove", step);
    window.addEventListener("mouseup", stop);
  }

  // ═══════════════════════════════════════════════════════════════════════
  // WIDGETS DE PANNEAU GÉNÉRIQUES (réutilisés par tous les modes)
  // ═══════════════════════════════════════════════════════════════════════
  function toggleSwitch(kind, key, label, checked) {
    return '<div class="toggle-sw' + (checked ? " on" : "") + '" data-tkind="' + kind + '" data-tkey="' + key + '"><div class="track"><div class="knob"></div></div><span>' + label + "</span></div>";
  }
  function rgbToHex(rgb) {
    const parts = rgb.split(",").map((n) => parseInt(n.trim(), 10));
    const h = (n) => n.toString(16).padStart(2, "0");
    return "#" + h(parts[0]) + h(parts[1]) + h(parts[2]);
  }
  function hexToRgb(hex) {
    const n = parseInt(hex.replace("#", ""), 16);
    return ((n >> 16) & 255) + "," + ((n >> 8) & 255) + "," + (n & 255);
  }
  function field(def, value, attr) {
    return '<div class="field"><label>' + def.label + " : " + value + "</label>"
      + '<input type="range" min="' + def.min + '" max="' + def.max + '" step="' + def.step + '" value="' + value + '" data-' + attr + '="' + def.key + '"></div>';
  }

  // ── Démarrage ──
  $("#explorerToggle").onclick = () => { const c = $("#explorer").classList.toggle("collapsed"); $("#explorerToggle").textContent = c ? "▸" : "◂"; };
  $("#panelToggle").onclick = () => { const c = $("#panel").classList.toggle("collapsed"); $("#panelToggle").textContent = c ? "◂" : "▸"; };
  $("#panel").classList.add("collapsed");
  zoomFit();
  trySilentResume();

  return {
    $, stageOuter, stageInner, fxCanvas,
    registerMode,
    getModeId, getMode, getConfig, getActiveTab, isDirty,
    markDirty, scheduleAutoSave, updateSaveStatus,
    currentDir, depthFromRoot, getRootHandle: () => rootHandle,
    openFile, saveFile, closeCurrentFile, renderPanel, setActiveTab,
    startDrag, showCtxMenu, hideCtxMenu,
    toggleSwitch, rgbToHex, hexToRgb, field,
  };
})();
