"""Собирает два самодостаточных index.html из шаблонов: python _src/build.py"""
from pathlib import Path

src = Path(__file__).parent
root = src.parent
css = (src / 'common.css').read_text(encoding='utf-8')
js = (src / 'common.js').read_text(encoding='utf-8')

for tpl, out in [('style1.html', 'uklon-style'), ('style2.html', 'ontaxi-style')]:
    html = (src / tpl).read_text(encoding='utf-8')
    html = html.replace('/*__CSS__*/', css).replace('/*__JS__*/', js)
    (root / out).mkdir(exist_ok=True)
    (root / out / 'index.html').write_text(html, encoding='utf-8', newline='\n')
    print('OK', out + '/index.html', len(html), 'bytes')
