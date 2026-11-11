import { useTexture } from "@react-three/drei";
import { useFrame, useThree } from "@react-three/fiber";
import { useEffect, useLayoutEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import { earthEpochs, earthScene, moonScene, sunScene } from "../core";
import { ephemerisSunScene } from "../core/ephemeris/sunLight";
import type { NaifId } from "../core/ephemeris/state";
import type { Mat3 } from "../core";
import type { SceneClock } from "./types";

/**
 * Equirectangular day and night maps. The date line is at the edges and
 * Greenwich is at the center, so local +X is the prime meridian before the
 * EME2000 rotation is applied.
 */
const EARTH_DAY = "/textures/earth-day.jpg";
const EARTH_CLOUD = "/textures/earth-cloud-day.jpg";
const EARTH_NIGHT = "/textures/earth-night.jpg";
const MOON_COLOR = "/textures/moon.jpg";
useTexture.preload(EARTH_DAY);
useTexture.preload(EARTH_CLOUD);
useTexture.preload(EARTH_NIGHT);
useTexture.preload(MOON_COLOR);

/** Atmosphere shell. Wide enough to fade, close enough to stay on the limb. */
const AIR_SCALE = 1.045;

const BODY_COLOR = new THREE.Color("#3a3a3c");
/** Night side stays faintly visible so the shadowed hemisphere still reads as a globe. */
const NIGHT = 0.04;

const VERT = /* glsl */ `
#include <common>
#include <logdepthbuf_pars_vertex>
varying vec2 vUv;
varying vec3 vNormalW;
void main() {
  vUv = uv;
  vNormalW = normalize(mat3(modelMatrix) * normal);
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  #include <logdepthbuf_vertex>
}
`;

const FRAG = /* glsl */ `
#include <logdepthbuf_pars_fragment>
uniform sampler2D map;
uniform float useMap;
uniform vec3 baseColor;
uniform vec3 sunDirection;
varying vec2 vUv;
varying vec3 vNormalW;
void main() {
  vec3 albedo = baseColor;
  if (useMap > 0.5) {
    albedo = sRGBTransferEOTF(vec4(texture2D(map, vUv).rgb, 1.0)).rgb;
  }
  float mu = dot(normalize(vNormalW), normalize(sunDirection));
  float lit = clamp(mu, 0.0, 1.0);
  float dusk = smoothstep(-0.06, 0.02, mu);
  vec3 color = albedo * mix(${NIGHT.toFixed(2)}, 1.0, lit * dusk);
  gl_FragColor = vec4(color, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
  #include <logdepthbuf_fragment>
}
`;

const EARTH_VERT = /* glsl */ `
#include <common>
#include <logdepthbuf_pars_vertex>
varying vec2 vUv;
varying vec3 vNormalW;
varying vec3 vWorld;
void main() {
  vUv = uv;
  vec4 world = modelMatrix * vec4(position, 1.0);
  vWorld = world.xyz;
  vNormalW = normalize(mat3(modelMatrix) * normal);
  gl_Position = projectionMatrix * viewMatrix * world;
  #include <logdepthbuf_vertex>
}
`;

const EARTH_FRAG = /* glsl */ `
#include <logdepthbuf_pars_fragment>
uniform sampler2D dayMap;
uniform sampler2D nightMap;
uniform vec3 sunDirection;
varying vec2 vUv;
varying vec3 vNormalW;
varying vec3 vWorld;
void main() {
  vec3 day = sRGBTransferEOTF(vec4(texture2D(dayMap, vUv).rgb, 1.0)).rgb;
  vec3 night = sRGBTransferEOTF(vec4(texture2D(nightMap, vUv).rgb, 1.0)).rgb;
  vec3 n = normalize(vNormalW);
  vec3 sun = normalize(sunDirection);
  float mu = dot(n, sun);
  float daylight = smoothstep(-0.1, 0.2, mu);
  vec3 color = mix(night, day * clamp(mu, 0.0, 1.0), daylight);
  vec3 viewDir = normalize(cameraPosition - vWorld);
  float rim = pow(1.0 - clamp(dot(n, viewDir), 0.0, 1.0), 1.7);
  color += vec3(0.2, 0.45, 1.0) * rim * 0.28 * (0.4 + 0.6 * clamp(mu, 0.0, 1.0));
  gl_FragColor = vec4(color, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
  #include <logdepthbuf_fragment>
}
`;

const AIR_VERT = /* glsl */ `
#include <common>
#include <logdepthbuf_pars_vertex>
varying vec3 vViewPos;
varying vec3 vNormalW;
void main() {
  vec4 view = modelViewMatrix * vec4(position, 1.0);
  vViewPos = view.xyz;
  vNormalW = normalize(mat3(modelMatrix) * normal);
  gl_Position = projectionMatrix * view;
  #include <logdepthbuf_vertex>
}
`;

const AIR_FRAG = /* glsl */ `
#include <logdepthbuf_pars_fragment>
uniform vec3 sunDirection;
uniform vec3 bodyCenter;
uniform float innerRadius;
uniform float outerRadius;
varying vec3 vViewPos;
varying vec3 vNormalW;
void main() {
  vec3 dir = normalize(vViewPos);
  vec3 center = (viewMatrix * vec4(bodyCenter, 1.0)).xyz;
  float along = dot(center, dir);
  float dist = sqrt(max(dot(center, center) - along * along, 0.0));
  float span = max(outerRadius - innerRadius, 1.0);
  float h = clamp((dist - innerRadius) / span, 0.0, 1.0);
  float glow = exp(-h * h * 4.5) * (1.0 - smoothstep(0.35, 1.0, h));
  float sunLit = clamp(dot(normalize(vNormalW), normalize(sunDirection)), 0.0, 1.0);
  vec3 color = vec3(0.15, 0.4, 1.0) * glow * (0.5 + 0.65 * sunLit);
  gl_FragColor = vec4(color, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
  #include <logdepthbuf_fragment>
}
`;

type BodyProps = {
  radiusKm: number;
  clock: { current: SceneClock };
  /** NAIF id of this body, when the planetary snapshot can light it. */
  bodyId?: NaifId;
};

function litMaterial(map: THREE.Texture, textured: boolean): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: {
      map: { value: map },
      useMap: { value: textured ? 1 : 0 },
      baseColor: { value: BODY_COLOR },
      sunDirection: { value: new THREE.Vector3(1, 0, 0) },
    },
    vertexShader: VERT,
    fragmentShader: FRAG,
  });
}

function LitSphere({
  radiusKm,
  clock,
  bodyId,
  map,
  axes,
  textured,
}: BodyProps & { map: THREE.Texture; axes: ((jdTt: number) => Mat3) | null; textured: boolean }) {
  const mesh = useRef<THREE.Mesh>(null);
  const geometry = useMemo(() => new THREE.SphereGeometry(radiusKm, 96, 64), [radiusKm]);
  const material = useMemo(() => litMaterial(map, textured), [map, textured]);
  useEffect(
    () => () => {
      geometry.dispose();
      material.dispose();
    },
    [geometry, material],
  );

  useFrame(() => {
    const origin = clock.current.file?.origin ?? null;
    const sun = material.uniforms.sunDirection.value as THREE.Vector3;
    const body = mesh.current;
    if (!origin) {
      sun.set(1, 0, 0);
      if (axes && body) {
        body.matrix.identity();
        body.matrixAutoUpdate = true;
      }
      return;
    }
    const { jdTt } = earthEpochs(origin, clock.current.t);
    const placed = bodyId == null ? null : ephemerisSunScene(bodyId, origin, clock.current.t);
    const direction = placed ?? sunScene(jdTt);
    sun.set(direction[0], direction[1], direction[2]);
    if (!axes || !body) return;
    const rows = axes(jdTt);
    body.matrix.set(
      rows[0], rows[1], rows[2], 0,
      rows[3], rows[4], rows[5], 0,
      rows[6], rows[7], rows[8], 0,
      0, 0, 0, 1,
    );
    body.matrixAutoUpdate = false;
    body.matrixWorldNeedsUpdate = true;
  });

  return <mesh ref={mesh} geometry={geometry} material={material} />;
}

/** Sun-lit sphere. The night side is the Earth's shadow, from the EME2000 Sun. */
export function LitBody(props: BodyProps) {
  const blank = useMemo(() => {
    const texture = new THREE.DataTexture(new Uint8Array([255, 255, 255, 255]), 1, 1);
    texture.colorSpace = THREE.NoColorSpace;
    texture.needsUpdate = true;
    return texture;
  }, []);
  useEffect(() => () => blank.dispose(), [blank]);
  return <LitSphere {...props} map={blank} axes={null} textured={false} />;
}

/**
 * CGI Moon Kit color map (NASA SVS), centered on 0° longitude.
 * The crust is turned by the IAU pole and prime meridian. The terminator
 * uses the geocentric Sun, which differs from the selenocentric Sun by
 * a fraction of a degree.
 */
export function MoonBody(props: BodyProps) {
  const map = useTexture(MOON_COLOR);
  const gl = useThree((state) => state.gl);
  useLayoutEffect(() => {
    configureMap(map, gl);
  }, [gl, map]);
  return <LitSphere {...props} bodyId={props.bodyId ?? 301} map={map} axes={moonScene} textured />;
}

function configureMap(map: THREE.Texture, gl: THREE.WebGLRenderer) {
  map.colorSpace = THREE.NoColorSpace;
  map.anisotropy = gl.capabilities.getMaxAnisotropy();
  map.needsUpdate = true;
}

/** Day and night maps, rotated into EME2000, with a light-blue atmospheric rim. */
export function EarthBody({ radiusKm, clock, clouds }: BodyProps & { clouds: boolean }) {
  const maps = useTexture([EARTH_DAY, EARTH_CLOUD, EARTH_NIGHT]);
  const clear = maps[0];
  const cloudy = maps[1];
  const night = maps[2];
  const day = clouds ? cloudy : clear;
  const gl = useThree((state) => state.gl);
  const mesh = useRef<THREE.Mesh>(null);
  const ground = useMemo(() => new THREE.SphereGeometry(radiusKm, 96, 64), [radiusKm]);
  const air = useMemo(() => new THREE.SphereGeometry(radiusKm * AIR_SCALE, 96, 64), [radiusKm]);
  const surface = useMemo(
    () =>
      new THREE.ShaderMaterial({
        uniforms: {
          dayMap: { value: day },
          nightMap: { value: night },
          sunDirection: { value: new THREE.Vector3(1, 0, 0) },
        },
        vertexShader: EARTH_VERT,
        fragmentShader: EARTH_FRAG,
      }),
    [day, night],
  );
  const atmosphere = useMemo(
    () =>
      new THREE.ShaderMaterial({
        uniforms: {
          sunDirection: { value: new THREE.Vector3(1, 0, 0) },
          bodyCenter: { value: new THREE.Vector3() },
          innerRadius: { value: radiusKm },
          outerRadius: { value: radiusKm * AIR_SCALE },
        },
        vertexShader: AIR_VERT,
        fragmentShader: AIR_FRAG,
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        side: THREE.BackSide,
      }),
    [radiusKm],
  );
  useLayoutEffect(() => {
    configureMap(clear, gl);
    configureMap(cloudy, gl);
    configureMap(night, gl);
  }, [clear, cloudy, gl, night]);
  useEffect(
    () => () => {
      ground.dispose();
      air.dispose();
      surface.dispose();
      atmosphere.dispose();
    },
    [air, atmosphere, ground, surface],
  );

  useFrame(() => {
    const sun = surface.uniforms.sunDirection.value as THREE.Vector3;
    const airSun = atmosphere.uniforms.sunDirection.value as THREE.Vector3;
    const body = mesh.current;
    const origin = clock.current.file?.origin ?? null;
    if (!origin) {
      sun.set(1, 0, 0);
      airSun.copy(sun);
      if (body) {
        body.matrix.identity();
        body.matrixAutoUpdate = true;
      }
      return;
    }
    const { jdUt1, jdTt } = earthEpochs(origin, clock.current.t);
    const placed = ephemerisSunScene(399, origin, clock.current.t);
    const direction = placed ?? sunScene(jdTt);
    sun.set(direction[0], direction[1], direction[2]);
    airSun.copy(sun);
    if (!body) return;
    body.updateWorldMatrix(true, false);
    (atmosphere.uniforms.bodyCenter.value as THREE.Vector3).setFromMatrixPosition(body.matrixWorld);
    const rows = earthScene(jdUt1, jdTt);
    body.matrix.set(
      rows[0], rows[1], rows[2], 0,
      rows[3], rows[4], rows[5], 0,
      rows[6], rows[7], rows[8], 0,
      0, 0, 0, 1,
    );
    body.matrixAutoUpdate = false;
    body.matrixWorldNeedsUpdate = true;
  });

  return (
    <>
      <mesh ref={mesh} geometry={ground} material={surface} />
      <mesh geometry={air} material={atmosphere} renderOrder={1} raycast={() => null} />
    </>
  );
}

/** White solar disk. The lens flare supplies the glare, so the disk does not occlude it. */
export function SunBody({ radiusKm }: { radiusKm: number }) {
  const core = useMemo(() => new THREE.SphereGeometry(radiusKm, 64, 48), [radiusKm]);
  const surface = useMemo(() => new THREE.MeshBasicMaterial({ color: "#ffffff", toneMapped: false }), []);
  useEffect(
    () => () => {
      core.dispose();
      surface.dispose();
    },
    [core, surface],
  );
  return <mesh geometry={core} material={surface} userData={{ lensflare: "no-occlusion" }} />;
}
