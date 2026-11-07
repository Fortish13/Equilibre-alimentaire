/* =====================================================================
   Équilibre alimentaire du foyer — interface
   ===================================================================== */
(function () {
  'use strict';
  var N = NUTRI;
  var CLE = 'equilibre-alimentaire-v1';
  var backend = null;
  try { backend = window.localStorage; backend.getItem(CLE); } catch (e) { backend = null; }
  var store = N.Stockage(backend, CLE);
  var lu = store.lire();
  var premierLancement = !lu;
  var etat = N.normaliserEtat(lu);
  N.nettoyerFaits(etat, new Date());
  // empreinte de l'état au dernier enregistrement : ce qui change ensuite est daté (synchronisation entre appareils)
  var EMP = N.empreintes(etat);
  var stockageOk = !!backend;
  var EXIGENCES = [];
  try { EXIGENCES = JSON.parse(document.getElementById('exigences-liste').textContent); } catch (e) { EXIGENCES = []; }

  var vue = { onglet: 'aujourdhui', personne: 0, periode: -1, nutriment: 'mg', moment: 'tous', recherche: '', tag: null, recherchePrix: '', rapides: false };
  var cache = null;
  // heure courante ; remplaçable pour les essais (window.__equilibre.horloge)
  var horloge = function () { return new Date(); };

  // ------------------------------------------------------------------ outils d'affichage
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function nb(x, d) { if (x == null || !isFinite(x)) return '—'; return Number(x).toLocaleString('fr-FR', { minimumFractionDigits: d || 0, maximumFractionDigits: d || 0 }); }
  function euro(x) { return Number(x || 0).toLocaleString('fr-FR', { style: 'currency', currency: 'EUR' }); }
  function pct(x) { return isFinite(x) ? Math.round(x * 100) + ' %' : '—'; }
  function qte(q, unite) {
    if (unite === 'pc') { var r = Math.round(q * 2) / 2; return nb(r, r % 1 ? 1 : 0) + (r > 1 ? ' pièces' : ' pièce'); }
    if (unite === 'ml') return q >= 950 ? nb(q / 1000, 2) + ' L' : nb(q, q < 10 ? 1 : 0) + ' ml';
    return q >= 950 ? nb(q / 1000, 2) + ' kg' : nb(q, q < 10 ? 1 : 0) + ' g';
  }
  function qteCuisine(f, q) {
    var a = N.AL[f];
    if (a.unite === 'pc') return qte(q, 'pc');
    if (a.unite === 'ml') { var r = q < 20 ? Math.round(q) : Math.round(q / 5) * 5; return nb(r) + ' ml'; }
    var g = q < 5 ? Math.round(q * 10) / 10 : (q < 20 ? Math.round(q) : Math.round(q / 5) * 5);
    return nb(g, g % 1 ? 1 : 0) + ' g';
  }
  var SYMB = { mg: ['Mg', 12], fe: ['Fe', 26], ca: ['Ca', 20], zn: ['Zn', 30], k: ['K', 19], p: ['P', 15], i: ['I', 53], se: ['Se', 34], cu: ['Cu', 29], na: ['Na', 11],
    vitA: ['A'], vitD: ['D'], vitE: ['E'], vitC: ['C'], b1: ['B1'], b2: ['B2'], b6: ['B6'], b9: ['B9'], b12: ['B12'],
    kcal: ['kcal'], prot: ['Prot'], gluc: ['Gluc'], sucresHL: ['Sucres'], lip: ['Lip'], ags: ['AGS'], fib: ['Fibres'], ala: ['ALA'], epadha: ['EPA DHA'] };
  var GROUPES = [
    { nom: 'Minéraux', cles: ['mg', 'fe', 'ca', 'zn', 'k', 'p', 'i', 'se', 'cu', 'na'] },
    { nom: 'Vitamines', cles: ['vitA', 'vitD', 'vitE', 'vitC', 'b1', 'b2', 'b6', 'b9', 'b12'] },
    { nom: 'Énergie, macronutriments et oméga-3', cles: ['kcal', 'prot', 'gluc', 'sucresHL', 'lip', 'ags', 'fib', 'ala', 'epadha'] }
  ];
  var COURT_EAU = { fluor: 'fluor > 1,5 mg/L', sulfates: 'riche en sulfates', sodium: 'contient du sodium', mineralisation: 'très minéralisée' };
  var LIB_STATUT = { ok: 'couvert', proche: 'presque couvert', bas: 'insuffisant', exces: 'au-dessus du repère', lss: 'au-delà de la limite de sécurité', na: '—' };
  var CONSEILS = {
    ca: 'un laitage de plus (yaourt, fromage blanc, comté) ou une eau riche en calcium',
    mg: 'graines de courge, amandes, cacao pur, légumes secs, céréales complètes ou une eau magnésienne',
    fe: 'lentilles, pois chiches, boudin noir, moules ou bœuf, avec un kiwi ou un agrume au même repas',
    zn: 'viande, fromage à pâte dure, graines de courge, légumes secs',
    k: 'légumes, fruits et légumes secs',
    p: 'laitages, poisson, légumes secs',
    i: 'poisson, lait et laitages, œufs, sel iodé',
    se: 'poisson, œufs, viande',
    cu: 'cacao, fruits à coque, légumes secs',
    na: 'moins de sel ajouté, de fromage, de charcuterie et de pain',
    vitA: 'carotte, épinards, butternut',
    vitD: 'poissons gras, œufs, lait enrichi ; le soleil en fournit l\'essentiel, et un complément se discute avec le médecin',
    vitE: 'huile de colza, amandes, noisettes',
    vitC: 'kiwi, agrumes, poivron, brocoli',
    b1: 'pain complet, légumes secs, flocons d\'avoine',
    b2: 'laitages, œufs, amandes',
    b6: 'poisson, volaille, banane, légumes secs',
    b9: 'légumes verts, légumes secs, agrumes',
    b12: 'poisson, moules, viande, œufs, laitages',
    fib: 'pain complet, légumes secs, fruits et légumes',
    ala: 'huile de colza en assaisonnement, noix',
    epadha: 'sardines, maquereau, saumon',
    prot: 'œufs, laitages, légumes secs, viande ou poisson',
    sucresHL: 'moins de confiture, de miel et de sucre ajouté',
    ags: 'moins de beurre, de fromage et de charcuterie',
    kcal: 'ajuster les portions dans l\'onglet Foyer', lip: 'ajuster les matières grasses', gluc: 'ajuster les féculents'
  };
  var ICONE_VERROU = '<svg viewBox="0 0 16 16" aria-hidden="true"><rect x="3" y="7" width="10" height="8" rx="1.5" fill="currentColor"/><path d="M5 7V5a3 3 0 0 1 6 0v2" fill="none" stroke="currentColor" stroke-width="1.6"/></svg>';
  var ICONE_OUVERT = '<svg viewBox="0 0 16 16" aria-hidden="true"><rect x="3" y="7" width="10" height="8" rx="1.5" fill="none" stroke="currentColor" stroke-width="1.4"/><path d="M5 7V5a3 3 0 0 1 5.6-1.5" fill="none" stroke="currentColor" stroke-width="1.6"/></svg>';

  function valAff(k, v) {
    var u = N.INFO[k].u;
    if (k === 'epadha') return nb(v * 1000) + ' mg';
    if (k === 'ala') return nb(v, 1) + ' g';
    var d = (u === 'kcal') ? 0 : (v < 10 ? 1 : 0);
    return nb(v, d) + ' ' + u;
  }
  function refAff(k, ref) {
    if (!ref) return '—';
    if (ref.t === 'plage') return valAff(k, ref.min).replace(/ .*$/, '') + ' à ' + valAff(k, ref.max);
    if (ref.t === 'max') return '≤ ' + valAff(k, ref.v);
    return valAff(k, ref.v);
  }
  function ratio(k, ref, v) {
    if (!ref) return NaN;
    if (ref.t === 'plage') return v / ((ref.min + ref.max) / 2);
    return v / ref.v;
  }
  function typeRef(ref) {
    return { RNP: 'référence nutritionnelle pour la population', AS: 'apport satisfaisant', max: 'limite à ne pas dépasser', plage: 'plage recommandée', cible: 'besoin estimé' }[ref.t] || '';
  }

  function toast(msg) {
    var t = document.getElementById('toast'); t.textContent = msg; t.classList.add('visible');
    clearTimeout(toast._t); toast._t = setTimeout(function () { t.classList.remove('visible'); }, 2600);
  }

  // ------------------------------------------------------------------ état et calcul
  function recalculer() {
    var ctx = N.preparer(etat), ev = N.evaluer(etat, ctx, false);
    cache = { ctx: ctx, ev: ev, liste: N.listeCourses(etat, ctx, ev), score: N.score(etat, ctx) };
    return cache;
  }
  // dater : false pour un enregistrement qui n'est pas une modification de l'utilisateur (première semaine
  // générée à l'ouverture, données reçues d'un autre appareil) — il ne doit pas l'emporter sur l'autre appareil
  function sauver(dater) {
    if (dater === false) EMP = N.empreintes(etat);
    else {
      var h = N.horodater(etat, EMP, Date.now()); EMP = h.empreinte;
      if (h.changements.length) syncSoon('modification', 4000);
    }
    stockageOk = store.ecrire(etat);
  }
  function changer(fn, garderFocus) {
    fn(); sauver(); recalculer(); rendre(garderFocus);
  }
  function planVide() { return etat.plan.every(function (j) { return j.every(function (x) { return !x; }); }); }

  function generer(depart, graineImposee, sansDate) {
    var voile = document.getElementById('voile');
    document.getElementById('voileTexte').textContent = 'Recherche d\'une semaine équilibrée (' + nb(etat.iterations) + ' essais par départ)…';
    voile.hidden = false;
    SYNC_RT.pause = true;
    setTimeout(function () {
      var graine = graineImposee != null ? graineImposee : (depart === 'aleatoire' ? (Date.now() & 0x7fffffff) : etat.graine);
      var t0 = Date.now();
      var r = N.optimiser(etat, { depart: depart, graine: graine, iterations: etat.iterations, relances: depart === 'aleatoire' ? 2 : 1 });
      etat.plan = r.plan;
      sauver(sansDate ? false : undefined); recalculer();
      voile.hidden = true;
      SYNC_RT.pause = false; if (SYNC_RT.again) { SYNC_RT.again = false; syncSoon('reprise', 1500); }
      rendre();
      var cj = cache.ev.coutJours, haut = Math.max.apply(null, cj);
      toast('Semaine ' + (depart === 'aleatoire' ? 'générée' : 'améliorée') + ' en ' + nb((Date.now() - t0) / 1000, 1) + ' s : score ' + nb(r.scoreDepart, 1) + ' → ' + nb(r.score, 1) +
        ' ; ' + euro(cache.ev.cout / 7) + ' par jour en moyenne, ' + euro(haut) + ' au plus');
    }, 40);
  }

  // ------------------------------------------------------------------ dates et heures
  var JOURS_MIN = ['lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi', 'dimanche'];
  var MOIS = ['janvier', 'février', 'mars', 'avril', 'mai', 'juin', 'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre'];
  function heureTexte(t) { var m = t.getMinutes(); return t.getHours() + ' h' + (m ? ' ' + (m < 10 ? '0' : '') + m : ''); }
  function hhmm(ms) { var t = new Date(ms); return (t.getHours() < 10 ? '0' : '') + t.getHours() + ':' + (t.getMinutes() < 10 ? '0' : '') + t.getMinutes(); }
  function jourTexte(t, maintenant) {
    var a = new Date(maintenant.getFullYear(), maintenant.getMonth(), maintenant.getDate()), b = new Date(t.getFullYear(), t.getMonth(), t.getDate());
    var k = Math.round((b - a) / 864e5);
    if (k === 0) return 'aujourd\'hui';
    if (k === 1) return 'demain';
    return JOURS_MIN[N.indexJour(t)] + ' ' + t.getDate() + ' ' + MOIS[t.getMonth()];
  }
  function delaiTexte(min) {
    if (min < 60) return min + ' min';
    var h = Math.floor(min / 60), m = min % 60;
    return h + ' h' + (m ? ' ' + (m < 10 ? '0' : '') + m : '');
  }
  function nomsListe(L) { return L.length < 2 ? L.join('') : L.slice(0, -1).join(', ') + ' et ' + L[L.length - 1]; }
  function datePrix() { return new Date(N.D.meta.prixDate).toLocaleDateString('fr-FR'); }
  // article dont le prix a été relevé à une autre date que l'ensemble
  function prixRecents() { return Object.keys(N.ACH).filter(function (id) { return N.ACH[id].date && N.ACH[id].date !== N.D.meta.prixDate && N.ACH[id].date !== undefined; }); }

  // ------------------------------------------------------------------ prochain repas
  function etatProchain(r, maintenant) {
    var t = maintenant.getTime();
    if (t >= r.quand.getTime()) return { cls: 'st-bas', txt: 'c\'est l\'heure du repas' };
    if (t >= r.debut.getTime()) return { cls: 'st-proche', txt: 'à commencer maintenant' };
    return { cls: 'st-ok', txt: 'commencer à ' + heureTexte(r.debut) + ' (dans ' + delaiTexte(r.minutesAvantDebut) + ')' };
  }
  function rendreBandeau() {
    var b = document.getElementById('bandeauRepas'); if (!b) return;
    var maintenant = horloge(), r = N.prochainRepas(etat, maintenant);
    if (!r || vue.onglet === 'aujourdhui') { b.hidden = true; b.innerHTML = ''; return; }
    var e = etatProchain(r, maintenant);
    b.hidden = false;
    b.innerHTML = '<button class="bandeau-btn" data-action="aller-prochain"><span class="bandeau-lib">Prochain repas</span> <b>' + esc(N.MOMENTS[r.s].nom) + ' ' + esc(jourTexte(r.quand, maintenant)) + ' à ' + heureTexte(r.quand) + '</b> : ' +
      esc(N.RECETTE[r.id].nom) + ' <span class="pastille ' + e.cls + '">' + esc(e.txt) + '</span></button>';
  }
  function rendreAujourdhui() {
    var maintenant = horloge(), L = N.repasAVenir(etat, maintenant, 4), ev = cache.ev, h = '';
    if (!L.length) {
      h += '<div class="carte prochain"><h2>Aucun repas à préparer</h2><p>Rien n\'est prévu dans le planning pour les jours à venir, ou personne n\'est à la maison.</p>' +
        '<button class="btn btn-principal" data-action="generer">Générer une semaine équilibrée</button></div>';
      return h + rendreJourBudget(maintenant);
    }
    var r = L[0], rec = N.RECETTE[r.id], e = etatProchain(r, maintenant);
    var presents = r.presents.map(function (i) { return etat.personnes[i].nom; });
    var absents = etat.personnes.filter(function (p, i) { return r.presents.indexOf(i) < 0; }).map(function (p) { return p.nom; });
    var Q = N.quantitesRepas(etat, ev, r.id, r.presents), cout = N.coutRepas(etat, cache.ctx, ev, r.id, r.presents);
    var long = !N.prepOk(etat, rec);
    h += '<section class="carte prochain" aria-label="Prochain repas à préparer"><div class="prochain-tete"><div class="prochain-titre">' +
      '<p class="surtitre">Prochain repas à préparer</p>' +
      '<h2>' + esc(N.MOMENTS[r.s].nom) + ' · ' + esc(jourTexte(r.quand, maintenant)) + ' à ' + heureTexte(r.quand) + '</h2>' +
      '<button class="nom-recette grand" data-action="ouvrir-recette" data-id="' + r.id + '" title="Fiche complète">' + esc(rec.nom) + '</button>' +
      '<p class="horaire"><span class="pastille ' + e.cls + '">' + esc(e.txt) + '</span> préparation ' + rec.prep + ' min' + (rec.cuisson ? ', cuisson ' + rec.cuisson + ' min' : ', sans cuisson') +
      (long ? ' <span class="pastille st-bas">plus de ' + etat.prepMax + ' min de préparation</span>' : '') + '</p>' +
      '<p class="petit muet">Pour ' + esc(nomsListe(presents)) + (absents.length ? ' (' + esc(nomsListe(absents)) + ' : ' + (N.MOMENTS[r.s].repas ? 'repas pris dehors' : 'absent') + ')' : '') + ' · ' + euro(cout) + '</p></div>' +
      '<div class="prochain-actions"><button class="btn btn-principal" data-action="repas-fait" data-cle="' + r.cle + '">C\'est prêt ✓</button>' +
      '<select class="changer" data-action="choisir" data-d="' + r.d + '" data-s="' + r.s + '" aria-label="Changer de recette">' + optionsCreneau(r.d, r.s, r.id) + '</select></div></div>';
    h += '<div class="prochain-corps"><div><h3>À sortir et à peser</h3><table class="table-quantites"><tbody>' + Q.map(function (q) {
      return '<tr><td>' + esc(q.nom) + (q.u ? ' <span class="muet petit">(1 par personne)</span>' : '') +
        (q.parts.length > 1 && !q.u ? '<div class="petit muet">' + q.parts.map(function (x) { return esc(etat.personnes[x.i].nom) + ' ' + qteCuisine(q.f, x.q); }).join(' · ') + '</div>' : '') +
        '</td><td class="n"><b>' + qteCuisine(q.f, q.total) + '</b></td></tr>';
    }).join('') + '</tbody></table>' + (rec.placard && rec.placard.length ? '<p class="petit">Du placard : ' + esc(rec.placard.join(', ')) + '.</p>' : '') + '</div>' +
      '<div><h3>Étapes</h3><ol class="etapes">' + rec.etapes.map(function (x) { return '<li>' + esc(x) + '</li>'; }).join('') + '</ol></div></div></section>';
    if (L.length > 1) {
      h += '<div class="section"><h2>Ensuite</h2><div class="ensuite">' + L.slice(1).map(function (x) {
        var rx = N.RECETTE[x.id];
        return '<button class="ensuite-item" data-action="ouvrir-recette" data-id="' + x.id + '"><span class="muet petit">' + esc(N.MOMENTS[x.s].nom) + ' · ' + esc(jourTexte(x.quand, maintenant)) + ' à ' + heureTexte(x.quand) + '</span>' +
          '<span class="ensuite-nom">' + esc(rx.nom) + '</span><span class="muet petit">commencer à ' + heureTexte(x.debut) + ' · préparation ' + rx.prep + ' min' + (rx.cuisson ? ' + cuisson ' + rx.cuisson + ' min' : '') + '</span></button>';
      }).join('') + '</div></div>';
    }
    return h + rendreJourBudget(maintenant);
  }
  function rendreJourBudget(maintenant) {
    var d = N.indexJour(maintenant), cle = N.cleJour(maintenant), c = cache.ev.coutJours[d], b = etat.budgetJour;
    var faits = [0, 1, 2, 3].filter(function (s) { return etat.faits[cle + ':' + s]; });
    var h = '<div class="section"><h2>' + esc(N.JOURS[d]) + '</h2><div class="carte"><p>Coût de la journée : <span class="pastille ' + classeBudget(c) + '">' + euro(c) + '</span>' +
      (b.max > 0 ? ' pour ' + euro(b.max) + ' au plus' : '') + (b.cible > 0 ? ' (cible ' + euro(b.cible) + ')' : '') + '.</p>';
    if (faits.length) h += '<p class="petit">Déjà préparé aujourd\'hui : ' + faits.map(function (s) {
      var id = etat.plan[d][s];
      return esc(N.MOMENTS[s].nom.toLowerCase()) + (id ? ' (' + esc(N.RECETTE[id].nom) + ')' : '') + ' <button class="btn-lien" data-action="repas-annuler" data-cle="' + cle + ':' + s + '">annuler</button>';
    }).join(' ; ') + '.</p>';
    h += '<p class="petit muet">Horaires des repas : ' + N.MOMENTS.map(function (m, s) { var t = N.minutesHeure(etat.horaires[s]); return m.nom.replace('Goûter de 16 h', 'goûter').toLowerCase() + ' ' + heureTexte(new Date(2000, 0, 1, Math.floor(t / 60), t % 60)); }).join(', ') +
      ' (onglet Foyer). Un repas reste affiché jusqu\'à 45 min après son heure, ou jusqu\'à « C\'est prêt ».</p></div></div>';
    return h;
  }
  function classeBudget(c) {
    var b = etat.budgetJour;
    if (b.max > 0 && c > b.max + 1e-9) return 'st-bas';
    if (b.cible > 0 && c > b.cible + 1e-9) return 'st-proche';
    return 'st-ok';
  }

  // ------------------------------------------------------------------ en-tête
  function rendreEntete() {
    var ev = cache.ev, recents = prixRecents();
    document.getElementById('sousTitre').textContent = 'Recettes, bilan des minéraux et vitamines par personne, courses chez Carrefour (prix relevés le ' +
      new Date(N.D.meta.prixDate).toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' }) + (recents.length ? ', quelques-uns depuis' : '') + ').';
    document.getElementById('foyerResume').innerHTML = ev.personnes.map(function (pr, i) {
      var p = etat.personnes[i];
      return '<span class="puce-personne"><b>' + esc(p.nom) + '</b> : ' + nb(pr.E) + ' kcal/j, portions × ' + nb(pr.F, 2) + '</span>';
    }).join('');
    Array.prototype.forEach.call(document.querySelectorAll('.onglets button'), function (b) { b.setAttribute('aria-selected', b.dataset.onglet === vue.onglet ? 'true' : 'false'); });
    rendreBandeau();
    syncBadge();
  }

  // ------------------------------------------------------------------ onglet Semaine
  function optionsCreneau(d, s, actuel) {
    var c = cache.ctx.candTous[d][s];
    var h = '<option value="__" selected>Changer…</option>';
    c.forEach(function (id) {
      var r = N.RECETTE[id];
      h += '<option value="' + id + '">' + (id === actuel ? '✓ ' : '') + esc(r.nom) + ' — ' + euro(coutFamille(r)) + (N.prepOk(etat, r) ? '' : ' (préparation ' + r.prep + ' min)') + '</option>';
    });
    if (actuel) h += '<option value="">Ne rien prévoir</option>';
    return h;
  }
  function absentsTexte(d, s) {
    var abs = etat.personnes.filter(function (p) { return !p.presence[d][s]; }).map(function (p) { return p.nom; });
    if (!abs.length) return '';
    return '<div class="absent">' + esc(abs.join(', ')) + (N.MOMENTS[s].repas ? ' : repas pris dehors' : ' : absent') + '</div>';
  }
  function pointsAttention() {
    var ev = cache.ev, items = [];
    var prio = { mg: 1, fe: 1, ca: 1, zn: 1, i: 1, vitC: 1, b9: 1, b12: 1, fib: 1, epadha: 1, k: 1 };
    ev.personnes.forEach(function (pr, pi) {
      Object.keys(pr.statuts).forEach(function (k) {
        var s = pr.statuts[k]; if (k === 'vitD' || k === 'kcal') return;
        if (s === 'lss' || s === 'bas' || s === 'exces' || (s === 'proche' && prio[k])) items.push({ pi: pi, k: k, s: s, sev: s === 'lss' ? 4 : (s === 'bas' ? 3 : (s === 'exces' ? 2 : 1)) });
      });
      pr.pnns.forEach(function (x) { if (!x.ok && !x.info) items.push({ pi: pi, pnns: x, sev: 2 }); });
    });
    items.sort(function (a, b) { return b.sev - a.sev; });
    var h = items.slice(0, 12).map(function (it) {
      var p = etat.personnes[it.pi], pr = ev.personnes[it.pi];
      if (it.pnns) return '<div class="alerte st-proche"><span class="marque"></span><p><b>' + esc(p.nom) + '</b> : repère « ' + esc(it.pnns.nom) + ' » non atteint (' + esc(it.pnns.txt) + ', repère ' + esc(it.pnns.cible) + ').</p></div>';
      var ref = pr.refs[it.k], v = pr.moy[N.KI[it.k]];
      return '<div class="alerte st-' + it.s + '"><span class="marque"></span><p><b>' + esc(p.nom) + '</b> : ' + esc(N.INFO[it.k].nom.toLowerCase()) + ' ' + esc(LIB_STATUT[it.s]) +
        ' (' + valAff(it.k, v) + '/j pour ' + refAff(it.k, ref) + '). Piste : ' + esc(CONSEILS[it.k] || '') + '. ' +
        '<button class="btn-lien" data-action="voir-nutriment" data-p="' + it.pi + '" data-k="' + it.k + '">Voir les suggestions</button></p></div>';
    }).join('');
    var vd = ev.personnes.map(function (pr, i) { return esc(etat.personnes[i].nom) + ' ' + nb(pr.moy[N.KI.vitD], 1) + ' µg'; });
    h += '<div class="alerte st-na"><span class="marque"></span><p><b>Vitamine D</b> : l\'alimentation de la semaine en apporte par jour ' + vd.join(' ; ') +
      ' (repère 15 µg). C\'est la situation habituelle : la vitamine D vient surtout de l\'exposition au soleil. Un complément, notamment pour l\'enfant, se discute avec le médecin ; l\'outil ne le calcule pas.</p></div>';
    if (!items.length) h = '<div class="alerte st-ok"><span class="marque"></span><p>Aucun manque ni excès sur la semaine pour les trois personnes (hors vitamine D, voir ci-dessous).</p></div>' + h;
    return h;
  }
  function rendreSemaine() {
    var ev = cache.ev, L = cache.liste;
    var nbOk = ev.personnes.map(function (pr) { var L = pr.pnns.filter(function (x) { return !x.info; }); return L.filter(function (x) { return x.ok; }).length + '/' + L.length; });
    var h = '<div class="barre-actions">' +
      '<button class="btn btn-principal" data-action="generer">Générer une semaine équilibrée</button>' +
      '<button class="btn" data-action="ameliorer">Améliorer en gardant les verrous</button>' +
      '<label class="champ" style="flex-direction:row;align-items:center;gap:6px">Précision <select data-action="iterations">' +
      [[3000, 'rapide'], [8000, 'normale'], [20000, 'approfondie']].map(function (o) { return '<option value="' + o[0] + '"' + (etat.iterations === o[0] ? ' selected' : '') + '>' + o[1] + '</option>'; }).join('') + '</select></label>' +
      '<span class="espace"></span>' +
      '<button class="btn" data-action="imprimer">Imprimer</button>' +
      '<button class="btn" data-action="vider">Vider la semaine</button></div>';
    var cj = ev.coutJours, b = etat.budgetJour, moyJ = ev.cout / 7, hautJ = Math.max.apply(null, cj);
    var dessus = []; cj.forEach(function (c, d) { if (b.max > 0 && c > b.max + 1e-9) dessus.push(N.JOURS[d].toLowerCase() + ' ' + euro(c)); });
    h += '<div class="kpis">' +
      '<div class="kpi"><div class="val">' + euro(moyJ) + '</div><div class="lib">Coût moyen par jour' + (b.max > 0 ? ' (maximum ' + euro(b.max) + (b.cible > 0 ? ', cible ' + euro(b.cible) : '') + ')' : '') + ' ; jour le plus cher ' + euro(hautJ) + '</div></div>' +
      '<div class="kpi"><div class="val">' + euro(ev.cout) + '</div><div class="lib">Aliments consommés dans la semaine ; ticket si tout est acheté neuf : ' + euro(L.total) + '</div></div>' +
      '<div class="kpi"><div class="val">' + nb(cache.score, 1) + '</div><div class="lib">Score d\'équilibre de la semaine (plus haut = mieux)</div></div>' +
      '<div class="kpi"><div class="val">' + nbOk.join(', ') + '</div><div class="lib">Repères PNNS atteints (' + etat.personnes.map(function (p) { return p.nom; }).join(', ') + ')</div></div>' +
      '</div>';
    if (dessus.length) h += '<div class="note note-grave">Budget dépassé : ' + esc(dessus.join(', ')) + ' pour ' + euro(b.max) + ' au plus par jour. « Améliorer » remplace les recettes non verrouillées ; si cela ne suffit pas, le budget est trop serré pour ce foyer et la variété demandée (chaque plat une fois par semaine).</div>';
    var longs = N.creneauxTropLongs(etat, true);
    if (longs.length) h += '<div class="note">Préparation de plus de ' + etat.prepMax + ' min : ' + esc(longs.map(function (x) { return N.JOURS[x[0]].toLowerCase() + ' ' + N.MOMENTS[x[1]].nom.toLowerCase() + ' (' + N.RECETTE[etat.plan[x[0]][x[1]]].prep + ' min)'; }).join(', ')) + '. Le générateur ne les propose pas ; « Améliorer » les remplace s\'ils ne sont pas verrouillés.</div>';
    h += '<p class="petit muet">Coût du jour : repas pris à la maison, au prorata de ce qui est mangé, et eau de boisson (' + euro(ev.coutEauJour) + ' par jour). Préparation : temps de travail hors cuisson' + (etat.prepMax ? ', ' + etat.prepMax + ' min au plus' : '') + ' (réglages dans l\'onglet Foyer).</p>';
    h += '<div class="semaine">';
    for (var d = 0; d < 7; d++) {
      h += '<section class="jour" aria-label="' + N.JOURS[d] + '"><h3>' + N.JOURS[d] + ' <span class="pastille cout-jour ' + classeBudget(cj[d]) + '" title="Coût du ' + N.JOURS[d].toLowerCase() + ' pour le foyer">' + euro(cj[d]) + '</span></h3>';
      for (var s = 0; s < 4; s++) {
        var id = etat.plan[d][s], verrou = etat.verrous[d][s];
        var cout = N.coutCreneau(etat, cache.ctx, ev, d, s), rc = id ? N.RECETTE[id] : null, trop = rc && !N.prepOk(etat, rc);
        h += '<div class="creneau"><div class="moment"><span>' + N.MOMENTS[s].nom + '</span>' +
          '<button class="verrou" data-action="verrou" data-d="' + d + '" data-s="' + s + '" aria-pressed="' + verrou + '" title="' + (verrou ? 'Déverrouiller' : 'Verrouiller : le générateur ne changera pas ce choix') + '" aria-label="' + (verrou ? 'Déverrouiller ' : 'Verrouiller ') + N.MOMENTS[s].nom + ' du ' + N.JOURS[d] + '">' + (verrou ? ICONE_VERROU : ICONE_OUVERT) + '</button></div>' +
          (id ? '<button class="nom-recette" data-action="ouvrir-recette" data-id="' + id + '" title="Voir la recette">' + esc(rc.nom) + '</button>' : '<span class="muet petit">Rien de prévu</span>') +
          '<div class="pied">' + (id ? '<span class="num">' + euro(cout) + '</span><span class="prep' + (trop ? ' prep-trop' : '') + '" title="Préparation hors cuisson' + (rc.cuisson ? ' ; cuisson ' + rc.cuisson + ' min' : '') + '">' + rc.prep + ' min</span>' : '') +
          '<select class="changer" data-action="choisir" data-d="' + d + '" data-s="' + s + '" aria-label="Changer le ' + N.MOMENTS[s].nom.toLowerCase() + ' du ' + N.JOURS[d].toLowerCase() + '">' + optionsCreneau(d, s, id) + '</select></div>' +
          absentsTexte(d, s) + '</div>';
      }
      h += '</section>';
    }
    h += '</div>';
    h += '<div class="section" style="margin-top:20px"><h2>Points d\'attention</h2><div class="attention">' + pointsAttention() + '</div></div>';
    return h;
  }

  // ------------------------------------------------------------------ onglet Bilan
  function vecteurPeriode(pr) { return vue.periode < 0 ? pr.moy : pr.jours[vue.periode]; }
  function tuile(k, pr, v) {
    var ref = pr.refs[k], st = ref ? N.statut(ref, v) : 'na';
    var r = ratio(k, ref, v), sy = SYMB[k];
    var largeur = Math.max(0, Math.min(100, (isFinite(r) ? r : 0) * 100));
    var txt = ref ? (ref.t === 'max' ? pct(r) + ' max' : pct(r)) : valAff(k, v);
    return '<button class="tuile st-' + st + '" data-action="tuile" data-k="' + k + '" aria-pressed="' + (vue.nutriment === k) + '" aria-label="' + esc(N.INFO[k].nom + ' : ' + valAff(k, v) + ' par jour, ' + (ref ? pct(r) + ' du repère, ' + LIB_STATUT[st] : '')) + '">' +
      '<span class="z">' + (sy[1] || '') + '</span><span class="sym' + (sy[0].length > 3 ? ' long' : '') + '">' + esc(sy[0]) + '</span>' +
      '<span class="nom">' + esc(N.INFO[k].nom.replace('Vitamine ', 'Vit. ')) + '</span><span class="pct">' + txt + '</span>' +
      '<span class="jauge" style="width:' + largeur + '%"></span></button>';
  }
  function detailNutriment(pi, k) {
    var pr = cache.ev.personnes[pi], p = etat.personnes[pi], ref = pr.refs[k];
    var v = vecteurPeriode(pr)[N.KI[k]], st = ref ? N.statut(ref, v) : 'na';
    var h = '<div class="carte detail"><h3>' + esc(N.INFO[k].nom) + ' — ' + esc(p.nom) + '</h3>';
    h += '<p><span class="pastille st-' + st + '">' + LIB_STATUT[st] + '</span> <span class="num">' + valAff(k, v) + '</span> par jour' + (vue.periode < 0 ? ' en moyenne sur la semaine' : ' le ' + N.JOURS[vue.periode].toLowerCase()) + '.</p>';
    if (ref) {
      h += '<p class="petit">Repère : <b>' + refAff(k, ref) + '</b> (' + typeRef(ref) + '). Source : ' + esc(ref.src) + '.' +
        (ref.lss != null ? ' Limite supérieure de sécurité : ' + valAff(k, ref.lss) + '.' : '') + (ref.as ? ' Apport satisfaisant : ' + valAff(k, ref.as) + '.' : '') + (ref.note ? ' ' + esc(ref.note) : '') + '</p>';
      if (ref.t === 'AS') h += '<p class="petit muet">Un apport satisfaisant n\'est pas un seuil de carence : en dessous, le risque de manque ne peut simplement pas être exclu.</p>';
    }
    var c = pr.completude[k];
    if (c != null && c < 0.98) h += '<p class="petit">Données CIQUAL incomplètes pour ce nutriment : ' + pct(1 - c) + ' du poids des aliments n\'a pas de valeur mesurée (comptée à zéro), l\'apport réel est donc un peu plus élevé.</p>';
    var contrib = N.contributeurs(etat, cache.ctx, cache.ev, pi, k).slice(0, 6);
    if (contrib.length) {
      h += '<h3 style="margin-top:12px">D\'où il vient cette semaine</h3><div class="contrib">';
      contrib.forEach(function (x) { h += '<span>' + esc(x.nom) + '</span><span class="num petit">' + pct(x.part) + '</span><span class="barre"><span style="width:' + Math.round(x.part * 100) + '%"></span></span>'; });
      h += '</div>';
    }
    var sug = N.suggestions(etat, cache.ctx, cache.ev, pi, k);
    if (sug.aliments.length && (!ref || ref.t === 'RNP' || ref.t === 'AS')) {
      h += '<h3 style="margin-top:14px">Pour en apporter plus</h3><div class="table-defile"><table><thead><tr><th>Aliment (portion)</th><th class="n">Apport</th><th class="n">Part du repère</th><th class="n">Coût</th></tr></thead><tbody>';
      sug.aliments.slice(0, 6).forEach(function (x) {
        h += '<tr><td>' + esc(x.nom) + ' (' + qteCuisine(x.aliment, x.q) + ')</td><td class="n">' + valAff(k, x.apport) + '</td><td class="n">' + pct(x.pct) + '</td><td class="n">' + euro(x.cout) + '</td></tr>';
      });
      h += '</tbody></table></div>';
      h += '<p class="petit" style="margin-top:8px">Recettes les plus riches : ' + N.MOMENTS.map(function (m) {
        return m.nom.toLowerCase() + ' ' + sug.recettes[m.k].map(function (r) { return '<button class="btn-lien" data-action="ouvrir-recette" data-id="' + r.id + '">' + esc(r.nom) + '</button>'; }).join(', ');
      }).join(' ; ') + '.</p>';
      if (sug.eaux.length) {
        var marque = false;
        h += '<p class="petit">Eau de boisson (' + nb(p.eauMl) + ' ml/j) : ' + sug.eaux.slice(0, 4).map(function (e) {
          var av = N.avertissementsEau(e.aliment, p); if (av.length) marque = true;
          return esc(e.nom) + ' ' + valAff(k, e.apport) + '/j (' + nb(e.parLitre) + ' mg/L)' + (av.length ? ' <b>⚠ ' + esc(av.map(function (x) { return COURT_EAU[x.k]; }).join(', ')) + '</b>' : '');
        }).join(', ') + '. À changer dans l\'onglet Foyer' + (marque ? ' (⚠ : mise en garde de l\'étiquette, détaillée dans l\'onglet Foyer)' : '') + '.</p>';
      }
    }
    h += '</div>';
    return h;
  }
  function rendreBilan() {
    var ev = cache.ev, pi = vue.personne, pr = ev.personnes[pi], p = etat.personnes[pi];
    var vec = vecteurPeriode(pr);
    var h = '<div class="barre-actions"><div class="segmente" role="group" aria-label="Personne">' + etat.personnes.map(function (q, i) {
      return '<button data-action="personne" data-p="' + i + '" aria-pressed="' + (i === pi) + '">' + esc(q.nom) + '</button>';
    }).join('') + '</div>' +
      '<label class="champ" style="flex-direction:row;align-items:center;gap:6px">Période <select data-action="periode"><option value="-1">Moyenne de la semaine</option>' +
      N.JOURS.map(function (j, d) { return '<option value="' + d + '"' + (vue.periode === d ? ' selected' : '') + '>' + j + '</option>'; }).join('') + '</select></label></div>';
    if (N.horsTranche(p)) h += '<div class="note">Les références enfant de l\'outil sont celles des 7-10 ans ; pour ' + p.age + ' ans, certaines valeurs ANSES diffèrent.</div>';
    h += '<p class="muet petit">' + esc(p.nom) + ' : besoin estimé ' + nb(pr.E) + ' kcal/j, portions × ' + nb(pr.F, 2) + ' par rapport aux recettes de référence' +
      (pr.nRepasDehors ? ', ' + pr.nRepasDehors + ' repas pris dehors estimés' : '') + (pr.nVides ? ', ' + pr.nVides + ' créneaux vides non comptés' : '') + '.</p>';
    h += '<div class="legende"><span class="st-ok">couvert</span><span class="st-proche">70 à 99 %</span><span class="st-bas">moins de 70 %</span><span class="st-exces">au-dessus d\'une limite</span></div>';
    h += '<div class="bilan-grille"><div>';
    GROUPES.forEach(function (g) {
      h += '<div class="groupe-titre">' + g.nom + '</div><div class="tableau-elements">' + g.cles.map(function (k) { return tuile(k, pr, vec[N.KI[k]]); }).join('') + '</div>';
    });
    h += '</div><div>' + detailNutriment(pi, vue.nutriment) + '</div></div>';
    // repères PNNS
    h += '<div class="section" style="margin-top:18px"><h2>Repères de consommation sur la semaine</h2><div class="table-defile"><table><thead><tr><th>Repère</th>' +
      etat.personnes.map(function (q) { return '<th>' + esc(q.nom) + '</th>'; }).join('') + '<th>Repère</th></tr></thead><tbody>';
    ev.personnes[0].pnns.forEach(function (x, j) {
      h += '<tr><td>' + esc(x.nom) + '</td>' + ev.personnes.map(function (q) {
        var y = q.pnns[j]; return '<td><span class="pastille st-' + (y.info ? 'na' : (y.ok ? 'ok' : 'proche')) + '">' + esc(y.txt) + '</span></td>';
      }).join('') + '<td class="muet petit">' + esc(x.cible) + '</td></tr>';
    });
    h += '</tbody></table></div><p class="petit muet">Sources : PNNS (Santé publique France) ; trois produits laitiers par jour pour les 4-11 ans (Santé publique France, 2024). Pour l\'enfant, les limites de viande et de charcuterie sont proratisées sur ses portions.</p></div>';
    // comparatif
    h += '<div class="section"><h2>Comparatif du foyer (' + (vue.periode < 0 ? 'moyenne par jour' : N.JOURS[vue.periode]) + ')</h2><div class="table-defile"><table><thead><tr><th>Nutriment</th>' +
      etat.personnes.map(function (q) { return '<th class="n">' + esc(q.nom) + '</th><th class="n">Repère</th>'; }).join('') + '</tr></thead><tbody>';
    GROUPES.forEach(function (g) {
      g.cles.forEach(function (k) {
        h += '<tr><td>' + esc(N.INFO[k].nom) + '</td>' + ev.personnes.map(function (q) {
          var v = vecteurPeriode(q)[N.KI[k]], ref = q.refs[k], st = ref ? N.statut(ref, v) : 'na';
          return '<td class="n"><span class="pastille st-' + st + '">' + valAff(k, v) + '</span></td><td class="n muet">' + refAff(k, ref) + '</td>';
        }).join('') + '</tr>';
      });
    });
    h += '</tbody></table></div></div>';
    return h;
  }

  // ------------------------------------------------------------------ onglet Recettes
  var TAGS = { vegetarien: 'Végétarien', poisson: 'Poisson', legSecs: 'Légumes secs', weekend: 'Week-end' };
  function tagsRecette(r) {
    var t = {}, cats = {};
    r.lignes.forEach(function (l) { N.AL[l.f].cats.forEach(function (c) { cats[c.split(':')[0]] = 1; }); });
    if (cats.poisson) t.poisson = 1;
    if (cats.legSecs) t.legSecs = 1;
    if (!cats.viande && !cats.volaille && !cats.charcuterie && !cats.poisson) t.vegetarien = 1;
    if (r.jours) t.weekend = 1;
    return t;
  }
  function coutFamille(r) {
    var R = cache.ctx.rec[r.id]; return cache.ev.personnes.reduce(function (t, pr) { return t + R.Cu + pr.F * R.Cs; }, 0);
  }
  function rendreRecettes() {
    var h = '<div class="filtres"><div class="segmente" role="group" aria-label="Moment">' +
      [['tous', 'Toutes'], ['matin', 'Petit-déjeuner'], ['repas', 'Déjeuner et dîner'], ['gouter', 'Goûter']].map(function (o) {
        return '<button data-action="filtre-moment" data-m="' + o[0] + '" aria-pressed="' + (vue.moment === o[0]) + '">' + o[1] + '</button>';
      }).join('') + '</div>' +
      '<div class="segmente" role="group" aria-label="Filtre">' + Object.keys(TAGS).map(function (t) {
        return '<button data-action="filtre-tag" data-t="' + t + '" aria-pressed="' + (vue.tag === t) + '">' + TAGS[t] + '</button>';
      }).join('') + '</div>' +
      (etat.prepMax ? '<button class="btn" data-action="filtre-rapides" aria-pressed="' + vue.rapides + '">Préparation ≤ ' + etat.prepMax + ' min</button>' : '') +
      '<input type="search" data-action="recherche" placeholder="Chercher une recette ou un ingrédient" value="' + esc(vue.recherche) + '" aria-label="Chercher une recette" style="flex:1 1 220px"></div>';
    var q = vue.recherche.trim().toLowerCase();
    var liste = N.RECS.filter(function (r) {
      if (r.exterieur) return false;
      if (vue.moment === 'repas' && r.moments.indexOf('midi') < 0 && r.moments.indexOf('soir') < 0) return false;
      if (vue.moment !== 'tous' && vue.moment !== 'repas' && r.moments.indexOf(vue.moment) < 0) return false;
      if (vue.tag && !tagsRecette(r)[vue.tag]) return false;
      if (vue.rapides && !N.prepOk(etat, r)) return false;
      if (q) { var txt = (r.nom + ' ' + r.lignes.map(function (l) { return N.AL[l.f].nom; }).join(' ')).toLowerCase(); if (txt.indexOf(q) < 0) return false; }
      return true;
    });
    h += '<p class="muet petit">' + liste.length + ' recette' + (liste.length > 1 ? 's' : '') + '. Les quantités de référence correspondent à une portion moyenne ; chaque personne reçoit sa part selon ses besoins (onglet Foyer).</p>';
    h += '<div class="recettes">' + liste.map(function (r) {
      var R = cache.ctx.rec[r.id], V = function (k) { return R.Vu[N.KI[k]] + R.Vs[N.KI[k]]; };
      var t = tagsRecette(r);
      return '<button class="recette" data-action="ouvrir-recette" data-id="' + r.id + '"><h3>' + esc(r.nom) + '</h3>' +
        '<div>' + r.moments.map(function (m) { return '<span class="etiquette">' + { matin: 'petit-déjeuner', midi: 'déjeuner', soir: 'dîner', gouter: 'goûter' }[m] + '</span>'; }).join('') +
        Object.keys(t).map(function (x) { return '<span class="etiquette">' + TAGS[x].toLowerCase() + '</span>'; }).join('') + '</div>' +
        '<div class="mini-nutri"><span>Mg <b>' + nb(V('mg')) + '</b> mg</span><span>Fe <b>' + nb(V('fe'), 1) + '</b> mg</span><span>Ca <b>' + nb(V('ca')) + '</b> mg</span><span><b>' + nb(V('kcal')) + '</b> kcal</span></div>' +
        '<div class="muet petit">Préparation ' + r.prep + ' min' + (r.cuisson ? ' + cuisson ' + r.cuisson + ' min' : '') + ' · ' + euro(coutFamille(r)) + ' pour le foyer' +
        (N.prepOk(etat, r) ? '' : ' <span class="pastille st-proche">plus de ' + etat.prepMax + ' min</span>') + '</div></button>';
    }).join('') + '</div>';
    return h;
  }
  function ouvrirRecette(id) {
    var r = N.RECETTE[id], R = cache.ctx.rec[id], ev = cache.ev;
    var dlg = document.getElementById('dlgRecette');
    var h = '<div class="dlg-tete"><div><h2>' + esc(r.nom) + '</h2><p class="muet petit" style="margin:4px 0 0">Préparation ' + r.prep + ' min (hors cuisson)' + (r.cuisson ? ', cuisson ' + r.cuisson + ' min' : '') +
      ' — ' + euro(coutFamille(r)) + ' pour le foyer' + (N.prepOk(etat, r) ? '' : ' — plus long que les ' + etat.prepMax + ' min choisies, le générateur ne la propose pas') + '</p></div><button class="btn" data-action="fermer-dlg">Fermer</button></div><div class="dlg-corps">';
    h += '<h3>Ingrédients</h3><div class="table-defile"><table><thead><tr><th>Ingrédient</th><th class="n">Portion de référence</th>' +
      etat.personnes.map(function (p) { return '<th class="n">' + esc(p.nom) + '</th>'; }).join('') + '<th class="n">Foyer</th></tr></thead><tbody>';
    r.lignes.forEach(function (l) {
      var fid = N.aliment(l.f, etat), a = N.AL[fid];
      var parts = ev.personnes.map(function (pr) { return l.u ? l.q : l.q * pr.F; });
      var tot = parts.reduce(function (t, x) { return t + x; }, 0);
      h += '<tr><td>' + esc(a.nom) + (l.u ? ' <span class="muet petit">(portion entière par personne)</span>' : '') + '<div class="muet petit" title="' + esc(a.ciqualNom) + '">CIQUAL ' + esc(a.ciqual) + '</div></td><td class="n">' + qteCuisine(fid, l.q) + '</td>' +
        parts.map(function (x) { return '<td class="n">' + qteCuisine(fid, x) + '</td>'; }).join('') + '<td class="n"><b>' + qteCuisine(fid, tot) + '</b></td></tr>';
    });
    h += '</tbody></table></div>';
    if (r.placard && r.placard.length) h += '<p class="petit">Du placard (non comptés) : ' + esc(r.placard.join(', ')) + '.</p>';
    h += '<h3 style="margin-top:12px">Préparation</h3><ol class="etapes">' + r.etapes.map(function (e) { return '<li>' + esc(e) + '</li>'; }).join('') + '</ol>';
    h += '<h3>Apports par personne pour ce repas</h3><div class="table-defile"><table><thead><tr><th>Nutriment</th>' + etat.personnes.map(function (p) { return '<th class="n">' + esc(p.nom) + '</th>'; }).join('') + '</tr></thead><tbody>';
    ['kcal', 'prot', 'fib', 'ca', 'mg', 'fe', 'zn', 'i', 'vitC', 'b9', 'b12', 'vitD', 'epadha', 'na'].forEach(function (k) {
      h += '<tr><td>' + esc(N.INFO[k].nom) + '</td>' + ev.personnes.map(function (pr) {
        var v = R.Vu[N.KI[k]] + pr.F * R.Vs[N.KI[k]], ref = pr.refs[k];
        return '<td class="n">' + valAff(k, v) + (ref && (ref.t === 'RNP' || ref.t === 'AS') ? ' <span class="muet petit">(' + pct(v / ref.v) + ')</span>' : '') + '</td>';
      }).join('') + '</tr>';
    });
    h += '</tbody></table></div><p class="petit muet">Pourcentages : part du repère journalier de chaque personne apportée par ce seul repas. Données CIQUAL 2025.</p>';
    if (!r.exterieur) {
      h += '<h3 style="margin-top:12px">Placer dans la semaine</h3><div class="rang"><select id="placerJour">' + N.JOURS.map(function (j, d) { return '<option value="' + d + '">' + j + '</option>'; }).join('') + '</select>' +
        '<select id="placerMoment">' + N.MOMENTS.map(function (m, s) { return r.moments.indexOf(m.k) >= 0 ? '<option value="' + s + '">' + m.nom + '</option>' : ''; }).join('') + '</select>' +
        '<button class="btn btn-principal" data-action="placer" data-id="' + id + '">Placer</button></div>';
    }
    h += '</div>';
    dlg.innerHTML = h;
    if (typeof dlg.showModal === 'function') { if (!dlg.open) dlg.showModal(); } else dlg.setAttribute('open', '');
  }

  // ------------------------------------------------------------------ onglet Courses
  function rendreCourses() {
    var L = cache.liste, coches = etat.coches;
    var reste = L.lignes.reduce(function (t, l) { return t + (coches[l.achat] ? 0 : l.ticket); }, 0);
    var h = '<div class="kpis"><div class="kpi"><div class="val">' + euro(reste) + '</div><div class="lib">Reste à acheter (articles non cochés, paquets entiers)</div></div>' +
      '<div class="kpi"><div class="val">' + euro(L.total) + '</div><div class="lib">Ticket si tout est acheté neuf</div></div>' +
      '<div class="kpi"><div class="val">' + euro(L.consomme) + '</div><div class="lib">Coût des aliments consommés dans la semaine</div></div></div>';
    h += '<div class="barre-actions"><button class="btn" data-action="copier-liste">Copier la liste</button><button class="btn" data-action="decocher">Tout décocher</button>' +
      '<span class="muet petit">Coche ce que tu as déjà ou ce qui est dans le chariot. Prix carrefour.fr du ' + new Date(N.D.meta.prixDate).toLocaleDateString('fr-FR') + ', modifiables dans l\'onglet Prix.</span></div>';
    var rayon = null;
    L.lignes.forEach(function (l) {
      if (l.rayon !== rayon) { if (rayon) h += '</div>'; rayon = l.rayon; h += '<div class="rayon"><h3>' + esc(rayon) + '</h3>'; }
      var c = !!coches[l.achat];
      h += '<label class="ligne-course' + (c ? ' coche' : '') + '"><input type="checkbox" data-action="cocher" data-a="' + l.achat + '"' + (c ? ' checked' : '') + '>' +
        '<span><span class="nom-art">' + esc(l.nom) + '</span> <span class="muet petit">' + esc(l.marque) + '</span></span>' +
        '<span class="besoin muet petit num">besoin ' + qte(l.besoin, l.unite) + '</span>' +
        '<span class="num">' + l.paquets + ' × ' + euro(l.prixPaquet) + '</span></label>';
    });
    if (rayon) h += '</div>';
    if (!L.lignes.length) h += '<p>La semaine est vide : génère un planning dans l\'onglet Semaine.</p>';
    if (L.placard.length) h += '<div class="section" style="margin-top:16px"><h3>À vérifier dans les placards (non comptés)</h3><p class="petit">' + esc(L.placard.join(', ')) + '.</p></div>';
    return h;
  }
  function texteListe() {
    var L = cache.liste, t = 'Courses de la semaine (Carrefour)\n', rayon = null;
    L.lignes.forEach(function (l) {
      if (etat.coches[l.achat]) return;
      if (l.rayon !== rayon) { rayon = l.rayon; t += '\n' + rayon + '\n'; }
      t += '- ' + l.nom + ' (' + l.marque + ') : ' + l.paquets + ' × ' + euro(l.prixPaquet) + '\n';
    });
    if (L.placard.length) t += '\nPlacard : ' + L.placard.join(', ') + '\n';
    return t;
  }

  // ------------------------------------------------------------------ onglet Prix
  function prixUnitaire(p) {
    if (p.unite === 'pc') return euro(p.prix / p.qte) + ' / pièce';
    var parK = p.prix / p.qte * 1000;
    return euro(parK) + (p.unite === 'ml' ? ' / L' : ' / kg');
  }
  function rendrePrix() {
    var q = vue.recherchePrix.trim().toLowerCase();
    var ids = Object.keys(N.ACH).filter(function (id) { var p = N.ACH[id]; return !q || (p.nom + ' ' + p.marque + ' ' + p.rayon).toLowerCase().indexOf(q) >= 0; });
    var nbMod = Object.keys(etat.prix).length;
    var h = '<div class="barre-actions"><input type="search" data-action="recherche-prix" placeholder="Filtrer les articles" value="' + esc(vue.recherchePrix) + '" aria-label="Filtrer les articles" style="flex:1 1 240px">' +
      '<button class="btn" data-action="prix-reset-tout"' + (nbMod ? '' : ' disabled') + '>Revenir à tous les prix relevés (' + nbMod + ' modifié' + (nbMod > 1 ? 's' : '') + ')</button></div>';
    h += '<p class="petit muet">Prix relevés sur ' + esc(N.D.meta.prixSrc) + ' le ' + datePrix() + (prixRecents().length ? ' (sauf date indiquée sous l\'article)' : '') + '. Les prix de ton magasin peuvent différer : corrige le prix ou le format, tout est recalculé et gardé' + (syncOn() ? ' (et synchronisé avec tes autres appareils)' : ' dans ce navigateur') + '.</p>';
    h += '<div class="table-defile"><table><thead><tr><th>Article</th><th>Rayon</th><th class="n">Format</th><th class="n">Prix</th><th class="n">Prix unitaire</th><th>Code-barres</th><th></th></tr></thead><tbody>';
    ids.forEach(function (id) {
      var p = N.prixEffectif(etat, id);
      h += '<tr class="' + (p.modifie ? 'modifie' : '') + '"><td>' + esc(p.nom) + '<div class="muet petit">' + esc(p.marque) + (p.date && p.date !== N.D.meta.prixDate ? ', relevé le ' + new Date(p.date).toLocaleDateString('fr-FR') : '') + '</div></td><td class="petit">' + esc(p.rayon) + '</td>' +
        '<td class="n"><input type="number" min="0.01" step="any" data-action="prix-qte" data-a="' + id + '" value="' + p.qte + '" aria-label="Format de ' + esc(p.nom) + '"> ' + (p.unite === 'pc' ? 'pc' : p.unite) + '</td>' +
        '<td class="n"><input type="number" min="0" step="0.01" data-action="prix-val" data-a="' + id + '" value="' + p.prix + '" aria-label="Prix de ' + esc(p.nom) + '"> €</td>' +
        '<td class="n petit">' + prixUnitaire(p) + '</td><td class="petit muet">' + esc(p.ean || '—') + '</td>' +
        '<td>' + (p.modifie ? '<button class="btn btn-mini" data-action="prix-reset" data-a="' + id + '">Prix relevé</button>' : '') + '</td></tr>';
    });
    h += '</tbody></table></div>';
    return h;
  }

  // ------------------------------------------------------------------ onglet Foyer
  function selectHTML(action, pi, options, val) {
    return '<select data-action="' + action + '" data-p="' + pi + '">' + options.map(function (o) { return '<option value="' + o[0] + '"' + (String(o[0]) === String(val) ? ' selected' : '') + '>' + o[1] + '</option>'; }).join('') + '</select>';
  }
  function optionsEaux(p) {
    return Object.keys(N.AL).filter(function (f) { return N.AL[f].cats.indexOf('eau') >= 0; }).map(function (f) {
      var a = N.AL[f], av = N.avertissementsEau(f, p);
      return [f, a.nom + ' (Ca ' + nb((a.v.ca || 0) * 10) + ', Mg ' + nb((a.v.mg || 0) * 10) + ' mg/L)' + (av.length ? ' ⚠' : '')];
    });
  }
  function avertissementsEauHTML(p) {
    var av = N.avertissementsEau(p.eau, p);
    if (!av.length) return '';
    var et = N.AL[p.eau].etiquette;
    return '<div class="note' + (av.some(function (x) { return x.grave; }) ? ' note-grave' : '') + '"><b>' + esc(N.AL[p.eau].nom) + '</b> : ' +
      av.map(function (x) { return esc(x.texte); }).join(' ; ') + '.' + (et && et.src ? ' <span class="muet">Source : ' + esc(et.src) + '.</span>' : '') + '</div>';
  }
  function rendreFoyer() {
    var ev = cache.ev;
    var h = '';
    if (!stockageOk) h += '<div class="note">Ce navigateur refuse la sauvegarde locale : l\'outil fonctionne, mais tes réglages seront perdus à la fermeture. Utilise « Exporter » pour les garder.</div>';
    h += '<div class="personnes">';
    etat.personnes.forEach(function (p, i) {
      var pr = ev.personnes[i], R = pr.refs;
      h += '<div class="carte"><h3>' + esc(p.nom) + '</h3><div class="formulaire">' +
        '<label class="champ large">Prénom ou nom affiché<input type="text" data-action="p-champ" data-c="nom" data-p="' + i + '" value="' + esc(p.nom) + '"></label>' +
        '<label class="champ">Sexe' + (p.type === 'adulte' ? selectHTML('p-sexe', i, [['H', 'homme'], ['F', 'femme']], p.sexe) : selectHTML('p-sexe', i, [['NP', 'non précisé'], ['G', 'garçon'], ['F', 'fille']], p.sexe)) + '</label>' +
        '<label class="champ">Âge (ans)<input type="number" min="' + (p.type === 'adulte' ? 18 : 3) + '" max="' + (p.type === 'adulte' ? 100 : 17) + '" data-action="p-num" data-c="age" data-p="' + i + '" value="' + p.age + '"></label>' +
        '<label class="champ">Poids (kg)<input type="number" min="10" max="250" step="0.5" data-action="p-num" data-c="poids" data-p="' + i + '" value="' + p.poids + '"></label>' +
        '<label class="champ">Taille (cm)<input type="number" min="80" max="230" data-action="p-num" data-c="taille" data-p="' + i + '" value="' + p.taille + '"></label>' +
        (p.type === 'adulte'
          ? '<label class="champ">Activité' + selectHTML('p-nap', i, [[1.4, 'sédentaire'], [1.6, 'active'], [1.8, 'très active'], [2.0, 'sportive']], p.nap) + '</label>' +
            (p.sexe === 'F' ? '<label class="champ">Besoin en fer' + selectHTML('p-fer', i, [['normal', 'règles faibles à modérées (11 mg)'], ['eleve', 'règles abondantes (16 mg)'], ['menopause', 'ménopausée (11 mg)']], p.fer) + '</label>' : '<span></span>')
          : '<label class="champ">Activité' + selectHTML('p-activite', i, [['faible', 'plutôt calme (NAP 1,4)'], ['moyenne', 'moyenne (NAP 1,6)'], ['elevee', 'très active (NAP 1,8)']], p.activite) + '</label><span></span>') +
        '<label class="champ">Énergie imposée (kcal/j, vide = calcul)<input type="number" min="800" max="5000" step="50" data-action="p-energie" data-p="' + i + '" value="' + (p.energieManuelle || '') + '"></label>' +
        '<label class="champ">Portions' + selectHTML('p-fmode', i, [['auto', 'calées sur le besoin'], ['manuel', 'facteur fixe']], p.facteurMode) + '</label>' +
        (p.facteurMode === 'manuel' ? '<label class="champ">Facteur fixe<input type="number" min="0.3" max="2" step="0.05" data-action="p-num" data-c="facteurManuel" data-p="' + i + '" value="' + p.facteurManuel + '"></label>' : '') +
        '<label class="champ">Apport en phytates (pour le zinc)' + selectHTML('p-phyt', i, [[300, 'faible (300 mg/j)'], [600, 'modéré (600 mg/j)'], [900, 'élevé (900 mg/j)']], p.phytates) + '</label>' +
        '<label class="champ large">Eau de boisson' + selectHTML('p-eau', i, optionsEaux(p), p.eau) + '</label>' +
        '<label class="champ">Eau bue par jour (ml)<input type="number" min="0" max="4000" step="50" data-action="p-num" data-c="eauMl" data-p="' + i + '" value="' + p.eauMl + '"></label></div>' +
        '<p class="petit muet">Besoin : <b>' + nb(pr.E) + ' kcal/j</b>' + (p.energieManuelle ? ' (valeur imposée)' : (p.type === 'enfant' ? ' (calculé d\'après le poids et l\'activité)' : ' (calculé d\'après le poids, la taille, l\'âge et l\'activité)')) +
        ', portions × ' + nb(pr.F, 2) + '. Repères : calcium ' + valAff('ca', R.ca.v) + ', magnésium ' + valAff('mg', R.mg.v) + ', fer ' + valAff('fe', R.fe.v) + ', zinc ' + valAff('zn', R.zn.v) + '.</p>' +
        avertissementsEauHTML(p) +
        '<h3 style="margin-top:10px">À la maison</h3><p class="petit muet">Décoche un créneau quand la personne mange ailleurs (cantine, travail) : le repas est alors estimé dans le bilan et retiré des courses.</p>' +
        '<div class="presence"><span></span>' + N.JOURS.map(function (j) { return '<span>' + j.slice(0, 3) + '</span>'; }).join('') +
        N.MOMENTS.map(function (m, s) {
          return '<span class="lib">' + m.nom.replace('Petit-déjeuner', 'Matin').replace('Goûter de 16 h', 'Goûter') + '</span>' + N.JOURS.map(function (j, d) {
            return '<input type="checkbox" data-action="presence" data-p="' + i + '" data-d="' + d + '" data-s="' + s + '"' + (p.presence[d][s] ? ' checked' : '') + ' aria-label="' + esc(p.nom + ', ' + m.nom + ' du ' + j) + '">';
          }).join('');
        }).join('') + '</div>' +
        '<div class="rang" style="margin-top:8px">' + (p.type === 'enfant'
          ? '<button class="btn btn-mini" data-action="preset" data-p="' + i + '" data-v="cantine">Cantine lun, mar, jeu, ven</button>'
          : '<button class="btn btn-mini" data-action="preset" data-p="' + i + '" data-v="travail">Déjeuner au travail en semaine</button>') +
        '<button class="btn btn-mini" data-action="preset" data-p="' + i + '" data-v="maison">Tout à la maison</button></div></div>';
    });
    h += '</div>';
    var b = etat.budgetJour, cj = ev.coutJours;
    h += '<div class="section" style="margin-top:18px"><h2>Budget, temps de préparation et horaires</h2><div class="carte"><div class="formulaire">' +
      '<label class="champ">Budget maximum par jour (€, 0 = sans limite)<input type="number" min="0" max="500" step="0.5" data-action="budget-max" value="' + b.max + '"></label>' +
      '<label class="champ">Cible par jour (€, 0 = aucune)<input type="number" min="0" max="500" step="0.5" data-action="budget-cible" value="' + b.cible + '"></label>' +
      '<label class="champ">Préparation au plus (hors cuisson)<select data-action="prep-max">' + N.PREP_CHOIX.map(function (m) {
        return '<option value="' + m + '"' + (etat.prepMax === m ? ' selected' : '') + '>' + (m ? m + ' min' : 'sans limite') + '</option>';
      }).join('') + '</select></label><span></span>' +
      N.MOMENTS.map(function (m, s) {
        return '<label class="champ">Heure du ' + esc(m.nom.replace('Goûter de 16 h', 'goûter').toLowerCase()) + '<input type="time" data-action="horaire" data-s="' + s + '" value="' + etat.horaires[s] + '"></label>';
      }).join('') + '</div>' +
      '<p class="petit muet">Le coût du jour compte ce qui est mangé à la maison (au prorata des paquets) et l\'eau de boisson ; les repas pris dehors n\'y sont pas. Le générateur ne propose aucun jour au-dessus du maximum quand c\'est possible et s\'approche de la cible si l\'équilibre le permet. Semaine actuelle : ' +
      euro(ev.cout / 7) + ' par jour en moyenne, de ' + euro(Math.min.apply(null, cj)) + ' à ' + euro(Math.max.apply(null, cj)) + '. Les heures servent au « Prochain repas » (heure à laquelle commencer).</p>' +
      '<div class="rang" style="margin-top:6px"><label class="rang"><input type="checkbox" data-action="sub-lait"' + (etat.substitutions.lait === 'laitD' ? ' checked' : '') + '> Utiliser du lait demi-écrémé enrichi en vitamine D (Lactel, ' + euro(N.ACH.laitD.prix) + ' le litre)</label></div></div></div>';
    h += rendreSyncCarte();
    h += '<div class="section"><h2>Données</h2><div class="carte"><div class="rang">' +
      '<button class="btn" data-action="exporter">Exporter mes réglages (JSON)</button>' +
      '<label class="btn">Importer…<input type="file" accept="application/json,.json" data-action="importer" hidden></label>' +
      '<button class="btn" data-action="reinitialiser">Tout réinitialiser</button></div>' +
      '<p class="petit muet" style="margin-top:8px">' + (syncOn() ? 'Les réglages, le planning, les prix, les coches de courses et les repas préparés sont synchronisés avec le dépôt GitHub privé (voir ci-dessus). ' : 'Sans synchronisation, tout reste dans ce navigateur (rien n\'est envoyé). ') +
      'L\'export sert de sauvegarde ; il ne contient jamais le jeton GitHub.</p></div></div>';
    return h;
  }

  // ------------------------------------------------------------------ onglet Méthode
  function rendreMethode() {
    var audit = N.auditMecanismes(), ok = audit.filter(function (a) { return a.ok; }).length;
    var h = '<div class="section"><h2>Ce que fait l\'outil</h2><div class="carte"><p>Pour chaque personne, l\'outil additionne ce qu\'apportent les recettes de la semaine (et l\'eau bue), compare la moyenne journalière aux références de l\'ANSES et signale ce qui manque ou dépasse. Le générateur cherche, parmi ' + N.RECS.filter(function (r) { return !r.exterieur; }).length + ' recettes, la combinaison qui couvre le mieux les besoins des trois personnes en respectant les repères du PNNS, la variété, ton budget par jour et ton temps de préparation.</p>' +
      '<p class="petit muet">Outil d\'information, pas un avis médical. En cas de régime particulier, d\'allergie, de grossesse ou de croissance qui inquiète, l\'avis du médecin ou d\'un diététicien prime. Les compléments alimentaires (vitamine D notamment) ne sont pas calculés : ils se discutent avec le médecin.</p></div></div>';
    h += '<div class="section"><h2>Sources</h2><div class="carte"><ul class="liste-simple">' +
      '<li>Composition des aliments : ' + esc(N.D.meta.ciqualVersion) + ', ANSES. Chaque aliment de l\'outil renvoie à son code CIQUAL (onglet Recettes, détail).</li>' +
      '<li>Références en vitamines et minéraux : ANSES, page « Les références nutritionnelles en vitamines et minéraux » (21/02/2025). Adultes : RNP ou AS, limites supérieures de sécurité. Enfant : tranches 4-10 et 7-10 ans.</li>' +
      '<li>Lipides et oméga-3 : ANSES 2011 (ALA 1 % de l\'énergie ; EPA 250 mg et DHA 250 mg chez l\'adulte ; acides gras saturés au plus 12 % de l\'énergie). Enfant 7-10 ans : EPA + DHA 250 mg, fibres 16 g (ANSES 2019).</li>' +
      '<li>Sucres hors lactose et galactose : ANSES 2016 (100 g/j adulte, 60 g/j de 4 à 7 ans, 75 g/j de 8 à 12 ans).</li>' +
      '<li>Énergie des adultes : équation de Black et al. (1996) multipliée par le niveau d\'activité. Énergie de l\'enfant : métabolisme de base de Schofield (OMS 1985) d\'après le poids, multiplié par le niveau d\'activité (1,4, 1,6 ou 1,8) et augmenté de 1 % pour la croissance ; au poids de référence des 7-10 ans (environ 28 kg) on retrouve les 1 851 kcal (garçon) et 1 726 kcal (fille) de l\'ANSES 2019, un enfant de 7 ans pesant 23 kg a besoin d\'environ 1 600 kcal. Protéines : 0,83 g/kg/j (adulte, ANSES), 0,91 g/kg/j à 7 ans (EFSA 2012).</li>' +
      '<li>Eaux de boisson : calcium, magnésium et sodium de la table CIQUAL ; sulfates, fluor et résidu sec des étiquettes (tableau Nestlé Waters de juin 2024, fiches carrefour.fr, fiche Rozana). Mises en garde aux seuils des directives européennes : fluor au-delà de 1,5 mg/L (mention obligatoire pour les moins de 7 ans), « contient du sodium » au-delà de 200 mg/L, « riche en sels minéraux » au-delà de 1 500 mg/L ; sulfates au-delà de 1 000 mg/L : effet laxatif possible.</li>' +
      '<li>Repères de consommation : PNNS, Santé publique France ; enfants 4-11 ans : Santé publique France (2024).</li>' +
      '<li>Prix : ' + esc(N.D.meta.prixSrc) + ', relevés le ' + datePrix() + prixRecents().map(function (id) { return ' ; ' + esc(N.ACH[id].nom) + ' le ' + new Date(N.ACH[id].date).toLocaleDateString('fr-FR'); }).join('') + '. Eau magnésienne Carrefour : composition de l\'étiquette (source Prince Noir, Ca 541 mg/L, Mg 85 mg/L).</li></ul></div></div>';
    h += '<div class="section"><h2>Budget, préparation, prochain repas, synchronisation</h2><div class="carte"><ul class="liste-simple">' +
      '<li>Budget par jour : coût des repas pris à la maison ce jour-là (au prorata de ce qui est mangé, chaque personne avec sa portion) plus l\'eau de boisson. Le générateur pénalise fortement tout jour au-dessus du maximum (un palier plus 2 points par euro de trop, bien plus que ce qu\'une recette chère apporte en nutriments) et légèrement chaque euro au-dessus de la cible (0,15 point). Mesuré sur 100 semaines générées avec le foyer par défaut (maximum 12 €, cible 10 €) : aucun jour au-dessus de 12 €, 11,09 € par jour en moyenne (13,30 € sans budget). Un maximum de 10 € n\'est tenu que 37 % des jours avec ces recettes : le foyer a besoin de près de 6 400 kcal par jour et chaque plat ne revient qu\'une fois par semaine. Le budget coûte un peu d\'équilibre : vitamine B6 à 88 % du repère en moyenne (110 % sans budget), tous les repères du PNNS restant atteints.</li>' +
      '<li>Préparation : temps de travail en cuisine hors cuisson (éplucher, couper, mélanger, assembler), tel qu\'indiqué sur chaque recette. Au-delà du maximum choisi, le générateur ne propose pas la recette ; choisie à la main, elle est signalée.</li>' +
      '<li>Prochain repas : le planning est une semaine type ; le jour de la semaine donne la colonne, les heures des repas (onglet Foyer) donnent l\'ordre. Un repas reste affiché jusqu\'à 45 minutes après son heure, ou jusqu\'à « C\'est prêt ». Les quantités affichées sont celles des personnes présentes, chacune avec sa portion.</li>' +
      '<li>Synchronisation : comme l\'outil NHL, un dépôt GitHub privé à ton nom garde un fichier <code>equilibre/etat.json</code>. Chaque partie (foyer, semaine, prix, réglages) porte la date de sa dernière modification et la plus récente l\'emporte ; coches de courses et repas préparés se fusionnent un par un. Le jeton d\'accès reste dans le navigateur de chaque appareil : il n\'est ni exporté, ni envoyé dans le dépôt. Un dépôt public est refusé.</li></ul></div></div>';
    h += '<div class="section"><h2>Conventions de calcul</h2><div class="carte"><ul class="liste-simple">' +
      '<li>Les quantités des recettes sont celles qu\'on pèse : féculents et légumes secs secs, viandes crues, fruits et légumes épluchés.</li>' +
      '<li>Rendement : quand la valeur CIQUAL utilisée est celle de l\'aliment cuit, la quantité pesée est convertie (ex. pâtes : × 2,18, rapport des énergies sec/cuit). Les pertes de vitamines à la cuisson sont ainsi incluses.</li>' +
      '<li>Partie comestible : les quantités à acheter tiennent compte des épluchures, os et coquilles (banane 67 %, cuisse de poulet 72 %, moules 22 % de chair…).</li>' +
      '<li>Valeurs CIQUAL « traces » ou « inférieur à » : comptées à zéro. Valeurs absentes : comptées à zéro et signalées (taux de complétude). B12, vitamine D, EPA et DHA absents d\'un aliment végétal : zéro, ces nutriments n\'existant pas dans les végétaux.</li>' +
      '<li>Portions : chaque personne reçoit les plats multipliés par son facteur, calé pour que l\'énergie de la semaine corresponde à son besoin. Yaourt, fruit et verre de lait restent des portions entières.</li>' +
      '<li>Repas pris dehors : estimés par un repas type de cantine (crudités, viande blanche, féculent, légume, laitage, fruit, pain), comptés dans le bilan mais pas dans les courses ni le coût.</li>' +
      '<li>Coût consommé : prix au prorata de ce qui est mangé. Ticket : paquets entiers, sans tenir compte de ce qui reste dans les placards.</li></ul></div></div>';
    h += '<div class="section"><h2>Aliments utilisés et correspondance CIQUAL</h2><div class="table-defile"><table><thead><tr><th>Aliment</th><th>Code</th><th>Libellé CIQUAL 2025</th><th class="n">Rendement</th><th>Article Carrefour</th><th class="n">Partie comestible</th></tr></thead><tbody>' +
      Object.keys(N.AL).map(function (f) {
        var al = N.AL[f], ac = N.ACH[al.achat];
        return '<tr><td>' + esc(al.nom) + '</td><td class="num">' + esc(al.ciqual) + '</td><td class="petit">' + esc(al.ciqualNom) + '</td><td class="n">' + (al.y !== 1 ? '× ' + nb(al.y, 2) : '—') + '</td><td class="petit">' + esc(ac.nom) + '</td><td class="n">' + (ac.comest < 1 ? pct(ac.comest) : (ac.gpc ? nb(ac.gpc) + ' g/pièce' : '—')) + '</td></tr>';
      }).join('') + '</tbody></table></div></div>';
    h += '<div class="section"><h2>Audit des mécanismes (' + ok + '/' + audit.length + ')</h2><div class="table-defile"><table><thead><tr><th>Mécanisme</th><th>Fonction</th><th>Contrôle</th></tr></thead><tbody>' +
      audit.map(function (a) { return '<tr><td>' + esc(a.nom) + '</td><td class="petit"><code>' + esc(a.fn) + '</code></td><td><span class="pastille st-' + (a.ok ? 'ok' : 'bas') + '">' + (a.ok ? 'fonctionne' : 'en échec') + '</span> ' + esc(a.detail) + '</td></tr>'; }).join('') +
      '</tbody></table></div><p class="petit muet">Chaque mécanisme est testé à l\'ouverture de cet onglet avec des données connues. Le même contrôle est fait hors navigateur par <code>node verif_exigences.js</code>.</p></div>';
    if (EXIGENCES.length) {
      h += '<div class="section"><h2>Exigences de l\'outil</h2><div class="table-defile"><table><thead><tr><th>Réf.</th><th>Exigence</th></tr></thead><tbody>' +
        EXIGENCES.map(function (e) { return '<tr><td class="num">' + esc(e.id) + '</td><td>' + esc(e.texte) + '</td></tr>'; }).join('') + '</tbody></table></div></div>';
    }
    h += '<p class="petit muet">Version ' + N.VERSION + '.</p>';
    return h;
  }

  // ------------------------------------------------------------------ rendu général
  function rendre(garderFocus) {
    var actif = garderFocus && document.activeElement && document.activeElement.dataset ? document.activeElement : null;
    var cle = actif ? [actif.dataset.action, actif.dataset.p, actif.dataset.c, actif.dataset.a, actif.dataset.d, actif.dataset.s].join('|') : null;
    rendreEntete();
    var c = document.getElementById('contenu'), h = rendreLienRecu();
    switch (vue.onglet) {
      case 'aujourdhui': h += rendreAujourdhui(); break;
      case 'semaine': h += rendreSemaine(); break;
      case 'bilan': h += rendreBilan(); break;
      case 'recettes': h += rendreRecettes(); break;
      case 'courses': h += rendreCourses(); break;
      case 'prix': h += rendrePrix(); break;
      case 'foyer': h += rendreFoyer(); break;
      case 'methode': h += rendreMethode(); break;
    }
    c.innerHTML = h;
    vue.cleProchain = cleProchain();
    if (cle) {
      var el = Array.prototype.filter.call(c.querySelectorAll('[data-action]'), function (e) {
        return [e.dataset.action, e.dataset.p, e.dataset.c, e.dataset.a, e.dataset.d, e.dataset.s].join('|') === cle;
      })[0];
      if (el) { el.focus(); if (el.setSelectionRange && el.type === 'text') { try { var n = el.value.length; el.setSelectionRange(n, n); } catch (e) { /* type sans sélection */ } } }
    }
  }

  // ------------------------------------------------------------------ événements
  document.querySelector('.onglets').addEventListener('click', function (e) {
    var b = e.target.closest('button[data-onglet]'); if (!b) return;
    vue.onglet = b.dataset.onglet; rendre(); window.scrollTo(0, 0);
  });

  function surAction(e) {
    var el = e.target.closest('[data-action]'); if (!el) return;
    var a = el.dataset.action, p = el.dataset.p != null ? Number(el.dataset.p) : null;
    var d = el.dataset.d != null ? Number(el.dataset.d) : null, s = el.dataset.s != null ? Number(el.dataset.s) : null;
    if (e.type === 'click') {
      switch (a) {
        case 'generer': generer('aleatoire'); return;
        case 'ameliorer': generer('actuel'); return;
        case 'imprimer': window.print(); return;
        case 'vider': if (confirm('Vider toute la semaine (les créneaux verrouillés aussi) ?')) changer(function () { etat.plan = N.grille(null); etat.verrous = N.grille(false); }); return;
        case 'verrou': changer(function () { etat.verrous[d][s] = !etat.verrous[d][s]; }); return;
        case 'ouvrir-recette': ouvrirRecette(el.dataset.id); return;
        case 'fermer-dlg': fermerDialogue(); return;
        case 'placer':
          var dj = Number(document.getElementById('placerJour').value), sm = Number(document.getElementById('placerMoment').value), id = el.dataset.id;
          if (N.RECETTE[id].jours && N.RECETTE[id].jours.indexOf(dj) < 0) { toast('Cette recette est prévue pour ' + N.RECETTE[id].jours.map(function (x) { return N.JOURS[x].toLowerCase(); }).join(', ') + '.'); }
          changer(function () { etat.plan[dj][sm] = id; etat.verrous[dj][sm] = true; });
          fermerDialogue(); toast('Placé ' + N.JOURS[dj].toLowerCase() + ', ' + N.MOMENTS[sm].nom.toLowerCase() + ' (verrouillé).'); return;
        case 'voir-nutriment': vue.onglet = 'bilan'; vue.personne = p; vue.nutriment = el.dataset.k; vue.periode = -1; rendre(); window.scrollTo(0, 0); return;
        case 'personne': vue.personne = p; rendre(); return;
        case 'tuile': vue.nutriment = el.dataset.k; rendre(); return;
        case 'filtre-moment': vue.moment = el.dataset.m; rendre(); return;
        case 'filtre-tag': vue.tag = vue.tag === el.dataset.t ? null : el.dataset.t; rendre(); return;
        case 'copier-liste':
          var txt = texteListe();
          if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(txt).then(function () { toast('Liste copiée.'); }, function () { secoursCopie(txt); });
          else secoursCopie(txt);
          return;
        case 'decocher': changer(function () { etat.coches = {}; }); return;
        case 'prix-reset': changer(function () { delete etat.prix[el.dataset.a]; }); return;
        case 'prix-reset-tout': if (confirm('Revenir à tous les prix relevés le ' + new Date(N.D.meta.prixDate).toLocaleDateString('fr-FR') + ' ?')) changer(function () { etat.prix = {}; }); return;
        case 'preset': changer(function () {
          var q = etat.personnes[p];
          for (var dd = 0; dd < 7; dd++) for (var ss = 0; ss < 4; ss++) {
            if (el.dataset.v === 'maison') q.presence[dd][ss] = true;
            else if (el.dataset.v === 'cantine') q.presence[dd][ss] = !(ss === 1 && [0, 1, 3, 4].indexOf(dd) >= 0);
            else if (el.dataset.v === 'travail') q.presence[dd][ss] = !(ss === 1 && dd < 5) && !(ss === 2 && dd < 5);
          }
        }); return;
        case 'exporter': exporter(); return;
        case 'reinitialiser': if (confirm('Effacer tous les réglages, prix modifiés et le planning ?' + (syncOn() ? ' (Tes autres appareils synchronisés recevront aussi la remise à zéro.)' : ''))) { etat = N.etatDefaut(); sauver(); recalculer(); generer('aleatoire', etat.graine); } return;
        case 'aller-prochain': vue.onglet = 'aujourdhui'; rendre(); window.scrollTo(0, 0); return;
        case 'repas-fait': changer(function () { etat.faits[el.dataset.cle] = true; N.nettoyerFaits(etat, horloge()); }); toast('Noté : le repas suivant est affiché.'); return;
        case 'repas-annuler': changer(function () { delete etat.faits[el.dataset.cle]; }); return;
        case 'filtre-rapides': vue.rapides = !vue.rapides; rendre(); return;
        case 'aller-sync': vue.onglet = 'foyer'; rendre(); var sc = document.getElementById('syncCarte'); if (sc && sc.scrollIntoView) sc.scrollIntoView({ block: 'start' }); return;
        case 's-enregistrer': syncEnregistrer(); return;
        case 's-maintenant':
          if (!syncOn()) { toast('Configure d\'abord la synchronisation.'); return; }
          syncNow('manuel').then(function (r) { toast(r.err ? 'Synchronisation : ' + r.err : (r.skip ? 'Synchronisation déjà en cours.' : 'Synchronisé : ' + (r.recu ? 'données reçues' : 'rien de nouveau à recevoir') + (r.envoye ? ', modifications envoyées.' : '.'))); });
          return;
        case 's-relier': vue.lienVisible = true; rendre(); return;
        case 's-masquer-lien': vue.lienVisible = false; rendre(); return;
        case 's-copier-lien':
          var u = syncLienURL();
          if (!u) return;
          if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(u).then(function () { toast('Lien copié : ouvre-le sur l\'autre appareil.'); }, function () { toast('Copie impossible : sélectionne le lien à la main.'); });
          else toast('Copie impossible : sélectionne le lien à la main.');
          return;
        case 's-arreter':
          if (!syncOn()) return;
          SYNC = { owner: SYNC.owner, repo: SYNC.repo, device: SYNC.device, app: SYNC.app }; syncSaveCfg(); SYNC_RT.repo = null; vue.lienVisible = false; vue.syncBrouillon = null;
          rendre(); toast('Synchronisation arrêtée sur cet appareil (tes données y restent, le jeton est effacé).'); return;
        case 'lien-relier': syncRelier(); return;
        case 'lien-ignorer': vue.lienRecu = null; effacerHash(); rendre(); return;
      }
    }
    if (e.type === 'change' || e.type === 'input') {
      var v = el.value;
      switch (a) {
        case 'choisir': if (e.type === 'change' && v !== '__') changer(function () { etat.plan[d][s] = v || null; }); return;
        case 'iterations': changer(function () { etat.iterations = Number(v); }); return;
        case 'periode': vue.periode = Number(v); rendre(); return;
        case 'recherche': if (e.type === 'input') { vue.recherche = v; rendre(true); } return;
        case 'recherche-prix': if (e.type === 'input') { vue.recherchePrix = v; rendre(true); } return;
        case 'cocher': changer(function () { if (el.checked) etat.coches[el.dataset.a] = true; else delete etat.coches[el.dataset.a]; }); return;
        case 'prix-val': case 'prix-qte':
          if (e.type !== 'change') return;
          var x = Number(String(v).replace(',', '.'));
          if (!isFinite(x) || x < 0 || (a === 'prix-qte' && x <= 0)) { toast('Valeur invalide.'); rendre(); return; }
          changer(function () {
            var id = el.dataset.a, base = N.ACH[id], o = etat.prix[id] || {};
            if (a === 'prix-val') { if (Math.abs(x - base.prix) < 1e-9) delete o.prix; else o.prix = x; }
            else { if (Math.abs(x - base.qte) < 1e-9) delete o.qte; else o.qte = x; }
            if (Object.keys(o).length) etat.prix[id] = o; else delete etat.prix[id];
          }); return;
        case 'p-champ': if (e.type === 'change') changer(function () { etat.personnes[p].nom = String(v).trim().slice(0, 30) || etat.personnes[p].nom; }); return;
        case 'p-num':
          if (e.type !== 'change') return;
          changer(function () { etat.personnes[p][el.dataset.c] = Number(v); etat = N.normaliserEtat(etat); }); return;
        case 'p-energie': if (e.type === 'change') changer(function () { etat.personnes[p].energieManuelle = v ? Number(v) : null; etat = N.normaliserEtat(etat); }); return;
        case 'p-sexe': changer(function () { etat.personnes[p].sexe = v; }); return;
        case 'p-nap': changer(function () { etat.personnes[p].nap = Number(v); }); return;
        case 'p-fer': changer(function () { etat.personnes[p].fer = v; }); return;
        case 'p-activite': changer(function () { etat.personnes[p].activite = v; }); return;
        case 'p-fmode': changer(function () { etat.personnes[p].facteurMode = v; if (v === 'manuel') etat.personnes[p].facteurManuel = Math.round(cache.ev.personnes[p].F * 20) / 20; }); return;
        case 'p-phyt': changer(function () { etat.personnes[p].phytates = Number(v); }); return;
        case 'p-eau': changer(function () { etat.personnes[p].eau = v; }); return;
        case 'presence': changer(function () { etat.personnes[p].presence[d][s] = el.checked; }); return;
        case 'sub-lait': changer(function () { etat.substitutions.lait = el.checked ? 'laitD' : 'lait'; }); return;
        case 'budget-max': case 'budget-cible':
          if (e.type !== 'change') return;
          var bv = Number(String(v).replace(',', '.'));
          if (!isFinite(bv) || bv < 0 || bv > 500) { toast('Montant invalide.'); rendre(); return; }
          changer(function () {
            if (a === 'budget-max') { etat.budgetJour.max = bv; if (bv > 0 && etat.budgetJour.cible > bv) etat.budgetJour.cible = bv; }
            else { etat.budgetJour.cible = (etat.budgetJour.max > 0 && bv > etat.budgetJour.max) ? etat.budgetJour.max : bv; }
          });
          toast('Budget enregistré : « Améliorer » ou « Générer » en tient compte.');
          return;
        case 'prep-max': changer(function () { etat.prepMax = Number(v); }); toast('Préparation au plus ' + (Number(v) ? v + ' min' : 'sans limite') + ' : « Améliorer » remplace les recettes plus longues.'); return;
        case 'horaire':
          if (e.type !== 'change') return;
          if (!N.heureValide(v)) { toast('Heure invalide.'); rendre(); return; }
          changer(function () { etat.horaires[s] = v; }); return;
        case 's-champ': if (e.type === 'input') { vue.syncBrouillon = vue.syncBrouillon || {}; vue.syncBrouillon[el.dataset.c] = v; } return;
        case 'importer': importer(el.files && el.files[0]); return;
      }
    }
  }
  document.getElementById('contenu').addEventListener('click', surAction);
  document.getElementById('contenu').addEventListener('change', surAction);
  document.getElementById('contenu').addEventListener('input', surAction);
  document.querySelector('.entete').addEventListener('click', surAction);
  document.getElementById('dlgRecette').addEventListener('click', function (e) {
    if (e.target === e.currentTarget) { fermerDialogue(); return; }
    surAction(e);
  });

  function fermerDialogue() { var dlg = document.getElementById('dlgRecette'); if (typeof dlg.close === 'function' && dlg.open) dlg.close(); else dlg.removeAttribute('open'); }
  function secoursCopie(txt) {
    var ta = document.createElement('textarea'); ta.value = txt; document.body.appendChild(ta); ta.select();
    var ok = false; try { ok = document.execCommand('copy'); } catch (e) { ok = false; }
    document.body.removeChild(ta); toast(ok ? 'Liste copiée.' : 'Copie impossible ici : sélectionne la liste à la main.');
  }
  function exporter() {
    var blob = new Blob([N.exporterEtat(etat)], { type: 'application/json' });
    var url = URL.createObjectURL(blob), lien = document.createElement('a');
    lien.href = url; lien.download = 'equilibre-alimentaire-' + new Date().toISOString().slice(0, 10) + '.json';
    document.body.appendChild(lien); lien.click(); document.body.removeChild(lien);
    setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
    toast('Réglages exportés.');
  }
  function importer(f) {
    if (!f) return;
    var r = new FileReader();
    r.onload = function () {
      try { etat = N.importerEtat(String(r.result)); sauver(); recalculer(); rendre(); toast('Réglages importés.'); }
      catch (e) { toast('Import impossible : ' + e.message); }
    };
    r.readAsText(f);
  }

  // ------------------------------------------------------------------ synchronisation entre appareils (GitHub)
  // Reprise de l'outil NHL : les données vont dans un dépôt GitHub PRIVÉ de l'utilisateur (API REST de GitHub, jeton à
  // accès limité à ce dépôt, gardé dans ce navigateur seulement, jamais exporté ni synchronisé ; un dépôt public est
  // refusé). Un seul fichier, equilibre/etat.json, dans son propre dossier : le dépôt des données NHL peut servir aux
  // deux outils. Échanges à l'ouverture, 4 s après une modification, au retour sur l'appli ou du réseau, toutes les 5 min.
  var SYNC_KEY = 'equilibre-sync', SYNC_META_KEY = 'equilibre-syncmeta';
  var SYNC_API = 'https://api.github.com', SYNC_EVERY = 5 * 60e3, SYNC_PATH = N.SYNC_CHEMIN;
  function lireJSON(k, d) { try { var v = backend ? JSON.parse(backend.getItem(k) || 'null') : null; return v == null ? d : v; } catch (e) { return d; } }
  function ecrireJSON(k, v) { try { if (backend) backend.setItem(k, JSON.stringify(v)); } catch (e) { /* stockage refusé : la synchro marche le temps de la visite */ } }
  var SYNC = lireJSON(SYNC_KEY, {});            // {owner, repo, token, device, app}
  var SYNC_META = lireJSON(SYNC_META_KEY, {});  // {sha, h, ok, err, errAt, n, plusRecente}
  var SYNC_RT = { busy: false, timer: null, due: 0, last: 0, again: false, repo: null };
  function syncOn() { return !!(SYNC && SYNC.owner && SYNC.repo && SYNC.token); }
  function syncSaveCfg() { ecrireJSON(SYNC_KEY, SYNC); }
  function syncSaveMeta() { ecrireJSON(SYNC_META_KEY, SYNC_META); }
  function syncDevGuess() { return /Android|iPhone|iPad|Mobile/i.test(navigator.userAgent || '') ? 'téléphone' : 'PC'; }
  // base64 en UTF-8 (accents, €) : l'API GitHub transporte les fichiers ainsi
  function b64enc(str) { var b = new TextEncoder().encode(str), s = ''; for (var i = 0; i < b.length; i += 0x8000) s += String.fromCharCode.apply(null, b.subarray(i, i + 0x8000)); return btoa(s); }
  function b64dec(b64) { var s = atob(String(b64).replace(/\s/g, '')), b = new Uint8Array(s.length); for (var i = 0; i < s.length; i++) b[i] = s.charCodeAt(i); return new TextDecoder().decode(b); }
  function b64url(s) { return b64enc(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''); }
  function b64urlDec(s) { s = String(s).replace(/-/g, '+').replace(/_/g, '/'); while (s.length % 4) s += '='; return b64dec(s); }
  function versionApres(a, b) {   // a plus récente que b ?
    var x = String(a || '0').split('.').map(Number), y = String(b || '0').split('.').map(Number);
    for (var i = 0; i < 3; i++) if ((x[i] || 0) !== (y[i] || 0)) return (x[i] || 0) > (y[i] || 0);
    return false;
  }
  var enc = encodeURIComponent;
  async function ghReq(method, path, body) {
    var ctl = typeof AbortController !== 'undefined' ? new AbortController() : null, to = ctl ? setTimeout(function () { ctl.abort(); }, 20000) : null;
    try {
      var init = { method: method, cache: 'no-store', headers: { Accept: 'application/vnd.github+json', Authorization: 'Bearer ' + SYNC.token } };
      if (ctl) init.signal = ctl.signal;
      if (body) { init.headers['Content-Type'] = 'application/json'; init.body = JSON.stringify(body); }
      var r = await fetch(SYNC_API + path, init), j = null;
      try { j = await r.json(); } catch (e) { j = null; }
      return { ok: r.ok, status: r.status, j: j, rem: r.headers && r.headers.get ? r.headers.get('x-ratelimit-remaining') : null };
    } catch (e) { return { ok: false, status: 0, j: null, err: e && e.name === 'AbortError' ? 'délai dépassé' : String(e && e.message || e) }; }
    finally { if (to) clearTimeout(to); }
  }
  function ghErr(r, quoi) {
    if (r.status === 0) return quoi + ' : pas de connexion (' + (r.err || 'réseau') + ') — la synchro reprendra';
    if (r.status === 401) return 'Jeton GitHub refusé (expiré ou mal copié) : crée-en un nouveau et colle-le ici (onglet Foyer → Synchronisation)';
    if (r.status === 403) return r.rem === '0' ? 'Limite d\'appels GitHub atteinte : nouvel essai dans une heure' : 'Le jeton GitHub n\'a pas le droit d\'écrire dans ce dépôt : il lui faut « Contents : Read and write »';
    if (r.status === 404) return 'Dépôt ' + SYNC.owner + '/' + SYNC.repo + ' introuvable pour ce jeton : vérifie le pseudo, le nom du dépôt, et que le jeton y a accès';
    return quoi + ' : erreur GitHub ' + r.status + (r.j && r.j.message ? ' (' + String(r.j.message).slice(0, 90) + ')' : '');
  }
  function ghRepo() { return '/repos/' + enc(SYNC.owner) + '/' + enc(SYNC.repo); }
  async function syncRepoInfo() {
    if (SYNC_RT.repo && SYNC_RT.repo.key === SYNC.owner + '/' + SYNC.repo && Date.now() - SYNC_RT.repo.at < 3600e3) return SYNC_RT.repo;
    var r = await ghReq('GET', ghRepo());
    if (!r.ok) throw new Error(ghErr(r, 'Dépôt'));
    if (r.j && r.j.private !== true) throw new Error('Le dépôt ' + SYNC.owner + '/' + SYNC.repo + ' est public : ton foyer, tes menus et tes courses y seraient visibles par tous. Rends-le privé (Settings → Change visibility), puis relance la synchro.');
    if (r.j && r.j.permissions && r.j.permissions.push === false) throw new Error('Le jeton GitHub ne permet que la lecture : il lui faut « Contents : Read and write »');
    SYNC_RT.repo = { key: SYNC.owner + '/' + SYNC.repo, at: Date.now(), branch: (r.j && r.j.default_branch) || 'main' };
    return SYNC_RT.repo;
  }
  async function syncDistant(branch) {   // sha du fichier dans le dépôt (null s'il n'y est pas) ; dépôt vide signalé
    var r = await ghReq('GET', ghRepo() + '/git/trees/' + enc(branch) + '?recursive=1');
    if (r.status === 409) return { vide: true, sha: null };                // dépôt encore vide (sans README)
    if (!r.ok) throw new Error(ghErr(r, 'Liste des fichiers'));
    var t = ((r.j && r.j.tree) || []).filter(function (x) { return x.type === 'blob' && x.path === SYNC_PATH; })[0];
    return { vide: false, sha: t ? t.sha : null };
  }
  async function syncBlob(sha) {
    var r = await ghReq('GET', ghRepo() + '/git/blobs/' + enc(sha));
    if (!r.ok) throw new Error(ghErr(r, 'Lecture'));
    return JSON.parse(b64dec(r.j.content || ''));
  }
  async function syncPut(texte, sha, branch) {
    var corps = { message: 'Synchro ' + (SYNC.device || 'appareil') + ' : ' + SYNC_PATH, content: b64enc(texte) };
    if (branch) corps.branch = branch;     // dépôt vide : branche par défaut
    if (sha) corps.sha = sha;
    var r = await ghReq('PUT', ghRepo() + '/contents/' + SYNC_PATH.split('/').map(enc).join('/'), corps);
    if (r.status === 409 || r.status === 422) return { conflit: true };      // modifié entre-temps par un autre appareil
    if (!r.ok) throw new Error(ghErr(r, 'Écriture'));
    return { sha: r.j && r.j.content && r.j.content.sha };
  }
  // empreinte du contenu sans la version de l'outil qui l'a écrit : deux versions ne se renvoient pas sans fin le fichier
  function empreinteFichier(o) { var c = {}; Object.keys(o || {}).forEach(function (k) { if (k !== 'ver') c[k] = o[k]; }); return N.hStr(N.canon(c)); }
  // données reçues d'un autre appareil : appliquées ici sans nouvelle date (elles ne doivent pas repartir comme neuves)
  function appliquerDistant(obj) {
    var f = N.fusionnerSync(etat, obj);
    if (!f.changements.length) { etat.maj = f.etat.maj; sauver(false); return false; }
    etat = f.etat; N.nettoyerFaits(etat, horloge()); sauver(false); recalculer();
    return true;
  }
  async function syncNow(pourquoi) {
    if (!syncOn()) return { skip: 'off' };
    if (SYNC_RT.busy || SYNC_RT.pause) { SYNC_RT.again = true; return { skip: 'busy' }; }
    if (typeof navigator !== 'undefined' && navigator.onLine === false) { SYNC_META.err = 'hors connexion — la synchro reprendra au retour du réseau'; SYNC_META.errAt = Date.now(); syncBadge(); return { skip: 'offline' }; }
    SYNC_RT.busy = true; syncBadge();
    var recu = false, envoye = false;
    try {
      var info = await syncRepoInfo();
      for (var essai = 1; ; essai++) {
        var D = await syncDistant(info.branch), distant = null;
        // 1) le fichier du dépôt a changé depuis la dernière fois : récupéré et fusionné
        if (D.sha && D.sha !== SYNC_META.sha) {
          distant = await syncBlob(D.sha);
          if (appliquerDistant(distant)) recu = true;
          SYNC_META.sha = D.sha; SYNC_META.h = empreinteFichier(distant);
          SYNC_META.plusRecente = distant && distant.ver && versionApres(distant.ver, N.VERSION) ? distant.ver : null;
        }
        if (!D.sha) { SYNC_META.sha = null; SYNC_META.h = null; }
        if (SYNC_META.plusRecente) break;   // une version plus récente de l'outil écrit ici : on lit sans écrire
        // 2) ce que cet appareil a de différent : envoyé (fichier modifié entre-temps → on recommence)
        var corps = N.fichierSync(etat), h = empreinteFichier(corps);
        if (D.sha && h === SYNC_META.h) break;
        corps.ver = N.VERSION;
        var w = await syncPut(N.canon(corps), D.sha, D.vide ? null : info.branch);
        if (!w.conflit) { SYNC_META.sha = w.sha; SYNC_META.h = h; envoye = true; break; }
        if (essai >= 3) throw new Error('Le dépôt a changé pendant la synchro (un autre appareil synchronisait aussi) : nouvel essai dans quelques minutes');
      }
      SYNC_META.ok = Date.now(); SYNC_META.err = null; SYNC_META.errAt = null; SYNC_META.n = (SYNC_META.n || 0) + 1; syncSaveMeta();
      return { recu: recu, envoye: envoye };
    } catch (e) {
      SYNC_META.err = String(e && e.message || e); SYNC_META.errAt = Date.now(); syncSaveMeta();
      if (/introuvable|refusé|public|lecture/.test(SYNC_META.err)) SYNC_RT.repo = null;
      return { err: SYNC_META.err, recu: recu, envoye: envoye };
    } finally {
      SYNC_RT.busy = false; SYNC_RT.last = Date.now();
      if (recu) { rendre(true); toast('Données reçues de l\'autre appareil.'); } else syncBadge();
      if (SYNC_RT.again) { SYNC_RT.again = false; syncSoon('reprise', 2000); }
    }
  }
  function syncSoon(pourquoi, ms) {
    if (!syncOn()) return;
    var due = Date.now() + ms; if (SYNC_RT.timer && SYNC_RT.due <= due) return;
    if (SYNC_RT.timer) clearTimeout(SYNC_RT.timer);
    SYNC_RT.due = due; SYNC_RT.timer = setTimeout(function () { SYNC_RT.timer = null; syncNow(pourquoi); }, ms);
  }
  function syncQuand(t) { var d = new Date(t), n = new Date(); return d.toDateString() === n.toDateString() ? 'à ' + heureTexte(d) : 'le ' + d.toLocaleDateString('fr-FR') + ' à ' + heureTexte(d); }
  function syncStatutHTML() {
    if (!syncOn()) return 'Synchronisation non configurée sur cet appareil : tout reste dans ce navigateur.';
    var M = SYNC_META;
    if (SYNC_RT.busy) return 'Synchronisation en cours…';
    var plus = M.plusRecente ? '<br><span class="attention-txt">Une version plus récente de l\'outil (' + esc(M.plusRecente) + ') a écrit ces données : ouvre l\'appli en ligne ou remplace ce fichier ; en attendant, cet appareil reçoit sans envoyer.</span>' : '';
    if (M.err) return '<span class="attention-txt">Dernier essai' + (M.errAt ? ' ' + syncQuand(M.errAt) : '') + ' : ' + esc(M.err) + '</span>' + (M.ok ? ' · dernière synchro réussie ' + syncQuand(M.ok) : '') + plus;
    return (M.ok ? '<span class="ok-txt">Synchronisé ' + syncQuand(M.ok) + '</span> · dépôt ' + esc(SYNC.owner) + '/' + esc(SYNC.repo) + ' · cet appareil : ' + esc(SYNC.device || '—')
      : 'Dépôt ' + esc(SYNC.owner) + '/' + esc(SYNC.repo) + ' : pas encore synchronisé.') + plus;
  }
  function syncBadge() {
    var t = document.getElementById('syncTag'), s = document.getElementById('s_statut');
    if (s) s.innerHTML = syncStatutHTML();
    if (!t) return;
    if (!syncOn()) { t.hidden = true; t.textContent = ''; return; }
    var M = SYNC_META;
    t.hidden = false; t.dataset.action = 'aller-sync';
    t.className = 'sync-tag' + (SYNC_RT.busy ? '' : (M.err ? ' err' : (M.ok ? ' ok' : '')));
    t.textContent = SYNC_RT.busy ? '⇅ synchro…' : (M.err ? '⇅ erreur' : (M.ok ? '⇅ ' + hhmm(M.ok) : '⇅ —'));
    t.title = SYNC_RT.busy ? 'Synchronisation en cours' : (M.err ? 'Synchronisation : ' + M.err : (M.ok ? 'Synchronisé ' + syncQuand(M.ok) + ' avec ' + SYNC.owner + '/' + SYNC.repo : 'Pas encore synchronisé'));
  }
  function appliEnLigneParDefaut() { return /^https?:$/.test(location.protocol) ? location.origin + location.pathname : ''; }
  function rendreSyncCarte() {
    var B = vue.syncBrouillon || {}, v = function (k, d) { return esc(B[k] != null ? B[k] : (SYNC[k] || d || '')); };
    var h = '<div class="section" id="syncCarte"><h2>Synchronisation téléphone / PC</h2><div class="carte">' +
      '<p class="petit" style="margin-top:0">Mêmes données sur tous tes appareils (foyer, semaine, prix corrigés, réglages, courses cochées, repas préparés), par un dépôt GitHub <b>privé</b> à ton nom, comme l\'outil NHL. Le jeton reste dans ce navigateur : jamais exporté, jamais synchronisé.</p>' +
      '<div class="formulaire">' +
      '<label class="champ">Pseudo GitHub<input data-action="s-champ" data-c="owner" id="s_owner" autocomplete="off" spellcheck="false" placeholder="ton-pseudo" value="' + v('owner') + '"></label>' +
      '<label class="champ">Dépôt privé des données<input data-action="s-champ" data-c="repo" id="s_repo" autocomplete="off" spellcheck="false" placeholder="equilibre-donnees" value="' + v('repo') + '"></label>' +
      '<label class="champ">Jeton d\'accès (github_pat_…)<input data-action="s-champ" data-c="token" id="s_token" type="password" autocomplete="off" spellcheck="false" placeholder="colle le jeton ici" value="' + v('token') + '"></label>' +
      '<label class="champ">Nom de cet appareil<input data-action="s-champ" data-c="device" id="s_device" autocomplete="off" placeholder="PC / téléphone" value="' + v('device', syncDevGuess()) + '"></label>' +
      '<label class="champ large">Adresse de l\'appli en ligne<input data-action="s-champ" data-c="app" id="s_app" autocomplete="off" spellcheck="false" placeholder="https://ton-pseudo.github.io/equilibre-alimentaire/" value="' + v('app', appliEnLigneParDefaut()) + '"></label></div>' +
      '<div class="rang" style="margin-top:10px"><button class="btn btn-principal" data-action="s-enregistrer">Enregistrer et synchroniser</button>' +
      '<button class="btn" data-action="s-maintenant">Synchroniser maintenant</button>' +
      '<button class="btn" data-action="s-relier">Relier un autre appareil</button>' +
      '<button class="btn" data-action="s-arreter">Arrêter sur cet appareil</button></div>' +
      '<p id="s_statut" class="petit" style="margin-top:8px">' + syncStatutHTML() + '</p>';
    if (vue.lienVisible) h += syncLienBoite();
    h += '<details class="aide-sync"><summary>Mise en place (une fois, environ 10 minutes)</summary><ol>' +
      '<li>Sur <b>github.com</b> (le compte de l\'outil NHL convient).</li>' +
      '<li><b>Appli en ligne</b> : « New » → nom <code>equilibre-alimentaire</code>, <b>Public</b> → « Create repository » → « uploading an existing file » → glisse les fichiers du dossier <i>appli en ligne</i> (index.html, manifest.webmanifest, sw.js et les trois icônes) → « Commit changes ». Puis Settings → Pages → Branch : <code>main</code>, dossier <code>/ (root)</code> → Save. Une à deux minutes plus tard, elle est à l\'adresse https://ton-pseudo.github.io/equilibre-alimentaire/.</li>' +
      '<li><b>Données</b> : « New » → nom <code>equilibre-donnees</code>, <b>Private</b>, coche « Add a README file » → « Create repository ». (Le dépôt privé <code>nhl-donnees</code> marche aussi : l\'outil n\'écrit que dans son dossier <code>equilibre/</code>.)</li>' +
      '<li><b>Jeton</b> : ta photo → Settings → Developer settings → Personal access tokens → <b>Fine-grained tokens</b> → « Generate new token ». Repository access : « Only select repositories » → le dépôt des données ; Permissions → Repository permissions → <b>Contents : Read and write</b> → « Generate token » → copie-le (il commence par <code>github_pat_</code>). Un jeton existant (celui de l\'outil NHL) se modifie pour y ajouter le dépôt.</li>' +
      '<li><b>Ici</b> : ton pseudo, le dépôt des données, le jeton et l\'adresse de l\'appli en ligne → « Enregistrer et synchroniser ». Le premier appareil envoie ses données.</li>' +
      '<li><b>Téléphone</b> : « Relier un autre appareil » → scanne le QR code → « Relier » → dans Chrome, menu ⋮ → « Installer l\'application » (Safari : Partager → « Sur l\'écran d\'accueil »).</li></ol>' +
      '<p class="petit muet">Le jeton expire (un an au plus) : l\'outil le dira (« jeton refusé »), il suffira d\'en créer un nouveau. Un dépôt public est refusé : ton foyer et tes menus n\'y seraient plus privés.</p></details></div></div>';
    return h;
  }
  function syncLienURL() {
    var ici = /^https:$/.test(location.protocol) || /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?\//.test(location.href);
    var base = (ici ? location.origin + location.pathname : String(SYNC.app || '').trim()).replace(/#.*$/, '');
    if (!/^https:\/\/[^\s#?]+$/.test(base) && !/^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?\/[^\s#?]*$/.test(base)) return null;
    return base + '#lien=' + b64url(JSON.stringify({ o: SYNC.owner, r: SYNC.repo, t: SYNC.token, a: base }));
  }
  function syncLienBoite() {
    if (!syncOn()) return '<div class="note">Configure et synchronise d\'abord cet appareil (champs ci-dessus).</div>';
    var url = syncLienURL();
    if (!url) return '<div class="note">Indique l\'adresse de l\'appli en ligne (par exemple https://ton-pseudo.github.io/equilibre-alimentaire/) puis « Enregistrer et synchroniser » : c\'est elle que le téléphone ouvrira.</div>';
    var svg = '';
    try { var q = QRGEN(0, 'M'); q.addData(url); q.make(); svg = q.createSvgTag(4, 4); } catch (e) { svg = ''; }
    return '<div class="lien-boite"><div class="sync-qr" title="Lien de liaison">' + (svg || '<span class="muet">QR code indisponible : copie le lien</span>') + '</div>' +
      '<p class="petit">Scanne ce code avec l\'appareil photo du téléphone : l\'appli s\'ouvre et propose « Relier ». Ce code donne accès à tes données : ne le montre qu\'à ton téléphone.</p>' +
      '<div class="rang"><input id="s_lienurl" readonly value="' + esc(url) + '" style="flex:1 1 200px;min-width:0" aria-label="Lien de liaison"><button class="btn" data-action="s-copier-lien">Copier le lien</button><button class="btn" data-action="s-masquer-lien">Masquer</button></div></div>';
  }
  async function syncEnregistrer() {
    var g = function (id) { var e = document.getElementById(id); return String((e && e.value) || '').trim(); };
    var owner = g('s_owner').replace(/^@/, ''), repo = g('s_repo').replace(/^.*github\.com\//i, '').split('/').pop(), token = g('s_token'), app = g('s_app');
    if (!/^[A-Za-z0-9-]{1,39}$/.test(owner)) { toast('Pseudo GitHub invalide'); return; }
    if (!/^[A-Za-z0-9._-]{1,100}$/.test(repo)) { toast('Nom de dépôt invalide'); return; }
    if (token.length < 20) { toast('Colle le jeton d\'accès GitHub (github_pat_…)'); return; }
    if (app && !/^https:\/\/[^\s#?]+$/.test(app) && !/^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?\/[^\s#?]*$/.test(app)) { toast('Adresse de l\'appli en ligne : elle doit commencer par https://'); return; }
    var meme = SYNC.owner === owner && SYNC.repo === repo;
    SYNC = { owner: owner, repo: repo, token: token, device: g('s_device') || syncDevGuess(), app: app }; syncSaveCfg();
    if (!meme) { SYNC_META = {}; syncSaveMeta(); }
    SYNC_RT.repo = null; vue.syncBrouillon = null;
    toast('Synchronisation…'); rendre();
    var r = await syncNow('réglages');
    rendre();
    toast(r.err ? 'Synchronisation : ' + r.err : 'Synchronisé : ' + (r.recu ? 'données reçues' : 'rien à recevoir') + (r.envoye ? ', données envoyées.' : '.'));
  }
  // lien de liaison reçu (#lien=…) : bandeau de confirmation, puis réglages enregistrés et adresse nettoyée
  function effacerHash() { try { history.replaceState(null, '', location.pathname + location.search); } catch (e) { try { location.hash = ''; } catch (e2) { /* rien */ } } }
  function syncLienVerifier() {
    var m = String(location.hash || '').match(/[#&]lien=([A-Za-z0-9_-]+)/); if (!m) return;
    var p = null; try { p = JSON.parse(b64urlDec(m[1])); } catch (e) { p = null; }
    if (!p || !p.o || !p.r || !p.t) { effacerHash(); toast('Lien de liaison illisible'); return; }
    vue.lienRecu = p;
  }
  function rendreLienRecu() {
    var p = vue.lienRecu; if (!p) return '';
    return '<div class="carte lien-recu" role="region" aria-label="Relier cet appareil"><h2>Relier cet appareil</h2><p>Synchroniser cet appareil avec le dépôt privé <b>' + esc(p.o) + '/' + esc(p.r) + '</b> : le foyer, la semaine, les prix, les réglages, les courses et les repas préparés de l\'autre appareil arriveront ici.</p>' +
      '<div class="rang"><button class="btn btn-principal" data-action="lien-relier">Relier</button><button class="btn" data-action="lien-ignorer">Ignorer</button></div></div>';
  }
  async function syncRelier() {
    var p = vue.lienRecu; if (!p) return;
    SYNC = { owner: String(p.o), repo: String(p.r), token: String(p.t), device: SYNC.device || syncDevGuess(), app: String(p.a || SYNC.app || '') };
    syncSaveCfg(); SYNC_META = {}; syncSaveMeta(); SYNC_RT.repo = null;
    // ce qui est ici n'a pas encore été choisi par l'utilisateur sur cet appareil relié : les données de l'autre appareil l'emportent
    etat.maj = N.majVide(); sauver(false);
    vue.lienRecu = null; effacerHash(); rendre(); toast('Appareil relié — synchronisation…');
    var r = await syncNow('liaison');
    rendre();
    toast(r.err ? 'Synchronisation : ' + r.err : (r.recu ? 'Synchronisé : données reçues de l\'autre appareil.' : 'Synchronisé.'));
  }
  function syncEcouter() {
    document.addEventListener('visibilitychange', function () {
      if (document.visibilityState === 'visible') { majHorloge(); if (syncOn() && Date.now() - SYNC_RT.last > 60e3) syncNow('retour'); }
      else if (document.visibilityState === 'hidden' && SYNC_RT.timer) { clearTimeout(SYNC_RT.timer); SYNC_RT.timer = null; syncNow('fermeture'); }   // ce qui attendait part tout de suite
    });
    window.addEventListener('online', function () { syncSoon('réseau', 2000); });
    setInterval(function () {
      majHorloge();
      if (syncOn() && document.visibilityState !== 'hidden' && Date.now() - SYNC_RT.last >= SYNC_EVERY - 5e3) syncNow('régulière');
    }, 60e3);
  }
  // l'heure avance : le bandeau et l'onglet « Prochain repas » suivent (sans gêner une saisie en cours)
  function cleProchain() { var r = N.prochainRepas(etat, horloge()); return r ? r.cle + '|' + etatProchain(r, horloge()).txt : ''; }
  function majHorloge() {
    if (!cache) return;
    rendreBandeau();
    if (vue.onglet !== 'aujourdhui') return;
    var k = cleProchain(), saisie = document.activeElement && /^(INPUT|SELECT|TEXTAREA)$/.test(document.activeElement.tagName);
    if (k !== vue.cleProchain && !saisie && !(document.getElementById('dlgRecette') || {}).open) { var y = window.scrollY; rendre(); window.scrollTo(0, y); }
  }
  // appli installable (édition en ligne) : le service worker ne tourne qu'en https (ou sur ce PC, pour les essais)
  function pwaInscrire() {
    try {
      if ('serviceWorker' in navigator && (location.protocol === 'https:' || /^(localhost|127\.0\.0\.1)$/.test(location.hostname)) && document.querySelector('link[rel="manifest"]'))
        navigator.serviceWorker.register('sw.js').catch(function () { /* hors ligne ou refusé : l'outil marche quand même */ });
    } catch (e) { /* navigateur sans service worker */ }
  }

  // ------------------------------------------------------------------ démarrage
  syncLienVerifier();
  recalculer();
  rendre();
  // avec la synchro, on reçoit d'abord ; une semaine générée ensuite (semaine toujours vide) est datée et partagée
  if (syncOn()) syncNow('ouverture').then(function () { if (planVide()) generer('aleatoire', etat.graine); });
  else if (planVide()) generer('aleatoire', etat.graine, premierLancement);
  syncEcouter();
  pwaInscrire();
  window.__equilibre = { etat: function () { return etat; }, cache: function () { return cache; }, rendre: rendre, generer: generer,
    horloge: function (f) { horloge = f || function () { return new Date(); }; majHorloge(); }, syncNow: syncNow, syncEtat: function () { return { busy: SYNC_RT.busy, meta: SYNC_META, on: syncOn() }; } };
})();
