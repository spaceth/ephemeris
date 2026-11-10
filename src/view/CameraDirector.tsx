import { useFrame, useThree } from "@react-three/fiber";
import { useEffect, useMemo, useRef } from "react";
import type { MutableRefObject, RefObject } from "react";
import * as THREE from "three";
import type { CameraMode } from "./camera";
import type { CraftPose } from "./craftPose";
import { EARTH_RADIUS_KM } from "./craftPose";

type Scratch = {
  pos: THREE.Vector3;
  vel: THREE.Vector3;
  desired: THREE.Vector3;
  look: THREE.Vector3;
  forward: THREE.Vector3;
  right: THREE.Vector3;
  camUp: THREE.Vector3;
  anchor: THREE.Vector3;
  worldUp: THREE.Vector3;
  altUp: THREE.Vector3;
};

type OrbitHandle = { target: THREE.Vector3; update?: () => void };

const ZOOM_MIN = 0.3;
const ZOOM_MAX = 6;
const DRAG_PX = 6;

function followDistance(rangeKm: number): number {
  const altitude = Math.max(rangeKm - EARTH_RADIUS_KM, 180);
  return Math.min(Math.max(altitude * 2.2, 420), 8000);
}

function flightFrame(bag: Scratch) {
  bag.forward.copy(bag.vel);
  if (bag.forward.lengthSq() < 1e-8) bag.forward.set(0, 0, 1);
  bag.forward.normalize();
  bag.right.crossVectors(bag.forward, bag.worldUp);
  if (bag.right.lengthSq() < 1e-6) bag.right.crossVectors(bag.forward, bag.altUp);
  bag.right.normalize();
  bag.camUp.crossVectors(bag.right, bag.forward).normalize();
}

/** Keep the camera's offset from its target while the target moves to the spacecraft. */
function carry(camera: THREE.Camera, target: THREE.Vector3, next: THREE.Vector3, scratch: THREE.Vector3, up: THREE.Vector3) {
  scratch.copy(camera.position).sub(target);
  target.copy(next);
  camera.up.copy(up);
  camera.position.copy(next).add(scratch);
  camera.lookAt(next);
}

function seedFollow(bag: Scratch, camera: THREE.Camera, target: THREE.Vector3) {
  flightFrame(bag);
  const dist = followDistance(bag.pos.length());
  camera.up.copy(bag.worldUp);
  target.copy(bag.pos);
  camera.position.copy(bag.pos).addScaledVector(bag.forward, -dist).addScaledVector(bag.camUp, dist * 0.42);
  camera.lookAt(bag.pos);
}

function placePov(bag: Scratch, camera: THREE.Camera, anchored: MutableRefObject<boolean>, zoom: number, target: THREE.Vector3) {
  if (!anchored.current) {
    bag.anchor.copy(camera.position);
    const min = followDistance(bag.pos.length()) * 1.6;
    if (bag.anchor.distanceTo(bag.pos) < min) {
      bag.forward.copy(bag.anchor).sub(bag.pos);
      if (bag.forward.lengthSq() < 1e-6) bag.forward.set(1, 0.45, 1);
      bag.forward.normalize();
      bag.anchor.copy(bag.pos).addScaledVector(bag.forward, min);
    }
    anchored.current = true;
  }
  const span = Math.max(bag.anchor.distanceTo(bag.pos), 40);
  const dist = Math.min(Math.max(span * zoom, 40), span * 6);
  bag.forward.copy(bag.anchor).sub(bag.pos).setLength(dist);
  camera.up.copy(bag.worldUp);
  camera.position.copy(bag.pos).add(bag.forward);
  camera.lookAt(bag.pos);
  target.copy(bag.pos);
}

function placeCinematic(bag: Scratch, camera: THREE.Camera, elapsed: number, step: number, zoom: number, target: THREE.Vector3) {
  flightFrame(bag);
  camera.up.copy(bag.camUp);
  const dist = followDistance(bag.pos.length());
  const radius = dist * (1.35 + 0.28 * Math.sin(elapsed * 0.13));
  const angle = elapsed * 0.18;
  const lift = 0.22 + 0.38 * (0.5 + 0.5 * Math.sin(elapsed * 0.07));
  bag.desired
    .copy(bag.pos)
    .addScaledVector(bag.right, Math.cos(angle) * radius)
    .addScaledVector(bag.forward, Math.sin(angle) * radius * 0.65)
    .addScaledVector(bag.camUp, lift * radius);
  bag.look.copy(bag.pos).addScaledVector(bag.forward, dist * 0.35);
  const span = Math.max(bag.desired.distanceTo(bag.look), 40);
  const reach = Math.min(Math.max(span * zoom, 40), span * 6) / span;
  bag.desired.sub(bag.look).multiplyScalar(reach).add(bag.look);
  camera.position.lerp(bag.desired, step);
  camera.lookAt(bag.look);
  target.copy(bag.look);
}

function adoptZoom(camera: THREE.Camera, pivot: THREE.Vector3, zoom: MutableRefObject<number>, applied: MutableRefObject<number>) {
  if (applied.current <= 1) return;
  const ratio = camera.position.distanceTo(pivot) / applied.current;
  if (Math.abs(ratio - 1) > 0.004) zoom.current = THREE.MathUtils.clamp(zoom.current * ratio, ZOOM_MIN, ZOOM_MAX);
}

export function CameraDirector({
  pose,
  mode,
  onCameraMode,
}: {
  pose: RefObject<CraftPose | null>;
  mode: CameraMode;
  onCameraMode: (mode: CameraMode) => void;
}) {
  const camera = useThree((state) => state.camera);
  const gl = useThree((state) => state.gl);
  const controls = useThree((state) => state.controls) as OrbitHandle | null;
  const anchored = useRef(false);
  const followReady = useRef(false);
  const keepView = useRef(false);
  const zoom = useRef(1);
  const applied = useRef(0);
  const bag = useMemo<Scratch>(() => ({
    pos: new THREE.Vector3(),
    vel: new THREE.Vector3(),
    desired: new THREE.Vector3(),
    look: new THREE.Vector3(),
    forward: new THREE.Vector3(),
    right: new THREE.Vector3(),
    camUp: new THREE.Vector3(),
    anchor: new THREE.Vector3(),
    worldUp: new THREE.Vector3(0, 1, 0),
    altUp: new THREE.Vector3(1, 0, 0),
  }), []);

  useEffect(() => {
    const element = gl.domElement;
    const pointer = { x: 0, y: 0, down: false };
    const down = (event: PointerEvent) => {
      if (event.button !== 0) return;
      pointer.x = event.clientX;
      pointer.y = event.clientY;
      pointer.down = true;
    };
    const move = (event: PointerEvent) => {
      if (!pointer.down || keepView.current) return;
      if (mode !== "pov" && mode !== "cinematic") return;
      const dx = event.clientX - pointer.x;
      const dy = event.clientY - pointer.y;
      if (dx * dx + dy * dy < DRAG_PX * DRAG_PX) return;
      pointer.down = false;
      keepView.current = true;
      onCameraMode("follow");
    };
    const up = () => {
      pointer.down = false;
    };
    element.addEventListener("pointerdown", down);
    element.addEventListener("pointermove", move);
    element.addEventListener("pointerup", up);
    element.addEventListener("pointercancel", up);
    return () => {
      element.removeEventListener("pointerdown", down);
      element.removeEventListener("pointermove", move);
      element.removeEventListener("pointerup", up);
      element.removeEventListener("pointercancel", up);
    };
  }, [gl, mode, onCameraMode]);

  useFrame((state, dt) => {
    if (mode !== "follow") followReady.current = false;
    if (mode !== "pov") anchored.current = false;
    if (mode === "overview" || mode === "follow") {
      zoom.current = 1;
      applied.current = 0;
    }
    if (mode === "overview") return;
    const sample = pose.current;
    if (!sample?.ok) return;
    bag.pos.copy(sample.pos);
    bag.vel.copy(sample.vel);
    const orbit = controls;
    if (keepView.current && mode !== "follow" && orbit?.target) {
      carry(camera, orbit.target, bag.pos, bag.desired, bag.worldUp);
      return;
    }
    if (mode === "follow") {
      const target = orbit?.target;
      if (!target) return;
      if (!followReady.current) {
        if (keepView.current) {
          carry(camera, target, bag.pos, bag.desired, bag.worldUp);
          keepView.current = false;
        } else {
          seedFollow(bag, camera, target);
          orbit?.update?.();
        }
        followReady.current = true;
        return;
      }
      carry(camera, target, bag.pos, bag.desired, bag.worldUp);
      return;
    }
    if (orbit?.target) adoptZoom(camera, orbit.target, zoom, applied);
    if (!orbit?.target) return;
    const step = 1 - Math.exp(-Math.min(dt, 0.1) * 1.6);
    if (mode === "pov") placePov(bag, camera, anchored, zoom.current, orbit.target);
    else placeCinematic(bag, camera, state.clock.elapsedTime, step, zoom.current, orbit.target);
    applied.current = camera.position.distanceTo(orbit.target);
  });
  return null;
}
