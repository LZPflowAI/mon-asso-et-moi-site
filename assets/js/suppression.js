// Suppression du compte depuis le site (exigence de Google Play), comme
// la pop-up de l'app (lib/features/profile/presentation/delete_account_dialog.dart) :
// 1. code à 6 chiffres par e-mail (connexion sans mot de passe, sans créer
//    de compte) ;
// 2. account_deletion_info : associations dont la personne est l'admin
//    créateur, et admins invités qui peuvent les reprendre ;
// 3. delete_my_account(p_successeurs) : la base vérifie elle-même que le code
//    a été validé il y a moins de 10 minutes.
// La connexion reste en mémoire (persistSession: false) : rien n'est gardé
// dans le navigateur.
(function () {
  'use strict';

  var config = window.MON_ASSO_CONFIG || {};
  var $ = function (id) { return document.getElementById(id); };

  var steps = ['step-email', 'step-code', 'step-confirm', 'step-done'];
  function show(step) {
    steps.forEach(function (id) { $(id).hidden = id !== step; });
    var first = $(step).querySelector('input, button');
    if (first) first.focus();
  }

  function setError(id, message) {
    var el = $(id);
    el.textContent = message || '';
    el.hidden = !message;
  }

  function busy(button, isBusy, label) {
    button.disabled = isBusy;
    if (label) button.textContent = label;
  }

  // Message lisible : les erreurs des fonctions SQL sont déjà en français.
  function message(error) {
    if (!error) return 'Une erreur est survenue. Réessayez.';
    if (error.status === 429) return 'Trop de tentatives. Patientez quelques minutes avant de réessayer.';
    if (error.message && /fetch|network/i.test(error.message)) {
      return 'Connexion impossible. Vérifiez votre connexion internet.';
    }
    return error.message || 'Une erreur est survenue. Réessayez.';
  }

  if (!window.supabase || !config.supabaseUrl || !config.supabaseAnonKey) {
    setError('email-error', 'Le service est indisponible pour le moment. Écrivez-nous à contact@mon-asso-et-moi.fr.');
    $('email-submit').disabled = true;
    return;
  }

  var client = window.supabase.createClient(config.supabaseUrl, config.supabaseAnonKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });

  var email = '';
  var associations = [];

  // Étape 1 : envoyer le code.
  $('step-email').addEventListener('submit', async function (event) {
    event.preventDefault();
    setError('email-error');
    email = $('email').value.trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      setError('email-error', 'Saisissez une adresse e-mail valide.');
      return;
    }
    busy($('email-submit'), true, 'Envoi…');
    var result = await client.auth.signInWithOtp({ email: email, options: { shouldCreateUser: false } });
    busy($('email-submit'), false, 'Envoyer le code');
    // Adresse inconnue : même écran que si le compte existe (on ne révèle
    // pas quelles adresses ont un compte).
    var unknown = result.error && result.error.status !== 429 &&
      /signup|not found|not allowed/i.test(result.error.message || '');
    if (result.error && !unknown) {
      setError('email-error', message(result.error));
      return;
    }
    $('code-email').textContent = email;
    $('code').value = '';
    setError('code-error');
    show('step-code');
  });

  $('code-back').addEventListener('click', function () { show('step-email'); });

  // Étape 2 : vérifier le code, puis lire les associations à transmettre.
  $('step-code').addEventListener('submit', async function (event) {
    event.preventDefault();
    setError('code-error');
    var code = $('code').value.replace(/\D/g, '');
    if (code.length !== 6) {
      setError('code-error', 'Le code contient 6 chiffres.');
      return;
    }
    busy($('code-submit'), true, 'Vérification…');
    var verified = await client.auth.verifyOtp({ email: email, token: code, type: 'email' });
    if (verified.error) {
      busy($('code-submit'), false, 'Vérifier le code');
      setError('code-error', verified.error.status === 429 ? message(verified.error) : 'Code incorrect ou expiré.');
      return;
    }
    var info = await client.rpc('account_deletion_info');
    busy($('code-submit'), false, 'Vérifier le code');
    if (info.error) {
      setError('code-error', message(info.error));
      return;
    }
    associations = info.data || [];
    renderConfirm();
    show('step-confirm');
  });

  function renderConfirm() {
    var container = $('successors');
    container.textContent = '';
    var blocked = associations.find(function (a) { return !a.admins || a.admins.length === 0; });
    $('handover').hidden = associations.length === 0 || !!blocked;
    $('blocked').hidden = !blocked;
    if (blocked) {
      $('blocked').textContent = 'Vous êtes l’admin créateur de « ' + blocked.structure_nom +
        ' » et aucun autre admin avec un compte ne peut la reprendre. Dans l’app, nommez d’abord un admin, ' +
        'ou supprimez l’association (Paramètres > Sécurité).';
    } else {
      associations.forEach(function (a) {
        var label = document.createElement('label');
        label.htmlFor = 'successor-' + a.structure_id;
        label.textContent = 'Admin qui reprend « ' + a.structure_nom + ' »';
        var select = document.createElement('select');
        select.id = 'successor-' + a.structure_id;
        select.dataset.structure = a.structure_id;
        var placeholder = new Option('Choisir un admin', '');
        placeholder.disabled = true;
        placeholder.selected = true;
        select.add(placeholder);
        a.admins.forEach(function (admin) {
          select.add(new Option([admin.prenom, admin.nom].filter(Boolean).join(' '), admin.id));
        });
        select.addEventListener('change', updateSubmit);
        container.append(label, select);
      });
    }
    $('understand').checked = false;
    $('understand').disabled = !!blocked;
    setError('confirm-error');
    updateSubmit();
  }

  function successors() {
    var map = {};
    document.querySelectorAll('#successors select').forEach(function (select) {
      map[select.dataset.structure] = select.value;
    });
    return map;
  }

  function updateSubmit() {
    var all = Object.values(successors()).every(Boolean);
    $('confirm-submit').disabled = !$('understand').checked || !all || !$('blocked').hidden;
  }

  $('understand').addEventListener('change', updateSubmit);

  $('confirm-cancel').addEventListener('click', async function () {
    await client.auth.signOut({ scope: 'local' });
    $('email').value = '';
    show('step-email');
  });

  // Étape 3 : supprimer.
  $('step-confirm').addEventListener('submit', async function (event) {
    event.preventDefault();
    setError('confirm-error');
    busy($('confirm-submit'), true, 'Suppression…');
    var result = await client.rpc('delete_my_account', { p_successeurs: successors() });
    if (result.error) {
      busy($('confirm-submit'), false, 'Supprimer définitivement');
      updateSubmit();
      setError('confirm-error', message(result.error));
      return;
    }
    await client.auth.signOut({ scope: 'local' });
    show('step-done');
  });
})();
