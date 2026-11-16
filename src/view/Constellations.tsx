import { useFrame, useThree } from "@react-three/fiber";
import { useEffect, useMemo, useRef, useState } from "react";
import type { RefObject } from "react";
import * as THREE from "three";
import { starScene } from "../core";
import { SKY_RADIUS } from "./Stars";

/** Right ascension and declination, degrees, J2000. */
type SkyPoint = [number, number];

type Figure = {
  id: string;
  name: string;
  /** Where the IAU name is drawn. */
  at: SkyPoint;
  /** Stick-figure polylines. Each inner list is one unbroken line. */
  lines: SkyPoint[][];
};

type Packed = {
  constellations: Figure[];
};

const FIGURES_URL = "/constellations.json";

let catalog: Promise<Figure[]> | null = null;

function loadFigures(): Promise<Figure[]> {
  catalog ??= fetch(FIGURES_URL)
    .then((response) => {
      if (!response.ok) throw new Error(String(response.status));
      return response.json() as Promise<Packed>;
    })
    .then((data) => data.constellations)
    .catch((error: unknown) => {
      catalog = null;
      throw error;
    });
  return catalog;
}

loadFigures().catch(() => undefined);

const VERT = /* glsl */ `
void main() {
  vec4 world = modelMatrix * vec4(position, 1.0);
  gl_Position = projectionMatrix * viewMatrix * world;
}
`;

const FRAG = /* glsl */ `
#include <common>
void main() {
  vec3 rgb = sRGBTransferEOTF(vec4(0.8, 0.8, 0.82, 1.0)).rgb;
  gl_FragColor = vec4(rgb, 0.55);
  gl_FragDepth = 1.0;
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`;

function lineGeometry(figures: Figure[]): THREE.BufferGeometry {
  let count = 0;
  for (const figure of figures) {
    for (const segment of figure.lines) count += Math.max(0, segment.length - 1);
  }
  const positions = new Float32Array(count * 6);
  let offset = 0;
  for (const figure of figures) {
    for (const segment of figure.lines) {
      for (let index = 0; index < segment.length - 1; index += 1) {
        const start = starScene(segment[index][0], segment[index][1]);
        const end = starScene(segment[index + 1][0], segment[index + 1][1]);
        for (const point of [start, end]) {
          positions[offset] = point[0] * SKY_RADIUS;
          positions[offset + 1] = point[1] * SKY_RADIUS;
          positions[offset + 2] = point[2] * SKY_RADIUS;
          offset += 3;
        }
      }
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  return geometry;
}

function placeName(
  el: HTMLSpanElement,
  world: THREE.Vector3,
  camera: THREE.Camera,
  size: { width: number; height: number },
  pixelRatio: number,
  scratch: THREE.Vector3,
  forward: THREE.Vector3,
) {
  const ahead = scratch.copy(world).sub(camera.position).dot(camera.getWorldDirection(forward)) > 0;
  scratch.copy(world).project(camera);
  if (!ahead) {
    el.style.visibility = "hidden";
    return;
  }
  const pixel = Math.max(pixelRatio, 1);
  const x = Math.round((scratch.x * 0.5 + 0.5) * size.width * pixel) / pixel;
  const y = Math.round(((-scratch.y * 0.5 + 0.5) * size.height) * pixel) / pixel;
  el.style.visibility = "visible";
  el.style.transform = `translate3d(${x}px, ${y}px, 0) translate(-50%, calc(-100% - 8px))`;
}

/**
 * IAU constellation figures and names from d3-celestial.
 * The lines sit on the same sky sphere as the stars and stay behind every body.
 */
export function Constellations({ labelRoot }: { labelRoot: RefObject<HTMLDivElement | null> }) {
  const lines = useRef<THREE.LineSegments>(null);
  const spans = useRef<HTMLSpanElement[]>([]);
  const gl = useThree((state) => state.gl);
  const [figures, setFigures] = useState<Figure[] | null>(null);
  const geometry = useMemo(() => (figures ? lineGeometry(figures) : null), [figures]);
  const directions = useMemo(
    () =>
      (figures ?? []).map((figure) => {
        const [x, y, z] = starScene(figure.at[0], figure.at[1]);
        return new THREE.Vector3(x, y, z);
      }),
    [figures],
  );
  const material = useMemo(
    () =>
      new THREE.ShaderMaterial({
        vertexShader: VERT,
        fragmentShader: FRAG,
        transparent: true,
        depthWrite: false,
        toneMapped: false,
      }),
    [],
  );
  const world = useMemo(() => new THREE.Vector3(), []);
  const scratch = useMemo(() => new THREE.Vector3(), []);
  const forward = useMemo(() => new THREE.Vector3(), []);

  useEffect(() => {
    let live = true;
    loadFigures()
      .then((loaded) => {
        if (live) setFigures(loaded);
      })
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, []);

  useEffect(() => {
    const root = labelRoot.current;
    if (!root || !figures) return;
    root.replaceChildren();
    spans.current = figures.map((figure) => {
      const el = document.createElement("span");
      el.className = "scene-label constellation-name";
      el.textContent = figure.name;
      root.appendChild(el);
      return el;
    });
    return () => {
      root.replaceChildren();
      spans.current = [];
    };
  }, [figures, labelRoot]);

  useEffect(() => () => geometry?.dispose(), [geometry]);
  useEffect(() => () => material.dispose(), [material]);

  useFrame(({ camera, size }) => {
    lines.current?.position.copy(camera.position);
    const nodes = spans.current;
    if (nodes.length === 0) return;
    camera.updateMatrixWorld();
    const pixelRatio = gl.getPixelRatio();
    for (let index = 0; index < nodes.length; index += 1) {
      const el = nodes[index];
      const direction = directions[index];
      if (!el || !direction) continue;
      world.copy(camera.position).addScaledVector(direction, SKY_RADIUS);
      placeName(el, world, camera, size, pixelRatio, scratch, forward);
    }
  });

  if (!geometry) return null;
  return (
    <lineSegments
      ref={lines}
      geometry={geometry}
      material={material}
      frustumCulled={false}
      renderOrder={-1}
      raycast={() => null}
    />
  );
}
