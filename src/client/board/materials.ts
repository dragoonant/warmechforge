// Ground and cliff materials. The ground mat is sampled in WORLD x/z (one board-sized, de-tiled image), so neighbouring tiles
// never show a seam and the texture never visibly repeats; the cliff rock is sampled by the geometry's side uvs plus a per-tile
// offset so neighbouring cliff faces do not repeat each other.
import {
  Color, LinearMipmapLinearFilter, ShaderChunk, LinearFilter, MeshStandardMaterial, RepeatWrapping, SRGBColorSpace, TextureLoader, Vector3,
  type Texture, type WebGLProgramParametersWithUniforms,
} from 'three'
import type { BoardTheme, MatFiles } from './boards'
import { STRATA_BAND } from './tileGeometry'

export interface MatTextures { albedo: Texture; normal: Texture; rough: Texture }

const base = (): string => {
  const b = (import.meta as unknown as { env?: { BASE_URL?: string } }).env?.BASE_URL ?? '/'
  return `${b}assets/terrain/`
}
const cache = new Map<string, Promise<Texture>>()

function loadTex(path: string, srgb: boolean, anisotropy: number): Promise<Texture> {
  const key = `${path}|${srgb}|${anisotropy}`
  let p = cache.get(key)
  if (!p) {
    p = new TextureLoader().loadAsync(base() + path).then((t) => {
      t.wrapS = t.wrapT = RepeatWrapping
      t.colorSpace = srgb ? SRGBColorSpace : t.colorSpace
      t.anisotropy = anisotropy
      t.minFilter = LinearMipmapLinearFilter; t.magFilter = LinearFilter
      return t
    })
    cache.set(key, p)
  }
  return p
}

/** Load albedo + normal + roughness of one mat. Rejects when any file is missing (callers fall back to flat colour). */
export async function loadMat(files: MatFiles, anisotropy = 8): Promise<MatTextures> {
  const [albedo, normal, rough] = await Promise.all([loadTex(files.albedo, true, anisotropy), loadTex(files.normal, false, anisotropy), loadTex(files.rough, false, anisotropy)])
  return { albedo, normal, rough }
}

/** GLSL injected after project_vertex: world x/z -> mat uv for the ground. uMat = (origin x, origin z, 1 / mat size). */
export const GROUND_UV_GLSL = /* glsl */ `
#ifdef USE_INSTANCING
  vec4 wmP = modelMatrix * instanceMatrix * vec4( transformed, 1.0 );
#else
  vec4 wmP = modelMatrix * vec4( transformed, 1.0 );
#endif
  vec2 wmUv = vec2( ( wmP.x - uMat.x ) * uMat.z + 0.5, 0.5 - ( wmP.z - uMat.y ) * uMat.z );
#ifdef USE_MAP
  vMapUv = wmUv;
#endif
#ifdef USE_NORMALMAP
  vNormalMapUv = wmUv;
#endif
#ifdef USE_ROUGHNESSMAP
  vRoughnessMapUv = wmUv;
#endif
`

/** Close-up detail on the ground: strength of the second, higher-frequency sample (repeat, albedo ratio, normal). */
export const GROUND_DETAIL = { repeat: 7, albedo: 0.55, normal: 0.9 }
export const GROUND_DETAIL_GLSL = /* glsl */ `
#ifdef USE_MAP
  {
    vec2 duv = vMapUv * uDetail.x;
    vec3 dA = texture2D( map, duv ).rgb;
    vec3 dM = textureLod( map, duv, 9.0 ).rgb;
    diffuseColor.rgb *= mix( vec3( 1.0 ), clamp( dA / max( dM, vec3( 0.02 ) ), 0.45, 2.0 ), uDetail.y );
  }
#endif
`

/** GLSL injected after uv_vertex for the cliffs: shifts each tile's side uvs by a position hash. */
export const CLIFF_OFFSET_GLSL = /* glsl */ `
#ifdef USE_INSTANCING
  vec2 clO = vec2( instanceMatrix[3].x * 0.37 + instanceMatrix[3].z * 0.113, instanceMatrix[3].z * 0.29 );
  #ifdef USE_MAP
    vMapUv += clO;
  #endif
  #ifdef USE_NORMALMAP
    vNormalMapUv += clO;
  #endif
  #ifdef USE_ROUGHNESSMAP
    vRoughnessMapUv += clO;
  #endif
#endif
`

export const CLIFF_WORLD_Y_GLSL = /* glsl */ `
#ifdef USE_INSTANCING
  vWY = ( modelMatrix * instanceMatrix * vec4( transformed, 1.0 ) ).y;
#else
  vWY = ( modelMatrix * vec4( transformed, 1.0 ) ).y;
#endif
`

/** Layered strata: one colour band per STRATA_BAND of world height (the same on every tile, so layers run on across neighbours),
 *  darker toward the foot. The instance colour keeps only its brightness here (terrain tints belong to the tops). */
export const CLIFF_STRATA_GLSL = /* glsl */ `
#ifdef USE_COLOR
  diffuseColor.rgb *= vec3( dot( vColor, vec3( 0.3333 ) ) );
#endif
  {
    float bi = floor( vWY / uStrata.x );
    float h1 = fract( sin( bi * 12.9898 ) * 43758.5453 );
    float h2 = fract( sin( bi * 78.233 + 1.7 ) * 12543.1 );
    float plinth = smoothstep( uStrata.z - 0.12, uStrata.z, vWY );   // below the lowest visible ground the slab is a plain dark plinth
    float k = ( 0.72 + 0.34 * h1 ) * mix( 0.26, 1.0, plinth );
    diffuseColor.rgb *= k * vec3( 1.0 + 0.07 * ( h2 - 0.5 ), 1.0, 1.0 - 0.10 * ( h2 - 0.5 ) );
  }
`

export interface TileMaterials { top: MeshStandardMaterial; side: MeshStandardMaterial; dispose(): void }

export function makeTileMaterials(theme: BoardTheme, ground: MatTextures | null, cliff: MatTextures | null, origin: { x: number; z: number }, matSize: number, baseY: number, plinthY: number): TileMaterials {
  const top = new MeshStandardMaterial({
    color: ground ? new Color('#ffffff') : new Color(theme.fallback.ground), vertexColors: true, roughness: 1, metalness: 0,
    map: ground?.albedo ?? null, normalMap: ground?.normal ?? null, roughnessMap: ground?.rough ?? null,
  })
  const uMat = new Vector3(origin.x, origin.z, 1 / matSize)
  const uDetail = new Vector3(GROUND_DETAIL.repeat, GROUND_DETAIL.albedo, GROUND_DETAIL.normal)
  top.onBeforeCompile = (sh: WebGLProgramParametersWithUniforms) => {
    sh.uniforms.uMat = { value: uMat }
    sh.uniforms.uDetail = { value: uDetail }
    sh.vertexShader = 'uniform vec3 uMat;\n' + sh.vertexShader.replace('#include <project_vertex>', '#include <project_vertex>\n' + GROUND_UV_GLSL)
    if (ground) {
      // close-up detail: the same mat sampled again at a higher frequency, as a ratio to its own mean (so brightness is unchanged)
      const nfm = ShaderChunk.normal_fragment_maps.replace(
        'vec3 mapN = texture2D( normalMap, vNormalMapUv ).xyz * 2.0 - 1.0;',
        'vec3 mapN = texture2D( normalMap, vNormalMapUv ).xyz * 2.0 - 1.0;\n\tmapN.xy += ( texture2D( normalMap, vNormalMapUv * uDetail.x ).xy * 2.0 - 1.0 ) * uDetail.z;',
      )
      sh.fragmentShader = 'uniform vec3 uDetail;\n' + sh.fragmentShader
        .replace('#include <map_fragment>', '#include <map_fragment>\n' + GROUND_DETAIL_GLSL)
        .replace('#include <normal_fragment_maps>', nfm)
    }
  }
  top.customProgramCacheKey = () => 'wmf-ground'
  const side = new MeshStandardMaterial({
    color: cliff ? new Color('#ffffff') : new Color(theme.fallback.cliff), vertexColors: false, roughness: 1, metalness: 0,
    map: cliff?.albedo ?? null, normalMap: cliff?.normal ?? null, roughnessMap: cliff?.rough ?? null,
  })
  side.onBeforeCompile = (sh: WebGLProgramParametersWithUniforms) => {
    sh.vertexShader = sh.vertexShader.replace('#include <uv_vertex>', '#include <uv_vertex>\n' + CLIFF_OFFSET_GLSL)
  }
  side.customProgramCacheKey = () => 'wmf-cliff'
  return { top, side, dispose: () => { top.dispose(); side.dispose() } }
}
