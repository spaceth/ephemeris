import { useEffect, useMemo, useRef, useState } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import { Line2 } from "three/addons/lines/Line2.js";
import { LineGeometry } from "three/addons/lines/LineGeometry.js";
import { LineMaterial } from "three/addons/lines/LineMaterial.js";
import { toScene } from "../core/scene";
import { centerNaif, place } from "../core/ephemeris/place";
import { loadPlanetarySnapshot } from "../core/ephemeris/planetary";
import type { SpkKernel } from "../core/ephemeris/resolve";
import { tdbFromTaiClock } from "../core/ephemeris/scales";
import { orbitTrackSpecs, sampleOrbit } from "./orbitTrack";
import type { OrbitTrackSpec, OrbitToggles } from "./orbitTrack";
import type { SceneClock } from "./types";

/** One framebuffer pixel. Orbit rings stay a hairline; the object path keeps its own width. */
const ORBIT_WIDTH_PX = 1;
const WHITE = "#ffffff";

function sceneMeters(meters: Float32Array): Float32Array {
  const out = new Float32Array(meters.length);
  for (let index = 0; index < meters.length; index += 3) {
    const [x, y, z] = toScene(meters[index], meters[index + 1], meters[index + 2]);
    out[index] = x;
    out[index + 1] = y;
    out[index + 2] = z;
  }
  return out;
}

function WhiteLine({ positions }: { positions: Float32Array }) {
  const line = useMemo(() => {
    const geometry = new LineGeometry();
    geometry.setPositions(positions);
    const material = new LineMaterial({
      color: WHITE,
      transparent: true,
      opacity: 1,
      depthWrite: false,
      toneMapped: false,
    });
    material.uniforms.linewidth.value = ORBIT_WIDTH_PX;
    const next = new Line2(geometry, material);
    next.frustumCulled = false;
    return next;
  }, [positions]);
  useEffect(() => () => {
    line.geometry.dispose();
    line.material.dispose();
  }, [line]);
  return <primitive object={line} />;
}

/** The ring stays on the anchor's current position. Vertices are relative to that body. */
function AnchoredOrbit({
  spec,
  kernel,
  clock,
  centerName,
}: {
  spec: OrbitTrackSpec;
  kernel: SpkKernel;
  clock: { current: SceneClock };
  centerName: string | null;
}) {
  const group = useRef<THREE.Group>(null);
  const [positions, setPositions] = useState<Float32Array | null>(null);
  useEffect(() => {
    const origin = clock.current.file?.origin ?? null;
    if (!origin) {
      setPositions(null);
      return;
    }
    const et = tdbFromTaiClock(origin, clock.current.t).secondsPastJ2000;
    const meters = sampleOrbit(spec.bodyId, spec.anchorId, spec.periodDays, et, [kernel]);
    setPositions(meters ? sceneMeters(meters) : null);
  }, [clock, kernel, spec.anchorId, spec.bodyId, spec.periodDays]);
  useFrame(() => {
    const node = group.current;
    if (!node) return;
    const origin = clock.current.file?.origin ?? null;
    const center = centerNaif(centerName);
    if (!origin || center == null) {
      node.visible = false;
      return;
    }
    const et = tdbFromTaiClock(origin, clock.current.t).secondsPastJ2000;
    const placed = place(spec.anchorId, center, [kernel], et);
    if (!placed.ok) {
      node.visible = false;
      return;
    }
    const [x, y, z] = toScene(placed.positionM[0], placed.positionM[1], placed.positionM[2]);
    node.position.set(x, y, z);
    node.visible = true;
  });
  if (!positions) return null;
  return (
    <group ref={group} visible={false}>
      <WhiteLine positions={positions} />
    </group>
  );
}

/** White orbit rings for the pills that are on. */
export function OrbitLines({
  orbits,
  clock,
  centerName,
}: {
  orbits: OrbitToggles;
  clock: { current: SceneClock };
  centerName: string | null;
}) {
  const [kernel, setKernel] = useState<SpkKernel | null>(null);
  const specs = useMemo(() => orbitTrackSpecs(orbits), [orbits]);
  useEffect(() => {
    let live = true;
    void loadPlanetarySnapshot().then((loaded) => {
      if (live) setKernel(loaded);
    });
    return () => {
      live = false;
    };
  }, []);
  if (!kernel || specs.length === 0) return null;
  return (
    <>
      {specs.map((spec) => (
        <AnchoredOrbit key={spec.key} spec={spec} kernel={kernel} clock={clock} centerName={centerName} />
      ))}
    </>
  );
}
