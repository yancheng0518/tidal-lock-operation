/* Tidal Lock. Dimensions are in metres, +Y is up, and north is -Z.
   Static pieces share instance batches. World-space texel density stays uniform
   across large civil engineering structures and small foreground props. */
import { signRects } from './world-assets/yard-signs.js?v=1.3.0';
import { MAP_PLAN } from './level.js';
export { MAP_PLAN };
export function buildWorld(T, scene, {onAssetLoaded}={}) {
  const root = new T.Group();
  root.name = 'Tidal Lock / civil works';
  scene.add(root);
  const colliders = [], batches = new Map();
  const bounds = MAP_PLAN.bounds;
  const spawns = MAP_PLAN.spawns;
  let seed = 0x654a21;
  const rand = () => ((seed = (Math.imul(seed,1664525)+1013904223)>>>0)/4294967296);
  const vec = (x,y,z) => new T.Vector3(x,y,z);
  const cube = new T.BoxGeometry(), round = new T.CylinderGeometry(.5,.5,1,16);
  const rounded = new T.SphereGeometry(.5,12,8), narrow = new T.CylinderGeometry(.5,.5,1,8);
  const dummy = new T.Object3D(), yAxis = vec(0,1,0);
  const manager = new T.LoadingManager();
  if(onAssetLoaded) manager.onProgress=onAssetLoaded;
  const ready = new Promise(resolve=>{ manager.onLoad=resolve; });
  const loader = new T.TextureLoader(manager);
  const asset = name => new URL('./world-assets/'+name,import.meta.url).href;
  const solarElevation=T.MathUtils.degToRad(26), solarAzimuth=T.MathUtils.degToRad(35);
  const sunlight=vec(Math.sin(solarAzimuth)*Math.cos(solarElevation),Math.sin(solarElevation),-Math.cos(solarAzimuth)*Math.cos(solarElevation));
  const textures = new Map();
  const substituteMaps = new Map();
  function substitute(colour) {
    if (!substituteMaps.has(colour)) {
      const pixel=document.createElement('canvas');
      pixel.width=pixel.height=1;
      const ctx=pixel.getContext('2d');
      ctx.fillStyle=colour;ctx.fillRect(0,0,1,1);
      substituteMaps.set(colour,pixel);
    }
    return substituteMaps.get(colour);
  }
  function loadSurface(name,colour) {
    const tex=loader.load(asset(name),undefined,undefined,()=>{
      tex.image=substitute(colour);tex.needsUpdate=true;
    });
    return tex;
  }
  function texture(name, srgb=false) {
    if (textures.has(name)) return textures.get(name);
    const colour = name.includes('-normal') ? '#8080ff' : srgb ? '#d6d9d6' : '#252525';
    const tex = loadSurface(name,colour);
    tex.wrapS=tex.wrapT=T.RepeatWrapping;
    tex.anisotropy=8;
    if (srgb) tex.colorSpace=T.SRGBColorSpace;
    textures.set(name,tex);
    return tex;
  }
  function surface(color, roughness=.86, metalness=.02, photo, metres=3) {
    const m = new T.MeshStandardMaterial({color,roughness,metalness});
    if (!photo) return m;
    m.map=texture(photo+'-color.jpg',true);
    m.normalMap=texture(photo+'-normal.jpg');
    m.normalScale.setScalar(photo==='asphalt'?.55:.7);
    m.onBeforeCompile = s => {
      s.uniforms.tileMeters={value:metres};
      s.vertexShader='uniform float tileMeters;varying float seamShade;\n'+s.vertexShader;
      s.vertexShader=s.vertexShader.replace('#include <uv_vertex>',`#include <uv_vertex>
#ifdef USE_INSTANCING
      vec3 size=vec3(length(instanceMatrix[0].xyz),length(instanceMatrix[1].xyz),length(instanceMatrix[2].xyz));
      vec3 local=position*size;
      vec3 absN=abs(normal);
      vec2 surfUv = absN.y>0.60 ? local.xz : (absN.x>absN.z ? vec2(-local.z*sign(normal.x),local.y) : vec2(local.x*sign(normal.z),local.y));
      surfUv = surfUv/tileMeters + vec2(dot(instanceMatrix[3].xz,vec2(.075,.127)),dot(instanceMatrix[3].xz,vec2(.19,.081)));
      vMapUv = surfUv;
      vNormalMapUv = surfUv;
      seamShade=(1.-smoothstep(-.5,.08,position.y)) * smoothstep(1.65,2.4,size.y);
#endif`);
    };
    const compile=m.onBeforeCompile;
    m.onBeforeCompile=s=>{
      compile(s);
      if(photo==='paint'){
        s.fragmentShader='varying float seamShade;\n'+s.fragmentShader.replace('#include <color_fragment>',`#include <color_fragment>
          float oxide=texture2D(map,vMapUv*vec2(5.3,.55)).r;
          diffuseColor.rgb*=1.-seamShade*clamp((.89-oxide)*1.1,0.,.47);
        `);
      }
    };
    m.customProgramCacheKey=()=>photo==='paint'?'metric-weather-paint':'metric-stone';
    return m;
  }
  const mat={
    concrete:surface('#c4cbd0',.90,0,'panel',4.9), clean:surface('#d2d4cc',.85,0,'panel',4.1),
    floor:surface('#d3cabc',.91,.01,'floor',4.6), asphalt:surface('#c1bdb3',.87,.015,'asphalt',4.2),
    body:surface('#697370',.68,.28,'paint',2.7), gravel:surface('#79796c'), shadow:surface('#2c3534'),
    edge:surface('#394241',.58,.32), iron:surface('#68716b',.55,.43), bolt:surface('#9b9b88',.46,.54),
    worn:surface('#bd9a6c',.72,.24,'steel',3), black:surface('#283133',.81,.16),
    white:surface('#c8c7ac',.86), blue:surface('#40636a',.71,.24,'paint',2.7), orange:surface('#a66540',.73,.25,'paint',2.8),
    rust:surface('#884c39',.79,.22,'paint',2.8), rail:surface('#be9345',.67,.33), stripe:surface('#b99853',.91),
    window:surface('#435e63',.22,.51), brightGlass:surface('#8b9d91',.24,.35),
    wood:surface('#e6d4b5',.93,.01,'wood',2.15), roof:surface('#838b83',.76,.36,'paint',3.5),
    ladder:surface('#b5a999',.55,.48), red:surface('#a54337',.73,.24)
  };
    // Broken pigment exposes asphalt through the painted bars and lane lines.
  const wearMap=texture('asphalt-color.jpg',true);
  mat.stripe.onBeforeCompile=s=>{
    s.uniforms.pigment={value:wearMap};
    s.vertexShader='varying vec2 stripeXZ;\n'+s.vertexShader.replace('#include <project_vertex>','#include <project_vertex>\nstripeXZ=(instanceMatrix*vec4(position,1.)).xz;');
    s.fragmentShader='uniform sampler2D pigment;varying vec2 stripeXZ;\n'+s.fragmentShader.replace('#include <color_fragment>',`#include <color_fragment>
      float grains=texture2D(pigment,stripeXZ*1.9).r, pores=texture2D(pigment,stripeXZ*.3).r;
      if(grains*.7+pores*.3<.245)discard;
      diffuseColor.rgb*=.4+2.0*grains;`);
  };
  mat.light=new T.MeshStandardMaterial({color:0xffd7a1,emissive:0xffb475,emissiveIntensity:3.4});
  const block=(x,z,w,d,height,minY=0)=>colliders.push({minX:x-w/2,maxX:x+w/2,minZ:z-d/2,maxZ:z+d/2,height,minY});
  function inst(g,m,x,y,z,w,h,d,rx=0,ry=0,rz=0,quat=null){
    let key=g.uuid+m.uuid;
    if(!batches.has(key)) batches.set(key,{g,m,items:[]});
    dummy.position.set(x,y,z);dummy.scale.set(w,h,d);
    if(quat)dummy.quaternion.copy(quat);else dummy.rotation.set(rx,ry,rz);
    dummy.updateMatrix();
    batches.get(key).items.push(dummy.matrix.clone());
  }
  const box=(m,x,y,z,w,h,d,rx=0,ry=0,rz=0)=>inst(cube,m,x,y,z,w,h,d,rx,ry,rz);
  const cyl=(m,x,y,z,diam,h,depth=diam,rx=0,ry=0,rz=0)=>inst(round,m,x,y,z,diam,h,depth,rx,ry,rz);
  function solid(m,x,z,w,h,d){box(m,x,h/2,z,w,h,d);block(x,z,w,d,h);}
  function member(m,a,b,width,depth=width,geo=cube){
    const av=vec(...a),bv=vec(...b),direction=bv.clone().sub(av),length=direction.length();
    const q=new T.Quaternion().setFromUnitVectors(yAxis,direction.normalize());
    av.lerp(bv,.5);inst(geo,m,av.x,av.y,av.z,width,length,depth,0,0,0,q);
  }
  const pipe=(m,a,b,r)=>member(m,a,b,r,r,narrow);
  function cable(a,b,sag=.7,r=.032){
    let prev=a;
    for(let i=1;i<=9;i++){
      const t=i/9,p=[a[0]+(b[0]-a[0])*t,a[1]+(b[1]-a[1])*t-4*t*(1-t)*sag,a[2]+(b[2]-a[2])*t];
      pipe(mat.black,prev,p,r);prev=p;
    }
  }
  function railing(a,b,y,h=1,m=mat.rail){
    const len=Math.hypot(b[0]-a[0],b[1]-a[1]),n=Math.max(1,Math.ceil(len/2.3));
    for(let i=0;i<=n;i++){let t=i/n;box(m,a[0]+(b[0]-a[0])*t,y+h*.5,a[1]+(b[1]-a[1])*t,.065,h,.065);}
    for(const lift of [.47,1]) pipe(m,[a[0],y+h*lift,a[1]],[b[0],y+h*lift,b[1]],.062);
  }
  // The weathered lettering is pre-rendered at the original world texel density.
  // All placements share a cropped atlas and one draw call.
  const labelPositions=[], labelUVs=[], labelNormals=[], labelIndices=[];
  const nextSign=new Map();
  function finishSigns() {
    const tex=texture('yard-signs.webp',true);
    tex.wrapS=tex.wrapT=T.ClampToEdgeWrapping;
    const material=new T.MeshStandardMaterial({map:tex,alphaTest:.24,depthWrite:false,
      roughness:.91,polygonOffset:true,polygonOffsetFactor:-2});
    const geo=new T.BufferGeometry();
    geo.setAttribute('position',new T.Float32BufferAttribute(labelPositions,3));
    geo.setAttribute('uv',new T.Float32BufferAttribute(labelUVs,2));
    geo.setAttribute('normal',new T.Float32BufferAttribute(labelNormals,3));geo.setIndex(labelIndices);
    const mesh=new T.Mesh(geo,material);mesh.receiveShadow=true;root.add(mesh);
  }

  function decal(x,y,z,w,h,text,{angle=0,ground=false,wear=1}={}) {
    const variants=signRects[text], index=nextSign.get(text)||0;
    const [left,top,width,height]=variants[index % variants.length];
    nextSign.set(text,index+1);
    // The port generator shares a seed with the original sign weathering.
    // Advance the stream by its baked samples to preserve later prop placements.
    const samples=5*Math.ceil(1550*wear);
    for(let i=0;i<samples;i++)rand();

    const q=new T.Quaternion().setFromEuler(ground?new T.Euler(-Math.PI/2,0,angle):new T.Euler(0,angle,0));
    const base=labelPositions.length/3,n=vec(0,0,1).applyQuaternion(q);
    for(const [u,v] of [[0,0],[1,0],[1,1],[0,1]]){
      const p=vec((u-.5)*w,(v-.5)*h,0).applyQuaternion(q);
      labelPositions.push(p.x+x,p.y+y,p.z+z);labelNormals.push(n.x,n.y,n.z);
      labelUVs.push((left+u*width)/2048,1-(top+(1-v)*height)/512);
    }
    labelIndices.push(base,base+1,base+2,base,base+2,base+3);
  }
  // A packed apron survey records wheel paths, accumulated grit and shallow wet spots.
  // Baking the mask lets the ground share the photographed sky reflection without
  // rendering a mirrored copy of the scene during camera movement.
  const apron=texture('apron-mask.jpg');
  // The harbour is static at this fixed probe. The six 256px faces store the
  // original linear radiance divided by 16 in sRGB, which also works on LDR GPUs.
  // Reflections arrive independently of the textures needed for the first frame.
  const probeOrigin=vec(0,1.55,10),probeReady={value:0};
  const faceUrls=['px','nx','py','ny','pz','nz'].map(face=>asset('yard-reflection-'+face+'.webp'));
  const yardProbe=new T.CubeTextureLoader().load(faceUrls,()=>{probeReady.value=1;});
  yardProbe.colorSpace=T.SRGBColorSpace;
  yardProbe.minFilter=T.LinearMipmapLinearFilter;yardProbe.generateMipmaps=true;
  const roadWhite=surface('#b3b2a1',.83);
  const yardMaterials=[mat.floor,mat.asphalt,mat.stripe,roadWhite];
  for (const ground of yardMaterials) {
    const painted=ground===mat.stripe||ground===roadWhite;
    const setup=ground.onBeforeCompile;
    ground.onBeforeCompile=shader=>{
      setup(shader);
      shader.uniforms.apron={value:apron};
      shader.uniforms.yardProbe={value:yardProbe};
      shader.uniforms.probeReady=probeReady;
      shader.uniforms.probeOrigin={value:probeOrigin};
      shader.vertexShader='varying vec2 apronUv; varying vec3 yardPoint;\n'+shader.vertexShader.replace('#include <project_vertex>',
        '#include <project_vertex>\nyardPoint=(instanceMatrix*vec4(position,1.)).xyz; apronUv=yardPoint.xz/vec2(50.,64.)+.5;');
      shader.fragmentShader='uniform sampler2D apron; uniform samplerCube yardProbe; uniform float probeReady; uniform vec3 probeOrigin; varying vec2 apronUv; varying vec3 yardPoint;\n'+shader.fragmentShader
        .replace('#include <map_fragment>',`#include <map_fragment>
          vec3 traffic=texture2D(apron,apronUv).rgb;
          float basin=traffic.g${painted?'':'+.10*(texture2D(map,vMapUv*.72).r-.22)'};
          float water=smoothstep(.22,.47,basin);
          diffuseColor.rgb*=mix(vec3(.66),vec3(.99),traffic.r)*(1.-.59*smoothstep(.06,.48,basin));
          diffuseColor.rgb+=vec3(.045,.031,.019)*traffic.b*(1.-water);`)
        .replace('#include <roughnessmap_fragment>',`#include <roughnessmap_fragment>
          roughnessFactor=mix(roughnessFactor,.115+.06*(1.-traffic.g),water);`)
        .replace('#include <normal_fragment_maps>',`#include <normal_fragment_maps>
          normal=normalize(mix(normal,normalize(mat3(viewMatrix)*vec3(0.,1.,0.)),water*.985));`)
        .replace('#include <opaque_fragment>',`
          if(water*probeReady>.01){
            vec3 V=normalize(cameraPosition-yardPoint);
            vec3 N=normalize(inverseTransformDirection(normal,viewMatrix));
            vec3 R=reflect(-V,N);
            // Project the local reflection ray to the sides of the loading yard.
            // At high elevation it reflects the distant sky without parallax.
            vec3 limit=mix(vec3(-19.,-2.,-31.),vec3(20.,15.,28.),step(vec3(0.),R));
            vec3 dist=(limit-yardPoint)/(sign(R)*max(abs(R),vec3(.0001))+vec3(.00001));
            float t=max(.1,min(dist.x,min(dist.y,dist.z)));
            vec3 sampleRay=mix(normalize(yardPoint+R*t-probeOrigin),R,smoothstep(.25,.72,R.y));
            vec3 mirrored=textureLod(yardProbe,sampleRay,1.05+(1.-water)*1.9).rgb*16.;
            float fresnel=.035+.87*pow(1.-clamp(dot(V,N),0.,1.),3.);
            outgoingLight=mix(outgoingLight,mirrored,water*fresnel*.92);
          }
          #include <opaque_fragment>`);
    };
    ground.customProgramCacheKey=()=>'apron-water-film-'+(painted?ground.uuid:'pavement');
  }

  // Ground construction: a patched central roadway, poured apron and expansion joints.
  box(mat.floor,0,-.29,0,49,.54,64);
  box(mat.asphalt,1,-.032,0,11.5,.06,62);
  for(const x of [-4.9,6.95]){
    box(mat.gravel,x,-.002,0,.1,.01,61);
    for(let z=-28;z<29;z+=3.18)box(mat.stripe,x+.13,.006,z,.09,.012,2.96);
  }
  for(let z=-27;z<=29;z+=6){
    for(const [x,w] of [[-14.3,18.9],[15.5,16]]) box(mat.gravel,x,-.012,z,w,.022,.032);
    box(roadWhite,1,.007,z,.1,.012,1.9);
  }
  for(let z=-25;z<26;z+=8){
    box(mat.edge,7.63,.002,z,.42,.018,1.22);
    for(let j=0;j<14;j++)box(mat.iron,7.63,.017,z-.54+j*.083,.37,.017,.033);
  }
  // Transverse comb of faded stop lines at the south entry.
  for(let i=0;i<7;i++)box(mat.stripe,-3.65+i*1.52,.011,18,.6,.012,1.8);
  decal(.7,.02,11.5,3,1,'03',{ground:true});
  function ladder(x,z,base,h,width=.52){
    for(const a of [-1,1])cyl(mat.ladder,x+width*a*.5,base+h*.5,z,.065,h);
    for(let y=base+.2;y<base+h;y+=.35)pipe(mat.ladder,[x-width/2,y,z],[x+width/2,y,z],.052);
  }
  function light(x,y,z){
    box(mat.black,x,y,z,.87,.19,.21,.13);
    box(mat.light,x,y-.04,z+.11,.72,.074,.035,.13);
    for(let i=0;i<4;i++)box(mat.edge,x-.28+i*.18,y-.04,z+.137,.017,.084,.016);
  }
  function windowRow(x,z,base,width,h,count){
    box(mat.black,x,base+h*.5,z,width+.22,h+.22,.16);
    for(let i=0;i<count;i++){
      const centre=x-width*.5+(i+.5)*width/count;
      box(i%5===1?mat.brightGlass:mat.window,centre,base+h*.5,z+.09,width/count-.09,h-.09,.04);
      box(mat.iron,centre,base+h*.52,z+.116,width/count,.046,.055);
    }
    box(mat.iron,x,base-.07,z+.07,width+.3,.12,.36);
  }
  function shutter(x,y,z,w,h){
    box(mat.shadow,x,y+h/2,z,w+.22,h+.12,.18);
    box(mat.body,x,y+h/2,z+.105,w,h,.065);
    for(let i=.13;i<h;i+=.21)box(mat.iron,x,y+i,z+.147,w-.06,.028,.035);
    for(const s of [-1,1])box(mat.edge,x+s*w/2,y+h/2,z+.12,.11,h,.14);
    box(mat.iron,x,y+h+.1,z+.12,w+.4,.28,.36);
  }
  function hvac(x,y,z){
    box(mat.iron,x,y+.52,z,1.7,1.04,.73);
    box(mat.shadow,x-.24,y+.54,z+.375,.91,.78,.035);
    for(let j=0;j<10;j++)box(mat.roof,x-.24,y+.2+j*.072,z+.409,.9,.03,.045);
    for(let j=0;j<4;j++)box(mat.roof,x+.53,y+.3+j*.13,z+.39,.21,.025,.06);
    for(const dx of [-.56,.56])box(mat.edge,x+dx,y-.06,z,.18,.12,.76);
  }
  function sidesRibs(x,z,w,d,h){
    for(let zz=z-d/2+.4;zz<z+d/2;zz+=1.34){
      box(mat.body,x+w/2+.016,h*.52,zz,.065,h*.94,.078);
      box(mat.body,x-w/2-.016,h*.52,zz,.065,h*.94,.078);
    }
  }
  // West turbine shop and a roofed repair bay open to the road.
  solid(mat.concrete,-19,-4,6,7.1,24);
  sidesRibs(-19,-4,6,24,7.1);
  box(mat.roof,-17.05,7.22,-4,10.8,.25,24.7,0,0,-.025);
  box(mat.edge,-11.68,7.04,-4,.18,.33,24.7);
  for(const z of [-15.8,-8,.15,7.9]){
    solid(mat.edge,-11.8,z,.24,7,.28);
    box(mat.rail,-11.8,.75,z,.29,1.45,.33);
    member(mat.edge,[-11.8,5.48,z],[-13.2,7,z],.17,.18);
    box(mat.iron,-14.1,6.76,z,4.55,.23,.2);
    box(mat.black,-14.4,6.58,z,1.2,.13,.37);
    box(mat.light,-14.4,6.5,z,1,.03,.2);
  }
  for(let z=-15;z<8;z+=.53)box(mat.iron,-14,7.35,z,4.85,.05,.083,0,0,-.025);
  windowRow(-19,8.07,4.5,4.9,1.55,5);shutter(-19,.03,8.12,4.1,3.5);
  decal(-18.95,6.55,8.14,5,.53,'TURBINE WORKS');
  // Offset pump house on the eastern side. Offices overlook the quay.
  solid(mat.concrete,17,-11.2,8.3,6.6,14.1);
  box(mat.clean,16.9,7.48,-12,8.8,1.87,11.8);
  box(mat.edge,16.9,8.46,-12,9.16,.16,12.16);
  windowRow(16.85,-6.02,7.05,7.9,1.03,8);
  shutter(16.6,.04,-4.075,4.7,4.05);light(16.6,4.66,-3.91);
  decal(17,5.73,-4.08,6.5,.73,'PUMP STATION');
  ladder(20.05,-3.86,.18,6.77);
  hvac(14.5,8.61,-11.6);hvac(16.55,8.61,-11.6);
  for(let z=-17.9;z<-4.8;z+=2.0){
    box(mat.edge,12.8,4.55,z,.12,1.78,1.68);
    box(mat.window,12.71,4.55,z,.05,1.66,1.54);
    box(mat.iron,12.67,4.55,z,.06,.055,1.59);
  }
  for(const y of [2.2,2.47,2.74]){
    pipe(mat.iron,[12.62,y,-17.65],[12.62,y,-4.75],.126);
    for(const z of [-16.5,-13.5,-10.5,-7.5,-5.05])box(mat.edge,12.62,y,z,.164,.164,.095);
  }
  const gatePlate=surface('#a4b2ad',.58,.25,'paint',3.6);
  const gateRib=surface('#a4a89c',.48,.36);
  // Flood barrier: three sluice leaves, 14 m buttresses and an extended lookout.
  for(const [x,n] of [[-16,'02'],[0,'03'],[16,'04']]){
    box(gateRib,x,5,-31.5,14.05,10,1.3);
    for(let y=.34;y<10;y+=.77){
      box(gatePlate,x,y,-30.76,13.9,.55,.26);
      box(mat.edge,x,y-.23,-30.49,13.97,.16,.43);
    }
    for(let k=-6;k<6.1;k+=2){
      box(gateRib,x+k,5.08,-30.35,.23,9.94,.29);
      for(let y=1;y<9.6;y+=1.56)cyl(mat.bolt,x+k,y,-30.16,.11,.075,.11,Math.PI/2);
    }
    for(const sign of [-1,1]){
      member(gateRib,[x+sign*6.58,.37,-30.01],[x+sign*.48,9.77,-30.01],.38,.39);
      box(mat.edge,x+sign*6.53,5.04,-30.19,.32,9.92,.52);
      cyl(mat.rail,x+sign*6.22,7.38,-29.57,.36,4.15);
      cyl(gateRib,x+sign*6.22,4.34,-29.57,.22,2.25);
    }
    box(mat.concrete,x,11.4,-31.15,16.08,2.7,4.0);
    box(mat.edge,x,12.83,-31.15,16.09,.15,4.24);
    decal(x,11.48,-29.128,5.5,1.63,'GATE  '+n);
    railing([x-8,-29.05],[x+8,-29.05],12.9,.98);
    for(const off of [-5.4,5.4])light(x+off,10.34,-29.03);
  }
  for(const x of [-24,-8,8,24]){
    box(mat.concrete,x,6.81,-31.13,2.05,13.62,5.85);
    box(mat.clean,x,12.96,-30.96,2.28,1.35,6.42);
    box(mat.rail,x,9.74,-28.17,1.78,.15,.11);
  }
  // Gate 03 control room, glass ribbon, red daymark and radio mast.
  box(mat.concrete,-7.95,16.02,-32.5,3.65,5.0,4.2);
  box(mat.clean,-7.95,19.25,-32.35,6.55,2.65,5.66);
  windowRow(-7.95,-29.47,18.52,6.06,1.1,7);
  box(mat.edge,-7.95,20.77,-32.35,7.12,.29,6.2);
  cyl(mat.iron,-8.7,22.35,-31.6,.12,3.1);cyl(mat.red,-8.7,24.03,-31.6,.2,.25);
  for(const x of [-10.3,-5.9])cable([-8.7,23.66,-31.6],[x,20.94,-33.7],.04,.018);
  box(mat.orange,8,7.05,-28.14,2.02,5.2,.08);
  decal(8,7.3,-28.084,1.65,2.47,'3');
  // Central service gantry creates a strong horizontal middle distance.
  for(const x of [-10.1,10.4]){
    solid(mat.concrete,x,-18.6,1.18,1.18,1.4);
    box(mat.edge,x,4.07,-18.6,.58,5.94,.65);
    box(mat.rail,x,1.6,-18.6,.606,.84,.676);
    member(mat.edge,[x,5.05,-18.6],[x+(x<0?1.7:-1.7),6.8,-18.6],.28,.25);
  }
  box(mat.edge,.15,6.95,-18.6,21.75,.34,1.7);
  for(const z of [-19.36,-17.84]){
    box(mat.iron,.15,7.32,z,21.72,.16,.15);
    box(mat.iron,.15,8.18,z,21.72,.13,.15);
    for(let i=0;i<12;i++){
      const x=-10.58+i*1.78;
      member(mat.iron,[x,7.33,z],[x+.88,8.14,z],.08,.085);
      member(mat.iron,[x+.88,8.14,z],[x+1.78,7.33,z],.08,.085);
    }
  }
  pipe(mat.rust,[-11.1,7.52,-18.47],[11.14,7.52,-18.47],.62);
  pipe(mat.iron,[-11.1,8.07,-18.98],[11.14,8.07,-18.98],.26);
  box(mat.blue,0,7.06,-17.71,6.8,1.22,.14);
  decal(0,7.06,-17.626,6.48,1.0,'03   |   潮 闸');
  // Container ribbing, corner castings, door bars, hinges and cargo codes.
  function container(x,z,w,d,h,m,code,base=0){
    box(m,x,base+h/2,z,w,h,d);
    block(x,z,w+.13,d+.13,base+h,base);
    for(const s of [-1,1]){
      const sx=x+s*(w/2+.016);
      for(let i=-d/2+.18;i<d/2-.16;i+=.33)box(m,sx,base+h/2,z+i,.07,h-.18,.106);
      for(const sy of [.08,h-.08])box(mat.edge,sx,base+sy,z,.105,.12,d+.05);
      for(const zz of [-d/2+.065,d/2-.065])box(mat.edge,sx,base+h/2,z+zz,.1,h,.12);
    }
    for(let k=-w/2+.16;k<w/2;k+=.31)box(m,x+k,base+h+.014,z,.09,.05,d-.13);
    for(const s of [-1,1]){
      const front=z+s*(d/2+.018);
      box(mat.edge,x,base+h/2,front,.06,h,.095);
      for(const xx of [-.39,-.105,.105,.39]){
        const barx=x+w*xx;
        cyl(mat.bolt,barx,base+h/2,front+s*.049,.047,h-.27);
        for(const yy of [.18,h*.47,h-.18])box(mat.edge,barx,base+yy,front+s*.067,.13,.09,.092);
      }
      for(const xx of [-1,1])for(const yy of [.14,h-.15]){
        box(mat.edge,x+xx*(w/2-.105),base+yy,front,.23,.27,.13);
        box(mat.black,x+xx*(w/2-.105),base+yy,front+s*.076,.105,.1,.015);
      }
    }
    decal(x+w*.22,base+h*.71,z+d/2+.105,w*.37,.3,code);
    for(const side of [-1,1]){
      const sx=x+side*(w/2+.068),angle=side*Math.PI/2;
      decal(sx,base+h*.73,z-d*.17,d*.31,h*.132,'TIDAL  FREIGHT',{angle,wear:3});
      decal(sx,base+h*.64,z-d*.17,d*.275,h*.047,'INTERMODAL   LOGISTICS',{angle,wear:2});
      decal(sx,base+h*.81,z+d*.31,d*.139,h*.071,code.replace('TL ','TLU '),{angle});
      for(const y of [.34,.41,.48])box(mat.worn,sx,base+y,z+d*.4,.016,.029,.31);
    }
  }
  container(-7.85,14.2,3.45,8.3,3.07,mat.rust,'TL 9401');
  container(-11.52,14.02,3.45,8.3,3.07,mat.blue,'TL 7244');
  container(-11.56,13.92,3.45,8.3,3.07,mat.body,'TL 8912',3.08);
  container(12.1,12.05,3.5,7.22,2.94,mat.blue,'TL 1086');
  container(16,14.3,3.5,7.22,2.94,mat.orange,'TL 3285');
  container(-15.1,-22.75,3.5,8,2.98,mat.orange,'TL 8802');
  container(17.9,-23.35,3.5,7,2.95,mat.blue,'TL 3317');
  // Sloped Jersey blocks, reflector plates and lifting eyes.
  const spalled=surface('#bfbfb2',.92,0,'spalled',2.95);
  const liftingEye=new T.TorusGeometry(.073,.014,5,12,Math.PI);
  function barrier(x,z,angle=0){
    const shape=new T.Shape();shape.moveTo(-.45,0);shape.lineTo(.45,0);shape.lineTo(.45,.24);shape.lineTo(.21,.73);shape.lineTo(.17,1.08);shape.lineTo(-.17,1.08);shape.lineTo(-.21,.73);shape.lineTo(-.45,.24);shape.closePath();
    if(!barrier.geom){barrier.geom=new T.ExtrudeGeometry(shape,{depth:3.24,bevelEnabled:true,bevelThickness:.026,bevelSize:.023,bevelSegments:1});barrier.geom.translate(0,0,-1.64);barrier.geom.rotateY(Math.PI/2);}
    inst(barrier.geom,spalled,x,0,z,1,1,1,0,angle);
    const ca=Math.cos(angle),sa=Math.sin(angle);
    for(const along of [-1.09,1.09]){
      inst(liftingEye,mat.iron,x+along*ca,1.092,z-along*sa,1,1,1,0,angle);
      for(const side of [-1,1]){
        const ox=along*ca+side*.178*sa,oz=-along*sa+side*.178*ca;
        box(mat.rail,x+ox,.963,z+oz,.68,.145,.01,0,angle);
        for(const dx of [-.24,.07])box(mat.edge,x+ox+dx*ca,.966,z+oz-dx*sa+side*.013,.082,.153,.016,0,angle,-.43);
      }
    }
    if(Math.abs(angle)<.1){
      block(x,z,3.3,.9,1.08);
      for(const side of [-1,1]){box(mat.rail,x+side,.89,z+.192,.42,.25,.027);box(mat.orange,x+side*.98,1.093,z,.12,.02,.25);}
    }else{block(x,z,.9,3.3,1.08);}
  }
  for(const [x,z,a] of [[-3.7,4,0],[4.75,-4.2,0],[-6.2,-7.4,1.57],[8.1,6,1.57],[12.1,-21.2,0],[-4,-21.8,0],[-16.6,21.7,0]])barrier(x,z,a);
  function crate(x,z,w,h,d,base=0){
    box(mat.wood,x,base+h/2+.035,z,w,h-.07,d);
    for(const xx of [-.35,0,.35])box(mat.wood,x+w*xx,base+.07,z,w*.16,.14,d+.03);
    for(const sz of [-1,1]){
      for(const row of [-.25,.25])box(mat.worn,x,base+h*(.52+row),z+sz*(d/2+.003),w-.14,.016,.015);
      for(const xx of [-1,1])for(const yy of [.2,h-.22]){
        box(mat.iron,x+xx*(w/2-.06),base+yy,z+sz*(d/2+.052),.092,.17,.022);
        cyl(mat.bolt,x+xx*(w/2-.06),base+yy,z+sz*(d/2+.071),.037,.018,.037,Math.PI/2);
      }
    }
    decal(x+w*.19,base+h*.57,z+d/2+.061,.43,.18,'TL  07',{wear:1.8});
    decal(x-w*.23,base+h*.66,z+d/2+.061,.22,.25,'↑↑',{wear:1.5});
    block(x,z,w+.1,d+.1,base+h,base);
    for(const xx of [-1,1]){
      for(const zz of [-1,1])box(mat.worn,x+xx*(w/2-.07),base+h/2,z+zz*d/2,.13,h,.09);
      for(const yy of [.09,h-.09])box(mat.wood,x+xx*w/2,base+yy,z,.09,.14,d+.1);
    }
    for(const zz of [-1,1]){
      for(const yy of [.09,h-.09])box(mat.wood,x,base+yy,z+zz*(d/2+.045),w,.14,.08);
      member(mat.wood,[x-w*.43,base+.17,z+zz*(d/2+.063)],[x+w*.43,base+h-.17,z+zz*(d/2+.063)],.14,.086);
    }
    for(const xx of [-.33,.33])box(mat.edge,x+w*xx,base+h+.014,z,.058,.032,d);
  }
  crate(-5.12,12.73,1.5,1.25,1.5);crate(-4.99,14.28,1.5,1.2,1.47);crate(-5.1,12.73,1.34,1.02,1.32,1.25);
  // Fitted maintenance forklift replaces the freight stack on the same apron.
  crate(-11.1,-10.15,1.66,1.28,1.66);crate(3.87,-14.48,1.71,1.35,1.74);
  // Industrial drums, spill pallet, cable reels and hose rings.
  function drum(x,z,m){
    cyl(m,x,.52,z,.65,1.02);
    for(const y of [.06,.27,.77,1])cyl(mat.edge,x,y,z,.68,.046);
    cyl(mat.bolt,x+.145,1.04,z,.09,.04);block(x,z,.65,.65,1.04);
  }
  [[-9.1,8.9,mat.rust],[-9.84,8.72,mat.blue],[12.3,5.4,mat.orange],[13.02,5.3,mat.worn],[10.9,-13.7,mat.rust],[-14.4,-1.3,mat.worn]].forEach(v=>drum(...v));
  function reel(x,z,r){
    for(const dx of [-.39,.39])cyl(mat.wood,x+dx,r,z,r*2,.13,r*2,0,0,Math.PI/2);
    for(let i=0;i<10;i++)cyl(mat.black,x-.32+i*.069,r,z,r*1.66,.055,r*1.66,0,0,Math.PI/2);
    cyl(mat.iron,x,r,z,.21,.98,.21,0,0,Math.PI/2);
    block(x,z,.91,r*2,r*2);
  }
  reel(-14.25,4.77,.93);reel(19.35,2.2,.8);
  // Four-legged ship unloader. Lattice members are structural, with a travelling
  // hook, two trolleys, operators' glazing and two cable runs across the boom.
  function crane(cx,cz,s=1){
    const p=(x,y,z)=>[cx+x*s,y*s,cz+z*s];
    const b=(m,x,y,z,w,h,d)=>box(m,...p(x,y,z),w*s,h*s,d*s);
    const strut=(a,bb,w,m=mat.orange)=>member(m,p(...a),p(...bb),w*s,w*s);
    for(const z of [-3.2,3.2]){
      b(mat.edge,0,.1,z,10,.2,.29);
      for(const x of [-4.1,4.1]){
        b(mat.black,x,.45,z,1.48,.62,.75);
        strut([x,.7,z],[x*.57,11.65,z*.63],.64);
        b(mat.rail,x,1.02,z,1.38,.24,.74);
      }
      strut([-3.8,1.65,z],[2.38,10.5,z*.65],.2);
      strut([3.8,1.65,z],[-2.38,10.5,z*.65],.2);
    }
    for(const x of [-1,1]){
      strut([x*3.6,2,-2.97],[x*2.4,10.7,2.1],.23);
      strut([x*3.6,2,2.97],[x*2.4,10.7,-2.1],.23);
    }
    b(mat.orange,0,11.84,0,6,1.03,5.6);b(mat.edge,0,12.48,0,5.4,.35,5);
    b(mat.orange,-1.65,13.48,0,5.5,1.8,4.65);
    for(const z of [-1.23,1.23]){
      for(const y of [14.65,16.8])b(mat.orange,4.6,y,z,26.1,.25,.24);
      for(let x=-8.3;x<17.6;x+=2.16){
        strut([x,14.75,z],[x+1.08,16.66,z],.16);strut([x+1.08,16.66,z],[x+2.16,14.75,z],.16);
      }
      strut([-3.6,16.8,z],[-.6,22.85,z*.54],.29);
      strut([1.18,16.8,z],[-.6,22.85,z*.54],.29);
      for(const tip of [-8,12.7,17.25])cable(p(-.6,22.8,z*.54),p(tip,16.88,z),.22*s,.061*s);
    }
    for(let x=-8;x<17.5;x+=2.35)strut([x,16.72,-1.25],[x,16.72,1.25],.12);
    b(mat.orange,14.4,14.36,0,1.4,.42,2.5);
    for(const z of [-.52,.52])pipe(mat.black,p(14.4,14.1,z),p(14.4,8.65,z),.047*s);
    b(mat.rail,14.4,8.53,0,.8,.39,1.6);b(mat.edge,14.4,8.13,0,.19,.57,.19);
    b(mat.clean,4.7,13.12,1.25,2.6,1.95,1.76);b(mat.window,4.7,13.33,2.16,2.32,.93,.04);
    b(mat.orange,4.7,14.19,1.25,2.88,.14,1.94);
    for(const x of [3.98,4.73,5.49])b(mat.edge,x,13.33,2.19,.066,.96,.04);
  }
  crane(-20.5,-26.4,1.08);crane(47,-57,1.35);crane(-58,-48,1.55);
  // Outer quay: mooring bollards, a work vessel, distant oil terminal and headland.
  box(mat.concrete,0,-1.15,30.5,48,1.9,1.2);
  box(mat.concrete,23.37,-1.05,0,1.3,1.9,62);
  for(let z=-27;z<29;z+=5.25){
    cyl(mat.edge,22,.14,z,.55,.23);cyl(mat.rust,22,.45,z,.34,.48);cyl(mat.edge,22,.74,z,.55,.15);
    box(mat.concrete,23.4,-.42,z,.95,.82,.55);
  }
  const sea=new T.Mesh(new T.PlaneGeometry(510,510),new T.ShaderMaterial({
    uniforms:{time:{value:0}},vertexShader:'varying vec3 vP; void main(){ vec4 wp=modelMatrix*vec4(position,1.);vP=wp.xyz;gl_Position=projectionMatrix*viewMatrix*wp;}',
    fragmentShader:`varying vec3 vP;uniform float time;
    void main(){vec2 p=vP.xz; float n=sin(p.y*2.8+sin(p.x*.32+time*.25)*2.+time*.67)*.44+sin(p.y*5.2+p.x*.38+time*.8)*.17;
    float horizon=pow(1.-clamp(normalize(cameraPosition-vP).y,0.,1.),3.);vec3 col=mix(vec3(.052,.116,.132),vec3(.165,.215,.23),horizon);col+=.03*n+.095*smoothstep(.43,.61,n);gl_FragColor=vec4(col,1.);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
    }`
  }));
  sea.rotation.x=-Math.PI/2;sea.position.y=-1.64;root.add(sea);
  for(const [x,z,s] of [[34,-14,.74],[64,-37,1.3]]){
    box(mat.edge,x,.11*s,z,4.4*s,2.8*s,14*s);
    box(mat.red,x,-.93*s,z,4.44*s,.72*s,14.04*s);
    box(mat.roof,x,1.62*s,z,4.65*s,.27*s,14.4*s);
    box(mat.clean,x,2.6*s,z-2*s,3.65*s,1.74*s,4.8*s);
    box(mat.window,x,3.86*s,z-2*s,3.52*s,1.11*s,4.52*s);
    box(mat.white,x,4.55*s,z-2*s,3.93*s,.25*s,4.95*s);
    cyl(mat.iron,x,6.22*s,z-2.2*s,.12*s,3.29*s);
    for(let i=-5;i<=5;i+=2)for(const side of [-1,1])cyl(mat.black,x+side*2.26*s,1.1*s,z+i*s,.82*s,.24*s,.82*s,0,0,Math.PI/2);
  }
  for(let i=0;i<11;i++){
    let x=-68+i*13,z=-65-rand()*17,h=7+rand()*8,diam=4+rand()*4;
    cyl(mat.roof,x,h/2,z,diam,h);
    for(const y of [.25,h*.5,h-.18])cyl(mat.iron,x,y,z,diam+.16,.2);
    inst(rounded,mat.roof,x,h,z,diam,1.2,diam);
  }
  // Painted perimeter fence with a tiled diamond mesh.
  const gridCanvas=document.createElement('canvas');
  gridCanvas.width=gridCanvas.height=64;
  const gc=gridCanvas.getContext('2d');gc.strokeStyle='rgba(96,106,98,.85)';gc.lineWidth=2.8;
  gc.beginPath();gc.moveTo(0,32);gc.lineTo(32,0);gc.lineTo(64,32);gc.lineTo(32,64);gc.closePath();gc.stroke();
  function fence(a,b){
    const l=Math.hypot(a[0]-b[0],a[1]-b[1]),n=Math.ceil(l/3.2),h=2.26;
    for(let i=0;i<=n;i++){
      const t=i/n,x=a[0]+(b[0]-a[0])*t,z=a[1]+(b[1]-a[1])*t;
      cyl(mat.iron,x,h*.51,z,.095,h*1.02);cyl(mat.concrete,x,.1,z,.27,.2);
    }
    pipe(mat.iron,[a[0],h,a[1]],[b[0],h,b[1]],.085);
    pipe(mat.iron,[a[0],.23,a[1]],[b[0],.23,b[1]],.058);
    const tex=new T.CanvasTexture(gridCanvas);tex.wrapS=tex.wrapT=T.RepeatWrapping;tex.repeat.set(l*5,10);tex.colorSpace=T.SRGBColorSpace;
    const mesh=new T.Mesh(new T.PlaneGeometry(l,h-.16),new T.MeshStandardMaterial({map:tex,alphaTest:.25,side:T.DoubleSide,roughness:.92}));
    mesh.position.set((a[0]+b[0])*.5,h*.51,(a[1]+b[1])*.5);mesh.rotation.y=-Math.atan2(b[1]-a[1],b[0]-a[0]);root.add(mesh);
  }
  fence([-20.8,-29],[-20.8,28.7]);fence([-20.8,28.7],[21.6,28.7]);fence([21.6,28.7],[21.6,-28.8]);
  // Distribution poles and catenaries break the skyline with legible scale.
  for(const z of [24,1,-22]){
    cyl(mat.concrete,20.4,5.9,z,.28,11.8);
    box(mat.iron,20.4,10.86,z,2.35,.15,.16);
    for(const dx of [-.96,0,.96]){
      for(let j=0;j<3;j++)cyl(mat.body,20.4+dx,11.02+j*.1,z,.17,.06);
      if(z>-22)cable([20.4+dx,11.3,z],[20.4+dx,11.3,z-23],.75,.032);
    }
    member(mat.iron,[20.4,9.5,z],[18.7,10.2,z],.095);
    box(mat.edge,18.5,10.11,z,.75,.16,.38);box(mat.light,18.45,10.015,z,.58,.04,.27);
  }
  cable([-12,7.25,7.9],[20.4,10.9,1],1.45,.048);
  cable([-12,7.27,7.6],[20.4,10.88,.7],1.53,.035);
  // Small ground details: concrete chips, safety cones, vegetation along joints.
  const chip=new T.DodecahedronGeometry(.5,0),leaf=new T.ConeGeometry(.5,1,3);
  const growth=surface('#777949'),grass=surface('#a29561'),chipMat=surface('#979181');
  for(let i=0;i<380;i++){
    let x=-19+rand()*39,z=-27+rand()*54;
    if(Math.abs(x)<5&&rand()<.85)continue;
    const s=.024+rand()*.13;
    inst(chip,rand()>.4?chipMat:mat.gravel,x,s*.12,z,s*1.5,s*.42,s,rand()*.3,rand()*6,rand()*.4);
  }
  for(let j=0;j<85;j++){
    let x=rand()>.5?20.5+rand()*.45:-19-rand()*.7,z=-27+rand()*54;
    if(j%3===0){x=-15.75+rand()*.3;z=-15+rand()*23;}
    for(let k=0;k<8;k++){
      const h=.16+rand()*.41;
      inst(leaf,k%3?growth:grass,x+(rand()-.5)*.43,h*.49,z+(rand()-.5)*.5,.045,h,.037,(rand()-.5)*.61,rand()*3,(rand()-.5)*.75);
    }
  }
  for(const [x,z] of [[6.25,17.7],[-10.65,6.64],[8.33,-2.07]]){
    box(mat.black,x,.04,z,.43,.075,.43);
    const cone=new T.ConeGeometry(.176,.69,14);
    inst(cone,mat.orange,x,.41,z,1,1,1);
    const band=new T.CylinderGeometry(.074,.106,.127,14);
    inst(band,mat.white,x,.41,z,1,1,1);
  }
  // The upstream reservoir wall dwarfs the original lower tide gates. Each pour
  // follows the same curved section, including ribs, expansion joints and parapet.
  const faceGeo={position:[],uv:[],color:[],index:[]};
  const wallDepth=(x,y)=>-53.8+.0012*x*x-.25*y;
  const hMax=35.8;
  const wallPoint=(x,y,front=0)=>[x,y,wallDepth(x,y)+front];
  function quad(target,a,b,c,d,uvs,colors){
    const i=target.position.length/3;
    for(const [j,p] of [a,b,c,d].entries()){
      target.position.push(...p);target.uv.push(...uvs[j]);
      const color=colors[j];target.color.push(...color);
    }
    target.index.push(i,i+1,i+2,i,i+2,i+3);
  }
  function builtSurface(data,material,cast=true){
    const geo=new T.BufferGeometry();
    geo.setAttribute('position',new T.Float32BufferAttribute(data.position,3));
    geo.setAttribute('uv',new T.Float32BufferAttribute(data.uv,2));
    geo.setAttribute('color',new T.Float32BufferAttribute(data.color,3));
    geo.setIndex(data.index);geo.computeVertexNormals();
    const mesh=new T.Mesh(geo,material);mesh.castShadow=cast;mesh.receiveShadow=true;root.add(mesh);return mesh;
  }
  const pourGrain=texture('panel-normal.jpg').clone();
  pourGrain.repeat.set(8,6);
  const poured=new T.MeshStandardMaterial({map:texture('dam-face.webp',true),
    normalMap:pourGrain,vertexColors:true,roughness:.93,side:T.DoubleSide});
  for(let bay=-6;bay<6;bay++){
    const left=bay*11,right=left+11;
    for(let row=0;row<4;row++){
      const bottom=row*hMax/4,top=bottom+hMax/4;
      const shade=.68+rand()*.16;
      const a=[shade*.95,shade*.93,shade*.86],b=[shade+.11,shade+.09,shade+.03];
      const u0=(left+66)/53.7,u1=(right+66)/53.7;
      const v0=bottom/hMax,v1=top/hMax;
      quad(faceGeo,wallPoint(left+.08,bottom),wallPoint(right-.08,bottom),
        wallPoint(right-.08,top-.04),wallPoint(left+.08,top-.04),
        [[u0,v0],[u1,v0],[u1,v1],[u0,v1]],[a,a,b,b]);
    }
    const slope=Math.atan(.0024*(left+5.5));
    box(mat.clean,left+5.5,hMax+.44,wallDepth(left+5.5,hMax)-2,11.15,.87,4.6,0,-slope);
    box(mat.edge,left+5.5,hMax+.04,wallDepth(left+5.5,hMax)+.38,11.1,.16,.44,0,-slope);
    railing([left,wallDepth(left,hMax)+.09],[right,wallDepth(right,hMax)+.09],hMax+.9,1.15,mat.iron);
    member(mat.concrete,wallPoint(left,1.2,1.2),wallPoint(left,hMax,.54),1.12,2.22);
    box(mat.clean,left,hMax-.12,wallDepth(left,hMax)+.9,1.75,1.55,2.2);
    if(bay%2===0){
      const sx=left+1.5,sz=wallDepth(sx,hMax)-2;
      cyl(mat.edge,sx,hMax+2.55,sz,.12,4.4);
      box(mat.roof,sx+.26,hMax+4.73,sz,.77,.15,.26);
    }
  }
  builtSurface(faceGeo,poured);
  // Sluice water clings to the inclined apron. Its flow speeds up below the lip;
  // the thin edges and overlapping white-water filaments break up the silhouette.
  const flowSurface={position:[],uv:[],color:[],index:[]};
  const spillTime={value:0};
  for(const [cx,crest,width] of [[-2.8,23.7,3.05],[47.2,29.5,2.55]]){
    const lip=(u,v)=>{
      const y=crest*(1-v),spread=width*(1+v*.43);
      return wallPoint(cx+(u-.5)*spread,y,1.97+Math.sin(v*Math.PI)*.83+.085*Math.sin(u*17+v*4));
    };
    for(let i=0;i<6;i++)for(let j=0;j<15;j++){
      const a=i/6,b=(i+1)/6,c=j/15,d=(j+1)/15;
      const shade=Array(4).fill([1,1,1]);
      quad(flowSurface,lip(a,d),lip(b,d),lip(b,c),lip(a,c),[[a,d],[b,d],[b,c],[a,c]],shade);
    }
  }
  const spill=new T.ShaderMaterial({
    side:T.DoubleSide,uniforms:{clock:spillTime,waterNoise:{value:texture('spray.webp')},fogTint:{value:new T.Color('#8c9aa4')}},
    vertexShader:`varying vec2 flow;varying float distanceToEye;
      void main(){flow=uv;vec4 view=modelViewMatrix*vec4(position,1.);distanceToEye=-view.z;gl_Position=projectionMatrix*view;}`,
    fragmentShader:`uniform float clock;uniform sampler2D waterNoise;uniform vec3 fogTint;
      varying vec2 flow;varying float distanceToEye;
      void main(){
        float scroll=clock*.52;
        vec2 f=vec2(flow.x*2.7,flow.y*.7-scroll*.12);
        float offset=texture2D(waterNoise,fract(f)).r;
        float veins=texture2D(waterNoise,fract(vec2(flow.x*7.1+offset*.19,flow.y*1.8-scroll*.27))).r;
        float ripple=sin(flow.x*118.+offset*8.+flow.y*3.2)*.5+.5;
        float edge=abs(flow.x-.5)*2.;
        float foam=clamp(veins*.8+pow(ripple,5.)*(.22+veins*.6)+edge*edge*.20,0.,1.);
        if(edge>1.-.045*offset)discard;
        vec3 color=mix(vec3(.048,.075,.078),vec3(.63,.67,.61),foam);
        float haze=1.-exp(-pow(distanceToEye*.0060,2.));
        gl_FragColor=vec4(mix(color,fogTint,haze),1.);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`
  });
  builtSurface(flowSurface,spill,false);
  // Spillway chutes, control galleries, lift towers and inspection bridges project
  // from the curved wall. Heavy seams, cavities and their cast shadows give scale.
  for(const cx of [-34.4,-2.8,9.9,47.2]){
    const low=11.2,high=hMax-1.75;
    const chute=(dx,y,offset=0)=>wallPoint(cx+dx,y,1.16+offset);
    const w=4.38;
    for(const side of [-1,1]){
      member(mat.concrete,chute(side*w*.5,low,.26),chute(side*w*.5,high,.06),.79,1.24);
      member(mat.edge,chute(side*w*.38,low+.46,.16),chute(side*w*.38,high-.54,.21),.16,.38);
    }
    for(let j=0;j<13;j++){
      const y=low+(high-low)*j/13;
      box(mat.body,cx,y+.65,wallDepth(cx,y)+1.31,w-.66,(high-low)/13+.04,.38,-.24);
      member(mat.iron,chute(-1.86,y,.42),chute(1.86,y,.42),.11,.19);
    }
    const z=wallDepth(cx,high);
    box(mat.edge,cx,high+.21,z+.85,w+1.32,.45,3.1);
    box(mat.concrete,cx,high+1.69,z+.62,w+1.25,2.66,2.65);
    box(mat.roof,cx,high+3.08,z+.62,w+1.63,.18,2.96);
    box(mat.black,cx,high+1.79,z+1.96,w-.18,.92,.12);
    for(let k=0;k<5;k++)box(mat.iron,cx,high+1.42+k*.17,z+2.04,w-.25,.066,.12);
    // Visible maintenance bridge halfway up the wall.
    const mid=22.2,front=wallDepth(cx,mid)+2.1;
    box(mat.edge,cx,mid,front,6.1,.2,1.18);railing([cx-3,front+.6],[cx+3,front+.6],mid+.13,.76,mat.rail);
    member(mat.iron,[cx-2.38,mid-1.53,front-.52],[cx-2.38,mid-.1,front+.47],.16,.22);
    member(mat.iron,[cx+2.38,mid-1.53,front-.52],[cx+2.38,mid-.1,front+.47],.16,.22);
  }
  // Shaded service gallery along upper dam edge.
  for(let k=-6;k<6;k++){
    const x=k*11+5.5,y=hMax-2.4,z=wallDepth(x,y)+.64;
    box(mat.iron,x,y+.85,z,10.65,.18,.77);
    for(let j=0;j<4;j++)box(mat.shadow,x-3.9+j*2.59,y+.1,z+.13,2.26,.55,.24);
  }

  // Pilot house cantilevers over the wall and casts a broken shadow onto the crest.
  const towerX=23,towerZ=wallDepth(towerX,hMax)-1.6;
  box(mat.concrete,towerX,hMax+3.1,towerZ,5.9,6.3,5.1);
  box(mat.white,towerX,hMax+6.68,towerZ+.7,9.3,1.13,6.2);
  box(mat.edge,towerX,hMax+7.96,towerZ+.7,9.27,1.65,6.25);
  windowRow(towerX,towerZ+3.85,hMax+7.26,8.9,1.3,8);
  box(mat.clean,towerX,hMax+9.02,towerZ+.7,9.96,.65,6.94);
  cyl(mat.edge,towerX+1.88,hMax+11.8,towerZ,.14,5.4);
  for(let i=0;i<4;i++)box(mat.iron,towerX+1.88,hMax+12.6+i*.49,towerZ,1.96-i*.37,.065,.09);
  // Large cloth daymarks use a single texture sheet, with a folded profile at a
  // slant against the wall. Site identification stays legible from the south.
  const flag=document.createElement('canvas');flag.width=512;flag.height=1024;
  const fc=flag.getContext('2d');
  fc.fillStyle='#263339';fc.fillRect(0,0,512,1024);
  fc.fillStyle='#a23c25';fc.fillRect(0,0,512,58);fc.fillRect(48,290,416,14);
  fc.fillStyle='#c5beac';fc.font='bold 44px Arial';fc.textAlign='center';fc.fillText('TIDAL  /  07',256,200);
  fc.fillStyle='#efdfbe';fc.font='bold 252px Arial';fc.fillText('07',255,564);
  fc.fillStyle='#aa4a32';fc.beginPath();fc.moveTo(82,822);fc.lineTo(256,625);fc.lineTo(430,822);
  fc.lineTo(350,822);fc.lineTo(256,717);fc.lineTo(160,822);fc.fill();
  fc.fillStyle='#a79c83';fc.font='bold 25px Arial';fc.fillText('WATER  AUTHORITY',256,927);
  for(let i=0;i<8000;i++){fc.fillStyle=rand()>.5?'rgba(227,218,188,.13)':'rgba(0,0,0,.15)';fc.fillRect(rand()*512,rand()*1024,rand()*3+1,rand()*5+1);}
  const flagMap=new T.CanvasTexture(flag);flagMap.colorSpace=T.SRGBColorSpace;flagMap.anisotropy=8;
  const flagMat=new T.MeshStandardMaterial({map:flagMap,roughness:.96,vertexColors:true,side:T.DoubleSide});
  const fabric={position:[],uv:[],color:[],index:[]};
  for(const [cx,w,drop] of [[-15.4,4.8,12.4],[29.7,4.9,12.6],[-49.9,5.4,12.5]]){
    const point=(s,t)=>{
      const x=cx+(s-.5)*w,y=hMax+.38-t*drop;
      return wallPoint(x,y,1.1+(.06+t*.12)*Math.sin(s*21+t*1.6)+t*.08*Math.sin(s*45+t*1.4));
    };
    for(let i=0;i<14;i++)for(let j=0;j<5;j++){
      const u=i/14,v=j/5,u2=(i+1)/14,v2=(j+1)/5;
      const brightness=t=>.76+.24*Math.cos(t*21);
      const a=Array(3).fill(brightness(u)),b=Array(3).fill(brightness(u2));
      quad(fabric,point(u,v2),point(u2,v2),point(u2,v),point(u,v),[[u,1-v2],[u2,1-v2],[u2,1-v],[u,1-v]],[a,b,b,a]);
    }
    pipe(mat.iron,point(-.04,0),point(1.04,0),.15);
  }
  builtSurface(fabric,flagMat);

  // Exposed quarry strata and broken retaining slopes surround the approach canal.
  // Depth, length and strata vary per step to maintain a three-dimensional skyline.
  const cliff={position:[],uv:[],color:[],index:[]};
  const rockMat=new T.MeshStandardMaterial({map:texture('rock-color.jpg',true),
    normalMap:texture('rock-normal.jpg'),roughness:.94,vertexColors:true,side:T.DoubleSide});
  function escarpment(cx,cz,rx,rz,height,phase){
    const count=43,rows=7,rings=[];
    for(let j=0;j<=rows;j++){
      const t=j/rows,r=[];
      for(let i=0;i<=count;i++){
        const a=((i%count)/count)*Math.PI*2;
        const ledge=(1-.67*t)*(1+.077*Math.sin(a*5+phase)+.054*Math.cos(a*11+phase+t*4));
        const peak=height*(.85+.1*Math.sin(a*3+phase)+.075*Math.sin(a*7+.9));
        const yy=-3+t*peak+Math.sin(a*5+phase)*t*1.4;
        r.push([cx+rx*ledge*Math.cos(a),yy,cz+rz*ledge*Math.sin(a)]);
      }
      rings.push(r);
    }
    for(let j=0;j<rows;j++)for(let i=0;i<count;i++){
      const s=.59+.09*j/rows+.13*rand(),c=[s,s*.95,s*.83];
      const x=i/2.7,y=j/2;
      quad(cliff,rings[j][i+1],rings[j][i],rings[j+1][i],rings[j+1][i+1],
        [[x+.37,y],[x,y],[x,y+.53],[x+.37,y+.53]],[c,c,c,c]);
    }
    for(let i=0;i<count;i++){
      const a=rings[rows][i],b=rings[rows][i+1],m=[cx,height*.94,cz];
      const c=[.64,.62,.53];
      quad(cliff,a,m,m,b,[[a[0]/12,a[2]/12],[cx/12,cz/12],[cx/12,cz/12],[b[0]/12,b[2]/12]],[c,c,c,c]);
    }
  }
  escarpment(-91,-62,53,38,44,.4);escarpment(95,-79,51,36,48,1.7);
  escarpment(64,-119,53,44,35,3.3);escarpment(-55,-119,59,52,43,2.4);
  builtSurface(cliff,rockMat,false);

  // Date palms are silhouettes built from folded pinnae, rather than cutout cards.
  // The split fronds and a varying crown keep the tree recognizable from any angle.
  const leafPos=[],leafCol=[],leafIdx=[];
  function palm(x,z,h,spread,bend){
    const crown=[x+bend,h,z+.27*bend];
    const seg=7;
    for(let k=0;k<seg;k++){
      const a=k/seg,b=(k+1)/seg;
      const low=[x+bend*a*a,h*a,z+.27*bend*a],high=[x+bend*b*b,h*b,z+.27*bend*b];
      member(mat.worn,low,high,(.39+.085*Math.cos(a*4.9))*(h/7.3),(.39+.085*Math.cos(a*4.9))*(h/7.3),round);
      if(k>2)cyl(mat.wood,high[0],high[1]-.1,high[2],h*.061,.15);
    }
    for(let f=0;f<23;f++){
      const a=f*2.399+rand()*.2,ca=Math.cos(a),sa=Math.sin(a),s=spread*(.67+rand()*.41);
      const upper=f>15,drop=upper?-.04:(.38+rand()*.45),rise=upper?.75:.38,dry=f<3;
      const p=(t)=>[crown[0]+ca*s*t,crown[1]+s*(rise*Math.sin(t*2.25)-drop*t*t),crown[2]+sa*s*t];
      for(let j=0;j<5;j++)pipe(dry?mat.wood:mat.rail,p(j/5),p((j+1)/5),.04*(1-j*.12));
      for(let k=1;k<22;k++){
        const t=k/23,len=s*(.16+.21*Math.sin(t*Math.PI))*(1-.47*t);
        for(const side of [-1,1]){
          const [px,py,pz]=p(t);
          const tip=[px-ca*len*.04-sa*side*len+ca*len*.32,py-len*(.22+rand()*.45),pz+ca*side*len+sa*len*.32];
          const half=s*.012,mid=[px+(tip[0]-px)*.48,py+(tip[1]-py)*.32+.047,pz+(tip[2]-pz)*.48];
          const shade=.76+rand()*.41,tint=dry?[.25,.16,.055]:[.07,.128,.044];
          const n=leafPos.length/3;
          leafPos.push(px,py,pz,mid[0]+ca*half,mid[1],mid[2]+sa*half,...tip,mid[0]-ca*half,mid[1]-.048,mid[2]-sa*half);
          for(const weight of [.6,1,1.1,.83])leafCol.push(...tint.map(c=>c*shade*weight));
          leafIdx.push(n,n+1,n+2,n,n+2,n+3);
        }
      }
    }
  }
  solid(mat.concrete,-26,-3,7,.65,39);box(mat.gravel,-26,.66,-3,6.74,.12,38.7);
  for(const [x,z,h,s,b] of [[-14.75,-7.1,11.1,3.2,.65],[-23,9,10,3.55,.83],[-26,-1,13,4.35,-1],[-25,-18,11.7,4.1,-.7],
    [20.9,-7.65,10.7,3.95,-.48],[-29,-28,14.7,4.5,.91],[28.3,-29.1,11.6,4.3,.4],
    [33,-30,8.7,3.45,-.31],[-38,-37,14.6,4.58,-.7]]){
    if(x>21||z<-28)box(mat.concrete,x,-1,z,3.2,2.3,3.3);
    palm(x,z,h,s,b);
    if(x>bounds.minX&&x<bounds.maxX&&z>bounds.minZ&&z<bounds.maxZ)block(x,z,.5,.5,h);
  }
  const leaves=new T.BufferGeometry();leaves.setAttribute('position',new T.Float32BufferAttribute(leafPos,3));
  leaves.setAttribute('color',new T.Float32BufferAttribute(leafCol,3));leaves.setIndex(leafIdx);leaves.computeVertexNormals();
  const canopy=new T.Mesh(leaves,new T.MeshStandardMaterial({vertexColors:true,roughness:.88,side:T.DoubleSide}));
  canopy.castShadow=true;canopy.receiveShadow=true;root.add(canopy);

  // Canvas throws are draped over cargo edges with sagging hems and tied corners.
  // Their folds cast real shadows over the timber stack immediately left of entry.
  function tarp(cx,cz,y,w,d,drop){
    const data={position:[],uv:[],color:[],index:[]};
    const plane=(u,v,side)=>{
      const ripple=.075*Math.cos(u*21.8+v*2.8)+.032*Math.sin(u*49.4-v*3);
      if(side===0)return [cx+(u-.5)*w,y+.016+.024*Math.sin(u*19+v*10),cz+(v-.5)*d];
      const edge=v*v*drop*(.78+.19*Math.sin(u*13)+.14*Math.cos(u*23));
      if(side===1)return [cx+(u-.5)*w,y-edge,cz+d/2+.015+v*ripple];
      if(side===2)return [cx+w/2+.015+v*ripple,y-edge,cz+(.5-u)*d];
      return [cx-w/2-.018-v*ripple,y-edge,cz+(u-.5)*d];
    };
    for(let side=0;side<4;side++)for(let u=0;u<18;u++)for(let v=0;v<4;v++){
      const a=u/18,b=(u+1)/18,c=v/4,e=(v+1)/4;
      const s=.73+rand()*.1,colors=Array.from({length:4},()=>[s*.96,s*.96,s*.88]);
      quad(data,plane(a,c,side),plane(a,e,side),plane(b,e,side),plane(b,c,side),[[a,c],[a,e],[b,e],[b,c]],colors);
    }
    const canvas=new T.MeshStandardMaterial({color:0x777257,roughness:.97,vertexColors:true,side:T.DoubleSide});
    builtSurface(data,canvas);
    for(const side of [-1,1])pipe(mat.wood,[cx+side*w*.45,y-drop*.63,cz+d/2+.03],[cx+side*w*.44,.15,cz+d/2-.04],.026);
  }
  tarp(-5.1,12.73,2.31,1.46,1.46,.59);

  // A low pallet step fits against the south face of the stacked freight.
  const stepX=-4.97,stepZ=15.60;
  for(let layer=0;layer<3;layer++){
    const y=layer*.145;
    for(const dx of [-.58,0,.58])box(mat.wood,stepX+dx,y+.055,stepZ,.13,.11,.97);
    for(let n=0;n<6;n++)box(mat.wood,stepX,y+.13,stepZ-.44+n*.177,1.46,.045,.145);
  }
  block(stepX,stepZ,1.46,.98,.442);

  // Flanged return mains, gauge wheels and pressure vessels feed the pump house.
  // Their projected shadows follow the bolt collars and stand-off brackets.
  for(const [height,diameter] of [[.77,.43],[1.43,.32]]){
    const x=12.51;
    pipe(mat.body,[x,height,-16.55],[x,height,-4.34],diameter);
    for(const z of [-15.8,-12.7,-9,-5.52]){
      const flange=diameter*1.48;
      cyl(mat.iron,x,height,z,flange,.11,flange,Math.PI/2);
      for(let i=0;i<8;i++){
        const a=i*Math.PI/4;
        cyl(mat.bolt,x+flange*.388*Math.cos(a),height+flange*.388*Math.sin(a),z+.06,.048,.04,.048,Math.PI/2);
      }
      box(mat.edge,x,.22,z,.56,.42,.25);
    }
  }
  for(const [x,z,s] of [[14.0,-4.16,1],[19.35,-4.12,.72]]){
    const wheel=new T.TorusGeometry(.24*s,.035*s,6,24);
    inst(wheel,mat.red,x,1.45*s,z+.19,1,1,1);
    cyl(mat.body,x,.65*s,z+.06,.17*s,1.3*s);
    cyl(mat.iron,x,1.45*s,z+.10,.11*s,.27*s,.11*s,Math.PI/2);
    for(let n=0;n<4;n++){
      const a=n*Math.PI/2;
      member(mat.red,[x,1.45*s,z+.19],[x+.22*s*Math.cos(a),1.45*s+.22*s*Math.sin(a),z+.19],.033*s);
    }
  }

  // An elevated pair of insulated mains runs along the east quay. Bent elbows,
  // flanged joints, clamps, posts and access trays share the calling pipes' finish.
  const pipeCoat=surface('#aaaba0',.5,.45,'steel',2.7);
  const pipePaint=surface('#b17e4a',.55,.38,'paint',2.1);
  const runX=11.45,runY=4.60;
  for(const z of [-5.65,1.6,10.15,16.3]){
    const baseX=z<3?13.05:12.15;
    const base=z<3?0:2.98;
    if(base===0){
      box(mat.concrete,baseX,.20,z,.59,.40,.62);block(baseX,z,.59,.62,.4);
    }
    box(mat.edge,baseX,base+(runY-.36-base)*.5,z,.15,runY-.36-base,.19);
    block(baseX,z,.15,.19,runY-.36,base);
    box(mat.iron,(baseX+runX-.26)*.5,runY-.36,z,baseX-runX+.55,.16,.21);
    member(mat.iron,[baseX,runY-1.4,z],[runX-.12,runY-.48,z],.115,.12);
  }
  const pipeCurve=new T.TorusGeometry(1,.19,12,18,Math.PI/2);
  for(const [offX,offsetY,r,m] of [[0,0,.40,pipePaint],[.55,.06,.29,pipeCoat]]){
    const x=runX+offX,y=runY+offsetY;
    cyl(m,x,y,4.95,r,22.3,r,Math.PI/2);
    for(let z=-6;z<=15.5;z+=2.8){
      cyl(mat.iron,x,y,z,r*1.27,.105,r*1.27,Math.PI/2);
      for(let j=0;j<6;j++){
        const a=Math.PI*j/3;
        cyl(mat.bolt,x+.55*r*Math.cos(a),y+.55*r*Math.sin(a),z+.069,.038,.046,.038,Math.PI/2);
      }
      cyl(mat.rail,x,y,z+.22,r*1.018,.095,r*1.018,Math.PI/2);
    }
    const bendRadius=r/.38;
    inst(pipeCurve,m,x,y-bendRadius,16.1,bendRadius,bendRadius,bendRadius,Math.PI/2,Math.PI/2,0);
    const outletZ=16.1+bendRadius,outletHeight=y-bendRadius;
    cyl(m,x,outletHeight*.5,outletZ,r,outletHeight);
    for(const endY of [.25,1.45,outletHeight-.22])cyl(mat.iron,x,endY,outletZ,r*1.30,.10);
    box(mat.concrete,x,.11,outletZ,.64,.22,.64);block(x,outletZ,.64,.64,outletHeight);
  }
  // Exhaust stacks emerge above the boiler-room roof; guard rings and a cap
  // preserve their silhouette against the bright cloud bank.
  for(const [x,z,base,h,diam] of [[14.7,-10.8,8.55,2.6,.64],[16.7,-11.6,8.55,3.9,.46],[-18.33,-10.9,7.35,1.0,.55]]){
    cyl(pipeCoat,x,base+h*.5,z,diam,h);
    for(const f of [.08,.45,.93])cyl(mat.iron,x,base+h*f,z,diam*1.14,.093);
    for(let j=0;j<4;j++){
      const a=j*Math.PI/2;
      cyl(mat.iron,x+Math.cos(a)*diam*.46,base+h+.15,z+Math.sin(a)*diam*.46,.035,.33);
    }
    cyl(mat.edge,x,base+h+.34,z,diam*1.47,.066);
  }

  // A parked diesel forklift occupies the cargo-stack footprint.
  {
    const x=7.55,z=1.25,yellow=mat.rail,metal=mat.edge,tyre=mat.black;
    const b=(m,dx,y,dz,w,h,d,rot=0)=>box(m,x+dx,y,z+dz,w,h,d,0,0,rot);
    const sideCyl=(m,dx,y,dz,r,width)=>cyl(m,x+dx,y,z+dz,r,width,r,Math.PI/2);
    b(metal,0,.54,0,2.83,.26,1.26);
    b(yellow,.23,.91,0,2.39,.57,1.31);
    inst(rounded,yellow,x+1.05,.99,z,.88,.89,1.38);
    for(const side of [-1,1]){
      const dz=side*.67;
      for(const [dx,r] of [[-.97,.95],[1.02,.76]]){
        sideCyl(tyre,dx,r*.5,dz,r,.25);
        sideCyl(metal,dx,r*.5,dz+side*.134,r*.64,.038);
        sideCyl(yellow,dx,r*.5,dz+side*.162,r*.44,.036);
        for(let j=0;j<6;j++)sideCyl(mat.bolt,dx+r*.142*Math.cos(j*Math.PI/3),r*.5+r*.142*Math.sin(j*Math.PI/3),dz+side*.188,.052,.018);
      }
      b(yellow,-.96,1.02,dz*.86,.98,.19,.37,.07*side);
      b(metal,.18,1.02,dz+side*.02,.53,.07,.15);
      for(const [a,c] of [[-.64,-.73],[.67,.48]])member(metal,[x+a,1.1,z+dz*.82],[x+c,2.52,z+dz*.82],.083,.084);
      b(mat.rail,-.12,2.57,dz*.87,1.66,.095,.095);
      b(metal,-1.34,1.48,dz*.78,.15,2.78,.11,-.035);
      b(mat.iron,-1.47,1.46,dz*.76,.071,2.68,.07,-.035);
      b(metal,-1.4,.6,dz*.72,.13,.69,.12);
      b(mat.iron,-1.78,.24,dz*.75,.77,.066,.15,-.035);
      b(mat.light,-.76,2.38,dz*.84,.115,.102,.134);
    }
    for(let dx=-.76;dx<.64;dx+=.2)b(metal,dx,2.59,0,.076,.049,1.17);
    b(yellow,.76,1.28,0,.93,.19,1.26,-.12);
    b(tyre,.13,1.32,0,.59,.14,.66);
    b(tyre,.42,1.61,0,.12,.62,.65,-.18);
    b(metal,-.61,1.18,0,.34,.57,.9,.09);
    member(metal,[x-.59,1.42,z],[x-.39,1.77,z],.061,.061,round);
    const wheel=new T.TorusGeometry(.148,.019,5,18);
    inst(wheel,tyre,x-.37,1.77,z,1,1,1,-.95,0,-.52);
    for(const dz of [-.22,.22])pipe(mat.bolt,[x-1.32,.52,z+dz],[x-1.4,2.66,z+dz],.063);
    b(metal,-1.42,.68,0,.16,.17,1.12);b(metal,-1.47,2.78,0,.16,.13,1.14);
    sideCyl(mat.bolt,-1.39,2.56,0,.17,1.01);
    b(mat.edge,1.33,1.12,0,.07,.42,.81);
    for(let j=0;j<7;j++)b(mat.bolt,1.379,.97+j*.047,0,.015,.014,.73);
    decal(x+.78,1.08,z+.673,.69,.23,'F  /  06');
    block(x,z,3.27,1.74,2.64);
  }

  // Broad contact darkening keeps objects grounded under both direct and sky light.
  const aoCanvas=document.createElement('canvas');aoCanvas.width=aoCanvas.height=64;
  const ac=aoCanvas.getContext('2d'),grad=ac.createRadialGradient(32,32,0,32,32,32);
  grad.addColorStop(0,'rgba(16,21,20,.68)');grad.addColorStop(.58,'rgba(16,21,20,.4)');grad.addColorStop(1,'rgba(16,21,20,0)');
  ac.fillStyle=grad;ac.fillRect(0,0,64,64);
  const aoMat=new T.MeshBasicMaterial({map:new T.CanvasTexture(aoCanvas),transparent:true,depthWrite:false,polygonOffset:true,polygonOffsetFactor:-1});
  const aoGeo=new T.PlaneGeometry(1,1);
  for(const c of colliders){
    const w=c.maxX-c.minX,d=c.maxZ-c.minZ;
    if(w*d<.22||c.minY>.02)continue;
    inst(aoGeo,aoMat,(c.minX+c.maxX)*.5,.017,(c.minZ+c.maxZ)*.5,w*1.45+.45,d*1.42+.45,1,-Math.PI/2);
  }
  finishSigns();
  for(const {g,m,items} of batches.values()){
    const mesh=new T.InstancedMesh(g,m,items.length);
    items.forEach((matrix,i)=>mesh.setMatrixAt(i,matrix));
    mesh.castShadow=m!==aoMat&&m!==mat.light;mesh.receiveShadow=m!==aoMat;
    mesh.computeBoundingSphere();root.add(mesh);
  }

  scene.background=new T.Color('#acb1b3');
  scene.fog=new T.FogExp2('#8c9aa4',.0060);
  const sky=loadSurface('stormbreak.webp','#a8b9c5');
  sky.mapping=T.EquirectangularReflectionMapping;sky.colorSpace=T.SRGBColorSpace;
  // Baked from the full panorama at the original PMREM resolution. This keeps the
  // smallest reflections without allocating the temporary half-float convolution targets.
  const ibl=loader.load(asset('harbour-ibl.webp'),undefined,undefined,()=>{scene.environment=null;});
  ibl.mapping=T.CubeUVReflectionMapping;ibl.colorSpace=T.SRGBColorSpace;
  ibl.generateMipmaps=false;ibl.minFilter=ibl.magFilter=T.LinearFilter;
  scene.environment=ibl;textures.set('harbour-ibl',ibl);
  scene.environmentIntensity=.57;scene.backgroundIntensity=1.06;
  const ambient=new T.HemisphereLight(0xb8d5f8,0x95877d,.8);root.add(ambient);
  const sun=new T.DirectionalLight(0xffdbaf,4.65);
  sun.target.position.set(0,1,-2);
  sun.position.copy(sun.target.position).addScaledVector(sunlight,93);
  scene.userData.sunDirection=sunlight.clone();
  sun.castShadow=true;sun.shadow.mapSize.setScalar(2048);
  Object.assign(sun.shadow.camera,{left:-48,right:48,top:49,bottom:-36,near:1,far:161});
  sun.shadow.camera.updateProjectionMatrix();sun.shadow.bias=-.00032;sun.shadow.normalBias=.032;
  root.add(sun,sun.target);
  // The panorama supplies the broad light field. A high dynamic range disc and
  // cloud glow share the same world direction as the shadow-casting light.
  const skyDome=new T.Mesh(new T.SphereGeometry(1,40,24),new T.ShaderMaterial({
    side:T.BackSide,depthWrite:false,depthTest:true,fog:false,
    uniforms:{weather:{value:sky},sunDirection:{value:sunlight}},
    vertexShader:`varying vec3 direction;
      void main(){direction=position;vec4 projected=projectionMatrix*viewMatrix*vec4(cameraPosition+position*185.,1.);
      gl_Position=projected.xyww;}`,
    fragmentShader:`varying vec3 direction;uniform sampler2D weather;uniform vec3 sunDirection;
      void main(){
        vec3 ray=normalize(direction);vec2 uv=vec2(atan(ray.z,ray.x)*.15915494+.5,asin(ray.y)*.31830989+.5);
        vec3 skyColor=texture2D(weather,uv).rgb;
        float angular=max(0.,1.-dot(ray,sunDirection));
        float cloud=dot(skyColor,vec3(.22,.69,.09));
        float disc=exp(-angular*144000.)*6.+exp(-angular*22000.)*1.4;
        float aureole=exp(-angular*600.)*.52+exp(-angular*61.)*.15;
        skyColor*=mix(vec3(.36,.46,.61),vec3(1.04,.91,.76),smoothstep(.32,.85,cloud));
        skyColor+=vec3(1.35,.87,.45)*(aureole*(.14+.86*smoothstep(.28,.94,cloud))+disc);
        gl_FragColor=vec4(skyColor,1.);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`
  }));
  skyDome.frustumCulled=false;skyDome.renderOrder=-100;root.add(skyDome);
  scene.background=new T.Color('#929fa8');

  // The mist follows the spillway lip and two working exhaust vents. Sprites
  // are batched; their density grows and dissipates continuously along the wind.
  const mistGeometry=new T.InstancedBufferGeometry().copy(new T.PlaneGeometry(1,1));
  const vents=[],mistData=[];
  function mistSource(x,y,z,rise,radius,count,strength,drift){
    for(let i=0;i<count;i++){
      vents.push(x+(rand()-.5)*radius*.5,y+(rand()-.5)*.3,z+(rand()-.5)*radius*.38,rise);
      mistData.push(radius*(.73+.48*rand()),(i+rand()*.7)/count,strength,drift*(.8+.4*rand()));
    }
  }
  mistSource(-2.8,7.6,-53,11.3,5.7,15,.15,6.2);
  mistSource(47.2,11,-48,11.9,6.9,12,.135,7.9);
  mistSource(16.7,12.83,-11.6,4.1,1.55,9,.14,3.9);
  mistSource(-18.33,8.68,-10.9,4.9,1.8,9,.125,5.1);
  mistGeometry.setAttribute('vent',new T.InstancedBufferAttribute(new Float32Array(vents),4));
  mistGeometry.setAttribute('mistData',new T.InstancedBufferAttribute(new Float32Array(mistData),4));
  mistGeometry.instanceCount=vents.length/4;
  const mist=new T.Mesh(mistGeometry,new T.ShaderMaterial({
    transparent:true,depthWrite:false,uniforms:{clock:spillTime,alphaMap:{value:texture('spray.webp')},sunDirection:{value:sunlight}},
    vertexShader:`attribute vec4 vent;attribute vec4 mistData;uniform float clock;
      varying vec2 vapourUv;varying float strength;varying vec3 ray;
      void main(){
        float t=fract(clock*(.10+.03*mistData.y)+mistData.y);
        vec3 center=vent.xyz+vec3(-mistData.w*t*t,vent.w*t,t*.57);
        center.x+=sin(t*5.+mistData.y*7.)*.22*t;ray=center-cameraPosition;
        vec4 view=viewMatrix*vec4(center,1.);
        float angle=mistData.y*5.3+t*.46,cs=cos(angle),sn=sin(angle);
        view.xy+=mat2(cs,sn,-sn,cs)*position.xy*mistData.x*(.47+1.9*t);
        vapourUv=uv;strength=smoothstep(0.,.19,t)*(1.-smoothstep(.36,1.,t))*mistData.z;
        gl_Position=projectionMatrix*view;
      }`,
    fragmentShader:`uniform sampler2D alphaMap;uniform vec3 sunDirection;varying vec2 vapourUv;varying float strength;varying vec3 ray;
      void main(){float d=texture2D(alphaMap,vapourUv).r;float phase=pow(max(dot(normalize(ray),sunDirection),0.),4.);
        gl_FragColor=vec4(mix(vec3(.46,.52,.56),vec3(1.6,1.24,.87),phase),strength*d);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`
  }));
  mist.frustumCulled=false;mist.renderOrder=3;root.add(mist);
  // Precompute which parts of the humid air see the sun. Four trilinear reads
  // then integrate the light along a visible camera ray, ending on the surface.
  // This lets the shafts turn a corner or terminate at a wall without drawing
  // transparent cards through the player or sampling a full-resolution depth pass.
  function buildAirLighting(){
    const nx=48,ny=16,nz=64;
    const airData=new Uint8Array(nx*ny*nz);
    const occluders=colliders.filter(c=>c.height-c.minY>.7).concat([
      {minX:-22.5,maxX:-11.65,minY:7.01,height:7.35,minZ:-16.4,maxZ:8.4},
      {minX:12.4,maxX:21.4,minY:6.6,height:8.6,minZ:-18,maxZ:-6},
      {minX:-25,maxX:25,minY:0,height:13,minZ:-33.2,maxZ:-29},
      {minX:-10.7,maxX:10.9,minY:6.8,height:7.45,minZ:-19.5,maxZ:-17.6},
      {minX:-70,maxX:70,minY:0,height:36.4,minZ:-65,maxZ:-60},
      {minX:11.17,maxX:12.15,minY:4.4,height:4.91,minZ:-6.25,maxZ:16.2}
    ]);
    const invX=1/sunlight.x,invY=1/sunlight.y,invZ=1/sunlight.z;
    for(let iz=0;iz<nz;iz++)for(let iy=0;iy<ny;iy++)for(let ix=0;ix<nx;ix++){
      const x=-26+52*(ix+.5)/nx,y=17*(iy+.5)/ny,z=-48+80*(iz+.5)/nz;
      let light=1;
      for(const c of occluders){
        if(x>c.maxX||y>c.height||z<c.minZ)continue;
        const enter=Math.max(0,(c.minX-x)*invX,(c.minY-y)*invY,(c.maxZ-z)*invZ);
        if(enter<Math.min((c.maxX-x)*invX,(c.height-y)*invY,(c.minZ-z)*invZ)){light=.06;break;}
      }
      const shore=Math.exp(-((z+27)**2/370+(x-2)**2/780));
      const drifting=.81+.19*Math.sin(z*.22+x*.16+y*.37);
      const density=(.34+shore*.62)*Math.exp(-y*.083)*drifting;
      airData[ix+nx*(iy+ny*iz)]=Math.round(255*density*light);
    }
    const airLight=new T.Data3DTexture(airData,nx,ny,nz);
    airLight.format=T.RedFormat;airLight.type=T.UnsignedByteType;
    airLight.minFilter=airLight.magFilter=T.LinearFilter;airLight.unpackAlignment=1;airLight.needsUpdate=true;
    const atmospheric=new Set();
    root.traverse(node=>{if(node.material?.isMeshStandardMaterial)atmospheric.add(node.material);});
    for(const m of atmospheric){
      const setup=m.onBeforeCompile,previousKey=m.customProgramCacheKey();
      m.onBeforeCompile=shader=>{
        setup.call(m,shader);
        shader.uniforms.airField={value:airLight};shader.uniforms.lightHeading={value:sunlight};
        shader.vertexShader='varying vec3 surfaceAt;\n'+shader.vertexShader.replace('#include <project_vertex>',`#include <project_vertex>
        #ifdef USE_INSTANCING
            surfaceAt=(modelMatrix*instanceMatrix*vec4(transformed,1.)).xyz;
        #else
            surfaceAt=(modelMatrix*vec4(transformed,1.)).xyz;
        #endif`);
        shader.fragmentShader='uniform highp sampler3D airField;uniform vec3 lightHeading;varying vec3 surfaceAt;\n'+shader.fragmentShader.replace('#include <opaque_fragment>',`
          vec3 lineToSurface=surfaceAt-cameraPosition;
          float reach=min(length(lineToSurface),63.);
          vec3 lookRay=normalize(lineToSurface),slice=lookRay*(reach*.25);
          vec3 at=cameraPosition+slice*.5;float fogMass=0.;
          for(int i=0;i<4;i++){
            vec3 uvw=(at+vec3(26.,0.,48.))/vec3(52.,17.,80.);
            float within=smoothstep(0.,.06,uvw.y)*(1.-smoothstep(.78,1.,uvw.y));
            fogMass+=texture(airField,uvw).r*within;at+=slice;
          }
          float forwards=pow(max(0.,dot(lightHeading,lookRay)),6.);
          float air=1.-exp(-fogMass*reach*.00185);
          vec3 inscatter=mix(vec3(.34,.40,.45),vec3(1.14,.87,.54),forwards);
          outgoingLight=mix(outgoingLight,inscatter,air);
        #include <opaque_fragment>`);
      };
      m.customProgramCacheKey=()=>previousKey+'-yard-shafts';
    }
    return airLight;
  }
  const airLight=buildAirLighting();
  let elapsed=0;
  return {colliders,spawns,bounds,ready,
    update(dt,t){elapsed=Number.isFinite(t)?t:elapsed+dt;sea.material.uniforms.time.value=elapsed;spillTime.value=elapsed;},
    dispose(){
      scene.remove(root);
      const materials=new Set(),geometries=new Set(),maps=new Set([sky,pourGrain,...textures.values()]);
      root.traverse(obj=>{if(obj.geometry)geometries.add(obj.geometry);if(obj.material){materials.add(obj.material);if(obj.material.map)maps.add(obj.material.map);}if(obj.isInstancedMesh)obj.dispose();});
      for(const m of materials)m.dispose();for(const g of geometries)g.dispose();for(const tex of maps)tex.dispose();
      sun.shadow.dispose();yardProbe.dispose();airLight?.dispose();scene.background=null;scene.environment=null;
    }
  };
}
