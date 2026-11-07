#!/usr/bin/env node
/* =====================================================================
   Matrice d'exigences de l'outil « Équilibre alimentaire du foyer »
   Usage : node verif_exigences.js equilibre_alimentaire.html [--en-ligne dossier_appli_en_ligne]
   - aucune dépendance obligatoire (node seul) ;
   - si ESLint est installé : contrôle des variables non déclarées ;
   - si Playwright et test_navigateur.js sont présents : contrôle navigateur (E01, E23, E24, E26, E29 à E32) ;
   - l'édition en ligne (E32) est cherchée dans --en-ligne, sinon dans le dossier « appli_en_ligne » voisin du fichier.
   Une exigence dont la preuve disparaît du fichier = régression, ou exigence
   modifiée qu'il faut d'abord mettre à jour ici. Trancher avant de livrer.
   ===================================================================== */
'use strict';
const fs = require('fs'), path = require('path'), vm = require('vm'), os = require('os'), cp = require('child_process');

const fichier = path.resolve(process.argv[2] || 'equilibre_alimentaire.html');
const iEL = process.argv.indexOf('--en-ligne');
const dossierEnLigne = iEL > 0 ? path.resolve(process.argv[iEL + 1]) : path.join(path.dirname(fichier), 'appli_en_ligne');
const enLigneOk = fs.existsSync(path.join(dossierEnLigne, 'index.html'));
if (!fs.existsSync(fichier)) { console.error('Fichier introuvable : ' + fichier); process.exit(2); }
const html = fs.readFileSync(fichier, 'utf8');
function bloc(id) { const m = html.match(new RegExp('<script id="' + id + '"[^>]*>([\\s\\S]*?)<\\/script>')); return m ? m[1] : null; }

// ---------------------------------------------------------------- matrice (source de vérité)
const MATRICE = [
  ["E01", "Fichier HTML unique et autonome : styles, données et scripts intégrés, aucune ressource réseau nécessaire, fonctionne ouvert depuis le disque ; seul accès réseau, la synchronisation GitHub facultative, une fois configurée par l'utilisateur."],
  ["E02", "Foyer de 2 adultes et 1 enfant de 7 ans, chacun réglable (sexe, âge, poids, taille, activité)."],
  ["E03", "Références nutritionnelles ANSES propres à chaque profil (adulte homme, adulte femme, enfant 7-10 ans), avec leur type (RNP, AS, limite) et leur source."],
  ["E04", "Nutriments suivis : magnésium, fer, calcium, zinc, potassium, phosphore, iode, sélénium, cuivre, sodium, vitamines A, D, E, C, B1, B2, B6, B9, B12, oméga-3 (ALA, EPA + DHA), fibres, protéines, énergie, glucides, sucres, lipides, acides gras saturés."],
  ["E05", "Composition des aliments issue de la table CIQUAL 2025 de l'ANSES, avec le code et le libellé CIQUAL de chaque aliment."],
  ["E06", "Recettes pour les quatre moments de la journée : petit-déjeuner, déjeuner, dîner et goûter de 16 h (au moins 6 petits-déjeuners, 6 goûters et 20 plats)."],
  ["E07", "Chaque recette donne ses ingrédients chiffrés, ses étapes, ses temps de préparation et de cuisson."],
  ["E08", "Quantités données pour chaque personne et pour toute la famille."],
  ["E09", "Planning de 7 jours × 4 moments modifiable à la main, avec verrouillage des choix."],
  ["E10", "Générateur de semaine équilibrée qui améliore mesurablement l'équilibre par rapport à des semaines tirées au hasard, et respecte les verrous."],
  ["E11", "Bilan par personne : apport moyen par jour comparé au repère, taux de couverture, alertes de manque et d'excès (limites de sécurité, sodium, sucres, acides gras saturés)."],
  ["E12", "Repères PNNS contrôlés sur la semaine : fruits et légumes, produits laitiers, légumes secs, poisson et poisson gras, viande, charcuterie, féculents complets."],
  ["E13", "Prix Carrefour pour chaque article (libellé, format, prix, date et source du relevé), modifiables et conservés."],
  ["E14", "Coût par repas, par jour et par semaine pour le foyer."],
  ["E15", "Liste de courses de la semaine regroupée par rayon, en paquets entiers, avec le total."],
  ["E16", "Eau de boisson de chaque personne prise en compte (calcium, magnésium, sodium des eaux vendues chez Carrefour ou du robinet)."],
  ["E17", "Suggestions pour combler un manque : aliments, recettes et eaux riches dans le nutriment, avec leur apport et leur coût."],
  ["E18", "Conversion poids cru → poids cuit (rendement) et partie comestible prises en compte."],
  ["E19", "Portions indivisibles (yaourt, fruit, verre de lait) et facteur de portion calé sur le besoin énergétique de chacun."],
  ["E20", "Repas pris dehors (cantine, travail) : estimés dans le bilan, exclus des courses et du coût."],
  ["E21", "Données manquantes de la table CIQUAL signalées (taux de complétude par nutriment)."],
  ["E22", "Sauvegarde locale qui ne bloque jamais l'outil si le navigateur la refuse, export et import des réglages."],
  ["E23", "Lisible sur téléphone : pas de défilement horizontal de la page à 390 px de large."],
  ["E24", "Aucune erreur JavaScript au chargement ni en parcourant tous les onglets dans un vrai navigateur."],
  ["E25", "Avertissement : outil d'information, pas un avis médical ; vitamine D et compléments à voir avec le médecin."],
  ["E26", "Budget par jour du foyer : 12 € au plus par défaut (réglable ; 10 à 12 € demandés) avec une cible de 10 €. Le générateur ne propose aucun jour au-dessus du maximum quand c'est possible ; le coût de chaque jour est affiché et un jour au-dessus est signalé."],
  ["E27", "Besoin énergétique calculé pour chacun d'après son profil : Black et al. (1996) pour les adultes (poids, taille, âge, activité), Schofield (OMS 1985) × activité + croissance pour l'enfant (poids, activité), cohérent avec les besoins ANSES des 7-10 ans."],
  ["E28", "Mises en garde sur l'eau de boisson tirées des étiquettes (fluor au-delà de 1,5 mg/L avec la mention légale pour l'enfant, sulfates, sodium, minéralisation), affichées dans le foyer et dans les suggestions."],
  ["E29", "Préparation de chaque repas limitée hors cuisson : 20 min au plus par défaut, 15 min au choix. Le générateur ne propose aucune recette plus longue ; une recette plus longue choisie à la main est signalée."],
  ["E30", "Prochain repas à préparer au premier plan : premier écran à l'ouverture et rappel en tête des autres onglets, avec l'heure du repas et celle où commencer, les personnes présentes, les quantités pour toutes et pour chacune, les étapes ; « C'est prêt » passe au repas suivant."],
  ["E31", "Données à jour sur n'importe quel appareil (téléphone, tablette, PC), comme l'outil NHL : synchronisation par un dépôt GitHub privé de l'utilisateur, jeton gardé dans le navigateur (jamais exporté ni envoyé dans le dépôt), dépôt public refusé, modifications de plusieurs appareils fusionnées."],
  ["E32", "Édition en ligne installable (GitHub Pages : manifeste, service worker, icônes), utilisable hors connexion, et liaison d'un nouvel appareil par lien ou QR code."]
];

// ---------------------------------------------------------------- extraction
const sortie = [];
function ligne(t) { sortie.push(t); console.log(t); }
const donneesTxt = bloc('donnees'), exigTxt = bloc('exigences-liste'), coeur = bloc('coeur'), ui = bloc('interface');
const css = (html.match(/<style>([\s\S]*?)<\/style>/) || [])[1] || '';
if (!donneesTxt || !coeur || !ui) { console.error('Blocs attendus absents (donnees, coeur, interface) : le fichier n\'est pas au format prévu.'); process.exit(1); }
const D = JSON.parse(donneesTxt);
const exigFichier = exigTxt ? JSON.parse(exigTxt) : [];

// syntaxe : node --check sur chaque bloc extrait (point 4 du protocole)
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'verif-eq-'));
const syntaxe = ['coeur', 'interface'].map(function (nom) {
  const f = path.join(tmp, nom + '.js'); fs.writeFileSync(f, nom === 'coeur' ? coeur : ui);
  const r = cp.spawnSync(process.execPath, ['--check', f], { encoding: 'utf8' });
  return { nom, ok: r.status === 0, detail: (r.stderr || '').split('\n').slice(0, 4).join(' ') };
});

// chargement du cœur de calcul hors navigateur
const bac = { DONNEES: D, console: console, Math: Math, JSON: JSON, Date: Date };
vm.createContext(bac);
vm.runInContext(coeur + '\n;this.NUTRI = NUTRI;', bac, { filename: 'coeur.js' });
const N = bac.NUTRI;

// ---------------------------------------------------------------- outils de preuve
function proche(a, b, t) { return Math.abs(a - b) <= t; }
function etatAleatoire(graine) { const st = N.etatDefaut(), ctx = N.preparer(st); st.plan = N.planAleatoire(st, ctx, N.mulberry32(graine)); return st; }
const R = {};
function preuve(id, fn) {
  try { const r = fn(); R[id] = (r && typeof r === 'object' && 'ok' in r) ? r : { ok: !!r, detail: '' }; }
  catch (e) { R[id] = { ok: false, detail: 'exception : ' + e.message }; if (process.env.TRACE) console.error(id, e.stack); }
}
const codeTotal = coeur + '\n' + ui;

preuve('E02', function () {
  const st = N.etatDefaut(), P = st.personnes;
  const ad = P.filter(p => p.type === 'adulte').length, en = P.filter(p => p.type === 'enfant' && p.age === 7).length;
  const champs = ['p-sexe', 'data-c="age"', 'data-c="poids"', 'data-c="taille"', 'p-nap', 'p-activite'].filter(x => ui.indexOf(x) < 0);
  return { ok: ad === 2 && en === 1 && !champs.length, detail: ad + ' adultes, ' + en + ' enfant de 7 ans' + (champs.length ? ', réglages absents : ' + champs.join(', ') : ', réglages présents') };
});
preuve('E03', function () {
  const st = N.etatDefaut(), [h, f, e] = st.personnes;
  const rh = N.references(h, 2600), rf = N.references(f, 2100), re = N.references(e, 1789);
  const attendu = [[rh.ca.v, 950], [rf.ca.v, 950], [re.ca.v, 800], [rh.mg.v, 380], [rf.mg.v, 300], [re.mg.v, 240], [rh.fe.v, 11], [re.fe.v, 6], [rh.i.v, 150], [re.i.v, 90], [re.vitD.v, 15], [re.b12.v, 1.5], [rh.zn.v, 11.7], [rf.zn.v, 9.3], [re.zn.v, 7.4]];
  const faux = attendu.filter(x => x[0] !== x[1]);
  const f2 = Object.assign({}, f, { fer: 'eleve' });
  const sansSource = [rh, rf, re].reduce((n, r) => n + Object.keys(r).filter(k => !r[k].src || ['RNP', 'AS', 'max', 'plage', 'cible'].indexOf(r[k].t) < 0).length, 0);
  const anses = Object.keys(re).filter(k => /ANSES/.test(re[k].src)).length;
  return { ok: !faux.length && N.references(f2, 2100).fe.v === 16 && !sansSource && anses >= 20, detail: (attendu.length - faux.length) + '/' + attendu.length + ' valeurs ANSES conformes, fer 16 mg si règles abondantes, ' + anses + ' repères enfant sourcés ANSES' };
});
const CLES = ['mg', 'fe', 'ca', 'zn', 'k', 'p', 'i', 'se', 'cu', 'na', 'vitA', 'vitD', 'vitE', 'vitC', 'b1', 'b2', 'b6', 'b9', 'b12', 'ala', 'epadha', 'fib', 'prot', 'kcal', 'gluc', 'sucresHL', 'lip', 'ags'];
preuve('E04', function () {
  const st = N.etatDefaut(), refs = st.personnes.map(p => N.references(p, N.besoinEnergie(p)));
  const manque = CLES.filter(k => N.KI[k] == null || refs.some(r => !r[k]));
  return { ok: !manque.length, detail: CLES.length + ' nutriments suivis avec un repère pour chaque personne' + (manque.length ? ' ; manquants : ' + manque.join(', ') : '') };
});
preuve('E05', function () {
  const A = D.aliments, ids = Object.keys(A);
  const sansCode = ids.filter(f => !(/^\d+$/.test(A[f].ciqual) || /^ETIQ-/.test(A[f].ciqual)) || !A[f].ciqualNom);
  // valeurs de contrôle relevées dans la table CIQUAL 2025 (mg ou µg pour 100 g)
  const temoins = [['avoine', 'mg', 101], ['amandes', 'ca', 260], ['amandes', 'mg', 270], ['lait', 'ca', 121], ['sardines', 'ca', 333], ['boudin', 'fe', 17.4], ['grainesCourge', 'mg', 592], ['hepar', 'ca', 54.9]];
  const ko = temoins.filter(t => !proche(A[t[0]].v[t[1]], t[2], 1e-6));
  return { ok: /2025/.test(D.meta.ciqualVersion) && !sansCode.length && !ko.length, detail: ids.length + ' aliments avec code et libellé CIQUAL, ' + (temoins.length - ko.length) + '/' + temoins.length + ' valeurs témoins conformes (' + D.meta.ciqualVersion + ')' };
});
preuve('E06', function () {
  const rs = N.RECS.filter(r => !r.exterieur);
  const n = m => rs.filter(r => r.moments.indexOf(m) >= 0).length;
  const plats = rs.filter(r => r.moments.indexOf('midi') >= 0 || r.moments.indexOf('soir') >= 0).length;
  return { ok: n('matin') >= 6 && n('gouter') >= 6 && plats >= 20 && n('midi') > 0 && n('soir') > 0, detail: n('matin') + ' petits-déjeuners, ' + n('gouter') + ' goûters, ' + plats + ' plats (' + n('midi') + ' au déjeuner, ' + n('soir') + ' au dîner)' };
});
preuve('E07', function () {
  const ko = N.RECS.filter(r => !r.exterieur && (!(r.lignes.length >= 2) || r.lignes.some(l => !(l.q > 0)) || !(r.etapes && r.etapes.length) || !(r.prep >= 0) || !(r.cuisson >= 0)));
  return { ok: !ko.length, detail: ko.length ? 'incomplètes : ' + ko.map(r => r.id).join(', ') : 'toutes les recettes ont ingrédients chiffrés, étapes et temps' };
});
preuve('E08', function () {
  const st = etatAleatoire(8), ctx = N.preparer(st), ev = N.evaluer(st, ctx, true), r = N.RECETTE.R01;
  const parts = ev.personnes.map(pr => 100 * pr.F); // spaghetti, ligne non unitaire
  const statique = ['Portion de référence', '<th class="n">Foyer</th>', 'parts.reduce'].filter(x => ui.indexOf(x) < 0);
  return { ok: !statique.length && parts.every(x => x > 0), detail: 'spaghetti du R01 : ' + parts.map(x => Math.round(x) + ' g').join(' + ') + ' = ' + Math.round(parts.reduce((a, b) => a + b, 0)) + ' g pour le foyer' + (statique.length ? ' ; colonnes absentes : ' + statique.join(', ') : '') };
});
preuve('E09', function () {
  const st = N.etatDefaut();
  const dims = st.plan.length === 7 && st.plan.every(j => j.length === 4) && st.verrous.length === 7 && st.verrous.every(j => j.length === 4);
  const ui1 = ['data-action="choisir"', 'data-action="verrou"'].every(x => ui.indexOf(x) >= 0);
  const st2 = N.normaliserEtat(Object.assign(N.etatDefaut(), { plan: N.etatDefaut().plan.map((j, d) => d === 0 ? ['M1', 'R01', 'G1', 'R02'] : j) }));
  return { ok: dims && ui1 && st2.plan[0][1] === 'R01', detail: '7 jours × 4 moments, choix manuel et verrous présents' };
});
let statsOptim = null;
preuve('E10', function () {
  const n = 30, gains = [], avant = [], apres = [], cov = { avant: { sous: 0, pnns: 0 }, apres: { sous: 0, pnns: 0 } };
  let nRep = 0;
  const compter = (st, ev) => ev.personnes.reduce((acc, pr, i) => {
    Object.keys(N.POIDS).forEach(k => { const r = pr.refs[k]; if (r && (r.t === 'RNP' || r.t === 'AS') && pr.moy[N.KI[k]] < r.v) acc.sous++; });
    const rep = N.reperesPNNS(st.personnes[i], pr).filter(x => !x.info);  // depuis la v1.1.0, « féculents complets chaque jour » est aussi évalué en mode léger
    acc.pnns += rep.filter(x => x.ok).length; acc.nRep += rep.length; return acc; }, { sous: 0, pnns: 0, nRep: 0 });
  // v1.2.0 : la même mesure sans budget par jour, pour séparer ce que coûte le budget de ce qu'apporte le générateur
  const covSans = { sous: 0, pnns: 0 };
  for (let g = 1; g <= n; g++) {
    const st = etatAleatoire(1000 + g), ctx = N.preparer(st);
    const s0 = N.score(st, ctx), ev0 = N.evaluer(st, ctx, true);
    const r = N.optimiser(st, { iterations: 2000, relances: 0, graine: g });
    const st2 = JSON.parse(JSON.stringify(st)); st2.plan = r.plan;
    const ev1 = N.evaluer(st2, N.preparer(st2), true);
    avant.push(s0); apres.push(r.score); gains.push(r.score - s0);
    const c0 = compter(st, ev0), c1 = compter(st2, ev1); nRep = c1.nRep;
    cov.avant.sous += c0.sous / n; cov.avant.pnns += c0.pnns / n; cov.apres.sous += c1.sous / n; cov.apres.pnns += c1.pnns / n;
    const st3 = JSON.parse(JSON.stringify(st)); st3.budgetJour = { max: 0, cible: 0 };
    const r3 = N.optimiser(st3, { iterations: 2000, relances: 0, graine: g }); st3.plan = r3.plan;
    const c3 = compter(st3, N.evaluer(st3, N.preparer(st3), true)); covSans.sous += c3.sous / n; covSans.pnns += c3.pnns / n;
  }
  cov.sansBudget = covSans;
  const moy = a => a.reduce((s, x) => s + x, 0) / a.length;
  const et = a => { const m = moy(a); return Math.sqrt(a.reduce((s, x) => s + (x - m) * (x - m), 0) / (a.length - 1)); };
  const t = moy(gains) / (et(gains) / Math.sqrt(n));
  const st = etatAleatoire(77); st.verrous[3][3] = true; st.verrous[5][0] = true;
  const garde = [st.plan[3][3], st.plan[5][0]];
  const r = N.optimiser(st, { iterations: 2000, relances: 1, graine: 3 });
  const verrous = r.plan[3][3] === garde[0] && r.plan[5][0] === garde[1];
  statsOptim = { n, avant: moy(avant), apres: moy(apres), gainMin: Math.min.apply(null, gains), t, cov, nRep };
  return { ok: gains.every(x => x > 0) && t > 5 && verrous, detail: n + ' semaines au hasard : score moyen ' + moy(avant).toFixed(1) + ' → ' + moy(apres).toFixed(1) + ' (gain minimal ' + Math.min.apply(null, gains).toFixed(1) + ', t = ' + t.toFixed(1) + '), verrous respectés : ' + (verrous ? 'oui' : 'NON') };
});
preuve('E11', function () {
  const st = etatAleatoire(11), ctx = N.preparer(st), ev = N.evaluer(st, ctx, false), pr = ev.personnes[0];
  const nbStat = Object.keys(pr.statuts).length;
  const st2 = etatAleatoire(11); st2.personnes[0].eau = 'hepar'; st2.personnes[0].eauMl = 4000;
  const ev2 = N.evaluer(st2, N.preparer(st2), false);
  const cls = N.statut({ t: 'max', v: 2300 }, 2500) === 'exces' && N.statut({ t: 'RNP', v: 10 }, 5) === 'bas';
  const lim = ['na', 'sucresHL', 'ags'].every(k => pr.refs[k] && pr.refs[k].t === 'max');
  return { ok: nbStat >= 28 && ev2.personnes[0].statuts.ca === 'lss' && cls && lim && ui.indexOf('class="tuile') >= 0, detail: nbStat + ' nutriments classés par personne ; 4 L/j d\'Hépar → calcium « ' + ev2.personnes[0].statuts.ca + ' » (au-delà de la LSS de 2 500 mg)' };
});
preuve('E12', function () {
  const st = etatAleatoire(12), ev = N.evaluer(st, N.preparer(st), false);
  const ks = ev.personnes[0].pnns.map(x => x.k);
  const attendus = ['fl', 'pl', 'leg', 'poi', 'pg', 'vi', 'ch', 'fc'];
  const manque = attendus.filter(k => ks.indexOf(k) < 0);
  return { ok: !manque.length, detail: ks.length + ' repères évalués par personne' + (manque.length ? ' ; absents : ' + manque.join(', ') : '') };
});
preuve('E13', function () {
  const ids = Object.keys(D.achats);
  const ko = ids.filter(id => { const a = D.achats[id]; return !a.nom || !(a.qte > 0) || !(a.prix >= 0) || !a.date || !a.src || (id !== 'eauRobinet' && !/carrefour\.fr/.test(a.src)); });
  const st = N.normaliserEtat(Object.assign(N.etatDefaut(), { prix: { lait: { prix: 7.5 } } }));
  const ui1 = ['data-action="prix-val"', 'data-action="prix-qte"', 'data-action="prix-reset"'].every(x => ui.indexOf(x) >= 0);
  return { ok: !ko.length && st.prix.lait.prix === 7.5 && N.prixEffectif(st, 'lait').prix === 7.5 && ui1, detail: ids.length + ' articles datés (' + D.meta.prixDate + ') et sourcés ; prix modifiable et conservé' + (ko.length ? ' ; incomplets : ' + ko.join(', ') : '') };
});
preuve('E14', function () {
  const st = etatAleatoire(14), ctx = N.preparer(st), ev = N.evaluer(st, ctx, true);
  let somme = 0; for (let d = 0; d < 7; d++) for (let s = 0; s < 4; s++) somme += N.coutCreneau(st, ctx, ev, d, s);
  const eau = ev.coutEau;
  const ui1 = ['N.coutCreneau', 'ev.cout / 7', 'coutFamille'].every(x => ui.indexOf(x) >= 0);
  return { ok: proche(somme + eau, ev.cout, 1e-6) && ui1, detail: 'somme des repas ' + somme.toFixed(2) + ' € + eau ' + eau.toFixed(2) + ' € = coût semaine ' + ev.cout.toFixed(2) + ' € (' + (ev.cout / 7).toFixed(2) + ' €/j)' };
});
preuve('E15', function () {
  const st = etatAleatoire(15), ctx = N.preparer(st), ev = N.evaluer(st, ctx, true), L = N.listeCourses(st, ctx, ev);
  const entiers = L.lignes.every(l => Number.isInteger(l.paquets) && l.paquets * l.qtePaquet >= l.besoin - 1e-6);
  const total = L.lignes.reduce((s, l) => s + l.ticket, 0);
  const rayons = [...new Set(L.lignes.map(l => l.rayon))];
  const trie = L.lignes.every((l, i) => i === 0 || rayons.indexOf(L.lignes[i - 1].rayon) <= rayons.indexOf(l.rayon));
  return { ok: entiers && proche(total, L.total, 1e-9) && trie && rayons.length >= 5, detail: L.lignes.length + ' articles en ' + rayons.length + ' rayons, paquets entiers, total ' + L.total.toFixed(2) + ' €' };
});
preuve('E16', function () {
  const st = N.etatDefaut(), v = N.vecteurEau(st, 'hepar', 1000), c = N.vecteurEau(st, 'eauMagCrf', 1000);
  const eaux = Object.keys(D.aliments).filter(f => D.aliments[f].cats.indexOf('eau') >= 0);
  const st2 = N.etatDefaut(); st2.personnes[0].eau = 'contrex'; const ev1 = N.evaluer(N.etatDefaut(), N.preparer(N.etatDefaut()), true), ev2 = N.evaluer(st2, N.preparer(st2), true);
  return { ok: proche(v.V[N.KI.ca], 549, 0.5) && proche(c.V[N.KI.mg], 85, 0.5) && eaux.length >= 8 && ev2.personnes[0].moy[N.KI.ca] > ev1.personnes[0].moy[N.KI.ca], detail: eaux.length + ' eaux proposées ; 1 L d\'Hépar = ' + v.V[N.KI.ca].toFixed(0) + ' mg de calcium et ' + v.V[N.KI.mg].toFixed(0) + ' mg de magnésium' };
});
preuve('E17', function () {
  const st = etatAleatoire(17), ctx = N.preparer(st), ev = N.evaluer(st, ctx, true), s = N.suggestions(st, ctx, ev, 2, 'fe');
  const trie = s.aliments.every((x, i) => i === 0 || s.aliments[i - 1].apport >= x.apport);
  const s2 = N.suggestions(st, ctx, ev, 0, 'mg');
  return { ok: s.aliments.length >= 5 && trie && s.aliments.every(x => x.cout > 0) && ['matin', 'midi', 'gouter', 'soir'].every(m => s.recettes[m].length === 3) && s2.eaux.length >= 8, detail: 'fer : ' + s.aliments.slice(0, 3).map(x => x.nom + ' ' + x.apport.toFixed(1) + ' mg (' + x.cout.toFixed(2) + ' €)').join(', ') };
});
preuve('E18', function () {
  const sp = N.nutrimentsAliment('spaghetti', 100), q = N.qteAchat(N.etatDefaut(), D.aliments.banane, 100);
  const ml = N.qteAchat(N.etatDefaut(), D.aliments.moules, 100);
  return { ok: proche(sp.kcal, 364, 1) && proche(q, 149.25, 0.1) && proche(ml, 454.5, 0.5), detail: '100 g de spaghetti secs = ' + sp.kcal.toFixed(0) + ' kcal (via l\'entrée « cuites » × 2,18) ; 100 g de banane = ' + q.toFixed(0) + ' g à acheter ; 100 g de chair de moules = ' + ml.toFixed(0) + ' g de moules' };
});
preuve('E19', function () {
  let ecart = 0;
  for (let g = 1; g <= 10; g++) {
    const st = etatAleatoire(190 + g), ev = N.evaluer(st, N.preparer(st), true);
    ev.personnes.forEach(pr => { if (pr.F > 0.5 && pr.F < 1.8) ecart = Math.max(ecart, Math.abs(pr.moy[N.KI.kcal] / pr.E - 1)); });
  }
  const v = N.vecteurRecette(N.etatDefaut(), N.RECETTE.G2);
  const unit = proche(v.Vu[N.KI.ca], 137 * 1.25 + 5.1, 0.01);
  return { ok: ecart < 0.01 && unit, detail: 'énergie de la semaine = besoin à ' + (ecart * 100).toFixed(2) + ' % près sur 10 semaines ; yaourt et banane du goûter servis entiers (' + v.Vu[N.KI.ca].toFixed(0) + ' mg de calcium quel que soit le facteur)' };
});
preuve('E20', function () {
  const st = etatAleatoire(20), ctx = N.preparer(st), ev0 = N.evaluer(st, ctx, true), L0 = N.listeCourses(st, ctx, ev0);
  [0, 1, 3, 4].forEach(d => { st.personnes[2].presence[d][1] = false; });
  const ev1 = N.evaluer(st, ctx, true), L1 = N.listeCourses(st, ctx, ev1);
  return { ok: ev1.personnes[2].nRepasDehors === 4 && L1.consomme < L0.consomme && ev1.personnes[2].cout < ev0.personnes[2].cout && ev1.personnes[2].moy[N.KI.kcal] > 0, detail: 'cantine 4 midis : ' + ev1.personnes[2].nRepasDehors + ' repas estimés, courses ' + L0.consomme.toFixed(2) + ' → ' + L1.consomme.toFixed(2) + ' €' };
});
preuve('E21', function () {
  const st = N.etatDefaut(); st.plan = N.grille(null); st.plan[0][1] = 'R06';
  const ev = N.evaluer(st, N.preparer(st), false), c = ev.personnes[0].completude;
  return { ok: c.i < 1 && c.ca === 1 && ui.indexOf('Données CIQUAL incomplètes') >= 0, detail: 'chili (haricots rouges sans valeur d\'iode) : complétude iode ' + (c.i * 100).toFixed(0) + ' %, calcium ' + (c.ca * 100).toFixed(0) + ' %' };
});
preuve('E22', function () {
  const mauvais = { getItem: () => { throw new Error('refus'); }, setItem: () => { throw new Error('refus'); } };
  const s = N.Stockage(mauvais, 'x');
  const st = N.etatDefaut(); st.budgetJour = { max: 11, cible: 9.5 }; st.personnes[1].eau = 'contrex';
  const r = N.importerEtat(N.exporterEtat(st));
  const garde = /try\s*\{\s*backend\s*=\s*window\.localStorage/.test(ui);
  return { ok: s.lire() === null && s.ecrire({}) === false && r.budgetJour.max === 11 && r.budgetJour.cible === 9.5 && r.personnes[1].eau === 'contrex' && garde, detail: 'stockage refusé sans exception, accès à localStorage protégé, export/import aller-retour exact' };
});
preuve('E25', function () {
  const txt = ui;
  const ok = /pas un avis médical/.test(txt) && /vitamine D/i.test(txt) && /médecin/.test(txt);
  return { ok: ok, detail: ok ? 'mentions présentes (onglet Méthode et points d\'attention)' : 'mention absente' };
});
preuve('E27', function () {
  const st = N.etatDefaut(), [h, f, e] = st.personnes;
  const E = p => N.besoinEnergie(p), avec = (p, o) => Object.assign({}, p, o);
  const e0 = E(e), g = E(avec(e, { sexe: 'G', age: 8, poids: 28.2 })), fi = E(avec(e, { sexe: 'F', age: 8, poids: 28.7 }));
  const sens = [
    E(avec(e, { poids: 26 })) > e0, E(avec(e, { activite: 'elevee' })) > e0, E(avec(e, { activite: 'faible' })) < e0,
    E(avec(h, { poids: 85 })) > E(h), E(avec(h, { taille: 185 })) > E(h), E(avec(h, { age: 60 })) < E(h), E(avec(h, { nap: 1.8 })) > E(h),
    E(avec(f, { energieManuelle: 1900 })) === 1900
  ];
  const src = N.references(e, e0).kcal.src;
  return { ok: proche(e0, 1600, 2) && proche(g, 1851, 15) && proche(fi, 1726, 15) && sens.every(Boolean) && /Schofield/.test(src) && ui.indexOf('NAP 1,6') >= 0,
    detail: 'enfant de 7 ans, 23 kg : ' + e0 + ' kcal/j ; au poids de référence des 7-10 ans : garçon ' + g + ' kcal (ANSES 1 851), fille ' + fi + ' kcal (ANSES 1 726) ; ' + sens.filter(Boolean).length + '/' + sens.length + ' sens de variation corrects (poids, taille, âge, activité, valeur imposée)' };
});

// ---------------------------------------------------------------- contrôle navigateur (E23, E24)
function trouverPlaywright() {
  for (const m of [process.env.PLAYWRIGHT_PATH, 'playwright', '/opt/npm-tools/node_modules/playwright']) { if (!m) continue; try { require.resolve(m); return m; } catch (e) { /* suivant */ } }
  return null;
}
const testNav = path.join(__dirname, 'test_navigateur.js');
const pw = trouverPlaywright();
let nav = null;
if (pw && fs.existsSync(testNav)) {
  const out = path.join(tmp, 'nav.json');
  const r = cp.spawnSync(process.execPath, [testNav, fichier].concat(enLigneOk ? ['--en-ligne', dossierEnLigne] : []), { encoding: 'utf8', env: Object.assign({}, process.env, { SORTIE_JSON: out, PLAYWRIGHT_PATH: pw }), timeout: 420000 });
  nav = fs.existsSync(out) ? JSON.parse(fs.readFileSync(out, 'utf8')) : null;
  if (!nav) nav = [{ id: 'exécution', ok: false, detail: (r.stderr || r.stdout || '').slice(0, 300) }];
}
function navRes(motif) { return nav ? nav.filter(x => motif.test(x.id)) : null; }
if (nav) {
  const tel = navRes(/téléphone 390/);
  R.E23 = { ok: tel.length === 1 && tel[0].ok && /viewport/.test(html), detail: tel.length ? tel[0].detail : 'contrôle absent' };
  const err = navRes(/zéro erreur/), onglets = navRes(/^onglet /);
  R.E24 = { ok: err.length === 1 && err[0].ok && onglets.length === 8 && onglets.every(x => x.ok), detail: (err.length ? err[0].detail : '') + ' ; ' + onglets.filter(x => x.ok).length + '/8 onglets affichés' };
} else {
  const statique = /<meta name="viewport"/.test(html) && /@media \(max-width: 480px\)/.test(css);
  R.E23 = { ok: null, detail: 'non vérifiable sans Playwright (statique : viewport et règles mobiles ' + (statique ? 'présents' : 'ABSENTS') + ')' };
  R.E24 = { ok: null, detail: 'non vérifiable sans Playwright : lancer test_navigateur.js sur une machine équipée' };
}
// E01, E26 et E29 à E32 après le contrôle navigateur : leurs preuves en dépendent aussi
preuve('E01', function () {
  // aucune ressource externe ; l'édition en ligne ne relie que ses propres fichiers (manifeste, icônes)
  const ext = [/<script[^>]+\ssrc=/i, /<link[^>]+href=["']?(https?:)?\/\//i, /@import/i, /url\(\s*['"]?https?:/i].filter(re => re.test(html));
  // un seul appel réseau dans tout le code : fetch vers l'API GitHub, dans ghReq, appelé seulement par la synchronisation
  const fetchs = (codeTotal.match(/\bfetch\s*\(/g) || []).length;
  const cible = /var SYNC_API = 'https:\/\/api\.github\.com'/.test(ui) && /await fetch\(SYNC_API \+ path, init\)/.test(ui);
  const autres = [/XMLHttpRequest/, /new\s+WebSocket/, /navigator\.sendBeacon/, /new\s+EventSource/].filter(re => re.test(codeTotal));
  const garde = /async function syncNow\(pourquoi\) \{\s*if \(!syncOn\(\)\) return \{ skip: 'off' \};/.test(ui);
  const navR = nav ? navRes(/aucune requête réseau/) : null, navOk = navR ? navR.length === 1 && navR[0].ok : null;
  return { ok: !ext.length && fetchs === 1 && cible && !autres.length && garde && !!html.match(/<style>/) && !!bloc('donnees') && navOk !== false,
    detail: 'ressources externes : ' + ext.length + ' ; appels réseau dans le code : ' + fetchs + ' (API GitHub, seulement si la synchronisation est configurée : ' + (garde ? 'oui' : 'NON') + ') ; ' +
      (navR ? 'navigateur, sans synchronisation : ' + (navR[0] ? navR[0].detail : 'contrôle absent') : 'navigateur non contrôlé') + ' ; ' + Math.round(html.length / 1024) + ' Ko' };
});
let statsBudget = null;
preuve('E26', function () {
  // mesure : semaines générées comme dans l'outil (8 000 essais, 2 relances), avec et sans budget
  const n = Number(process.env.SEMAINES_BUDGET || 10), jours = [], joursSans = [];
  const def = N.etatDefaut();
  for (let g = 0; g < n; g++) {
    for (const [cfg, L] of [[null, jours], [{ max: 0, cible: 0 }, joursSans]]) {
      const st = N.etatDefaut(); if (cfg) st.budgetJour = cfg;
      st.plan = N.optimiser(st, { depart: 'aleatoire', iterations: 8000, relances: 2, graine: 2600 + g * 7919 }).plan;
      N.evaluer(st, N.preparer(st), true).coutJours.forEach(c => L.push(c));
    }
  }
  const moy = a => a.reduce((x, y) => x + y, 0) / a.length;
  const dessus = jours.filter(c => c > def.budgetJour.max + 1e-9).length;
  // coût du jour = somme des repas du jour + eau, et pénalité au-dessus du maximum
  const st = etatAleatoire(26), ctx = N.preparer(st), ev = N.evaluer(st, ctx, true);
  let coherent = true;
  for (let d = 0; d < 7; d++) { let c = ev.coutEauJour; for (let s = 0; s < 4; s++) c += N.coutCreneau(st, ctx, ev, d, s); if (!proche(c, ev.coutJours[d], 1e-9)) coherent = false; }
  const statique = ['data-action="budget-max"', 'data-action="budget-cible"', 'cout-jour', 'Budget dépassé'].filter(x => ui.indexOf(x) < 0);
  const navB = nav ? navRes(/budget dépassé signalé/) : null, navOk = navB ? navB.length === 1 && navB[0].ok : null;
  statsBudget = { n, moy: moy(jours), max: Math.max.apply(null, jours), moySans: moy(joursSans), sous12Sans: joursSans.filter(c => c <= 12).length / joursSans.length };
  return { ok: def.budgetJour.max === 12 && def.budgetJour.cible === 10 && dessus === 0 && moy(jours) < moy(joursSans) && coherent && !statique.length && navOk !== false,
    detail: n + ' semaines générées : ' + dessus + ' jour(s) au-dessus de 12 € sur ' + jours.length + ', ' + moy(jours).toFixed(2) + ' €/j en moyenne (jour le plus cher ' + Math.max.apply(null, jours).toFixed(2) + ' €) ; sans budget ' + moy(joursSans).toFixed(2) + ' €/j' +
      (statique.length ? ' ; absents : ' + statique.join(', ') : '') + (navB ? ' ; navigateur : ' + (navB[0] ? navB[0].detail : 'contrôle absent') : '') };
});

// E29 à E32 (07/11/2026) : budget, préparation, prochain repas, synchronisation, appli en ligne
preuve('E29', function () {
  const def = N.etatDefaut();
  const verif = pm => { const st = N.etatDefaut(); st.prepMax = pm; const ctx = N.preparer(st); let trop = 0, min = 99;
    for (let d = 0; d < 7; d++) for (let s = 0; s < 4; s++) { trop += ctx.cand[d][s].filter(id => N.RECETTE[id].prep > pm).length; min = Math.min(min, ctx.cand[d][s].length); }
    return { trop, min }; };
  const v20 = verif(20), v15 = verif(15);
  let longues = 0;   // semaines générées à 15 min : aucune recette plus longue
  for (let g = 0; g < 3; g++) { const st = N.etatDefaut(); st.prepMax = 15; st.plan = N.optimiser(st, { depart: 'aleatoire', iterations: 3000, relances: 0, graine: 2900 + g }).plan; longues += N.creneauxTropLongs(st, true).length; }
  // « Améliorer » remplace une recette trop longue non verrouillée et garde celle qui est verrouillée
  const st = etatAleatoire(29); st.prepMax = 20; st.plan[0][1] = 'R22'; st.plan[2][3] = 'R22'; st.verrous[2][3] = true;
  const r = N.optimiser(st, { iterations: 1500, relances: 0, graine: 4 });
  const remplace = r.plan[0][1] !== 'R22' && r.plan[2][3] === 'R22';
  const plats15 = N.RECS.filter(x => !x.exterieur && (x.moments.indexOf('midi') >= 0 || x.moments.indexOf('soir') >= 0) && x.prep <= 15).length;
  const statique = ['data-action="prep-max"', 'prep-trop', 'N.creneauxTropLongs'].filter(x => ui.indexOf(x) < 0);
  const navP = nav ? navRes(/^préparation/) : null, navOk = navP ? navP.length === 2 && navP.every(x => x.ok) : null;
  return { ok: def.prepMax === 20 && N.PREP_CHOIX.indexOf(15) >= 0 && v20.trop === 0 && v15.trop === 0 && v15.min >= 5 && longues === 0 && remplace && plats15 >= 14 && !statique.length && navOk !== false,
    detail: 'propositions au-delà du maximum : ' + v20.trop + ' à 20 min, ' + v15.trop + ' à 15 min (au moins ' + v15.min + ' recettes par créneau à 15 min, ' + plats15 + ' plats) ; 3 semaines générées à 15 min : ' + longues + ' recette plus longue ; « Améliorer » remplace la recette de 25 min non verrouillée et garde la verrouillée : ' + (remplace ? 'oui' : 'NON') +
      (statique.length ? ' ; absents : ' + statique.join(', ') : '') + (navP ? ' ; navigateur : ' + navP.map(x => x.detail).join(' / ') : '') };
});
preuve('E30', function () {
  const st = etatAleatoire(30), t = new Date(2026, 10, 7, 17, 20);   // samedi 17 h 20 → dîner du samedi
  const r = N.prochainRepas(st, t), rec = N.RECETTE[r.id];
  const ev = N.evaluer(st, N.preparer(st), true), Q = N.quantitesRepas(st, ev, r.id, r.presents);
  const sommes = Q.every(q => proche(q.total, q.parts.reduce((a, x) => a + x.q, 0), 1e-9));
  const parts = Q.filter(q => !q.u).every(q => q.parts.every(x => { const l = rec.lignes.find(l => N.aliment(l.f, st) === q.f && !l.u); return l && proche(x.q, l.q * ev.personnes[x.i].F, 1e-9); }));
  const debut = r.d === 5 && r.s === 3 && r.debut.getTime() === new Date(2026, 10, 7, 19, 15).getTime() - (rec.prep + rec.cuisson) * 60000;
  st.faits[r.cle] = true; const r2 = N.prochainRepas(st, t);
  const premier = /<button role="tab" data-onglet="aujourdhui" aria-selected="true">/.test(html) && /onglet: 'aujourdhui'/.test(ui);
  const statique = ['id="bandeauRepas"', 'data-action="repas-fait"', 'Prochain repas à préparer', 'N.quantitesRepas'].filter(x => ui.indexOf(x) < 0 && html.indexOf(x) < 0);
  const navR = nav ? navRes(/^prochain repas/) : null, navOk = navR ? navR.length === 3 && navR.every(x => x.ok) : null;
  return { ok: debut && sommes && parts && r2 && r2.d === 6 && r2.s === 0 && premier && !statique.length && navOk !== false,
    detail: 'samedi 17 h 20 : dîner de 19 h 15 (' + rec.nom + '), commencer à ' + r.debut.getHours() + ' h ' + String(r.debut.getMinutes()).padStart(2, '0') + ', ' + r.presents.length + ' personnes, quantités totales = somme des parts : ' + (sommes && parts ? 'oui' : 'NON') +
      ' ; marqué prêt → ' + (r2 ? N.MOMENTS[r2.s].nom.toLowerCase() + ' du ' + N.JOURS[r2.d].toLowerCase() : 'rien') + (navR ? ' ; navigateur : ' + navR.map(x => x.detail).join(' / ') : '') };
});
preuve('E31', function () {
  const mec = N.auditMecanismes().find(a => a.id === 'synchro');
  const st = etatAleatoire(31); st.prix.lait = { prix: 1.2 };
  const exp = N.exporterEtat(st), fic = N.canon(N.fichierSync(st));
  const sansJeton = !/token|github_pat|Bearer/i.test(exp + fic);
  const cles = /var CLE = 'equilibre-alimentaire-v1'/.test(ui) && /var SYNC_KEY = 'equilibre-sync'/.test(ui) && ui.indexOf('exporterEtat(etat)') >= 0;
  const prive = /r\.j\.private !== true/.test(ui) && /est public/.test(ui);
  const fichierPropre = N.SYNC_CHEMIN === 'equilibre/etat.json';
  const navS = nav ? navRes(/^synchro/) : null, navOk = navS ? navS.length === 5 && navS.every(x => x.ok) : null;
  return { ok: mec && mec.ok && sansJeton && cles && prive && fichierPropre && navOk !== false,
    detail: 'fusion de deux appareils (dernière modification, coches et repas un par un, suppressions) : ' + (mec && mec.ok ? 'oui' : 'NON') + ' ; jeton absent de l\'export et du fichier du dépôt : ' + (sansJeton ? 'oui' : 'NON') +
      ' ; dépôt public refusé : ' + (prive ? 'oui' : 'NON') + ' ; fichier ' + N.SYNC_CHEMIN + (navS ? ' ; navigateur (GitHub simulé, deux appareils) : ' + navS.filter(x => x.ok).length + '/' + navS.length + ' contrôles' : ' ; navigateur non contrôlé') };
});
preuve('E32', function () {
  const qr = /QRGEN\(0, 'M'\)/.test(ui) && /#lien=/.test(ui) && !!bloc('qrcode') && /Kazuhiko Arase — licence MIT/.test(html);
  if (!enLigneOk) return { ok: null, detail: 'édition en ligne absente (' + dossierEnLigne + ') : la construire avec « python3 build/assemble.py --en-ligne dossier » ; QR code de liaison ' + (qr ? 'présent' : 'ABSENT') };
  const f = n => path.join(dossierEnLigne, n);
  const manquants = ['index.html', 'manifest.webmanifest', 'sw.js', 'icon-192.png', 'icon-512.png', 'icon-maskable-512.png'].filter(n => !fs.existsSync(f(n)));
  if (manquants.length) return { ok: false, detail: 'fichiers absents : ' + manquants.join(', ') };
  const man = JSON.parse(fs.readFileSync(f('manifest.webmanifest'), 'utf8'));
  const icones = (man.icons || []).map(i => i.sizes + ' ' + (i.purpose || 'any'));
  const manOk = man.display === 'standalone' && man.start_url === './' && icones.indexOf('192x192 any') >= 0 && icones.indexOf('512x512 maskable') >= 0;
  const idx = fs.readFileSync(f('index.html'), 'utf8');
  const lie = /<link rel="manifest" href="manifest.webmanifest">/.test(idx);
  const memeCode = ['coeur', 'interface', 'donnees', 'qrcode'].every(id => { const re = new RegExp('<script id="' + id + '"[^>]*>([\\s\\S]*?)<\\/script>'); const a = idx.match(re), b = html.match(re); return a && b && a[1] === b[1]; });
  const sw = fs.readFileSync(f('sw.js'), 'utf8'), swOk = /r\.mode === 'navigate'/.test(sw) && /caches\.open/.test(sw) && !/__VERSION__/.test(sw) && cp.spawnSync(process.execPath, ['--check', f('sw.js')]).status === 0;
  const png = n => { const b = fs.readFileSync(f(n)); return b.readUInt32BE(16) + 'x' + b.readUInt32BE(20); };
  const tailles = [png('icon-192.png'), png('icon-512.png'), png('icon-maskable-512.png')].join(',') === '192x192,512x512,512x512';
  const navA = nav ? navRes(/^appli en ligne|^lien de liaison/) : null, navOk = navA ? navA.length === 3 && navA.every(x => x.ok) : null;
  return { ok: manOk && lie && memeCode && swOk && tailles && qr && navOk !== false,
    detail: 'manifeste (standalone, icônes 192 et 512 dont masquable) : ' + (manOk ? 'oui' : 'NON') + ' ; même code que le fichier autonome : ' + (memeCode ? 'oui' : 'NON') + ' ; service worker valide : ' + (swOk ? 'oui' : 'NON') +
      ' ; QR code (bibliothèque MIT intégrée) : ' + (qr ? 'oui' : 'NON') + (navA ? ' ; navigateur : ' + navA.map(x => x.detail).join(' / ') : ' ; navigateur non contrôlé') };
});

// E28 après le contrôle navigateur : la mise en garde doit aussi s'afficher dans un vrai navigateur
preuve('E28', function () {
  const st = N.etatDefaut(), h = st.personnes[0], e = st.personnes[2];
  const ks = (fid, p) => N.avertissementsEau(fid, p).map(x => x.k).join(',');
  const fl = N.avertissementsEau('eauMagCrf', e).find(x => x.k === 'fluor');
  const eaux = Object.keys(D.aliments).filter(f => D.aliments[f].cats.indexOf('eau') >= 0);
  const sansSource = eaux.filter(f => D.aliments[f].etiquette && !D.aliments[f].etiquette.src);
  const sulfatees = eaux.filter(f => N.avertissementsEau(f, h).some(x => x.k === 'sulfates')).sort();
  const statique = ['avertissementsEauHTML(p)', 'COURT_EAU[x.k]', 'note-grave'].filter(x => ui.indexOf(x) < 0);
  const navFl = nav ? navRes(/mise en garde fluor/) : null, navOk = navFl ? navFl.length === 1 && navFl[0].ok : true;
  return { ok: !!fl && fl.grave === true && /moins de 7 ans/.test(fl.texte) && ks('rozana', h) === 'sodium' && ks('evian', e) === '' && sulfatees.join(',') === 'contrex,courmayeur,eauMagCrf,hepar' && !sansSource.length && !statique.length && navOk,
    detail: 'riches en sulfates : ' + sulfatees.join(', ') + ' ; fluor 1,6 mg/L de l\'eau magnésienne Carrefour signalé pour l\'enfant ; Rozana : « ' + ks('rozana', h) + ' »' + (navFl ? ' ; navigateur : ' + (navOk ? 'mise en garde affichée' : 'ÉCHEC') : ' ; navigateur non contrôlé') };
});

// ---------------------------------------------------------------- variables non déclarées (point 2 du protocole)
let lint = null;
for (const m of [process.env.ESLINT_PATH, 'eslint', '/opt/node-tools/node_modules/eslint']) {
  if (!m) continue;
  try {
    const { Linter } = require(m); const L = new Linter({ configType: 'flat' });
    const nav = { window: 'readonly', document: 'readonly', navigator: 'readonly', Blob: 'readonly', URL: 'readonly', FileReader: 'readonly', setTimeout: 'readonly', clearTimeout: 'readonly', setInterval: 'readonly', confirm: 'readonly', console: 'readonly',
      fetch: 'readonly', AbortController: 'readonly', TextEncoder: 'readonly', TextDecoder: 'readonly', btoa: 'readonly', atob: 'readonly', location: 'readonly', history: 'readonly', QRGEN: 'readonly' };
    const conf = glob => [{ languageOptions: { ecmaVersion: 2020, sourceType: 'script', globals: glob }, rules: { 'no-undef': 'error', 'no-unused-vars': ['warn', { args: 'none', caughtErrors: 'none' }], 'no-redeclare': 'error', 'no-dupe-keys': 'error', 'no-unreachable': 'error' } }];
    lint = [
      { nom: 'coeur', msgs: L.verify(coeur, conf(Object.assign({ DONNEES: 'readonly' }, nav))) },   // le cœur définit NUTRI
      { nom: 'interface', msgs: L.verify(ui, conf(Object.assign({ NUTRI: 'readonly' }, nav))) }   // l'interface l'utilise
    ];
    break;
  } catch (e) { /* suivant */ }
}

// ---------------------------------------------------------------- audit des mécanismes (point 7 du protocole)
const audit = N.auditMecanismes().map(a => {
  const defini = typeof N[a.fn] === 'function';
  const reDef = new RegExp('function\\s+' + a.fn + '\\s*\\(', 'g'), reAppel = new RegExp('\\b' + a.fn + '\\s*\\(', 'g');
  const nDef = (codeTotal.match(reDef) || []).length, nAppels = (codeTotal.match(reAppel) || []).length - nDef;
  const horsTest = (ui.match(new RegExp('N\\.' + a.fn + '\\s*\\(', 'g')) || []).length + (coeur.replace(/var MECANISMES[\s\S]*?function auditMecanismes/, '').match(reAppel) || []).length - nDef;
  return Object.assign(a, { defini, appels: nAppels, appelsHorsTest: horsTest });
});

// ---------------------------------------------------------------- rapport
ligne('Matrice d\'exigences — ' + path.basename(fichier) + ' (' + new Date().toLocaleString('fr-FR') + ')');
ligne('');
ligne('Contrôles techniques');
syntaxe.forEach(s => ligne('  ' + (s.ok ? 'OK    ' : 'ÉCHEC ') + 'node --check bloc ' + s.nom + (s.ok ? '' : ' : ' + s.detail)));
if (lint) lint.forEach(l => {
  const err = l.msgs.filter(m => m.severity === 2), avert = l.msgs.filter(m => m.severity === 1);
  ligne('  ' + (err.length ? 'ÉCHEC ' : 'OK    ') + 'ESLint bloc ' + l.nom + ' : ' + err.length + ' erreur(s) (variables non déclarées, doublons), ' + avert.length + ' avertissement(s)');
  err.concat(avert).slice(0, 8).forEach(m => ligne('          ligne ' + m.line + ' : ' + m.message));
});
else ligne('  —     ESLint absent : contrôle des variables non déclarées non fait (le cœur s\'exécute en mode strict).');
const listeFichier = exigFichier.map(e => e.id + '|' + e.texte).join('\n'), listeMatrice = MATRICE.map(e => e[0] + '|' + e[1]).join('\n');
ligne('  ' + (listeFichier === listeMatrice ? 'OK    ' : 'ÉCHEC ') + 'liste des exigences affichée dans le fichier identique à la matrice');
ligne('');
ligne('Audit des mécanismes (défini, appelé, fonctionnel)');
audit.forEach(a => ligne('  ' + (a.ok && a.defini && a.appelsHorsTest > 0 ? 'OK    ' : 'ÉCHEC ') + a.id.padEnd(14) + a.nom + ' — ' + a.fn + '() défini : ' + (a.defini ? 'oui' : 'NON') + ', appels hors test : ' + a.appelsHorsTest + (a.ok ? '' : ', test : ' + a.detail)));
ligne('');
ligne('Exigences');
let nOk = 0, nKo = 0, nNv = 0;
MATRICE.forEach(([id, texte]) => {
  const r = R[id] || { ok: false, detail: 'aucune preuve définie' };
  const etiquette = r.ok === null ? 'NON VÉRIFIÉ' : (r.ok ? 'OK' : 'ÉCHEC');
  if (r.ok === null) nNv++; else if (r.ok) nOk++; else nKo++;
  ligne('  ' + etiquette.padEnd(12) + id + '  ' + texte);
  ligne('              preuve : ' + r.detail);
});
ligne('');
if (statsOptim) ligne('Générateur (moyenne sur ' + statsOptim.n + ' semaines, 3 personnes, vitamine D comprise) : nutriments sous leur repère ' + statsOptim.cov.avant.sous.toFixed(1) + ' au hasard → ' + statsOptim.cov.apres.sous.toFixed(1) + ' avec le budget de 12 €/j (' + statsOptim.cov.sansBudget.sous.toFixed(1) + ' sans budget) ; repères PNNS atteints ' + statsOptim.cov.avant.pnns.toFixed(1) + ' → ' + statsOptim.cov.apres.pnns.toFixed(1) + ' (' + statsOptim.cov.sansBudget.pnns.toFixed(1) + ' sans budget) sur ' + statsOptim.nRep);
if (statsBudget) ligne('Budget par jour (' + statsBudget.n + ' semaines générées comme dans l\'outil) : ' + statsBudget.moy.toFixed(2) + ' €/j en moyenne avec le maximum de 12 €, jour le plus cher ' + statsBudget.max.toFixed(2) + ' € ; sans budget ' + statsBudget.moySans.toFixed(2) + ' €/j, ' + Math.round(100 * statsBudget.sous12Sans) + ' % des jours sous 12 €');
const auditOk = audit.every(a => a.ok && a.defini && a.appelsHorsTest > 0);
const techOk = syntaxe.every(s => s.ok) && (!lint || lint.every(l => !l.msgs.some(m => m.severity === 2))) && listeFichier === listeMatrice;
ligne('RÉSULTAT : ' + nOk + '/' + MATRICE.length + ' exigences prouvées' + (nNv ? ', ' + nNv + ' non vérifiable(s) ici' : '') + (nKo ? ', ' + nKo + ' en ÉCHEC' : '') + ' ; mécanismes ' + audit.filter(a => a.ok && a.defini && a.appelsHorsTest > 0).length + '/' + audit.length + ' ; contrôles techniques ' + (techOk ? 'OK' : 'EN ÉCHEC'));
try { fs.rmSync(tmp, { recursive: true, force: true }); } catch (e) { /* rien */ }
process.exit(nKo || !auditOk || !techOk ? 1 : 0);
