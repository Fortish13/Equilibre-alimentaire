#!/usr/bin/env node
/* Contrôle navigateur (point 8 du protocole) : charge le fichier livré dans Chromium (Playwright),
   parcourt tous les onglets, exerce les interactions principales et exige zéro erreur JavaScript.
   Depuis la v1.2.0 (07/11/2026) : prochain repas à heure figée, budget par jour, temps de préparation,
   synchronisation entre deux appareils avec une API GitHub simulée, édition en ligne installable.
   Usage : node test_navigateur.js equilibre_alimentaire.html [--en-ligne dossier] [--captures dossier]
   Playwright doit être installé (npm i -D playwright && npx playwright install chromium). */
'use strict';
const path = require('path'), fs = require('fs'), http = require('http'), crypto = require('crypto');
function chargerPlaywright() {
  const essais = [process.env.PLAYWRIGHT_PATH, 'playwright', '/opt/npm-tools/node_modules/playwright'].filter(Boolean);
  for (const m of essais) { try { return require(m); } catch (e) { /* suivant */ } }
  return null;
}
const pw = chargerPlaywright();
const fichier = path.resolve(process.argv[2] || 'equilibre_alimentaire.html');
const opt = n => { const i = process.argv.indexOf(n); return i > 0 ? process.argv[i + 1] : null; };
const dossierCaptures = opt('--captures'), dossierEnLigne = opt('--en-ligne') ? path.resolve(opt('--en-ligne')) : null;
const resultats = [];
function note(id, ok, detail) { resultats.push({ id, ok: !!ok, detail: detail || '' }); console.log((ok ? 'OK     ' : 'ÉCHEC  ') + id + (detail ? '  ' + detail : '')); }
const HEURE = new Date(2026, 10, 7, 17, 20);   // samedi 7 novembre 2026, 17 h 20 : horloge des essais
const ONGLETS = ['aujourdhui', 'semaine', 'bilan', 'recettes', 'courses', 'prix', 'foyer', 'methode'];

async function attendrePret(page) {
  await page.waitForFunction(() => document.getElementById('voile').hidden === true && window.__equilibre &&
    window.__equilibre.etat().plan.every(j => j.every(Boolean)) && document.getElementById('contenu').innerText.length > 100, null, { timeout: 60000 });
}
async function capture(page, nom) { if (dossierCaptures) await page.screenshot({ path: path.join(dossierCaptures, nom + '.png'), fullPage: true }); }
async function synchroniser(page) {   // une synchronisation complète, après celle qui serait déjà en cours
  for (let i = 0; i < 6; i++) {
    await page.waitForFunction(() => !window.__equilibre.syncEtat().busy, null, { timeout: 30000 });
    const r = await page.evaluate(() => window.__equilibre.syncNow('essai'));
    if (!r.skip) return r;
    await page.waitForTimeout(300);
  }
  return { err: 'synchronisation toujours occupée' };
}

// ---------------------------------------------------------------- API GitHub simulée (dépôts en mémoire)
function githubSimule(jeton) {
  const depots = {};
  const depot = cle => depots[cle] || (depots[cle] = { prive: !/public/.test(cle), fichiers: {}, blobs: {}, puts: 0, lectures: 0 });
  const cors = { 'access-control-allow-origin': '*', 'access-control-allow-headers': 'authorization, content-type, accept', 'access-control-allow-methods': 'GET, PUT, OPTIONS' };
  async function gerer(route) {
    const req = route.request(), u = new URL(req.url()), m = req.method();
    const json = (status, o) => route.fulfill({ status, headers: Object.assign({ 'content-type': 'application/json' }, cors), body: JSON.stringify(o) });
    if (m === 'OPTIONS') return route.fulfill({ status: 204, headers: cors, body: '' });
    const h = await req.allHeaders();
    if (h.authorization !== 'Bearer ' + jeton) return json(401, { message: 'Bad credentials' });
    const p = u.pathname.split('/').map(decodeURIComponent);   // ['', 'repos', pseudo, depot, ...]
    if (p[1] !== 'repos' || p.length < 4) return json(404, { message: 'Not Found' });
    const D = depot(p[2] + '/' + p[3]);
    if (m === 'GET' && p.length === 4) return json(200, { private: D.prive, permissions: { push: true }, default_branch: 'main' });
    if (m === 'GET' && p[4] === 'git' && p[5] === 'trees') return json(200, { tree: [{ path: 'README.md', type: 'blob', sha: 'r0' }].concat(Object.keys(D.fichiers).map(c => ({ path: c, type: 'blob', sha: D.fichiers[c].sha }))) });
    if (m === 'GET' && p[4] === 'git' && p[5] === 'blobs') { const b = D.blobs[p[6]]; D.lectures++; return b ? json(200, { content: b, encoding: 'base64' }) : json(404, { message: 'Not Found' }); }
    if (m === 'PUT' && p[4] === 'contents') {
      const chemin = p.slice(5).join('/'), corps = JSON.parse(req.postData() || '{}'), f = D.fichiers[chemin];
      if (f && corps.sha !== f.sha) return json(409, { message: 'is at ' + f.sha + ' but expected ' + corps.sha });
      if (!f && corps.sha) return json(422, { message: 'Invalid request' });
      const sha = crypto.createHash('sha1').update(corps.content || '').digest('hex');
      D.blobs[sha] = corps.content; D.fichiers[chemin] = { sha }; D.puts++;
      return json(f ? 200 : 201, { content: { path: chemin, sha } });
    }
    return json(404, { message: 'Not Found' });
  }
  const lire = (cle, chemin) => { const D = depots[cle], f = D && D.fichiers[chemin]; return f ? Buffer.from(D.blobs[f.sha], 'base64').toString('utf8') : null; };
  return { depots, depot, gerer, lire };
}

// ---------------------------------------------------------------- petit serveur pour l'édition en ligne (service worker : http://localhost)
function servir(dossier) {
  const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.webmanifest': 'application/manifest+json', '.png': 'image/png' };
  return new Promise(res => {
    const srv = http.createServer((q, r) => {
      let p = decodeURIComponent(new URL(q.url, 'http://x').pathname); if (p.endsWith('/')) p += 'index.html';
      const f = path.join(dossier, p);
      if (!f.startsWith(dossier) || !fs.existsSync(f)) { r.writeHead(404); r.end(); return; }
      r.writeHead(200, { 'content-type': types[path.extname(f)] || 'application/octet-stream', 'cache-control': 'no-cache' }); r.end(fs.readFileSync(f));
    });
    srv.listen(0, '127.0.0.1', () => res(srv));
  });
}

async function main() {
  if (!pw) { console.log('NON VÉRIFIÉ : Playwright introuvable sur cette machine.'); process.exit(2); }
  const navigateur = await pw.chromium.launch();
  const erreurs = [];
  const brancher = (page, nom) => {
    page.on('pageerror', e => erreurs.push(nom + ' pageerror: ' + e.message));
    page.on('console', m => { if (m.type() === 'error') erreurs.push(nom + ' console: ' + m.text()); });
  };
  const url = 'file://' + fichier;

  // 1) bureau, sans synchronisation : aucune requête réseau, prochain repas, onglets, interactions
  const ctx1 = await navigateur.newContext({ viewport: { width: 1366, height: 900 }, acceptDownloads: true });
  await ctx1.clock.install({ time: HEURE });
  const page = await ctx1.newPage(); brancher(page, 'bureau');
  const requetes = []; page.on('request', r => { if (!/^(file|data|blob):/.test(r.url())) requetes.push(r.url()); });
  await page.goto(url);
  await attendrePret(page);
  // prochain repas au premier plan : premier onglet, même recette que le calcul du cœur
  const pr = await page.evaluate(() => {
    const st = window.__equilibre.etat(), r = NUTRI.prochainRepas(st, new Date()), rec = NUTRI.RECETTE[r.id];
    const carte = document.querySelector('.prochain');
    return { actif: document.querySelector('.onglets button[aria-selected="true"]').dataset.onglet, nom: rec.nom, s: r.s, d: r.d, lignes: rec.lignes.length,
      carteNom: carte ? carte.querySelector('.nom-recette').textContent : '', texte: carte ? carte.innerText : '', rangs: carte ? carte.querySelectorAll('.table-quantites tr').length : 0,
      etapes: carte ? carte.querySelectorAll('.etapes li').length : 0, nbEtapes: rec.etapes.length, debut: r.debut.getHours() + ' h ' + String(r.debut.getMinutes()).padStart(2, '0') };
  });
  note('prochain repas au premier plan à l\'ouverture', pr.actif === 'aujourdhui' && pr.carteNom === pr.nom && pr.d === 5 && pr.s === 3 && pr.rangs === pr.lignes && pr.etapes === pr.nbEtapes && /commencer à/.test(pr.texte) && /Pour Adulte 1, Adulte 2 et Enfant/.test(pr.texte),
    'samedi 17 h 20 → dîner : ' + pr.carteNom + ', commencer à ' + pr.debut + ', ' + pr.rangs + ' ingrédients, ' + pr.etapes + ' étapes');
  await capture(page, 'bureau_prochain');
  for (const o of ONGLETS) {
    await page.click(`button[data-onglet="${o}"]`);
    await page.waitForTimeout(120);
    const vide = await page.evaluate(() => document.getElementById('contenu').innerText.trim().length);
    note('onglet ' + o, vide > 200, vide + ' caractères affichés');
    await capture(page, 'bureau_' + o);
  }
  // audit des mécanismes affiché
  const audit = await page.evaluate(() => { const t = [...document.querySelectorAll('h2')].find(h => h.textContent.startsWith('Audit des mécanismes')); return t ? t.textContent : ''; });
  const m = audit.match(/\((\d+)\/(\d+)\)/);
  note('audit des mécanismes dans le navigateur', m && m[1] === m[2], audit);

  // planning : rappel du prochain repas, verrou, changement, amélioration
  await page.click('button[data-onglet="semaine"]');
  const bandeau = await page.evaluate(() => { const b = document.getElementById('bandeauRepas'); return b.hidden ? '' : b.innerText; });
  note('prochain repas rappelé sur les autres onglets', bandeau.indexOf(pr.nom) >= 0 && /Dîner aujourd'hui à 19 h 15/.test(bandeau), bandeau.replace(/\s+/g, ' ').slice(0, 110));
  await page.click('button[data-action="verrou"][data-d="2"][data-s="1"]');
  const avant = await page.evaluate(() => window.__equilibre.etat().plan[2][1]);
  const options = await page.$$eval('select[data-action="choisir"][data-d="0"][data-s="3"] option', os => os.map(o => o.value).filter(v => v && v !== '__'));
  await page.selectOption('select[data-action="choisir"][data-d="0"][data-s="3"]', options[options.length - 1]);
  const choisi = await page.evaluate(() => window.__equilibre.etat().plan[0][3]);
  note('choix manuel d\'une recette', choisi === options[options.length - 1], choisi);
  await page.click('button[data-action="ameliorer"]');
  await attendrePret(page);
  await page.waitForTimeout(100);
  const apres = await page.evaluate(() => window.__equilibre.etat().plan[2][1]);
  note('verrou respecté par « Améliorer »', avant === apres, avant + ' → ' + apres);

  // recette : ouverture du détail
  await page.click('.semaine .nom-recette');
  await page.waitForSelector('dialog[open] .etapes li');
  const lignes = await page.$$eval('dialog[open] tbody tr', t => t.length);
  note('détail de recette (ingrédients, étapes, apports)', lignes > 5, lignes + ' lignes de tableau');
  await page.click('dialog[open] button[data-action="fermer-dlg"]');

  // bilan : tuile et suggestions
  await page.click('button[data-onglet="bilan"]');
  await page.click('button.tuile[data-k="fe"]');
  const sug = await page.evaluate(() => document.querySelector('.detail') ? document.querySelector('.detail').innerText : '');
  note('détail d\'un nutriment avec suggestions', /Fer/.test(sug) && /Pour en apporter plus/.test(sug), sug.slice(0, 60).replace(/\n/g, ' '));
  await page.click('button[data-action="personne"][data-p="2"]');
  await page.selectOption('select[data-action="periode"]', '3');
  note('bilan enfant, jeudi', await page.evaluate(() => /Enfant/.test(document.querySelector('.detail').innerText)));

  // prix : modification et retour
  await page.click('button[data-onglet="prix"]');
  const coutAvant = await page.evaluate(() => window.__equilibre.cache().ev.cout);
  await page.fill('input[data-action="prix-val"][data-a="lait"]', '9');
  await page.press('input[data-action="prix-val"][data-a="lait"]', 'Enter');
  await page.dispatchEvent('input[data-action="prix-val"][data-a="lait"]', 'change');
  await page.waitForTimeout(100);
  const coutApres = await page.evaluate(() => window.__equilibre.cache().ev.cout);
  note('prix modifié → coût recalculé', coutApres > coutAvant, coutAvant.toFixed(2) + ' → ' + coutApres.toFixed(2) + ' €');
  await page.click('button[data-action="prix-reset"][data-a="lait"]');
  const coutRetour = await page.evaluate(() => window.__equilibre.cache().ev.cout);
  note('retour au prix relevé', Math.abs(coutRetour - coutAvant) < 1e-6, coutRetour.toFixed(2) + ' €');

  // foyer : cantine, eau, export
  await page.click('button[data-onglet="foyer"]');
  const consAvant = await page.evaluate(() => window.__equilibre.cache().liste.consomme);
  await page.click('button[data-action="preset"][data-p="2"][data-v="cantine"]');
  const consApres = await page.evaluate(() => window.__equilibre.cache().liste.consomme);
  const dehors = await page.evaluate(() => window.__equilibre.cache().ev.personnes[2].nRepasDehors);
  note('cantine : 4 repas dehors, courses réduites', dehors === 4 && consApres < consAvant, dehors + ' repas, ' + consAvant.toFixed(2) + ' → ' + consApres.toFixed(2) + ' €');
  const caAvant = await page.evaluate(() => window.__equilibre.cache().ev.personnes[0].moy[NUTRI.KI.ca]);
  await page.selectOption('select[data-action="p-eau"][data-p="0"]', 'hepar');
  const caApres = await page.evaluate(() => window.__equilibre.cache().ev.personnes[0].moy[NUTRI.KI.ca]);
  note('eau Hépar → calcium en hausse', caApres > caAvant + 700, caAvant.toFixed(0) + ' → ' + caApres.toFixed(0) + ' mg/j');
  await page.selectOption('select[data-action="p-eau"][data-p="2"]', 'eauMagCrf');
  const fluor = await page.evaluate(() => { const n = document.querySelector('.note.note-grave'); return n ? n.innerText : ''; });
  note('mise en garde fluor pour l\'enfant (eau magnésienne Carrefour)', /1,5 mg\/L de fluor/.test(fluor) && /moins de 7 ans/.test(fluor), fluor.slice(0, 90).replace(/\n/g, ' '));
  await page.selectOption('select[data-action="p-eau"][data-p="2"]', 'eauRobinet');
  await page.selectOption('select[data-action="p-eau"][data-p="0"]', 'eauRobinet');
  const eAvant = await page.evaluate(() => window.__equilibre.cache().ev.personnes[2].E);
  await page.fill('input[data-action="p-num"][data-c="poids"][data-p="2"]', '26');
  await page.dispatchEvent('input[data-action="p-num"][data-c="poids"][data-p="2"]', 'change');
  const eApres = await page.evaluate(() => window.__equilibre.cache().ev.personnes[2].E);
  note('poids de l\'enfant → besoin énergétique recalculé', eApres > eAvant, eAvant + ' → ' + eApres + ' kcal/j');
  const [dl] = await Promise.all([page.waitForEvent('download'), page.click('button[data-action="exporter"]')]);
  const exporte = fs.readFileSync(await dl.path(), 'utf8');
  note('export JSON', /equilibre-alimentaire-.*\.json$/.test(dl.suggestedFilename()) && /"budgetJour"/.test(exporte), dl.suggestedFilename());
  await page.click('button[data-action="preset"][data-p="2"][data-v="maison"]');

  // budget par jour : un maximum trop bas est signalé jour par jour
  await page.fill('input[data-action="budget-max"]', '5');
  await page.dispatchEvent('input[data-action="budget-max"]', 'change');
  await page.click('button[data-onglet="semaine"]');
  const bud = await page.evaluate(() => ({ note: (document.querySelector('.note.note-grave') || {}).innerText || '', rouges: document.querySelectorAll('.cout-jour.st-bas').length, max: window.__equilibre.etat().budgetJour.max }));
  note('budget dépassé signalé', bud.max === 5 && /Budget dépassé/.test(bud.note) && bud.rouges === 7, bud.rouges + ' jours en rouge pour un maximum de 5 € : « ' + bud.note.slice(0, 60).replace(/\n/g, ' ') + '… »');
  await page.click('button[data-onglet="foyer"]');
  await page.fill('input[data-action="budget-max"]', '12');
  await page.dispatchEvent('input[data-action="budget-max"]', 'change');

  // préparation : 15 min au plus, puis une recette plus longue choisie à la main
  await page.selectOption('select[data-action="prep-max"]', '15');
  await page.click('button[data-onglet="semaine"]');
  await page.click('button[data-action="generer"]');
  await page.waitForFunction(() => document.getElementById('voile').hidden === false, null, { timeout: 5000 }).catch(() => {});
  await attendrePret(page);
  const prep = await page.evaluate(() => { const st = window.__equilibre.etat(); let max = 0, trop = 0; st.plan.forEach(j => j.forEach(id => { const p = NUTRI.RECETTE[id].prep; max = Math.max(max, p); if (p > 15) trop++; })); return { max, trop, pm: st.prepMax, jours: window.__equilibre.cache().ev.coutJours }; });
  note('préparation ≤ 15 min respectée par le générateur', prep.pm === 15 && prep.trop === 0 && prep.max <= 15 && prep.jours.every(c => c <= 12 + 1e-9), 'préparation la plus longue ' + prep.max + ' min ; jours de ' + Math.min(...prep.jours).toFixed(2) + ' à ' + Math.max(...prep.jours).toFixed(2) + ' €');
  await page.selectOption('select[data-action="choisir"][data-d="0"][data-s="1"]', 'R22');
  const long = await page.evaluate(() => ({ badge: document.querySelectorAll('.prep.prep-trop').length, note: [...document.querySelectorAll('.note')].map(n => n.innerText).join(' ') }));
  note('préparation trop longue signalée', long.badge === 1 && /Préparation de plus de 15 min/.test(long.note), long.badge + ' recette signalée : ' + (long.note.match(/Préparation de plus de[^.]*/) || [''])[0]);
  await page.click('button[data-onglet="foyer"]');
  await page.selectOption('select[data-action="prep-max"]', '20');

  // « C'est prêt » : le repas suivant prend la place
  await page.click('button[data-onglet="aujourdhui"]');
  const r1 = await page.evaluate(() => { const r = NUTRI.prochainRepas(window.__equilibre.etat(), new Date()); return { cle: r.cle, nom: NUTRI.RECETTE[r.id].nom }; });
  await page.click('button[data-action="repas-fait"]');
  const r2 = await page.evaluate(() => { const st = window.__equilibre.etat(), r = NUTRI.prochainRepas(st, new Date()); return { cle: r.cle, nom: NUTRI.RECETTE[r.id].nom, carte: document.querySelector('.prochain .nom-recette').textContent, fait: Object.keys(st.faits) }; });
  note('prochain repas : « C\'est prêt » passe au suivant', r2.fait.indexOf(r1.cle) >= 0 && r2.cle === '2026-11-08:0' && r2.carte === r2.nom, r1.cle + ' (' + r1.nom + ') prêt → ' + r2.cle + ' : ' + r2.carte);

  await page.click('button[data-onglet="courses"]');
  const nbArticles = await page.$$eval('.ligne-course', l => l.length);
  note('liste de courses par rayon', nbArticles > 20, nbArticles + ' articles');
  await page.reload(); await attendrePret(page);
  const persiste = await page.evaluate(() => { const st = window.__equilibre.etat(); return st.personnes[2].poids + ' kg, ' + Object.keys(st.faits).length + ' repas prêt'; });
  note('réglages conservés après rechargement', persiste === '26 kg, 1 repas prêt', persiste);
  note('aucune requête réseau sans synchronisation', requetes.length === 0, requetes.length ? requetes.slice(0, 3).join(' ') : 'aucune requête hors du fichier pendant tout le parcours');
  await ctx1.close();

  // 2) téléphone 390 px : pas de défilement horizontal
  const ctx2 = await navigateur.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  await ctx2.clock.install({ time: HEURE });
  const tel = await ctx2.newPage(); brancher(tel, 'téléphone');
  await tel.goto(url); await attendrePret(tel);
  const debord = [];
  for (const o of ONGLETS) {
    await tel.click(`button[data-onglet="${o}"]`); await tel.waitForTimeout(120);
    const w = await tel.evaluate(() => document.documentElement.scrollWidth);
    if (w > 392) debord.push(o + '=' + w);
    if (dossierCaptures) await tel.screenshot({ path: path.join(dossierCaptures, 'tel_' + o + '.png'), fullPage: false });
  }
  note('téléphone 390 px sans débordement horizontal', debord.length === 0, debord.join(', ') || 'aucun onglet ne déborde');
  await ctx2.close();

  // 3) stockage refusé par le navigateur
  const ctx3 = await navigateur.newContext({ viewport: { width: 1200, height: 800 } });
  await ctx3.addInitScript(() => { Object.defineProperty(window, 'localStorage', { get() { throw new Error('stockage interdit'); } }); });
  const p3 = await ctx3.newPage(); brancher(p3, 'sans-stockage');
  await p3.goto(url); await attendrePret(p3);
  await p3.click('button[data-onglet="foyer"]');
  const msg = await p3.evaluate(() => /refuse la sauvegarde locale/.test(document.getElementById('contenu').innerText));
  note('stockage refusé : l\'outil fonctionne et prévient', msg);
  await ctx3.close();

  // 4) synchronisation entre un PC et un téléphone, API GitHub simulée
  const JETON = 'github_pat_ESSAI_' + 'x'.repeat(48), PSEUDO = 'famille-essai', DEPOT = 'equilibre-donnees', APPLI = 'https://famille-essai.github.io/equilibre-alimentaire/';
  const gh = githubSimule(JETON), cleDepot = PSEUDO + '/' + DEPOT;
  const ctxPC = await navigateur.newContext({ viewport: { width: 1280, height: 900 } });
  await ctxPC.clock.install({ time: HEURE });
  await ctxPC.route('https://api.github.com/**', r => gh.gerer(r));
  const pc = await ctxPC.newPage(); brancher(pc, 'synchro-PC');
  await pc.goto(url); await attendrePret(pc);
  await pc.evaluate(() => { window.__equilibre.etat(); });
  // une modification avant la synchro : prix du lait corrigé, une coche
  await pc.click('button[data-onglet="prix"]');
  await pc.fill('input[data-action="prix-val"][data-a="lait"]', '1.1');
  await pc.dispatchEvent('input[data-action="prix-val"][data-a="lait"]', 'change');
  await pc.click('button[data-onglet="courses"]');
  await pc.check('input[data-action="cocher"][data-a="lait"]');
  await pc.click('button[data-onglet="foyer"]');
  await pc.fill('#s_owner', PSEUDO); await pc.fill('#s_repo', DEPOT); await pc.fill('#s_token', JETON); await pc.fill('#s_device', 'PC'); await pc.fill('#s_app', APPLI);
  await pc.click('button[data-action="s-enregistrer"]');
  await pc.waitForFunction(() => { const e = window.__equilibre.syncEtat(); return !e.busy && (e.meta.ok || e.meta.err); }, null, { timeout: 30000 });
  const envoi = gh.lire(cleDepot, 'equilibre/etat.json'), planPC = await pc.evaluate(() => JSON.stringify(window.__equilibre.etat().plan));
  const fic = envoi ? JSON.parse(envoi) : null;
  note('synchro : premier appareil envoie', fic && JSON.stringify(fic.sections.semaine.v.plan) === planPC && fic.sections.prix.v.lait.prix === 1.1 && fic.coches.lait && fic.coches.lait.v === 1,
    fic ? 'equilibre/etat.json envoyé (' + Math.round(envoi.length / 1024) + ' Ko), semaine, prix et coche présents' : 'rien dans le dépôt : ' + JSON.stringify(await pc.evaluate(() => window.__equilibre.syncEtat().meta)));
  note('synchro : jeton absent du fichier envoyé', envoi && envoi.indexOf(JETON) < 0 && !/github_pat|token|Bearer/i.test(envoi), 'ni le jeton ni sa clé dans le dépôt');
  // lien de liaison (QR code) puis téléphone
  await pc.click('button[data-action="s-relier"]');
  const lien = await pc.evaluate(() => ({ url: (document.getElementById('s_lienurl') || {}).value || '', svg: !!document.querySelector('.sync-qr svg path') }));
  note('lien de liaison avec QR code', lien.svg && lien.url.indexOf(APPLI + '#lien=') === 0, lien.svg ? 'QR code affiché, lien ' + lien.url.slice(0, 64) + '…' : 'QR code absent');
  await capture(pc, 'synchro_pc');
  const hash = lien.url.slice(lien.url.indexOf('#'));
  const ctxTel = await navigateur.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  await ctxTel.clock.install({ time: HEURE });
  await ctxTel.route('https://api.github.com/**', r => gh.gerer(r));
  const ph = await ctxTel.newPage(); brancher(ph, 'synchro-téléphone');
  await ph.goto(url + hash); await attendrePret(ph);
  await ph.waitForSelector('button[data-action="lien-relier"]', { timeout: 10000 });
  await capture(ph, 'synchro_tel_relier');
  await ph.click('button[data-action="lien-relier"]');
  await ph.waitForFunction(() => { const e = window.__equilibre.syncEtat(); return e.on && !e.busy && (e.meta.ok || e.meta.err); }, null, { timeout: 30000 });
  const recuTel = await ph.evaluate(() => { const st = window.__equilibre.etat(); return { plan: JSON.stringify(st.plan), lait: st.prix.lait && st.prix.lait.prix, coche: !!st.coches.lait, hash: location.hash, err: window.__equilibre.syncEtat().meta.err }; });
  note('synchro : liaison par lien et réception', recuTel.plan === planPC && recuTel.lait === 1.1 && recuTel.coche && recuTel.hash === '' && !recuTel.err,
    'semaine du PC reçue : ' + (recuTel.plan === planPC ? 'oui' : 'NON') + ', prix du lait ' + recuTel.lait + ' €, coche reçue : ' + recuTel.coche + (recuTel.err ? ', erreur : ' + recuTel.err : ''));
  // modifications croisées : le téléphone marque un repas prêt et baisse le budget, le PC corrige un autre prix
  await ph.click('button[data-onglet="aujourdhui"]');
  const cleTel = await ph.evaluate(() => NUTRI.prochainRepas(window.__equilibre.etat(), new Date()).cle);
  await ph.click('button[data-action="repas-fait"]');
  await ph.click('button[data-onglet="foyer"]');
  await ph.fill('input[data-action="budget-max"]', '11.5'); await ph.dispatchEvent('input[data-action="budget-max"]', 'change');
  await pc.click('button[data-onglet="prix"]');
  await pc.fill('input[data-action="prix-val"][data-a="pommes"]', '3.2'); await pc.dispatchEvent('input[data-action="prix-val"][data-a="pommes"]', 'change');
  const s1 = await synchroniser(ph), s2 = await synchroniser(pc), s3 = await synchroniser(ph);
  const etatPC = await pc.evaluate(() => { const st = window.__equilibre.etat(); return { fait: Object.keys(st.faits), max: st.budgetJour.max, pommes: st.prix.pommes && st.prix.pommes.prix, f: NUTRI.canon(NUTRI.fichierSync(st)) }; });
  const etatTel = await ph.evaluate(() => { const st = window.__equilibre.etat(); return { max: st.budgetJour.max, pommes: st.prix.pommes && st.prix.pommes.prix, f: NUTRI.canon(NUTRI.fichierSync(st)) }; });
  note('synchro : modification renvoyée et fusionnée', etatPC.fait.indexOf(cleTel) >= 0 && etatPC.max === 11.5 && etatPC.pommes === 3.2 && etatTel.pommes === 3.2 && etatTel.max === 11.5 && etatPC.f === etatTel.f && !s1.err && !s2.err && !s3.err,
    'repas prêt et budget du téléphone sur le PC, prix des pommes du PC sur le téléphone ; mêmes données des deux côtés : ' + (etatPC.f === etatTel.f ? 'oui' : 'NON') + ' ; ' + gh.depot(cleDepot).puts + ' envois au dépôt');
  await capture(ph, 'synchro_tel_apres');
  // dépôt public : refusé, rien n'y est écrit
  await pc.click('button[data-onglet="foyer"]');
  await pc.fill('#s_repo', 'depot-public');
  await pc.click('button[data-action="s-enregistrer"]');
  await pc.waitForFunction(() => { const e = window.__equilibre.syncEtat(); return !e.busy && e.meta.err; }, null, { timeout: 30000 });
  const pub = await pc.evaluate(() => ({ err: window.__equilibre.syncEtat().meta.err, statut: (document.getElementById('s_statut') || {}).innerText || '' }));
  note('synchro : dépôt public refusé', /est public/.test(pub.err) && gh.depot(PSEUDO + '/depot-public').puts === 0 && /est public/.test(pub.statut), pub.err.slice(0, 90));
  await ctxPC.close(); await ctxTel.close();

  // 5) édition en ligne : service worker, manifeste, hors connexion
  if (dossierEnLigne && fs.existsSync(path.join(dossierEnLigne, 'index.html'))) {
    const srv = await servir(dossierEnLigne), base = 'http://127.0.0.1:' + srv.address().port + '/';
    const ctx5 = await navigateur.newContext({ viewport: { width: 1280, height: 900 } });
    const p5 = await ctx5.newPage(); brancher(p5, 'en-ligne');
    await p5.goto(base); await attendrePret(p5);
    const sw = await p5.evaluate(async () => {
      const reg = await Promise.race([navigator.serviceWorker.ready, new Promise(r => setTimeout(() => r(null), 15000))]);
      const lien = document.querySelector('link[rel="manifest"]');
      let man = null; try { man = await (await fetch(lien.href)).json(); } catch (e) { man = null; }
      return { actif: !!(reg && reg.active), portee: reg ? reg.scope : '', man: man && man.display, icones: man ? man.icons.length : 0 };
    });
    await p5.reload(); await attendrePret(p5);
    const controle = await p5.evaluate(() => !!navigator.serviceWorker.controller);
    note('appli en ligne : service worker et manifeste', sw.actif && controle && sw.man === 'standalone' && sw.icones === 3, 'service worker actif sur ' + sw.portee + ', page contrôlée : ' + controle + ', manifeste ' + sw.man + ' avec ' + sw.icones + ' icônes');
    await ctx5.setOffline(true);
    let horsLigne = false, detail = '';
    try { await p5.reload(); await attendrePret(p5); horsLigne = await p5.evaluate(() => !!document.querySelector('.prochain') || /Aucun repas/.test(document.body.innerText)); detail = 'rechargée hors connexion depuis le cache'; }
    catch (e) { detail = 'échec hors connexion : ' + e.message.slice(0, 80); }
    note('appli en ligne : fonctionne hors connexion', horsLigne, detail);
    await ctx5.setOffline(false);
    await ctx5.close(); srv.close();
  }

  await navigateur.close();
  note('zéro erreur JavaScript', erreurs.length === 0, erreurs.length ? erreurs.slice(0, 5).join(' | ') : 'aucune erreur ni avertissement de niveau erreur');
  const ko = resultats.filter(r => !r.ok).length;
  console.log('\n' + (resultats.length - ko) + '/' + resultats.length + ' contrôles navigateur réussis');
  if (process.env.SORTIE_JSON) fs.writeFileSync(process.env.SORTIE_JSON, JSON.stringify(resultats, null, 1));
  process.exit(ko ? 1 : 0);
}
main().catch(e => { console.error('ÉCHEC du contrôle navigateur :', e.message); if (process.env.SORTIE_JSON) fs.writeFileSync(process.env.SORTIE_JSON, JSON.stringify(resultats.concat([{ id: 'exécution', ok: false, detail: e.message }]), null, 1)); process.exit(1); });
