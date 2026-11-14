import { useFrame } from "@react-three/fiber";
import { useEffect, useMemo, useRef } from "react";
import type { RefObject } from "react";
import * as THREE from "three";
import { toScene } from "../core/scene";
import { queueSceneLabel } from "./labelLayout";
import { centerNaif, defaultNeighbors, place } from "../core/ephemeris/place";
import { loadPlanetarySnapshot } from "../core/ephemeris/planetary";
import { tdbFromTaiClock } from "../core/ephemeris/scales";
import { lightingKernel, setLightingKernel } from "../core/ephemeris/sunLight";
import { BodyMesh } from "./BodyMesh";
import type { SphereObstacle } from "./CameraDirector";
import type { SceneClock } from "./types";

const LABEL_SCRATCH = new THREE.Vector3();
const LABEL_FORWARD = new THREE.Vector3();

function screenLift(camera: THREE.Camera, world: THREE.Vector3, radiusKm: number, height: number): number {
  if (radiusKm <= 0 || !(camera instanceof THREE.PerspectiveCamera)) return 0;
  const dist = camera.position.distanceTo(world);
  if (!(dist > radiusKm)) return 0;
  const half = Math.tan(THREE.MathUtils.degToRad(camera.fov) * 0.5);
  return (radiusKm / dist) / half * height * 0.5;
}

function placeNeighborLabel(
  el: HTMLSpanElement | null,
  world: THREE.Vector3,
  radiusKm: number,
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
  const lift = screenLift(camera, world, radiusKm, size.height);
  const x = Math.round((LABEL_SCRATCH.x * 0.5 + 0.5) * size.width * pixel) / pixel;
  const y = Math.round(((-LABEL_SCRATCH.y * 0.5 + 0.5) * size.height - lift) * pixel) / pixel;
  el.textContent = el.dataset.name ?? "";
  queueSceneLabel(el, x, y, false);
}

/**
 * Bodies other than the segment center.
 * Each position is EME2000 meters from `place`, then `toScene` once.
 * A failed chain hides that body and is recorded by `place`.
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
    const kernels = kernel ? [kernel] : [];
    const origin = clock.current.file?.origin ?? null;
    const center = centerNaif(centerName);
    const list = obstacles.current;
    if (list) list.length = 0;
    let farthest = 0;
    const hideRest = (from: number) => {
      for (let index = from; index < labelEls.length; index += 1) {
        const el = labelEls[index]?.current;
        if (el) el.style.visibility = "hidden";
      }
    };
    if (!origin) {
      groups.current.forEach((group) => {
        if (group) group.visible = false;
      });
      hideRest(0);
      reach.current = 0;
      return;
    }
    const et = tdbFromTaiClock(origin, clock.current.t);
    neighbors.forEach((body, index) => {
      const group = groups.current[index];
      const slot = slots[index];
      const label = labelEls[index]?.current ?? null;
      if (!group || !slot) return;
      const placed = place(body.id, center, kernels, et.secondsPastJ2000);
      if (!placed.ok) {
        group.visible = false;
        if (label) label.style.visibility = "hidden";
        return;
      }
      const [x, y, z] = toScene(placed.positionM[0], placed.positionM[1], placed.positionM[2]);
      group.position.set(x, y, z);
      group.visible = true;
      slot.position.copy(group.position);
      slot.radiusKm = body.radiusKm ?? 0;
      list?.push(slot);
      farthest = Math.max(farthest, Math.hypot(x, y, z) + (body.radiusKm ?? 0));
      if (label) label.dataset.name = body.label;
      placeNeighborLabel(label, group.position, body.radiusKm ?? 0, showNames, camera, size, gl.getPixelRatio());
    });
    hideRest(neighbors.length);
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
          <BodyMesh record={body} radiusKm={body.radiusKm} realistic={realistic} clouds={clouds} clock={clock} />
        </group>
      ))}
    </>
  );
}
