// ═══════════════════════════════════════════════════════════════════════
// Logger fichier — le relais tourne headless (lancé par OBS, pas de
// console visible), donc toute erreur/info utile part dans un .log
// à côté de config.json pour rester facile à trouver.
// ═══════════════════════════════════════════════════════════════════════
const fs = require('node:fs');
const path = require('node:path');

let logPath = null;

function init(configPath) {
  logPath = path.join(path.dirname(configPath), 'nk-relay.log');
}

function line(level, msg) {
  const ts = new Date().toISOString();
  const text = `[${ts}] [${level}] ${msg}\n`;
  process.stdout.write(text);
  if (logPath) {
    try { fs.appendFileSync(logPath, text); } catch (e) { /* disque plein / verrou — tant pis */ }
  }
}

module.exports = {
  init,
  info(msg) { line('INFO', msg); },
  warn(msg) { line('WARN', msg); },
  error(msg) { line('ERROR', msg); },
};
