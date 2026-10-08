"""Contact sheet of the generated mats (albedo) -> preview.png. Usage: python preview.py [theme ...]"""
import os, sys
from PIL import Image
B = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '..', 'public', 'assets', 'terrain', 'boards')
names = sys.argv[1:] or ['desert', 'cliff-desert', 'grasslands', 'cliff-grasslands']
names = [n for n in names if os.path.exists(os.path.join(B, n, 'albedo.jpg'))]
S = 480
im = Image.new('RGB', (S * len(names) + 8 * (len(names) + 1), S + 16), (20, 20, 20))
for i, n in enumerate(names):
    im.paste(Image.open(os.path.join(B, n, 'albedo.jpg')).convert('RGB').resize((S, S), Image.LANCZOS), (8 + i * (S + 8), 8))
im.save(os.path.join(os.path.dirname(os.path.abspath(__file__)), 'preview.png'), optimize=True)
