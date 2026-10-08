// Texture atlases for the shop: invented game-box art, posters, flyers, paper, dice faces. ALL names, brands and art here are
// made up for this project; nothing imitates a real product. Layout maths is pure (node-testable); drawing needs a canvas.
import * as THREE from 'three'
import { rng, type Rect } from './builder'

// ------------------------------------------------------------------------------------------------ art atlas (boxes)
export const ART_W = 1024
export const ART_H = 1024
export const ART_COLS = 7
export const ART_ROWS = 6
export const ART_CELL_W = 146 // 7 * 146 = 1022
export const ART_CELL_H = 170 // 6 * 170 = 1020
/** Cell 0 is pure white (solid faces sample it); designs are cells 1..ART_DESIGNS. */
export const ART_DESIGNS = ART_COLS * ART_ROWS - 1
const SPINE_PX = 22

const px = (x0: number, y0: number, x1: number, y1: number, W: number, H: number, inset = 0.5): Rect => [
  (x0 + inset) / W, 1 - (y1 - inset) / H, (x1 - inset) / W, 1 - (y0 + inset) / H,
]
function cellOrigin(cell: number): [number, number] { return [(cell % ART_COLS) * ART_CELL_W, Math.floor(cell / ART_COLS) * ART_CELL_H] }
export function artWhite(): Rect { return px(2, 2, 6, 6, ART_W, ART_H, 0) }
export function artCover(cell: number): Rect {
  const [x, y] = cellOrigin(cell); return px(x + SPINE_PX + 2, y + 2, x + ART_CELL_W - 2, y + ART_CELL_H - 2, ART_W, ART_H)
}
export function artSpine(cell: number): Rect {
  const [x, y] = cellOrigin(cell); return px(x + 2, y + 2, x + SPINE_PX, y + ART_CELL_H - 2, ART_W, ART_H)
}

// ------------------------------------------------------------------------------------------------ paper atlas
export const PAPER_W = 1024
export const PAPER_H = 1024
export const POSTER_COUNT = 4
export const FLYER_COUNT = 16
export function posterRect(i: number): Rect { return px(i * 256 + 4, 2, i * 256 + 252, 330, PAPER_W, PAPER_H) }
export function flyerRect(i: number): Rect {
  const col = i % 8, row = Math.floor(i / 8)
  return px(col * 128 + 4, 340 + row * 172, col * 128 + 124, 340 + row * 172 + 166, PAPER_W, PAPER_H)
}
export const paperWhite = (): Rect => px(1000, 1000, 1010, 1010, PAPER_W, PAPER_H, 0)
export const gridPaperRect = (): Rect => px(4, 700, 252, 948, PAPER_W, PAPER_H)
/** Six die faces (1..6) in a 3x2 block starting at x=270. */
export function dieFaceRect(n: number): Rect {
  const i = n - 1, col = i % 3, row = Math.floor(i / 3)
  return px(270 + col * 128 + 6, 700 + row * 128 + 6, 270 + col * 128 + 122, 700 + row * 128 + 122, PAPER_W, PAPER_H)
}
export const canLabelRect = (): Rect => px(660, 700, 916, 828, PAPER_W, PAPER_H)
export const corkRect = (): Rect => px(660, 840, 916, 1000, PAPER_W, PAPER_H)
export const signRect = (): Rect => px(0, 958, 256, 1022, PAPER_W, PAPER_H)
export const binderLabelRect = (): Rect => px(270, 960, 520, 1010, PAPER_W, PAPER_H)

// ------------------------------------------------------------------------------------------------ invented names
const WORD_A = ['Cinder', 'Glimmer', 'Brass', 'Tide', 'Moss', 'Orrery', 'Lantern', 'Copper', 'Sparrow', 'Thistle', 'Hollow', 'Dusk', 'Ember',
  'Marrow', 'Fable', 'Quill', 'Saffron', 'Willow', 'Cobalt', 'Juniper', 'Pebble', 'Rustle', 'Gadget', 'Velvet']
const WORD_B = ['Hollow', 'Run', 'Guild', 'Fen', 'Gate', 'Heist', 'Harbour', 'Kingdoms', 'Parade', 'Ferry', 'Crossing', 'Rally', 'Orchard',
  'Tavern', 'Expedition', 'Spire', 'Garden', 'Express', 'Bazaar', 'Lanterns', 'Frontier', 'Clash', 'Cellar', 'Canyon']
const MAKERS = ['Wobbly Anvil Games', 'Thistle & Gear', 'Mapleshade Works', 'Odd Socks Studio', 'Lantern Moth Press', 'Pocket Comet Co.',
  'Brindle Forge', 'Tin Whistle Games', 'Marmot Mountain Toys', 'Paper Heron', 'Gristle & Pine', 'Quartz Kettle']
const TAGLINES = ['2-4 players', 'Ages 10+', '30 min', 'Co-op', 'Quick to learn', 'Paint it yourself', 'Starter set', 'Expansion', 'Family night', 'Solo mode']

export interface BoxArt { title: string; maker: string; tag: string }
export function boxArtInfo(cell: number): BoxArt {
  const r = rng(9000 + cell * 31)
  const a = WORD_A[Math.floor(r() * WORD_A.length)], b = WORD_B[Math.floor(r() * WORD_B.length)]
  return { title: `${a} ${b}`, maker: MAKERS[Math.floor(r() * MAKERS.length)], tag: TAGLINES[Math.floor(r() * TAGLINES.length)] }
}

export const POSTERS = [
  { head: 'FRIDAY NIGHT', big: 'LANCE LEAGUE', sub: 'Doors 6:30. Bring three painted figures and a friend.', c1: '#7a2e1f', c2: '#d9a441' },
  { head: 'SATURDAY', big: 'LEARN TO PLAY', sub: 'Free demo tables all afternoon. Snacks provided.', c1: '#1f4a5e', c2: '#e0b04a' },
  { head: 'PAINT & CHAT', big: 'TUESDAYS', sub: 'Bring a brush. We bring the coffee and the good lamps.', c1: '#3b5a2e', c2: '#e6d9a8' },
  { head: 'HOBBY SHOP', big: 'OPEN HOUSE', sub: 'Trade table, raffle, and a build-your-own terrain corner.', c1: '#4b2a5c', c2: '#f0c85a' },
]
export const FLYERS = [
  ['Trade & Swap', 'Sundays 2pm'], ['Terrain Workshop', 'Glue guns provided'], ['Campaign Weekend', 'Sign up at the till'], ["Kids' Game Hour", 'Wed 4pm'],
  ['Lost: blue d20', 'Please return'], ['Open Table Tuesday', 'Any game, any skill'], ['Painting Class', 'Beginners welcome'], ['Used Shelf Sale', 'Mystery boxes!'],
  ['Mini Contest', 'Best paint wins'], ['Rulebook Club', 'Fridays 7pm'], ['Roommate wanted', 'Must love dice'], ['Pizza Night', 'Thursdays'],
  ['Board Game Café', 'Meet-up'], ['Tournament', 'Sat 10am sharp'], ['Gift cards', 'Ask at the till'], ['Play-test wanted', 'Free snacks'],
]

// ------------------------------------------------------------------------------------------------ drawing (DOM)
type Ctx = CanvasRenderingContext2D
const FONT = "'Trebuchet MS', 'Segoe UI', Verdana, sans-serif"
function makeCanvas(w: number, h: number): HTMLCanvasElement {
  const c = document.createElement('canvas'); c.width = w; c.height = h; return c
}
function hsl(h: number, s: number, l: number): string { return `hsl(${Math.round(h)} ${Math.round(s)}% ${Math.round(l)}%)` }
function wrap(ctx: Ctx, text: string, x: number, y: number, maxW: number, lineH: number): number {
  const words = text.split(' '); let line = ''; let yy = y
  for (const w of words) {
    const t = line ? `${line} ${w}` : w
    if (ctx.measureText(t).width > maxW && line) { ctx.fillText(line, x, yy); line = w; yy += lineH } else line = t
  }
  if (line) { ctx.fillText(line, x, yy); yy += lineH }
  return yy
}

function drawEmblem(ctx: Ctx, kind: number, cx: number, cy: number, s: number, fg: string, bg: string, r: () => void | number): void {
  void r
  ctx.save(); ctx.translate(cx, cy); ctx.fillStyle = fg; ctx.strokeStyle = fg; ctx.lineWidth = Math.max(2, s * 0.06)
  switch (kind % 8) {
    case 0: // sun over mountains
      ctx.beginPath(); ctx.arc(0, -s * 0.2, s * 0.32, 0, Math.PI * 2); ctx.fill()
      ctx.fillStyle = bg; ctx.beginPath(); ctx.moveTo(-s * 0.9, s * 0.6); ctx.lineTo(-s * 0.3, -s * 0.1); ctx.lineTo(s * 0.1, s * 0.4); ctx.lineTo(s * 0.5, -s * 0.2); ctx.lineTo(s * 0.9, s * 0.6); ctx.closePath(); ctx.fill()
      ctx.strokeStyle = fg; ctx.stroke(); break
    case 1: // ringed planet
      ctx.beginPath(); ctx.arc(0, 0, s * 0.42, 0, Math.PI * 2); ctx.fill()
      ctx.beginPath(); ctx.ellipse(0, 0, s * 0.85, s * 0.2, -0.4, 0, Math.PI * 2); ctx.strokeStyle = bg; ctx.lineWidth = s * 0.12; ctx.stroke()
      ctx.strokeStyle = fg; ctx.lineWidth = s * 0.05; ctx.stroke(); break
    case 2: // hex cluster
      for (const [dx, dy] of [[0, 0], [0.7, 0.4], [-0.7, 0.4], [0, 0.8], [0.7, -0.4], [-0.7, -0.4], [0, -0.8]]) {
        ctx.beginPath()
        for (let i = 0; i < 6; i++) { const a = (i / 6) * Math.PI * 2; ctx.lineTo(dx * s * 0.62 + Math.cos(a) * s * 0.34, dy * s * 0.62 + Math.sin(a) * s * 0.34) }
        ctx.closePath(); if ((dx + dy * 3) % 2 === 0) ctx.fill(); else ctx.stroke()
      }
      break
    case 3: // castle
      ctx.fillRect(-s * 0.5, -s * 0.1, s, s * 0.7); ctx.fillRect(-s * 0.7, -s * 0.4, s * 0.3, s * 1.0); ctx.fillRect(s * 0.4, -s * 0.4, s * 0.3, s * 1.0)
      ctx.fillStyle = bg; ctx.fillRect(-s * 0.12, s * 0.2, s * 0.24, s * 0.4); break
    case 4: // dice
      ctx.save(); ctx.rotate(-0.3); ctx.fillRect(-s * 0.4, -s * 0.4, s * 0.8, s * 0.8); ctx.fillStyle = bg
      for (const [dx, dy] of [[-0.2, -0.2], [0.2, 0.2], [0, 0], [-0.2, 0.2], [0.2, -0.2]]) { ctx.beginPath(); ctx.arc(dx * s, dy * s, s * 0.07, 0, Math.PI * 2); ctx.fill() }
      ctx.restore(); break
    case 5: // tree
      ctx.beginPath(); ctx.moveTo(0, -s * 0.8); ctx.lineTo(s * 0.5, -s * 0.1); ctx.lineTo(s * 0.25, -s * 0.1); ctx.lineTo(s * 0.6, s * 0.35); ctx.lineTo(-s * 0.6, s * 0.35); ctx.lineTo(-s * 0.25, -s * 0.1); ctx.lineTo(-s * 0.5, -s * 0.1); ctx.closePath(); ctx.fill()
      ctx.fillRect(-s * 0.07, s * 0.35, s * 0.14, s * 0.35); break
    case 6: // blocky robot head (generic, nothing licensed)
      ctx.fillRect(-s * 0.45, -s * 0.4, s * 0.9, s * 0.8); ctx.fillStyle = bg; ctx.fillRect(-s * 0.3, -s * 0.15, s * 0.22, s * 0.16); ctx.fillRect(s * 0.08, -s * 0.15, s * 0.22, s * 0.16)
      ctx.fillRect(-s * 0.25, s * 0.18, s * 0.5, s * 0.07); ctx.fillStyle = fg; ctx.fillRect(-s * 0.04, -s * 0.7, s * 0.08, s * 0.3); break
    default: // waves
      for (let i = 0; i < 3; i++) { ctx.beginPath(); for (let x = -s; x <= s; x += s / 8) ctx.lineTo(x, -s * 0.3 + i * s * 0.3 + Math.sin(x / s * 6) * s * 0.1); ctx.stroke() }
  }
  ctx.restore()
}

function drawBoxCell(ctx: Ctx, cell: number): void {
  const [ox, oy] = cellOrigin(cell)
  const r = rng(4000 + cell * 77)
  const info = boxArtInfo(cell)
  const hue = r() * 360
  const dark = hsl(hue, 35 + r() * 22, 20 + r() * 8)
  const mid = hsl(hue + (r() - 0.5) * 40, 42 + r() * 24, 40 + r() * 12)
  const light = hsl(hue + 25, 70, 78)
  const W = ART_CELL_W - 4, H = ART_CELL_H - 4
  ctx.save(); ctx.translate(ox + 2, oy + 2)
  // spine
  ctx.fillStyle = dark; ctx.fillRect(0, 0, SPINE_PX - 2, H)
  ctx.save(); ctx.translate((SPINE_PX - 2) / 2, H - 4); ctx.rotate(-Math.PI / 2); ctx.fillStyle = light; ctx.font = `bold 12px ${FONT}`; ctx.textAlign = 'left'; ctx.textBaseline = 'middle'
  ctx.fillText(info.title.toUpperCase(), 0, 0); ctx.restore()
  // cover
  const cx0 = SPINE_PX, cw = W - SPINE_PX
  const g = ctx.createLinearGradient(0, 0, 0, H); g.addColorStop(0, mid); g.addColorStop(1, dark)
  ctx.fillStyle = g; ctx.fillRect(cx0, 0, cw, H)
  if (r() < 0.5) { ctx.fillStyle = hsl(hue + 180, 50, 60); ctx.globalAlpha = 0.25; for (let i = 0; i < 6; i++) ctx.fillRect(cx0, H * 0.35 + i * 5, cw, 2); ctx.globalAlpha = 1 }
  drawEmblem(ctx, Math.floor(r() * 8), cx0 + cw / 2, H * 0.4, cw * 0.28, light, dark, r)
  ctx.fillStyle = 'rgba(0,0,0,0.35)'; ctx.fillRect(cx0, H * 0.67, cw, H * 0.2)
  ctx.fillStyle = '#fff6df'; ctx.font = `bold 14px ${FONT}`; ctx.textAlign = 'center'; ctx.textBaseline = 'alphabetic'
  wrap(ctx, info.title, cx0 + cw / 2, H * 0.67 + 15, cw - 8, 15)
  ctx.font = `10px ${FONT}`; ctx.fillStyle = light; ctx.fillText(info.tag, cx0 + cw / 2, H * 0.87 + 12)
  ctx.fillStyle = '#111'; ctx.fillRect(cx0, H - 17, cw, 17); ctx.fillStyle = '#e8d9a0'; ctx.font = `bold 8px ${FONT}`; ctx.fillText(info.maker, cx0 + cw / 2, H - 6)
  ctx.restore()
}

export function drawArtAtlas(): HTMLCanvasElement {
  const c = makeCanvas(ART_W, ART_H); const ctx = c.getContext('2d')!
  ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, ART_W, ART_H)
  for (let i = 1; i <= ART_DESIGNS; i++) drawBoxCell(ctx, i)
  return c
}

function drawPoster(ctx: Ctx, i: number): void {
  const p = POSTERS[i]; const x = i * 256 + 4, w = 248, h = 328
  const g = ctx.createLinearGradient(0, 2, 0, h); g.addColorStop(0, p.c1); g.addColorStop(1, '#16181c')
  ctx.fillStyle = g; ctx.fillRect(x, 2, w, h)
  ctx.strokeStyle = p.c2; ctx.lineWidth = 4; ctx.strokeRect(x + 8, 10, w - 16, h - 16)
  ctx.textAlign = 'center'; ctx.fillStyle = p.c2; ctx.font = `bold 20px ${FONT}`; ctx.fillText(p.head, x + w / 2, 50)
  ctx.fillStyle = '#fff4d6'; ctx.font = `bold 34px ${FONT}`
  const words = p.big.split(' '); words.forEach((wd, k) => ctx.fillText(wd, x + w / 2, 100 + k * 40))
  drawEmblem(ctx, 2 + i * 3, x + w / 2, 205, 50, p.c2, p.c1, () => 0)
  ctx.fillStyle = '#f2ead2'; ctx.font = `15px ${FONT}`; wrap(ctx, p.sub, x + w / 2, 268, w - 40, 18)
}
function drawFlyer(ctx: Ctx, i: number): void {
  const col = i % 8, row = Math.floor(i / 8); const x = col * 128 + 4, y = 340 + row * 172 + 0, w = 120, h = 166
  const r = rng(700 + i * 13); const hue = r() * 360
  ctx.fillStyle = ['#fff7c9', '#ffd9d0', '#d3f0e4', '#d8e4ff', '#fbe4ff', '#ffffff'][i % 6]; ctx.fillRect(x, y, w, h)
  ctx.fillStyle = hsl(hue, 60, 40); ctx.fillRect(x, y, w, 36)
  ctx.textAlign = 'center'; ctx.fillStyle = '#fff'; ctx.font = `bold 13px ${FONT}`; wrap(ctx, FLYERS[i][0], x + w / 2, y + 16, w - 10, 14)
  ctx.fillStyle = '#222'; ctx.font = `11px ${FONT}`; wrap(ctx, FLYERS[i][1], x + w / 2, y + 62, w - 14, 14)
  drawEmblem(ctx, i, x + w / 2, y + 112, 22, hsl(hue, 55, 38), '#fff', () => 0)
  ctx.fillStyle = '#555'; for (let k = 0; k < 5; k++) ctx.fillRect(x + 12 + k * 20, y + h - 14, 12, 8) // tear-off tabs
}
function drawDie(ctx: Ctx, n: number): void {
  const i = n - 1, col = i % 3, row = Math.floor(i / 3); const x = 270 + col * 128, y = 700 + row * 128
  ctx.fillStyle = '#f4efe2'; ctx.fillRect(x, y, 128, 128)
  ctx.strokeStyle = '#cfc6b0'; ctx.lineWidth = 3; ctx.strokeRect(x + 3, y + 3, 122, 122)
  const pos: Record<number, number[][]> = {
    1: [[0.5, 0.5]], 2: [[0.28, 0.28], [0.72, 0.72]], 3: [[0.28, 0.28], [0.5, 0.5], [0.72, 0.72]],
    4: [[0.28, 0.28], [0.72, 0.28], [0.28, 0.72], [0.72, 0.72]], 5: [[0.28, 0.28], [0.72, 0.28], [0.5, 0.5], [0.28, 0.72], [0.72, 0.72]],
    6: [[0.28, 0.25], [0.72, 0.25], [0.28, 0.5], [0.72, 0.5], [0.28, 0.75], [0.72, 0.75]],
  }
  ctx.fillStyle = n === 1 ? '#c0392b' : '#1a1a1a'
  for (const [u, v] of pos[n]) { ctx.beginPath(); ctx.arc(x + u * 128, y + v * 128, n === 1 ? 17 : 12, 0, Math.PI * 2); ctx.fill() }
}

export function drawPaperAtlas(): HTMLCanvasElement {
  const c = makeCanvas(PAPER_W, PAPER_H); const ctx = c.getContext('2d')!
  ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, PAPER_W, PAPER_H)
  for (let i = 0; i < POSTER_COUNT; i++) drawPoster(ctx, i)
  for (let i = 0; i < FLYER_COUNT; i++) drawFlyer(ctx, i)
  // grid paper (blank sheet, our own layout: just a plain grid)
  ctx.fillStyle = '#fbfaf3'; ctx.fillRect(0, 696, 256, 256)
  ctx.strokeStyle = '#b9cbd8'; ctx.lineWidth = 1
  for (let k = 0; k <= 256; k += 16) { ctx.beginPath(); ctx.moveTo(k, 696); ctx.lineTo(k, 952); ctx.stroke(); ctx.beginPath(); ctx.moveTo(0, 696 + k); ctx.lineTo(256, 696 + k); ctx.stroke() }
  for (let n = 1; n <= 6; n++) drawDie(ctx, n)
  // soda can label: made-up drink
  const g = ctx.createLinearGradient(660, 0, 916, 0); g.addColorStop(0, '#b03a2a'); g.addColorStop(0.5, '#e8644a'); g.addColorStop(1, '#b03a2a')
  ctx.fillStyle = g; ctx.fillRect(660, 700, 256, 128)
  ctx.fillStyle = '#fff3c4'; ctx.textAlign = 'center'; ctx.font = `bold 38px ${FONT}`; ctx.fillText('FIZZWHISTLE', 788, 758)
  ctx.font = `bold 20px ${FONT}`; ctx.fillText('orange pop', 788, 790)
  ctx.fillRect(660, 806, 256, 6)
  // cork
  ctx.fillStyle = '#b9895a'; ctx.fillRect(660, 840, 256, 160)
  const cr = rng(5); for (let k = 0; k < 900; k++) { ctx.fillStyle = cr() < 0.5 ? 'rgba(90,55,25,0.35)' : 'rgba(230,190,140,0.35)'; ctx.fillRect(660 + cr() * 254, 840 + cr() * 158, 2 + cr() * 3, 2 + cr() * 3) }
  // shop sign: an invented shop name
  ctx.fillStyle = '#1d1a16'; ctx.fillRect(0, 958, 256, 64); ctx.strokeStyle = '#c9a227'; ctx.lineWidth = 3; ctx.strokeRect(4, 962, 248, 56)
  ctx.fillStyle = '#e8c35a'; ctx.textAlign = 'center'; ctx.font = `bold 26px ${FONT}`; ctx.fillText('THE CROOKED DIE', 128, 992)
  ctx.fillStyle = '#d9cfae'; ctx.font = `12px ${FONT}`; ctx.fillText('games  -  minis  -  paint  -  snacks', 128, 1010)
  // binder label
  ctx.fillStyle = '#efe6cf'; ctx.fillRect(270, 960, 250, 50); ctx.fillStyle = '#222'; ctx.font = `bold 26px ${FONT}`; ctx.textAlign = 'center'; ctx.fillText('Club Notes', 395, 996)
  return c
}

// ------------------------------------------------------------------------------------------------ tiling surfaces
export function drawPlanks(): HTMLCanvasElement {
  const c = makeCanvas(512, 512); const ctx = c.getContext('2d')!; const r = rng(31)
  const rows = 8, rh = 512 / rows
  for (let i = 0; i < rows; i++) {
    let x = -r() * 200
    while (x < 512) {
      const len = 170 + r() * 200; const l = 34 + r() * 10, h = 24 + r() * 8
      ctx.fillStyle = hsl(h, 42, l); ctx.fillRect(x, i * rh, len, rh)
      for (let k = 0; k < 7; k++) { ctx.fillStyle = `rgba(60,35,15,${0.05 + r() * 0.08})`; ctx.fillRect(x, i * rh + r() * rh, len, 1 + r() * 1.5) }
      ctx.fillStyle = 'rgba(30,18,8,0.55)'; ctx.fillRect(x, i * rh, len, 1.5); ctx.fillRect(x, i * rh, 1.5, rh)
      x += len
    }
  }
  return c
}
export function drawTableWood(): HTMLCanvasElement {
  const c = makeCanvas(512, 256); const ctx = c.getContext('2d')!; const r = rng(77)
  ctx.fillStyle = '#9a6a3c'; ctx.fillRect(0, 0, 512, 256)
  const slats = 6, sh = 256 / slats
  for (let i = 0; i < slats; i++) {
    ctx.fillStyle = hsl(28 + r() * 6, 48 + r() * 8, 38 + r() * 6); ctx.fillRect(0, i * sh, 512, sh)
    for (let k = 0; k < 26; k++) { ctx.fillStyle = `rgba(70,40,18,${0.06 + r() * 0.1})`; ctx.fillRect(0, i * sh + r() * sh, 512, 0.8 + r()) }
    ctx.fillStyle = 'rgba(40,22,8,0.6)'; ctx.fillRect(0, i * sh, 512, 1.5)
  }
  return c
}
export function drawMat(): HTMLCanvasElement {
  const c = makeCanvas(256, 256); const ctx = c.getContext('2d')!; const r = rng(12)
  ctx.fillStyle = '#26332f'; ctx.fillRect(0, 0, 256, 256)
  for (let k = 0; k < 2500; k++) { const v = r(); ctx.fillStyle = v < 0.5 ? 'rgba(255,255,255,0.035)' : 'rgba(0,0,0,0.06)'; ctx.fillRect(r() * 256, r() * 256, 1 + r() * 2, 1 + r() * 2) }
  return c
}

export function toTexture(canvas: HTMLCanvasElement, opts: { repeat?: [number, number]; aniso?: number } = {}): THREE.CanvasTexture {
  const t = new THREE.CanvasTexture(canvas)
  t.colorSpace = THREE.SRGBColorSpace
  t.anisotropy = opts.aniso ?? 4
  if (opts.repeat) { t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(opts.repeat[0], opts.repeat[1]) }
  t.needsUpdate = true
  return t
}
