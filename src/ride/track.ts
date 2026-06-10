import * as THREE from "three";

export interface TrackFrame {
  position: THREE.Vector3;
  tangent: THREE.Vector3;
  normal: THREE.Vector3;
  right: THREE.Vector3;
  unbankedNormal: THREE.Vector3;
  bank: number;
  curvature: number;
  slope: number;
}

export interface TrackData {
  curve: THREE.CatmullRomCurve3;
  length: number;
  samples: TrackFrame[];
  getFrameAt: (distance: number) => TrackFrame;
  getProgress: (distance: number) => number;
}

const WORLD_UP = new THREE.Vector3(0, 1, 0);
const FALLBACK_UP = new THREE.Vector3(0, 0, 1);

const RIDE_POINTS = [
  new THREE.Vector3(0, 18, 220),
  new THREE.Vector3(0, 18, 155),
  new THREE.Vector3(-10, 23, 86),
  new THREE.Vector3(-44, 66, 14),
  new THREE.Vector3(-80, 118, -104),
  new THREE.Vector3(-54, 121, -156),
  new THREE.Vector3(-7, 22, -262),
  new THREE.Vector3(92, 9, -306),
  new THREE.Vector3(206, 41, -212),
  new THREE.Vector3(238, 78, -62),
  new THREE.Vector3(150, 34, 66),
  new THREE.Vector3(222, 16, 180),
  new THREE.Vector3(68, 11, 252),
  new THREE.Vector3(-108, 22, 212),
  new THREE.Vector3(-232, 50, 90),
  new THREE.Vector3(-186, 42, -94),
  new THREE.Vector3(-20, 72, -20),
  new THREE.Vector3(90, 54, 116),
  new THREE.Vector3(25, 20, 218),
];

const clamp = (value: number, min: number, max: number) =>
  Math.min(max, Math.max(min, value));

const smoothRing = (values: number[], passes = 9) => {
  const smoothed = values.slice();
  const count = values.length;

  for (let pass = 0; pass < passes; pass += 1) {
    const next = smoothed.slice();
    for (let i = 0; i < count; i += 1) {
      const prev = smoothed[(i - 1 + count) % count];
      const current = smoothed[i];
      const following = smoothed[(i + 1) % count];
      next[i] = prev * 0.23 + current * 0.54 + following * 0.23;
    }
    smoothed.splice(0, count, ...next);
  }

  return smoothed;
};

const projectUp = (tangent: THREE.Vector3) => {
  const up = WORLD_UP.clone().sub(tangent.clone().multiplyScalar(WORLD_UP.dot(tangent)));
  if (up.lengthSq() < 0.0001) {
    return FALLBACK_UP.clone().sub(tangent.clone().multiplyScalar(FALLBACK_UP.dot(tangent))).normalize();
  }
  return up.normalize();
};

export const createTrackData = (sampleCount = 1800): TrackData => {
  const curve = new THREE.CatmullRomCurve3(RIDE_POINTS, true, "catmullrom", 0.52);
  const length = curve.getLength();
  const positions: THREE.Vector3[] = [];
  const tangents: THREE.Vector3[] = [];

  for (let i = 0; i < sampleCount; i += 1) {
    const u = i / sampleCount;
    positions.push(curve.getPointAt(u));
    tangents.push(curve.getTangentAt(u).normalize());
  }

  const unbankedNormals: THREE.Vector3[] = [];
  let normal = projectUp(tangents[0]);
  unbankedNormals.push(normal.clone());

  for (let i = 1; i < sampleCount; i += 1) {
    const rotation = new THREE.Quaternion().setFromUnitVectors(tangents[i - 1], tangents[i]);
    normal = normal
      .clone()
      .applyQuaternion(rotation)
      .sub(tangents[i].clone().multiplyScalar(normal.dot(tangents[i])))
      .normalize();

    if (normal.lengthSq() < 0.0001) normal = projectUp(tangents[i]);
    unbankedNormals.push(normal.clone());
  }

  const rawBank: number[] = [];
  const rawCurvature: number[] = [];
  const spacing = length / sampleCount;

  for (let i = 0; i < sampleCount; i += 1) {
    const prevTangent = tangents[(i - 2 + sampleCount) % sampleCount];
    const nextTangent = tangents[(i + 2) % sampleCount];
    const turn = nextTangent.clone().sub(prevTangent);
    const right = tangents[i].clone().cross(unbankedNormals[i]).normalize();
    const signedTurn = turn.dot(right);
    const curvature = prevTangent.angleTo(nextTangent) / Math.max(0.001, spacing * 4);
    const anticipatoryBank = clamp(-signedTurn * 11.5, -1.07, 1.07);

    rawCurvature.push(curvature);
    rawBank.push(anticipatoryBank);
  }

  const anticipation = Math.floor(sampleCount * 0.006);
  const anticipatedBank = rawBank.map((_, index) => rawBank[(index + anticipation) % sampleCount]);
  const bankValues = smoothRing(anticipatedBank, 17);
  const curvatureValues = smoothRing(rawCurvature, 5);

  const samples: TrackFrame[] = positions.map((position, index) => {
    const tangent = tangents[index].clone();
    const unbankedNormal = unbankedNormals[index].clone();
    const bank = bankValues[index];
    const bankRotation = new THREE.Quaternion().setFromAxisAngle(tangent, bank);
    const bankedNormal = unbankedNormal.clone().applyQuaternion(bankRotation).normalize();
    const right = tangent.clone().cross(bankedNormal).normalize();

    return {
      position: position.clone(),
      tangent,
      normal: bankedNormal,
      right,
      unbankedNormal,
      bank,
      curvature: curvatureValues[index],
      slope: tangent.y,
    };
  });

  const getProgress = (distance: number) => {
    const wrapped = ((distance % length) + length) % length;
    return wrapped / length;
  };

  const getFrameAt = (distance: number): TrackFrame => {
    const progress = getProgress(distance);
    const scaled = progress * sampleCount;
    const index = Math.floor(scaled) % sampleCount;
    const nextIndex = (index + 1) % sampleCount;
    const alpha = scaled - index;
    const current = samples[index];
    const next = samples[nextIndex];

    return {
      position: current.position.clone().lerp(next.position, alpha),
      tangent: current.tangent.clone().lerp(next.tangent, alpha).normalize(),
      normal: current.normal.clone().lerp(next.normal, alpha).normalize(),
      right: current.right.clone().lerp(next.right, alpha).normalize(),
      unbankedNormal: current.unbankedNormal.clone().lerp(next.unbankedNormal, alpha).normalize(),
      bank: THREE.MathUtils.lerp(current.bank, next.bank, alpha),
      curvature: THREE.MathUtils.lerp(current.curvature, next.curvature, alpha),
      slope: THREE.MathUtils.lerp(current.slope, next.slope, alpha),
    };
  };

  return {
    curve,
    length,
    samples,
    getFrameAt,
    getProgress,
  };
};

export const groundHeight = (x: number, z: number) => {
  const broad = Math.sin(x * 0.012) * 1.5 + Math.cos(z * 0.01) * 1.2;
  const ridge = Math.sin((x + z) * 0.006) * 2.2;
  return broad + ridge - 3.5;
};
