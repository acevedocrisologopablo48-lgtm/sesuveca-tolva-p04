import * as THREE from 'three';
import { OrbitControls } from './assets/vendor/OrbitControls.js';
import { RoomEnvironment } from './assets/vendor/RoomEnvironment.js';
import { toCreasedNormals } from './assets/vendor/BufferGeometryUtils.js';

// R01 is a placement of the original equipment. Conveyor tessellations already
// contain their world transform; only the hopper has an articulated transform.
const panel = document.getElementById('planta');
const $ = (selector) => panel?.querySelector(selector);
const $$ = (selector) => [...(panel?.querySelectorAll(selector) || [])];
const mm = 0.001;
const format = (value, digits = 1) => Number(value).toLocaleString('es-ES', { maximumFractionDigits: digits, minimumFractionDigits: digits });
const state = { angle: 0, playing: false, direction: 1, edges: true, reference: true, flows: false, view: 'iso', ready: false };
let meta, hopperMeta, scene, renderer, camera, controls, model, tolvaRoot, fixed, moving;
let referenceGroup, referenceEdges, fixedEdges, movingEdges, staticEdges, flowsGroup;
let envelope, hopperEnvelope, flowEnvelope, hopperFlowEnvelope, edgeMaterial, environmentTarget, loading = false, lastFrame = 0;
const meshes = [];
const edgeCache = new Map();
const geometryCache = new Map();
const motionMeshes = [];
const viewNames = { iso: 'ISOMÉTRICA', selection: 'SELECCIÓN · TOLVA', top: 'PLANTA', profile: 'PERFIL LONGITUDINAL', front: 'FRONTAL' };
const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
const vector = (array) => new THREE.Vector3(...array);

async function fetchAsset(url, binary = false) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`No se pudo cargar ${url.split('/').pop()} (${response.status}).`);
  return binary ? response.arrayBuffer() : response.json();
}

function colorFor(part) {
  const id = part.id;
  if (/REVEST|ELAST|CAUCHO/.test(id)) return '#252e35';
  if (/GUARDA|^N09_TAPA_ACOPLE/.test(id)) return '#d0aa35';
  if (/M076|M081|EJE|CHAVETA|6008|SY30|22240|KM40|MB40/.test(id) || part.commercial) return '#aeb8be';
  if (/TT10_M/.test(id)) return '#426778';
  return '#526573';
}

function hopperMaterial(part) {
  const id = part.id;
  let roughness = 0.53, metalness = 0.18;
  if (/ELAST|CAUCHO/.test(id) || /^P10/.test(id) || /elast[oó]mero|caucho/i.test(part.material)) {
    roughness = 0.98; metalness = 0;
  } else if (/Hardox|antidesgaste/i.test(part.material) || /^P11/.test(id)) {
    roughness = 0.7; metalness = 0.9;
  } else if (/MU[ÑN]ON|EJE|CHAVETA|PASADOR|PE_PIN|BUJE|M076|ENGRANAJE/.test(id) || /^J05|^M0[1-4]|^K0[1-7]|^J06|^J07|^P1[23468]/.test(id) || part.commercial && !/^M0[5-9]|^M10/.test(id)) {
    roughness = 0.32; metalness = 0.9;
  }
  return new THREE.MeshStandardMaterial({ name: part.material || '', color: colorFor(part), roughness, metalness,
    side: THREE.DoubleSide, envMapIntensity: metalness > 0.5 ? 1.0 : 0.55,
    polygonOffset: true, polygonOffsetFactor: 1, polygonOffsetUnits: 1 });
}

function geometryFromBuffer(part, binary, smooth = true) {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(binary, part.positionOffset, part.vertexCount * 3), 3));
  geometry.setIndex(new THREE.BufferAttribute(new Uint32Array(binary, part.indexOffset, part.indexCount), 1));
  geometry.computeVertexNormals();
  const result = smooth ? toCreasedNormals(geometry, Math.PI / 5) : geometry;
  if (smooth) geometry.dispose();
  result.computeBoundingBox();
  result.computeBoundingSphere();
  return result;
}

function makeStudio() {
  scene = new THREE.Scene();
  scene.background = new THREE.Color('#dfe7ed');
  renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, matchMedia('(max-width: 680px)').matches ? 1.5 : 2));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.04;
  renderer.domElement.setAttribute('aria-label', 'Planta 3D interactiva. Arrastra para girar, usa la rueda para acercar y Mayús más arrastrar para desplazar.');
  renderer.domElement.setAttribute('role', 'img');
  renderer.domElement.tabIndex = 0;
  $('#planta-scene').appendChild(renderer.domElement);
  camera = new THREE.OrthographicCamera(-10, 10, 7, -7, 0.01, 250);
  camera.up.set(0, 0, 1);
  controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.dampingFactor = 0.085;
  controls.screenSpacePanning = true;
  controls.minZoom = 0.35;
  controls.maxZoom = 14;
  controls.minPolarAngle = 0.0001;
  controls.maxPolarAngle = Math.PI * 0.53;
  controls.mouseButtons = { LEFT: THREE.MOUSE.ROTATE, MIDDLE: THREE.MOUSE.DOLLY, RIGHT: THREE.MOUSE.PAN };
  const room = new RoomEnvironment();
  const pmrem = new THREE.PMREMGenerator(renderer);
  environmentTarget = pmrem.fromScene(room, 0.04);
  scene.environment = environmentTarget.texture;
  scene.environmentIntensity = 0.7;
  room.dispose(); pmrem.dispose();
  scene.add(new THREE.AmbientLight('#e0edf6', 0.4));
  const hemi = new THREE.HemisphereLight('#f5faff', '#6b8191', 0.7);
  hemi.position.set(0, 0, 20); scene.add(hemi);
  const key = new THREE.DirectionalLight('#fff4e3', 2.7);
  key.position.set(-6, -4, 16); scene.add(key);
  const fill = new THREE.DirectionalLight('#c8e2ff', 1.2);
  fill.position.set(9, 4, 8); scene.add(fill);
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(100, 100), new THREE.MeshStandardMaterial({ color: '#dce5eb', roughness: 0.98, metalness: 0 }));
  ground.position.z = -0.04; scene.add(ground);
  const grid = new THREE.GridHelper(60, 60, '#9fb4c3', '#b8c9d4');
  grid.rotation.x = Math.PI / 2; grid.position.z = -0.035;
  grid.material.transparent = true; grid.material.opacity = 0.23; grid.material.depthWrite = false;
  scene.add(grid);
  model = new THREE.Group(); model.name = 'Implantación R01 · geometría nativa'; scene.add(model);
  edgeMaterial = new THREE.LineBasicMaterial({ color: '#163749', transparent: true, opacity: 0.32, depthWrite: false, toneMapped: false });
}

function addConveyors(binary) {
  referenceGroup = new THREE.Group(); referenceGroup.name = 'Reserva de espacio de operarios'; model.add(referenceGroup);
  const points = [], referencePoints = [];
  for (const part of meta.staticParts) {
    const geometry = geometryFromBuffer(part, binary);
    const isReference = part.equipment === 'reference';
    const isBelt = part.material === 'belt';
    const material = new THREE.MeshStandardMaterial({ name: part.material || part.label,
      color: part.color || '#237dad', roughness: isBelt ? 0.94 : isReference ? 0.75 : 0.47,
      metalness: part.material === 'metal' ? 0.78 : isBelt ? 0 : 0.25,
      side: THREE.DoubleSide, transparent: isReference, opacity: isReference ? 0.55 : 1,
      depthWrite: !isReference, envMapIntensity: isBelt ? 0.3 : 0.75,
      polygonOffset: true, polygonOffsetFactor: 1, polygonOffsetUnits: 1 });
    const mesh = new THREE.Mesh(geometry, material);
    mesh.name = part.label; mesh.scale.setScalar(mm);
    mesh.userData = { equipment: part.equipment, part: part.id, reference: isReference };
    (isReference ? referenceGroup : model).add(mesh); meshes.push(mesh);
    mesh.updateMatrix();
    appendEdges(mesh, isReference ? referencePoints : points, part.id);
  }
  staticEdges = makeEdges(points); staticEdges.name = 'Aristas de fajas fijas'; model.add(staticEdges);
  referenceEdges = makeEdges(referencePoints); referenceEdges.name = 'Aristas de reserva de operarios'; referenceGroup.add(referenceEdges);
}

function addHopper(binary) {
  tolvaRoot = new THREE.Group(); tolvaRoot.name = 'Tolva · origen normalizado';
  const normalization = meta.hopper_assets?.normalization_mm || [-7.5, -28.75, -6.5];
  tolvaRoot.position.fromArray(normalization).multiplyScalar(mm);
  model.add(tolvaRoot);
  fixed = new THREE.Group(); fixed.name = 'Tolva · estructura fija';
  moving = new THREE.Group(); moving.name = 'Tolva · cuba basculante';
  const pivot = meta.hopper_assets?.pivot_original_mm || hopperMeta.pivot_mm || [7.5, 28.75, 2357.5];
  moving.position.fromArray(pivot).multiplyScalar(mm);
  tolvaRoot.add(fixed, moving);
  const parts = new Map(hopperMeta.parts.map(part => [part.id, part]));
  const materials = new Map();
  const fixedPoints = [], movingPoints = [];
  for (const part of hopperMeta.parts) geometryCache.set(part.id, geometryFromBuffer(part, binary));
  for (const instance of hopperMeta.instances) {
    const part = parts.get(instance.part);
    if (!part) throw new Error(`La instancia ${instance.instance_key || instance.part} no tiene geometría.`);
    const materialKey = `${colorFor(part)}/${part.material || ''}`;
    if (!materials.has(materialKey)) materials.set(materialKey, hopperMaterial(part));
    const mesh = new THREE.Mesh(geometryCache.get(instance.part), materials.get(materialKey));
    const articulated = instance.group === 'movil';
    // Each u/v/n basis is applied once; origins are in the original hopper frame.
    mesh.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(vector(instance.u), vector(instance.v), vector(instance.n)));
    mesh.scale.setScalar(mm);
    mesh.position.fromArray(instance.origin).multiplyScalar(mm);
    if (articulated) mesh.position.sub(moving.position);
    mesh.name = instance.instance_key || instance.part;
    mesh.userData = { part: instance.part, equipment: 'hopper', moving: articulated,
      pin: instance.pin || 0, pawl: Boolean(instance.pawl), base: mesh.position.clone() };
    (articulated ? moving : fixed).add(mesh); meshes.push(mesh);
    mesh.updateMatrix();
    if (mesh.userData.pin || mesh.userData.pawl) {
      const line = new THREE.LineSegments(edgesFor(mesh.geometry, instance.part), edgeMaterial);
      line.raycast = () => {}; mesh.add(line); motionMeshes.push(mesh);
    } else appendEdges(mesh, articulated ? movingPoints : fixedPoints, instance.part);
  }
  fixedEdges = makeEdges(fixedPoints); fixedEdges.name = 'Aristas de tolva fija'; fixed.add(fixedEdges);
  movingEdges = makeEdges(movingPoints); movingEdges.name = 'Aristas de cuba'; moving.add(movingEdges);
}

function edgesFor(geometry, key) {
  if (!edgeCache.has(key)) edgeCache.set(key, new THREE.EdgesGeometry(geometry, 35));
  return edgeCache.get(key);
}

function appendEdges(mesh, output, key) {
  const positions = edgesFor(mesh.geometry, key).attributes.position;
  const matrix = mesh.matrix.elements;
  for (let i = 0; i < positions.count; i++) {
    const x = positions.getX(i), y = positions.getY(i), z = positions.getZ(i);
    output.push(matrix[0] * x + matrix[4] * y + matrix[8] * z + matrix[12],
      matrix[1] * x + matrix[5] * y + matrix[9] * z + matrix[13],
      matrix[2] * x + matrix[6] * y + matrix[10] * z + matrix[14]);
  }
}

function makeEdges(points) {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(points, 3));
  geometry.computeBoundingSphere();
  const line = new THREE.LineSegments(geometry, edgeMaterial);
  line.raycast = () => {};
  return line;
}

function addFlow() {
  flowsGroup = new THREE.Group(); flowsGroup.name = 'Flujo ilustrativo';
  const accepted = meta.flows?.accepted?.points_mm || [[-2555.68, 1900, 5300], [-2555.68, -2650, 5300], [-2555.68, -14000, 8250]];
  const rejected = meta.flows?.rejected?.points_mm || [[-2250, 0, 5310], [-1200, 0, 3400]];
  const discharge = [[2500, 0, 700], [4200, 0, 700]];
  flowEnvelope = new THREE.Box3().setFromPoints([...accepted, ...rejected, ...discharge].map(point => vector(point).multiplyScalar(mm))).expandByScalar(0.3);
  hopperFlowEnvelope = new THREE.Box3().setFromPoints([...rejected, ...discharge].map(point => vector(point).multiplyScalar(mm))).expandByScalar(0.3);
  const drawPath = (points, color) => {
    for (let i = 1; i < points.length; i++) {
      const from = vector(points[i - 1]).multiplyScalar(mm), to = vector(points[i]).multiplyScalar(mm);
      const direction = to.clone().sub(from), length = direction.length();
      if (length < 0.01) continue;
      const arrow = new THREE.ArrowHelper(direction.normalize(), from, length, color, Math.min(0.36, length * 0.2), Math.min(0.24, length * 0.12));
      arrow.line.material.depthTest = false; arrow.cone.material.depthTest = false;
      arrow.renderOrder = 5; flowsGroup.add(arrow);
    }
    const signal = new THREE.Mesh(new THREE.SphereGeometry(0.105, 12, 8), new THREE.MeshBasicMaterial({ color, depthTest: false }));
    signal.position.fromArray(points[0]).multiplyScalar(mm); signal.renderOrder = 6; flowsGroup.add(signal);
  };
  drawPath(accepted, '#198967');
  drawPath(rejected, '#cc7d26');
  // Lateral discharge direction is a diagram, never a chute or a particle path.
  drawPath(discharge, '#cc7d26');
  flowsGroup.visible = state.flows; scene.add(flowsGroup);
}

function updatePose() {
  if (!moving) return;
  moving.rotation.y = THREE.MathUtils.degToRad(state.angle);
  const released = state.angle > 0.1 ? 1 : 0;
  for (const mesh of motionMeshes) {
    mesh.position.copy(mesh.userData.base);
    mesh.position.y += mesh.userData.pin * 0.210 * released;
    if (mesh.userData.pawl) mesh.position.z -= 0.025 * released;
  }
  model.updateMatrixWorld(true);
}

function setAngle(value, manual = true) {
  const angle = Number(value);
  if (!Number.isFinite(angle)) return;
  if (manual) pause();
  state.angle = THREE.MathUtils.clamp(angle, 0, 70);
  $('#planta-angle').value = state.angle;
  $('#planta-angle-value').textContent = format(state.angle, state.angle % 1 > 0.05 ? 1 : 0);
  $('#planta-angle').setAttribute('aria-valuetext', `${format(state.angle, 1)} grados`);
  $('#planta-pose').textContent = state.angle < 0.1 ? 'Carga' : state.angle > 69.9 ? 'Descarga' : 'Basculamiento';
  $$('[data-planta-angle]').forEach(button => {
    const active = Math.abs(Number(button.dataset.plantaAngle) - state.angle) < 0.1;
    button.classList.toggle('active', active); button.setAttribute('aria-pressed', active);
  });
  updatePose();
}

function setEdges(show) {
  state.edges = Boolean(show);
  for (const line of [fixedEdges, movingEdges, staticEdges, referenceEdges]) if (line) line.visible = state.edges;
  for (const mesh of motionMeshes) for (const child of mesh.children) child.visible = state.edges;
  $('#planta-edges').classList.toggle('active', state.edges);
  $('#planta-edges').setAttribute('aria-pressed', state.edges);
}

function pause() {
  state.playing = false;
  $('#planta-play').disabled = false;
  $('#planta-pause').disabled = true;
  $('#planta-run-status').textContent = 'EN REPOSO';
  $('#planta-run-status').classList.remove('is-running');
}

function play() {
  if (!state.ready) return;
  state.direction = state.angle >= 69.9 ? -1 : state.angle <= 0.1 ? 1 : state.direction;
  state.playing = true;
  $('#planta-play').disabled = true;
  $('#planta-pause').disabled = false;
  $('#planta-run-status').textContent = 'GIRO VISUAL';
  $('#planta-run-status').classList.add('is-running');
}

function measureEnvelopes() {
  const initialAngle = state.angle;
  envelope = new THREE.Box3(); hopperEnvelope = new THREE.Box3();
  for (let angle = 0; angle <= 70; angle += 5) {
    state.angle = angle; updatePose();
    envelope.union(new THREE.Box3().setFromObject(model));
    hopperEnvelope.union(new THREE.Box3().setFromObject(tolvaRoot));
  }
  // Selection detail includes the picking belt and the operator space beside it.
  for (const mesh of meshes) if (['horizontal', 'reference'].includes(mesh.userData.equipment)) {
    hopperEnvelope.union(new THREE.Box3().setFromObject(mesh));
  }
  state.angle = initialAngle; updatePose();
}

function activeEnvelope() {
  const box = (state.view === 'selection' ? hopperEnvelope : envelope).clone();
  if (state.flows) box.union(state.view === 'selection' ? hopperFlowEnvelope : flowEnvelope);
  return box;
}

function fittedFrustum() {
  if (!camera || !envelope) return;
  const width = $('#planta-scene').clientWidth, height = $('#planta-scene').clientHeight;
  if (width < 2 || height < 2) return;
  const box = activeEnvelope();
  camera.updateMatrixWorld(true);
  const projected = new THREE.Box3();
  for (const x of [box.min.x, box.max.x]) for (const y of [box.min.y, box.max.y]) for (const z of [box.min.z, box.max.z]) {
    projected.expandByPoint(new THREE.Vector3(x, y, z).applyMatrix4(camera.matrixWorldInverse));
  }
  const aspect = width / height;
  // The complete rotated envelope is framed in every screen ratio, including mobile.
  const horizontal = projected.max.x - projected.min.x;
  const vertical = projected.max.y - projected.min.y;
  const span = Math.max(vertical, horizontal / aspect, 1) * 1.17;
  camera.left = -span * aspect / 2; camera.right = span * aspect / 2;
  camera.top = span / 2; camera.bottom = -span / 2;
  camera.updateProjectionMatrix();
}

function resize() {
  if (!renderer || panel.hidden) return;
  const width = $('#planta-scene').clientWidth, height = $('#planta-scene').clientHeight;
  if (width < 2 || height < 2) return;
  renderer.setSize(width, height, false);
  fittedFrustum();
}

function view(name = 'iso') {
  if (!camera || !envelope) return;
  state.view = Object.hasOwn(viewNames, name) ? name : 'iso';
  const box = activeEnvelope();
  const target = box.getCenter(new THREE.Vector3());
  const directions = { iso: [-1.15, -1.55, 1.05], selection: [-1.15, -1.55, 0.9], top: [0, -0.0001, 1], profile: [1, 0, 0.02], front: [0, -1, 0.02] };
  const distance = Math.max(30, box.getSize(new THREE.Vector3()).length() * 2);
  camera.position.copy(target).add(vector(directions[state.view]).normalize().multiplyScalar(distance));
  camera.zoom = 1;
  controls.target.copy(target); controls.update();
  fittedFrustum();
  $('#planta-view-label').textContent = `PLANTA R01 / ${viewNames[state.view]}`;
  $$('[data-planta-view]').forEach(button => {
    const active = button.dataset.plantaView === state.view;
    button.classList.toggle('active', active); button.setAttribute('aria-pressed', active);
  });
}

function fillInformation() {
  const dimensions = meta.dimensions || {};
  const set = (id, value, suffix = ' mm', digits = 1) => { if (Number.isFinite(value)) $(id).textContent = `${format(value, digits)}${suffix}`; };
  set('#planta-clearance', dimensions.horizontalVerticalClearanceMm, ' mm', 0);
  set('#planta-belt-height', dimensions.horizontalBeltCenterHeightMm);
  set('#planta-platform-height', dimensions.operatorReferenceHeightMm);
  set('#planta-inclination', dimensions.inclinedAngleDeg, '°');
  set('#planta-sweep-height', dimensions.hopperSweepMaxZMm);
  const counts = meta.counts || {};
  $('#planta-counts').textContent = `${format(counts.hopperInstances || hopperMeta.instances.length, 0)} tolva · ${format(counts.horizontalInstances || 367, 0)} horizontal · ${format(counts.inclinedInstances || 747, 0)} inclinada`;
  $('#planta-revision').textContent = `IMPLANTACIÓN ${meta.revision || 'R01'} · ${meta.date ? meta.date.split('-').reverse().join('/') : '28/10/2026'}`;
  $('#planta-status').textContent = meta.status || 'Implantación para revisión';
}

function animate(now) {
  requestAnimationFrame(animate);
  const dt = Math.min(0.06, (now - (lastFrame || now)) / 1000); lastFrame = now;
  if (panel.hidden || !state.ready) return;
  if (state.playing) {
    let angle = state.angle + state.direction * dt * 7;
    if (angle >= 70) { angle = 70; state.direction = -1; }
    else if (angle <= 0) { angle = 0; pause(); state.direction = 1; }
    setAngle(angle, false);
  }
  controls.update();
  renderer.render(scene, camera);
}

async function init() {
  if (loading || state.ready || !panel || panel.hidden) return;
  loading = true;
  $('#planta-error').hidden = true; $('#planta-loading').hidden = false;
  $('#planta-loading-detail').textContent = 'Fajas, tolva y reserva de operarios';
  try {
    const [plantMetadata, plantBinary, hopperMetadata, hopperBinary] = await Promise.all([
      fetchAsset('assets/plant-r01.json?v=20261028-R01'), fetchAsset('assets/plant-r01.bin?v=20261028-R01', true),
      fetchAsset('assets/machine-c05.json?v=20261025'), fetchAsset('assets/machine-c05.bin?v=20261025', true)
    ]);
    meta = plantMetadata; hopperMeta = hopperMetadata;
    if (!Array.isArray(meta.staticParts) || !meta.staticParts.length || !Array.isArray(hopperMeta.instances)) throw new Error('Los datos de geometría están incompletos.');
    makeStudio();
    $('#planta-loading-detail').textContent = 'Preparando superficies y aristas';
    // Let the loader paint before preparing the native geometry.
    await new Promise(resolve => requestAnimationFrame(resolve));
    addConveyors(plantBinary); addHopper(hopperBinary); addFlow();
    updatePose(); measureEnvelopes(); fillInformation();
    state.ready = true;
    view('iso'); resize(); setEdges(state.edges); setAngle(state.angle, false);
    $('#planta-loading').hidden = true;
    $('#planta-scene').dataset.rendererVersion = 'PLANTA-R01-20261028';
    $('#planta-play').disabled = false;
    $$('[data-planta-requires-model]').forEach(control => control.disabled = false);
    new ResizeObserver(resize).observe($('#planta-viewport'));
    window.planta = { setAngle, view, renderer, scene, camera, controls, state, meta, meshes, ready: true };
    requestAnimationFrame(animate);
  } catch (error) {
    state.ready = false;
    console.error('Visor de planta R01:', error);
    $('#planta-loading').hidden = true;
    $('#planta-error').hidden = false;
    $('#planta-error-message').textContent = error.message || 'No se pudo preparar el modelo 3D.';
    if (renderer) { renderer.dispose(); renderer.domElement.remove(); renderer = null; }
    if (scene) {
      const materials = new Set(), geometries = new Set();
      scene.traverse(object => {
        if (object.geometry) geometries.add(object.geometry);
        if (object.material) (Array.isArray(object.material) ? object.material : [object.material]).forEach(material => materials.add(material));
      });
      geometries.forEach(geometry => geometry.dispose()); materials.forEach(material => material.dispose());
    }
    if (controls) controls.dispose(); if (environmentTarget) environmentTarget.dispose();
    edgeCache.forEach(geometry => geometry.dispose()); edgeCache.clear(); geometryCache.clear();
    meshes.length = 0; motionMeshes.length = 0;
  } finally { loading = false; }
}

function visibilityChanged() {
  if (!panel) return;
  if (panel.hidden) { if (state.playing) pause(); return; }
  if (!state.ready) init();
  else if (state.ready) { lastFrame = 0; requestAnimationFrame(resize); }
}

function wireControls() {
  $$('[data-planta-view]').forEach(button => button.addEventListener('click', () => view(button.dataset.plantaView)));
  $$('[data-planta-angle]').forEach(button => button.addEventListener('click', () => setAngle(button.dataset.plantaAngle)));
  $('#planta-angle').addEventListener('input', event => setAngle(event.target.value));
  $('#planta-play').addEventListener('click', play);
  $('#planta-pause').addEventListener('click', pause);
  $('#planta-reset').addEventListener('click', () => { state.direction = 1; setAngle(0); });
  $('#planta-fit').addEventListener('click', () => view(state.view));
  $('#planta-edges').addEventListener('click', () => setEdges(!state.edges));
  $('#planta-reference').addEventListener('change', event => { state.reference = event.target.checked; if (referenceGroup) referenceGroup.visible = state.reference; });
  $('#planta-flow').addEventListener('change', event => {
    state.flows = event.target.checked; if (flowsGroup) flowsGroup.visible = state.flows;
    $('#planta-flow-legend').hidden = !state.flows;
    if (state.ready) view(state.view);
  });
  $('#planta-retry').addEventListener('click', init);
  $('#planta-fullscreen').addEventListener('click', async () => {
    try {
      if (document.fullscreenElement === $('#planta-viewport')) await document.exitFullscreen();
      else await $('#planta-viewport').requestFullscreen();
    } catch { $('#planta-live').textContent = 'El navegador no permite ampliar el visor en pantalla completa.'; }
  });
  document.addEventListener('fullscreenchange', resize);
  $('#planta-viewport').addEventListener('keydown', event => {
    if (event.target.matches('input, button, select, a') || event.altKey || event.ctrlKey || event.metaKey || !state.ready) return;
    if (event.key === ' ') { event.preventDefault(); state.playing ? pause() : play(); }
    else if (event.key.toLowerCase() === 'f') { event.preventDefault(); view(state.view); }
    else if (event.key.toLowerCase() === 'a') { event.preventDefault(); setEdges(!state.edges); }
    else if (event.key === 'ArrowRight' || event.key === 'ArrowLeft') { event.preventDefault(); setAngle(state.angle + (event.key === 'ArrowRight' ? 1 : -1)); }
    else if (event.key === 'Home') { event.preventDefault(); setAngle(0); }
    else if (event.key === 'End') { event.preventDefault(); setAngle(70); }
  });
  if (reducedMotion) $('#planta-motion-note').textContent = 'El giro se inicia solo al pulsar Reproducir. También puedes ajustar el ángulo manualmente.';
}

if (panel) {
  wireControls();
  new MutationObserver(visibilityChanged).observe(panel, { attributes: true, attributeFilter: ['hidden'] });
  window.addEventListener('hashchange', () => requestAnimationFrame(visibilityChanged));
  visibilityChanged();
}
