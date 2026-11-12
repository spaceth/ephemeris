import { useFrame } from "@react-three/fiber";
import { useEffect, useMemo, useRef } from "react";
import type { RefObject } from "react";
import * as THREE from "three";
import { toScene } from "../core/scene";
import { centerNaif, defaultNeighbors } from "../core/ephemeris/place";
import { loadPlanetarySnapshot } from "../core/ephemeris/planetary";
import { stateRelative } from "../core/ephemeris/resolve";
import { tdbFromTaiClock } from "../core/ephemeris/scales";
import type { StateQuality } from "../core/ephemeris/state";
import { lightingKernel, setLightingKernel } from "../core/ephemeris/sunLight";
import { EarthBody, MoonBody, SunBody } from "./Globe";
import type { SphereObstacle } from "./CameraDirector";
import type { SceneClock } from "./types";

const LABEL_SCRATCH = new THREE.Vector3();
const LABEL_FORWARD = new THREE.Vector3();
const SNAPSHOT_QUALITY: StateQuality[] = [
  { kind: "native" },
  { kind: "approximate", reason: "tdb-equals-tt" },
];

function placeNeighborLabel(
  el: HTMLSpanElement | null,
  world: THREE.Vector3,
  show: boolean,
  camera: THREE.Camera,
  size: { width: number; height: number },
  pixelRatio: number,
) {
  if (!el) return;
  if (!show) {
    el.style.visibility = "hidden";
    return;
  }
  const ahead = LABEL_SCRATCH.copy(world).sub(camera.position).dot(camera.getWorldDirection(LABEL_FORWARD)) > 0;
  LABEL_SCRATCH.copy(world).project(camera);
  if (!ahead) {
    el.style.visibility = "hidden";
    return;
  }
  const pixel = Math.max(pixelRatio, 1);
  const x = Math.round((LABEL_SCRATCH.x * 0.5 + 0.5) * size.width * pixel) / pixel;
  const y = Math.round(((-LABEL_SCRATCH.y * 0.5 + 0.5) * size.height) * pixel) / pixel;
  el.style.visibility = "visible";
  el.textContent = el.dataset.name ?? "";
  el.style.transform = `translate3d(${x}px, ${y}px, 0) translate(-50%, calc(-100% - 8px))`;
}

function NeighborMesh({
  id,
  radiusKm,
  realistic,
  clouds,
  clock,
}: {
  id: number;
  radiusKm: number;
  realistic: boolean;
  clouds: boolean;
  clock: { current: SceneClock };
}) {
  if (id === 10) return <SunBody radiusKm={radiusKm} />;
  if (!realistic) {
    return (
      <mesh>
        <sphereGeometry args={[radiusKm, 48, 32]} />
        <meshBasicMaterial color="#3a3a3c" toneMapped={false} />
      </mesh>
    );
  }
  if (id === 399) return <EarthBody radiusKm={radiusKm} clock={clock} clouds={clouds} />;
  if (id === 301) return <MoonBody radiusKm={radiusKm} clock={clock} />;
  return null;
}

/**
 * Bodies other than the segment center. Positions are center-relative EME2000
 * states from the snapshot, converted with `toScene` after that subtraction.
 * The center body is not drawn again.
 */
export function Neighbors({
  clock,
  centerName,
  realistic,
  clouds,
  showNames,
  obstacles,
  reach,
  labelEls,
}: {
  clock: { current: SceneClock };
  centerName: string | null;
  realistic: boolean;
  clouds: boolean;
  showNames: boolean;
  obstacles: RefObject<SphereObstacle[]>;
  reach: RefObject<number>;
  labelEls: RefObject<HTMLSpanElement | null>[];
}) {
  const neighbors = useMemo(() => defaultNeighbors(centerName), [centerName]);
  const groups = useRef<(THREE.Group | null)[]>([]);
  const slots = useMemo(
    () => neighbors.map(() => ({ position: new THREE.Vector3(), radiusKm: 0 })),
    [neighbors],
  );

  useEffect(() => {
    let live = true;
    void loadPlanetarySnapshot().then((kernel) => {
      if (!live) return;
      setLightingKernel(kernel);
    });
    return () => {
      live = false;
    };
  }, []);

  useFrame(({ camera, size, gl }) => {
    const kernel = lightingKernel();
    const origin = clock.current.file?.origin ?? null;
    const center = centerNaif(centerName);
    const list = obstacles.current;
    if (list) list.length = 0;
    let farthest = 0;
    if (!kernel || !origin || center == null) {
      groups.current.forEach((group) => {
        if (group) group.visible = false;
      });
      labelEls.forEach((el) => {
        if (el.current) el.current.style.visibility = "hidden";
      });
      reach.current = 0;
      return;
    }
    const et = tdbFromTaiClock(origin, clock.current.t);
    neighbors.forEach((body, index) => {
      const group = groups.current[index];
      const slot = slots[index];
      const label = labelEls[index]?.current ?? null;
      if (!group || !slot) return;
      const state = stateRelative(
        [kernel],
        body.id,
        center,
        et.secondsPastJ2000,
        "EME2000",
        SNAPSHOT_QUALITY,
      );
      if (!state.ok) {
        group.visible = false;
        if (label) label.style.visibility = "hidden";
        return;
      }
      const [x, y, z] = toScene(state.state.positionM[0], state.state.positionM[1], state.state.positionM[2]);
      group.position.set(x, y, z);
      group.visible = true;
      slot.position.copy(group.position);
      slot.radiusKm = body.radiusKm;
      list?.push(slot);
      farthest = Math.max(farthest, Math.hypot(x, y, z) + body.radiusKm);
      if (label) label.dataset.name = body.name;
      placeNeighborLabel(label, group.position, showNames, camera, size, gl.getPixelRatio());
    });
    reach.current = farthest;
  });

  return (
    <>
      {neighbors.map((body, index) => (
        <group
          key={body.id}
          ref={(node) => {
            groups.current[index] = node;
          }}
          visible={false}
        >
          <NeighborMesh id={body.id} radiusKm={body.radiusKm} realistic={realistic} clouds={clouds} clock={clock} />
        </group>
      ))}
    </>
  );
}
