# -*- coding: utf-8 -*-
"""Assemble le fichier HTML unique à partir des sources.

    python3 assemble.py [sortie.html]            fichier autonome (ouvert depuis le disque)
    python3 assemble.py --en-ligne DOSSIER       appli installable pour GitHub Pages : index.html,
                                                 manifest.webmanifest, sw.js et les trois icônes
"""
import hashlib, json, os, shutil, sys
R = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
src = lambda *p: os.path.join(R, 'src', *p)

def lire(p):
    return open(p, encoding='utf-8').read()

def json_script(obj):
    # JSON sûr dans une balise <script> : pas de « </ » littéral
    return json.dumps(obj, ensure_ascii=False, separators=(',', ':')).replace('</', '<\\/')

def page(en_ligne):
    tpl = lire(src('template.html'))
    donnees = json.load(open(os.path.join(R, 'build', 'data.json'), encoding='utf-8'))
    exig = json.load(open(src('exigences.json'), encoding='utf-8'))
    pwa = ('<link rel="manifest" href="manifest.webmanifest">\n<meta name="theme-color" content="#23664A">\n'
           '<link rel="apple-touch-icon" href="icon-192.png">\n<link rel="icon" type="image/png" sizes="192x192" href="icon-192.png">') if en_ligne else ''
    morceaux = {
        '<!--__PWA__-->': pwa,
        '/*__CSS__*/': lire(src('style.css')),
        '/*__DONNEES__*/': json_script(donnees),
        '/*__EXIGENCES__*/': json_script(exig),
        '/*__QR__*/': lire(src('qrgen.js')),
        '/*__CORE__*/': lire(src('core.js')),
        '/*__UI__*/': lire(src('ui.js')),
    }
    for cle, val in morceaux.items():
        assert tpl.count(cle) == 1, cle
        tpl = tpl.replace(cle, val)
    return tpl

if len(sys.argv) > 2 and sys.argv[1] == '--en-ligne':
    dossier = sys.argv[2]
    os.makedirs(dossier, exist_ok=True)
    html = page(True)
    open(os.path.join(dossier, 'index.html'), 'w', encoding='utf-8').write(html)
    shutil.copy(src('pwa', 'manifest.webmanifest'), os.path.join(dossier, 'manifest.webmanifest'))
    for ic in ('icon-192.png', 'icon-512.png', 'icon-maskable-512.png'):
        shutil.copy(src('pwa', ic), os.path.join(dossier, ic))
    # le service worker change de nom de cache à chaque version : la nouvelle page est servie dès l'ouverture
    empreinte = hashlib.sha256(html.encode('utf-8')).hexdigest()[:8]
    sw = lire(src('pwa', 'sw.js')).replace('__VERSION__', empreinte)
    assert '__VERSION__' not in sw
    open(os.path.join(dossier, 'sw.js'), 'w', encoding='utf-8').write(sw)
    print(dossier, ':', ', '.join(sorted(os.listdir(dossier))), '- cache', empreinte)
else:
    out = sys.argv[1] if len(sys.argv) > 1 else os.path.join(R, 'equilibre_alimentaire.html')
    tpl = page(False)
    open(out, 'w', encoding='utf-8').write(tpl)
    print(out, os.path.getsize(out), 'octets,', tpl.count('\n') + 1, 'lignes')
