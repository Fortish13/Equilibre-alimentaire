import sys, os, re, xml.etree.ElementTree as ET, json
D = sys.argv[1]; OUT = sys.argv[2]
v = "2025_11_03"
const = {}
for c in ET.parse(os.path.join(D, f"const_{v}.xml")).getroot():
    const[c.find('const_code').text.strip()] = c.find('const_nom_fr').text.strip()
alim = {}
for a in ET.parse(os.path.join(D, f"alim_{v}.xml")).getroot():
    rec = {}
    for ch in a:
        rec[ch.tag] = (ch.text or '').strip()
    alim[rec['alim_code']] = rec
raw = open(os.path.join(D, f"compo_{v}.xml"), encoding='utf-8-sig').read().replace(' < ', ' &lt; ')
root = ET.fromstring(raw)
compo = {}
conf = {}
for c in root:
    ac = c.find('alim_code').text.strip(); cc = c.find('const_code').text.strip()
    t = c.find('teneur').text
    compo.setdefault(ac, {})[cc] = (t or '').strip()
    cf = c.find('code_confiance').text
    conf.setdefault(ac, {})[cc] = (cf or '').strip()
json.dump({'const': const, 'alim': alim, 'compo': compo, 'conf': conf}, open(OUT, 'w', encoding='utf-8'), ensure_ascii=False)
print(len(const), 'constituants;', len(alim), 'aliments;', sum(len(x) for x in compo.values()), 'valeurs')
print('champs alim:', list(next(iter(alim.values())).keys()))
