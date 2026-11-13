// Abonnement de l'association depuis le site (étape 19f), comme l'onglet
// « Abonnement » de l'app Windows et Mac
// (lib/features/subscription/presentation/subscription_view.dart) :
// 1. code à 6 chiffres par e-mail (connexion sans mot de passe, sans créer
//    de compte) ;
// 2. associations dont la personne est admin (users_to_structure) ;
// 3. subscription_details et factures (lus par la base, admins seulement),
//    paiement et gestion par l'Edge Function `abonnement` (Stripe).
// La connexion est gardée dans le sessionStorage de l'onglet, pour la
// retrouver au retour de la page de Stripe ; elle est oubliée quand l'onglet
// se ferme ou avec « Se déconnecter ». Aucun cookie.
(function () {
  'use strict';

  var config = window.MON_ASSO_CONFIG || {};
  var $ = function (id) { return document.getElementById(id); };
  var STRUCTURE_KEY = 'mon-asso-abonnement-structure';

  // ------------------------------------------------------------- Affichage
  var steps = ['step-email', 'step-code', 'step-loading', 'step-none', 'step-subscription'];
  function show(step) {
    steps.forEach(function (id) { $(id).hidden = id !== step; });
    var first = $(step).querySelector('input, select');
    if (first && step !== 'step-subscription') first.focus();
  }

  function setError(id, message) {
    var el = $(id);
    el.textContent = message || '';
    el.hidden = !message;
  }

  function setMessage(message) {
    $('status-message').textContent = message || '';
    $('status-message').hidden = !message;
  }

  var busyCount = 0;
  function setBusy(isBusy) {
    busyCount += isBusy ? 1 : -1;
    document.querySelectorAll('#step-subscription button, #structure').forEach(function (el) {
      el.disabled = busyCount > 0;
    });
  }

  function message(error) {
    if (!error) return 'Une erreur est survenue. Réessayez.';
    if (error.status === 429) return 'Trop de tentatives. Patientez quelques minutes avant de réessayer.';
    if (error.message && /fetch|network/i.test(error.message)) {
      return 'Connexion impossible. Vérifiez votre connexion internet.';
    }
    return error.message || 'Une erreur est survenue. Réessayez.';
  }

  var dateFormat = new Intl.DateTimeFormat('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' });
  function date(value) { return value ? dateFormat.format(new Date(value)) : ''; }

  function euros(cents) {
    return new Intl.NumberFormat('fr-FR', {
      style: 'currency', currency: 'EUR', minimumFractionDigits: cents % 100 ? 2 : 0,
    }).format(cents / 100);
  }

  // Même calcul que SubscriptionPlan.priceCents dans l'app.
  function priceCents(plan, tranches) {
    return plan === 'annuel' ? 27500 + 12000 * tranches : 2500 + 1000 * tranches;
  }

  var planLabels = { mensuel: 'Mensuelle', annuel: 'Annuelle' };
  var states = {
    offert: ['Offerte', 'state-success'],
    actif: ['Actif', 'state-success'],
    essai: ['Essai gratuit', 'state-info'],
    delai: ['À régler', 'state-warning'],
    lecture_seule: ['Lecture seule', 'state-danger'],
  };
  var invoiceStates = {
    paid: ['Payée', 'state-success'],
    void: ['Annulée', 'state-muted'],
    uncollectible: ['Impayée', 'state-danger'],
  };

  function badge(el, entry) {
    el.textContent = entry[0];
    el.className = 'state ' + entry[1];
  }

  // ------------------------------------------------------------- Connexion
  if (!window.supabase || !config.supabaseUrl || !config.supabaseAnonKey) {
    setError('email-error', 'Le service est indisponible pour le moment. Écrivez-nous à contact@mon-asso-et-moi.fr.');
    $('email-submit').disabled = true;
    return;
  }

  var storage = null;
  try {
    window.sessionStorage.setItem('mon-asso-test', '1');
    window.sessionStorage.removeItem('mon-asso-test');
    storage = window.sessionStorage;
  } catch (e) {
    storage = null; // navigation privée stricte : connexion en mémoire seulement
  }
  function remember(key, value) {
    try {
      if (!storage) return;
      if (value) storage.setItem(key, value); else storage.removeItem(key);
    } catch (e) { /* rien */ }
  }
  function recall(key) {
    try { return storage ? storage.getItem(key) : null; } catch (e) { return null; }
  }

  var client = window.supabase.createClient(config.supabaseUrl, config.supabaseAnonKey, {
    auth: {
      persistSession: !!storage,
      storage: storage || undefined,
      storageKey: 'mon-asso-abonnement',
      autoRefreshToken: true,
      detectSessionInUrl: false,
    },
  });

  // Retour de Stripe (?paiement=ok ou annule) : message, puis adresse nettoyée.
  var params = new URLSearchParams(window.location.search);
  var back = params.get('paiement');
  $('back-ok').hidden = back !== 'ok';
  $('back-cancel').hidden = back !== 'annule';
  if (back && window.history.replaceState) {
    window.history.replaceState(null, '', window.location.pathname);
  }

  var email = '';

  $('step-email').addEventListener('submit', async function (event) {
    event.preventDefault();
    setError('email-error');
    email = $('email').value.trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      setError('email-error', 'Saisissez une adresse e-mail valide.');
      return;
    }
    $('email-submit').disabled = true;
    $('email-submit').textContent = 'Envoi…';
    var result = await client.auth.signInWithOtp({ email: email, options: { shouldCreateUser: false } });
    $('email-submit').disabled = false;
    $('email-submit').textContent = 'Envoyer le code';
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

  $('step-code').addEventListener('submit', async function (event) {
    event.preventDefault();
    setError('code-error');
    var code = $('code').value.replace(/\D/g, '');
    if (code.length !== 6) {
      setError('code-error', 'Le code contient 6 chiffres.');
      return;
    }
    $('code-submit').disabled = true;
    $('code-submit').textContent = 'Vérification…';
    var verified = await client.auth.verifyOtp({ email: email, token: code, type: 'email' });
    $('code-submit').disabled = false;
    $('code-submit').textContent = 'Se connecter';
    if (verified.error) {
      setError('code-error', verified.error.status === 429 ? message(verified.error) : 'Code incorrect ou expiré.');
      return;
    }
    loadStructures(verified.data.user);
  });

  document.querySelectorAll('[data-logout]').forEach(function (button) {
    button.addEventListener('click', async function () {
      await client.auth.signOut({ scope: 'local' });
      remember(STRUCTURE_KEY, null);
      $('email').value = '';
      $('back-ok').hidden = true;
      $('back-cancel').hidden = true;
      show('step-email');
    });
  });

  // ------------------------------------------------------------- Associations
  var structures = [];
  var current = null; // { id, nom }
  var details = null;

  async function loadStructures(user) {
    show('step-loading');
    $('account-email').textContent = user.email || '';
    var profile = await client.from('users').select('id').eq('auth_user_id', user.id).maybeSingle();
    if (profile.error || !profile.data) {
      show('step-email');
      setError('email-error', message(profile.error));
      return;
    }
    var rows = await client
      .from('users_to_structure')
      .select('is_admin_createur, is_admin_invite, structure:structures(id, nom)')
      .eq('user_id', profile.data.id)
      .order('created_at');
    if (rows.error) {
      show('step-email');
      setError('email-error', message(rows.error));
      return;
    }
    structures = (rows.data || [])
      .filter(function (r) { return (r.is_admin_createur || r.is_admin_invite) && r.structure; })
      .map(function (r) { return r.structure; });
    if (structures.length === 0) {
      show('step-none');
      return;
    }
    var select = $('structure');
    select.textContent = '';
    structures.forEach(function (s) { select.add(new Option(s.nom, s.id)); });
    var saved = recall(STRUCTURE_KEY);
    current = structures.find(function (s) { return s.id === saved; }) || structures[0];
    select.value = current.id;
    $('structure-picker').hidden = structures.length < 2;
    show('step-subscription');
    // Retour de la page de paiement : l'abonnement est relu chez Stripe sans
    // attendre sa notification.
    await loadSubscription(back === 'ok');
  }

  $('structure').addEventListener('change', function () {
    current = structures.find(function (s) { return s.id === $('structure').value; }) || structures[0];
    remember(STRUCTURE_KEY, current.id);
    setMessage();
    loadSubscription(false);
  });

  // ------------------------------------------------------------- Abonnement
  async function invoke(body) {
    body.structure_id = current.id;
    var result = await client.functions.invoke('abonnement', { body: body });
    if (result.error) {
      var text = null;
      try {
        var payload = await result.error.context.json();
        text = payload && payload.error;
      } catch (e) { /* réponse sans JSON */ }
      throw new Error(text || message(result.error));
    }
    return result.data || {};
  }

  async function loadSubscription(sync) {
    setError('subscription-error');
    setBusy(true);
    try {
      if (sync) await invoke({ action: 'sync' });
      var rows = await client.rpc('subscription_details', { p_structure: current.id });
      if (rows.error) throw rows.error;
      details = (rows.data || [])[0] || null;
      var invoices = null;
      if (details && !details.offert) {
        var list = await client
          .from('factures')
          .select('id, numero, emise_le, montant_centimes, statut, pdf_url, page_url')
          .eq('structure_id', current.id)
          .order('emise_le', { ascending: false });
        if (list.error) throw list.error;
        invoices = list.data || [];
      }
      render(invoices);
    } catch (error) {
      setError('subscription-error', message(error));
    } finally {
      setBusy(false);
    }
  }

  function subscribed(d) {
    return ['active', 'trialing', 'past_due', 'unpaid'].indexOf(d.stripe_statut) >= 0;
  }

  function row(label, value, danger) {
    var dt = document.createElement('dt');
    dt.textContent = label;
    var dd = document.createElement('dd');
    dd.textContent = value;
    if (danger) dd.className = 'danger';
    $('status-rows').append(dt, dd);
  }

  function plural(count, zero, one, many) {
    return count === 0 ? zero : count === 1 ? one : many.replace('{n}', count);
  }

  function render(invoices) {
    var d = details;
    $('status-title').textContent = current.nom;
    $('status-rows').textContent = '';
    if (!d) {
      $('status-badge').hidden = true;
      $('subscribe').hidden = true;
      $('manage').hidden = true;
      $('invoices-card').hidden = true;
      return;
    }
    $('status-badge').hidden = false;
    badge($('status-badge'), states[d.etat] || states.actif);
    $('status-offert').hidden = !d.offert;
    var isSubscribed = subscribed(d);
    var unpaid = d.stripe_statut === 'past_due' || d.stripe_statut === 'unpaid';
    $('status-unpaid').hidden = d.offert || !unpaid;
    $('status-readonly').hidden = d.etat !== 'lecture_seule';

    if (!d.offert) {
      row('Formule', isSubscribed && d.formule ? planLabels[d.formule] : 'Aucune');
      if (d.etat === 'essai' && d.essai_fin) row('Fin de l’essai', date(d.essai_fin));
      if (isSubscribed && d.periode_fin) {
        row(d.resiliation_demandee ? 'Se termine le' : 'Prochain renouvellement', date(d.periode_fin));
      }
      if (isSubscribed && d.formule_prochaine && d.periode_fin) {
        row('Changement prévu', planLabels[d.formule_prochaine] + ' à partir du ' + date(d.periode_fin));
      }
      if (d.lecture_seule_le && (d.etat === 'delai' || d.etat === 'lecture_seule')) {
        row('Lecture seule à partir du', date(d.lecture_seule_le), true);
      }
      row('Adhérents comptés', plural(d.adherents, 'Aucun adhérent', '1 adhérent', '{n} adhérents'));
      var tranches = isSubscribed ? d.tranches : d.tranches_requises;
      row('Tranches de 100 adhérents', plural(tranches, 'Aucune (jusqu’à 309 adhérents)', '1 tranche', '{n} tranches'));
    }

    $('subscribe').hidden = d.offert || isSubscribed;
    $('manage').hidden = d.offert || !isSubscribed;
    if (!d.offert && !isSubscribed) renderSubscribe(d);
    if (!d.offert && isSubscribed) renderManage(d);
    renderInvoices(invoices);
  }

  function renderSubscribe(d) {
    var t = d.tranches_requises || 0;
    $('price-mensuel').textContent = euros(priceCents('mensuel', t)) + ' par mois';
    $('price-annuel').textContent = euros(priceCents('annuel', t)) + ' par an';
    $('price-detail').textContent = plural(t, 'Jusqu’à 309 adhérents',
      'Dont 1 tranche de 100 adhérents', 'Dont {n} tranches de 100 adhérents');
    // Même règle que l'app : Stripe demande au moins 48 heures d'essai restant.
    var trialEnd = d.essai_fin ? new Date(d.essai_fin) : null;
    var kept = d.etat === 'essai' && trialEnd && trialEnd - Date.now() > 49 * 3600 * 1000;
    $('trial-kept').hidden = !kept;
    if (kept) {
      $('trial-kept').firstElementChild.textContent =
        'L’essai gratuit continue : le premier paiement aura lieu le ' + date(trialEnd) + '.';
    }
  }

  function renderManage(d) {
    var plan = d.formule || 'mensuel';
    var other = plan === 'mensuel' ? 'annuel' : 'mensuel';
    $('switch-cancel').hidden = !d.formule_prochaine;
    $('switch-submit').hidden = !!d.formule_prochaine || !!d.resiliation_demandee;
    $('switch-submit').textContent = 'Passer en formule ' + planLabels[other].toLowerCase();
    $('switch-submit').dataset.plan = other;
    $('switch-cancel').dataset.plan = plan;
  }

  function renderInvoices(invoices) {
    $('invoices-card').hidden = invoices === null;
    if (invoices === null) return;
    var list = $('invoices');
    list.textContent = '';
    $('invoices-empty').hidden = invoices.length > 0;
    invoices.forEach(function (invoice) {
      var li = document.createElement('li');
      var text = document.createElement('div');
      var title = document.createElement('strong');
      title.textContent = invoice.numero ? 'Facture ' + invoice.numero : 'Facture';
      var meta = document.createElement('span');
      meta.className = 'muted small';
      meta.textContent = date(invoice.emise_le) + ' · ' + euros(invoice.montant_centimes);
      text.append(title, document.createElement('br'), meta);
      var state = document.createElement('span');
      badge(state, invoiceStates[invoice.statut] || ['À régler', 'state-warning']);
      var links = document.createElement('div');
      links.className = 'invoice-links';
      links.append(state);
      var toPay = !invoiceStates[invoice.statut];
      if (toPay && /^https:\/\//.test(invoice.page_url || '')) links.append(link(invoice.page_url, 'Payer'));
      if (/^https:\/\//.test(invoice.pdf_url || '')) links.append(link(invoice.pdf_url, 'PDF'));
      li.append(text, links);
      list.append(li);
    });
  }

  function link(href, label) {
    var a = document.createElement('a');
    a.href = href;
    a.textContent = label;
    a.target = '_blank';
    a.rel = 'noopener noreferrer';
    return a;
  }

  // ------------------------------------------------------------- Actions
  // Stripe revient sur cette page (le site ou son aperçu local).
  var returnUrl = window.location.origin + window.location.pathname;

  async function goToStripe(body) {
    setError('subscription-error');
    setMessage();
    setBusy(true);
    try {
      body.return_url = returnUrl;
      var data = await invoke(body);
      if (!data.url || !/^https:\/\/[a-z0-9.-]*stripe\.com\//.test(data.url)) {
        throw new Error('Adresse de paiement inattendue. Réessayez.');
      }
      remember(STRUCTURE_KEY, current.id);
      window.location.assign(data.url);
    } catch (error) {
      setError('subscription-error', message(error));
      setBusy(false);
    }
  }

  $('subscribe-submit').addEventListener('click', function () {
    var plan = document.querySelector('input[name="plan"]:checked').value;
    goToStripe({ action: 'checkout', formule: plan });
  });

  $('portal-submit').addEventListener('click', function () {
    goToStripe({ action: 'portal' });
  });

  async function changePlan(plan, done) {
    setError('subscription-error');
    setMessage();
    setBusy(true);
    try {
      await invoke({ action: 'formule', formule: plan });
      setBusy(false);
      await loadSubscription(false);
      setMessage(done);
    } catch (error) {
      setError('subscription-error', message(error));
      setBusy(false);
    }
  }

  $('switch-submit').addEventListener('click', function () {
    var plan = $('switch-submit').dataset.plan;
    var end = details && details.periode_fin ? date(details.periode_fin) : 'la fin de la période payée';
    var ok = window.confirm('Passer en formule ' + planLabels[plan].toLowerCase() + ' ?\n\n' +
      'La période déjà payée continue jusqu’au ' + end +
      '. La nouvelle formule commence ensuite, sans remboursement ni supplément.');
    if (ok) changePlan(plan, 'Changement de formule enregistré.');
  });

  $('switch-cancel').addEventListener('click', function () {
    changePlan($('switch-cancel').dataset.plan, 'Changement de formule annulé.');
  });

  document.querySelectorAll('[data-refresh]').forEach(function (button) {
    button.addEventListener('click', function () {
      setMessage();
      loadSubscription(true);
    });
  });

  // ------------------------------------------------------------- Démarrage
  (async function start() {
    var session = await client.auth.getSession();
    var user = session.data && session.data.session && session.data.session.user;
    if (user) {
      email = user.email || '';
      loadStructures(user);
    } else {
      show('step-email');
      $('email').blur();
    }
  })();
})();
