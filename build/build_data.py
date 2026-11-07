# -*- coding: utf-8 -*-
"""Construit data.json (sous-ensemble CIQUAL + aliments + achats + recettes) pour l'outil HTML."""
import json, sys, os
sys.path.insert(0, os.path.dirname(__file__))
from data_src import ACHATS, ALIMENTS, ETIQUETTES, EAUX_ETIQUETTES, RECETTES, PRIX_DATE, PRIX_SRC, PRIX_DATES

CIQ = sys.argv[1]
OUT = sys.argv[2]
d = json.load(open(CIQ, encoding='utf-8'))

NUTR = [  # cle, libellé, unité, code CIQUAL
    ("kcal", "Énergie", "kcal", "328"),
    ("prot", "Protéines", "g", "25000"),
    ("gluc", "Glucides", "g", "31000"),
    ("sucres", "Sucres", "g", "32000"),
    ("lip", "Lipides", "g", "40000"),
    ("ags", "AG saturés", "g", "40302"),
    ("fib", "Fibres", "g", "34100"),
    ("ca", "Calcium", "mg", "10200"),
    ("mg", "Magnésium", "mg", "10120"),
    ("fe", "Fer", "mg", "10260"),
    ("zn", "Zinc", "mg", "10300"),
    ("k", "Potassium", "mg", "10190"),
    ("p", "Phosphore", "mg", "10150"),
    ("na", "Sodium", "mg", "10110"),
    ("cu", "Cuivre", "mg", "10290"),
    ("se", "Sélénium", "µg", "10340"),
    ("i", "Iode", "µg", "10530"),
    ("vitA", "Vitamine A", "µg ER", "51104"),
    ("vitD", "Vitamine D", "µg", "52100"),
    ("vitE", "Vitamine E", "mg", "71010"),
    ("vitC", "Vitamine C", "mg", "55100"),
    ("b1", "Vitamine B1", "mg", "56100"),
    ("b2", "Vitamine B2", "mg", "56200"),
    ("b6", "Vitamine B6", "mg", "56500"),
    ("b9", "Vitamine B9 (folates)", "µg EFA", "56702"),
    ("b12", "Vitamine B12", "µg", "56600"),
    ("ala", "Oméga-3 ALA", "g", "41833"),
    ("epa", "Oméga-3 EPA", "g", "42053"),
    ("dha", "Oméga-3 DHA", "g", "42263"),
]

def parse(s):
    """Valeur CIQUAL -> (nombre ou None, statut). '<x' et 'traces' -> 0 (borne basse)."""
    if s is None:
        return None, 'absent'
    s = s.strip()
    if s == '' or s == '-':
        return None, 'absent'
    if s.lower() == 'traces':
        return 0.0, 'traces'
    if s.startswith('<'):
        return 0.0, 'inf'
    return float(s.replace(',', '.')), 'ok'

def valeurs(code):
    if code in ETIQUETTES:
        v = {k: 0.0 for k, *_ in NUTR}
        v.update(ETIQUETTES[code]["valeurs"])
        return v, {}, ETIQUETTES[code]["nom"]
    c = d['compo'][code]
    v, st = {}, {}
    for k, _, _, cc in NUTR:
        v[k], st[k] = parse(c.get(cc))
    # repli énergie : calcul à partir des macronutriments (facteurs règlement UE 1169/2011)
    if v['kcal'] is None:
        p, g, l, f = (v['prot'], v['gluc'], v['lip'], v['fib'])
        if p is not None or g is not None or l is not None:
            v['kcal'] = round(4 * (p or 0) + 4 * (g or 0) + 9 * (l or 0) + 2 * (f or 0), 1)
            st['kcal'] = 'calcule'
    # repli vitamine A : rétinol + bêta-carotène / 6
    if v['vitA'] is None:
        r, _ = parse(c.get('51200')); b, _ = parse(c.get('51330'))
        if r is not None or b is not None:
            v['vitA'] = round((r or 0) + (b or 0) / 6, 2); st['vitA'] = 'calcule'
    # repli folates : folates totaux si l'équivalent EFA est absent (aliment non enrichi)
    if v['b9'] is None:
        t, _ = parse(c.get('56700'))
        if t is not None:
            v['b9'] = t; st['b9'] = 'folates totaux'
    # repli vitamine E : la table 2025 donne surtout l'alpha-tocophérol (71010) ; sinon « Vitamine E » (53100)
    if v['vitE'] is None:
        e, _ = parse(c.get('53100'))
        if e is not None:
            v['vitE'] = e; st['vitE'] = 'vitamine E (53100)'
    # sucres hors lactose et galactose (repère ANSES)
    lac, _ = parse(c.get('32410')); gal, _ = parse(c.get('32220'))
    if v['sucres'] is not None:
        v['sucresHL'] = max(0.0, v['sucres'] - (lac or 0) - (gal or 0))
    else:
        v['sucresHL'] = None
    # eau : vitamines et macronutriments nuls par nature (évite des « données manquantes » trompeuses)
    if code.startswith('76') or code == '18066':
        for k in v:
            if v[k] is None:
                v[k] = 0.0
    return v, st, d['alim'][code]['alim_nom_fr']

VEGETAL_CATS = {"legume", "fruit", "fruitSec", "feculent", "feculentComplet", "legSecs", "fruitCoque", "sucre"}
ANIMAL_CATS = {"oeuf", "viande", "volaille", "charcuterie", "poisson", "fromage"}
VEGETAL_IDS = {"cacao", "citron", "coco", "colza", "olive"}
aliments = {}
for fid, (nom, code, y, unite, dg, achat, cats) in ALIMENTS.items():
    assert achat in ACHATS, (fid, achat)
    v, st, cnom = valeurs(code)
    cs = {c.split(':')[0] for c in cats}
    vegetal = fid in VEGETAL_IDS or (bool(cs & VEGETAL_CATS) and not (cs & ANIMAL_CATS) and not any(c.startswith('laitier') for c in cats))
    if vegetal:
        # B12, vitamine D, EPA et DHA n'existent pas dans les aliments d'origine végétale non enrichis
        for k in ('vitD', 'b12', 'epa', 'dha'):
            if v[k] is None:
                v[k] = 0.0; st[k] = 'zéro (origine végétale)'
    if fid == 'sel':
        for k in v:
            if v[k] is None:
                v[k] = 0.0; st[k] = 'zéro (sel : chlorure de sodium iodé)'
    a = dict(nom=nom, ciqual=code, ciqualNom=cnom, y=y, unite=unite, achat=achat, cats=cats,
             v={k: (round(x, 4) if isinstance(x, float) else x) for k, x in v.items()})
    if unite == 'ml':
        a['dens'] = dg
    if unite == 'pc':
        a['gpc'] = dg
    statuts = {k: s for k, s in st.items() if s not in ('ok', 'absent', 'traces', 'inf')}
    if statuts:
        a['notes'] = statuts
    if fid in EAUX_ETIQUETTES:
        assert 'eau' in cats, fid
        a['etiquette'] = dict(EAUX_ETIQUETTES[fid])
    aliments[fid] = a
assert all(f in aliments for f in EAUX_ETIQUETTES), 'eau d\'étiquette inconnue'

achats = {}
for aid, (nom, marque, qte, unite, prix, comest, gpc, rayon, ean) in ACHATS.items():
    achats[aid] = dict(nom=nom, marque=marque, qte=qte, unite=unite, prix=prix, comest=comest, rayon=rayon,
                       ean=ean, date=PRIX_DATES.get(aid, PRIX_DATE), src=PRIX_SRC if aid != 'eauRobinet' else 'ordre de grandeur, à ajuster')
    if gpc:
        achats[aid]['gpc'] = gpc

recettes = []
for r in RECETTES:
    for (f, q, u) in r['lignes']:
        assert f in aliments, (r['id'], f)
    rr = dict(r)
    rr['lignes'] = [dict(f=f, q=q, u=u) for (f, q, u) in r['lignes']]
    recettes.append(rr)

meta = dict(
    ciqualVersion="Table Ciqual 2025 (fichiers ANSES du 03/11/2025, 3 484 aliments)",
    prixDate=PRIX_DATE, prixSrc=PRIX_SRC,
    nutriments=[dict(k=k, nom=n, u=u, code=c) for k, n, u, c in NUTR] + [dict(k="sucresHL", nom="Sucres hors lactose", u="g", code="32000-32410-32220")],
)
json.dump(dict(meta=meta, aliments=aliments, achats=achats, recettes=recettes),
          open(OUT, 'w', encoding='utf-8'), ensure_ascii=False, separators=(',', ':'))
print('aliments', len(aliments), 'achats', len(achats), 'recettes', len(recettes), '->', OUT, os.path.getsize(OUT), 'octets')
