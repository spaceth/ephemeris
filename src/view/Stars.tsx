import { useFrame, useThree } from "@react-three/fiber";
import { useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import { starColor, starPointSize, starScene } from "../core";

/** Right ascension degrees, declination degrees, magnitude, B−V. */
type SkyStar = [number, number, number, number | null];

const SKY_URL = "/skymap.json";
/** Inside the near end of the far plane, and far behind any body in view. */
const SKY_RADIUS = 1e6;

let catalog: Promise<SkyStar[]> | null = null;

function loadCatalog(): Promise<SkyStar[]> {
  catalog ??= fetch(SKY_URL)
    .then((response) => {
      if (!response.ok) throw new Error(String(response.status));
      return response.json() as Promise<{ stars: SkyStar[] }>;
    })
    .then((data) => data.stars)
    .catch((error: unknown) => {
      catalog = null;
      throw error;
    });
  return catalog;
}

loadCatalog().catch(() => undefined);

const VERT = /* glsl */ `
attribute float size;
attribute vec3 color;
varying vec3 vColor;
uniform float pixelRatio;
void main() {
  vColor = color;
  vec4 world = modelMatrix * vec4(position, 1.0);
  gl_Position = projectionMatrix * viewMatrix * world;
  gl_PointSize = size * pixelRatio;
}
`;

const FRAG = /* glsl */ `
#include <common>
varying vec3 vColor;
void main() {
  float dist = length(gl_PointCoord - vec2(0.5)) * 2.0;
  float disc = smoothstep(1.0, 0.2, dist);
  if (disc < 0.03) discard;
  vec3 rgb = sRGBTransferEOTF(vec4(vColor, 1.0)).rgb;
  gl_FragColor = vec4(rgb * disc, disc);
  gl_FragDepth = 1.0;
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`;

function skyGeometry(stars: SkyStar[]): THREE.BufferGeometry {
  const positions = new Float32Array(stars.length * 3);
  const colors = new Float32Array(stars.length * 3);
  const sizes = new Float32Array(stars.length);
  stars.forEach((star, index) => {
    const [ra, dec, mag, bv] = star;
    const [x, y, z] = starScene(ra, dec);
    positions[index * 3] = x * SKY_RADIUS;
    positions[index * 3 + 1] = y * SKY_RADIUS;
    positions[index * 3 + 2] = z * SKY_RADIUS;
    const [r, g, b] = starColor(bv);
    colors[index * 3] = r;
    colors[index * 3 + 1] = g;
    colors[index * 3 + 2] = b;
    sizes[index] = starPointSize(mag);
  });
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute("color", new THREE.BufferAttribute(colors, 3));
  geometry.setAttribute("size", new THREE.BufferAttribute(sizes, 1));
  return geometry;
}

/** XHIP stars, fixed in EME2000, drawn behind every body. */
export function StarField() {
  const points = useRef<THREE.Points>(null);
  const gl = useThree((state) => state.gl);
  const [stars, setStars] = useState<SkyStar[] | null>(null);
  const geometry = useMemo(() => (stars ? skyGeometry(stars) : null), [stars]);
  const material = useMemo(
    () =>
      new THREE.ShaderMaterial({
        uniforms: { pixelRatio: { value: 1 } },
        vertexShader: VERT,
        fragmentShader: FRAG,
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        toneMapped: false,
      }),
    [],
  );

  useEffect(() => {
    let live = true;
    loadCatalog()
      .then((loaded) => {
        if (live) setStars(loaded);
      })
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, []);
  useEffect(() => () => geometry?.dispose(), [geometry]);
  useEffect(() => () => material.dispose(), [material]);
  useFrame(({ camera }) => {
    material.uniforms.pixelRatio.value = gl.getPixelRatio();
    points.current?.position.copy(camera.position);
  });

  if (!geometry) return null;
  return (
    <points
      ref={points}
      geometry={geometry}
      material={material}
      renderOrder={-1}
      frustumCulled={false}
      raycast={() => null}
    />
  );
}
