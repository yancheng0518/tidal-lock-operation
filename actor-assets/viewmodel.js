// Shared local PBR model and authored hand pose. The carried LOD reuses the first-person materials.
const sources = new WeakMap();

export function equipment(T) {
  if (!sources.has(T)) {
    const resource = import('./loader.js').then(async ({ GLTFLoader }) => {
      const loader = new GLTFLoader();
      const [rifle, optic] = await Promise.all(['carbine.glb', 'reflex.glb'].map(file =>
        loader.loadAsync(new URL('./actor-assets/'+file, document.baseURI).href)));
      const held = rifle.scene.getObjectByName('FP_m4a1');
      const carried = rifle.scene.getObjectByName('CarriedProp');
      const sight = optic.scene.getObjectByName('HoloOptic');
      // Keep texture relief crisp while the fore-end and glove surfaces recede from the eye.
      for (const root of [held, carried, sight]) root.traverse(part => {
        if (!part.isMesh) return;
        part.frustumCulled = false;
        for (const map of ['map', 'normalMap', 'roughnessMap']) {
          if (part.material[map]) part.material[map].anisotropy = 8;
        }
      });
      // An oxide coat is diffuse in overcast sky; polished edges retain the source's metal map.
      const materials = new Set();
      for (const root of [held, carried, sight]) root.traverse(part => {
        const material = part.material;
        if (!material || materials.has(material) || material.name === 'arms') return;
        materials.add(material);
        const finish = material.name === 'M_M4A1' ? '.040,.046,.043' : '.021,.025,.023';
        material.onBeforeCompile = shader => {
          shader.fragmentShader = shader.fragmentShader
            .replace('#include <map_fragment>', '#include <map_fragment>\n diffuseColor.rgb += vec3(' + finish + ') * (1.0 - smoothstep(.04,.31,max(diffuseColor.r,max(diffuseColor.g,diffuseColor.b))));')
            .replace('#include <metalnessmap_fragment>', '#include <metalnessmap_fragment>\n metalnessFactor *= .66;')
            .replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\n roughnessFactor = .27 + .67 * roughnessFactor;');
        };
        material.customProgramCacheKey = () => 'lockport-coat-' + material.name;
      });
      return { held, carried, sight };
    });
    sources.set(T, resource);
  }
  return sources.get(T);
}

// The hand control and sleeve joints are independent in this rig. Keep the glove on the prop
// and solve the elbow on its authored bend plane while it travels between the two holds.
function supportArm(T, model) {
  const find = name => model.getObjectByName(name);
  const shoulder = find('UpArm_L'), elbow = find('Forearm_L');
  const wrist = find('BoneTwist_01L_end') || find('BoneTwist_01.L_end');
  const hand = find('IK_Hand_Cntrl_L');
  const restHand = hand.position.clone(), restWrist = hand.quaternion.clone();
  const restShoulder = shoulder.quaternion.clone(), restElbow = elbow.quaternion.clone();
  const home = model.worldToLocal(hand.getWorldPosition(new T.Vector3()));
  const a = new T.Vector3(), b = new T.Vector3(), c = new T.Vector3(), goal = new T.Vector3();
  const axis = new T.Vector3(), bend = new T.Vector3(), reach = new T.Vector3(), targetElbow = new T.Vector3();
  const from = new T.Vector3(), to = new T.Vector3(), rotation = new T.Quaternion(), parent = new T.Quaternion();
  const wristRoll = new T.Quaternion(), wristEuler = new T.Euler();
  let active = false;
  function turn(bone, from, to) {
    rotation.setFromUnitVectors(from.normalize(), to.normalize());
    bone.parent.getWorldQuaternion(parent);
    rotation.premultiply(parent.invert()); parent.invert(); rotation.multiply(parent);
    bone.quaternion.premultiply(rotation); bone.updateWorldMatrix(false, true);
  }
  return function pose(offset, travel, reachWeight) {
    if (!active && reachWeight === 0) return;
    shoulder.quaternion.copy(restShoulder); elbow.quaternion.copy(restElbow);
    hand.position.copy(restHand); hand.quaternion.copy(restWrist);
    active = reachWeight > 0;
    if (!active) return;
    model.updateWorldMatrix(true, true);
    shoulder.getWorldPosition(a); elbow.getWorldPosition(b); wrist.getWorldPosition(c);
    const upper = a.distanceTo(b), lower = b.distanceTo(c);
    goal.copy(home).add(offset); model.localToWorld(goal);
    axis.subVectors(c, a).normalize();
    bend.subVectors(b, a).addScaledVector(axis, -bend.dot(axis)).normalize();
    reach.subVectors(goal, a);
    const distance = T.MathUtils.clamp(reach.length(), Math.abs(upper - lower) + .0001, upper + lower - .0001);
    reach.normalize();
    rotation.setFromUnitVectors(axis, reach); bend.applyQuaternion(rotation);
    const projection = (distance * distance + upper * upper - lower * lower) / (2 * distance);
    targetElbow.copy(a).addScaledVector(reach, projection).addScaledVector(bend, Math.sqrt(Math.max(0, upper * upper - projection * projection)));
    turn(shoulder, from.subVectors(b, a), to.subVectors(targetElbow, a));
    elbow.getWorldPosition(b); wrist.getWorldPosition(c);
    turn(elbow, from.subVectors(c, b), to.subVectors(goal, b));
    hand.position.copy(hand.parent.worldToLocal(goal));
    wristRoll.setFromEuler(wristEuler.set(-.14 * reachWeight, -.22 * reachWeight, .36 * reachWeight + .16 * travel));
    hand.quaternion.multiply(wristRoll);
  };
}

export function mountWeapon(T, group, asset, muzzle, lens, sightAxis) {
  const model = asset.held, optic = asset.sight;
  const size = .73, opticScale = 1.07;
  const railHeight = .1786, sightHeight = railHeight + .092 * opticScale;
  model.scale.setScalar(size);
  model.position.set(0, sightAxis - size * sightHeight, -.05 - .06 * size);
  group.add(model); model.add(optic);
  optic.scale.setScalar(opticScale); optic.position.set(0, sightHeight, .06);
  group.updateWorldMatrix(true, true);
  const inGroup = name => group.worldToLocal(model.getObjectByName(name).getWorldPosition(new T.Vector3()));
  muzzle.position.copy(inGroup('MuzzleSocket'));
  const aperture = inGroup('HoloFrontApertureAnchor');
  lens.position.copy(aperture);
  lens.scale.set(1.13, .72, 1);
  const back = inGroup('HoloRearApertureAnchor').z;
  const magazine = model.getObjectByName('Magazine'), magHome = magazine.position.clone();
  const left = supportArm(T, model), offset = new T.Vector3();
  const hand = model.getObjectByName('IK_Hand_Cntrl_L');
  const handHome = model.worldToLocal(hand.getWorldPosition(new T.Vector3()));
  const mag = model.worldToLocal(model.getObjectByName('MagazineGripSocket').getWorldPosition(new T.Vector3()));
  mag.x -= .047; mag.z += .043;
  const transition = mag.sub(handHome);
  return {
    back,
    reload(hold, pull, seat) {
      const dx = -.059 * pull, dy = -.267 * pull + .008 * seat, dz = .066 * pull;
      magazine.position.copy(magHome); magazine.position.x += dx; magazine.position.y += dy; magazine.position.z += dz;
      magazine.rotation.set(-.15 * pull, -.12 * pull, -.14 * pull);
      offset.copy(transition).multiplyScalar(hold); offset.x += dx - Math.sin(Math.PI * hold) * .065;
      offset.y += dy - Math.sin(Math.PI * hold) * .044; offset.z += dz;
      left(offset, pull, hold);
    }
  };
}

