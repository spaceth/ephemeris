import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { OrbitControls } from "@react-three/drei";
import { useEffect, useLayoutEffect, useMemo, useRef } from "react";
import type { RefObject } from "react";
import * as THREE from "three";
import { Line2 } from "three/addons/lines/Line2.js";
import { LineGeometry } from "three/addons/lines/LineGeometry.js";
import { LineMaterial } from "three/addons/lines/LineMaterial.js";
import type { ArcBuffer } from "../session";
import { orbitCenter } from "../core";
import { toScene } from "../core/scene";
import { bodyByName } from "../core/ephemeris/bodies";
import { centerNaif, placeCenter } from "../core/ephemeris/place";
import { tdbFromTaiClock } from "../core/ephemeris/scales";
import { lightingKernel } from "../core/ephemeris/sunLight";
import { BodyMesh } from "./BodyMesh";
import { CameraDirector } from "./CameraDirector";
import { CaptureBridge } from "./CaptureBridge";
import type { CaptureHandle } from "./CaptureBridge";
import type { SphereObstacle } from "./CameraDirector";
import { Neighbors } from "./Neighbors";
import { StarField } from "./Stars";
import { SunLensFlare } from "./SunFlare";
import type { FlareTune } from "./flareTune";
import type { CameraMode } from "./camera";
import { readCraft } from "./craftPose";
import type { CraftPose } from "./craftPose";
import { queueSceneLabel, settleSceneLabels } from "./labelLayout";
import type { SceneClock } from "./types";

const CRAFT_ORIGIN = new Float32Array([0, 0, 0]);
/** Framebuffer pixels across the strip. The falloff below keeps the bright core near one pixel. */
const ARC_WIDTH_PX = 2;

export type TrajectoryLine = "all" | "trail" | "short" | "hidden";

/** Share of an arc kept behind the craft. The older end of that piece fades out. */
const SHORT_TRAIL_FRACTION = 0.08;
/** Portion of the short trail, measured from the older end, that fades in. */
const SHORT_TRAIL_FADE = 0.45;

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
  /** Full arc, the path already flown, a short fading trail, or nothing. */
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
  /** Names for the snapshot neighbors. Unused slots stay hidden. */
  neighborLabelEls: RefObject<HTMLSpanElement | null>[];
  /** Live sun-flare overrides from the temporary panel. */
  flareTune: RefObject<FlareTune>;
  /** Filled once the canvas can copy a frame. */
  capture: RefObject<CaptureHandle | null>;
  /** Holds the drawing buffer at pixel ratio 1 while a frame is saved. */
  capturing: boolean;
};

/** Fade along the short trail. 0 at the older end, solid once `SHORT_TRAIL_FADE` of the window is passed. */
function shortTrailFade(oldest: number, newest: number, time: number): number {
  const span = newest - oldest;
  if (!(span > 0)) return 1;
  const u = (time - oldest) / span;
  if (u <= 0) return 0;
  if (u >= SHORT_TRAIL_FADE) return 1;
  const x = u / SHORT_TRAIL_FADE;
  return x * x * (3 - 2 * x);
}

function shortTrailOldest(start: number, stop: number, time: number): number {
  const span = stop - start;
  const window = span > 0 ? span * SHORT_TRAIL_FRACTION : 0;
  return Math.max(start, time - window);
}

/** Per-segment fade. 0 at the older end of a short trail, 1 along a full arc. */
function withTrailFade(vertex: string, fragment: string): { vertex: string; fragment: string } {
  return {
    vertex: vertex
      .replace(
        "attribute vec3 instanceEnd;",
        "attribute vec3 instanceEnd;\n\t\tattribute float instanceFadeStart;\n\t\tattribute float instanceFadeEnd;\n\t\tvarying float vFade;",
      )
      .replace(
        "void main() {",
        "void main() {\n\t\t\tvFade = ( position.y < 0.5 ) ? instanceFadeStart : instanceFadeEnd;",
      ),
    fragment: fragment
      .replace(
        "uniform float opacity;",
        "uniform float opacity;\n\t\tuniform float shortTrail;\n\t\tvarying float vFade;",
      )
      .replace(
        "float alpha = opacity;",
        "float alpha = opacity;\n\t\t\talpha *= mix( 1.0, vFade, shortTrail );",
      ),
  };
}

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

/** Writes the short trail into the line buffers. Returns the number of segments drawn. */
function writeShortTrail(
  positions: Float32Array,
  times: Float32Array,
  time: number,
  posData: Float32Array,
  fadeStart: Float32Array,
  fadeEnd: Float32Array,
): number {
  const tip = lastAtOrBefore(times, time);
  if (tip < 0 || times.length < 2) return 0;
  const newest = Math.min(time, times[times.length - 1]);
  const oldest = shortTrailOldest(times[0], times[times.length - 1], newest);
  if (!(newest > oldest)) return 0;
  const tail = lastAtOrBefore(times, oldest);
  if (tail < 0) return 0;
  const capacity = Math.min(Math.floor(posData.length / 6), fadeStart.length, fadeEnd.length);
  let count = 0;
  let px = 0;
  let py = 0;
  let pz = 0;
  let pf = 0;
  let has = false;
  const emit = (x: number, y: number, z: number, fade: number) => {
    if (!has) {
      px = x;
      py = y;
      pz = z;
      pf = fade;
      has = true;
      return;
    }
    if (count >= capacity) return;
    const o = count * 6;
    posData[o] = px;
    posData[o + 1] = py;
    posData[o + 2] = pz;
    posData[o + 3] = x;
    posData[o + 4] = y;
    posData[o + 5] = z;
    fadeStart[count] = pf;
    fadeEnd[count] = fade;
    count += 1;
    px = x;
    py = y;
    pz = z;
    pf = fade;
  };
  const vertex = (index: number, at: number) => {
    const i = index * 3;
    emit(positions[i], positions[i + 1], positions[i + 2], shortTrailFade(oldest, newest, at));
  };
  const lerp = (index: number, u: number, at: number) => {
    const i = index * 3;
    const j = i + 3;
    emit(
      positions[i] + (positions[j] - positions[i]) * u,
      positions[i + 1] + (positions[j + 1] - positions[i + 1]) * u,
      positions[i + 2] + (positions[j + 2] - positions[i + 2]) * u,
      shortTrailFade(oldest, newest, at),
    );
  };
  if (tail < tip) {
    const span = times[tail + 1] - times[tail];
    const u = span > 0 ? (oldest - times[tail]) / span : 0;
    if (u > 0) lerp(tail, Math.min(u, 1), oldest);
    else vertex(tail, times[tail]);
    for (let i = tail + 1; i <= tip; i += 1) vertex(i, times[i]);
  } else if (tip < times.length - 1) {
    const span = times[tip + 1] - times[tip];
    const u = span > 0 ? (oldest - times[tip]) / span : 0;
    lerp(tip, Math.max(0, Math.min(u, 1)), oldest);
  }
  if (tip < times.length - 1) {
    const span = times[tip + 1] - times[tip];
    const u = span > 0 ? (newest - times[tip]) / span : 1;
    lerp(tip, Math.max(0, Math.min(u, 1)), newest);
  } else if (tail === tip) {
    vertex(tip, times[tip]);
  }
  return count;
}

function ArcLine({
  positions,
  times,
  opacity,
  color,
  mode,
  clock,
}: {
  positions: Float32Array;
  times: Float32Array;
  opacity: number;
  color: string;
  mode: TrajectoryLine;
  clock: { current: SceneClock };
}) {
  const line = useMemo(() => {
    const geometry = new LineGeometry();
    geometry.setPositions(positions);
    const segments = Math.max(0, positions.length / 3 - 1);
    const ends = geometry.getAttribute("instanceEnd") as THREE.InterleavedBufferAttribute;
    ends.data.setUsage(THREE.DynamicDrawUsage);
    const fadeStart = new THREE.InstancedBufferAttribute(new Float32Array(Math.max(segments, 1)), 1);
    const fadeEnd = new THREE.InstancedBufferAttribute(new Float32Array(Math.max(segments, 1)), 1);
    fadeStart.setUsage(THREE.DynamicDrawUsage);
    fadeEnd.setUsage(THREE.DynamicDrawUsage);
    for (let i = 0; i < fadeStart.count; i += 1) {
      fadeStart.setX(i, 1);
      fadeEnd.setX(i, 1);
    }
    geometry.setAttribute("instanceFadeStart", fadeStart);
    geometry.setAttribute("instanceFadeEnd", fadeEnd);
    const material = new LineMaterial({
      color,
      transparent: true,
      opacity,
      depthWrite: false,
      toneMapped: false,
    });
    material.uniforms.linewidth.value = ARC_WIDTH_PX;
    material.uniforms.shortTrail = { value: 0 };
    const faded = withTrailFade(material.vertexShader, material.fragmentShader);
    material.vertexShader = faded.vertex;
    material.fragmentShader = withEdgeFalloff(faded.fragment);
    const next = new Line2(geometry, material);
    next.frustumCulled = false;
    return next;
  }, [positions]);
  const tip = useRef(-1);
  const rewritten = useRef(false);
  useLayoutEffect(() => {
    line.material.color.set(color);
    line.material.opacity = opacity;
    line.material.uniforms.shortTrail.value = mode === "short" ? 1 : 0;
    if (mode === "short") line.geometry.instanceCount = 0;
  }, [line, color, opacity, mode]);
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
    const fadeStart = geometry.getAttribute("instanceFadeStart") as THREE.InstancedBufferAttribute;
    const fadeEnd = geometry.getAttribute("instanceFadeEnd") as THREE.InstancedBufferAttribute;
    if (rewritten.current && mode !== "short") {
      const posData = end.data.array as Float32Array;
      for (let i = 0; i < full; i += 1) {
        const p = i * 3;
        const o = i * 6;
        posData[o] = positions[p];
        posData[o + 1] = positions[p + 1];
        posData[o + 2] = positions[p + 2];
        posData[o + 3] = positions[p + 3];
        posData[o + 4] = positions[p + 4];
        posData[o + 5] = positions[p + 5];
      }
      end.data.addUpdateRange(0, full * 6);
      end.needsUpdate = true;
      (fadeStart.array as Float32Array).fill(1);
      (fadeEnd.array as Float32Array).fill(1);
      fadeStart.addUpdateRange(0, fadeStart.count);
      fadeEnd.addUpdateRange(0, fadeEnd.count);
      fadeStart.needsUpdate = true;
      fadeEnd.needsUpdate = true;
      rewritten.current = false;
      tip.current = -1;
    }
    if (mode === "short") {
      const drawn = writeShortTrail(
        positions,
        times,
        clock.current.t,
        end.data.array as Float32Array,
        fadeStart.array as Float32Array,
        fadeEnd.array as Float32Array,
      );
      rewritten.current = true;
      tip.current = -1;
      line.visible = drawn > 0;
      if (drawn > 0) {
        end.data.addUpdateRange(0, drawn * 6);
        end.needsUpdate = true;
        fadeStart.addUpdateRange(0, drawn);
        fadeEnd.addUpdateRange(0, drawn);
        fadeStart.needsUpdate = true;
        fadeEnd.needsUpdate = true;
      }
      if (geometry.instanceCount !== drawn) geometry.instanceCount = drawn;
      return;
    }
    if (mode !== "trail" || times.length < 2) {
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

function sceneMeters(meters: Float32Array): Float32Array {
  const out = new Float32Array(meters.length);
  for (let i = 0; i < meters.length; i += 3) {
    const [x, y, z] = toScene(meters[i], meters[i + 1], meters[i + 2]);
    out[i] = x;
    out[i + 1] = y;
    out[i + 2] = z;
  }
  return out;
}

/** One segment arc. Vertices stay center-relative. The group is the center, placed once per frame. */
function PlacedArc({
  arc,
  viewingCenter,
  opacity,
  color,
  mode,
  clock,
  reach,
}: {
  arc: ArcBuffer;
  viewingCenter: string | null;
  opacity: number;
  color: string;
  mode: TrajectoryLine;
  clock: { current: SceneClock };
  reach: RefObject<number>;
}) {
  const positions = useMemo(() => sceneMeters(arc.positions), [arc]);
  const localReach = useMemo(() => {
    let radius = 0;
    for (let i = 0; i < positions.length; i += 3) {
      radius = Math.max(radius, Math.hypot(positions[i], positions[i + 1], positions[i + 2]));
    }
    return radius;
  }, [positions]);
  const group = useRef<THREE.Group>(null);
  useFrame(() => {
    const node = group.current;
    if (!node) return;
    const file = clock.current.file;
    const origin = file?.origin ?? null;
    if (!origin) {
      node.visible = false;
      return;
    }
    const segmentCenter = file?.segments[arc.segmentIndex]?.centerName ?? null;
    const et = tdbFromTaiClock(origin, clock.current.t);
    const kernel = lightingKernel();
    const placed = placeCenter(segmentCenter, viewingCenter, kernel ? [kernel] : [], et.secondsPastJ2000);
    if (!placed.ok) {
      node.visible = false;
      return;
    }
    const [x, y, z] = toScene(placed.positionM[0], placed.positionM[1], placed.positionM[2]);
    node.position.set(x, y, z);
    node.visible = true;
    const span = Math.hypot(x, y, z) + localReach;
    if (span > reach.current) reach.current = span;
  });
  return (
    <group ref={group} visible={false}>
      <ArcLine positions={positions} times={arc.times} opacity={opacity} color={color} mode={mode} clock={clock} />
    </group>
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
  pinned: boolean,
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
  queueSceneLabel(el, x, y, pinned);
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
      true,
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
      false,
    );
  });
  return null;
}

/** Runs after the names are queued, so a covering label can be moved aside. */
function LabelSettle() {
  // Priority stays 0. A positive priority makes this callback the renderer and skips the scene draw.
  useFrame(() => {
    settleSceneLabels();
  });
  return null;
}

function CameraRig({
  fit,
  reach,
  resetToken,
  mode,
}: {
  fit: number;
  reach: RefObject<number>;
  resetToken: number;
  mode: CameraMode;
}) {
  const camera = useThree((state) => state.camera);
  const controls = useThree((state) => state.controls) as { target?: THREE.Vector3; update?: () => void } | null;
  const systemPlaced = useRef(false);
  useEffect(() => {
    systemPlaced.current = false;
    if (mode !== "overview") return;
    const radius = Math.max(fit, 16);
    camera.up.set(0, 1, 0);
    camera.position.set(radius * 0.2, radius * 0.55, radius * 1.45);
    camera.near = 0.02;
    // Past 1 AU (1.5e8 km) so the solar disk stays inside the frustum.
    camera.far = Math.max(radius * 80, 1e9);
    camera.lookAt(0, 0, 0);
    camera.updateProjectionMatrix();
    controls?.target?.set(0, 0, 0);
    controls?.update?.();
  }, [camera, controls, fit, mode, resetToken]);
  useFrame(() => {
    if (mode !== "system" || systemPlaced.current || reach.current <= 0) return;
    const radius = Math.max(reach.current, 16);
    camera.up.set(0, 1, 0);
    camera.position.set(radius * 0.2, radius * 0.55, radius * 1.45);
    camera.near = 0.02;
    camera.far = Math.max(radius * 8, 1e9);
    camera.lookAt(0, 0, 0);
    camera.updateProjectionMatrix();
    controls?.target?.set(0, 0, 0);
    controls?.update?.();
    systemPlaced.current = true;
  });
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
  neighborLabelEls,
  flareTune,
  capture,
  capturing,
}: OrbitProps) {
  const pose = useRef<CraftPose | null>(null);
  const obstacles = useRef<SphereObstacle[]>([]);
  const reach = useRef(0);
  const exporting = useRef(false);
  const centerBody = useMemo(() => {
    const known = centerName ? orbitCenter(centerName) : null;
    return known ? bodyByName(known.name) : null;
  }, [centerName]);
  return (
    <Canvas
      className="stage"
      gl={{ antialias: true, logarithmicDepthBuffer: true, alpha: false }}
      camera={{ fov: 42, position: [8, 24, 48], near: 0.02, far: 1e10 }}
      dpr={capturing ? 1 : [1, 2]}
    >
      <CaptureBridge
        handle={capture}
        exporting={exporting}
        labels={[centerLabelEl, objectLabelEl, ...neighborLabelEls]}
      />
      <color attach="background" args={["#000000"]} />
      {realistic && stars && <StarField />}
      <BodyMesh record={centerBody} radiusKm={bodyRadiusKm} realistic={realistic} clouds={clouds} clock={clock} />
      <Neighbors
        clock={clock}
        centerName={centerName}
        realistic={realistic}
        clouds={clouds}
        showNames={showBodyName}
        obstacles={obstacles}
        reach={reach}
        labelEls={neighborLabelEls}
      />
      {realistic && centerNaif(centerName) != null && <SunLensFlare tune={flareTune} />}
      {trajectoryLine !== "hidden" && arcs.map((arc) => (
        <PlacedArc
          key={arc.segmentIndex}
          arc={arc}
          viewingCenter={centerName}
          opacity={arc.segmentIndex === selected ? 0.95 : 0.32}
          color={trajectoryColor}
          mode={trajectoryLine}
          clock={clock}
          reach={reach}
        />
      ))}
      <CraftProbe clock={clock} pose={pose} />
      <Craft pose={pose} />
      <OrbitControls
        makeDefault
        enabled={!capturing}
        enablePan={!capturing && (cameraMode === "overview" || cameraMode === "system")}
        enableDamping={!capturing}
        dampingFactor={0.08}
        minDistance={cameraMode !== "overview" && cameraMode !== "system" && (bodyRadiusKm ?? 0) > 1000 ? 40 : 0.15}
        maxDistance={cameraMode === "system" || centerNaif(centerName) != null ? 1e9 : Math.max(fit, 16) * 30}
      />
      <CameraRig fit={fit} reach={reach} resetToken={resetToken} mode={cameraMode} />
      <CameraDirector
        pose={pose}
        mode={cameraMode}
        bodyRadiusKm={bodyRadiusKm ?? 0}
        obstacles={obstacles}
        onCameraMode={onCameraMode}
        exporting={exporting}
      />
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
      <LabelSettle />
    </Canvas>
  );
}
