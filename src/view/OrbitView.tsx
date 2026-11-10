import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { OrbitControls } from "@react-three/drei";
import { useEffect, useMemo, useRef } from "react";
import type { RefObject } from "react";
import * as THREE from "three";
import type { ArcBuffer } from "../session";
import { CameraDirector } from "./CameraDirector";
import type { CameraMode } from "./camera";
import { EARTH_RADIUS_KM, readCraft } from "./craftPose";
import type { CraftPose } from "./craftPose";
import type { SceneClock } from "./types";

const CRAFT_ORIGIN = new Float32Array([0, 0, 0]);

type OrbitProps = {
  arcs: ArcBuffer[];
  selected: number;
  clock: { current: SceneClock };
  fit: number;
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
    return new THREE.Line(geometry, material);
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

function Earth() {
  const geometry = useMemo(() => new THREE.SphereGeometry(EARTH_RADIUS_KM, 64, 48), []);
  useEffect(() => () => geometry.dispose(), [geometry]);
  return (
    <mesh geometry={geometry}>
      <meshBasicMaterial color="#3a3a3c" toneMapped={false} />
    </mesh>
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

function CameraRig({ fit, resetToken, mode }: { fit: number; resetToken: number; mode: CameraMode }) {
  const camera = useThree((state) => state.camera);
  const controls = useThree((state) => state.controls) as { target?: THREE.Vector3; update?: () => void } | null;
  useEffect(() => {
    if (mode !== "overview") return;
    const radius = Math.max(fit, 16);
    camera.up.set(0, 1, 0);
    camera.position.set(radius * 0.2, radius * 0.55, radius * 1.45);
    camera.near = 0.02;
    camera.far = 1e8;
    camera.lookAt(0, 0, 0);
    camera.updateProjectionMatrix();
    controls?.target?.set(0, 0, 0);
    controls?.update?.();
  }, [camera, controls, fit, mode, resetToken]);
  return null;
}

export function OrbitView({ arcs, selected, clock, fit, resetToken, cameraMode, onCameraMode }: OrbitProps) {
  const pose = useRef<CraftPose | null>(null);
  return (
    <Canvas
      className="stage"
      gl={{ antialias: true, logarithmicDepthBuffer: true, alpha: false }}
      camera={{ fov: 42, position: [8, 24, 48], near: 0.02, far: 1e8 }}
      dpr={[1, 2]}
    >
      <color attach="background" args={["#000000"]} />
      <Earth />
      {arcs.map((arc) => (
        <ArcLine
          key={arc.segmentIndex}
          positions={arc.positions}
          opacity={arc.segmentIndex === selected ? 0.95 : 0.32}
        />
      ))}
      <CraftProbe clock={clock} pose={pose} />
      <Craft pose={pose} />
      <OrbitControls
        makeDefault
        enabled
        enablePan={cameraMode === "overview"}
        enableDamping
        dampingFactor={0.08}
        minDistance={cameraMode === "overview" ? 0.15 : 40}
        maxDistance={Math.max(fit, 16) * 30}
      />
      <CameraRig fit={fit} resetToken={resetToken} mode={cameraMode} />
      <CameraDirector pose={pose} mode={cameraMode} onCameraMode={onCameraMode} />
    </Canvas>
  );
}
