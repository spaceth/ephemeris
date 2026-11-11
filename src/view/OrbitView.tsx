import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { OrbitControls } from "@react-three/drei";
import { useEffect, useMemo, useRef } from "react";
import type { RefObject } from "react";
import * as THREE from "three";
import type { ArcBuffer } from "../session";
import { CameraDirector } from "./CameraDirector";
import type { CameraMode } from "./camera";
import { readCraft } from "./craftPose";
import type { CraftPose } from "./craftPose";
import type { SceneClock } from "./types";

const CRAFT_ORIGIN = new Float32Array([0, 0, 0]);
const CENTER_ORIGIN = new Float32Array([0, 0, 0]);

type OrbitProps = {
  arcs: ArcBuffer[];
  selected: number;
  clock: { current: SceneClock };
  fit: number;
  /** Canonical center name. The Sun is its own sphere; other bodies share the plain sphere. */
  centerName: string | null;
  /** Name drawn on the center. Empty hides the label. */
  centerLabel: string;
  /** Name drawn on the spacecraft. Empty hides the label. */
  objectLabel: string;
  /** Screen labels. The scene writes their position each frame. */
  centerLabelEl: RefObject<HTMLSpanElement | null>;
  objectLabelEl: RefObject<HTMLSpanElement | null>;
  /** Equatorial radius of the body at the origin. Null draws an origin mark. */
  bodyRadiusKm: number | null;
  resetToken: number;
  cameraMode: CameraMode;
  onCameraMode: (mode: CameraMode) => void;
};

function ArcLine({ positions, opacity }: { positions: Float32Array; opacity: number }) {
  const line = useMemo(() => {
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    const material = new THREE.LineBasicMaterial({
      color: 0xf5f5f7,
      transparent: opacity < 1,
      opacity,
      toneMapped: false,
    });
    const next = new THREE.Line(geometry, material);
    next.frustumCulled = false;
    return next;
  }, [positions, opacity]);
  useEffect(() => {
    return () => {
      line.geometry.dispose();
      const material = line.material;
      if (!Array.isArray(material)) material.dispose();
    };
  }, [line]);
  return <primitive object={line} />;
}

/** Untextured solar sphere. A light gives it a limb so the ball reads as solid. */
function SunSphere({ radiusKm }: { radiusKm: number }) {
  const geometry = useMemo(() => new THREE.SphereGeometry(radiusKm, 64, 48), [radiusKm]);
  useEffect(() => () => geometry.dispose(), [geometry]);
  return (
    <>
      <ambientLight intensity={0.4} />
      <directionalLight position={[1, 0.35, 0.6]} intensity={1.4} />
      <mesh geometry={geometry}>
        <meshLambertMaterial color="#f5f5f7" toneMapped={false} />
      </mesh>
    </>
  );
}

function BodySphere({ radiusKm }: { radiusKm: number }) {
  const geometry = useMemo(() => new THREE.SphereGeometry(radiusKm, 64, 48), [radiusKm]);
  useEffect(() => () => geometry.dispose(), [geometry]);
  return (
    <mesh geometry={geometry}>
      <meshBasicMaterial color="#3a3a3c" toneMapped={false} />
    </mesh>
  );
}

function OriginMark() {
  const map = useMemo(() => circleTexture(), []);
  useEffect(() => () => map.dispose(), [map]);
  return (
    <points frustumCulled={false}>
      <bufferGeometry>
        <bufferAttribute attach="attributes-position" args={[CENTER_ORIGIN, 3]} />
      </bufferGeometry>
      <pointsMaterial
        map={map}
        color="#a1a1a6"
        size={8}
        sizeAttenuation={false}
        transparent
        alphaTest={0.5}
        toneMapped={false}
        depthTest={false}
      />
    </points>
  );
}

function circleTexture(): THREE.CanvasTexture {
  const canvas = document.createElement("canvas");
  canvas.width = 64;
  canvas.height = 64;
  const context = canvas.getContext("2d");
  if (context) {
    context.clearRect(0, 0, 64, 64);
    context.fillStyle = "#ffffff";
    context.beginPath();
    context.arc(32, 32, 28, 0, Math.PI * 2);
    context.fill();
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.needsUpdate = true;
  return texture;
}

/** Samples the spacecraft once per frame, before the marker and the camera read it. */
function CraftProbe({ clock, pose }: { clock: { current: SceneClock }; pose: RefObject<CraftPose | null> }) {
  const local = useMemo<CraftPose>(() => ({ ok: false, pos: new THREE.Vector3(), vel: new THREE.Vector3() }), []);
  useFrame(() => {
    readCraft(clock, local);
    pose.current = local;
  });
  return null;
}

function Craft({ pose }: { pose: RefObject<CraftPose | null> }) {
  const points = useRef<THREE.Points>(null);
  const map = useMemo(() => circleTexture(), []);
  useEffect(() => () => map.dispose(), [map]);
  useFrame(() => {
    const node = points.current;
    const sample = pose.current;
    if (!node || !sample?.ok) {
      if (node) node.visible = false;
      return;
    }
    node.visible = true;
    node.position.copy(sample.pos);
  });
  return (
    <points ref={points} frustumCulled={false} visible={false}>
      <bufferGeometry>
        <bufferAttribute attach="attributes-position" args={[CRAFT_ORIGIN, 3]} />
      </bufferGeometry>
      <pointsMaterial
        map={map}
        color="#f5f5f7"
        size={10}
        sizeAttenuation={false}
        transparent
        alphaTest={0.5}
        toneMapped={false}
        depthTest={false}
      />
    </points>
  );
}

function placeLabel(
  el: HTMLSpanElement | null,
  world: THREE.Vector3,
  show: boolean,
  camera: THREE.Camera,
  size: { width: number; height: number },
  scratch: THREE.Vector3,
  forward: THREE.Vector3,
) {
  if (!el) return;
  if (!show) {
    el.style.visibility = "hidden";
    return;
  }
  const ahead = scratch.copy(world).sub(camera.position).dot(camera.getWorldDirection(forward)) > 0;
  scratch.copy(world).project(camera);
  if (!ahead) {
    el.style.visibility = "hidden";
    return;
  }
  const x = (scratch.x * 0.5 + 0.5) * size.width;
  const y = (-scratch.y * 0.5 + 0.5) * size.height;
  el.style.visibility = "visible";
  el.style.transform = `translate3d(${x}px, ${y}px, 0) translate(-50%, calc(-100% - 8px))`;
}

/** Screen-space names. The center sits just above its limb; a point sits just above the mark. */
function SceneLabels({
  centerLabel,
  objectLabel,
  radiusKm,
  pose,
  centerEl,
  craftEl,
}: {
  centerLabel: string;
  objectLabel: string;
  radiusKm: number;
  pose: RefObject<CraftPose | null>;
  centerEl: RefObject<HTMLSpanElement | null>;
  craftEl: RefObject<HTMLSpanElement | null>;
}) {
  const lift = useMemo(() => new THREE.Vector3(), []);
  const scratch = useMemo(() => new THREE.Vector3(), []);
  const forward = useMemo(() => new THREE.Vector3(), []);
  useFrame(({ camera, size }) => {
    if (radiusKm > 0) lift.set(0, 1, 0).applyQuaternion(camera.quaternion).setLength(radiusKm);
    else lift.set(0, 0, 0);
    placeLabel(centerEl.current, lift, Boolean(centerLabel), camera, size, scratch, forward);
    const sample = pose.current;
    placeLabel(craftEl.current, sample?.pos ?? lift, Boolean(sample?.ok && objectLabel), camera, size, scratch, forward);
  });
  return null;
}

function CameraRig({ fit, resetToken, mode }: { fit: number; resetToken: number; mode: CameraMode }) {
  const camera = useThree((state) => state.camera);
  const controls = useThree((state) => state.controls) as { target?: THREE.Vector3; update?: () => void } | null;
  useEffect(() => {
    if (mode !== "overview") return;
    const radius = Math.max(fit, 16);
    camera.up.set(0, 1, 0);
    camera.position.set(radius * 0.2, radius * 0.55, radius * 1.45);
    camera.near = 0.02;
    camera.far = Math.max(radius * 80, 1e8);
    camera.lookAt(0, 0, 0);
    camera.updateProjectionMatrix();
    controls?.target?.set(0, 0, 0);
    controls?.update?.();
  }, [camera, controls, fit, mode, resetToken]);
  return null;
}

export function OrbitView({
  arcs,
  selected,
  clock,
  fit,
  centerName,
  centerLabel,
  objectLabel,
  centerLabelEl,
  objectLabelEl,
  bodyRadiusKm,
  resetToken,
  cameraMode,
  onCameraMode,
}: OrbitProps) {
  const pose = useRef<CraftPose | null>(null);
  return (
    <Canvas
      className="stage"
      gl={{ antialias: true, logarithmicDepthBuffer: true, alpha: false }}
      camera={{ fov: 42, position: [8, 24, 48], near: 0.02, far: 1e10 }}
      dpr={[1, 2]}
    >
      <color attach="background" args={["#000000"]} />
      {centerName === "SUN" && bodyRadiusKm != null && bodyRadiusKm > 0 ? (
        <SunSphere radiusKm={bodyRadiusKm} />
      ) : bodyRadiusKm != null && bodyRadiusKm > 0 ? (
        <BodySphere radiusKm={bodyRadiusKm} />
      ) : (
        <OriginMark />
      )}
      {arcs.map((arc) => (
        <ArcLine
          key={arc.segmentIndex}
          positions={arc.positions}
          opacity={arc.segmentIndex === selected ? 0.95 : 0.32}
        />
      ))}
      <CraftProbe clock={clock} pose={pose} />
      <Craft pose={pose} />
      <SceneLabels
        centerLabel={centerLabel}
        objectLabel={objectLabel}
        radiusKm={bodyRadiusKm ?? 0}
        pose={pose}
        centerEl={centerLabelEl}
        craftEl={objectLabelEl}
      />
      <OrbitControls
        makeDefault
        enabled
        enablePan={cameraMode === "overview"}
        enableDamping
        dampingFactor={0.08}
        minDistance={cameraMode !== "overview" && (bodyRadiusKm ?? 0) > 1000 ? 40 : 0.15}
        maxDistance={Math.max(fit, 16) * 30}
      />
      <CameraRig fit={fit} resetToken={resetToken} mode={cameraMode} />
      <CameraDirector pose={pose} mode={cameraMode} bodyRadiusKm={bodyRadiusKm ?? 0} onCameraMode={onCameraMode} />
    </Canvas>
  );
}
