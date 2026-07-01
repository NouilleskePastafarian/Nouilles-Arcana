// ═══════════════════════════════════════════════════════════════════════
// Traduction EventSub → format legacy Streamer.bot.
//
// Couche de compatibilité centrale : reproduit EXACTEMENT les noms de
// champs déjà lus par Alertes.dc.html (lignes ~244-266) et
// Barre Widgets.dc.html (lignes ~291-358), afin que ces deux fichiers
// n'aient besoin d'AUCUNE modification.
//
// Limitation permanente : Twitch a supprimé la fonctionnalité "Hosting"
// en 2022 — il n'existe aucun type EventSub équivalent à channel.host.
// Le type d'alerte 'Host' déjà câblé côté overlay ne peut donc plus être
// déclenché par de vraies données Twitch ; ce fichier n'émet jamais ce
// type, volontairement (pas un oubli).
// ═══════════════════════════════════════════════════════════════════════

function legacy(type, data) {
  return { event: { type, source: 'Twitch' }, data };
}

// Regroupement des dons multiples (GiftBomb) — Twitch envoie N
// notifications channel.subscription.gift individuelles avec un champ
// `total` sur celle qui déclenche la rafale, pas un événement unique.
const GIFT_BURST_WINDOW_MS = 2000;
const _giftBursts = new Map(); // gifter login -> { timer, count, total, resub }

function handleGift(ev, emit) {
  const gifter = ev.is_anonymous ? 'Anonymous' : (ev.user_name || 'Anonymous');
  const total = ev.total || 1;

  if (total <= 1) {
    emit(legacy('GiftSub', {
      user_name: gifter,
      recipient_user_name: ev.recipient_user_name || '',
    }));
    return;
  }

  // Rafale : on regroupe tous les gifts du même gifter vus dans la fenêtre,
  // puis on émet un seul GiftBomb à l'expiration du timer.
  let burst = _giftBursts.get(gifter);
  if (!burst) {
    burst = { count: 0, total };
    _giftBursts.set(gifter, burst);
    burst.timer = setTimeout(() => {
      _giftBursts.delete(gifter);
      // event.type doit être exactement 'GiftBomb' — voir Alertes.dc.html
      // switch-case (~L253): case 'GiftBomb': trigger('subgiftbomb', {..., amount: d.total || d.amount || 1})
      emit(legacy('GiftBomb', { user_name: gifter, total: burst.total }));
    }, GIFT_BURST_WINDOW_MS);
  }
  burst.count++;
}

function translate(subType, ev, emit) {
  switch (subType) {
    case 'channel.follow':
      emit(legacy('Follow', { user_name: ev.user_name }));
      return;

    case 'channel.subscribe':
      if (ev.is_gift) return; // arrive via channel.subscription.gift à la place
      emit(legacy('Sub', { user_name: ev.user_name, cumulative_months: 1 }));
      return;

    case 'channel.subscription.message':
      emit(legacy('ReSub', {
        user_name: ev.user_name,
        cumulative_months: ev.cumulative_months || (ev.message && ev.message.cumulative_months) || 1,
        message: (ev.message && ev.message.text) || '',
      }));
      return;

    case 'channel.subscription.gift':
      handleGift(ev, emit);
      return;

    case 'channel.cheer':
      emit(legacy('Cheer', {
        user_name: ev.is_anonymous ? 'Anonymous' : ev.user_name,
        bits: ev.bits || 0,
        message: ev.message || '',
      }));
      return;

    case 'channel.raid':
      emit(legacy('Raid', {
        from_broadcaster_user_name: ev.from_broadcaster_user_name,
        viewers: ev.viewers || 0,
      }));
      return;

    case 'channel.channel_points_custom_reward_redemption.add':
      emit(legacy('ChannelPointsRedemption', {
        user_name: ev.user_name,
        reward: { title: (ev.reward && ev.reward.title) || '' },
      }));
      return;

    case 'channel.hype_train.begin':
      emit(legacy('HypeTrainStart', { level: ev.level || 1 }));
      return;

    case 'channel.hype_train.progress':
      emit(legacy('HypeTrainLevelUp', { level: ev.level || 1 }));
      return;

    default:
      return; // type non mappé, ignoré silencieusement
  }
}

module.exports = { translate, legacy };
