// frontend/js/scene.js
// Safe override: no world-axis flips; HDRI aligned via sky-dome; ground void preserved
import * as THREE from "https://esm.sh/three@0.158.0";
import { OrbitControls } from "https://esm.sh/three@0.158.0/examples/jsm/controls/OrbitControls.js";
import { RoomEnvironment } from "https://esm.sh/three@0.158.0/examples/jsm/environments/RoomEnvironment.js";

let dirLight;

export async function initScene() {
  const container = document.getElementById("three-root") || document.body;

  const scene = new THREE.Scene();

  // IMPORTANT: Do NOT touch THREE.Object3D.DEFAULT_UP here.
  // Your app already has an established axis convention; changing DEFAULT_UP will flip everything.
  // We only set camera.up to match the rest of your app (Z-up in your pool code).
  const camera = new THREE.PerspectiveCamera(
    60,
    container.clientWidth / container.clientHeight,
    0.1,
    500
  );
  camera.up.set(0, 0, 1);
  camera.position.set(12, -16, 10);
  camera.lookAt(0, 0, 0);
  scene.userData.camera = camera;

  const renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.setSize(container.clientWidth, container.clientHeight);
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;

  // Modern color pipeline + PBR-friendly tone mapping
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 0.95; // slightly lower to reduce washed-out grass
  container.appendChild(renderer.domElement);

  // -------------------------
  // Lighting: key/fill/rim
  // -------------------------
  const ambient = new THREE.AmbientLight(0xffffff, 0.22);
  scene.add(ambient);

  dirLight = new THREE.DirectionalLight(0xffffff, 2.8);
  dirLight.position.set(18, -22, 30);
  dirLight.castShadow = true;

  // If you want extra FPS, drop to 1024:
  // dirLight.shadow.mapSize.set(1024, 1024);
  dirLight.shadow.mapSize.set(2048, 2048);
  dirLight.shadow.normalBias = 0.02;
  dirLight.shadow.bias = -0.0002;

  const d = 20;
  dirLight.shadow.camera = new THREE.OrthographicCamera(-d, d, d, -d, 0.5, 150);
  scene.add(dirLight);
  scene.add(dirLight.target);

  const fillLight = new THREE.DirectionalLight(0xffffff, 0.75);
  fillLight.position.set(-20, 20, 18);
  fillLight.castShadow = false;
  scene.add(fillLight);

  const rimLight = new THREE.DirectionalLight(0xffffff, 0.55);
  rimLight.position.set(25, 25, 12);
  rimLight.castShadow = false;
  scene.add(rimLight);

  // Controls
  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.maxPolarAngle = Math.PI / 2.05;
  controls.target.set(0, 0, 0);
  controls.update();
  scene.userData.controls = controls;

  // -------------------------
  // Ground plane
  // NOTE: Your app cuts the void using updateGroundVoid(). Keep this mesh stable.
  // -------------------------
  const groundGeo = new THREE.PlaneGeometry(200, 200, 1, 1);

  // -------------------------
  // Ground material: Studio floor (neutral, slightly rough)
  // Keep this mesh stable: updateGroundVoid() will replace the geometry to cut the pool footprint hole.
  // -------------------------
  const groundMat = new THREE.MeshStandardMaterial({
    color: 0xf3f5f7,
    roughness: 0.96,
    metalness: 0.0,
    envMapIntensity: 0.25
  });

  const ground = new THREE.Mesh(groundGeo, groundMat);
  ground.position.set(0, 0, 0);
  ground.receiveShadow = true;
  scene.add(ground);
  scene.userData.ground = ground;

  // -------------------------
  // Studio environment (no external HDRI): neutral reflections + soft ambient feel
  // -------------------------
  const pmrem = new THREE.PMREMGenerator(renderer);
  scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
  pmrem.dispose();

  // -------------------------
  // Background: subtle vertical gradient sky-dome (clean showroom look)
  // -------------------------
  const skyGeo = new THREE.SphereGeometry(500, 48, 32);
  const skyMat = new THREE.ShaderMaterial({
    side: THREE.BackSide,
    depthWrite: false,
    uniforms: {
      topColor: { value: new THREE.Color(0xf7f9fc) },
      bottomColor: { value: new THREE.Color(0xe7edf5) }
    },
    vertexShader: `
      varying vec3 vPos;
      void main(){
        vPos = position;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: `
      varying vec3 vPos;
      uniform vec3 topColor;
      uniform vec3 bottomColor;
      void main(){
        float h = normalize(vPos).y * 0.5 + 0.5;
        h = smoothstep(0.0, 1.0, h);
        gl_FragColor = vec4(mix(bottomColor, topColor, h), 1.0);
      }
    `
  });

  const skyDome = new THREE.Mesh(skyGeo, skyMat);
  skyDome.frustumCulled = false;
  skyDome.onBeforeRender = (_r, _s, cam) => {
    skyDome.position.copy(cam.position);
  };

  // Remove any previous background objects
  if (scene.userData.skyDome) {
    scene.remove(scene.userData.skyDome);
    scene.userData.skyDome.geometry.dispose();
    scene.userData.skyDome.material.dispose();
  }
  scene.add(skyDome);
  scene.userData.skyDome = skyDome;

  // Background is provided by geometry
  scene.background = null;

  // Resize
  window.addEventListener("resize", () => {
    const w = container.clientWidth;
    const h = container.clientHeight;
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    renderer.setSize(w, h);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  });

  return { scene, camera, renderer, ground, controls };
}

// --------------------------------------------------------
// Ground void update (cut footprint hole)
// --------------------------------------------------------
export function updateGroundVoid(ground, poolGroup) {
  if (!ground || !poolGroup || !poolGroup.userData || !poolGroup.userData.outerPts) return;

  const outerPts = poolGroup.userData.outerPts;

  // Apply poolGroup transform (so live preview scaling updates the void correctly)
  const sx = (poolGroup.scale && isFinite(poolGroup.scale.x)) ? poolGroup.scale.x : 1;
  const sy = (poolGroup.scale && isFinite(poolGroup.scale.y)) ? poolGroup.scale.y : 1;
  const px = (poolGroup.position && isFinite(poolGroup.position.x)) ? poolGroup.position.x : 0;
  const py = (poolGroup.position && isFinite(poolGroup.position.y)) ? poolGroup.position.y : 0;

  const holePts = outerPts.map((v) => new THREE.Vector2(v.x * sx + px, v.y * sy + py));

  // Big outer rectangle (ground boundary)
  const groundShape = new THREE.Shape([
    new THREE.Vector2(-100, -100),
    new THREE.Vector2(100, -100),
    new THREE.Vector2(100, 100),
    new THREE.Vector2(-100, 100)
  ]);

  // Pool footprint hole
  const hole = new THREE.Path(holePts);
  groundShape.holes = [hole];

  const newGeo = new THREE.ShapeGeometry(groundShape);
  ground.geometry.dispose();
  ground.geometry = newGeo;

  updateShadowBounds(poolGroup);
}


// --------------------------------------------------------
// Update directional light shadow box to fit pool
// --------------------------------------------------------
export function updateShadowBounds(poolGroup) {
  if (!dirLight || !poolGroup) return;

  const box = new THREE.Box3().setFromObject(poolGroup);
  const size = box.getSize(new THREE.Vector3());
  const center = box.getCenter(new THREE.Vector3());

  const cam = dirLight.shadow.camera;

  // Expand a bit so wall shadows look stable and don't clip while orbiting
  const pad = 6;
  cam.left = -(size.x / 1.4 + pad);
  cam.right = (size.x / 1.4 + pad);
  cam.top = (size.y / 1.4 + pad);
  cam.bottom = -(size.y / 1.4 + pad);

  cam.near = 0.5;
  cam.far = size.z + 120;
  cam.updateProjectionMatrix();

  dirLight.target.position.copy(center);
  dirLight.target.updateMatrixWorld();
}

// --------------------------------------------------------
// Update spa void uniforms on water shader
// --------------------------------------------------------
export function updatePoolWaterVoid(poolGroup, spaGroup) {
  if (!poolGroup || !poolGroup.userData || !poolGroup.userData.waterMesh) return;

  const poolWater = poolGroup.userData.waterMesh;
  const mat = poolWater.material;
  const uniforms = mat ? mat.uniforms : null;
  if (!uniforms || !uniforms.spaCenter || !uniforms.spaSize) return;

  // Clear void if no spa provided
  if (!spaGroup) {
    uniforms.spaSize.value.set(0, 0);
    if (uniforms.spaRadius) uniforms.spaRadius.value = 0.0;
    return;
  }

  // World-space bounds (shader uses vWorld.xy)
  const spaBoxWorld = new THREE.Box3().setFromObject(spaGroup);
  const spaCenterWorld = spaBoxWorld.getCenter(new THREE.Vector3());
  const spaSizeWorld = spaBoxWorld.getSize(new THREE.Vector3());

  // Small padding so the cutout doesn't clip the spa walls
  const pad = 0.05;

  uniforms.spaCenter.value.set(spaCenterWorld.x, spaCenterWorld.y);
  uniforms.spaSize.value.set(spaSizeWorld.x + pad, spaSizeWorld.y + pad);

  // Rounded void + edge polish tuning (meters)
  if (uniforms.spaRadius) {
    const r = 0.15 * Math.min(spaSizeWorld.x, spaSizeWorld.y);
    uniforms.spaRadius.value = Math.max(
      0.0,
      Math.min(r, Math.min(spaSizeWorld.x, spaSizeWorld.y) * 0.5)
    );
  }
  if (uniforms.spaFeather) uniforms.spaFeather.value = 0.03;
  if (uniforms.spaEdgeWidth) uniforms.spaEdgeWidth.value = 0.08;
  if (uniforms.spaEdgeFoam) uniforms.spaEdgeFoam.value = 0.55;
  if (uniforms.spaEdgeDarken) uniforms.spaEdgeDarken.value = 0.25;
}

// --------------------------------------------------------
// Rebuild grass overlay after pool rebuild
// --------------------------------------------------------
export function updateGrassForPool(scene, poolGroup) {
  // Instanced grass removed — keep function for compatibility with PoolApp
  return;
}