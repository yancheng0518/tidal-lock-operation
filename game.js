import * as THREE from './vendor/three.module.js';
import { buildWorld } from './world.js';
import { createWeapon, createEnemy } from './actors.js';
import { createAudio } from './audio.js';
import { createGroundShadows } from './ground-shadows.js';
import { createCinema } from './cinema.js';
import { PlayerMotor } from './motor.js';

const canvas = document.getElementById('game');
const audio = createAudio();
const magazine = 30;
const reloadDuration = 1.72;
const eye = 1.7;
const keys = new Set();
const v0 = new THREE.Vector3();
const v1 = new THREE.Vector3();
const v2 = new THREE.Vector3();
const v3 = new THREE.Vector3();
const viewportSize = new THREE.Vector2();
const raycaster = new THREE.Raycaster();
const player = new THREE.Vector3(0, eye, 22);
let phase = 'menu', renderer, scene, camera, gunScene, gunCamera, weapon, world;
let enemies = [], boxes = [];
let health, ammo, reserve, kills, elapsed, shots, hits, lastHurt;
let yaw, pitch, recoil, flash, ads, sprint, reloadLeft, fireDelay, walk, foot;
let aiming = false, trigger = false, touchX = 0, touchZ = 0, touchLook = null;
let mouseButtons = 0;
let mouseX = null, mouseY = null, edgeX = 0, edgeY = 0;
let lockPending = false, lockRetryUsed = false;
let motor, strafe = 0, shotBuffer = 0;
let touchLean = 0, leanPose = 0, lean = 0;
let crouchHeld = false, crouchBlend = 0;
let sensitivity = 1, raf = 0, previous = 0, nextState = 0, hadLock = false;
let aimSensitivity = .65, fieldOfView = 72;
let errorMessage = '', roundSerial = 0, runtime = 0;
let warmed = false;
const tracers = [], sparks = [];
let tracerIndex = 0, sparkIndex = 0, sparkObject;
let shadowAge = 0;
let groundShadows;
let cinema;
let desiredDpr = 1, slowTime = 0, fastTime = 0;
let graphics = 'balanced', averageFrame = 1 / 60;

function qualityRatio() {
  const mobile = matchMedia('(pointer: coarse)').matches;
  const cap = graphics === 'high' ? 1.65 : mobile ? 1.05 : 1.3;
  const native = Math.min(devicePixelRatio || 1, cap);
  return graphics === 'performance' ? native * .76 : native;
}

function setGraphics(value) {
  if (graphics === value || !['balanced','high','performance'].includes(value)) return;
  graphics = value;
  if (!renderer) return;
  desiredDpr = qualityRatio();
  renderer.setPixelRatio(desiredDpr);
  groundShadows?.setQuality(graphics);
  world?.setQuality?.(graphics);
  slowTime = fastTime = 0;
  averageFrame = 1 / 60;
  if (phase === 'paused' && warmed) render();
}

function emit(name, detail) {
  window.dispatchEvent(new CustomEvent(name, { detail }));
}

function heading() { return THREE.MathUtils.euclideanModulo(-THREE.MathUtils.radToDeg(yaw || 0),360); }

function announce() {
  emit('game-state', {
    phase, health: Math.ceil(health ?? 100), ammo: ammo ?? magazine,
    reserve: reserve ?? 150, kills: kills ?? 0, total: enemies.length || 6,
    elapsed: elapsed || 0, reloading: reloadLeft > 0,
    reloadProgress: reloadLeft > 0 ? 1 - reloadLeft / reloadDuration : 0,
    ads: ads || 0, crouched: crouchBlend > .5, heading: heading(),
    x: player.x, y: motor?.y || 0, z: player.z, bounds: world?.bounds,
    lean, jumping: (motor?.vy || 0) > 0, airborne: motor ? !motor.grounded : false,
    enemies: enemies.filter(e => e.hp > 0).map(e => ({x:e.group.position.x,z:e.group.position.z})),
    shots: shots || 0, hits: hits || 0, error: errorMessage
  });
}

function fx(type) { emit('game-fx', {type}); }

function resize() {
  if (!renderer) return;
  // The layout box is in game coordinates, even when its parent is rotated.
  const w = canvas.clientWidth, h = canvas.clientHeight;
  renderer.getSize(viewportSize);
  if (!w || !h || (viewportSize.x === w && viewportSize.y === h && camera.aspect === w / h)) return;
  renderer.setSize(w, h, false);
  for (const cam of [camera, gunCamera]) {
    cam.aspect = w / h;
    cam.updateProjectionMatrix();
  }
  if (warmed && ['paused','won','lost'].includes(phase)) render();
}

function init() {
  if (world) return;
  renderer = new THREE.WebGLRenderer({canvas, antialias:true, alpha:false, powerPreference:'high-performance'});
  desiredDpr = qualityRatio();
  renderer.setPixelRatio(desiredDpr);
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.shadowMap.autoUpdate = false;
  renderer.shadowMap.needsUpdate = true;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.02;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.autoClear = false;
  cinema = createCinema(renderer);
  scene = new THREE.Scene();
  camera = new THREE.PerspectiveCamera(fieldOfView,1,0.07,390);
  camera.rotation.order = 'YXZ';
  gunScene = new THREE.Scene();
  gunCamera = new THREE.PerspectiveCamera(65,1,0.015,10);
  world = buildWorld(THREE,scene);
  world.setQuality?.(graphics);
  boxes = world.colliders.map(b => new THREE.Box3(
    new THREE.Vector3(b.minX,b.minY ?? -0.5,b.minZ),
    new THREE.Vector3(b.maxX,b.height ?? 4,b.maxZ)
  ));
  motor = new PlayerMotor(boxes,world.bounds);
  weapon = createWeapon(THREE,gunScene,scene);
  enemies = world.spawns.map((spawn,i) => ({
    ...createEnemy(THREE,scene,i), spawn, index:i, hp:100
  }));
  initEffects();
  resize();
}

function initEffects() {
  for (let i=0;i<18;i++) {
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(6),3));
    const material = new THREE.LineBasicMaterial({color:0xffba69, transparent:true, depthWrite:false, toneMapped:false});
    const line = new THREE.Line(geometry,material);
    line.visible=false;
    line.frustumCulled=false;
    scene.add(line);
    tracers.push({line,life:0});
  }
  const positions = new Float32Array(3 * 72);
  positions.fill(-999);
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position',new THREE.BufferAttribute(positions,3));
  const material = new THREE.PointsMaterial({color:0xffce78,size:0.045,depthWrite:false,toneMapped:false});
  sparkObject = new THREE.Points(geometry,material);
  sparkObject.frustumCulled=false;
  scene.add(sparkObject);
  for(let i=0;i<72;i++) sparks.push({v:new THREE.Vector3(),life:0});
}

function trace(a,b,hostile) {
  const t=tracers[tracerIndex++ % tracers.length];
  const buf=t.line.geometry.attributes.position;
  buf.setXYZ(0,a.x,a.y,a.z);
  buf.setXYZ(1,b.x,b.y,b.z);
  buf.needsUpdate=true;
  t.line.material.color.setHex(hostile ? 0xff7443 : 0xffdd8f);
  t.life=hostile ? 0.14 : 0.075;
  t.line.visible=true;
}

function impact(point) {
  const buf=sparkObject.geometry.attributes.position;
  for(let i=0;i<8;i++) {
    const idx=sparkIndex++ % sparks.length;
    const p=sparks[idx];
    p.life=0.12+Math.random()*0.2;
    p.v.set((Math.random()-.5)*3,Math.random()*2.9,(Math.random()-.5)*3);
    buf.setXYZ(idx,point.x,point.y,point.z);
  }
  buf.needsUpdate=true;
}

function updateEffects(dt) {
  for (const t of tracers) {
    if (t.life<=0) continue;
    t.life-=dt;
    t.line.material.opacity=Math.min(0.92,Math.max(0,t.life*13));
    t.line.visible=t.life>0;
  }
  const buf=sparkObject.geometry.attributes.position;
  for(let i=0;i<sparks.length;i++) {
    const p=sparks[i];
    if(p.life<=0) continue;
    p.life-=dt;
    p.v.y-=6*dt;
    if(p.life<=0) buf.setXYZ(i,0,-999,0);
    else buf.setXYZ(i,buf.getX(i)+p.v.x*dt,buf.getY(i)+p.v.y*dt,buf.getZ(i)+p.v.z*dt);
    buf.needsUpdate=true;
  }
}

function blocked(x,z,r) {
  const b=world.bounds;
  if(x < b.minX+r || x > b.maxX-r || z < b.minZ+r || z > b.maxZ-r) return true;
  return boxes.some(box => box.max.y > .25 && box.min.y < eye &&
    x+r>box.min.x && x-r<box.max.x && z+r>box.min.z && z-r<box.max.z);
}

function moveBody(pos,dx,dz,r) {
  if (!blocked(pos.x+dx,pos.z,r)) pos.x+=dx;
  if (!blocked(pos.x,pos.z+dz,r)) pos.z+=dz;
}

const wallPoint = new THREE.Vector3();
function wallDistance(ray,maxDistance) {
  let nearest=maxDistance;
  for (const box of boxes) {
    if(ray.intersectBox(box,wallPoint)) nearest=Math.min(nearest,ray.origin.distanceTo(wallPoint));
  }
  if (ray.direction.y < -0.00001) nearest=Math.min(nearest,-ray.origin.y / ray.direction.y);
  return nearest;
}

function beginReload() {
  if (phase!=='playing' || ammo===magazine || !reserve || reloadLeft>0) return;
  reloadLeft=reloadDuration;
  audio.play('reload');
  fx('reload');
  announce();
}

const targetLow=new THREE.Vector3(),targetHigh=new THREE.Vector3(),rayPoint=new THREE.Vector3();
function shoot() {
  if (reloadLeft>0 || fireDelay>0 || phase!=='playing') return;
  if (!ammo) {
    fireDelay=.35;
    fx('empty');
    audio.play('empty');
    if(reserve) beginReload();
    return;
  }
  ammo--; shots++;
  fireDelay=.13+Math.min(0,fireDelay);
  shotBuffer=0;
  flash=1;
  audio.play('shot');
  fx('shot');
  camera.updateMatrixWorld();
  raycaster.setFromCamera({x:0,y:0},camera);
  const ray=raycaster.ray;
  let nearest=wallDistance(ray,100);
  let victim=null,hitHeight=0;
  for (const enemy of enemies) {
    if(enemy.hp<=0) continue;
    const p=enemy.group.position;
    targetLow.set(p.x,.29,p.z); targetHigh.set(p.x,1.62,p.z);
    const d2=ray.distanceSqToSegment(targetLow,targetHigh,rayPoint);
    if(d2>.37*.37) continue;
    const d=ray.origin.distanceTo(rayPoint)-Math.sqrt(Math.max(0,.37*.37-d2));
    if(d>=nearest || d<.05) continue;
    nearest=d; victim=enemy; hitHeight=rayPoint.y;
  }
  const endpoint=ray.at(nearest,v2);
  v3.set(ads>.8 ? 0.015 : 0.21,ads>.8 ? -.08 : -.19,-.48).applyMatrix4(camera.matrixWorld);
  trace(v3,endpoint,false);
  if (nearest<99) impact(endpoint);
  recoil=Math.min(.045,recoil+(ads>.5 ? .009 : .014));
  updateCamera();
  if(victim) {
    hits++;
    victim.hp-=hitHeight>1.53 ? 58 : 36;
    victim.hit=1;
    victim.alerted=true;
    if(victim.hp<=0) {
      kills++;
      fx('kill'); audio.play('kill');
      if(kills===enemies.length) finish('won');
    } else {
      fx('hit'); audio.play('hit');
    }
  }
  if(phase==='playing' && !ammo && !reserve) finish('lost');
  announce();
}

const sightRay=new THREE.Ray(),eyePos=new THREE.Vector3(),targetPos=new THREE.Vector3();
function enemyTick(e,dt) {
  const p=e.group.position;
  let motion=0, mxSpeed=0, mzSpeed=0;
  e.firing=Math.max(0,e.firing-dt*8);
  e.hit=Math.max(0,e.hit-dt*4.5);
  if(e.hp>0) {
    const dx=camera.position.x-p.x, dz=camera.position.z-p.z;
    const distance=Math.hypot(dx,dz);
    eyePos.set(p.x,1.45,p.z);
    targetPos.copy(camera.position).sub(eyePos);
    const range=targetPos.length();
    sightRay.set(eyePos,targetPos.normalize());
    const sight=distance<38 && wallDistance(sightRay,range+.1)>range-.05;
    if(sight) e.alerted=true;
    const pace=e.alerted ? 0.69 : 0.43;
    const wave=Math.sin(elapsed*pace+e.index*1.77);
    const stride=wave*(e.alerted ? 1.85 : 1.15);
    const goalX=e.spawn.x+Math.cos(e.index*.89)*stride;
    const goalZ=e.spawn.z+Math.sin(e.index*.89)*stride;
    const mx=goalX-p.x, mz=goalZ-p.z, len=Math.hypot(mx,mz);
    if(len>.08 && distance>1.3) {
      const step=Math.min(len,(e.alerted ? .92 : .52)*dt);
      const oldX=p.x,oldZ=p.z;
      moveBody(p,mx/len*step,mz/len*step,.31);
      mxSpeed=(p.x-oldX)/Math.max(dt,.001);
      mzSpeed=(p.z-oldZ)/Math.max(dt,.001);
      motion=Math.min(1,Math.hypot(mxSpeed,mzSpeed));
    }
    if(sight || motion>.1) {
      const turn=Math.atan2(sight ? dx : mx,sight ? dz : mz)-e.group.rotation.y;
      const difference=Math.atan2(Math.sin(turn),Math.cos(turn));
      e.group.rotation.y+=THREE.MathUtils.clamp(difference,-dt*5.8,dt*5.8);
    }
    e.cooldown-=dt;
    const facing=Math.cos(Math.atan2(dx,dz)-e.group.rotation.y);
    if(sight && facing>.65 && e.cooldown<=0 && elapsed>2.6 && phase==='playing') {
      e.cooldown=1.95+Math.random()*1.45+distance*.023;
      e.firing=1;
      const accuracy=THREE.MathUtils.clamp(.86-distance*.011-walk*.12,.28,.79);
      const landed=Math.random()<accuracy;
      const offset=landed ? .06 : .85;
      v0.copy(camera.position).addScaledVector(v1.set(Math.cos(yaw),0,-Math.sin(yaw)),(Math.random()>.5 ? 1:-1)*offset);
      v0.y-=landed ? .28 : Math.random()-.45;
      v1.set(p.x,1.34,p.z);
      trace(v1,v0,true);
      const pan=THREE.MathUtils.clamp((-dx*Math.cos(yaw)+dz*Math.sin(yaw))/Math.max(distance,.1),-1,1);
      audio.play('incoming',{pan,distance});
      if(landed) {
        health=Math.max(0,health-(5+Math.round(Math.random()*3)));
        lastHurt=elapsed;
        const azimuth=THREE.MathUtils.euclideanModulo(THREE.MathUtils.radToDeg(Math.atan2(-dx,dz)),360);
        emit('game-fx',{type:'hurt',azimuth}); audio.play('hurt');
        if(health<=0) finish('lost');
      }
    }
  }
  const angle=e.group.rotation.y;
  e.update(dt,{moving:motion,time:elapsed,hit:e.hit,dead:e.hp<=0,alert:e.alerted,firing:e.firing,
    strafe:mxSpeed*Math.cos(angle)-mzSpeed*Math.sin(angle),forward:mxSpeed*Math.sin(angle)+mzSpeed*Math.cos(angle)});
}

const leanRay=new THREE.Ray(), leanBox=new THREE.Box3(), leanHit=new THREE.Vector3();
function updateCamera() {
  camera.position.copy(player);
  camera.position.y+=Math.sin(foot*2)*.022*walk*(1-ads*.8)-.077*motor.landing;
  lean=leanPose;
  if(Math.abs(leanPose)>.0001) {
    const sign=Math.sign(leanPose);
    leanRay.origin.copy(camera.position);
    leanRay.direction.set(sign*Math.cos(yaw),-.15,-sign*Math.sin(yaw)).normalize();
    const reach=.46;
    // Reserve clearance for the corners of the camera's near clipping plane.
    const pad=Math.min(.28,camera.near*(1+Math.hypot(1,camera.aspect)*Math.tan(camera.fov*Math.PI/360)));
    let travel=reach*Math.abs(leanPose);
    for(const box of boxes) {
      leanBox.copy(box).expandByScalar(pad);
      if(!leanRay.intersectBox(leanBox,leanHit)) continue;
      if(leanBox.containsPoint(leanRay.origin)) { travel=0; break; }
      travel=Math.min(travel,Math.max(0,leanRay.origin.distanceTo(leanHit)-.006));
    }
    const b=world.bounds, d=leanRay.direction;
    if(d.x>0) travel=Math.min(travel,(b.maxX-pad-player.x)/d.x);
    if(d.x<0) travel=Math.min(travel,(b.minX+pad-player.x)/d.x);
    if(d.z>0) travel=Math.min(travel,(b.maxZ-pad-player.z)/d.z);
    if(d.z<0) travel=Math.min(travel,(b.minZ+pad-player.z)/d.z);
    travel=Math.max(0,travel);
    lean=sign*travel/reach;
    camera.position.addScaledVector(d,travel);
  }
  camera.rotation.set(pitch+recoil,yaw,-.121*lean+Math.sin(foot)*.0025*walk,'YXZ');
  const focalScale=1+.58*ads;
  const fov=THREE.MathUtils.radToDeg(2*Math.atan(Math.tan(THREE.MathUtils.degToRad(fieldOfView)/2)/focalScale))+sprint*4;
  if(Math.abs(camera.fov-fov)>.025) { camera.fov=fov; camera.updateProjectionMatrix(); }
  camera.updateMatrixWorld();
}

function step(dt) {
  elapsed+=dt;
  runtime+=dt;
  const ax=(keys.has('KeyD') ? 1:0)-(keys.has('KeyA') ? 1:0)+touchX;
  const az=(keys.has('KeyW') ? 1:0)-(keys.has('KeyS') ? 1:0)+touchZ;
  yaw+=((keys.has('ArrowLeft')?1:0)-(keys.has('ArrowRight')?1:0))*dt*1.85;
  pitch=THREE.MathUtils.clamp(pitch+((keys.has('ArrowUp')?1:0)-(keys.has('ArrowDown')?1:0))*dt*1.15,-1.36,1.36);
  if(edgeX || edgeY) look(edgeX*1100*dt,edgeY*760*dt);
  const len=Math.hypot(ax,az);
  const low=crouchHeld || keys.has('KeyC') || keys.has('ControlLeft') || keys.has('ControlRight');
  const leanInput=THREE.MathUtils.clamp((keys.has('KeyE')?1:0)-(keys.has('KeyQ')?1:0)+touchLean,-1,1);
  const wantsAim=aiming || (mouseButtons & 2)!==0;
  const wantsFire=trigger || (mouseButtons & 1)!==0;
  fireDelay=fireDelay>0 && wantsFire ? fireDelay-dt : Math.max(0,fireDelay-dt);
  const running=(keys.has('ShiftLeft') || keys.has('ShiftRight')) && az>0 && !low && !leanInput && !wantsAim && !wantsFire && !reloadLeft;
  const smoothing=1-Math.exp(-dt*13);
  crouchBlend+=((low ? 1:0)-crouchBlend)*smoothing;
  const headroom=motor.headroom(player.x,player.z);
  crouchBlend=Math.max(crouchBlend,THREE.MathUtils.clamp((eye+.19-headroom)/.81,0,1));
  leanPose+=(leanInput-leanPose)*(1-Math.exp(-dt*16));
  if(Math.abs(leanPose)<.001 && !leanInput) leanPose=0;
  const hasStride=motor.grounded ? walk>.12 : Math.hypot(motor.vx,motor.vz)>4.1;
  sprint+=((running && hasStride ? 1:0)-sprint)*smoothing;
  ads+=((wantsAim && !reloadLeft ? 1:0)-ads)*(1-Math.exp(-dt*18));
  const speed=(3.8+2.5*sprint-1.75*ads)*(1-.60*crouchBlend)*(1-.22*Math.abs(leanPose));
  const magnitude=speed/Math.max(len,1);
  const cos=Math.cos(yaw),sin=Math.sin(yaw);
  const px=player.x,pz=player.z;
  const eyeHeight=eye-.81*crouchBlend;
  const impact=motor.advance(player,(ax*cos-az*sin)*magnitude,(-az*cos-ax*sin)*magnitude,len>.01,eyeHeight+.19,dt);
  player.y=motor.y+eyeHeight;
  if(impact>0) {
    audio.play('foot',{sprint:impact>.7,crouch:crouchBlend>.5});
    emit('game-fx',{type:'land',strength:impact});
  }
  const invDt=dt>0 ? 1/dt : 0;
  const movedX=(player.x-px)*invDt,movedZ=(player.z-pz)*invDt;
  const movedSpeed=Math.hypot(movedX,movedZ);
  const groundMotion=motor.grounded ? Math.min(1,movedSpeed/speed) : 0;
  walk+=(groundMotion-walk)*smoothing;
  strafe=THREE.MathUtils.clamp((movedX*cos-movedZ*sin)/speed,-1,1);
  const previousFoot=Math.floor(foot/Math.PI);
  if(motor.grounded) foot+=dt*Math.min(1,movedSpeed/.6)*(3+movedSpeed);
  if(!impact && Math.floor(foot/Math.PI)!==previousFoot) audio.play('foot',{sprint:running,crouch:crouchBlend>.5});
  if(reloadLeft>0) {
    reloadLeft=Math.max(0,reloadLeft-dt);
    if(!reloadLeft) {
      const load=Math.min(magazine-ammo,reserve);
      ammo+=load; reserve-=load; audio.play('rack');
    }
  }
  recoil*=Math.exp(-dt*12);
  flash=Math.max(0,flash-dt*9);
  updateCamera();
  if(wantsFire || shotBuffer>0) shoot();
  shotBuffer=Math.max(0,shotBuffer-dt);
  for(const e of enemies) enemyTick(e,dt);
  if(health>0 && elapsed-lastHurt>8.5 && health<100) health=Math.min(100,health+dt*3.5);
  const airborne=!motor.grounded,jumping=motor.vy>0;
  weapon.update(dt,{
    ads,reload:reloadLeft>0?1-reloadLeft/reloadDuration:0,fire:flash,shots,walk,time:elapsed,
    sprint,strafe,crouch:crouchBlend,stepPhase:foot,viewRotation:camera.quaternion,
    lean,airborne,verticalVelocity:motor.vy,landing:motor.landing,sunVisibility:updateSunVisibility(dt)
  });
  world.update?.(dt,runtime);
  updateEffects(dt);
  emit('game-view',{heading:heading(),ads,walk,sprint,flash,lean,jumping,airborne,
    x:camera.position.x,y:camera.position.y,z:camera.position.z});
}

const lightRay = new THREE.Ray();
let lightSampleAge=1, sunVisibility=1, targetSunVisibility=1;
function updateSunVisibility(dt) {
  const direction=scene.userData.sunDirection;
  if (!direction) return 1;
  lightSampleAge+=dt;
  if (lightSampleAge>=.042) {
    lightSampleAge=0;
    lightRay.direction.copy(direction);
    let lit=0;
    // Sample the front and rear of the held model. Interpolate across a shade
    // boundary as it passes over the player rather than switching the key on/off.
    for (let i=0;i<3;i++) {
      lightRay.origin.set(.12+i*.045,-.24,-.18-i*.19).applyMatrix4(camera.matrixWorld);
      if (!boxes.some(box=>lightRay.intersectsBox(box))) lit++;
    }
    targetSunVisibility=lit/3;
  }
  sunVisibility+=(targetSunVisibility-sunVisibility)*(1-Math.exp(-18*dt));
  return sunVisibility;
}

function render() {
  if (cinema && graphics !== 'performance') {
    cinema.render(scene,camera,gunScene,gunCamera);
    return;
  }
  renderer.setRenderTarget(null);
  renderer.clear();
  renderer.render(scene,camera);
  renderer.clearDepth();
  renderer.render(gunScene,gunCamera);
}

function frame(now) {
  raf=0;
  if(phase!=='playing') return;
  const rawDt=previous ? (now-previous)/1000 : 1/60;
  previous=now;
  const dt=Math.min(.085,rawDt);
  step(dt);
  shadowAge+=dt;
  if(graphics==='high' && shadowAge>.10) { renderer.shadowMap.needsUpdate=true;shadowAge=0; }
  groundShadows?.update(dt,graphics);
  render();
  if(graphics!=='high') {
    averageFrame += (dt-averageFrame)*(1-Math.exp(-dt*3));
    slowTime = averageFrame>.02 ? slowTime+dt : 0;
    fastTime = averageFrame<.0175 ? fastTime+dt : 0;
    const current = renderer.getPixelRatio();
    const floor = Math.min(desiredDpr, Math.max(.55, desiredDpr*.6));
    if(slowTime>.8 && current>floor+.01) {
      renderer.setPixelRatio(Math.max(floor,current*.84)); slowTime=fastTime=0;
    } else if(fastTime>7 && current<desiredDpr-.01) {
      renderer.setPixelRatio(Math.min(desiredDpr,current+.09)); fastTime=0;
    }
  }
  nextState-=dt;
  if(nextState<=0 && phase==='playing') { announce(); nextState=.09; }
  if(phase==='playing') raf=requestAnimationFrame(frame);
}

function resetMouse() {
  mouseX=mouseY=null;
  edgeX=edgeY=0;
}

function clearTouchInput() {
  if(touchLook && canvas.hasPointerCapture(touchLook.id)) canvas.releasePointerCapture(touchLook.id);
  touchLook=null;
  if(trigger) shotBuffer=0;
  trigger=aiming=crouchHeld=false;
  touchX=touchZ=touchLean=0;
}

function clearInput() {
  clearTouchInput();
  keys.clear();
  mouseButtons=0;
  strafe=shotBuffer=0;
  if(motor) motor.jumpBuffer=0;
  resetMouse();
}

function lock(retry=false) {
  if(document.pointerLockElement===canvas || lockPending || (retry && lockRetryUsed)) return;
  if(!canvas.requestPointerLock || !matchMedia('(any-pointer: fine)').matches) return;
  const frame=window.frameElement;
  if(frame?.hasAttribute('sandbox') && !frame.sandbox.contains('allow-pointer-lock')) return;
  if(retry) lockRetryUsed=true;
  lockPending=true;
  try {
    canvas.requestPointerLock()?.catch?.(()=>{lockPending=false;});
  } catch {
    lockPending=false;
  }
}

function leavePlay() {
  cancelAnimationFrame(raf);
  clearInput();
  audio.active(false);
  if(document.pointerLockElement===canvas) document.exitPointerLock();
}

function finish(result) {
  phase=result;
  leavePlay();
  announce();
}

function start() {
  if(phase==='loading') return;
  const serial=++roundSerial;
  clearInput();
  lockRetryUsed=false;
  phase='loading'; errorMessage='';
  announce();
  audio.unlock(); lock();
  requestAnimationFrame(() => requestAnimationFrame(async () => {
    if(serial!==roundSerial) return;
    try {
      init();
      motor.reset();
      player.set(0,eye,22);
      leanPose=lean=0;
      yaw=pitch=recoil=flash=ads=sprint=reloadLeft=fireDelay=walk=foot=crouchBlend=0;
      health=100; ammo=magazine; reserve=150; lastHurt=0;
      kills=elapsed=shots=hits=0;
      for(const e of enemies) {
        e.hp=100; e.hit=e.firing=0; e.alerted=false; e.cooldown=3.5+e.index*.48;
        e.group.position.set(e.spawn.x,0,e.spawn.z); e.group.rotation.set(0,0,0);
        e.group.visible=true;
        e.update(0,{moving:0,time:0,hit:0,dead:false});
      }
      for(const t of tracers) { t.life=0; t.line.visible=false; }
      const buf=sparkObject.geometry.attributes.position;
      sparks.forEach((p,i)=>{p.life=0; buf.setXYZ(i,0,-999,0);}); buf.needsUpdate=true;
      renderer.shadowMap.needsUpdate=true;
      resize();
      updateCamera();
      weapon.update(1,{ads:0,reload:0,fire:0,shots:0,walk:0,time:0,sprint:0,strafe:0,
        crouch:0,stepPhase:0,viewRotation:camera.quaternion,sunVisibility:1});
      if(!warmed) {
        await Promise.all([world.ready,weapon.ready,...enemies.map(enemy=>enemy.ready)]);
        if(serial!==roundSerial) return;
        world.captureReflection?.(renderer);
        groundShadows=createGroundShadows(THREE,renderer,scene,enemies,world.bounds);
        groundShadows.setQuality(graphics);
        gunScene.environment=scene.environment;
        gunScene.environmentIntensity=.30;
        if(renderer.compileAsync) {
          await renderer.compileAsync(scene,camera);
          await renderer.compileAsync(gunScene,gunCamera);
        }
        render();
        await new Promise(resolve=>requestAnimationFrame(resolve));
        warmed=true;
      }
      if(serial!==roundSerial) return;
      groundShadows?.update(1,graphics);
      render();
      resume(false);
    } catch(err) {
      console.error(err);
      errorMessage=err.message || String(err);
      finish('error');
    }
  }));
}

function pause() { if(phase==='playing') finish('paused'); }
function resume(requestLock=true) {
  if(phase!=='paused' && phase!=='loading') return;
  phase='playing';
  audio.unlock(); audio.active(true);
  if(requestLock) { lockRetryUsed=false; lock(); }
  previous=0; nextState=0;
  cancelAnimationFrame(raf);
  announce();
  canvas.focus({preventScroll:true});
  raf=requestAnimationFrame(frame);
}
function menu() { roundSerial++; finish('menu'); }

function look(dx,dy) {
  if(phase!=='playing') return;
  const factor=.0022*sensitivity*(1+(aimSensitivity-1)*ads);
  yaw-=dx*factor;
  pitch=THREE.MathUtils.clamp(pitch-dy*factor,-1.36,1.36);
}

function screenDelta(dx,dy) {
  if(document.body.classList.contains('rotated-landscape')) return {x:dy,y:-dx};
  return {x:dx,y:dy};
}

function lookScreen(dx,dy) {
  const delta=screenDelta(dx,dy);
  look(delta.x,delta.y);
}

function fireNow() {
  if(reloadLeft>0) return;
  if(fireDelay>0) { shotBuffer=.085; return; }
  updateCamera();
  shoot();
}

function fire(down=true) {
  if(phase!=='playing') return;
  trigger=!!down;
  if(trigger) fireNow();
}

function edgeTurn(p,extent) {
  return THREE.MathUtils.smoothstep(p,extent-30,extent-3)-THREE.MathUtils.smoothstep(30-p,0,27);
}

canvas.addEventListener('contextmenu',e=>e.preventDefault());
canvas.addEventListener('pointerdown',e=>{
  if(phase!=='playing' || e.pointerType==='mouse') return;
  e.preventDefault();
  if(!touchLook) {
    touchLook={id:e.pointerId,x:e.clientX,y:e.clientY};
    canvas.setPointerCapture?.(e.pointerId);
  }
});
// Pointer events fire "down" only for the first button in a mouse chord.
// Separate mouse buttons so holding the optic and pulling the trigger can overlap.
canvas.addEventListener('mousedown',e=>{
  if(phase!=='playing' || e.sourceCapabilities?.firesTouchEvents) return;
  e.preventDefault();
  if(document.pointerLockElement!==canvas) lock(true);
  if(e.button===0) { mouseButtons|=1; fireNow(); }
  if(e.button===2) mouseButtons|=2;
});
window.addEventListener('mousemove',e=>{
  if(phase!=='playing' || e.sourceCapabilities?.firesTouchEvents) return;
  mouseButtons&=e.buttons;
  if(document.pointerLockElement===canvas) { lookScreen(e.movementX,e.movementY); return; }
  if(e.target!==canvas) { resetMouse(); return; }
  if(mouseX!==null) {
    lookScreen(e.clientX-mouseX,e.clientY-mouseY);
    // A sandboxed iframe cannot recenter the system pointer. A narrow edge
    // band allows full rotations without dragging or picking up the mouse.
    edgeX=edgeTurn(e.offsetX,canvas.clientWidth);
    edgeY=edgeTurn(e.offsetY,canvas.clientHeight);
  }
  mouseX=e.clientX; mouseY=e.clientY;
});
window.addEventListener('mouseup',e=>{ mouseButtons&=e.buttons; });
window.addEventListener('mouseout',e=>{
  if(!e.relatedTarget && document.pointerLockElement!==canvas) { mouseButtons=0; resetMouse(); }
});
canvas.addEventListener('pointermove',e=>{
  if(phase!=='playing' || touchLook?.id!==e.pointerId) return;
  lookScreen(e.clientX-touchLook.x,e.clientY-touchLook.y);
  touchLook.x=e.clientX; touchLook.y=e.clientY;
});
function endTouchLook(e) {
  if(touchLook?.id===e.pointerId) touchLook=null;
}
canvas.addEventListener('pointerup',endTouchLook);
canvas.addEventListener('pointercancel',endTouchLook);
canvas.addEventListener('lostpointercapture',endTouchLook);
canvas.addEventListener('pointerleave',e=>{ if(e.pointerType==='mouse') resetMouse(); });
document.addEventListener('pointerlockchange',()=>{
  lockPending=false;
  const locked=document.pointerLockElement===canvas;
  if(locked && phase!=='playing' && phase!=='loading') document.exitPointerLock();
  if(hadLock && !locked) pause();
  hadLock=locked;
  resetMouse();
});
document.addEventListener('pointerlockerror',()=>{ lockPending=false; });
window.addEventListener('keydown',e=>{
  if(phase!=='playing') return;
  const supported=['KeyW','KeyA','KeyS','KeyD','KeyR','KeyC','KeyQ','KeyE','ControlLeft','ControlRight','ArrowLeft','ArrowRight','ArrowUp','ArrowDown','ShiftLeft','ShiftRight','Escape','KeyP','Space'];
  if(!supported.includes(e.code)) return;
  e.preventDefault();
  keys.add(e.code);
  if(e.repeat) return;
  if(e.code==='KeyR') beginReload();
  if(e.code==='Escape' || e.code==='KeyP') pause();
  if(e.code==='Space') motor.jump();
});
window.addEventListener('keyup',e=>{ keys.delete(e.code); });
window.addEventListener('blur',pause);
document.addEventListener('visibilitychange',()=>{if(document.hidden) pause();});
window.addEventListener('resize',resize);
if ('ResizeObserver' in window) new ResizeObserver(resize).observe(canvas);
window.addEventListener('game-orientationchange',()=>{
  clearTouchInput();
  resize();
});
canvas.addEventListener('webglcontextlost',e=>{
  e.preventDefault();
  errorMessage='图形设备暂时失去连接，请重新载入页面。';
  finish('error');
});

window.Game={
  start, pause, resume, restart:start, menu, reload:beginReload, fire, look, lookScreen, screenDelta, setGraphics,
  lean(sign){ touchLean=phase==='playing' ? Math.sign(Number(sign)||0) : 0; },
  jump(){ if(phase==='playing') motor.jump(); },
  aim(down){ aiming=phase==='playing' && !!down; },
  crouch(down){ crouchHeld=phase==='playing' && !!down; },
  move(x,z){ touchX=THREE.MathUtils.clamp(x||0,-1,1); touchZ=THREE.MathUtils.clamp(z||0,-1,1); },
  setMuted(value){audio.mute(value);},
  setSensitivity(value){sensitivity=THREE.MathUtils.clamp(Number(value)||1,.3,3);},
  setAimSensitivity(value){aimSensitivity=THREE.MathUtils.clamp(Number(value)||.65,.3,1);},
  setFieldOfView(value){fieldOfView=THREE.MathUtils.clamp(Number(value)||72,60,90);}
};
emit('game-ready',{});
announce();
