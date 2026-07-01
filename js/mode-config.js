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

// Scopes demandés lors de la connexion
const TWITCH_SCOPES = "bits:read channel:read:subscriptions moderator:read:followers channel:read:hype_train";

(function () {
  "use strict";

  const DEFAULT = {
    twitchChannel : "",
    twitchToken   : "",
    twitchLogin   : "",
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
      _data = { ...DEFAULT, ...JSON.parse(await file.text()) };
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
    return TWITCH_CLIENT_ID || localStorage.getItem('nk-twitch-client-id') || '';
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

    // ── Section chaîne ──────────────────────────────────────────────────
    let html = `
      <h2 style="font-size:14px;color:${gold};margin-bottom:22px;letter-spacing:0.04em;">⚙ Configuration Twitch</h2>

      <div style="margin-bottom:22px;">
        <label style="font-size:10px;text-transform:uppercase;opacity:0.6;display:block;margin-bottom:6px;">
          Votre chaîne Twitch
        </label>
        <input id="cfgChannel" type="text" value="${esc(cfg.twitchChannel)}"
          placeholder="votre_pseudo_twitch" style="${inpCss}">
        <div style="font-size:10px;opacity:0.45;margin-top:5px;line-height:1.5;">
          ✓ C'est <strong>tout ce qu'il faut</strong> pour l'overlay chat — aucune connexion requise.
        </div>
      </div>

      <hr style="border:none;border-top:1px solid rgba(200,146,10,0.15);margin:0 0 22px;">
      <label style="font-size:10px;text-transform:uppercase;opacity:0.6;display:block;margin-bottom:16px;">
        Connexion Twitch <span style="opacity:0.4;text-transform:none;font-size:10px;">(alertes, abonnements, follows…)</span>
      </label>

      <div style="margin-bottom:16px;">
        <label style="font-size:10px;opacity:0.6;display:block;margin-bottom:6px;">
          URL de callback OAuth
          <a href="https://dev.twitch.tv/console/apps/create" target="_blank"
            style="color:#bf9fff;text-decoration:none;margin-left:8px;font-size:10px;opacity:0.8;">
            → Créer l'app sur dev.twitch.tv
          </a>
        </label>
        <div style="display:flex;gap:6px;align-items:stretch;">
          <div id="cfgCallbackUrl"
            style="background:#0a1322;border:1px solid ${goldBd};border-radius:3px;
            padding:7px 9px;font-size:10px;font-family:monospace;word-break:break-all;
            color:#f0e0b0;flex:1;line-height:1.5;">
            ${esc(callbackUrl)}
          </div>
          <button id="cfgCopyCallback" style="${btnPurple}">📋 Copier</button>
        </div>
        <div style="font-size:10px;opacity:0.4;margin-top:5px;line-height:1.5;">
          Copiez cette URL et collez-la dans le champ "URL de redirection OAuth" lors de la création de l'app · Catégorie : <em>Application Integration</em>
        </div>
      </div>

      <div style="margin-bottom:22px;">
        <label style="font-size:10px;opacity:0.6;display:block;margin-bottom:6px;">
          Client ID Twitch <span style="opacity:0.6;">(affiché après création de l'app)</span>
        </label>
        <input id="cfgClientId" type="text"
          value="${esc(TWITCH_CLIENT_ID || localStorage.getItem('nk-twitch-client-id') || '')}"
          placeholder="ex: a1b2c3d4e5f6789abcdef0123456789"
          ${TWITCH_CLIENT_ID ? 'disabled title="Client ID intégré dans le code source"' : ''}
          style="${inpCss}${TWITCH_CLIENT_ID ? 'opacity:0.55;cursor:not-allowed;' : ''}">
      </div>
    `;

    // ── État de connexion ──────────────────────────────────────────────
    if (connected) {
      html += `
        <div style="background:rgba(143,208,128,0.07);border:1px solid rgba(143,208,128,0.28);
          border-radius:6px;padding:14px 16px;margin-bottom:12px;">
          <div style="color:#8fd080;font-size:13px;font-weight:bold;margin-bottom:4px;">
            ✓ Connecté en tant que ${esc(cfg.twitchLogin)}
          </div>
          <div style="font-size:11px;opacity:0.55;">Token valide · les alertes peuvent utiliser cette connexion.</div>
        </div>
        <button id="cfgDisconnect"
          style="background:rgba(200,40,40,0.1);border:1px solid rgba(200,40,40,0.35);
          color:#e07070;border-radius:3px;padding:7px 14px;cursor:pointer;font-size:11px;margin-bottom:16px;">
          Déconnecter
        </button>
      `;
    } else if (hasClientId) {
      html += `
        <div style="font-size:11px;opacity:0.6;margin-bottom:12px;line-height:1.6;">
          Cliquez ci-dessous pour autoriser l'accès à votre chaîne.
          Une fenêtre Twitch s'ouvre, vous cliquez "Autoriser" — c'est tout.
        </div>
        <button id="cfgOAuth"
          style="width:100%;background:rgba(145,70,255,0.18);border:1px solid rgba(145,70,255,0.5);
          color:#bf9fff;border-radius:5px;padding:12px;font-size:13px;cursor:pointer;
          font-family:'Segoe UI',sans-serif;margin-bottom:6px;">
          🟣 &nbsp; Se connecter avec Twitch
        </button>
        <div id="cfgOAuthStatus" style="font-size:11px;min-height:20px;margin-bottom:8px;line-height:1.5;"></div>
      `;
    } else {
      html += `
        <div style="font-size:11px;opacity:0.4;margin-bottom:16px;line-height:1.6;font-style:italic;">
          Entrez votre Client ID ci-dessus puis cliquez Enregistrer pour activer la connexion Twitch.
        </div>
      `;
    }

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
        // Persiste le Client ID dans localStorage si le constant est vide
        if (!TWITCH_CLIENT_ID) {
          const cid = (document.getElementById("cfgClientId") || {}).value || "";
          if (cid.trim()) localStorage.setItem('nk-twitch-client-id', cid.trim());
          else localStorage.removeItem('nk-twitch-client-id');
        }
        await NK.config.save({
          twitchChannel: document.getElementById("cfgChannel").value.trim(),
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
  }

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
