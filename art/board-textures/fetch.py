"""Fetch the CC0 Poly Haven bases (1k jpg: diffuse, GL normal, roughness) used by gen.py. Credits: CREDITS.md.
Usage: python fetch.py   (PH_DIR = download folder, default %TEMP%/ph)"""
import os, json, urllib.request
PH = os.environ.get("PH_DIR", os.path.join(os.environ.get("TEMP", "/tmp"), "ph"))
os.makedirs(PH, exist_ok=True); os.chdir(PH)
IDS = "aerial_sand red_sand gravelly_sand cracked_red_ground mud_cracked_dry_03 sandy_gravel_02 dry_ground_rocks rock_face red_laterite_soil_stones grass_path_3 leafy_grass brown_mud_dry".split()
for i in IDS:
    d = json.load(urllib.request.urlopen(urllib.request.Request(f"https://api.polyhaven.com/files/{i}", headers={'User-Agent': 'x'})))
    for k, n in (('Diffuse', 'diff'), ('nor_gl', 'nor'), ('Rough', 'rough')):
        r = d[k]['1k']['jpg']; p = f"{i}_{n}.jpg"
        if not os.path.exists(p): urllib.request.urlretrieve(r['url'], p)
    print(i, flush=True)
