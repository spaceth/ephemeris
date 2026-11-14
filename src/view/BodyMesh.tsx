import { useEffect, useMemo } from "react";
import * as THREE from "three";
import type { BodyRecord } from "../core/ephemeris/bodies";
import { EarthBody, JupiterBody, LitBody, MoonBody, SunBody } from "./Globe";
import type { SceneClock } from "./types";

const MARK = new Float32Array([0, 0, 0]);

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
 * sphere in minimal style. Earth, the Moon, and Jupiter keep their maps.
 */
export function BodyMesh({
  record,
  radiusKm,
  realistic,
  clouds,
  clock,
}: {
  record: BodyRecord | null;
  radiusKm: number | null;
  realistic: boolean;
  clouds: boolean;
  clock: { current: SceneClock };
}) {
  const radius = record?.radiusKm ?? radiusKm;
  if (record?.appearance === "sun" && radius != null && radius > 0) {
    return <SunBody radiusKm={radius} />;
  }
  if (!(radius != null && radius > 0)) return <OriginMark />;
  if (!realistic) return <BodySphere radiusKm={radius} />;
  if (record?.appearance === "earth") return <EarthBody radiusKm={radius} clock={clock} clouds={clouds} />;
  if (record?.appearance === "moon") return <MoonBody radiusKm={radius} clock={clock} />;
  if (record?.appearance === "jupiter") return <JupiterBody radiusKm={radius} clock={clock} />;
  return <LitBody radiusKm={radius} clock={clock} bodyId={record?.id} />;
}
