// Contact points sampled from the actual boot soles in the standing pose.
// They follow the authored ankle rotation, including toes-up and heel-up poses.
export function bootContacts(T, source) {
  let mesh;
  source.traverse(node => { if (node.isSkinnedMesh) mesh = node; });
  const joints = mesh.geometry.getAttribute('skinIndex'), weights = mesh.geometry.getAttribute('skinWeight');
  const toes = { Left: [], Right: [] }, feet = {}, p = new T.Vector3();
  for (const bone of mesh.skeleton.bones) {
    const match = /^mixamorig(Left|Right)Foot_/.exec(bone.name);
    if (match) feet[match[1]] = bone;
  }
  for (let i = 0; i < joints.count; i++) {
    let largest = 0;
    for (let j = 1; j < 4; j++) if (weights.getComponent(i,j) > weights.getComponent(i,largest)) largest = j;
    const name = mesh.skeleton.bones[joints.getComponent(i,largest)]?.name || '';
    const side = /^mixamorig(Left|Right)(?:Foot|Toe)/.exec(name)?.[1];
    if (side) toes[side].push(mesh.localToWorld(mesh.getVertexPosition(i, p)).clone());
  }
  const contacts = {};
  for (const side of ['Left', 'Right']) {
    const vertices = toes[side], middle = vertices.reduce((sum, v) => sum + v.z, 0) / vertices.length;
    contacts[side] = [vertices.filter(v => v.z < middle), vertices.filter(v => v.z >= middle)].map(end => {
      end.sort((a,b) => a.y-b.y);
      const count = Math.min(5, end.length), sole = new T.Vector3();
      for (let i=0; i<count; i++) sole.add(end[i]);
      return feet[side].worldToLocal(sole.multiplyScalar(1/count));
    });
  }
  return contacts;
}

// A two-bone leg correction preserves the captured stride and anchors the support sole in world space.
export function plantedLeg(T, bones, side, samples) {
  const thigh=bones[side+'UpLeg'], shin=bones[side+'Leg'], foot=bones[side+'Foot'];
  const rest=[thigh,shin,foot].map(b=>b.quaternion.clone());
  const a=new T.Vector3(), b=new T.Vector3(), c=new T.Vector3(), goal=new T.Vector3();
  const heel=new T.Vector3(), toe=new T.Vector3(), anchor=new T.Vector3();
  const line=new T.Vector3(), bend=new T.Vector3(), direction=new T.Vector3(), knee=new T.Vector3();
  const from=new T.Vector3(), to=new T.Vector3(), shift=new T.Vector3();
  const q=new T.Quaternion(), parent=new T.Quaternion(), orientation=new T.Quaternion();
  let locked=false, correction=false;
  function turn(bone,f,t) {
    q.setFromUnitVectors(f.normalize(),t.normalize());
    bone.parent.getWorldQuaternion(parent); q.premultiply(parent.invert()).multiply(parent.invert());
    bone.quaternion.premultiply(q); bone.updateWorldMatrix(false,false);
  }
  return {
    restore() {
      if (!correction) return;
      thigh.quaternion.copy(rest[0]);shin.quaternion.copy(rest[1]);foot.quaternion.copy(rest[2]);
      correction=false;
    },
    update(weight, ground, reset) {
      if (reset) locked=false;
      if (weight<.002) {locked=false;return;}
      thigh.getWorldPosition(a);shin.getWorldPosition(b);foot.getWorldPosition(c);
      foot.getWorldQuaternion(orientation);
      heel.copy(samples[0]).applyMatrix4(foot.matrixWorld);toe.copy(samples[1]).applyMatrix4(foot.matrixWorld);
      const sole=heel.y<toe.y?heel:toe;
      if (!locked) {anchor.copy(c);locked=true;}
      shift.subVectors(anchor,c);shift.y=0;
      shift.clampLength(0,.065);shift.y=T.MathUtils.clamp(ground-sole.y,-.15,.12);
      goal.copy(c).addScaledVector(shift,weight);
      if (goal.distanceToSquared(c)<.000002) return;
      rest[0].copy(thigh.quaternion);rest[1].copy(shin.quaternion);rest[2].copy(foot.quaternion);correction=true;
      const upper=a.distanceTo(b),lower=b.distanceTo(c);
      line.subVectors(c,a).normalize();
      bend.subVectors(b,a).addScaledVector(line,-bend.dot(line)).normalize();
      direction.subVectors(goal,a);
      const distance=T.MathUtils.clamp(direction.length(),Math.abs(upper-lower)+.0001,upper+lower-.0001);
      direction.normalize();
      bend.applyQuaternion(q.setFromUnitVectors(line,direction));
      const along=(distance*distance+upper*upper-lower*lower)/(2*distance);
      knee.copy(a).addScaledVector(direction,along).addScaledVector(bend,Math.sqrt(Math.max(0,upper*upper-along*along)));
      turn(thigh,from.subVectors(b,a),to.subVectors(knee,a));
      shin.getWorldPosition(b);foot.getWorldPosition(c);
      turn(shin,from.subVectors(c,b),to.subVectors(goal,b));
      shin.getWorldQuaternion(parent).invert();
      foot.quaternion.copy(parent).multiply(orientation);
    }
  };
}
