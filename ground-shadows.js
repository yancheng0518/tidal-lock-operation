// Keep architecture in the sunlight depth map. A separate, small projection
// updates only moving actors, so turning the camera never redraws the dam for a shadow.
export function createGroundShadows(T, renderer, scene, enemies, bounds) {
  let sun;
  scene.traverse(node=>{if(node.isDirectionalLight && node.castShadow)sun=node});
  if(!sun)return {setQuality(){},update(){}};
  const centre=new T.Vector3((bounds.minX+bounds.maxX)/2,0,(bounds.minZ+bounds.maxZ)/2);
  const direction=sun.getWorldPosition(new T.Vector3()).sub(sun.target.getWorldPosition(new T.Vector3())).normalize();
  const camera=new T.OrthographicCamera(-1,1,1,-1,1,170);
  camera.position.copy(centre).addScaledVector(direction,83);camera.lookAt(centre);camera.updateMatrixWorld();
  const viewBox=new T.Box3();
  for(const x of [bounds.minX-3,bounds.maxX+3]) for(const z of [bounds.minZ-3,bounds.maxZ+3])
    for(const y of [0,3])viewBox.expandByPoint(new T.Vector3(x,y,z).applyMatrix4(camera.matrixWorldInverse));
  Object.assign(camera,{left:viewBox.min.x,right:viewBox.max.x,top:viewBox.max.y,bottom:viewBox.min.y});
  camera.updateProjectionMatrix();camera.layers.set(1);
  const size=768, mask=new T.WebGLRenderTarget(size,size,{depthBuffer:false,stencilBuffer:false});
  const ink=new T.MeshBasicMaterial({color:0xffffff,fog:false,toneMapped:false,depthTest:false,depthWrite:false});
  const projector=new T.Matrix4().multiplyMatrices(camera.projectionMatrix,camera.matrixWorldInverse);
  const material=new T.ShaderMaterial({
    transparent:true,depthWrite:false,uniforms:{mask:{value:mask.texture},projector:{value:projector},texel:{value:1/size}},
    vertexShader:`uniform mat4 projector; varying vec2 uvShadow;
    void main(){vec4 world=modelMatrix*vec4(position,1.);uvShadow=(projector*world).xy*.5+.5;gl_Position=projectionMatrix*viewMatrix*world;}`,
    fragmentShader:`uniform sampler2D mask;uniform float texel;varying vec2 uvShadow;
    void main(){float a=texture2D(mask,uvShadow).a*.4;
    a+=.15*(texture2D(mask,uvShadow+vec2(texel,0.)).a+texture2D(mask,uvShadow-vec2(texel,0.)).a+texture2D(mask,uvShadow+vec2(0.,texel)).a+texture2D(mask,uvShadow-vec2(0.,texel)).a);
    gl_FragColor=vec4(.05,.07,.085,.47*a);}`
  });
  const ground=new T.Mesh(new T.PlaneGeometry(bounds.maxX-bounds.minX+6,bounds.maxZ-bounds.minZ+6),material);
  ground.rotation.x=-Math.PI/2;ground.position.copy(centre);ground.position.y=.028;ground.renderOrder=2;scene.add(ground);
  let culledMeshes=[],age=100;
  const clear=new T.Color();
  function setQuality(quality) {
    if(!culledMeshes.length)for(const enemy of enemies)enemy.group.traverse(m=>{
      if(m.isMesh && !m.material.transparent){culledMeshes.push(m);m.layers.enable(1)}
    });
    ground.visible=quality!=="high";
    for(const mesh of culledMeshes)mesh.castShadow=!ground.visible;
    age=100;renderer.shadowMap.needsUpdate=true;
  }
  function update(dt,quality) {
    if(!ground.visible)return;
    age+=dt;
    if(age<(quality==="performance"?.095:.065))return;
    age=0;
    const previousTarget=renderer.getRenderTarget(),background=scene.background,override=scene.overrideMaterial;
    const alpha=renderer.getClearAlpha(),needsUpdate=renderer.shadowMap.needsUpdate;
    renderer.getClearColor(clear);renderer.shadowMap.needsUpdate=false;
    scene.background=null;scene.overrideMaterial=ink;
    renderer.setRenderTarget(mask);renderer.setClearColor(0,0);renderer.clear();renderer.render(scene,camera);
    scene.overrideMaterial=override;scene.background=background;renderer.setClearColor(clear,alpha);
    renderer.setRenderTarget(previousTarget);renderer.shadowMap.needsUpdate=needsUpdate;
  }
  return {setQuality,update};
}
