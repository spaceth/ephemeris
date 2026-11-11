import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { OrbitControls } from "@react-three/drei";
import { useEffect, useLayoutEffect, useMemo, useRef } from "react";
import type { RefObject } from "react";
import * as THREE from "three";
import { Line2 } from "three/addons/lines/Line2.js";
import { LineGeometry } from "three/addons/lines/LineGeometry.js";
import { LineMaterial } from "three/addons/lines/LineMaterial.js";
import type { ArcBuffer } from "../session";
import { CameraDirector } from "./CameraDirector";
import { EarthBody, LitBody, MoonBody, SunBody } from "./Globe";
import { StarField } from "./Stars";
import { SunLensFlare } from "./SunFlare";
import type { CameraMode } from "./camera";
import { readCraft } from "./craftPose";
import type { CraftPose } from "./craftPose";
import type { SceneClock } from "./types";

const CRAFT_ORIGIN = new Float32Array([0, 0, 0]);
const CENTER_ORIGIN = new Float32Array([0, 0, 0]);
/** Framebuffer pixels across the strip. The falloff below keeps the bright core near one pixel. */
const ARC_WIDTH_PX = 2;

export type TrajectoryLine = "all" | "trail" | "hidden";

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
  /** Full arc, the path already flown, or nothing. */
  trajectoryLine: TrajectoryLine;
  /** CSS hex color for the trajectory. */
  trajectoryColor: string;
  /** Screen name for the center body. */
  showBodyName: boolean;
  /** Screen name for the spacecraft. */
  showObjectName: boolean;
  /** Sun-lit body. Earth uses day and night maps, oriented in EME2000. The Sun is a white disk with a lens flare. */
  realistic: boolean;
  /** Earth day map with clouds. Ignored unless realistic Earth is showing. */
  clouds: boolean;
  /** Star field. Ignored unless realistic is showing. */
  stars: boolean;
  /** Screen labels. The scene writes their position each frame. */
  centerLabelEl: RefObject<HTMLSpanElement | null>;
  objectLabelEl: RefObject<HTMLSpanElement | null>;
  /** Equatorial radius of the body at the origin. Null draws an origin mark. */
  bodyRadiusKm: number | null;
  resetToken: number;
  cameraMode: CameraMode;
  onCameraMode: (mode: CameraMode) => void;
};

/** Coverage falloff across the screen-space strip, so the arc edge blends out. */
function withEdgeFalloff(source: string): string {
  return source
    .replace(
      "if ( len2 > 1.0 ) discard;",
      "alpha *= 1.0 - smoothstep( 0.35, 1.0, len2 );",
    )
    .replace(
      "gl_FragColor = vec4( diffuseColor.rgb, alpha );",
      "alpha *= 1.0 - smoothstep( 0.35, 1.0, abs( vUv.x ) );\n\t\t\tgl_FragColor = vec4( diffuseColor.rgb, alpha );",
    );
}

/** Greatest vertex index whose time is at or before `t`, or -1 when the arc is still ahead. */
function lastAtOrBefore(times: Float32Array, t: number): number {
  let lo = 0;
  let hi = times.length - 1;
  let found = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (times[mid] <= t) {
      found = mid;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }
  return found;
}

function ArcLine({
  positions,
  times,
  opacity,
  color,
  trail,
  clock,
}: {
  positions: Float32Array;
  times: Float32Array;
  opacity: number;
  color: string;
  trail: boolean;
  clock: { current: SceneClock };
}) {
  const line = useMemo(() => {
    const geometry = new LineGeometry();
    geometry.setPositions(positions);
    const ends = geometry.getAttribute("instanceEnd") as THREE.InterleavedBufferAttribute;
    ends.data.setUsage(THREE.DynamicDrawUsage);
    const material = new LineMaterial({
      color,
      transparent: true,
      opacity,
      depthWrite: false,
      toneMapped: false,
    });
    material.uniforms.linewidth.value = ARC_WIDTH_PX;
    material.fragmentShader = withEdgeFalloff(material.fragmentShader);
    const next = new Line2(geometry, material);
    next.frustumCulled = false;
    return next;
  }, [positions]);
  const tip = useRef(-1);
  useLayoutEffect(() => {
    line.material.color.set(color);
    line.material.opacity = opacity;
  }, [line, color, opacity]);
  useEffect(() => {
    return () => {
      line.geometry.dispose();
      line.material.dispose();
    };
  }, [line]);
  useFrame(() => {
    const geometry = line.geometry;
    const end = geometry.getAttribute("instanceEnd") as THREE.InterleavedBufferAttribute;
    const full = Math.max(0, positions.length / 3 - 1);
    const restore = (segment: number) => {
      const offset = (segment + 1) * 3;
      end.setXYZ(segment, positions[offset], positions[offset + 1], positions[offset + 2]);
      end.data.addUpdateRange(segment * end.data.stride + end.offset, 3);
      end.needsUpdate = true;
    };
    if (!trail || times.length < 2) {
      if (tip.current >= 0) {
        restore(tip.current);
        tip.current = -1;
      }
      line.visible = full > 0;
      if (geometry.instanceCount !== full) geometry.instanceCount = full;
      return;
    }
    const index = lastAtOrBefore(times, clock.current.t);
    if (index < 0) {
      if (tip.current >= 0) {
        restore(tip.current);
        tip.current = -1;
      }
      line.visible = false;
      geometry.instanceCount = 0;
      return;
    }
    line.visible = true;
    if (index >= times.length - 1) {
      if (tip.current >= 0) {
        restore(tip.current);
        tip.current = -1;
      }
      if (geometry.instanceCount !== full) geometry.instanceCount = full;
      return;
    }
    if (tip.current >= 0 && tip.current !== index) restore(tip.current);
    const start = times[index];
    const stop = times[index + 1];
    const span = stop - start;
    const u = span > 0 ? (clock.current.t - start) / span : 1;
    const from = index * 3;
    const to = from + 3;
    end.setXYZ(
      index,
      positions[from] + (positions[to] - positions[from]) * u,
      positions[from + 1] + (positions[to + 1] - positions[from + 1]) * u,
      positions[from + 2] + (positions[to + 2] - positions[from + 2]) * u,
    );
    end.data.addUpdateRange(index * end.data.stride + end.offset, 3);
    end.needsUpdate = true;
    tip.current = index;
    geometry.instanceCount = index + 1;
  });
  return <primitive object={line} />;
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

const LABEL_ORIGIN = new THREE.Vector3();

/** Pixels from the projected center up to the near side of the limb. */
function limbLiftPx(camera: THREE.Camera, radiusKm: number, height: number): number {
  if (radiusKm <= 0 || !(camera instanceof THREE.PerspectiveCamera)) return 0;
  const dist = camera.position.length();
  if (dist <= radiusKm) return 0;
  const half = Math.tan(THREE.MathUtils.degToRad(camera.fov) * 0.5);
  return (radiusKm / dist) / half * height * 0.5;
}

function placeLabel(
  el: HTMLSpanElement | null,
  world: THREE.Vector3,
  show: boolean,
  camera: THREE.Camera,
  size: { width: number; height: number },
  pixelRatio: number,
  liftPx: number,
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
  const pixel = Math.max(pixelRatio, 1);
  const x = Math.round((scratch.x * 0.5 + 0.5) * size.width * pixel) / pixel;
  const y = Math.round(((-scratch.y * 0.5 + 0.5) * size.height - liftPx) * pixel) / pixel;
  el.style.visibility = "visible";
  el.style.transform = `translate3d(${x}px, ${y}px, 0) translate(-50%, calc(-100% - 8px))`;
}

/** Screen-space names. The center sits just above its limb; a point sits just above the mark. */
function SceneLabels({
  centerLabel,
  objectLabel,
  showBodyName,
  showObjectName,
  radiusKm,
  pose,
  centerEl,
  craftEl,
}: {
  centerLabel: string;
  objectLabel: string;
  showBodyName: boolean;
  showObjectName: boolean;
  radiusKm: number;
  pose: RefObject<CraftPose | null>;
  centerEl: RefObject<HTMLSpanElement | null>;
  craftEl: RefObject<HTMLSpanElement | null>;
}) {
  const scratch = useMemo(() => new THREE.Vector3(), []);
  const forward = useMemo(() => new THREE.Vector3(), []);
  // Mounted last so this runs after the camera director. lookAt leaves the view
  // matrix stale, and a fast orbit or a high playback rate would otherwise leave
  // the names a frame behind the craft. The center name is a screen offset above
  // the body, so it does not ride a surface point while the camera translates.
  useFrame(({ camera, size, gl }) => {
    camera.updateMatrixWorld();
    const pixelRatio = gl.getPixelRatio();
    const inside = radiusKm > 0 && camera.position.length() <= radiusKm;
    placeLabel(
      centerEl.current,
      LABEL_ORIGIN,
      showBodyName && Boolean(centerLabel) && !inside,
      camera,
      size,
      pixelRatio,
      limbLiftPx(camera, radiusKm, size.height),
      scratch,
      forward,
    );
    const sample = pose.current;
    placeLabel(
      craftEl.current,
      sample?.pos ?? LABEL_ORIGIN,
      showObjectName && Boolean(sample?.ok && objectLabel),
      camera,
      size,
      pixelRatio,
      0,
      scratch,
      forward,
    );
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
  trajectoryLine,
  trajectoryColor,
  showBodyName,
  showObjectName,
  realistic,
  clouds,
  stars,
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
      {realistic && stars && <StarField />}
      {realistic && centerName === "SUN" && bodyRadiusKm != null && bodyRadiusKm > 0 ? (
        <>
          <SunBody radiusKm={bodyRadiusKm} />
          <SunLensFlare radiusKm={bodyRadiusKm} />
        </>
      ) : realistic && centerName === "EARTH" && bodyRadiusKm != null && bodyRadiusKm > 0 ? (
        <EarthBody radiusKm={bodyRadiusKm} clock={clock} clouds={clouds} />
      ) : realistic && centerName === "MOON" && bodyRadiusKm != null && bodyRadiusKm > 0 ? (
        <MoonBody radiusKm={bodyRadiusKm} clock={clock} />
      ) : realistic && bodyRadiusKm != null && bodyRadiusKm > 0 ? (
        <LitBody radiusKm={bodyRadiusKm} clock={clock} />
      ) : bodyRadiusKm != null && bodyRadiusKm > 0 ? (
        <BodySphere radiusKm={bodyRadiusKm} />
      ) : (
        <OriginMark />
      )}
      {trajectoryLine !== "hidden" && arcs.map((arc) => (
        <ArcLine
          key={arc.segmentIndex}
          positions={arc.positions}
          times={arc.times}
          opacity={arc.segmentIndex === selected ? 0.95 : 0.32}
          color={trajectoryColor}
          trail={trajectoryLine === "trail"}
          clock={clock}
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
        minDistance={cameraMode !== "overview" && (bodyRadiusKm ?? 0) > 1000 ? 40 : 0.15}
        maxDistance={Math.max(fit, 16) * 30}
      />
      <CameraRig fit={fit} resetToken={resetToken} mode={cameraMode} />
      <CameraDirector pose={pose} mode={cameraMode} bodyRadiusKm={bodyRadiusKm ?? 0} onCameraMode={onCameraMode} />
      <SceneLabels
        centerLabel={centerLabel}
        objectLabel={objectLabel}
        showBodyName={showBodyName}
        showObjectName={showObjectName}
        radiusKm={bodyRadiusKm ?? 0}
        pose={pose}
        centerEl={centerLabelEl}
        craftEl={objectLabelEl}
      />
    </Canvas>
  );
}
