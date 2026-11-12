// Boutons « Télécharger » de la page de présentation : liens lus dans la
// table app_versions (lisible sans compte), la même que celle de la pop-up
// « Mise à jour disponible » de l'app. Windows : installateur publié par
// GitHub Actions ; Mac : image disque signée et validée par Apple, publiée par
// tool/publier_mac.sh (hors Mac App Store) ; Android, iPhone : lien du store,
// une fois l'app en ligne. Sans lien, le bouton reste « Bientôt disponible ».
(function () {
  'use strict';

  var config = window.MON_ASSO_CONFIG || {};
  if (!config.supabaseUrl || !config.supabaseAnonKey || !window.fetch) return;

  var labels = {
    android: 'Télécharger sur Google Play',
    ios: 'Télécharger sur l’App Store',
    macos: 'Télécharger pour Mac',
    windows: 'Télécharger pour Windows',
  };

  fetch(config.supabaseUrl + '/rest/v1/app_versions?select=platform,latest_version,download_url', {
    headers: { apikey: config.supabaseAnonKey, Authorization: 'Bearer ' + config.supabaseAnonKey },
  })
    .then(function (response) { return response.ok ? response.json() : []; })
    .then(function (rows) {
      rows.forEach(function (row) {
        var card = document.querySelector('.download[data-platform="' + row.platform + '"]');
        var url = row.download_url || '';
        if (!card || !/^https:\/\//.test(url)) return;
        var link = document.createElement('a');
        link.className = 'btn btn-gradient';
        link.href = url;
        link.rel = 'noopener';
        link.textContent = labels[row.platform] || 'Télécharger';
        var wrap = card.querySelector('.btn-wrap');
        wrap.textContent = '';
        wrap.append(link);
        if (row.platform === 'windows' && row.latest_version) {
          card.querySelector('p').textContent = 'Windows 10 et 11 · version ' + row.latest_version;
        }
        if (row.platform === 'macos' && row.latest_version) {
          card.querySelector('p').textContent = 'macOS 12 et plus récent · version ' + row.latest_version;
        }
      });
    })
    .catch(function () { /* hors ligne : les boutons restent « Bientôt disponible » */ });
})();
