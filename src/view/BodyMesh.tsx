import { useFrame } from "@react-three/fiber";
import { useEffect, useMemo, useRef } from "react";
import type { ReactNode } from "react";
import * as THREE from "three";
import { planetPose, tdbFromTaiClock } from "../core";
import type { BodyRecord } from "../core/ephemeris/bodies";
import { EarthBody, LitBody, MappedBody, MoonBody, SunBody } from "./Globe";
import { projectedDiameterPx } from "./pixel";
import type { SceneClock } from "./types";

const MARK = new Float32Array([0, 0, 0]);

/**
 * IAU spin for one planet. The quaternion is the scene matrix from the PCK
 * pole and prime meridian. Position and scale stay at the identity so the
 * orbit, which lives on an ancestor, is unchanged. Earth and the Moon do
 * not use this group.
 */
function IauOrient({
  bodyId,
  clock,
  children,
}: {
  bodyId: number;
  clock: { current: SceneClock };
  children: ReactNode;
}) {
  const group = useRef<THREE.Group>(null);
  const scratch = useMemo(() => new THREE.Matrix4(), []);
  useFrame(() => {
    const node = group.current;
    if (!node) return;
    node.position.set(0, 0, 0);
    node.scale.set(1, 1, 1);
    const origin = clock.current.file?.origin ?? null;
    if (!origin) {
      node.quaternion.identity();
      return;
    }
    const seconds = tdbFromTaiClock(origin, clock.current.t).secondsPastJ2000;
    const pose = planetPose(bodyId, seconds);
    if (!pose) {
      node.quaternion.identity();
      return;
    }
    const rows = pose.scene;
    scratch.set(
      rows[0], rows[1], rows[2], 0,
      rows[3], rows[4], rows[5], 0,
      rows[6], rows[7], rows[8], 0,
      0, 0, 0, 1,
    );
    node.quaternion.setFromRotationMatrix(scratch);
  });
  return <group ref={group}>{children}</group>;
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

const WORLD = new THREE.Vector3();
const FORWARD = new THREE.Vector3();
const TO_CAMERA = new THREE.Vector3();

const DOT_MATERIAL = new THREE.PointsMaterial({
  color: "#ffffff",
  size: 1,
  sizeAttenuation: false,
  toneMapped: false,
  transparent: false,
  depthTest: true,
  depthWrite: true,
});

/**
 * The sphere stays while it covers a pixel. Below that, a body in frame
 * is one white pixel. The Sun mesh stays in the scene either way so its flare can find it.
 */
function MinimumPixel({
  radiusKm,
  keepBody,
  children,
}: {
  radiusKm: number;
  keepBody: boolean;
  children: ReactNode;
}) {
  const body = useRef<THREE.Group>(null);
  const dot = useRef<THREE.Points>(null);
  const geometry = useMemo(() => {
    const point = new THREE.BufferGeometry();
    point.setAttribute("position", new THREE.BufferAttribute(new Float32Array([0, 0, 0]), 3));
    return point;
  }, []);
  useEffect(() => () => geometry.dispose(), [geometry]);
  useFrame(({ camera, size, gl }) => {
    const bodyNode = body.current;
    const dotNode = dot.current;
    if (!bodyNode || !dotNode) return;
    const ratio = Math.max(gl.getPixelRatio(), 1);
    if (DOT_MATERIAL.size !== ratio) DOT_MATERIAL.size = ratio;
    bodyNode.getWorldPosition(WORLD);
    const distance = camera.position.distanceTo(WORLD);
    const fov = camera instanceof THREE.PerspectiveCamera ? camera.fov : 42;
    const tiny = projectedDiameterPx(fov, distance, radiusKm, size.height) < 1;
    bodyNode.visible = keepBody || !tiny;
    if (!tiny) {
      dotNode.visible = false;
      dotNode.position.set(0, 0, 0);
      return;
    }
    const ahead = TO_CAMERA.copy(WORLD).sub(camera.position).dot(camera.getWorldDirection(FORWARD)) > 0;
    const ndc = WORLD.clone().project(camera);
    const onScreen = ahead && ndc.z >= -1 && ndc.z <= 1 && Math.abs(ndc.x) <= 1 && Math.abs(ndc.y) <= 1;
    dotNode.visible = onScreen;
    if (!onScreen || !keepBody) {
      dotNode.position.set(0, 0, 0);
      return;
    }
    bodyNode.worldToLocal(TO_CAMERA.copy(camera.position));
    const reach = TO_CAMERA.length();
    if (!(reach > 1)) {
      dotNode.position.set(0, 0, 0);
      return;
    }
    const place = Math.min(radiusKm + 1, reach * 0.5);
    dotNode.position.copy(TO_CAMERA.multiplyScalar(place / reach));
  });
  return (
    <>
      <group ref={body}>{children}</group>
      <points ref={dot} frustumCulled={false} visible={false} geometry={geometry} material={DOT_MATERIAL} />
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
        <bufferAttribute attach="attributes-position" args={[MARK, 3]} />
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

/**
 * The sphere or origin mark for one catalog record.
 * The Sun stays its disk in either style. Every other body is the gray
 * sphere in minimal style. Realistic style uses a map when the record has one.
 */
export function BodyMesh({
  record,
  radiusKm,
  realistic,
  clouds,
  clock,
  mark = true,
}: {
  record: BodyRecord | null;
  radiusKm: number | null;
  realistic: boolean;
  clouds: boolean;
  clock: { current: SceneClock };
  /** Point bodies (a barycenter, a Lagrange point) draw this mark with their name. */
  mark?: boolean;
}) {
  const radius = record?.radiusKm ?? radiusKm;
  if (!(radius != null && radius > 0)) return mark ? <OriginMark /> : null;
  const sun = record?.appearance === "sun";
  let body: ReactNode;
  if (sun) body = <SunBody radiusKm={radius} />;
  else if (!realistic) body = <BodySphere radiusKm={radius} />;
  else if (record?.appearance === "earth") body = <EarthBody radiusKm={radius} clock={clock} clouds={clouds} />;
  else if (record?.appearance === "moon") body = <MoonBody radiusKm={radius} clock={clock} />;
  else if (record?.texture) {
    body = (
      <MappedBody
        radiusKm={radius}
        clock={clock}
        bodyId={record.id}
        mapUrl={record.texture}
        ringUrl={record.ring}
      />
    );
  } else body = <LitBody radiusKm={radius} clock={clock} bodyId={record?.id} />;
  if (record?.attitude === "iau") {
    body = (
      <IauOrient bodyId={record.id} clock={clock}>
        {body}
      </IauOrient>
    );
  }
  return (
    <MinimumPixel radiusKm={radius} keepBody={sun}>
      {body}
    </MinimumPixel>
  );
}
