import * as THREE from "three";
import { RideAudioEngine } from "./audio";
import { createTrackData, groundHeight, type TrackData } from "./track";
import type { RideExperience, RideMetrics, RideSettings } from "./types";

const DEG = 180 / Math.PI;
const CAMERA_EYE_HEIGHT = 2.35;
const GAUGE = 2.25;
const START_PROGRESS = 0.176;
const WORLD_UP = new THREE.Vector3(0, 1, 0);
const Z_AXIS = new THREE.Vector3(0, 0, 1);
const Y_AXIS = new THREE.Vector3(0, 1, 0);

const clamp = (value: number, min: number, max: number) =>
  Math.min(max, Math.max(min, value));

const smoothDamp = (current: number, target: number, smoothing: number, dt: number) =>
  THREE.MathUtils.lerp(current, target, 1 - Math.exp(-smoothing * dt));

export const createCoasterExperience = (
  canvas: HTMLCanvasElement,
  getSettings: () => RideSettings,
  onMetrics: (metrics: RideMetrics) => void,
): RideExperience => {
  const renderer = new THREE.WebGLRenderer({
    canvas,
    antialias: true,
    powerPreference: "high-performance",
  });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.03;

  const scene = new THREE.Scene();
  scene.fog = new THREE.FogExp2(0x8a6f61, 0.0018);

  const camera = new THREE.PerspectiveCamera(74, 1, 0.1, 1600);
  scene.add(camera);

  const track = createTrackData();
  const audio = new RideAudioEngine();
  const clock = new THREE.Clock();

  let running = false;
  let paused = true;
  let disposed = false;
  let distance = track.length * START_PROGRESS;
  let speed = 7;
  let displayedFov = 74;
  let previousSpeed = speed;
  let lastMetricsTime = 0;
  let frameCounter = 0;
  let fpsAccumulator = 60;
  let stopBlend = 0;
  let lastBrakePulse = 0;
  let lastDropPulse = 0;

  buildWorld(scene, track);
  buildCockpit(camera);

  const resize = () => {
    const width = canvas.clientWidth || window.innerWidth;
    const height = canvas.clientHeight || window.innerHeight;
    renderer.setSize(width, height, false);
    camera.aspect = width / Math.max(1, height);
    camera.updateProjectionMatrix();
  };

  const resizeObserver = new ResizeObserver(resize);
  resizeObserver.observe(canvas);
  resize();

  const animate = () => {
    if (disposed) return;
    const dt = Math.min(clock.getDelta(), 0.045);
    frameCounter += 1;
    fpsAccumulator = smoothDamp(fpsAccumulator, 1 / Math.max(0.0001, dt), 2.8, dt);

    const settings = getSettings();
    if (running && !paused) {
      const rideStep = updateRidePhysics(dt, settings);
      distance = (distance + rideStep.distanceDelta) % track.length;
      speed = rideStep.speed;
      updateCamera(dt, settings, rideStep.acceleration);
      updateAudioAndHaptics(settings, rideStep);
    } else {
      updateCamera(dt, settings, -4);
      audio.update(0, 0, 0, settings.audioIntensity);
    }

    renderer.render(scene, camera);
    if (performance.now() - lastMetricsTime > 90) {
      publishMetrics(settings);
      lastMetricsTime = performance.now();
    }
    requestAnimationFrame(animate);
  };

  clock.start();
  requestAnimationFrame(animate);

  return {
    start: () => {
      running = true;
      paused = false;
      stopBlend = 0;
      if (getSettings().audioEnabled) void audio.start();
    },
    pause: () => {
      paused = true;
    },
    resume: () => {
      running = true;
      paused = false;
      if (getSettings().audioEnabled) void audio.start();
    },
    restart: () => {
      distance = track.length * START_PROGRESS;
      speed = 8;
      previousSpeed = speed;
      stopBlend = 0;
      running = true;
      paused = false;
      if (getSettings().audioEnabled) void audio.start();
    },
    emergencyStop: () => {
      paused = true;
      stopBlend = 1;
      speed = 0;
      audio.update(0, 0, 0, getSettings().audioIntensity);
      if (navigator.vibrate && getSettings().vibrationEnabled) navigator.vibrate([40, 30, 40]);
    },
    dispose: () => {
      disposed = true;
      resizeObserver.disconnect();
      audio.dispose();
      renderer.dispose();
      scene.traverse((object) => {
        if (object instanceof THREE.Mesh) {
          object.geometry.dispose();
          const materials = Array.isArray(object.material) ? object.material : [object.material];
          materials.forEach((material) => material.dispose());
        }
      });
    },
  };

  function updateRidePhysics(dt: number, settings: RideSettings) {
    const frame = track.getFrameAt(distance);
    const progress = track.getProgress(distance);
    const modeLimit = settings.mode === "comfort" || settings.reducedMotion ? 0.78 : 1;
    const gravity = -frame.slope * 42;
    const drag = 0.012 * speed * speed + 0.42;
    const launch = zonePulse(progress, 0.025, 0.085);
    const lift = zonePulse(progress, 0.09, 0.18);
    const brake = zonePulse(progress, 0.89, 0.985);
    let target = speed + (gravity - drag) * dt;

    if (launch > 0) target = smoothDamp(target, 41 * modeLimit, 3.2 * launch, dt);
    if (lift > 0) target = smoothDamp(target, 12, 7.5 * lift, dt);
    if (brake > 0) target = smoothDamp(target, 7, 7.8 * brake, dt);

    const maxSpeed = settings.mode === "comfort" || settings.reducedMotion ? 41 : 61;
    const minSpeed = lift > 0.05 ? 7.5 : 10.5;
    const nextSpeed = clamp(target, minSpeed, maxSpeed);
    const acceleration = (nextSpeed - previousSpeed) / Math.max(0.001, dt);
    previousSpeed = nextSpeed;

    return {
      speed: nextSpeed,
      acceleration,
      distanceDelta: nextSpeed * dt,
      launch,
      lift,
      brake: clamp(brake, 0, 1),
    };
  }

  function updateCamera(dt: number, settings: RideSettings, acceleration: number) {
    const frame = track.getFrameAt(distance);
    const progress = track.getProgress(distance);
    const speed01 = clamp(speed / 61, 0, 1);
    const time = performance.now() * 0.001;
    const motion = settings.reducedMotion ? 0 : 1;
    const shakeAllowed = settings.cameraShake && settings.effectsEnabled ? motion : 0;
    const shakeAmount = shakeAllowed * speed01 * speed01 * (settings.mode === "comfort" ? 0.36 : 1);
    const lowSway = Math.sin(time * 1.8 + progress * 12) * 0.045 * shakeAmount;
    const railBuzz = Math.sin(time * 59) * 0.025 * shakeAmount + Math.sin(time * 83) * 0.012 * shakeAmount;
    const eye = frame.position
      .clone()
      .add(frame.normal.clone().multiplyScalar(CAMERA_EYE_HEIGHT + railBuzz))
      .add(frame.right.clone().multiplyScalar(lowSway));
    const up = frame.normal.clone();

    if (settings.horizonLock || settings.mode === "comfort") {
      up.lerp(WORLD_UP, settings.horizonLock ? 0.86 : 0.42).normalize();
    }

    stopBlend = smoothDamp(stopBlend, paused ? 1 : 0, 2.2, dt);
    const pitchCue = clamp(-acceleration * 0.0022 - frame.slope * 0.035, -0.06, 0.06) * motion;
    const lookTarget = eye
      .clone()
      .add(frame.tangent.clone().multiplyScalar(18))
      .add(frame.normal.clone().multiplyScalar(pitchCue * 18))
      .add(frame.right.clone().multiplyScalar(Math.sin(time * 0.9) * 0.16 * shakeAmount));

    camera.position.copy(eye);
    camera.up.copy(up);
    camera.lookAt(lookTarget);

    if (!settings.horizonLock && settings.cameraShake && settings.effectsEnabled && !settings.reducedMotion) {
      camera.rotateZ(Math.sin(time * 13.5) * 0.0038 * speed01);
      camera.rotateX(Math.sin(time * 21.2) * 0.0026 * speed01);
    }

    const fovBoost = settings.effectsEnabled && !settings.reducedMotion ? speed01 * 7.5 : 0;
    const baseFov = settings.mode === "comfort" || settings.reducedMotion ? 68 : 74;
    displayedFov = smoothDamp(displayedFov, baseFov + fovBoost - stopBlend * 3, 4.5, dt);
    camera.fov = displayedFov;
    camera.updateProjectionMatrix();
  }

  function updateAudioAndHaptics(
    settings: RideSettings,
    rideStep: { launch: number; lift: number; brake: number; acceleration: number },
  ) {
    audio.setEnabled(settings.audioEnabled);
    audio.update(clamp(speed / 61, 0, 1), rideStep.lift, rideStep.brake, settings.audioIntensity);

    if (!settings.vibrationEnabled || !navigator.vibrate) return;
    const now = performance.now();
    if (rideStep.brake > 0.62 && now - lastBrakePulse > 900) {
      navigator.vibrate([18, 24, 18]);
      lastBrakePulse = now;
    }
    if (rideStep.acceleration > 12 && now - lastDropPulse > 1400) {
      navigator.vibrate(22);
      lastDropPulse = now;
    }
  }

  function publishMetrics(settings: RideSettings) {
    const frame = track.getFrameAt(distance);
    const progress = track.getProgress(distance);
    const bankDegrees = frame.bank * DEG;
    const lateralG = Math.abs(speed * speed * frame.curvature) / 9.81;
    const verticalG = clamp(1 - frame.slope * 0.62 + lateralG * 0.34, 0.25, 4.2);
    onMetrics({
      speedKmh: Math.round(speed * 3.6),
      altitude: Math.round(frame.position.y),
      gForce: Number(verticalG.toFixed(1)),
      progress: Math.round(progress * 100),
      bankDegrees: Math.round(bankDegrees),
      fps: Math.round(fpsAccumulator),
      zone: getZone(progress, frame.slope, settings),
    });
  }
};

const zonePulse = (progress: number, start: number, end: number) => {
  if (start <= end) {
    if (progress < start || progress > end) return 0;
    return Math.sin(((progress - start) / (end - start)) * Math.PI);
  }
  if (progress > end && progress < start) return 0;
  const span = 1 - start + end;
  const local = progress >= start ? progress - start : progress + 1 - start;
  return Math.sin((local / span) * Math.PI);
};

const getZone = (progress: number, slope: number, settings: RideSettings) => {
  if (progress > 0.985 || progress < 0.025) return "station";
  if (slope < -0.22) return "drop";
  if (zonePulse(progress, 0.025, 0.085) > 0) return "launch";
  if (zonePulse(progress, 0.09, 0.18) > 0) return "lift";
  if (zonePulse(progress, 0.47, 0.56) > 0) return "tunnel";
  if (zonePulse(progress, 0.89, 0.985) > 0) return "brake";
  return settings.mode;
};

const buildWorld = (scene: THREE.Scene, track: TrackData) => {
  addSky(scene);
  addLights(scene);
  addTerrain(scene);
  addTrack(scene, track);
  addSupports(scene, track);
  addTunnel(scene, track);
  addStation(scene, track);
  addScenery(scene);
  addParkAtmosphere(scene);
};

const addSky = (scene: THREE.Scene) => {
  const geometry = new THREE.SphereGeometry(900, 48, 24);
  const material = new THREE.ShaderMaterial({
    side: THREE.BackSide,
    depthWrite: false,
    uniforms: {
      top: { value: new THREE.Color(0x2d4765) },
      middle: { value: new THREE.Color(0xf1a462) },
      bottom: { value: new THREE.Color(0x171f25) },
    },
    vertexShader: `
      varying vec3 vWorldPosition;
      void main() {
        vec4 worldPosition = modelMatrix * vec4(position, 1.0);
        vWorldPosition = worldPosition.xyz;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: `
      uniform vec3 top;
      uniform vec3 middle;
      uniform vec3 bottom;
      varying vec3 vWorldPosition;
      float hash(vec2 p) {
        return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123);
      }
      void main() {
        float h = normalize(vWorldPosition).y;
        vec3 low = mix(bottom, middle, smoothstep(-0.18, 0.24, h));
        vec3 color = mix(low, top, smoothstep(0.2, 0.86, h));
        float cloudBand = smoothstep(0.08, 0.46, h) * (1.0 - smoothstep(0.56, 0.84, h));
        float waveA = sin(vWorldPosition.x * 0.012 + vWorldPosition.z * 0.004);
        float waveB = sin(vWorldPosition.x * 0.005 - vWorldPosition.z * 0.014 + 2.3);
        float cloud = smoothstep(1.12, 1.55, waveA + waveB + hash(vWorldPosition.xz * 0.004) * 0.18);
        color = mix(color, vec3(0.98, 0.58, 0.34), cloud * cloudBand * 0.24);
        float sunGlow = smoothstep(0.78, 0.0, length(normalize(vWorldPosition).xz - vec2(-0.34, 0.18)));
        color += vec3(0.9, 0.38, 0.12) * sunGlow * 0.18;
        gl_FragColor = vec4(color, 1.0);
      }
    `,
  });
  scene.add(new THREE.Mesh(geometry, material));
};

const addLights = (scene: THREE.Scene) => {
  const hemi = new THREE.HemisphereLight(0xfce2b0, 0x1c2830, 1.35);
  scene.add(hemi);

  const sun = new THREE.DirectionalLight(0xffbd72, 3.2);
  sun.position.set(-240, 280, 160);
  sun.castShadow = true;
  sun.shadow.camera.left = -360;
  sun.shadow.camera.right = 360;
  sun.shadow.camera.top = 360;
  sun.shadow.camera.bottom = -360;
  sun.shadow.mapSize.set(2048, 2048);
  scene.add(sun);
};

const addTerrain = (scene: THREE.Scene) => {
  const geometry = new THREE.PlaneGeometry(920, 920, 120, 120);
  geometry.rotateX(-Math.PI / 2);
  const positions = geometry.attributes.position;
  const colors: number[] = [];
  const low = new THREE.Color(0x1d2e22);
  const high = new THREE.Color(0x3f5536);
  const path = new THREE.Color(0x3d3a30);
  for (let i = 0; i < positions.count; i += 1) {
    const x = positions.getX(i);
    const z = positions.getZ(i);
    const y = groundHeight(x, z);
    positions.setY(i, y);
    const walkingLoop = Math.abs(Math.hypot(x - 18, z - 188) - 132);
    const serviceRoad = Math.abs(Math.sin((x + 280) * 0.012) * 58 + z - 42);
    const color = low.clone().lerp(high, clamp((y + 8) / 16, 0, 1));
    if (walkingLoop < 7 || serviceRoad < 5) color.lerp(path, 0.72);
    colors.push(color.r, color.g, color.b);
  }
  positions.needsUpdate = true;
  geometry.setAttribute("color", new THREE.Float32BufferAttribute(colors, 3));
  geometry.computeVertexNormals();

  const material = new THREE.MeshStandardMaterial({
    vertexColors: true,
    roughness: 0.96,
    metalness: 0.02,
  });
  const terrain = new THREE.Mesh(geometry, material);
  terrain.receiveShadow = true;
  scene.add(terrain);

  const plazaMaterial = new THREE.MeshStandardMaterial({ color: 0x353a3d, roughness: 0.9 });
  const plaza = new THREE.Mesh(new THREE.CircleGeometry(140, 96), plazaMaterial);
  plaza.rotation.x = -Math.PI / 2;
  plaza.position.set(18, groundHeight(18, 188) + 0.05, 188);
  plaza.receiveShadow = true;
  scene.add(plaza);

  const waterMaterial = new THREE.MeshStandardMaterial({
    color: 0x173342,
    roughness: 0.22,
    metalness: 0.18,
    transparent: true,
    opacity: 0.82,
  });
  const lake = new THREE.Mesh(new THREE.CircleGeometry(76, 96), waterMaterial);
  lake.rotation.x = -Math.PI / 2;
  lake.scale.set(1.42, 0.72, 1);
  lake.position.set(205, groundHeight(205, 118) + 0.18, 118);
  scene.add(lake);
};

const addTrack = (scene: THREE.Scene, track: TrackData) => {
  const railMaterial = new THREE.MeshStandardMaterial({
    color: 0xd7e1e8,
    metalness: 0.82,
    roughness: 0.28,
  });
  const spineMaterial = new THREE.MeshStandardMaterial({
    color: 0x3f5059,
    metalness: 0.55,
    roughness: 0.35,
  });
  const tieMaterial = new THREE.MeshStandardMaterial({
    color: 0x2a3033,
    metalness: 0.6,
    roughness: 0.44,
  });

  const leftPoints = track.samples.map((sample) =>
    sample.position.clone().add(sample.right.clone().multiplyScalar(-GAUGE)),
  );
  const rightPoints = track.samples.map((sample) =>
    sample.position.clone().add(sample.right.clone().multiplyScalar(GAUGE)),
  );
  const spinePoints = track.samples.map((sample) =>
    sample.position.clone().add(sample.normal.clone().multiplyScalar(-0.75)),
  );

  const leftRail = new THREE.Mesh(makeTube(leftPoints, 0.48), railMaterial);
  const rightRail = new THREE.Mesh(makeTube(rightPoints, 0.48), railMaterial);
  const spine = new THREE.Mesh(makeTube(spinePoints, 0.32, 8), spineMaterial);
  leftRail.castShadow = true;
  rightRail.castShadow = true;
  spine.castShadow = true;
  scene.add(leftRail, rightRail, spine);

  const tieGeometry = new THREE.BoxGeometry(GAUGE * 2.9, 0.34, 1.28);
  const tieCount = Math.floor(track.samples.length / 7);
  const ties = new THREE.InstancedMesh(tieGeometry, tieMaterial, tieCount);
  const matrix = new THREE.Matrix4();
  const basis = new THREE.Matrix4();
  for (let i = 0; i < tieCount; i += 1) {
    const sample = track.samples[(i * 7) % track.samples.length];
    const position = sample.position.clone().add(sample.normal.clone().multiplyScalar(-0.62));
    basis.makeBasis(sample.right, sample.normal, sample.tangent);
    matrix.copy(basis);
    matrix.setPosition(position);
    ties.setMatrixAt(i, matrix);
  }
  ties.castShadow = true;
  ties.receiveShadow = true;
  scene.add(ties);
};

const makeTube = (points: THREE.Vector3[], radius: number, radialSegments = 10) => {
  const curve = new THREE.CatmullRomCurve3(points, true, "catmullrom", 0.35);
  return new THREE.TubeGeometry(curve, 1200, radius, radialSegments, true);
};

const addSupports = (scene: THREE.Scene, track: TrackData) => {
  const material = new THREE.MeshStandardMaterial({
    color: 0x67747a,
    metalness: 0.74,
    roughness: 0.38,
  });
  const supportGeometry = new THREE.CylinderGeometry(0.58, 0.75, 1, 8);
  const supportCount = 96;
  const supports = new THREE.InstancedMesh(supportGeometry, material, supportCount * 2);
  const matrix = new THREE.Matrix4();
  let instance = 0;

  for (let i = 0; i < supportCount; i += 1) {
    const sample = track.samples[(i * 19 + 10) % track.samples.length];
    for (const side of [-1, 1]) {
      const top = sample.position
        .clone()
        .add(sample.right.clone().multiplyScalar(side * (GAUGE + 0.65)))
        .add(sample.normal.clone().multiplyScalar(-1.35));
      const yGround = groundHeight(top.x, top.z);
      const height = Math.max(2, top.y - yGround);
      const midpoint = new THREE.Vector3(top.x, yGround + height / 2, top.z);
      matrix.compose(midpoint, new THREE.Quaternion(), new THREE.Vector3(1, height, 1));
      supports.setMatrixAt(instance, matrix);
      instance += 1;
    }
  }
  supports.castShadow = true;
  supports.receiveShadow = true;
  scene.add(supports);

  for (let i = 0; i < 52; i += 1) {
    const sample = track.samples[(i * 34 + 17) % track.samples.length];
    const top = sample.position.clone().add(sample.normal.clone().multiplyScalar(-1.2));
    const ground = new THREE.Vector3(
      top.x + sample.right.x * 8,
      groundHeight(top.x + sample.right.x * 8, top.z + sample.right.z * 8),
      top.z + sample.right.z * 8,
    );
    scene.add(cylinderBetween(top, ground, 0.22, material));
  }
};

const addTunnel = (scene: THREE.Scene, track: TrackData) => {
  const shellMaterial = new THREE.MeshStandardMaterial({
    color: 0x15191d,
    roughness: 0.78,
    metalness: 0.12,
    side: THREE.BackSide,
  });
  const ringMaterial = new THREE.MeshStandardMaterial({
    color: 0x4d575e,
    metalness: 0.72,
    roughness: 0.28,
    emissive: 0x1d1309,
    emissiveIntensity: 0.26,
  });
  const lampMaterial = new THREE.MeshStandardMaterial({
    color: 0xffcc7b,
    emissive: 0xff9d3b,
    emissiveIntensity: 1.7,
  });

  const startDistance = track.length * 0.486;
  const ringGeometry = new THREE.TorusGeometry(8.7, 0.38, 10, 36);
  const lampGeometry = new THREE.SphereGeometry(0.45, 12, 8);
  for (let i = 0; i < 17; i += 1) {
    const frame = track.getFrameAt(startDistance + i * 5.2);
    const ring = new THREE.Mesh(ringGeometry, ringMaterial);
    ring.position.copy(frame.position);
    ring.quaternion.setFromUnitVectors(Z_AXIS, frame.tangent);
    ring.scale.set(1.0, 1.24, 1.0);
    ring.castShadow = true;
    scene.add(ring);

    if (i % 2 === 0) {
      const lamp = new THREE.Mesh(lampGeometry, lampMaterial);
      lamp.position
        .copy(frame.position)
        .add(frame.normal.clone().multiplyScalar(5.8))
        .add(frame.right.clone().multiplyScalar(i % 4 === 0 ? -5.4 : 5.4));
      scene.add(lamp);
    }
  }

  const center = track.getFrameAt(startDistance + 42);
  const shell = new THREE.Mesh(new THREE.CylinderGeometry(9.2, 9.2, 90, 28, 1, true), shellMaterial);
  shell.position.copy(center.position);
  shell.quaternion.setFromUnitVectors(Y_AXIS, center.tangent);
  scene.add(shell);
};

const addStation = (scene: THREE.Scene, track: TrackData) => {
  const frame = track.getFrameAt(track.length * 0.006);
  const station = new THREE.Group();
  station.position.copy(frame.position.clone().add(frame.normal.clone().multiplyScalar(-2.7)));
  station.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(frame.right, frame.normal, frame.tangent));

  const deckMaterial = new THREE.MeshStandardMaterial({ color: 0x2c3338, roughness: 0.84 });
  const roofMaterial = new THREE.MeshStandardMaterial({
    color: 0x6e2829,
    roughness: 0.64,
    metalness: 0.28,
  });
  const deck = new THREE.Mesh(new THREE.BoxGeometry(28, 1.1, 34), deckMaterial);
  deck.position.y = -2.3;
  deck.receiveShadow = true;
  station.add(deck);

  const roof = new THREE.Mesh(new THREE.BoxGeometry(34, 1.2, 22), roofMaterial);
  roof.position.set(0, 8.6, -1.5);
  roof.castShadow = true;
  station.add(roof);

  const columnGeometry = new THREE.CylinderGeometry(0.32, 0.42, 10.5, 8);
  for (const x of [-14, 14]) {
    for (const z of [-12, 12]) {
      const column = new THREE.Mesh(columnGeometry, deckMaterial);
      column.position.set(x, 2.8, z);
      column.castShadow = true;
      station.add(column);
    }
  }
  scene.add(station);
};

const addScenery = (scene: THREE.Scene) => {
  const treeTrunkMaterial = new THREE.MeshStandardMaterial({ color: 0x4d3423, roughness: 0.92 });
  const treeLeafMaterial = new THREE.MeshStandardMaterial({ color: 0x1e4a2d, roughness: 0.86 });
  const trunkGeometry = new THREE.CylinderGeometry(0.45, 0.65, 5, 7);
  const leafGeometry = new THREE.ConeGeometry(3.2, 8.5, 9);
  const treeCount = 210;
  const trunks = new THREE.InstancedMesh(trunkGeometry, treeTrunkMaterial, treeCount);
  const leaves = new THREE.InstancedMesh(leafGeometry, treeLeafMaterial, treeCount);
  const matrix = new THREE.Matrix4();

  for (let i = 0; i < treeCount; i += 1) {
    const angle = i * 2.399963;
    const radius = 120 + ((i * 53) % 330);
    const x = Math.cos(angle) * radius + Math.sin(i * 0.7) * 34;
    const z = Math.sin(angle) * radius + Math.cos(i * 0.53) * 28;
    if (Math.abs(x) < 78 && z > 120 && z < 270) continue;
    const y = groundHeight(x, z);
    const scale = 0.75 + ((i * 31) % 50) / 100;
    matrix.compose(new THREE.Vector3(x, y + 2.5 * scale, z), new THREE.Quaternion(), new THREE.Vector3(scale, scale, scale));
    trunks.setMatrixAt(i, matrix);
    matrix.compose(new THREE.Vector3(x, y + 8.6 * scale, z), new THREE.Quaternion(), new THREE.Vector3(scale, scale, scale));
    leaves.setMatrixAt(i, matrix);
  }
  trunks.castShadow = true;
  leaves.castShadow = true;
  trunks.receiveShadow = true;
  leaves.receiveShadow = true;
  scene.add(trunks, leaves);

  const lampPoleMaterial = new THREE.MeshStandardMaterial({ color: 0x2f383d, roughness: 0.54, metalness: 0.6 });
  const glowMaterial = new THREE.MeshStandardMaterial({
    color: 0xffc16c,
    emissive: 0xff9d42,
    emissiveIntensity: 1.55,
  });
  for (let i = 0; i < 34; i += 1) {
    const angle = (i / 34) * Math.PI * 2;
    const x = Math.cos(angle) * 110 + 14;
    const z = Math.sin(angle) * 94 + 176;
    const y = groundHeight(x, z);
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.18, 0.25, 8, 8), lampPoleMaterial);
    pole.position.set(x, y + 4, z);
    pole.castShadow = true;
    const globe = new THREE.Mesh(new THREE.SphereGeometry(0.82, 12, 8), glowMaterial);
    globe.position.set(x, y + 8.3, z);
    scene.add(pole, globe);
  }
};

const addParkAtmosphere = (scene: THREE.Scene) => {
  const lightCount = 820;
  const positions = new Float32Array(lightCount * 3);
  const colors = new Float32Array(lightCount * 3);
  const warm = new THREE.Color(0xffb75d);
  const cool = new THREE.Color(0x80d8ff);

  for (let i = 0; i < lightCount; i += 1) {
    const lane = i % 5;
    const angle = i * 2.399963;
    const radius = 70 + ((i * 41) % 380);
    const pathBias = lane < 3 ? Math.sin(i * 0.19) * 55 : 0;
    const x = Math.cos(angle) * radius + pathBias + 22;
    const z = Math.sin(angle) * radius * 0.74 + Math.cos(i * 0.07) * 42 + 82;
    const y = groundHeight(x, z) + 2.4 + ((i * 13) % 9) * 0.08;
    positions[i * 3] = x;
    positions[i * 3 + 1] = y;
    positions[i * 3 + 2] = z;

    const color = warm.clone().lerp(cool, lane === 4 ? 0.38 : 0.04);
    const intensity = 0.58 + ((i * 17) % 40) / 100;
    colors[i * 3] = color.r * intensity;
    colors[i * 3 + 1] = color.g * intensity;
    colors[i * 3 + 2] = color.b * intensity;
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute("color", new THREE.BufferAttribute(colors, 3));
  const material = new THREE.PointsMaterial({
    map: createGlowTexture(),
    size: 2.1,
    sizeAttenuation: true,
    transparent: true,
    opacity: 0.86,
    vertexColors: true,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
  });
  scene.add(new THREE.Points(geometry, material));

  const buildingMaterial = new THREE.MeshStandardMaterial({
    color: 0x25292d,
    roughness: 0.82,
    metalness: 0.12,
    emissive: 0x3b2511,
    emissiveIntensity: 0.08,
  });

  for (let i = 0; i < 26; i += 1) {
    const x = -240 + (i % 9) * 58 + Math.sin(i) * 12;
    const z = -210 + Math.floor(i / 9) * 68 + Math.cos(i * 1.7) * 10;
    const y = groundHeight(x, z);
    const building = new THREE.Mesh(
      new THREE.BoxGeometry(16 + (i % 3) * 7, 10 + (i % 5) * 4, 13 + (i % 4) * 5),
      buildingMaterial,
    );
    building.position.set(x, y + building.geometry.parameters.height / 2, z);
    building.castShadow = true;
    building.receiveShadow = true;
    scene.add(building);
  }
};

const createGlowTexture = () => {
  const canvas = document.createElement("canvas");
  canvas.width = 64;
  canvas.height = 64;
  const context = canvas.getContext("2d");
  if (!context) return undefined;

  const gradient = context.createRadialGradient(32, 32, 0, 32, 32, 32);
  gradient.addColorStop(0, "rgba(255, 255, 255, 1)");
  gradient.addColorStop(0.22, "rgba(255, 236, 190, 0.92)");
  gradient.addColorStop(0.52, "rgba(255, 168, 74, 0.34)");
  gradient.addColorStop(1, "rgba(255, 150, 40, 0)");
  context.fillStyle = gradient;
  context.fillRect(0, 0, 64, 64);

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
};

const cylinderBetween = (
  start: THREE.Vector3,
  end: THREE.Vector3,
  radius: number,
  material: THREE.Material,
) => {
  const direction = end.clone().sub(start);
  const length = direction.length();
  const mesh = new THREE.Mesh(new THREE.CylinderGeometry(radius, radius, length, 7), material);
  mesh.position.copy(start).add(end).multiplyScalar(0.5);
  mesh.quaternion.setFromUnitVectors(Y_AXIS, direction.normalize());
  mesh.castShadow = true;
  return mesh;
};

const buildCockpit = (camera: THREE.Camera) => {
  const cockpit = new THREE.Group();
  cockpit.position.set(0, -0.92, -2.08);

  const shellMaterial = new THREE.MeshStandardMaterial({
    color: 0xb9282f,
    roughness: 0.38,
    metalness: 0.42,
  });
  const darkMaterial = new THREE.MeshStandardMaterial({
    color: 0x15191d,
    roughness: 0.62,
    metalness: 0.55,
  });

  const nose = new THREE.Mesh(new THREE.BoxGeometry(2.42, 0.2, 1.18), shellMaterial);
  nose.position.set(0, -0.22, -0.12);
  nose.rotation.x = -0.08;
  cockpit.add(nose);

  const restraint = new THREE.Mesh(new THREE.TorusGeometry(0.98, 0.055, 8, 28, Math.PI), darkMaterial);
  restraint.position.set(0, 0.1, 0.42);
  restraint.rotation.set(Math.PI * 0.5, 0, Math.PI);
  cockpit.add(restraint);

  const leftHandle = new THREE.Mesh(new THREE.CylinderGeometry(0.055, 0.055, 0.92, 8), darkMaterial);
  leftHandle.position.set(-0.78, 0.08, 0.12);
  leftHandle.rotation.z = 0.3;
  cockpit.add(leftHandle);
  const rightHandle = leftHandle.clone();
  rightHandle.position.x = 0.78;
  rightHandle.rotation.z = -0.3;
  cockpit.add(rightHandle);

  camera.add(cockpit);
};
