import { Canvas, useFrame } from "@react-three/fiber";
import { useState, useEffect, useRef } from "react";
import * as THREE from "three";

function supportsWebGL(): boolean {
  try {
    const c = document.createElement("canvas");
    return !!(c.getContext("webgl") || c.getContext("experimental-webgl"));
  } catch {
    return false;
  }
}

function Orb({
  position,
  color,
  scale,
  phaseOffset,
}: {
  position: [number, number, number];
  color: string;
  scale: number;
  phaseOffset: number;
}) {
  const ref = useRef<THREE.Mesh>(null);
  useFrame(({ clock }) => {
    if (!ref.current) return;
    const t = clock.elapsedTime + phaseOffset;
    ref.current.position.y = position[1] + Math.sin(t * 0.7) * 0.28;
    ref.current.rotation.x = t * 0.12;
    ref.current.rotation.y = t * 0.18;
  });
  return (
    <mesh ref={ref} position={position} scale={scale}>
      <sphereGeometry args={[1, 48, 48]} />
      <meshStandardMaterial
        color={color}
        transparent
        opacity={0.52}
        roughness={0.08}
        metalness={0.06}
        emissive={color}
        emissiveIntensity={0.2}
      />
    </mesh>
  );
}

export default function HeroOrb3D() {
  const [webglOk, setWebglOk] = useState<boolean | null>(null);

  useEffect(() => {
    setWebglOk(supportsWebGL());
  }, []);

  if (!webglOk) return null;

  return (
    <Canvas
      camera={{ position: [0, 0, 6.5], fov: 48 }}
      gl={{ alpha: true, antialias: true }}
      style={{ pointerEvents: "none" }}
      dpr={[1, 1.5]}
    >
      <ambientLight intensity={0.9} />
      <directionalLight position={[6, 8, 5]} intensity={1.4} color="#ffffff" />
      <pointLight position={[-5, -4, -3]} color="#2EC4A5" intensity={2.2} />
      <pointLight position={[4, 4, 2]} color="#7ce8d4" intensity={1.1} />
      <Orb position={[1.2, 0, 0]} color="#2EC4A5" scale={1.55} phaseOffset={0} />
      <Orb position={[-1.4, 0.6, -0.5]} color="#6dd5c2" scale={0.9} phaseOffset={2.1} />
      <Orb position={[0.3, -1.3, -0.6]} color="#a7dfd0" scale={0.6} phaseOffset={4.3} />
    </Canvas>
  );
}
