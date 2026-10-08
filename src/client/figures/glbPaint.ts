// Army painter for the baked-texture GLBs (30-figures section 7). A fragment-shader hue-band remap: texels whose hue is
// within +-BAND_DEG of one of the sculpt's two source paint hues are shifted to the force colour, keeping their own
// shading; low-saturation texels (metal, black, grey) are left alone. Materials are cloned per (source material, paint,
// grey) and cached, never per figure; the loader's shared cache is never mutated. Copied from Whirr Machine and adapted:
// the Core Box sculpts are olive drab with tan accents, so the source bands are fixed here instead of per faction.
import { Color, Mesh, type Material, type MeshStandardMaterial, type Object3D } from 'three'
import { paintKey, type ArmyPaint, type ResolvedPaint } from './paintStore'

export const BAND_DEG = 22
export const MIN_SAT = 0.18
/** Dominant paint hues of the generated figures (degrees): olive drab, then the tan / khaki accents. */
export const SOURCE_HUES: readonly [number, number] = [78, 38]
export const SOURCE_BANDS: readonly [{ sat: number; val: number }, { sat: number; val: number }] = [{ sat: 0.42, val: 0.5 }, { sat: 0.45, val: 0.4 }]

export type Hsv = [number, number, number]
/** Hex -> HSV with h in 0..1, in three's linear working space (the space the shader sees after texture decode). */
export function hsvOf(hex: string): Hsv {
  const c = new Color(hex)
  const mx = Math.max(c.r, c.g, c.b), mn = Math.min(c.r, c.g, c.b), d = mx - mn
  let h = 0
  if (d > 1e-6) {
    if (mx === c.r) h = (((c.g - c.b) / d) % 6 + 6) % 6
    else if (mx === c.g) h = (c.b - c.r) / d + 2
    else h = (c.r - c.g) / d + 4
    h /= 6
  }
  return [h, mx > 0 ? d / mx : 0, mx]
}

const GLSL_FUNCS = /* glsl */ `
uniform vec3 uSrc0; uniform vec3 uTgt0; uniform vec3 uSrc1; uniform vec3 uTgt1; uniform vec2 uOn; uniform float uBand; uniform float uGrey;
vec3 wmRgb2Hsv(vec3 c){ vec4 K=vec4(0.,-1./3.,2./3.,-1.); vec4 p=mix(vec4(c.bg,K.wz),vec4(c.gb,K.xy),step(c.b,c.g)); vec4 q=mix(vec4(p.xyw,c.r),vec4(c.r,p.yzx),step(p.x,c.r)); float d=q.x-min(q.w,q.y); float e=1e-10; return vec3(abs(q.z+(q.w-q.y)/(6.*d+e)), d/(q.x+e), q.x); }
vec3 wmHsv2Rgb(vec3 c){ vec4 K=vec4(1.,2./3.,1./3.,3.); vec3 p=abs(fract(c.xxx+K.xyz)*6.-K.www); return c.z*mix(K.xxx,clamp(p-K.xxx,0.,1.),c.y); }
`
const GLSL_REMAP = /* glsl */ `
#include <map_fragment>
{
  vec3 pc = wmRgb2Hsv(diffuseColor.rgb);
  if (pc.y > ${MIN_SAT.toFixed(2)} && pc.z > 0.02) {
    float d0 = pc.x - uSrc0.x; d0 = abs(d0 - floor(d0 + 0.5));
    float d1 = pc.x - uSrc1.x; d1 = abs(d1 - floor(d1 + 0.5));
    float w0 = uOn.x * (1. - smoothstep(uBand * 0.6, uBand, d0));
    float w1 = uOn.y * (1. - smoothstep(uBand * 0.6, uBand, d1));
    vec3 src = uSrc0; vec3 tgt = uTgt0; float w = w0; float dh = pc.x - uSrc0.x;
    if (w1 > w0) { src = uSrc1; tgt = uTgt1; w = w1; dh = pc.x - uSrc1.x; }
    if (w > 0.) {
      dh = dh - floor(dh + 0.5);
      vec3 o = vec3(fract(tgt.x + dh * 0.5), clamp(pc.y * min(tgt.y / max(src.y, 0.25), 4.), 0., 1.), clamp(pc.z * min(tgt.z / max(src.z, 0.08), 4.), 0., 1.));
      diffuseColor.rgb = mix(diffuseColor.rgb, wmHsv2Rgb(o), w);
    }
  }
  if (uGrey > 0.) {
    float l = dot(diffuseColor.rgb, vec3(0.299, 0.587, 0.114));
    diffuseColor.rgb = mix(diffuseColor.rgb, vec3(l * 0.7), uGrey);
  }
}
`

const variants = new Map<string, Material>()
/** Number of cached material variants (tests). */
export const variantCount = (): number => variants.size

const v3 = (a?: Hsv | [number, number, number]) => ({ value: { x: a?.[0] ?? 0, y: a?.[1] ?? 0, z: a?.[2] ?? 0 } })

/** The painted / greyed variant of `src` for this paint (cached); `src` itself when nothing changes. */
export function variantMaterial(src: Material, paint: ArmyPaint | ResolvedPaint | undefined, grey: boolean): Material {
  const pk = paintKey(paint)
  if (!pk && !grey) return src
  const key = `${src.uuid}|${pk}|${grey ? 'g' : ''}`
  const hit = variants.get(key)
  if (hit) return hit
  const pairs = [paint?.primary, paint?.secondary].map((target, i) => (target ? { src: [SOURCE_HUES[i]! / 360, SOURCE_BANDS[i]!.sat, SOURCE_BANDS[i]!.val] as Hsv, tgt: hsvOf(target) } : null))
  const uniforms = {
    uSrc0: v3(pairs[0]?.src), uTgt0: v3(pairs[0]?.tgt), uSrc1: v3(pairs[1]?.src), uTgt1: v3(pairs[1]?.tgt),
    uOn: { value: { x: pairs[0] ? 1 : 0, y: pairs[1] ? 1 : 0 } }, uBand: { value: BAND_DEG / 360 }, uGrey: { value: grey ? 0.85 : 0 },
  }
  const m = src.clone() as MeshStandardMaterial
  m.name = `${src.name || 'mat'}:paint:${pk || '-'}${grey ? ':grey' : ''}`
  m.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms)
    shader.fragmentShader = GLSL_FUNCS + shader.fragmentShader.replace('#include <map_fragment>', GLSL_REMAP)
  }
  m.customProgramCacheKey = () => 'wmf-army-paint-v1'
  variants.set(key, m)
  return m
}

/** Is this mesh the GLB's own base disc? (the GLB has a node named "base" with the base_black material.) */
export const isBaseMesh = (mesh: Mesh): boolean => {
  const first = Array.isArray(mesh.material) ? mesh.material[0] : mesh.material
  let p: Object3D | null = mesh
  while (p) { if (p.name === 'base') return true; p = p.parent }
  return first?.name === 'base_black'
}

/** Per-figure copy of a (painted) material: keeps the paint shader hook so the compiled program is shared. */
export function ownMaterial(m: Material): Material {
  const c = m.clone()
  c.onBeforeCompile = m.onBeforeCompile
  c.customProgramCacheKey = m.customProgramCacheKey
  return c
}
