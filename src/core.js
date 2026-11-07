/* exported NUTRI */
/* =====================================================================
   Équilibre alimentaire du foyer — cœur de calcul
   Aucun accès au DOM : ce bloc s'exécute aussi dans node (verif_exigences.js).
   ===================================================================== */
var NUTRI = (function (D) {
  'use strict';

  var AL = D.aliments, ACH = D.achats, RECS = D.recettes;
  var VERSION = '1.2.0';
  var A21 = 'ANSES, références nutritionnelles en vitamines et minéraux (page du 21/02/2025)';

  // ------------------------------------------------------------------ nutriments
  var NUTS = D.meta.nutriments.slice();
  NUTS.push({ k: 'epadha', nom: 'Oméga-3 EPA + DHA', u: 'g', code: '42053+42263' });
  var K = NUTS.map(function (n) { return n.k; });
  var KI = {}; K.forEach(function (k, i) { KI[k] = i; });
  var NK = K.length;
  // caractéristiques supplémentaires pour les repères PNNS
  var FEAT = K.concat(['fl', 'pl', 'vi', 'ch', 'fc', 'nx']);
  var FI = {}; FEAT.forEach(function (k, i) { FI[k] = i; });
  var NF = FEAT.length;

  var INFO = {};
  NUTS.forEach(function (n) { INFO[n.k] = n; });

  var JOURS = ['Lundi', 'Mardi', 'Mercredi', 'Jeudi', 'Vendredi', 'Samedi', 'Dimanche'];
  var MOMENTS = [
    { k: 'matin', nom: 'Petit-déjeuner', repas: false },
    { k: 'midi', nom: 'Déjeuner', repas: true },
    { k: 'gouter', nom: 'Goûter de 16 h', repas: false },
    { k: 'soir', nom: 'Dîner', repas: true }
  ];
  var RECETTE = {}; RECS.forEach(function (r) { RECETTE[r.id] = r; });
  var EXTERIEUR = RECS.filter(function (r) { return r.exterieur; })[0];

  // ------------------------------------------------------------------ outils
  function zeros(n) { return new Float64Array(n); }
  function ajoute(dst, src, f) { for (var i = 0; i < dst.length; i++) dst[i] += src[i] * f; }
  function clamp(x, a, b) { return Math.max(a, Math.min(b, x)); }
  function mulberry32(a) {
    return function () {
      a |= 0; a = a + 0x6D2B79F5 | 0;
      var t = Math.imul(a ^ a >>> 15, 1 | a);
      t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
      return ((t ^ t >>> 14) >>> 0) / 4294967296;
    };
  }
  function clone(o) { return JSON.parse(JSON.stringify(o)); }

  // ------------------------------------------------------------------ état par défaut
  function grille(v) { var g = []; for (var d = 0; d < 7; d++) { g.push([v, v, v, v]); } return g; }
  function etatDefaut() {
    return {
      app: 'equilibre-alimentaire', version: 1,
      personnes: [
        { id: 'a1', nom: 'Adulte 1', type: 'adulte', sexe: 'H', age: 40, poids: 75, taille: 175, nap: 1.6, fer: 'normal', phytates: 600, energieManuelle: null, facteurMode: 'auto', facteurManuel: 1, eau: 'eauRobinet', eauMl: 1500, presence: grille(true) },
        { id: 'a2', nom: 'Adulte 2', type: 'adulte', sexe: 'F', age: 38, poids: 62, taille: 165, nap: 1.6, fer: 'normal', phytates: 600, energieManuelle: null, facteurMode: 'auto', facteurManuel: 1, eau: 'eauRobinet', eauMl: 1300, presence: grille(true) },
        { id: 'e1', nom: 'Enfant', type: 'enfant', sexe: 'NP', age: 7, poids: 23, taille: 122, activite: 'moyenne', phytates: 600, energieManuelle: null, facteurMode: 'auto', facteurManuel: 0.75, eau: 'eauRobinet', eauMl: 900, presence: grille(true) }
      ],
      plan: grille(null),
      verrous: grille(false),
      prix: {},
      substitutions: { lait: 'lait' },
      budgetJour: { max: BUDGET_DEFAUT.max, cible: BUDGET_DEFAUT.cible },  // € par jour pour le foyer (repas à la maison + eau)
      prepMax: PREP_DEFAUT,          // minutes de préparation hors cuisson ; 0 = sans limite
      horaires: HORAIRES_DEFAUT.slice(),
      iterations: 8000,
      coches: {},
      faits: {},                     // repas préparés : 'AAAA-MM-JJ:créneau' -> true
      maj: majVide(),                // dates des dernières modifications (synchronisation entre appareils)
      graine: 20261011
    };
  }
  // Demande du 07/11/2026 : budget limité à 10-12 € par jour, préparation de 15 à 20 min au plus hors cuisson
  var BUDGET_DEFAUT = { max: 12, cible: 10 };
  var PREP_DEFAUT = 20, PREP_CHOIX = [15, 20, 30, 0];
  var HORAIRES_DEFAUT = ['07:30', '12:15', '16:00', '19:15'];
  var FAITS_JOURS = 21;              // repas « préparés » gardés 3 semaines
  function majVide() { return { foyer: 0, semaine: 0, prix: 0, reglages: 0, coches: {}, faits: {} }; }
  function heureValide(h) { return typeof h === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(h); }

  function normaliserEtat(o) {
    var def = etatDefaut();
    if (!o || typeof o !== 'object') return def;
    var st = def;
    if (Array.isArray(o.personnes) && o.personnes.length === 3) {
      st.personnes = o.personnes.map(function (p, i) {
        var base = def.personnes[i], q = {};
        Object.keys(base).forEach(function (k) { q[k] = (p && p[k] !== undefined) ? p[k] : base[k]; });
        q.type = base.type; q.id = base.id;
        // valeurs énumérées : une valeur inconnue (fichier importé abîmé) reprend la valeur par défaut
        if ((q.type === 'adulte' ? ['H', 'F'] : ['NP', 'G', 'F']).indexOf(q.sexe) < 0) q.sexe = base.sexe;
        if (q.type === 'adulte') { if (['normal', 'eleve', 'menopause'].indexOf(q.fer) < 0) q.fer = base.fer; }
        else if (!NAP_ENFANT[q.activite]) q.activite = base.activite;
        if (['auto', 'manuel'].indexOf(q.facteurMode) < 0) q.facteurMode = base.facteurMode;
        q.nom = String(q.nom == null ? '' : q.nom).trim().slice(0, 30) || base.nom;
        ['age', 'poids', 'taille', 'nap', 'eauMl', 'facteurManuel', 'phytates'].forEach(function (k) {
          var x = Number(q[k]); q[k] = isFinite(x) ? x : base[k];
        });
        q.age = clamp(q.age, q.type === 'adulte' ? 18 : 3, q.type === 'adulte' ? 100 : 17);
        q.poids = clamp(q.poids, 10, 250); q.taille = clamp(q.taille, 80, 230);
        q.nap = clamp(q.nap, 1.2, 2.4); q.eauMl = clamp(q.eauMl, 0, 4000);
        q.facteurManuel = clamp(q.facteurManuel, 0.3, 2);
        if ([300, 600, 900].indexOf(q.phytates) < 0) q.phytates = 600;
        if (q.energieManuelle != null) { var e = Number(q.energieManuelle); q.energieManuelle = (isFinite(e) && e >= 800 && e <= 5000) ? e : null; }
        if (!AL[q.eau] || AL[q.eau].cats.indexOf('eau') < 0) q.eau = 'eauRobinet';
        if (!Array.isArray(q.presence) || q.presence.length !== 7) q.presence = grille(true);
        q.presence = q.presence.map(function (j) { return (Array.isArray(j) && j.length === 4) ? j.map(Boolean) : [true, true, true, true]; });
        return q;
      });
    }
    if (Array.isArray(o.plan) && o.plan.length === 7) {
      st.plan = o.plan.map(function (j, d) {
        return [0, 1, 2, 3].map(function (s) {
          var id = Array.isArray(j) ? j[s] : null;
          return (id && RECETTE[id] && !RECETTE[id].exterieur && RECETTE[id].moments.indexOf(MOMENTS[s].k) >= 0) ? id : null;
        });
      });
    }
    if (Array.isArray(o.verrous) && o.verrous.length === 7) st.verrous = o.verrous.map(function (j) { return [0, 1, 2, 3].map(function (s) { return !!(Array.isArray(j) && j[s]); }); });
    if (o.prix && typeof o.prix === 'object') {
      Object.keys(o.prix).forEach(function (id) {
        if (!ACH[id]) return;
        var p = o.prix[id] || {}, q = {};
        if (isFinite(Number(p.prix)) && Number(p.prix) >= 0) q.prix = Number(p.prix);
        if (isFinite(Number(p.qte)) && Number(p.qte) > 0) q.qte = Number(p.qte);
        if (Object.keys(q).length) st.prix[id] = q;
      });
    }
    if (o.substitutions && (o.substitutions.lait === 'laitD' || o.substitutions.lait === 'lait')) st.substitutions.lait = o.substitutions.lait;
    // budget par jour (v1.2.0) ; un ancien budget par semaine (v1.1.0) devient un maximum par jour
    var bj = o.budgetJour;
    if (bj && typeof bj === 'object') {
      var mx = Number(bj.max), ci = Number(bj.cible);
      st.budgetJour.max = (isFinite(mx) && mx >= 0) ? Math.min(mx, 500) : BUDGET_DEFAUT.max;
      st.budgetJour.cible = (isFinite(ci) && ci >= 0) ? Math.min(ci, 500) : BUDGET_DEFAUT.cible;
    } else if (isFinite(Number(o.budget)) && Number(o.budget) > 0) {
      st.budgetJour.max = Math.round(Number(o.budget) / 7 * 100) / 100;
      st.budgetJour.cible = Math.min(st.budgetJour.cible, st.budgetJour.max);
    }
    if (st.budgetJour.max > 0 && st.budgetJour.cible > st.budgetJour.max) st.budgetJour.cible = st.budgetJour.max;
    var pm = Number(o.prepMax); if (o.prepMax != null && PREP_CHOIX.indexOf(pm) >= 0) st.prepMax = pm;
    if (Array.isArray(o.horaires) && o.horaires.length === 4) st.horaires = o.horaires.map(function (h, s) { return heureValide(h) ? h : HORAIRES_DEFAUT[s]; });
    var it = Number(o.iterations); st.iterations = [3000, 8000, 20000].indexOf(it) >= 0 ? it : 8000;
    if (o.coches && typeof o.coches === 'object') Object.keys(o.coches).forEach(function (k) { if ((ACH[k] || k.indexOf('placard:') === 0) && o.coches[k]) st.coches[k] = true; });
    if (o.faits && typeof o.faits === 'object') Object.keys(o.faits).forEach(function (k) { if (/^\d{4}-\d{2}-\d{2}:[0-3]$/.test(k) && o.faits[k]) st.faits[k] = true; });
    var m = o.maj;
    if (m && typeof m === 'object') {
      ['foyer', 'semaine', 'prix', 'reglages'].forEach(function (k) { var t = Number(m[k]); st.maj[k] = isFinite(t) && t > 0 ? t : 0; });
      ['coches', 'faits'].forEach(function (c) {
        if (m[c] && typeof m[c] === 'object') Object.keys(m[c]).forEach(function (k) { var t = Number(m[c][k]); if (isFinite(t) && t > 0) st.maj[c][k] = t; });
      });
    }
    if (isFinite(Number(o.graine))) st.graine = Number(o.graine) | 0;
    return st;
  }

  // ------------------------------------------------------------------ besoins
  // Enfant : métabolisme de base de Schofield (OMS 1985) d'après le poids, × niveau d'activité (NAP),
  // + 1 % pour la croissance. Au poids de référence des 7-10 ans (≈ 28 kg) et au NAP 1,6, on retrouve
  // les besoins ANSES 2019 (1 851 kcal garçon, 1 726 kcal fille) ; un enfant de 7 ans pèse moins.
  var NAP_ENFANT = { faible: 1.4, moyenne: 1.6, elevee: 1.8 };
  var CROISSANCE = 1.01;
  function metabolismeEnfant(p) {  // kcal/j
    var W = p.poids, jeune = p.age < 10;
    var g = jeune ? 22.706 * W + 504.3 : 17.686 * W + 658.2;
    var f = jeune ? 20.315 * W + 485.9 : 13.384 * W + 692.6;
    return p.sexe === 'G' ? g : (p.sexe === 'F' ? f : (g + f) / 2);
  }
  function besoinEnergie(p) {
    if (p.energieManuelle) return Math.round(p.energieManuelle);
    if (p.type === 'adulte') {
      var k = p.sexe === 'H' ? 1.083 : 0.963;  // Black et al. 1996, MJ/j
      var mb = k * Math.pow(p.poids, 0.48) * Math.pow(p.taille / 100, 0.5) * Math.pow(p.age, -0.13);
      return Math.round(mb * 239.006 * p.nap);
    }
    return Math.round(metabolismeEnfant(p) * (NAP_ENFANT[p.activite] || 1.6) * CROISSANCE);
  }

  function references(p, E) {
    var R = {}, MJ = E / 239.006;
    R.kcal = { t: 'cible', v: E, src: p.energieManuelle ? 'valeur saisie' : (p.type === 'adulte' ? 'Black et al. 1996 × niveau d\'activité' : 'Schofield (OMS 1985) d\'après le poids × activité (NAP ' + String(NAP_ENFANT[p.activite] || 1.6).replace('.', ',') + ') + 1 % de croissance, cohérent avec l\'ANSES 2019 pour les 7-10 ans') };
    R.gluc = { t: 'plage', min: 0.40 * E / 4, max: 0.55 * E / 4, src: 'ANSES 2016 : 40 à 55 % de l\'énergie' };
    R.lip = { t: 'plage', min: 0.35 * E / 9, max: 0.40 * E / 9, src: 'ANSES 2011 : 35 à 40 % de l\'énergie' };
    R.ags = { t: 'max', v: 0.12 * E / 9, src: 'ANSES 2011 : au plus 12 % de l\'énergie' };
    R.ala = { t: 'AS', v: 0.01 * E / 9, src: 'ANSES 2011 : 1 % de l\'énergie' };
    R.b1 = { t: 'RNP', v: 0.1 * MJ, src: A21 + ' (0,1 mg/MJ)' };
    if (p.type === 'adulte') {
      var H = p.sexe === 'H';
      var zn = H ? { 300: 9.4, 600: 11.7, 900: 14.0 } : { 300: 7.5, 600: 9.3, 900: 11.0 };
      R.prot = { t: 'RNP', v: 0.83 * p.poids, src: 'ANSES : 0,83 g/kg/j' };
      R.sucresHL = { t: 'max', v: 100, src: 'ANSES 2016 : 100 g/j hors lactose et galactose' };
      R.fib = { t: 'AS', v: 30, src: 'ANSES 2016' };
      R.ca = { t: 'RNP', v: p.age < 25 ? 1000 : 950, lss: 2500, src: A21 };
      R.mg = { t: 'AS', v: H ? 380 : 300, src: A21, note: 'La limite de 250 mg ne concerne que les compléments.' };
      R.fe = { t: 'RNP', v: H ? 11 : (p.fer === 'eleve' ? 16 : 11), lss: 40, src: A21 + (H ? '' : (p.fer === 'eleve' ? ' (pertes menstruelles élevées)' : (p.fer === 'menopause' ? ' (femme ménopausée)' : ' (pertes menstruelles faibles à modérées)'))) };
      R.zn = { t: 'RNP', v: zn[p.phytates] || zn[600], lss: 25, src: A21 + ' (apport en phytates ' + p.phytates + ' mg/j)' };
      R.k = { t: 'AS', v: 3500, src: A21 };
      R.p = { t: 'AS', v: 550, src: A21 };
      R.na = { t: 'max', v: 2300, as: 1500, src: A21 + ' (LSS ; apport satisfaisant 1 500 mg)' };
      R.cu = { t: 'AS', v: H ? 1.9 : 1.5, lss: 5, src: A21 };
      R.se = { t: 'AS', v: 70, lss: 255, src: A21 };
      R.i = { t: 'AS', v: 150, lss: 600, src: A21 };
      R.vitA = { t: 'RNP', v: H ? 750 : 650, src: A21 };
      R.vitD = { t: 'AS', v: 15, lss: 100, src: A21 };
      R.vitE = { t: 'AS', v: H ? 10 : 9, lss: 300, src: A21 };
      R.vitC = { t: 'RNP', v: 110, src: A21 };
      R.b2 = { t: 'RNP', v: 1.6, src: A21 };
      R.b6 = { t: 'RNP', v: H ? 1.7 : 1.6, lss: 12, src: A21 };
      R.b9 = { t: 'RNP', v: 330, src: A21 };
      R.b12 = { t: 'AS', v: 4, src: A21 };
      R.epadha = { t: 'AS', v: 0.5, src: 'ANSES 2011 : EPA 250 mg + DHA 250 mg' };
    } else {
      R.prot = { t: 'RNP', v: 0.91 * p.poids, src: 'EFSA 2012 : 0,91 g/kg/j à 7 ans' };
      R.sucresHL = { t: 'max', v: p.age <= 7 ? 60 : 75, src: 'ANSES 2016 : ' + (p.age <= 7 ? '60 g/j de 4 à 7 ans' : '75 g/j de 8 à 12 ans') };
      R.fib = { t: 'AS', v: 16, src: 'ANSES 2019 (7-10 ans)' };
      R.ca = { t: 'RNP', v: 800, src: A21 + ' (4-10 ans)' };
      R.mg = { t: 'AS', v: 240, src: A21 + ' (7-10 ans)', note: 'La limite de 250 mg ne concerne que les compléments.' };
      R.fe = { t: 'RNP', v: 6, lss: 20, src: A21 + ' (7-11 ans)' };
      R.zn = { t: 'RNP', v: 7.4, lss: 13, src: A21 + ' (7-10 ans)' };
      R.k = { t: 'AS', v: 1800, src: A21 + ' (7-10 ans)' };
      R.p = { t: 'AS', v: 440, src: A21 + ' (7-10 ans)' };
      R.na = p.age <= 8 ? { t: 'max', v: 1500, as: 1000, src: A21 + ' (4-8 ans, LSS)' } : { t: 'max', v: 1800, as: 1200, src: A21 + ' (9-13 ans, LSS)' };
      R.cu = { t: 'AS', v: 1.2, lss: 3, src: A21 + ' (7-10 ans)' };
      R.se = { t: 'AS', v: 35, lss: 130, src: A21 + ' (7-10 ans)' };
      R.i = { t: 'AS', v: 90, lss: 300, src: A21 + ' (7-10 ans)' };
      R.vitA = { t: 'RNP', v: 400, src: A21 + ' (7-10 ans)' };
      R.vitD = { t: 'AS', v: 15, lss: 50, src: A21 + ' (4-10 ans)' };
      R.vitE = { t: 'AS', v: 9, lss: 160, src: A21 + ' (7-10 ans)' };
      R.vitC = { t: 'RNP', v: 45, src: A21 + ' (7-10 ans)' };
      R.b2 = { t: 'RNP', v: 1.0, src: A21 + ' (7-10 ans)' };
      R.b6 = { t: 'RNP', v: 1.0, lss: 6.1, src: A21 + ' (7-10 ans)' };
      R.b9 = { t: 'RNP', v: 200, src: A21 + ' (7-10 ans)' };
      R.b12 = { t: 'AS', v: 1.5, src: A21 + ' (4-10 ans)' };
      R.epadha = { t: 'AS', v: 0.25, src: 'ANSES 2019 (7-10 ans)' };
    }
    return R;
  }

  function horsTranche(p) {
    return p.type === 'enfant' && (p.age < 7 || p.age > 10);
  }

  function statut(ref, val) {
    if (!ref) return 'na';
    if (ref.lss != null && val > ref.lss) return 'lss';
    if (ref.t === 'RNP' || ref.t === 'AS') { var c = val / ref.v; return c >= 1 ? 'ok' : (c >= 0.7 ? 'proche' : 'bas'); }
    if (ref.t === 'max') return val > ref.v ? 'exces' : 'ok';
    if (ref.t === 'plage') {
      if (val < ref.min) return val < 0.85 * ref.min ? 'bas' : 'proche';
      if (val > ref.max) return val > 1.15 * ref.max ? 'exces' : 'proche';
      return 'ok';
    }
    if (ref.t === 'cible') { var c2 = val / ref.v; return c2 < 0.9 ? 'bas' : (c2 > 1.1 ? 'exces' : 'ok'); }
    return 'na';
  }

  // ------------------------------------------------------------------ aliments, prix, rendements
  function prixEffectif(st, id) {
    var b = ACH[id], o = (st && st.prix && st.prix[id]) || {};
    return { id: id, nom: b.nom, marque: b.marque, unite: b.unite, comest: b.comest, gpc: b.gpc, rayon: b.rayon, ean: b.ean, date: b.date, src: b.src,
      prix: o.prix != null ? o.prix : b.prix, qte: o.qte != null ? o.qte : b.qte, modifie: o.prix != null || o.qte != null, prixDefaut: b.prix, qteDefaut: b.qte };
  }
  // poids mesuré en cuisine (g) d'une quantité exprimée dans l'unité de l'aliment
  function grammes(a, q) {
    if (a.unite === 'ml') return q * (a.dens || 1);
    if (a.unite === 'pc') return q * (a.gpc || 50);
    return q;
  }
  // poids dans l'état de l'entrée CIQUAL (rendement cru -> cuit)
  function grammesCiqual(a, q) { return grammes(a, q) * (a.y || 1); }
  // quantité d'achat (dans l'unité de l'article : g, ml ou pièces), partie comestible incluse
  function qteAchat(st, a, q) {
    var p = prixEffectif(st, a.achat), gm = grammes(a, q);
    if (p.unite === 'pc') return gm / (p.gpc || 1);
    if (p.unite === 'ml') return (gm / (a.dens || 1)) / (p.comest || 1);
    return gm / (p.comest || 1);
  }
  function coutLigne(st, a, q) {
    var p = prixEffectif(st, a.achat);
    return qteAchat(st, a, q) * p.prix / p.qte;
  }
  function valeur(a, k) {
    if (k === 'epadha') { var e = a.v.epa, h = a.v.dha; return (e == null || h == null) ? null : e + h; }
    return a.v[k];
  }
  function nutrimentsAliment(fid, q) {
    var a = AL[fid], g = grammesCiqual(a, q), o = {};
    K.forEach(function (k) { var v = valeur(a, k); o[k] = v == null ? null : v * g / 100; });
    return o;
  }
  function aliment(fid, st) {
    var subs = (st && st.substitutions) || {};
    return AL[subs[fid] || fid] ? (subs[fid] || fid) : fid;
  }

  // ------------------------------------------------------------------ vecteurs de recette
  function vecteurRecette(st, r) {
    var o = { id: r.id, Vu: zeros(NF), Vs: zeros(NF), Mu: zeros(NK), Ms: zeros(NK), Gu: 0, Gs: 0, Cu: 0, Cs: 0, Au: {}, As: {}, leg: 0, poi: 0, pg: 0 };
    r.lignes.forEach(function (l) {
      var fid = aliment(l.f, st), a = AL[fid];
      var gm = grammes(a, l.q), gN = gm * (a.y || 1);
      var V = l.u ? o.Vu : o.Vs, M = l.u ? o.Mu : o.Ms;
      for (var i = 0; i < NK; i++) {
        var v = valeur(a, K[i]);
        if (v == null) M[i] += gm; else V[i] += v * gN / 100;
      }
      var cats = a.cats;
      var c0 = cats.map(function (c) { return c.split(':')[0]; });
      if (c0.indexOf('fruit') >= 0 || c0.indexOf('legume') >= 0) V[FI.fl] += gm;
      cats.forEach(function (c) { if (c.indexOf('laitier:') === 0) V[FI.pl] += l.q / Number(c.split(':')[1]); });
      if (c0.indexOf('viande') >= 0) V[FI.vi] += gm;
      if (c0.indexOf('charcuterie') >= 0) V[FI.ch] += gm;
      if (c0.indexOf('feculentComplet') >= 0) V[FI.fc] += gm;
      if (c0.indexOf('fruitCoque') >= 0) V[FI.nx] += gm;
      if (c0.indexOf('legSecs') >= 0) o.leg = 1;
      if (c0.indexOf('poisson') >= 0) o.poi = 1;
      if (c0.indexOf('poissonGras') >= 0) o.pg = 1;
      if (c0.indexOf('eau') < 0) { if (l.u) o.Gu += gm; else o.Gs += gm; }
      var qa = qteAchat(st, a, l.q), p = prixEffectif(st, a.achat);
      var A = l.u ? o.Au : o.As;
      A[a.achat] = (A[a.achat] || 0) + qa;
      if (l.u) o.Cu += qa * p.prix / p.qte; else o.Cs += qa * p.prix / p.qte;
    });
    return o;
  }

  function vecteurEau(st, wid, ml) {
    var a = AL[wid], v = zeros(NF), dens = a.dens || 1, p = prixEffectif(st, a.achat);
    for (var i = 0; i < NK; i++) { var x = valeur(a, K[i]); v[i] = (x || 0) * ml * dens / 100; }
    return { V: v, cout: (ml / (p.comest || 1)) * p.prix / p.qte, achat: a.achat, qte: ml };
  }

  // Mises en garde d'étiquette sur l'eau de boisson. Seuils réglementaires (directives 2003/40/CE et
  // 2009/54/CE) : fluor > 1,5 mg/L (mention obligatoire), sodium > 200 mg/L (« contient du sodium »),
  // résidu sec > 1 500 mg/L (« riche en sels minéraux ») ; sulfates > 1 000 mg/L : effet laxatif possible.
  function virgule(x) { return String(x).replace('.', ','); }
  function avertissementsEau(fid, p) {
    var a = AL[fid], L = [];
    if (!a || a.cats.indexOf('eau') < 0) return L;
    var e = a.etiquette || {}, na = (a.v.na || 0) * 10, enfant = !!(p && p.type === 'enfant');
    if (e.fluor != null && e.fluor > 1.5) {
      L.push({ k: 'fluor', grave: enfant, texte: 'contient plus de 1,5 mg/L de fluor (' + virgule(e.fluor) + ' mg/L) : la mention légale la déconseille aux nourrissons et aux enfants de moins de 7 ans en consommation régulière' +
        (enfant ? (p.age < 7 ? ' ; elle ne convient donc pas à cet enfant comme eau de tous les jours' : ' ; à ' + p.age + ' ans, demander l\'avis du médecin ou du dentiste avant d\'en faire l\'eau de tous les jours (le dentifrice apporte déjà du fluor)') : '') });
    }
    if (e.sulfates != null && e.sulfates > 1000) L.push({ k: 'sulfates', grave: false, texte: 'riche en sulfates (' + e.sulfates + ' mg/L) : effet laxatif possible, à introduire progressivement' });
    if (na > 200) L.push({ k: 'sodium', grave: false, texte: 'contient du sodium (' + Math.round(na) + ' mg/L), compté dans le sel de la journée' });
    if (enfant && e.residu != null && e.residu > 1500) L.push({ k: 'mineralisation', grave: false, texte: 'riche en sels minéraux (résidu sec ' + e.residu + ' mg/L) : pour un enfant, avis du médecin si elle devient l\'eau de tous les jours' });
    return L;
  }

  // la recette tient-elle dans le temps de préparation choisi (hors cuisson) ?
  function prepOk(st, r) { return !st.prepMax || r.prep <= st.prepMax; }
  function preparer(st) {
    // cand : ce que le générateur peut proposer (temps de préparation respecté) ; candTous : choix à la main
    var ctx = { rec: {}, ext: null, cand: [], candTous: [] };
    RECS.forEach(function (r) { var v = vecteurRecette(st, r); if (r.exterieur) ctx.ext = v; else ctx.rec[r.id] = v; });
    for (var d = 0; d < 7; d++) {
      var tous = MOMENTS.map(function (m) {
        return RECS.filter(function (r) { return !r.exterieur && r.moments.indexOf(m.k) >= 0 && (!r.jours || r.jours.indexOf(d) >= 0); }).map(function (r) { return r.id; });
      });
      ctx.candTous.push(tous);
      ctx.cand.push(tous.map(function (L) {
        var ok = L.filter(function (id) { return prepOk(st, RECETTE[id]); });
        return ok.length ? ok : L;   // jamais de créneau sans proposition
      }));
    }
    ctx.eau = st.personnes.map(function (p) { return vecteurEau(st, p.eau, p.eauMl); });
    return ctx;
  }

  // ------------------------------------------------------------------ évaluation d'une semaine
  function facteurPortion(p, Eu, Es, E) {
    if (p.facteurMode === 'manuel') return p.facteurManuel;
    if (Es <= 0) return 1;
    return clamp((7 * E - Eu) / Es, 0.5, 1.8);
  }

  function evaluer(st, ctx, leger) {
    var res = { personnes: [], cout: 0, coutEau: 0, coutJours: [0, 0, 0, 0, 0, 0, 0], coutEauJour: 0 };
    st.personnes.forEach(function (p, pi) {
      var SU = zeros(NF), SS = zeros(NF), MU = zeros(NK), MS = zeros(NK), GU = 0, GS = 0, CU = 0, CS = 0;
      var leg = 0, poi = 0, pg = 0, nRepasDehors = 0, nVides = 0;
      var jU = [], jS = [], fcU = [0, 0, 0, 0, 0, 0, 0], fcS = [0, 0, 0, 0, 0, 0, 0];
      var cuJ = [0, 0, 0, 0, 0, 0, 0], csJ = [0, 0, 0, 0, 0, 0, 0];  // coût des repas pris à la maison, par jour
      for (var d = 0; d < 7; d++) {
        var dU = leger ? null : zeros(NF), dS = leger ? null : zeros(NF);
        for (var s = 0; s < 4; s++) {
          var R = null, ext = false;
          if (p.presence[d][s]) { var id = st.plan[d][s]; if (id) R = ctx.rec[id]; else nVides++; }
          else if (MOMENTS[s].repas) { R = ctx.ext; ext = true; nRepasDehors++; }
          if (!R) continue;
          ajoute(SU, R.Vu, 1); ajoute(SS, R.Vs, 1);
          fcU[d] += R.Vu[FI.fc]; fcS[d] += R.Vs[FI.fc];  // féculents complets du jour (repère « chaque jour »), aussi en mode léger
          if (!leger) { ajoute(dU, R.Vu, 1); ajoute(dS, R.Vs, 1); ajoute(MU, R.Mu, 1); ajoute(MS, R.Ms, 1); GU += R.Gu; GS += R.Gs; }
          if (!ext) { CU += R.Cu; CS += R.Cs; cuJ[d] += R.Cu; csJ[d] += R.Cs; }
          leg += R.leg; poi += R.poi; pg += R.pg;
        }
        if (!leger) { jU.push(dU); jS.push(dS); }
      }
      var E = besoinEnergie(p);
      var F = facteurPortion(p, SU[KI.kcal], SS[KI.kcal], E);
      var eau = ctx.eau[pi];
      var sem = zeros(NF); ajoute(sem, SU, 1); ajoute(sem, SS, F); ajoute(sem, eau.V, 7);
      var moy = zeros(NF); ajoute(moy, sem, 1 / 7);
      var refs = references(p, E);
      var sFc = SEUIL_FC * Math.min(1, F) - 1e-9, joursFc = 0;
      for (var dj = 0; dj < 7; dj++) if (fcU[dj] + F * fcS[dj] >= sFc) joursFc++;
      var out = { id: p.id, nom: p.nom, E: E, F: F, moy: moy, sem: sem, refs: refs, leg: leg, poi: poi, pg: pg, joursFc: joursFc,
        cout: CU + F * CS + 7 * eau.cout, coutEau: 7 * eau.cout, nRepasDehors: nRepasDehors, nVides: nVides,
        coutJours: cuJ.map(function (u, d) { return u + F * csJ[d] + eau.cout; }) };
      for (var dc = 0; dc < 7; dc++) res.coutJours[dc] += out.coutJours[dc];
      res.coutEauJour += eau.cout;
      if (!leger) {
        out.jours = jU.map(function (u, d) { var v = zeros(NF); ajoute(v, u, 1); ajoute(v, jS[d], F); ajoute(v, eau.V, 1); return v; });
        out.completude = {};
        var G = GU + F * GS;
        K.forEach(function (k, i) { out.completude[k] = G > 0 ? 1 - (MU[i] + F * MS[i]) / G : 1; });
        out.statuts = {};
        K.forEach(function (k) { if (refs[k]) out.statuts[k] = statut(refs[k], moy[KI[k]]); });
        out.pnns = reperesPNNS(p, out);
      }
      res.cout += out.cout; res.coutEau += out.coutEau;
      res.personnes.push(out);
    });
    return res;
  }

  // ------------------------------------------------------------------ repères PNNS / Santé publique France
  function reperesPNNS(p, pr) {
    var enfant = p.type === 'enfant', F = pr.F;
    var portionFL = 80 * Math.min(1, F);
    var fl = pr.moy[FI.fl] / portionFL;
    var pl = pr.moy[FI.pl];
    var cibleLait = enfant ? 3 : 2;
    var limViande = enfant ? 500 * Math.min(1, F) : 500, limCharc = enfant ? 150 * Math.min(1, F) : 150;
    var vi = pr.sem[FI.vi], ch = pr.sem[FI.ch];
    // seuils journaliers à l'échelle des portions de la personne (comme la portion de fruits et légumes) ;
    // jours avec féculents complets : calculés dans evaluer (joursFc), aussi en mode léger pour le générateur
    var joursComplets = pr.joursFc || 0, joursCoque = 0, sNx = SEUIL_NX * Math.min(1, F) - 1e-9;
    if (pr.jours) pr.jours.forEach(function (v) { if (v[FI.nx] >= sNx) joursCoque++; });
    var L = [
      { k: 'fl', nom: 'Fruits et légumes', val: fl, cible: '≥ 5 portions/j', ok: fl >= 5, txt: fl.toFixed(1) + ' portions/j', src: 'PNNS' },
      { k: 'pl', nom: 'Produits laitiers', val: pl, cible: '≥ ' + cibleLait + '/j', ok: pl >= cibleLait - 0.05, txt: pl.toFixed(1) + '/j', src: enfant ? 'Santé publique France 2024 (4-11 ans)' : 'PNNS' },
      { k: 'leg', nom: 'Légumes secs', val: pr.leg, cible: '≥ 2 fois/sem.', ok: pr.leg >= 2, txt: pr.leg + ' fois', src: 'PNNS' },
      { k: 'poi', nom: 'Poisson', val: pr.poi, cible: '≥ 2 fois/sem.', ok: pr.poi >= 2, txt: pr.poi + ' fois', src: 'PNNS' },
      { k: 'pg', nom: 'Dont poisson gras', val: pr.pg, cible: '≥ 1 fois/sem.', ok: pr.pg >= 1, txt: pr.pg + ' fois', src: 'PNNS' },
      { k: 'vi', nom: 'Viande hors volaille', val: vi, cible: '≤ ' + Math.round(limViande) + ' g/sem.', ok: vi <= limViande, txt: Math.round(vi) + ' g (cru)', src: enfant ? 'PNNS adulte, proratisé' : 'PNNS' },
      { k: 'ch', nom: 'Charcuterie', val: ch, cible: '≤ ' + Math.round(limCharc) + ' g/sem.', ok: ch <= limCharc, txt: Math.round(ch) + ' g', src: enfant ? 'PNNS adulte, proratisé' : 'PNNS' },
      { k: 'fc', nom: 'Féculents complets', val: joursComplets, cible: 'chaque jour', ok: joursComplets >= 7, txt: joursComplets + ' j/7', src: 'PNNS' },
      { k: 'nx', nom: 'Fruits à coque', val: joursCoque, cible: 'une petite poignée/j', ok: joursCoque >= 4, txt: joursCoque + ' j/7', src: 'PNNS', info: true }
    ];
    return L;
  }

  // ------------------------------------------------------------------ score (sert au générateur)
  var POIDS = { mg: 2, fe: 2, ca: 2, zn: 1, k: 1, p: 0.5, i: 1, se: 0.5, cu: 0.5, vitA: 1, vitD: 0.5, vitE: 1, vitC: 1, b1: 0.5, b2: 0.5, b6: 0.5, b9: 1, b12: 1, fib: 1, ala: 0.5, epadha: 1, prot: 0.5 };
  var LIMITES_REP = { matin: 2, midi: 1, soir: 1, gouter: 2 };
  var SEUIL_FC = 25, SEUIL_NX = 10;  // g/j de féculents complets et de fruits à coque pour compter le jour (portion adulte)
  var POIDS_FC_JOUR = 0.25;          // pénalité par jour sans féculent complet, par personne
  var PALIER_LIMITE = 0.5;           // pénalité fixe dès qu'une limite est franchie (viande, charcuterie, sodium, sucres, AGS)
  var MAX_POISSON = 3;       // au-delà, le générateur préfère varier (le repère PNNS est « 2 fois par semaine »)
  var POIDS_COUT = 0.02;     // à valeur nutritionnelle égale, la semaine la moins chère l'emporte
  // budget par jour (07/11/2026) : un jour au-dessus du maximum coûte un palier plus 2 points par euro de trop
  // (bien plus que ce qu'une recette chère peut apporter en nutriments) ; au-dessus de la cible, 0,15 point par euro
  var PALIER_BUDGET = 1, POIDS_BUDGET = 2, POIDS_CIBLE = 0.15;
  var PENALITE_PREP = 3;     // recette au-delà du temps de préparation choisi (hors créneaux verrouillés)

  function scorePersonne(p, pr) {
    var s = 0, R = pr.refs, m = pr.moy;
    Object.keys(POIDS).forEach(function (k) {
      var ref = R[k]; if (!ref || !(ref.t === 'RNP' || ref.t === 'AS')) return;
      var c = m[KI[k]] / ref.v;
      s += POIDS[k] * (Math.min(1, c) - 0.5 * Math.max(0, 0.7 - c));
    });
    K.forEach(function (k) { var ref = R[k]; if (ref && ref.lss != null && m[KI[k]] > ref.lss) s -= 4 * (m[KI[k]] / ref.lss - 1); });
    ['sucresHL', 'ags', 'na'].forEach(function (k) { var ref = R[k]; if (ref && m[KI[k]] > ref.v) s -= PALIER_LIMITE + 3 * (m[KI[k]] / ref.v - 1); });
    var enfant = p.type === 'enfant', F = pr.F;
    var fl = m[FI.fl] / (80 * Math.min(1, F)); if (fl < 5) s -= 1.0 * (1 - fl / 5);
    var cl = enfant ? 3 : 2; if (m[FI.pl] < cl) s -= 0.8 * (1 - m[FI.pl] / cl);
    if (pr.leg < 2) s -= 0.4 * (2 - pr.leg);
    if (pr.poi < 2) s -= 0.4 * (2 - pr.poi);
    if (pr.poi > MAX_POISSON) s -= 0.3 * (pr.poi - MAX_POISSON);  // varier les sources de protéines
    if (pr.pg < 1) s -= 0.4;
    var lv = enfant ? 500 * Math.min(1, F) : 500, lc = enfant ? 150 * Math.min(1, F) : 150;
    if (pr.sem[FI.vi] > lv) s -= PALIER_LIMITE + (pr.sem[FI.vi] / lv - 1);  // palier : le repère est franchi, même de peu
    if (pr.sem[FI.ch] > lc) s -= PALIER_LIMITE + (pr.sem[FI.ch] / lc - 1);
    if (pr.joursFc < 7) s -= POIDS_FC_JOUR * (7 - pr.joursFc);  // repère PNNS : un féculent complet chaque jour
    return s;
  }

  function penaliteVariete(plan) {
    var n = {}, pen = 0;
    for (var d = 0; d < 7; d++) for (var s = 0; s < 4; s++) { var id = plan[d][s]; if (id) n[id] = (n[id] || 0) + 1; }
    Object.keys(n).forEach(function (id) {
      var r = RECETTE[id], lim = 99;
      r.moments.forEach(function (m) { lim = Math.min(lim, LIMITES_REP[m]); });
      if (n[id] > lim) pen += 3 * (n[id] - lim);
    });
    return pen;
  }

  function penaliteBudget(st, ev) {
    var b = st.budgetJour, pen = 0;
    if (!b) return 0;
    for (var d = 0; d < 7; d++) {
      var c = ev.coutJours[d];
      if (b.max > 0 && c > b.max + 1e-9) pen += PALIER_BUDGET + POIDS_BUDGET * (c - b.max);
      if (b.cible > 0 && c > b.cible + 1e-9) pen += POIDS_CIBLE * (c - b.cible);
    }
    return pen;
  }
  // créneaux dont la recette dépasse le temps de préparation choisi (les créneaux verrouillés sont un choix assumé)
  function creneauxTropLongs(st, avecVerrous) {
    var L = [];
    if (!st.prepMax) return L;
    for (var d = 0; d < 7; d++) for (var s = 0; s < 4; s++) {
      var id = st.plan[d][s];
      if (id && RECETTE[id] && !prepOk(st, RECETTE[id]) && (avecVerrous || !st.verrous[d][s])) L.push([d, s]);
    }
    return L;
  }
  function score(st, ctx, ev) {
    ev = ev || evaluer(st, ctx, true);
    var s = 0;
    st.personnes.forEach(function (p, i) { s += scorePersonne(p, ev.personnes[i]); });
    s -= penaliteVariete(st.plan);
    s -= POIDS_COUT * ev.cout;
    s -= penaliteBudget(st, ev);
    s -= PENALITE_PREP * creneauxTropLongs(st, false).length;
    var vides = 0; for (var d = 0; d < 7; d++) for (var k = 0; k < 4; k++) if (!st.plan[d][k]) vides++;
    s -= 2 * vides;
    return s;
  }

  // ------------------------------------------------------------------ générateur (recuit simulé)
  function planAleatoire(st, ctx, rng, base) {
    var plan = [];
    for (var d = 0; d < 7; d++) {
      plan.push([0, 1, 2, 3].map(function (s) {
        if (st.verrous[d][s] && base && base[d][s]) return base[d][s];
        var c = ctx.cand[d][s]; return c[Math.floor(rng() * c.length)];
      }));
    }
    return plan;
  }

  function optimiser(st, opts) {
    opts = opts || {};
    var rng = mulberry32((opts.graine != null ? opts.graine : st.graine) >>> 0);
    var N = opts.iterations || st.iterations || 8000;
    var relances = opts.relances != null ? opts.relances : 2;
    var ctx = preparer(st);
    var travail = clone(st);
    var libres = [];
    for (var d = 0; d < 7; d++) for (var s = 0; s < 4; s++) if (!(st.verrous[d][s] && st.plan[d][s])) libres.push([d, s]);
    var departs = [];
    if (opts.depart !== 'aleatoire') {
      var p0 = clone(st.plan);
      for (var d2 = 0; d2 < 7; d2++) for (var s2 = 0; s2 < 4; s2++) {
        // créneau vide, ou recette non verrouillée trop longue à préparer : remplacée par une proposition
        var trop = p0[d2][s2] && !st.verrous[d2][s2] && ctx.cand[d2][s2].indexOf(p0[d2][s2]) < 0;
        if (!p0[d2][s2] || trop) { var c = ctx.cand[d2][s2]; p0[d2][s2] = c[Math.floor(rng() * c.length)]; }
      }
      departs.push(p0);
    }
    for (var r = 0; r < relances; r++) departs.push(planAleatoire(st, ctx, rng, st.plan));
    if (!departs.length) departs.push(planAleatoire(st, ctx, rng, st.plan));   // départ au hasard sans relance : un tirage
    travail.plan = departs[0];
    var scoreDepart = score(travail, ctx);
    var meilleur = null, meilleurScore = -Infinity, essais = 0;
    if (!libres.length) return { plan: clone(st.plan), score: scoreDepart, scoreDepart: scoreDepart, iterations: 0, acceptes: 0 };
    var acceptes = 0;
    departs.forEach(function (dep) {
      travail.plan = clone(dep);
      var cur = score(travail, ctx), locBest = cur, locPlan = clone(travail.plan);
      var T0 = 1.0, T1 = 0.005;
      for (var it = 0; it < N; it++) {
        var T = T0 * Math.pow(T1 / T0, it / N);
        var sl = libres[Math.floor(rng() * libres.length)], dd = sl[0], ss = sl[1];
        var cands = ctx.cand[dd][ss]; if (cands.length < 2) continue;
        var ancien = travail.plan[dd][ss], nouveau = cands[Math.floor(rng() * cands.length)];
        if (nouveau === ancien) continue;
        travail.plan[dd][ss] = nouveau; essais++;
        var sc = score(travail, ctx);
        if (sc >= cur || rng() < Math.exp((sc - cur) / T)) {
          cur = sc; acceptes++;
          if (sc > locBest) { locBest = sc; locPlan = clone(travail.plan); }
        } else travail.plan[dd][ss] = ancien;
      }
      if (locBest > meilleurScore) { meilleurScore = locBest; meilleur = locPlan; }
    });
    return { plan: meilleur, score: meilleurScore, scoreDepart: scoreDepart, iterations: essais, acceptes: acceptes };
  }

  // ------------------------------------------------------------------ coûts et courses
  function coutCreneau(st, ctx, ev, d, s) {
    var id = st.plan[d][s]; if (!id) return 0;
    var R = ctx.rec[id], c = 0;
    st.personnes.forEach(function (p, i) { if (p.presence[d][s]) c += R.Cu + ev.personnes[i].F * R.Cs; });
    return c;
  }

  function listeCourses(st, ctx, ev) {
    var q = {}, placard = {};
    st.personnes.forEach(function (p, i) {
      var F = ev.personnes[i].F;
      for (var d = 0; d < 7; d++) for (var s = 0; s < 4; s++) {
        var id = st.plan[d][s]; if (!id || !p.presence[d][s]) continue;
        var R = ctx.rec[id];
        Object.keys(R.Au).forEach(function (a) { q[a] = (q[a] || 0) + R.Au[a]; });
        Object.keys(R.As).forEach(function (a) { q[a] = (q[a] || 0) + F * R.As[a]; });
      }
      var e = ctx.eau[i];
      if (e.achat !== 'eauRobinet') q[e.achat] = (q[e.achat] || 0) + 7 * e.qte;
    });
    for (var d = 0; d < 7; d++) for (var s = 0; s < 4; s++) {
      var id = st.plan[d][s]; if (!id) continue;
      var pres = st.personnes.some(function (p) { return p.presence[d][s]; });
      if (pres) (RECETTE[id].placard || []).forEach(function (x) { placard[x] = (placard[x] || 0) + 1; });
    }
    var lignes = Object.keys(q).filter(function (a) { return q[a] > 1e-9; }).map(function (a) {
      var p = prixEffectif(st, a);
      var paquets = Math.max(1, Math.ceil(q[a] / p.qte - 1e-6));
      return { achat: a, nom: p.nom, marque: p.marque, rayon: p.rayon, unite: p.unite, besoin: q[a], paquets: paquets, qtePaquet: p.qte, prixPaquet: p.prix,
        ticket: paquets * p.prix, consomme: q[a] * p.prix / p.qte };
    });
    var ordre = ['Fruits & légumes', 'Boulangerie', 'Boucherie', 'Charcuterie', 'Poissonnerie', 'Crèmerie', 'Épicerie', 'Conserves', 'Surgelés', 'Boissons'];
    lignes.sort(function (x, y) { return (ordre.indexOf(x.rayon) - ordre.indexOf(y.rayon)) || x.nom.localeCompare(y.nom, 'fr'); });
    var total = lignes.reduce(function (t, l) { return t + l.ticket; }, 0);
    var consomme = lignes.reduce(function (t, l) { return t + l.consomme; }, 0);
    return { lignes: lignes, total: total, consomme: consomme, placard: Object.keys(placard).sort(function (a, b) { return a.localeCompare(b, 'fr'); }) };
  }

  // ------------------------------------------------------------------ prochain repas à préparer (07/11/2026)
  function minutesHeure(h) { var m = /^(\d{1,2}):(\d{2})$/.exec(h || ''); return m ? Number(m[1]) * 60 + Number(m[2]) : 0; }
  function deuxChiffres(n) { return (n < 10 ? '0' : '') + n; }
  function cleJour(t) { return t.getFullYear() + '-' + deuxChiffres(t.getMonth() + 1) + '-' + deuxChiffres(t.getDate()); }
  function indexJour(t) { return (t.getDay() + 6) % 7; }   // lundi = 0, comme le planning
  var GRACE_REPAS = 45;    // minutes : un repas reste « à préparer » jusqu'à 45 min après son heure, s'il n'est pas marqué prêt
  // Créneaux à venir, dans l'ordre, à partir de « maintenant » : repas prévu, au moins une personne à la maison,
  // pas encore marqué préparé. Le planning est une semaine type : le jour de la semaine donne la colonne.
  function repasAVenir(st, maintenant, n) {
    var L = [], t0 = maintenant.getTime();
    var base = new Date(maintenant.getFullYear(), maintenant.getMonth(), maintenant.getDate());
    for (var k = 0; k < 8 && L.length < n; k++) {
      var jour = new Date(base.getFullYear(), base.getMonth(), base.getDate() + k);
      var d = indexJour(jour), cle = cleJour(jour);
      for (var s = 0; s < 4 && L.length < n; s++) {
        var hm = minutesHeure(st.horaires[s]);
        var quand = new Date(jour.getFullYear(), jour.getMonth(), jour.getDate(), Math.floor(hm / 60), hm % 60);
        if (quand.getTime() + GRACE_REPAS * 60000 < t0) continue;
        if (st.faits[cle + ':' + s]) continue;
        var id = st.plan[d][s];
        var presents = []; st.personnes.forEach(function (p, i) { if (p.presence[d][s]) presents.push(i); });
        if (!id || !presents.length) continue;
        var r = RECETTE[id];
        var debut = new Date(quand.getTime() - (r.prep + r.cuisson) * 60000);
        L.push({ d: d, s: s, cle: cle + ':' + s, jourCle: cle, quand: quand, debut: debut, id: id, presents: presents, decalage: k,
          enCours: t0 >= debut.getTime(), minutesAvantDebut: Math.round((debut.getTime() - t0) / 60000) });
      }
    }
    return L;
  }
  function prochainRepas(st, maintenant) { return repasAVenir(st, maintenant, 1)[0] || null; }
  // quantités à préparer pour les personnes présentes (unités de cuisine), et la part de chacune
  function quantitesRepas(st, ev, id, presents) {
    var r = RECETTE[id];
    return r.lignes.map(function (l) {
      var fid = aliment(l.f, st), parts = presents.map(function (i) { return { i: i, q: l.u ? l.q : l.q * ev.personnes[i].F }; });
      return { f: fid, nom: AL[fid].nom, u: l.u, total: parts.reduce(function (t, x) { return t + x.q; }, 0), parts: parts };
    });
  }
  function coutRepas(st, ctx, ev, id, presents) {
    var R = ctx.rec[id]; return presents.reduce(function (t, i) { return t + R.Cu + ev.personnes[i].F * R.Cs; }, 0);
  }
  // oublie les repas « préparés » de plus de trois semaines (et leurs dates de synchronisation)
  function nettoyerFaits(st, maintenant) {
    var lim = cleJour(new Date(maintenant.getFullYear(), maintenant.getMonth(), maintenant.getDate() - FAITS_JOURS));
    Object.keys(st.faits).forEach(function (k) { if (k.slice(0, 10) < lim) delete st.faits[k]; });
    Object.keys(st.maj.faits).forEach(function (k) { if (k.slice(0, 10) < lim) delete st.maj.faits[k]; });
  }

  // ------------------------------------------------------------------ synchronisation entre appareils (07/11/2026)
  // Comme l'outil NHL : un dépôt GitHub privé garde un fichier equilibre/etat.json. Chaque partie de l'état porte la
  // date de sa dernière modification ; à la fusion, la plus récente l'emporte (à égalité, celle du dépôt, pour que deux
  // appareils convergent). Coches de courses et repas préparés : clé par clé, suppressions comprises.
  // Le jeton GitHub n'est jamais dans l'état : il ne part ni dans l'export, ni dans le dépôt.
  var SYNC_FORMAT = 1, SYNC_CHEMIN = 'equilibre/etat.json';
  var SECTIONS = {
    foyer: function (st) { return st.personnes; },
    semaine: function (st) { return { plan: st.plan, verrous: st.verrous, graine: st.graine }; },
    prix: function (st) { return st.prix; },
    reglages: function (st) { return { substitutions: st.substitutions, budgetJour: st.budgetJour, prepMax: st.prepMax, horaires: st.horaires, iterations: st.iterations }; }
  };
  var NOMS_SECTIONS = Object.keys(SECTIONS), CARTES = ['coches', 'faits'];
  function hStr(s) {   // empreinte cyrb53 (même fonction que l'outil NHL)
    var h1 = 0xdeadbeef ^ 0, h2 = 0x41c6ce57 ^ 0;
    for (var i = 0; i < s.length; i++) { var c = s.charCodeAt(i); h1 = Math.imul(h1 ^ c, 2654435761); h2 = Math.imul(h2 ^ c, 1597334677); }
    h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
    h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
    return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(36);
  }
  function canon(x) {  // JSON aux clés triées : même contenu, même texte sur tous les appareils
    if (x === null || typeof x !== 'object') { var s = JSON.stringify(x); return s === undefined ? 'null' : s; }
    if (Array.isArray(x)) return '[' + x.map(function (v) { return v === undefined || typeof v === 'function' ? 'null' : canon(v); }).join(',') + ']';
    return '{' + Object.keys(x).filter(function (k) { return x[k] !== undefined && typeof x[k] !== 'function'; }).sort().map(function (k) { return JSON.stringify(k) + ':' + canon(x[k]); }).join(',') + '}';
  }
  function empreintes(st) {
    var E = {};
    NOMS_SECTIONS.forEach(function (k) { E[k] = hStr(canon(SECTIONS[k](st))); });
    CARTES.forEach(function (c) { E[c] = {}; Object.keys(st[c]).forEach(function (k) { if (st[c][k]) E[c][k] = 1; }); });
    return E;
  }
  // date les parties modifiées depuis la dernière empreinte ; renvoie la nouvelle empreinte et la liste des changements
  function horodater(st, avant, t) {
    var E = empreintes(st), ch = [];
    if (avant) {
      NOMS_SECTIONS.forEach(function (k) { if (E[k] !== avant[k]) { st.maj[k] = t; ch.push(k); } });
      CARTES.forEach(function (c) {
        var A = avant[c] || {}, B = E[c];
        Object.keys(B).forEach(function (k) { if (!A[k]) { st.maj[c][k] = t; ch.push(c + ':' + k); } });
        Object.keys(A).forEach(function (k) { if (!B[k]) { st.maj[c][k] = t; ch.push(c + ':' + k); } });
      });
    }
    return { empreinte: E, changements: ch };
  }
  function fichierSync(st) {
    var o = { v: SYNC_FORMAT, app: 'equilibre-alimentaire', sections: {} };
    NOMS_SECTIONS.forEach(function (k) { o.sections[k] = { mt: st.maj[k] || 0, v: SECTIONS[k](st) }; });
    CARTES.forEach(function (c) {
      o[c] = {};
      var cles = {}; Object.keys(st[c]).forEach(function (k) { cles[k] = 1; }); Object.keys(st.maj[c]).forEach(function (k) { cles[k] = 1; });
      Object.keys(cles).forEach(function (k) { o[c][k] = st[c][k] ? { mt: st.maj[c][k] || 0, v: 1 } : { mt: st.maj[c][k] || 0, del: 1 }; });
    });
    return o;
  }
  // fusion du fichier du dépôt dans l'état local ; renvoie l'état fusionné et ce qui a changé ici
  function fusionnerSync(st, distant) {
    var res = clone(st), ch = [];
    if (!distant || typeof distant !== 'object' || distant.app !== 'equilibre-alimentaire') return { etat: res, changements: ch };
    var S = distant.sections || {};
    NOMS_SECTIONS.forEach(function (k) {
      var r = S[k]; if (!r || typeof r !== 'object' || !('v' in r)) return;
      var rm = Number(r.mt) || 0, lm = res.maj[k] || 0;
      if (rm < lm) return;                                                    // la nôtre est plus récente
      if (canon(r.v) === canon(SECTIONS[k](res))) { res.maj[k] = rm; return; }  // même contenu
      var brut = clone(res);                                                  // on applique la partie venue du dépôt
      if (k === 'foyer') brut.personnes = r.v;
      else if (k === 'semaine') { brut.plan = r.v && r.v.plan; brut.verrous = r.v && r.v.verrous; brut.graine = r.v && r.v.graine; }
      else if (k === 'prix') brut.prix = r.v;
      else { var g = r.v || {}; brut.substitutions = g.substitutions; brut.budgetJour = g.budgetJour; brut.prepMax = g.prepMax; brut.horaires = g.horaires; brut.iterations = g.iterations; }
      var norm = normaliserEtat(brut);
      if (k === 'foyer') res.personnes = norm.personnes;
      else if (k === 'semaine') { res.plan = norm.plan; res.verrous = norm.verrous; res.graine = norm.graine; }
      else if (k === 'prix') res.prix = norm.prix;
      else { res.substitutions = norm.substitutions; res.budgetJour = norm.budgetJour; res.prepMax = norm.prepMax; res.horaires = norm.horaires; res.iterations = norm.iterations; }
      res.maj[k] = rm; ch.push(k);
    });
    CARTES.forEach(function (c) {
      var R = distant[c]; if (!R || typeof R !== 'object') return;
      Object.keys(R).forEach(function (k) {
        var r = R[k]; if (!r || typeof r !== 'object') return;
        if (c === 'coches' && !(ACH[k] || k.indexOf('placard:') === 0)) return;
        if (c === 'faits' && !/^\d{4}-\d{2}-\d{2}:[0-3]$/.test(k)) return;
        var rm = Number(r.mt) || 0, lm = res.maj[c][k] || 0;
        if (rm < lm) return;
        var veut = !r.del, a = !!res[c][k];
        if (rm > lm || veut !== a) {
          if (veut !== a) { if (veut) res[c][k] = true; else delete res[c][k]; ch.push(c + ':' + k); }
          res.maj[c][k] = rm;
        }
      });
    });
    return { etat: res, changements: ch };
  }

  // ------------------------------------------------------------------ analyse : contributeurs et suggestions
  function contributeurs(st, ctx, ev, pi, k) {
    var p = st.personnes[pi], F = ev.personnes[pi].F, parts = {};
    function ajouterRecette(r, fact) {
      r.lignes.forEach(function (l) {
        var fid = aliment(l.f, st), a = AL[fid], v = valeur(a, k); if (v == null) return;
        var x = v * grammesCiqual(a, l.q) / 100 * (l.u ? 1 : fact);
        parts[fid] = (parts[fid] || 0) + x;
      });
    }
    for (var d = 0; d < 7; d++) for (var s = 0; s < 4; s++) {
      if (p.presence[d][s]) { var id = st.plan[d][s]; if (id) ajouterRecette(RECETTE[id], F); }
      else if (MOMENTS[s].repas) ajouterRecette(EXTERIEUR, F);
    }
    var va = valeur(AL[p.eau], k);
    if (va) parts[p.eau] = (parts[p.eau] || 0) + va * p.eauMl * (AL[p.eau].dens || 1) / 100 * 7;
    var tot = Object.keys(parts).reduce(function (t, f) { return t + parts[f]; }, 0);
    return Object.keys(parts).map(function (f) { return { aliment: f, nom: AL[f].nom, total: parts[f], parJour: parts[f] / 7, part: tot > 0 ? parts[f] / tot : 0 }; })
      .sort(function (a, b) { return b.total - a.total; });
  }

  var PORTIONS = { amandes: 20, noix: 20, noisettes: 20, grainesCourge: 15, cacao: 6, chocolat: 15, lentVertes: 60, lentCorail: 60, poisChiches: 120, harRouges: 120, poisCasses: 60,
    epinards: 120, brocoli: 150, haricotsVerts: 150, petitsPois: 120, sardines: 70, maquereau: 85, saumon: 120, colin: 130, moules: 100, thon: 60, comte: 30, emmental: 30, mozza: 50,
    yaourt: 125, fblanc: 100, lait: 200, laitD: 200, avoine: 40, muesli: 40, painComplet: 60, sarrasin: 50, boudin: 100, boeufHache: 100, pouletFilet: 120, dinde: 110, oeuf: 1,
    abricotsSecs: 30, banane: 100, kiwi: 75, orange: 130, clementine: 100, fruitsRouges: 100, poivron: 80, butternut: 200, pdt: 200, rizComplet: 70, patesCompl: 80, tomate: 120, carotteCrue: 100 };

  function suggestions(st, ctx, ev, pi, k) {
    var pr = ev.personnes[pi], ref = pr.refs[k], cible = ref ? (ref.v || ref.min || 0) : 0;
    var alim = Object.keys(PORTIONS).filter(function (f) { return AL[f] && valeur(AL[f], k) != null; }).map(function (f) {
      var a = AL[f], q = PORTIONS[f], n = nutrimentsAliment(f, q), x = n[k];
      return { aliment: f, nom: a.nom, q: q, unite: a.unite, apport: x, pct: cible ? x / cible : 0, cout: coutLigne(st, a, q), kcal: n.kcal || 0 };
    }).filter(function (o) { return o.apport > 0; }).sort(function (a, b) { return b.apport - a.apport; }).slice(0, 8);
    var recs = {};
    MOMENTS.forEach(function (m) {
      recs[m.k] = RECS.filter(function (r) { return !r.exterieur && r.moments.indexOf(m.k) >= 0; }).map(function (r) {
        var R = ctx.rec[r.id]; return { id: r.id, nom: r.nom, apport: R.Vu[KI[k]] + R.Vs[KI[k]] };
      }).sort(function (a, b) { return b.apport - a.apport; }).slice(0, 3);
    });
    var eaux = [];
    if (['ca', 'mg', 'na', 'k'].indexOf(k) >= 0) {
      var p = st.personnes[pi], actuel = (valeur(AL[p.eau], k) || 0) * p.eauMl / 100;
      eaux = Object.keys(AL).filter(function (f) { return AL[f].cats.indexOf('eau') >= 0; }).map(function (f) {
        var x = (valeur(AL[f], k) || 0) * p.eauMl / 100, pe = prixEffectif(st, AL[f].achat);
        return { aliment: f, nom: AL[f].nom, parLitre: (valeur(AL[f], k) || 0) * 10, apport: x, gain: x - actuel, coutJour: p.eauMl * pe.prix / pe.qte };
      }).sort(function (a, b) { return b.apport - a.apport; });
    }
    return { aliments: alim, recettes: recs, eaux: eaux };
  }

  // ------------------------------------------------------------------ stockage robuste et export
  function Stockage(backend, cle) {
    return {
      lire: function () { try { var s = backend && backend.getItem(cle); return s ? JSON.parse(s) : null; } catch (e) { return null; } },
      ecrire: function (obj) { try { if (!backend) return false; backend.setItem(cle, JSON.stringify(obj)); return true; } catch (e) { return false; } }
    };
  }
  function exporterEtat(st) { var o = clone(st); o.exporteLe = new Date().toISOString(); o.appVersion = VERSION; return JSON.stringify(o, null, 1); }
  function importerEtat(txt) { var o = JSON.parse(txt); if (!o || o.app !== 'equilibre-alimentaire') throw new Error('Ce fichier ne vient pas de cet outil.'); return normaliserEtat(o); }

  // ------------------------------------------------------------------ audit des mécanismes (point 7 du protocole)
  function proche(a, b, tol) { return Math.abs(a - b) <= tol; }
  var MECANISMES = [
    { id: 'energie', nom: 'Besoin énergétique (Black et al. pour les adultes, Schofield × activité pour l\'enfant, calé sur l\'ANSES)', fn: 'besoinEnergie', test: function () {
      var st = etatDefaut(), h = besoinEnergie(st.personnes[0]), e = besoinEnergie(st.personnes[2]);
      // au poids de référence des 7-10 ans, on doit retrouver les besoins ANSES 2019 (1 851 et 1 726 kcal)
      var g = besoinEnergie({ type: 'enfant', sexe: 'G', age: 8, poids: 28.2, activite: 'moyenne' });
      var f = besoinEnergie({ type: 'enfant', sexe: 'F', age: 8, poids: 28.7, activite: 'moyenne' });
      var lourd = besoinEnergie({ type: 'enfant', sexe: 'NP', age: 7, poids: 26, activite: 'moyenne' });
      var actif = besoinEnergie({ type: 'enfant', sexe: 'NP', age: 7, poids: 23, activite: 'elevee' });
      return h > 2400 && h < 2900 && proche(e, 1600, 2) && proche(g, 1851, 15) && proche(f, 1726, 15) && lourd > e && actif > e ? true : 'H=' + h + ' E=' + e + ' G28=' + g + ' F29=' + f; } },
    { id: 'references', nom: 'Références ANSES par profil (âge, sexe, fer, phytates)', fn: 'references', test: function () {
      var st = etatDefaut(), f = st.personnes[1]; f.fer = 'eleve';
      var rf = references(f, 2000), re = references(st.personnes[2], 1800), rh = references(st.personnes[0], 2600);
      return rf.fe.v === 16 && re.mg.v === 240 && re.fe.v === 6 && re.ca.v === 800 && rh.zn.v === 11.7 && rh.mg.v === 380 ? true : 'valeurs inattendues'; } },
    { id: 'ciqual', nom: 'Valeurs CIQUAL par aliment (traces et « < » à zéro, manquants signalés)', fn: 'valeur', test: function () {
      var o = nutrimentsAliment('avoine', 100), l = nutrimentsAliment('lait', 100);
      return proche(o.mg, 101, 0.01) && proche(l.ca, 121 * 1.03, 0.01) ? true : 'avoine Mg=' + o.mg + ' lait Ca=' + l.ca; } },
    { id: 'rendement', nom: 'Rendement cru → cuit (féculents pesés secs)', fn: 'grammesCiqual', test: function () {
      var o = nutrimentsAliment('spaghetti', 100); return proche(o.kcal, 167 * 2.18, 0.5) ? true : 'kcal=' + o.kcal; } },
    { id: 'comestible', nom: 'Partie comestible dans les quantités à acheter', fn: 'qteAchat', test: function () {
      var q = qteAchat(etatDefaut(), AL.banane, 100); return proche(q, 100 / 0.67, 0.01) ? true : 'q=' + q; } },
    { id: 'indivisible', nom: 'Portions indivisibles (yaourt, fruit, verre de lait)', fn: 'vecteurRecette', test: function () {
      var v = vecteurRecette(etatDefaut(), RECETTE.G2); return proche(v.Vu[KI.ca], 137 * 1.25 + 5.1, 0.01) ? true : 'Ca unitaire=' + v.Vu[KI.ca]; } },
    { id: 'facteur', nom: 'Facteur de portion calé sur le besoin énergétique', fn: 'facteurPortion', test: function () {
      var st = etatDefaut(), ctx = preparer(st); st.plan = planAleatoire(st, ctx, mulberry32(7));
      var ev = evaluer(st, ctx, true), ok = ev.personnes.every(function (pr) { return pr.F <= 0.5 || pr.F >= 1.8 || proche(pr.moy[KI.kcal], pr.E, pr.E * 0.01); });
      return ok ? true : ev.personnes.map(function (pr) { return Math.round(pr.moy[KI.kcal]) + '/' + pr.E; }).join(' '); } },
    { id: 'absences', nom: 'Absences : repas pris dehors estimé, exclu des courses', fn: 'evaluer', test: function () {
      var st = etatDefaut(), ctx = preparer(st); st.plan = planAleatoire(st, ctx, mulberry32(3));
      var avant = listeCourses(st, ctx, evaluer(st, ctx, true));
      st.personnes[2].presence[0][1] = false; var ev = evaluer(st, ctx, true), apres = listeCourses(st, ctx, ev);
      return ev.personnes[2].nRepasDehors === 1 && apres.consomme < avant.consomme ? true : 'dehors=' + ev.personnes[2].nRepasDehors; } },
    { id: 'substitution', nom: 'Remplacement du lait par un lait enrichi en vitamine D', fn: 'aliment', test: function () {
      var st = etatDefaut(), a = vecteurRecette(st, RECETTE.M1); st.substitutions.lait = 'laitD'; var b = vecteurRecette(st, RECETTE.M1);
      return b.Vs[KI.vitD] > a.Vs[KI.vitD] + 1 ? true : 'vitD ' + a.Vs[KI.vitD] + ' -> ' + b.Vs[KI.vitD]; } },
    { id: 'eau', nom: 'Minéraux de l\'eau de boisson', fn: 'vecteurEau', test: function () {
      var st = etatDefaut(), v = vecteurEau(st, 'hepar', 1000); return proche(v.V[KI.ca], 549, 0.5) && proche(v.V[KI.mg], 119, 0.5) ? true : 'Ca=' + v.V[KI.ca]; } },
    { id: 'eauEtiquette', nom: 'Mises en garde des eaux (fluor, sulfates, sodium, minéralisation)', fn: 'avertissementsEau', test: function () {
      var st = etatDefaut(), enf = st.personnes[2], ad = st.personnes[0];
      var ks = function (f, p) { return avertissementsEau(f, p).map(function (x) { return x.k; }).join(','); };
      var mag = avertissementsEau('eauMagCrf', enf), fl = mag.filter(function (x) { return x.k === 'fluor'; })[0];
      var ok = fl && fl.grave === true && ks('courmayeur', ad) === 'sulfates' && ks('rozana', ad) === 'sodium' && ks('evian', enf) === '' && ks('eauRobinet', enf) === '' &&
        ks('hepar', enf) === 'sulfates,mineralisation' && ks('badoit', enf) === '' && avertissementsEau('eauMagCrf', ad).filter(function (x) { return x.grave; }).length === 0;
      return ok ? true : 'Courmayeur=' + ks('courmayeur', ad) + ' Rozana=' + ks('rozana', ad) + ' magnésienne/enfant=' + ks('eauMagCrf', enf); } },
    { id: 'couverture', nom: 'Couverture et alertes (RNP, AS, limites, LSS)', fn: 'statut', test: function () {
      return statut({ t: 'RNP', v: 10 }, 10) === 'ok' && statut({ t: 'RNP', v: 10 }, 8) === 'proche' && statut({ t: 'AS', v: 10 }, 5) === 'bas' && statut({ t: 'max', v: 10 }, 11) === 'exces' && statut({ t: 'AS', v: 10, lss: 20 }, 25) === 'lss' && statut({ t: 'plage', min: 10, max: 20 }, 9) === 'proche' && statut({ t: 'plage', min: 10, max: 20 }, 8) === 'bas' ? true : 'classement inattendu'; } },
    { id: 'pnns', nom: 'Repères PNNS sur la semaine', fn: 'reperesPNNS', test: function () {
      var st = etatDefaut(), ctx = preparer(st); st.plan = grille(null);
      st.plan[0][1] = 'R03'; st.plan[1][1] = 'R07'; st.plan[2][3] = 'R02'; st.plan[3][1] = 'R12';
      var ev = evaluer(st, ctx, false), L = ev.personnes[0].pnns, g = {}; L.forEach(function (x) { g[x.k] = x; });
      // jours avec féculents complets : même compte en mode léger (générateur) et à partir des vecteurs journaliers
      var st2 = etatDefaut(), ctx2 = preparer(st2); st2.plan = planAleatoire(st2, ctx2, mulberry32(21));
      var evL = evaluer(st2, ctx2, true), evC = evaluer(st2, ctx2, false), coherent = evC.personnes.every(function (pr, i) {
        var n = pr.jours.filter(function (v) { return v[FI.fc] >= SEUIL_FC * Math.min(1, pr.F) - 1e-9; }).length;
        return n === pr.joursFc && n === evL.personnes[i].joursFc && pr.pnns[7].val === n;
      });
      return g.leg.val === 2 && g.poi.val === 2 && g.pg.val === 1 && g.fc.val === 1 && coherent ? true : 'leg=' + g.leg.val + ' poi=' + g.poi.val + ' fc=' + g.fc.val + ' cohérence=' + coherent; } },
    { id: 'cout', nom: 'Coût consommé (prorata des paquets)', fn: 'coutLigne', test: function () {
      var st = etatDefaut(), c = coutLigne(st, AL.lait, 250); return proche(c, 250 * 6.00 / 6000, 1e-9) ? true : 'c=' + c; } },
    { id: 'courses', nom: 'Liste de courses en paquets entiers', fn: 'listeCourses', test: function () {
      var st = etatDefaut(), ctx = preparer(st); st.plan = planAleatoire(st, ctx, mulberry32(11));
      var L = listeCourses(st, ctx, evaluer(st, ctx, true));
      var ok = L.lignes.length > 10 && L.lignes.every(function (l) { return l.paquets * l.qtePaquet >= l.besoin - 1e-6 && (l.paquets - 1) * l.qtePaquet < l.besoin + 1e-6; });
      return ok && L.total >= L.consomme ? true : 'arrondi incorrect'; } },
    { id: 'optimiseur', nom: 'Générateur de semaine (recuit simulé, verrous respectés)', fn: 'optimiser', test: function () {
      var st = etatDefaut(), ctx = preparer(st); st.plan = planAleatoire(st, ctx, mulberry32(5)); st.verrous[2][1] = true; var garde = st.plan[2][1];
      var r = optimiser(st, { iterations: 1500, relances: 0, graine: 9 });
      return r.score > r.scoreDepart && r.plan[2][1] === garde ? true : 'score ' + r.scoreDepart.toFixed(2) + ' -> ' + r.score.toFixed(2); } },
    { id: 'suggestions', nom: 'Suggestions pour combler un manque', fn: 'suggestions', test: function () {
      var st = etatDefaut(), ctx = preparer(st); st.plan = planAleatoire(st, ctx, mulberry32(2));
      var s = suggestions(st, ctx, evaluer(st, ctx, true), 2, 'mg');
      return s.aliments.length >= 5 && s.eaux.length >= 5 && s.recettes.matin.length === 3 ? true : 'listes incomplètes'; } },
    { id: 'completude', nom: 'Complétude des données CIQUAL par nutriment', fn: 'evaluer', test: function () {
      var st = etatDefaut(), ctx = preparer(st); st.plan = grille(null); st.plan[0][1] = 'R06';
      var ev = evaluer(st, ctx, false), c = ev.personnes[0].completude;
      return c.i < 1 && c.ca === 1 ? true : 'iode=' + c.i + ' Ca=' + c.ca; } },
    { id: 'contributeurs', nom: 'Contribution de chaque aliment à un nutriment', fn: 'contributeurs', test: function () {
      var st = etatDefaut(), ctx = preparer(st); st.plan = planAleatoire(st, ctx, mulberry32(4));
      var ev = evaluer(st, ctx, true), L = contributeurs(st, ctx, ev, 0, 'mg');
      var t = L.reduce(function (s, x) { return s + x.total; }, 0);
      return proche(t, ev.personnes[0].sem[KI.mg], 0.5) ? true : 'somme ' + t + ' vs ' + ev.personnes[0].sem[KI.mg]; } },
    { id: 'stockage', nom: 'Sauvegarde locale qui ne bloque jamais l\'outil', fn: 'Stockage', test: function () {
      var mauvais = { getItem: function () { throw new Error('refus'); }, setItem: function () { throw new Error('refus'); } };
      var s = Stockage(mauvais, 'x'), m = {}, bon = Stockage({ getItem: function (k) { return m[k] || null; }, setItem: function (k, v) { m[k] = v; } }, 'x');
      return s.lire() === null && s.ecrire({ a: 1 }) === false && bon.ecrire({ a: 1 }) && bon.lire().a === 1 ? true : 'stockage fragile'; } },
    { id: 'export', nom: 'Export et import de l\'état (JSON)', fn: 'importerEtat', test: function () {
      var st = etatDefaut(); st.budgetJour = { max: 11.5, cible: 9 }; st.prepMax = 15; st.horaires[3] = '20:00'; st.prix.lait = { prix: 1.5 }; st.faits['2026-11-07:3'] = true;
      var r = importerEtat(exporterEtat(st));
      var ancien = normaliserEtat({ app: 'equilibre-alimentaire', budget: 70 });   // budget par semaine de la v1.1.0
      return r.budgetJour.max === 11.5 && r.budgetJour.cible === 9 && r.prepMax === 15 && r.horaires[3] === '20:00' && r.prix.lait.prix === 1.5 && r.faits['2026-11-07:3'] === true &&
        ancien.budgetJour.max === 10 && ancien.budgetJour.cible === 10 ? true : 'aller-retour incomplet'; } },
    { id: 'budgetJour', nom: 'Coût de chaque jour (repas pris à la maison + eau) et budget par jour du générateur', fn: 'penaliteBudget', test: function () {
      var st = etatDefaut(), ctx = preparer(st); st.plan = planAleatoire(st, ctx, mulberry32(8));
      var ev = evaluer(st, ctx, true), somme = ev.coutJours.reduce(function (t, x) { return t + x; }, 0);
      var parCreneaux = true;
      for (var d = 0; d < 7; d++) { var c = ev.coutEauJour; for (var s = 0; s < 4; s++) c += coutCreneau(st, ctx, ev, d, s); if (!proche(c, ev.coutJours[d], 1e-9)) parCreneaux = false; }
      var mini = Math.min.apply(null, ev.coutJours);
      st.budgetJour = { max: mini - 1, cible: 0 }; var p1 = penaliteBudget(st, ev);
      st.budgetJour = { max: 1000, cible: 1000 }; var p0 = penaliteBudget(st, ev);
      st.budgetJour = { max: 0, cible: 0 }; var pSans = penaliteBudget(st, ev);
      return proche(somme, ev.cout, 1e-9) && parCreneaux && p1 >= 7 * (PALIER_BUDGET + POIDS_BUDGET) && p0 === 0 && pSans === 0 ? true : 'somme=' + somme.toFixed(2) + ' coût=' + ev.cout.toFixed(2) + ' p1=' + p1; } },
    { id: 'prepMax', nom: 'Temps de préparation maximal hors cuisson : rien au-delà n\'est proposé', fn: 'preparer', test: function () {
      var st = etatDefaut(); st.prepMax = 15; var ctx = preparer(st), ok15 = true, tous = 0;
      for (var d = 0; d < 7; d++) for (var s = 0; s < 4; s++) { ctx.cand[d][s].forEach(function (id) { if (RECETTE[id].prep > 15) ok15 = false; }); tous += ctx.candTous[d][s].length; }
      st.prepMax = 20; var c20 = preparer(st), sans22 = c20.cand[0][1].indexOf('R22') < 0 && c20.candTous[0][1].indexOf('R22') >= 0;
      st.plan = planAleatoire(st, c20, mulberry32(4)); st.plan[0][1] = 'R22';
      var n1 = creneauxTropLongs(st, false).length; st.verrous[0][1] = true; var n2 = creneauxTropLongs(st, false).length, n3 = creneauxTropLongs(st, true).length;
      st.prepMax = 0; var c0 = preparer(st), avec22 = c0.cand[0][1].indexOf('R22') >= 0;
      return ok15 && tous > 0 && sans22 && n1 === 1 && n2 === 0 && n3 === 1 && avec22 ? true : 'ok15=' + ok15 + ' R22 exclu=' + sans22 + ' signalés=' + n1 + '/' + n2 + '/' + n3; } },
    { id: 'prochainRepas', nom: 'Prochain repas à préparer (heure du repas, personnes présentes, repas déjà préparés)', fn: 'prochainRepas', test: function () {
      var st = etatDefaut(), ctx = preparer(st); st.plan = planAleatoire(st, ctx, mulberry32(12));
      var a = prochainRepas(st, new Date(2026, 10, 7, 10, 0));       // samedi 10 h → déjeuner du samedi
      var b = prochainRepas(st, new Date(2026, 10, 7, 12, 50));      // 35 min après l'heure : encore celui-là
      var c = prochainRepas(st, new Date(2026, 10, 7, 13, 5));       // trop tard → goûter
      st.faits['2026-11-07:1'] = true; var e = prochainRepas(st, new Date(2026, 10, 7, 10, 0));   // déjeuner marqué prêt → goûter
      st.personnes.forEach(function (p) { p.presence[5][2] = false; }); var f = prochainRepas(st, new Date(2026, 10, 7, 10, 0));  // personne au goûter → dîner
      var g = prochainRepas(st, new Date(2026, 10, 8, 22, 0));       // dimanche soir → lundi matin
      var r = RECETTE[a.id], debutOk = a.debut.getTime() === new Date(2026, 10, 7, 12, 15).getTime() - (r.prep + r.cuisson) * 60000;
      return a.d === 5 && a.s === 1 && b.s === 1 && c.s === 2 && e.s === 2 && f.s === 3 && g.d === 0 && g.s === 0 && g.cle === '2026-11-09:0' && debutOk && a.presents.length === 3 ? true
        : [a, b, c, e, f, g].map(function (x) { return x ? x.d + '/' + x.s : '-'; }).join(' '); } },
    { id: 'synchro', nom: 'Synchronisation entre appareils : fusion des modifications (la plus récente l\'emporte)', fn: 'fusionnerSync', test: function () {
      var A = etatDefaut(), ctx = preparer(A); A.plan = planAleatoire(A, ctx, mulberry32(6));
      var B = clone(A), eA = empreintes(A), eB = empreintes(B);
      A.prix.lait = { prix: 1.1 }; horodater(A, eA, 1000);                       // PC : un prix
      B.personnes[2].poids = 25; B.coches.lait = true; horodater(B, eB, 2000);    // téléphone : le poids de l'enfant, une coche
      var fA = fusionnerSync(A, JSON.parse(canon(fichierSync(B)))).etat;           // le PC reçoit le fichier du téléphone
      var fB = fusionnerSync(B, JSON.parse(canon(fichierSync(fA)))).etat;          // puis le téléphone celui du PC
      var converge = canon(fichierSync(fA)) === canon(fichierSync(fB));
      var ok1 = fA.prix.lait.prix === 1.1 && fA.personnes[2].poids === 25 && fA.coches.lait === true && fB.prix.lait && fB.prix.lait.prix === 1.1;
      var eC = empreintes(fB); delete fB.coches.lait; horodater(fB, eC, 3000);    // décoché sur le téléphone : la suppression suit
      var fA2 = fusionnerSync(fA, fichierSync(fB)).etat;
      var C = clone(A); C.prix.lait = { prix: 2 };                                 // même date, contenu différent : le dépôt l'emporte
      var tie = fusionnerSync(A, fichierSync(C)).etat.prix.lait.prix === 2;
      var vieux = clone(fA2); vieux.maj.foyer = 1; vieux.personnes[2].poids = 30;  // modification plus ancienne : ignorée
      var garde = fusionnerSync(fA2, fichierSync(vieux)).etat.personnes[2].poids === 25;
      return ok1 && converge && !fA2.coches.lait && tie && garde ? true : 'ok1=' + ok1 + ' converge=' + converge + ' suppr=' + !fA2.coches.lait + ' égalité=' + tie + ' ancien ignoré=' + garde; } }
  ];

  function auditMecanismes() {
    return MECANISMES.map(function (m) {
      var r; try { r = m.test(); } catch (e) { r = 'exception : ' + e.message; }
      return { id: m.id, nom: m.nom, fn: m.fn, ok: r === true, detail: r === true ? '' : String(r) };
    });
  }

  return {
    VERSION: VERSION, D: D, AL: AL, ACH: ACH, RECS: RECS, RECETTE: RECETTE, EXTERIEUR: EXTERIEUR,
    NUTS: NUTS, K: K, KI: KI, FI: FI, INFO: INFO, JOURS: JOURS, MOMENTS: MOMENTS, PORTIONS: PORTIONS, POIDS: POIDS,
    etatDefaut: etatDefaut, normaliserEtat: normaliserEtat, besoinEnergie: besoinEnergie, metabolismeEnfant: metabolismeEnfant, NAP_ENFANT: NAP_ENFANT,
    references: references, horsTranche: horsTranche, statut: statut, avertissementsEau: avertissementsEau,
    prixEffectif: prixEffectif, grammes: grammes, grammesCiqual: grammesCiqual, qteAchat: qteAchat, coutLigne: coutLigne, valeur: valeur,
    nutrimentsAliment: nutrimentsAliment, aliment: aliment, vecteurRecette: vecteurRecette, vecteurEau: vecteurEau, preparer: preparer,
    facteurPortion: facteurPortion, evaluer: evaluer, reperesPNNS: reperesPNNS, score: score, scorePersonne: scorePersonne, penaliteVariete: penaliteVariete,
    planAleatoire: planAleatoire, optimiser: optimiser, coutCreneau: coutCreneau, listeCourses: listeCourses, contributeurs: contributeurs, suggestions: suggestions,
    Stockage: Stockage, exporterEtat: exporterEtat, importerEtat: importerEtat, mulberry32: mulberry32, clone: clone, grille: grille,
    BUDGET_DEFAUT: BUDGET_DEFAUT, PREP_DEFAUT: PREP_DEFAUT, PREP_CHOIX: PREP_CHOIX, HORAIRES_DEFAUT: HORAIRES_DEFAUT, heureValide: heureValide,
    prepOk: prepOk, penaliteBudget: penaliteBudget, creneauxTropLongs: creneauxTropLongs,
    repasAVenir: repasAVenir, prochainRepas: prochainRepas, quantitesRepas: quantitesRepas, coutRepas: coutRepas, nettoyerFaits: nettoyerFaits,
    cleJour: cleJour, indexJour: indexJour, minutesHeure: minutesHeure,
    SYNC_FORMAT: SYNC_FORMAT, SYNC_CHEMIN: SYNC_CHEMIN, NOMS_SECTIONS: NOMS_SECTIONS, hStr: hStr, canon: canon, empreintes: empreintes, horodater: horodater,
    fichierSync: fichierSync, fusionnerSync: fusionnerSync, majVide: majVide,
    MECANISMES: MECANISMES, auditMecanismes: auditMecanismes
  };
})(typeof DONNEES !== 'undefined' ? DONNEES : JSON.parse(document.getElementById('donnees').textContent));
