"""Собирает два самодостаточных приложения (index.html + файлы PWA):  python _src/build.py

style1.html (зелёный, как OnTaxi)  -> ontaxi-style/
style2.html (жёлтый, как Uklon)    -> uklon-style/
"""
import json
from pathlib import Path

from PIL import Image, ImageDraw

src = Path(__file__).parent
root = src.parent
css = (src / 'common.css').read_text(encoding='utf-8')
js = (src / 'common.js').read_text(encoding='utf-8')
sw = (src / 'sw.js').read_text(encoding='utf-8')

APPS = [
    # шаблон, папка, название, фон иконки, цвет знака, theme/background
    ('style1.html', 'ontaxi-style', 'Рух', '#1DB954', '#FFFFFF', '#ffffff'),
    ('style2.html', 'uklon-style', 'Сонях', '#FFE033', '#1D1D1F', '#ffffff'),
]


def make_icon(size, bg, fg):
    """Иконка без логотипов: фон + пин такси."""
    im = Image.new('RGB', (size, size), bg)
    d = ImageDraw.Draw(im)
    s = size / 100
    cx = 50 * s
    d.ellipse([cx - 22 * s, 18 * s, cx + 22 * s, 62 * s], fill=fg)            # голова пина
    d.polygon([(cx - 17 * s, 50 * s), (cx + 17 * s, 50 * s), (cx, 82 * s)], fill=fg)  # остриё
    d.ellipse([cx - 8 * s, 32 * s, cx + 8 * s, 48 * s], fill=bg)               # точка
    return im


for tpl, out, name, bg, fg, theme in APPS:
    html = (src / tpl).read_text(encoding='utf-8')
    html = html.replace('/*__CSS__*/', css).replace('/*__JS__*/', js)
    d = root / out
    d.mkdir(exist_ok=True)
    (d / 'index.html').write_text(html, encoding='utf-8', newline='\n')
    (d / 'sw.js').write_text(sw.replace('__CACHE__', out + '-v9'), encoding='utf-8', newline='\n')
    for px in (180, 192, 512):
        make_icon(px, bg, fg).save(d / f'icon-{px}.png')
    manifest = {
        'name': f'{name} — такси', 'short_name': name, 'lang': 'ru',
        'start_url': './', 'scope': './', 'display': 'standalone', 'orientation': 'portrait',
        'background_color': theme, 'theme_color': theme,
        'icons': [{'src': f'icon-{px}.png', 'sizes': f'{px}x{px}', 'type': 'image/png', 'purpose': 'any'} for px in (192, 512)],
    }
    (d / 'manifest.webmanifest').write_text(json.dumps(manifest, ensure_ascii=False, indent=2), encoding='utf-8')
    print('OK', out, len(html), 'bytes')
