// ═══════════════════════════════════════════════════════════════════════
// Lecture/validation de config.json — le fichier privé du projet
// (jamais colocalisé avec le binaire, toujours passé via --config).
// ═══════════════════════════════════════════════════════════════════════
const fs = require('node:fs');

function loadConfig(filePath) {
  let raw;
  try {
    raw = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch (e) {
    throw new Error(`Impossible de lire ${filePath} : ${e.message}`);
  }

  const required = ['twitchChannel', 'twitchToken', 'twitchLogin', 'twitchClientId'];
  const missing = required.filter((k) => !raw[k]);
  if (missing.length) {
    throw new Error(
      'config.json incomplet : ' + missing.join(', ') +
      ' — ouvrez l\'éditeur, panneau Twitch, connectez-vous et enregistrez d\'abord.'
    );
  }

  // twitchToken est stocké au format "oauth:XXXX" (compat IRC chat) ;
  // Helix/EventSub veulent le token nu dans l'en-tête Authorization.
  const bearerToken = raw.twitchToken.replace(/^oauth:/, '');

  return Object.assign({}, raw, { bearerToken, path: filePath });
}

module.exports = { loadConfig };
