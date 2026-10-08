#!/usr/bin/env python3
"""WarMechForge ground mats and cliff rock. Deterministic. Poly Haven CC0 bases (fetch.py), de-tiled and scarred with FFT-noise
features (helpers adapted from our sibling game Whirr Machine). Run fetch.py first.
Usage: python gen.py [desert grasslands cliff-desert cliff-grasslands]
Bases are read from PH_DIR (default %TEMP%/ph). Output: public/assets/terrain/boards/<theme>/{albedo,normal,rough}.jpg"""
import sys, os, io, numpy as np
from scipy import ndimage as ndi
from scipy.spatial import cKDTree
from PIL import Image, ImageFile
ImageFile.MAXBLOCK = 1 << 26

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, '..', '..'))
OUT = os.path.join(ROOT, 'public', 'assets', 'terrain', 'boards')
PH = os.environ.get('PH_DIR', os.path.join(os.environ.get('TEMP', '/tmp'), 'ph'))
N = 2048
YY, XX = np.mgrid[0:N, 0:N].astype(np.float32)
FX = np.fft.fftfreq(N)[None, :].astype(np.float32)
FY = np.fft.fftfreq(N)[:, None].astype(np.float32)
FR = np.sqrt(FX**2 + FY**2); FR[0, 0] = 1


def ss(a, b, x):
    t = np.clip((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t)


def norm(n):
    n = n - n.mean(); return (n / (n.std() + 1e-9)).astype(np.float32)


def fbm(seed, period=200, p=1.6):
    spec = np.fft.fft2(np.random.default_rng(seed).standard_normal((N, N)).astype(np.float32))
    amp = FR ** -p * (1 / (1 + (1.0 / period / FR) ** 4)); amp[0, 0] = 0
    return norm(np.fft.ifft2(spec * amp).real)


def blobs(seed, period, thresh, soft=0.35):
    return ss(thresh - soft, thresh + soft, fbm(seed, period * 1.7, 3.2))


def gblur(a, s): return ndi.gaussian_filter(a, s)


def load(name):
    d = lambda k: np.asarray(Image.open(os.path.join(PH, f'{name}_{k}.jpg')).convert('RGB'), np.float32) / 255
    return d('diff'), d('nor'), d('rough')[..., 0]


def shrink(a, m):
    """Resize a 0..1 float image (H, W[, C]) to m x m with Lanczos (prefilter before fine tiling)."""
    if a.ndim == 2: return shrink(a[..., None].repeat(3, -1), m)[..., 0]
    return np.asarray(Image.fromarray((np.clip(a, 0, 1) * 255 + 0.5).astype(np.uint8)).resize((m, m), Image.LANCZOS), np.float32) / 255


def layer(name, seed, scale=1.0, warpamp=45):
    """Sample a tiling base at two scales (noise-masked) through a domain warp so no tile repeat shows.
    scale = photo tiles across the board: a 2 m photo should read as tabletop grit, not giant leaves (M8 QC),
    so boards tile each base 3-7 times, prefiltered (Lanczos) to avoid aliasing."""
    full = load(name)
    out = []
    for i, s in enumerate((scale, scale * 1.37)):
        m = max(64, int(round(N / s)))
        diff, nor, rough = (shrink(a, m) for a in full) if m < N else full
        rng = np.random.default_rng(seed + i)
        oy, ox = rng.uniform(0, m, 2)
        wx = fbm(seed + 20 + i, 260, 2.0) * warpamp; wy = fbm(seed + 30 + i, 260, 2.0) * warpamp
        c = [((YY + wy) * (s * m / N) + oy) % m, ((XX + wx) * (s * m / N) + ox) % m]
        smp = lambda a: ndi.map_coordinates(a, c, order=1, mode='grid-wrap')
        out.append((np.stack([smp(diff[..., k]) for k in range(3)], -1),
                    np.stack([smp(nor[..., k]) for k in range(2)], -1) - 0.5, smp(rough)))
    m = blobs(seed + 50, 380, 0.0, 0.6)
    D = out[0][0] * (1 - m[..., None]) + out[1][0] * m[..., None]
    Nn = out[0][1] * (1 - m[..., None]) + out[1][1] * m[..., None]
    R = out[0][2] * (1 - m) + out[1][2] * m
    lum = D.mean(-1); low = gblur(lum, 120)
    D = D * (lum.mean() / (low + 1e-3))[..., None] ** 0.6   # flatten big colour blotches of the photo
    return np.clip(D, 0, 1), Nn, R


def soften(D, k):
    """Pull a layer's local contrast toward its own mean by k (0 = unchanged), so a tiled photo reads as texture, not spots."""
    m = D.mean((0, 1), keepdims=True); return m + (D - m) * (1 - k)


def tint(D, mul, sat=1.0, gain=1.0):
    g = D.mean(-1, keepdims=True); D = g + (D - g) * sat
    return np.clip(D * np.array(mul, np.float32) * gain, 0, 1)


def mix(a, b, m):
    if a.ndim == 3 and m.ndim == 2: m = m[..., None]
    return a * (1 - m) + b * m


def col(r, g, b): return np.array([r, g, b], np.float32)


def ramp(t, stops):
    t = np.clip(t, 0, 1); xs = [s[0] for s in stops]
    return np.stack([np.interp(t, xs, [s[1][c] for s in stops]) for c in range(3)], -1).astype(np.float32) / 255


def voronoi_edges(seed, n, warp=0.0, wper=150):
    pts = np.random.default_rng(seed).uniform(0, N, (n, 2))
    qx, qy = XX, YY
    if warp: qx = XX + fbm(seed + 1, wper, 2.0) * warp; qy = YY + fbm(seed + 2, wper, 2.0) * warp
    d, _ = cKDTree(pts).query(np.stack([qx.ravel(), qy.ravel()], 1), k=2, workers=-1)
    return (d[:, 1] - d[:, 0]).reshape(N, N).astype(np.float32)


def track(seed, y0, amp, n_wig=1.0, tilt=0.0):
    """Perpendicular distance (px) to a wandering line crossing the board left to right."""
    cy = y0 + amp * np.sin(XX / N * 2 * np.pi * n_wig + seed) + 90 * fbm(seed, 500, 2.2) + tilt * (XX - N / 2)
    dy = np.gradient(cy, axis=1)
    return (YY - cy) / np.sqrt(1 + dy ** 2)


def save(a, path, limit=880, gray=False):
    im = Image.fromarray((np.clip(a, 0, 1) * 255 + 0.5).astype(np.uint8))
    if gray: im = im.convert('L')
    for q in (92, 88, 84, 80, 76, 72, 68, 62, 56, 50, 44):
        b = io.BytesIO(); im.save(b, 'JPEG', quality=q, optimize=True, subsampling=0 if q > 85 else 2)
        if b.tell() <= limit * 1000: break
    open(path, 'wb').write(b.getvalue()); print(path, b.tell() // 1000, 'KB q', q, flush=True)


def finish(alb, Nn, rough, h, strength, name, vig=0.10, nblur=1.0):
    r = np.hypot(XX / N - .5, YY / N - .5) * 2
    alb = alb * (1 - vig * ss(0.55, 1.35, r))[..., None]
    # height gradient scaled so its 95th-percentile tilt is about strength/120 (M8 QC: the raw gradient * strength
    # laid the normals almost flat, nz ~0.2, which drew the mats as dark camouflage blotches)
    gx = np.gradient(h, axis=1); gy = np.gradient(h, axis=0)
    k = (strength / 120) / (np.percentile(np.hypot(gx, gy), 95) + 1e-6)
    nx = 1.4 * Nn[..., 0] - gx * k
    ny = 1.4 * Nn[..., 1] + gy * k   # image y runs down, OpenGL +Y up
    nx = gblur(nx, nblur); ny = gblur(ny, nblur)
    nz = np.sqrt(np.clip(1 - nx ** 2 - ny ** 2, 0.05, 1))
    n3 = np.stack([nx, ny, nz], -1); n3 /= np.linalg.norm(n3, axis=-1, keepdims=True)
    d = os.path.join(OUT, name); os.makedirs(d, exist_ok=True)
    save(alb, os.path.join(d, 'albedo.jpg')); save(n3 * 0.5 + 0.5, os.path.join(d, 'normal.jpg'), 900)
    save(np.clip(rough, 0, 1), os.path.join(d, 'rough.jpg'), 800, gray=True)
    return alb


def speckle(seed, p, blur):
    return gblur((np.random.default_rng(seed).random((N, N)) > 1 - p).astype(np.float32), blur)


def streaks(seed, sx, sy):
    return norm(ndi.gaussian_filter(np.random.default_rng(seed).standard_normal((N, N)).astype(np.float32), (sy, sx)))


# ---------------------------------------------------------------- themes
# The mat covers a square patch of the table (about 24 world units); tile prisms sample it by world x/z.
def desert():
    s = 100
    A = layer('dry_ground_rocks', s, 3.2); B = layer('gravelly_sand', s + 100, 3.6)
    C = layer('mud_cracked_dry_03', s + 200, 2.6); P = layer('sandy_gravel_02', s + 300, 4.2)
    sm = lambda seed, per, a, b: ss(a, b, fbm(seed, per, 2.4))   # smooth, wide-edged masks: no camouflage blotches
    patch = sm(s + 3, 320, -0.9, 0.9)
    D = mix(tint(soften(A[0], 0.30), (1.04, 0.95, 0.84), 0.85, 1.10), tint(soften(B[0], 0.25), (1.06, 0.97, 0.84), 0.9, 1.10), patch)
    Nn = mix(A[1], B[1], patch[..., None]); R = mix(A[2], B[2], patch)
    crk = sm(s + 4, 380, 0.5, 1.9) * 0.85
    D = mix(D, tint(soften(C[0], 0.35), (0.92, 0.80, 0.66), 0.7, 0.88), crk * 0.8)
    Nn = mix(Nn, C[1], crk[..., None]); R = mix(R, C[2], crk)
    peb = sm(s + 5, 240, 0.4, 1.8) * 0.8
    D = mix(D, tint(soften(P[0], 0.25), (1.02, 0.90, 0.76), 0.7, 0.98), peb * 0.7)
    Nn = mix(Nn, P[1], peb[..., None])
    dust = fbm(s + 6, 420, 2.4)
    D = np.clip(D * (1 + 0.07 * dust[..., None] * np.array([1.0, 0.85, 0.6], np.float32)), 0, 1)
    rip = streaks(s + 8, 70, 3.0) * sm(s + 9, 200, -0.2, 1.4) * 0.5
    h = gblur(fbm(s + 10, 90, 2.0), 3) * 0.5 + rip * 0.12
    st = ss(0.04, 0.2, speckle(s, 0.0016, 1.6))
    D = mix(D, col(0.40, 0.32, 0.25), st * 0.4); h = h + st * 0.5
    D = np.clip(tint(soften(D, 0.15), (1.0, 1.0, 1.0), 0.80, 1.14), 0, 1)
    return finish(D, Nn, R, h, 50, 'desert', 0.06)


def grasslands():
    s = 200
    A = layer('grass_path_3', s, 4.5); B = layer('leafy_grass', s + 100, 5.0); M = layer('brown_mud_dry', s + 200, 3.5)
    patch = ss(-0.9, 0.9, fbm(s + 3, 300, 2.4))
    D = mix(tint(soften(A[0], 0.15), (0.86, 0.98, 0.7), 1.0, 0.95), tint(soften(B[0], 0.2), (0.85, 0.98, 0.72), 0.95, 0.9), patch)
    Nn = mix(A[1], B[1], patch[..., None]); R = mix(A[2], B[2], patch)
    dirt = ss(0.5, 1.9, fbm(s + 4, 300, 2.4))
    D = mix(D, tint(soften(M[0], 0.2), (0.95, 0.82, 0.68), 0.9, 0.95), dirt * 0.8)
    Nn = mix(Nn, M[1], dirt[..., None] * 0.8); R = mix(R, M[2], dirt)
    D = np.clip(D * (1 + 0.10 * fbm(s + 6, 400, 2.3)[..., None]), 0, 1)
    h = gblur(fbm(s + 10, 90, 2.0), 3) * 0.5
    D = np.clip(soften(D, 0.25), 0, 1)
    return finish(D, Nn, R, h, 45, 'grasslands', 0.08)


def cliff(name, base, mul, seed, sat=0.45):
    """Layered cliff rock for the terrace sides: a rock photo, irregular horizontal strata, faint vertical weathering. 1024 px, tiles."""
    global N, YY, XX, FX, FY, FR
    n0 = N
    N = 1024
    YY, XX = np.mgrid[0:N, 0:N].astype(np.float32)
    FX = np.fft.fftfreq(N)[None, :].astype(np.float32); FY = np.fft.fftfreq(N)[:, None].astype(np.float32)
    FR = np.sqrt(FX**2 + FY**2); FR[0, 0] = 1
    try:
        A = layer(base, seed, 2.0, warpamp=6)
        D = tint(soften(A[0], 0.05), mul, sat, 1.55)
        rng = np.random.default_rng(seed + 4)
        # irregular strata: smooth random 1-D profile in image rows (rows = height on the cliff), warped across columns
        prof = norm(ndi.gaussian_filter1d(rng.standard_normal(N).astype(np.float32), 9, mode='wrap')) * 0.7              + norm(ndi.gaussian_filter1d(rng.standard_normal(N).astype(np.float32), 3, mode='wrap')) * 0.3
        wav = fbm(seed + 3, 200, 2.0) * 9
        rows = np.clip((YY + wav).astype(np.int32) % N, 0, N - 1)
        band = prof[rows]
        D = np.clip(D * (1 + 0.22 * band[..., None] * np.array([1.0, 0.9, 0.75], np.float32)), 0, 1)
        wt = ss(0.6, 2.2, streaks(seed + 5, 1.2, 40)) * 0.10
        D = D * (1 - wt)[..., None]
        h = band * 0.35 + 0.5 * fbm(seed + 6, 30, 1.6)
        Nn = A[1]; R = np.clip(A[2] * 0.4 + 0.62, 0, 1)
        finish(D, Nn, R, h, 70, name, 0.0, 0.8)
    finally:
        N = n0
        YY, XX = np.mgrid[0:N, 0:N].astype(np.float32)
        FX = np.fft.fftfreq(N)[None, :].astype(np.float32); FY = np.fft.fftfreq(N)[:, None].astype(np.float32)
        FR = np.sqrt(FX**2 + FY**2); FR[0, 0] = 1


def cliff_desert(): cliff('cliff-desert', 'rock_face', (1.22, 1.0, 0.80), 700, 0.38)
def cliff_grasslands(): cliff('cliff-grasslands', 'rock_face', (0.95, 0.93, 0.88), 800)


BOARDS = {'desert': desert, 'grasslands': grasslands, 'cliff-desert': cliff_desert, 'cliff-grasslands': cliff_grasslands}
if __name__ == '__main__':
    for b in (sys.argv[1:] or BOARDS):
        print('==', b, flush=True); BOARDS[b]()
