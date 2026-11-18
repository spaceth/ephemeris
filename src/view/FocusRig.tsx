import { useFrame, useThree } from "@react-three/fiber";
import { useEffect, useRef } from "react";
import type { RefObject } from "react";
import * as THREE from "three";
import type { CameraFocus } from "./camera";
import { focusKey } from "./camera";
import type { SphereObstacle } from "./CameraDirector";
import type { CraftPose } from "./craftPose";
import type { CameraSubject, ScreenPick } from "./focus";
import { chooseFocus } from "./focus";
import { projectedDiameterPx } from "./pixel";

const DRAG_PX = 6;
/** A point body or the spacecraft is still clickable when it covers less than a pixel. */
const POINT_HIT_PX = 18;

const ORIGIN = new THREE.Vector3();
const WORLD = new THREE.Vector3();
const FORWARD = new THREE.Vector3();
const PROJECTED = new THREE.Vector3();

export function FocusSubject({
  focus,
  pose,
  obstacles,
  centerRadiusKm,
  subject,
}: {
  focus: CameraFocus;
  pose: RefObject<CraftPose | null>;
  obstacles: RefObject<SphereObstacle[]>;
  centerRadiusKm: number;
  subject: RefObject<CameraSubject>;
}) {
  const prev = useRef(new THREE.Vector3());
  const prevKey = useRef("");
  const havePrev = useRef(false);
  useFrame((_, dt) => {
    const bag = subject.current;
    if (!bag) return;
    const key = focusKey(focus);
    if (focus.kind === "craft") {
      const sample = pose.current;
      if (!sample?.ok) {
        bag.ok = false;
        return;
      }
      bag.pos.copy(sample.pos);
      bag.vel.copy(sample.vel);
      bag.radiusKm = centerRadiusKm;
      bag.body = false;
      bag.ok = true;
      bag.key = key;
      return;
    }
    if (focus.kind === "center") {
      bag.pos.set(0, 0, 0);
      bag.radiusKm = centerRadiusKm;
    } else {
      const slot = obstacles.current?.find((item) => item.id === focus.id);
      if (!slot) {
        bag.ok = false;
        return;
      }
      bag.pos.copy(slot.position);
      bag.radiusKm = slot.radiusKm;
    }
    if (prevKey.current !== key || !havePrev.current || !(dt > 1e-4)) bag.vel.set(0, 0, 0);
    else bag.vel.copy(bag.pos).sub(prev.current).divideScalar(dt);
    prev.current.copy(bag.pos);
    prevKey.current = key;
    havePrev.current = true;
    bag.body = true;
    bag.ok = true;
    bag.key = key;
  });
  return null;
}

function projectPick(
  camera: THREE.Camera,
  world: THREE.Vector3,
  width: number,
  height: number,
  radiusKm: number,
  focus: CameraFocus,
): ScreenPick {
  camera.getWorldDirection(FORWARD);
  const toward = WORLD.copy(world).sub(camera.position);
  const distance = toward.length();
  const inFront = distance > 1e-6 && toward.dot(FORWARD) > 0;
  PROJECTED.copy(world).project(camera);
  const fov = camera instanceof THREE.PerspectiveCamera ? camera.fov : 42;
  const diameter = projectedDiameterPx(fov, distance, radiusKm, height);
  return {
    focus,
    x: (PROJECTED.x * 0.5 + 0.5) * width,
    y: (-PROJECTED.y * 0.5 + 0.5) * height,
    distance,
    hitPx: Math.max(diameter * 0.5, POINT_HIT_PX),
    inFront: inFront && PROJECTED.z >= -1 && PROJECTED.z <= 1,
  };
}

/** Click a planet, the center, or the spacecraft. A drag is left to the orbit controls. */
export function FocusClick({
  pose,
  obstacles,
  centerRadiusKm,
  onFocus,
}: {
  pose: RefObject<CraftPose | null>;
  obstacles: RefObject<SphereObstacle[]>;
  centerRadiusKm: number;
  onFocus: (focus: CameraFocus) => void;
}) {
  const camera = useThree((state) => state.camera);
  const gl = useThree((state) => state.gl);
  const live = useRef({ camera, pose, obstacles, centerRadiusKm, onFocus });
  live.current = { camera, pose, obstacles, centerRadiusKm, onFocus };
  useEffect(() => {
    const element = gl.domElement;
    const pointer = { x: 0, y: 0, down: false };
    const down = (event: PointerEvent) => {
      if (event.button !== 0) return;
      pointer.x = event.clientX;
      pointer.y = event.clientY;
      pointer.down = true;
    };
    const up = (event: PointerEvent) => {
      if (!pointer.down || event.button !== 0) return;
      pointer.down = false;
      const movedX = event.clientX - pointer.x;
      const movedY = event.clientY - pointer.y;
      if (movedX * movedX + movedY * movedY > DRAG_PX * DRAG_PX) return;
      const { camera: view, pose: craft, obstacles: bodies, centerRadiusKm: radius, onFocus: pick } = live.current;
      const rect = element.getBoundingClientRect();
      const x = event.clientX - rect.left;
      const y = event.clientY - rect.top;
      const width = rect.width;
      const height = rect.height;
      const picks: ScreenPick[] = [
        projectPick(view, ORIGIN, width, height, radius, { kind: "center" }),
      ];
      for (const body of bodies.current ?? []) {
        picks.push(projectPick(view, body.position, width, height, body.radiusKm, { kind: "body", id: body.id }));
      }
      const sample = craft.current;
      if (sample?.ok) picks.push(projectPick(view, sample.pos, width, height, 0, { kind: "craft" }));
      const chosen = chooseFocus(x, y, picks);
      if (chosen) pick(chosen);
    };
    element.addEventListener("pointerdown", down);
    element.addEventListener("pointerup", up);
    return () => {
      element.removeEventListener("pointerdown", down);
      element.removeEventListener("pointerup", up);
    };
  }, [gl]);
  return null;
}
