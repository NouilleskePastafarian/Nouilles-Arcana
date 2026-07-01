-- ═══════════════════════════════════════════════════════════════════════
-- nk-relay.lua — lance/arrête automatiquement le relais Twitch local
-- (server/dist/nk-relay.exe) avec OBS, pour un vrai plug-and-play.
--
-- Installation :
--   1. Compilez le relais une fois : Nouilles-Arcana/server/build.bat
--   2. OBS -> Outils -> Scripts -> "+" -> sélectionnez ce fichier
--   3. Dans les propriétés du script, choisissez le dossier de PROJET
--      (celui qui contient config.json — PAS le dossier Nouilles-Arcana),
--      typiquement le dossier parent de Nouilles-Arcana.
-- ═══════════════════════════════════════════════════════════════════════
local obs = obslua

local project_dir = ""
local RELAY_SUFFIX  = "\\Nouilles-Arcana\\server\\dist\\nk-relay.exe"
local CONFIG_SUFFIX = "\\config.json"
local EXE_NAME = "nk-relay.exe"
local VBS_NAME = "run-hidden.vbs"

local function relay_exe_path() return project_dir .. RELAY_SUFFIX end
local function config_path() return project_dir .. CONFIG_SUFFIX end
local function vbs_path() return script_path() .. VBS_NAME end

local function file_exists(path)
  local f = io.open(path, "r")
  if f then f:close(); return true end
  return false
end

local function stop_relay()
  os.execute('taskkill /F /IM ' .. EXE_NAME .. ' /T >nul 2>&1')
end

local function start_relay()
  if project_dir == "" then
    obs.script_log(obs.LOG_WARNING, "[nk-relay] Aucun dossier de projet configure -- ouvrez les proprietes du script.")
    return
  end
  if not file_exists(relay_exe_path()) then
    obs.script_log(obs.LOG_WARNING, "[nk-relay] Executable introuvable : " .. relay_exe_path() ..
      " -- avez-vous lance server/build.bat ?")
    return
  end
  if not file_exists(config_path()) then
    obs.script_log(obs.LOG_WARNING, "[nk-relay] config.json introuvable dans le dossier de projet -- " ..
      "connectez-vous d'abord via le panneau Twitch de l'editeur.")
    return
  end

  if not file_exists(vbs_path()) then
    obs.script_log(obs.LOG_WARNING, "[nk-relay] Lanceur introuvable : " .. vbs_path())
    return
  end

  -- Idempotent : on tue toute instance residuelle avant de relancer.
  stop_relay()
  -- Passe par un lanceur VBScript (fenêtre style 0 = totalement invisible,
  -- pas d'entrée dans la barre des tâches) plutôt que "start /min" qui
  -- laisse une icône réduite visible.
  local cmd = string.format('wscript.exe //B "%s" "%s" "%s"', vbs_path(), relay_exe_path(), config_path())
  os.execute(cmd)
  obs.script_log(obs.LOG_INFO, "[nk-relay] Relais lance (sans fenetre).")
end

local function on_event(event)
  if event == obs.OBS_FRONTEND_EVENT_FINISHED_LOADING then
    start_relay()
  elseif event == obs.OBS_FRONTEND_EVENT_EXIT then
    stop_relay()
  end
end

function script_description()
  return "Lance et arrete automatiquement le relais Twitch local (nk-relay.exe) avec OBS.\n\n" ..
    "Necessite d'avoir compile le relais une fois via Nouilles-Arcana/server/build.bat, " ..
    "et d'avoir renseigne le dossier de projet ci-dessous (celui qui contient config.json)."
end

function script_properties()
  local props = obs.obs_properties_create()
  obs.obs_properties_add_path(props, "project_dir", "Dossier du projet (contient config.json)",
    obs.OBS_PATH_DIRECTORY, nil, nil)
  local btn = obs.obs_properties_add_button(props, "test_btn", "Tester la connexion", function()
    local handle = io.popen('tasklist /FI "IMAGENAME eq ' .. EXE_NAME .. '"')
    local output = handle and handle:read("*a") or ""
    if handle then handle:close() end
    if output:find(EXE_NAME, 1, true) then
      obs.script_log(obs.LOG_INFO, "[nk-relay] Le relais est actif.")
    else
      obs.script_log(obs.LOG_WARNING, "[nk-relay] Le relais n'est PAS actif.")
    end
    return true
  end)
  return props
end

function script_update(settings)
  project_dir = obs.obs_data_get_string(settings, "project_dir")
end

function script_load(settings)
  obs.obs_frontend_add_event_callback(on_event)
end

function script_unload()
  stop_relay()
end
