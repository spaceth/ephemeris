import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { OrbitControls } from "@react-three/drei";
import { useEffect, useMemo, useRef } from "react";
import type { ComponentRef } from "react";
import * as THREE from "three";
import { stateAt } from "../core/evaluate";
import { toScene } from "../core/scene";
import type { OemFile } from "../core/oem";
import type { ArcBuffer } from "../session";

const CRAFT_ORIGIN = new Float32Array([0, 0, 0]);
/** WGS84 equatorial radius, scene kilometers. The sphere is not oriented: a plain sphere has no longitude. */
const EARTH_RADIUS_KM = 6378.137;

export type SceneClock = {
  file: OemFile | null;
  t: number;
  segment: number;
};

type OrbitProps = {
  arcs: ArcBuffer[];
  selected: number;
  clock: { current: SceneClock };
  fit: number;
  resetToken: number;
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

function Craft({ clock }: { clock: { current: SceneClock } }) {
  const points = useRef<THREE.Points>(null);
  const map = useMemo(() => circleTexture(), []);
  useEffect(() => () => map.dispose(), [map]);
  useFrame(() => {
    const node = points.current;
    const file = clock.current.file;
    if (!node || !file) return;
    const state = stateAt(file, clock.current.t, clock.current.segment);
    if (!state.ok || !state.eme2000PositionM) {
      node.visible = false;
      return;
    }
    const scene = toScene(state.eme2000PositionM[0], state.eme2000PositionM[1], state.eme2000PositionM[2]);
    node.visible = true;
    node.position.set(scene[0], scene[1], scene[2]);
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

function CameraRig({ fit, resetToken }: { fit: number; resetToken: number }) {
  const camera = useThree((state) => state.camera);
  const controls = useThree((state) => state.controls);
  useEffect(() => {
    const radius = Math.max(fit, 16);
    camera.position.set(radius * 0.2, radius * 0.55, radius * 1.45);
    camera.near = 0.02;
    camera.far = 1e8;
    camera.lookAt(0, 0, 0);
    camera.updateProjectionMatrix();
    const orbit = controls as { target?: THREE.Vector3; update?: () => void } | null;
    orbit?.target?.set(0, 0, 0);
    orbit?.update?.();
  }, [camera, controls, fit, resetToken]);
  return null;
}

export function OrbitView({ arcs, selected, clock, fit, resetToken }: OrbitProps) {
  const controls = useRef<ComponentRef<typeof OrbitControls>>(null);
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
      <Craft clock={clock} />
      <OrbitControls ref={controls} makeDefault enableDamping dampingFactor={0.08} minDistance={0.15} maxDistance={Math.max(fit, 16) * 30} />
      <CameraRig fit={fit} resetToken={resetToken} />
    </Canvas>
  );
}

export function trajectoryRadius(arcs: ArcBuffer[]): number {
  let radius = 12;
  for (const arc of arcs) {
    const values = arc.positions;
    for (let i = 0; i < values.length; i += 3) {
      const reach = Math.hypot(values[i], values[i + 1], values[i + 2]);
      if (reach > radius) radius = reach;
    }
  }
  return radius;
}
