import * as THREE from 'three';
import { OrbitControls } from './assets/vendor/OrbitControls.js';
import { RoomEnvironment } from './assets/vendor/RoomEnvironment.js';
import { toCreasedNormals } from './assets/vendor/BufferGeometryUtils.js';

const $ = (s) => document.querySelector(s);
const $$ = (s) => [...document.querySelectorAll(s)];
const nf = (n, digits=2) => Number(n).toLocaleString('es-ES',{maximumFractionDigits:digits,minimumFractionDigits:digits});
const escape = (v) => String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const fmt = (v, digits=2) => typeof v === 'number' ? nf(v,digits) : escape(v);
const state = {angle:0,playing:false,time:0,rate:4,explosion:0,coal:true,transmission:false,section:false,edges:true,dimensions:false,phase:0,started:false,selected:[]};
let data, meshes=[], geometries=new Map(), machine, moving, fixed, renderer, scene, camera, controls, coalMesh, raycaster, dimensionsGroup;
let selectedParts=new Set(), dimensionLabels=[], lastFrame=performance.now(), hasMoved=false, calcTab='results', frameCount=0;
let fixedEdges,movingEdges,edgeMaterial,edgeArrangement='',edgeCache=new Map();
const vec=(a)=>new THREE.Vector3(...a);
const turnDuration=25.3333333333, dischargeStart=8+turnDuration, returnStart=dischargeStart+6, cycleDuration=returnStart+turnDuration;

function toast(text){$('#toast').textContent=text;$('#toast').hidden=false;clearTimeout(toast.timer);toast.timer=setTimeout(()=>$('#toast').hidden=true,3400);}
function setTab(tab){
  const valid=['simulacion','calculos','piezas'].includes(tab)?tab:'simulacion';
  $$('.tab-panel').forEach(el=>el.hidden=el.id!==valid);
  $$('.nav-link').forEach(el=>{el.classList.toggle('active',el.dataset.tab===valid);el.setAttribute('aria-current',el.dataset.tab===valid?'page':'false');});
  if(valid!=='simulacion')pause(); else requestAnimationFrame(resize);
}
window.addEventListener('hashchange',()=>setTab(location.hash.slice(1)));

function humanCategory(code){
  return data?.parts.find(p=>p.code===code)?.category || '';
}
function colorFor(p){
  const id=p.id;
  if(/^P10/.test(id))return '#22272a';
  if(/^P11/.test(id))return '#747e84';
  if(/^P0/.test(id))return '#32657d';
  if(/^B0/.test(id))return '#2e5266';
  if(/^C0|^J0[1-4]/.test(id))return '#34434e';
  if(isGuard(id))return '#e1af22';
  if(/^M0[5-9]|^M10/.test(id))return '#275b79';
  if(/^J05|^M0[1-4]|^K0[1-7]/.test(id))return '#bec6cc';
  if(p.commercial || /^P1[2-468]|^J06|^J07/.test(id))return '#a8b2b9';
  if(/^L01|^L02|^L1[0-3]/.test(id))return '#586874';
  return '#354653';
}
function isGuard(id){return /GUARDA|^N09_TAPA_ACOPLE/.test(id);}

// Procedural surface finishes; the small grain changes light response only.
function surfaceMaps(){
  let seed=5204;const random=()=>{seed=(seed*1664525+1013904223)>>>0;return seed/4294967296;};
  function grain(brushed){const c=document.createElement('canvas');c.width=c.height=256;const ctx=c.getContext('2d'),image=ctx.createImageData(256,256);for(let y=0;y<256;y++){const stripe=brushed?(random()-.5)*36:0;for(let x=0;x<256;x++){const k=(y*256+x)*4,v=Math.round((brushed?205:225)+stripe+(random()-.5)*(brushed?12:26));image.data[k]=image.data[k+1]=image.data[k+2]=v;image.data[k+3]=255;}}ctx.putImageData(image,0,0);const t=new THREE.CanvasTexture(c);t.wrapS=t.wrapT=THREE.RepeatWrapping;t.anisotropy=Math.min(8,renderer.capabilities.getMaxAnisotropy());return t;}
  return {paint:grain(false),steel:grain(true)};
}
function materialFor(p,maps){
  const id=p.id;let roughness=.5,metalness=0,bumpScale=.00004,map=maps.paint;
  if(/^P10/.test(id)){roughness=.98;metalness=0;bumpScale=.00025;}
  else if(/^P11/.test(id)){roughness=.7;metalness=.95;bumpScale=.00012;map=maps.steel;}
  else if(/^J05|^M0[1-4]|^K0[1-7]|^J06|^J07|^P1[23468]/.test(id)||p.commercial&&!/^M0[5-9]|^M10/.test(id)){roughness=.31;metalness=.95;bumpScale=.000025;map=maps.steel;}
  const mat=new THREE.MeshStandardMaterial({name:p.material,color:colorFor(p),roughness,metalness,roughnessMap:map,bumpMap:map,bumpScale,flatShading:false,side:THREE.DoubleSide,envMapIntensity:metalness>.5?1.05:.55,polygonOffset:true,polygonOffsetFactor:1,polygonOffsetUnits:1});
  return mat;
}
function prepareGeometry(geometry){
  // Preserve sharp sheet edges and smooth the tessellation of turned surfaces.
  const smooth=toCreasedNormals(geometry,Math.PI/5),pos=smooth.attributes.position,normal=smooth.attributes.normal,uv=new Float32Array(pos.count*2);
  for(let i=0;i<pos.count;i++){const x=pos.getX(i),y=pos.getY(i),z=pos.getZ(i),nx=Math.abs(normal.getX(i)),ny=Math.abs(normal.getY(i)),nz=Math.abs(normal.getZ(i));uv[i*2]=(nx>ny&&nx>nz?y:x)*.003;uv[i*2+1]=(nz>nx&&nz>ny?y:z)*.003;}
  smooth.setAttribute('uv',new THREE.BufferAttribute(uv,2));smooth.computeBoundingSphere();return smooth;
}

async function init3D(){
  const [meta,binary]=await Promise.all([fetch('assets/machine.json').then(r=>r.json()),fetch('assets/machine.bin').then(r=>r.arrayBuffer())]);
  scene=new THREE.Scene();scene.background=new THREE.Color('#dce4eb');
  renderer=new THREE.WebGLRenderer({antialias:true,alpha:false,powerPreference:'high-performance'});
  renderer.setPixelRatio(Math.min(window.devicePixelRatio,2));renderer.domElement.style.width='100%';renderer.domElement.style.height='100%';renderer.outputColorSpace=THREE.SRGBColorSpace;renderer.toneMapping=THREE.ACESFilmicToneMapping;renderer.toneMappingExposure=1.06;renderer.localClippingEnabled=true;
  renderer.shadowMap.enabled=true;renderer.shadowMap.type=THREE.PCFSoftShadowMap;renderer.shadowMap.autoUpdate=false;
  $('#scene').appendChild(renderer.domElement);
  camera=new THREE.OrthographicCamera(-4,4,3,-3,.01,100);camera.up.set(0,0,1);
  controls=new OrbitControls(camera,renderer.domElement);controls.enableDamping=true;controls.dampingFactor=.08;controls.minZoom=.4;controls.maxZoom=8;controls.minPolarAngle=.03;controls.maxPolarAngle=Math.PI*.56;controls.target.set(.7,0,1.4);
  controls.addEventListener('start',()=>hasMoved=true);
  const studio=new RoomEnvironment(),pmrem=new THREE.PMREMGenerator(renderer);scene.environment=pmrem.fromScene(studio,.04).texture;scene.environmentIntensity=.8;studio.dispose();pmrem.dispose();
  scene.add(new THREE.AmbientLight('#dbe8f0',.14));const hemi=new THREE.HemisphereLight('#f3f8ff','#677b8d',.45);hemi.position.set(0,0,10);scene.add(hemi);
  const key=new THREE.DirectionalLight('#fff5e8',3.1);key.position.set(-3,-4,8);key.target.position.set(.7,0,1.2);key.castShadow=true;const shadowSize=matchMedia('(max-width:680px)').matches?1024:2048;key.shadow.mapSize.set(shadowSize,shadowSize);Object.assign(key.shadow.camera,{left:-4.8,right:4.8,top:4.8,bottom:-4.8,near:.5,far:22});key.shadow.camera.updateProjectionMatrix();key.shadow.bias=-.00012;key.shadow.normalBias=.003;scene.add(key,key.target);
  const fill=new THREE.DirectionalLight('#c9e4ff',.75);fill.position.set(5,3,4);scene.add(fill);
  const ground=new THREE.Mesh(new THREE.PlaneGeometry(60,60),new THREE.MeshStandardMaterial({color:'#dce3e8',roughness:.95,metalness:0,envMapIntensity:.15}));ground.position.z=-.02;ground.receiveShadow=true;scene.add(ground);
  const grid=new THREE.GridHelper(24,48,'#adc0cc','#becdd7');grid.rotation.x=Math.PI/2;grid.position.z=-.015;grid.material.transparent=true;grid.material.opacity=.19;grid.material.depthWrite=false;scene.add(grid);
  // Soft presentation shadow; no mechanical contact analysis is inferred from this.
  const cv=document.createElement('canvas');cv.width=cv.height=128;const ctx=cv.getContext('2d'),gr=ctx.createRadialGradient(64,64,0,64,64,64);gr.addColorStop(0,'rgba(37,64,82,.2)');gr.addColorStop(1,'rgba(37,64,82,0)');ctx.fillStyle=gr;ctx.fillRect(0,0,128,128);
  const shadow=new THREE.Mesh(new THREE.PlaneGeometry(9,5.8),new THREE.MeshBasicMaterial({map:new THREE.CanvasTexture(cv),transparent:true,depthWrite:false}));shadow.position.set(.7,0,-.014);scene.add(shadow);
  machine=new THREE.Group();scene.add(machine);moving=new THREE.Group();moving.position.z=1.4;fixed=new THREE.Group();machine.add(fixed,moving);
  const partMap=new Map(meta.parts.map(p=>[p.id,p]));
  for(const p of meta.parts){
    const geom=new THREE.BufferGeometry();geom.setAttribute('position',new THREE.BufferAttribute(new Float32Array(binary,p.positionOffset,p.vertexCount*3),3));geom.setIndex(new THREE.BufferAttribute(new Uint32Array(binary,p.indexOffset,p.indexCount),1));geom.computeVertexNormals();geometries.set(p.id,prepareGeometry(geom));geom.dispose();
  }
  const materials=new Map(),maps=surfaceMaps();
  for(const ins of meta.instances){
    const p=partMap.get(ins.part),key=colorFor(p)+'/'+(p.material||'');
    if(!materials.has(key))materials.set(key,materialFor(p,maps));
    const mesh=new THREE.Mesh(geometries.get(ins.part),materials.get(key));
    mesh.receiveShadow=true;mesh.castShadow=mesh.geometry.boundingSphere.radius>90&&!/^P1[23468]/.test(ins.part);
    const matrix=new THREE.Matrix4().makeBasis(vec(ins.u),vec(ins.v),vec(ins.n));mesh.quaternion.setFromRotationMatrix(matrix);mesh.scale.setScalar(.001);
    mesh.position.set(ins.origin[0]/1000,ins.origin[1]/1000,ins.origin[2]/1000-(ins.group==='movil'?1.4:0));
    mesh.userData={part:ins.part,key:ins.instance_key,moving:ins.group==='movil',base:mesh.position.clone(),guard:isGuard(ins.part),material:mesh.material};
    // One radial presentation offset per part; these offsets are never used as assembly data.
    const center=geometries.get(ins.part).boundingSphere.center.clone().multiplyScalar(.001).applyQuaternion(mesh.quaternion).add(mesh.position);
    const dir=center.clone().sub(new THREE.Vector3(0,0,ins.group==='movil'?0:1));
    if(dir.length()<.02)dir.set(0,0,1);dir.normalize();mesh.userData.explode=dir.multiplyScalar(.48+Math.min(1,center.length())*.18);
    (mesh.userData.moving?moving:fixed).add(mesh);meshes.push(mesh);
  }
  makeCoal();makeDimensions();raycaster=new THREE.Raycaster();
  let down=null;
  renderer.domElement.addEventListener('pointerdown',e=>{down=[e.clientX,e.clientY];});
  renderer.domElement.addEventListener('pointerup',e=>{if(!down||Math.hypot(e.clientX-down[0],e.clientY-down[1])>5)return;const rect=renderer.domElement.getBoundingClientRect();raycaster.setFromCamera(new THREE.Vector2((e.clientX-rect.left)/rect.width*2-1,-(e.clientY-rect.top)/rect.height*2+1),camera);const hits=raycaster.intersectObjects(meshes.filter(m=>m.visible));const hit=hits.find(h=>!state.section||h.point.x>=0);if(hit)selectParts([hit.object.userData.part]);else clearSelection();});
  new ResizeObserver(resize).observe($('#viewport'));document.addEventListener('fullscreenchange',resize);
  view('iso');resize();updatePose();$('#scene').dataset.rendererVersion='materiales-20261015';$('#loading').hidden=true;requestAnimationFrame(animate);
  window.p04={state,data,meshes,scene,camera,controls,setAngle,view,selectParts,meta,renderer};
}

function resize(){if(!renderer)return;const w=$('#scene').clientWidth,h=$('#scene').clientHeight;if(w<1||h<1)return;renderer.setSize(w,h,false);const aspect=w/h;const hspan=Math.max(5.1,8.5/aspect);camera.left=-hspan*aspect/2;camera.right=hspan*aspect/2;camera.top=hspan/2;camera.bottom=-hspan/2;camera.updateProjectionMatrix();}
function view(name, resetZoom=true){
  if(!camera)return;const target=new THREE.Vector3(.65,0,1.4);const views={iso:[7,-9,6],front:[-10,0,0],side:[0,-10,0],back:[10,0,0],top:[0,-.001,10],other:[0,10,0],bottom:[0,-.001,-10]};camera.position.copy(target).add(vec(views[name]||views.iso));controls.target.copy(target);controls.maxPolarAngle=name==='bottom'?Math.PI-.00001:Math.PI*.56;if(resetZoom)camera.zoom=1;camera.updateProjectionMatrix();controls.update();
  const names={iso:'ISOMÉTRICA',front:'FRONTAL',side:'LATERAL',back:'POSTERIOR',top:'PLANTA',other:'LATERAL OPUESTO',bottom:'INFERIOR'};$('#view-label').textContent='CONJUNTO / '+names[name];$('#extra-view').value=['other','bottom'].includes(name)?name:'';$$('[data-view]').forEach(b=>{b.classList.toggle('active',b.dataset.view===name);b.setAttribute('aria-pressed',b.dataset.view===name);});
}
function setAngle(angle,manual=true){
  state.angle=Math.max(0,Math.min(70,Number(angle)));if(manual){pause();state.started=false;state.time=0;}
  $('#angle-value').textContent=nf(state.angle,state.angle%1>.05?1:0);$('#angle').value=state.angle;
  $('#position-tag').textContent=state.angle<.5?'Carga':state.angle>69.5?'Descarga':'Basculamiento';
  $$('[data-angle]').forEach(b=>b.classList.toggle('active',Math.abs(Number(b.dataset.angle)-state.angle)<.1));
  updatePose();
}
function updatePose(){if(!moving)return;moving.rotation.x=THREE.MathUtils.degToRad(state.angle);for(const m of meshes){m.position.copy(m.userData.base).addScaledVector(m.userData.explode,state.explosion);m.visible=!(state.transmission&&m.userData.guard);if(/^L03_PASADOR|^L14_CLIP/.test(m.userData.part)&&state.angle>.1)m.visible=false;}updateCoal();refreshEdges();renderer.shadowMap.needsUpdate=true;}
function pause(){state.playing=false;$('#play').disabled=false;$('#pause').disabled=true;$('#play').innerHTML='<span>▶</span> '+(state.started&&state.time<cycleDuration?'Continuar ciclo':'Reproducir ciclo');$('#run-status').textContent='EN REPOSO';$('#run-status').classList.remove('running');$('#brake-status').textContent='● Freno aplicado';$('#machine-speed').textContent='0,00 rpm';}
function play(){if(!state.started||state.time>=cycleDuration){state.time=0;state.started=true;clearSelection();$('#explode').value=0;state.explosion=0;$('#explode-value').textContent='0 %';}state.playing=true;$('#play').disabled=true;$('#pause').disabled=false;$('#run-status').textContent='CICLO EN CURSO';$('#run-status').classList.add('running');}
function reset(){pause();state.time=0;state.started=false;state.phase=0;setAngle(0,false);$('#cycle-progress').style.width='0%';$$('[data-phase]').forEach(el=>el.classList.toggle('current',el.dataset.phase==='0'));$('#play').innerHTML='<span>▶</span> Reproducir ciclo';}
function travel(t){if(t<=0)return [0,0];if(t<2)return [.75*t*t,1.5*t];if(t<turnDuration-2)return [3+3*(t-2),3];if(t<turnDuration){const u=t-(turnDuration-2);return [67+3*u-.75*u*u,3-1.5*u];}return [70,0];}
function updateCycle(dt){
  state.time=Math.min(cycleDuration,state.time+dt*state.rate);let angle=0,speed=0;
  if(state.time<8){state.phase=0;}
  else if(state.time<dischargeStart){state.phase=1;[angle,speed]=travel(state.time-8);}
  else if(state.time<returnStart){state.phase=2;angle=70;}
  else{state.phase=3;const [a,v]=travel(state.time-returnStart);angle=70-a;speed=v;}
  setAngle(angle,false);$('#cycle-progress').style.width=(state.time/cycleDuration*100)+'%';$$('[data-phase]').forEach(el=>el.classList.toggle('current',Number(el.dataset.phase)===state.phase));$('#brake-status').textContent=speed>.001?'○ Freno liberado':'● Freno aplicado';$('#machine-speed').textContent=nf(speed/6,2)+' rpm';
  if(state.time>=cycleDuration)pause();
}

let coalSeeds=[],dummy=new THREE.Object3D();
function makeCoal(){
  let seed=1504;const random=()=>{seed=(1664525*seed+1013904223)>>>0;return seed/4294967296;};
  const geom=new THREE.IcosahedronGeometry(1,0),mat=new THREE.MeshStandardMaterial({color:'#26333b',roughness:.97,metalness:.02,flatShading:true});
  coalMesh=new THREE.InstancedMesh(geom,mat,600);coalMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);coalMesh.frustumCulled=false;scene.add(coalMesh);
  for(let i=0;i<600;i++){const x=(random()*2-1)*1.65,y=(random()*2-1)*1.08,z=2.08+random()*.1;coalSeeds.push({x,y,z,size:.058+random()*.038,r:random(),rot:[random()*3,random()*3,random()*3]});coalMesh.setColorAt(i,new THREE.Color().setHSL(.57,.06,.11+random()*.08));}
}
function rotatePoint(x,y,z,angle){const a=angle*Math.PI/180;return [x,y*Math.cos(a)-(z-1.4)*Math.sin(a),1.4+y*Math.sin(a)+(z-1.4)*Math.cos(a)];}
function updateCoal(){
  if(!coalMesh)return;coalMesh.visible=state.coal&&state.explosion===0;if(!coalMesh.visible)return;
  const receiving=state.started&&state.time<8,returning=state.started&&state.phase===3;
  for(let i=0;i<coalSeeds.length;i++){
    const p=coalSeeds[i];let {x,y,z}=p,scale=p.size;
    if(receiving){
      const appear=p.r*7.1,flight=state.time-appear;if(flight<0)scale=0;else if(flight<.85){z=Math.max(p.z,4.35-4.905*flight*flight);}
    }
    let flow=Math.max(0,(state.angle-30)/40);if(state.started&&state.phase===2)flow+=(state.time-dischargeStart)/6;if(returning)flow=2;
    const prog=Math.max(0,Math.min(2,(flow-p.r*.65)*2.2));
    if(prog>0){
      const slide=Math.min(1,prog);y=y*(1-slide)-1.34*slide;z=z*(1-slide)+2.39*slide;
      [x,y,z]=rotatePoint(x,y,z,returning?70:state.angle);
      if(prog>1){const t=(prog-1)*1.3;z=Math.max(.055+p.r*.09,z-4.905*t*t);y-=Math.min(.8,t*.6);}
    }else [x,y,z]=rotatePoint(x,y,z,state.angle);
    dummy.position.set(x,y,z);dummy.rotation.set(...p.rot);dummy.scale.set(scale*1.2,scale*.85,scale*.7);dummy.updateMatrix();coalMesh.setMatrixAt(i,dummy.matrix);
  }
  coalMesh.instanceMatrix.needsUpdate=true;
}

function makeDimensions(){
  dimensionsGroup=new THREE.Group();scene.add(dimensionsGroup);dimensionsGroup.visible=false;
  const material=new THREE.LineBasicMaterial({color:'#4684a5',transparent:true,opacity:.85});
  function line(a,b){const geo=new THREE.BufferGeometry().setFromPoints([vec(a),vec(b)]);dimensionsGroup.add(new THREE.Line(geo,material));}
  function dim(a,b,label){line(a,b);const d=vec(b).sub(vec(a)).normalize(),side=Math.abs(d.z)>.8?new THREE.Vector3(.08,0,0):new THREE.Vector3(0,0,.07);for(const p of [a,b])line(vec(p).sub(side).toArray(),vec(p).add(side).toArray());const span=document.createElement('span');span.className='dimension-label';span.textContent=label;span.hidden=true;$('#viewport').appendChild(span);dimensionLabels.push({el:span,point:vec(a).add(vec(b)).multiplyScalar(.5)});}
  dim([-1.9,-1.7,2.5],[1.9,-1.7,2.5],'3800 · boca');dim([-2.25,-1.4,2.47],[-2.25,1.4,2.47],'2800 · boca');dim([-2.6,1.8,0],[-2.6,1.8,2.35],'2350 · altura');dim([-2.1,-2.05,.03],[4.1,-2.05,.03],'6200 · conjunto');dim([-2.35,-1.6,.03],[-2.35,1.6,.03],'3200 · base');
}
function updateDimensionLabels(){if(!camera)return;const w=$('#scene').clientWidth,h=$('#scene').clientHeight;for(const d of dimensionLabels){const p=d.point.clone().project(camera);d.el.hidden=!state.dimensions||p.z>1||p.z< -1;d.el.style.left=((p.x+1)*w/2)+'px';d.el.style.top=((-p.y+1)*h/2)+'px';}}
function refreshEdges(force=false){
  if(!machine)return;
  if(!fixedEdges){edgeMaterial=new THREE.LineBasicMaterial({color:'#162e3c',transparent:true,opacity:.34,depthWrite:false,toneMapped:false});fixedEdges=new THREE.LineSegments(new THREE.BufferGeometry(),edgeMaterial);movingEdges=new THREE.LineSegments(new THREE.BufferGeometry(),edgeMaterial);fixed.add(fixedEdges);moving.add(movingEdges);}
  fixedEdges.visible=movingEdges.visible=state.edges;$('#edges').classList.toggle('active',state.edges);$('#edges').setAttribute('aria-pressed',state.edges);
  if(!state.edges)return;const arrangement=[state.explosion,state.transmission,state.angle>.1].join('/');if(!force&&arrangement===edgeArrangement)return;edgeArrangement=arrangement;
  const positions={fixed:[],moving:[]};
  for(const m of meshes){if(!m.visible)continue;const id=m.userData.part;if(!edgeCache.has(id))edgeCache.set(id,new THREE.EdgesGeometry(m.geometry,32));const p=edgeCache.get(id).attributes.position;m.updateMatrix();const e=m.matrix.elements,out=m.userData.moving?positions.moving:positions.fixed;for(let i=0;i<p.count;i++){const x=p.getX(i),y=p.getY(i),z=p.getZ(i);out.push(e[0]*x+e[4]*y+e[8]*z+e[12],e[1]*x+e[5]*y+e[9]*z+e[13],e[2]*x+e[6]*y+e[10]*z+e[14]);}}
  for(const [line,points] of [[fixedEdges,positions.fixed],[movingEdges,positions.moving]]){line.geometry.dispose();line.geometry=new THREE.BufferGeometry();line.geometry.setAttribute('position',new THREE.Float32BufferAttribute(points,3));line.geometry.computeBoundingSphere();}
}
function toggleEdges(){
  state.edges=!state.edges;refreshEdges(true);
}
function toggleSection(){
  state.section=!state.section;$('#section').classList.toggle('active',state.section);$('#section').setAttribute('aria-pressed',state.section);const clip=state.section?[new THREE.Plane(new THREE.Vector3(1,0,0),0)]:[];for(const m of meshes){m.material.clippingPlanes=clip;m.userData.material.clippingPlanes=clip;}coalMesh.material.clippingPlanes=clip;if(edgeMaterial)edgeMaterial.clippingPlanes=clip;renderer.shadowMap.needsUpdate=true;
  if(state.section)toast('Sección X = 0 · vista interior de la cuba');
}
function clearSelection(){for(const m of meshes){if(m.userData.highlight){m.material=m.userData.material;m.userData.highlight.dispose();m.userData.highlight=null;}}selectedParts.clear();$('#part-tooltip').hidden=true;}
function selectParts(codes){
  clearSelection();selectedParts=new Set(codes);for(const m of meshes)if(selectedParts.has(m.userData.part)){m.userData.highlight=m.material.clone();m.userData.highlight.color.set('#2e9cd0');m.userData.highlight.emissive.set('#1c6e99');m.userData.highlight.emissiveIntensity=.35;m.material=m.userData.highlight;}
  const p=data.parts.find(p=>p.code===codes[0]);if(!p)return;$('#selected-code').textContent=codes.length>1?p.family+' · '+codes.length+' códigos':p.code;$('#selected-title').textContent=p.title;const all=data.parts.filter(p=>selectedParts.has(p.code));$('#selected-meta').textContent=all.reduce((n,p)=>n+p.quantity,0)+' uds. · '+nf(all.reduce((n,p)=>n+p.massKg,0),1)+' kg · '+p.material;$('#part-tooltip').hidden=false;
}
function animate(now){requestAnimationFrame(animate);const dt=Math.min(.1,(now-lastFrame)/1000);lastFrame=now;if($('#simulacion').hidden)return;if(state.playing)updateCycle(dt);controls.update();renderer.render(scene,camera);if(state.dimensions)updateDimensionLabels();frameCount++;}

function renderMetrics(){
  const s=data.summary;const cards=[['VOLUMEN ÚTIL',nf(s.usefulVolumeM3,3),'m³','Protección interior descontada.'],['CAPACIDAD VOLUMÉTRICA',nf(s.capacityRangeKg[0]/1000,2)+'–'+nf(s.capacityRangeKg[1]/1000,2),'t','Densidad aparente: 720–880 kg/m³.'],['PAR DE SERVICIO',nf(s.operatingTorqueNm/1000,2),'kN·m','Pico transmitido de frenado: '+nf(s.peakTransmittedTorqueNm/1000,2)+' kN·m.'],['MASA MÓVIL',nf(s.movingMassKg/1000,3),'t','Equipo completo: '+nf(s.totalMassKg/1000,3)+' t.']];
  $('#calculation-metrics').innerHTML=cards.map(([title,v,unit,note])=>`<div class="metric-card"><span>${title}</span><strong>${v}<small>${unit}</small></strong><p>${note}</p></div>`).join('');
}
function calcOptions(){const rows=calcTab==='checks'?data.checks:data.calculations;const values=[...new Set(rows.map(r=>r.category))].sort();$('#calc-category').innerHTML='<option value="">Todos los temas</option>'+values.map(v=>`<option>${escape(v)}</option>`).join('');}
function displayNumeric(d){if(!d)return '—';return typeof d.value==='number'?nf(d.value,Math.abs(d.value)>=10000?0:2)+' <span class="cell-subtitle" style="display:inline">'+escape(d.unit)+'</span>':escape(d.value)+' '+escape(d.unit);}
function formulaVariables(formula){
  const refs=new Map([...data.inputs.map(r=>[r.key,r]),...data.calculations.map(r=>[r.id,r])]);
  return [...new Set(formula.match(/[A-Za-z_][A-Za-z_0-9]*/g)||[])].filter(k=>refs.has(k)).slice(0,12).map(k=>{const r=refs.get(k),d=r.display||{value:r.value,unit:r.unit};return `<span class="variable-row"><code>${escape(k)}</code><span>${escape(r.title)}</span><strong>${displayNumeric(d)}</strong></span>`;}).join('');
}
function renderCalc(){
  $('#calc-controls').hidden=calcTab==='commercial';
  if(calcTab==='commercial'){
    $('#calc-content').innerHTML='<div class="commercial-grid">'+data.commercial.map(c=>`<article class="commercial-card"><span>${escape(c.title)}</span><h3>${escape(c.reference)}</h3><p>${escape(c.detail)}</p>${c.source?`<a href="${escape(c.source)}" target="_blank" rel="noopener">Referencia del fabricante ↗</a>`:''}</article>`).join('')+'</div>';return;
  }
  const q=$('#calc-search').value.toLowerCase(),cat=$('#calc-category').value,checks=calcTab==='checks';const rows=(checks?data.checks:data.calculations).filter(r=>(!cat||r.category===cat)&&[r.title,r.id,r.category,r.formula||''].some(x=>String(x).toLowerCase().includes(q)));
  $('#calc-count').textContent=rows.length+' '+(checks?'comprobaciones':'resultados');
  const header=checks?'<th>Comprobación / alcance</th><th class="numeric">Demanda</th><th class="numeric">Admisible</th><th class="numeric">Utilización</th><th>Estado</th>':'<th>Cálculo / fórmula</th><th>Tema</th><th class="numeric">Resultado</th>';
  const body=rows.map(r=>checks?`<tr><td><span class="cell-title">${escape(r.title)}</span><span class="cell-subtitle">${escape(r.scope)}</span></td><td class="numeric">${displayNumeric(r.displayValue)}</td><td class="numeric">${displayNumeric(r.displayLimit)}</td><td class="numeric"><div class="utilization"><i><b style="width:${Math.min(100,(r.utilization||0)*100)}%"></b></i>${nf((r.utilization||0)*100,1)} %</div></td><td><span class="check-tag" title="${escape(r.status)}">${String(r.status).includes('CONDICIONADO')?'CUMPLE · COND.':'CUMPLE CÁLCULO'}</span></td></tr>`:`<tr><td><span class="cell-title">${escape(r.title)}</span>${r.formula?`<details class="formula-detail"><summary>Ver fórmula y criterio</summary><code>${escape(r.formula)}</code><div class="formula-variables">${formulaVariables(r.formula)}</div>${r.criterion?'<p>'+escape(r.criterion)+'</p>':''}</details>`:''}</td><td><span class="cell-subtitle">${escape(r.category)}</span></td><td class="numeric">${displayNumeric(r.display||{value:r.value,unit:r.unit})}</td></tr>`).join('');
  $('#calc-content').innerHTML=rows.length?`<div class="table-scroll"><table><thead><tr>${header}</tr></thead><tbody>${body}</tbody></table></div>`:'<div class="empty">No hay resultados para esta búsqueda.</div>';
}
function setCalcTab(tab){calcTab=tab;$$('[data-calc-tab]').forEach(b=>{b.classList.toggle('active',b.dataset.calcTab===tab);b.setAttribute('aria-selected',b.dataset.calcTab===tab);});calcOptions();renderCalc();}
function renderParts(){
  const q=$('#parts-search').value.toLowerCase(),cat=$('#parts-category').value,grouped=$('#group-parts').checked;
  const rows=(grouped?data.families:data.parts).filter(p=>(!cat||p.category===cat)&&[p.title,p.code,p.material||'',...(p.codes||[])].some(x=>x.toLowerCase().includes(q)));
  $('#parts-count').textContent=rows.length+' '+(grouped?'familias':'códigos');$('#parts-empty').hidden=rows.length>0;
  $('#parts-body').innerHTML=rows.map(p=>`<tr><td class="code">${escape(p.code)}</td><td><span class="cell-title">${escape(p.title)}</span><span class="cell-subtitle">${escape(p.material||[...new Set(data.parts.filter(k=>p.codes.includes(k.code)).map(k=>k.material))].join(' / '))}</span></td><td><span class="cell-subtitle">${escape(p.category)}</span></td><td class="numeric">${p.quantity}</td><td class="numeric">${nf(p.massKg,2)}</td><td><button class="part-locate" data-locate="${escape(p.code)}" data-grouped="${grouped}">Ver en 3D ↗</button></td></tr>`).join('');
  $$('#parts-body [data-locate]').forEach(b=>b.addEventListener('click',()=>{const row=(b.dataset.grouped==='true'?data.families:data.parts).find(p=>p.code===b.dataset.locate);location.hash='simulacion';requestAnimationFrame(()=>{if(!machine){toast('El visor está terminando de cargar');return;}reset();if(row.category==='Accionamiento'||row.category==='Transmisión'){state.transmission=true;$('#transmission').checked=true;updatePose();}selectParts(row.codes||[row.code]);view('iso');});}));
}
function downloadParts(){const header=['Codigo','Pieza','Conjunto','Material','Cantidad','Masa unitaria kg','Masa total kg'];const lines=[header,...data.parts.map(p=>[p.code,p.title,p.category,p.material,p.quantity,p.unitMassKg,p.massKg])].map(r=>r.map(x=>'"'+String(x).replaceAll('"','""')+'"').join(';')).join('\r\n');const blob=new Blob(['\ufeff'+lines],{type:'text/csv;charset=utf-8;'}),a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download='SESUVECA_Tolva_P04_piezas.csv';a.click();setTimeout(()=>URL.revokeObjectURL(a.href),1000);}

function wireEvents(){
  $$('[data-view]').forEach(b=>b.addEventListener('click',()=>view(b.dataset.view)));$('#extra-view').addEventListener('change',e=>e.target.value&&view(e.target.value));$$('[data-angle]').forEach(b=>b.addEventListener('click',()=>setAngle(b.dataset.angle)));
  $('#angle').addEventListener('input',e=>setAngle(e.target.value));$('#play').addEventListener('click',play);$('#pause').addEventListener('click',pause);$('#reset').addEventListener('click',reset);$('#playback').addEventListener('change',e=>state.rate=Number(e.target.value));
  $('#coal').addEventListener('change',e=>{state.coal=e.target.checked;updateCoal();});$('#transmission').addEventListener('change',e=>{state.transmission=e.target.checked;updatePose();if(state.transmission)toast('Guardas ocultas solo en el visor.');});
  $('#explode').addEventListener('input',e=>{pause();state.explosion=Number(e.target.value)/100;$('#explode-value').textContent=e.target.value+' %';updatePose();});
  $('#fit').addEventListener('click',()=>view('iso'));$('#fullscreen').addEventListener('click',async()=>{try{if(document.fullscreenElement)await document.exitFullscreen();else await $('#viewport').requestFullscreen();}catch{toast('Usa el botón de ampliar del navegador para ver el conjunto.');}});
  $('#dimensions').addEventListener('click',()=>{if(!dimensionsGroup)return;state.dimensions=!state.dimensions;dimensionsGroup.visible=state.dimensions;$('#dimensions').classList.toggle('active',state.dimensions);$('#dimensions').setAttribute('aria-pressed',state.dimensions);updateDimensionLabels();if(state.dimensions&&state.angle>.1)toast('Cotas de referencia en posición de carga.');});
  $('#edges').addEventListener('click',()=>machine&&toggleEdges());$('#section').addEventListener('click',()=>machine&&toggleSection());$('#clear-selection').addEventListener('click',clearSelection);
  $$('[data-calc-tab]').forEach(b=>b.addEventListener('click',()=>setCalcTab(b.dataset.calcTab)));$('#calc-search').addEventListener('input',renderCalc);$('#calc-category').addEventListener('change',renderCalc);
  for(const id of ['parts-search','parts-category','group-parts'])$('#'+id).addEventListener(id==='parts-search'?'input':'change',renderParts);
  $('#download-parts').addEventListener('click',downloadParts);$('[data-jump-commercial]').addEventListener('click',()=>setCalcTab('commercial'));
}

async function start(){
  try{const r=await fetch('data/project.json');if(!r.ok)throw new Error('No se pueden cargar los datos');data=await r.json();renderMetrics();calcOptions();renderCalc();$('#parts-category').innerHTML='<option value="">Todos los conjuntos</option>'+[...new Set(data.parts.map(p=>p.category))].sort().map(c=>`<option>${escape(c)}</option>`).join('');renderParts();wireEvents();setTab(location.hash.slice(1));await init3D();}
  catch(error){console.error(error);$('#loading').innerHTML='<strong>No se pudo iniciar el visor 3D.</strong><span>Comprueba que WebGL esté habilitado y recarga la página.</span><button onclick="location.reload()">Reintentar</button>';toast('Los datos del proyecto permanecen disponibles en sus pestañas.');}
}
start();
