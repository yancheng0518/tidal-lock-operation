import { bootContacts, plantedLeg } from './actor-assets/footwork.js';
import { equipment, mountWeapon } from './actor-assets/viewmodel.js?v=1.3.0';
// Tidal Lock original game models. All dimensions below are local scene units.
const surfaceLibraries = new WeakMap();
const patrolTemplates = new WeakMap();
const PI = Math.PI;

function surfaces(T) {
  if (surfaceLibraries.has(T)) return surfaceLibraries.get(T);
  const standard = (roughness, metalness) => new T.MeshStandardMaterial({ vertexColors: true, roughness, metalness });
  const lib = {
    alloy: standard(.47, .43),
    paint: standard(.68, .17),
    textile: standard(.93, .01),
    rubber: standard(.81, .05),
    glow: new T.MeshBasicMaterial({vertexColors:true, toneMapped:false}),
  };
  // Bake material breakup into a small shared tile. Shading moving actors needs one
  // texture lookup instead of evaluating several octaves of 3D noise per pixel.
  let seed=1901;
  const noise=()=>((seed=Math.imul(1664525,seed)+1013904223|0)>>>0)/4294967296;
  const size=256,values=new Uint8Array(size*size*4);
  const smooth=x=>x*x*(3-2*x);
  function field(x,y,cells,random){
    const fx=x*cells/size,fy=y*cells/size,ix=Math.floor(fx),iy=Math.floor(fy);
    const a=smooth(fx-ix),b=smooth(fy-iy);
    const at=(i,j)=>random[(j%cells)*cells+i%cells];
    return (at(ix,iy)*(1-a)+at(ix+1,iy)*a)*(1-b)+(at(ix,iy+1)*(1-a)+at(ix+1,iy+1)*a)*b;
  }
  const broad=Float32Array.from({length:64},noise),fine=Float32Array.from({length:1024},noise);
  for(let y=0;y<size;y++)for(let x=0;x<size;x++){
    const i=(x+y*size)*4;
    values[i]=255*field(x,y,8,broad);values[i+1]=255*field(x,y,32,fine);
    values[i+2]=255*noise();values[i+3]=255;
  }
  const detail=new T.DataTexture(values,size,size,T.RGBAFormat);
  detail.wrapS=detail.wrapT=T.RepeatWrapping;detail.magFilter=T.LinearFilter;
  detail.minFilter=T.LinearMipmapLinearFilter;detail.generateMipmaps=true;detail.needsUpdate=true;
  for(const name of ['paint','alloy','textile','rubber']){
    const mat=lib[name];
    mat.onBeforeCompile=shader=>{
      shader.uniforms.actorDetail={value:detail};
      shader.vertexShader='varying vec2 actorUv;\n'+shader.vertexShader.replace('#include <begin_vertex>', `#include <begin_vertex>
        vec3 n=abs(normal);
        actorUv=n.x>n.y&&n.x>n.z?position.zy:n.y>n.z?position.xz:position.xy;
      `);
      shader.fragmentShader='uniform sampler2D actorDetail; varying vec2 actorUv;\n'+shader.fragmentShader.replace('#include <color_fragment>', `#include <color_fragment>
        vec3 detail=texture2D(actorDetail,actorUv*2.65).rgb;
        diffuseColor.rgb*=.83+.32*detail.r+.08*detail.b;
      `+(name==='textile'?`
        float printMask=smoothstep(.38,.43,detail.r+.28*(detail.g-.5));
        float darkMask=smoothstep(.65,.70,detail.r-.2*(detail.g-.5));
        diffuseColor.rgb=mix(diffuseColor.rgb, diffuseColor.rgb*vec3(.57,.61,.53),printMask);
        diffuseColor.rgb=mix(diffuseColor.rgb, diffuseColor.rgb*vec3(.57,.64,.60),darkMask);
        vec2 warp=abs(fract(actorUv*125.)-.5);
        float weave=smoothstep(.06,.17,min(warp.x,warp.y));
        diffuseColor.rgb*=mix(.82,1.,mix(1.,weave,clamp(1.-length(fwidth(actorUv))*240.,0.,1.)));
      `:`
        diffuseColor.rgb+=vec3(.055,.049,.042)*smoothstep(.78,.96,detail.b)*smoothstep(.65,.82,detail.r);
      `));
      shader.fragmentShader=shader.fragmentShader.replace('#include <roughnessmap_fragment>',
        '#include <roughnessmap_fragment>\nroughnessFactor=clamp(roughnessFactor+.19*(detail.g-.5),.19,.99);');
    };
    mat.customProgramCacheKey=()=>name;
  }
  surfaceLibraries.set(T, lib);
  return lib;
}

// Combine rigid parts by finish. Tiny fasteners and grooves cost no extra draw calls.
function atelier(T, group, shadow = false) {
  const lib = surfaces(T), parts = new Map();
  const matrix = new T.Matrix4(), quat = new T.Quaternion(), pos = new T.Vector3();
  const euler = new T.Euler(), scale = new T.Vector3(), color = new T.Color();
  function append(geometry, xyz, rot, dims, tint, kind) {
    const raw = geometry.index ? geometry.toNonIndexed() : geometry;
    pos.fromArray(xyz); euler.set(...rot); quat.setFromEuler(euler); scale.fromArray(dims);
    matrix.compose(pos, quat, scale); raw.applyMatrix4(matrix);
    let dst = parts.get(kind);
    if (!dst) parts.set(kind, dst={p:[], n:[], uv:[], c:[]});
    const p=raw.attributes.position, n=raw.attributes.normal, uv=raw.attributes.uv;
    color.set(tint);
    for(let i=0;i<p.count;i++) {
      dst.p.push(p.getX(i),p.getY(i),p.getZ(i)); dst.n.push(n.getX(i),n.getY(i),n.getZ(i));
      dst.uv.push(uv?.getX(i) ?? 0,uv?.getY(i) ?? 0); dst.c.push(color.r,color.g,color.b);
    }
    if (raw !== geometry) raw.dispose();
    geometry.dispose();
  }
  const origin=[0,0,0], unit=[1,1,1];
  function box(x,y,z,w,h,d,c,k='paint',rx=0,ry=0,rz=0) {
    append(new T.BoxGeometry(1,1,1),[x,y,z],[rx,ry,rz],[w,h,d],c,k);
  }
  function ball(x,y,z,w,h,d,c,k='rubber',rx=0,ry=0,rz=0) {
    append(new T.SphereGeometry(1,12,9),[x,y,z],[rx,ry,rz],[w/2,h/2,d/2],c,k);
  }
  function cyl(x,y,z,top,bottom,h,c,k='alloy',rx=0,ry=0,rz=0,sides=12) {
    append(new T.CylinderGeometry(top,bottom,h,sides),[x,y,z],[rx,ry,rz],unit,c,k);
  }
  function link(a,b,r1,r2,c,k='alloy',sides=10) {
    const v = new T.Vector3(...b).sub(new T.Vector3(...a)), len = v.length();
    const q = new T.Quaternion().setFromUnitVectors(new T.Vector3(0,1,0),v.normalize());
    const r = new T.Euler().setFromQuaternion(q);
    append(new T.CylinderGeometry(r2,r1,len,sides),a.map((v,i)=>(v+b[i])/2),[r.x,r.y,r.z],unit,c,k);
  }
  // Profile in the length/height plane, extruded across the width.
  function side(points,w,x,c,k='paint',b=.003) {
    const shape=new T.Shape();
    points.forEach(([z,y],i)=>i?shape.lineTo(-z,y):shape.moveTo(-z,y)); shape.closePath();
    const g=new T.ExtrudeGeometry(shape,{depth:Math.max(.0001,w-2*b),bevelEnabled:b>0,bevelSegments:1,steps:1,bevelThickness:b,bevelSize:b,curveSegments:2});
    g.translate(0,0,-(w-2*b)/2); g.rotateY(PI/2);
    append(g,[x,0,0],origin,unit,c,k);
  }
  // Stacked octagonal cross sections for asymmetric cast housings and armour.
  function shell(rings,c,k='paint') {
    const verts=[], uvs=[];
    const loops=rings.map(([y,x,z,w,d,cut=.21])=>{
      const a=w/2,b=d/2;
      return [[-a+cut*w,-b],[a-cut*w,-b],[a,-b+cut*d],[a,b-cut*d],[a-cut*w,b],[-a+cut*w,b],[-a,b-cut*d],[-a,-b+cut*d]].map(([i,j])=>[x+i,y,z+j]);
    });
    const tri=(a,b,c)=>{verts.push(...a,...b,...c);uvs.push(0,0,1,0,1,1)};
    for(let j=0;j<loops.length-1;j++) for(let i=0;i<8;i++){
      const n=(i+1)%8,a=loops[j],b=loops[j+1];
      tri(a[i],b[i],a[n]); tri(a[n],b[i],b[n]);
    }
    let a=loops[0],b=loops.at(-1);
    for(let i=1;i<7;i++){tri(a[0],a[i],a[i+1]);tri(b[0],b[i+1],b[i]);}
    const g=new T.BufferGeometry();
    g.setAttribute('position',new T.Float32BufferAttribute(verts,3));
    g.setAttribute('uv',new T.Float32BufferAttribute(uvs,2)); g.computeVertexNormals();
    append(g,origin,origin,unit,c,k);
  }
  function ring(z,y,outer,inner,depth,tint,kind='alloy'){
    const profile=[[inner,-depth/2],[outer-.002,-depth/2],[outer,-depth/2+.002],
      [outer,depth/2-.002],[outer-.002,depth/2],[inner,depth/2],[inner,-depth/2]];
    const geometry=new T.LatheGeometry(profile.map(([r,a])=>new T.Vector2(r,a)),48);
    append(geometry,[0,y,z],[PI/2,0,0],unit,tint,kind);
  }
  function finish() {
    for(const [kind,v] of parts) {
      const g=new T.BufferGeometry();
      for(const [name,attr,sz] of [['position','p',3],['normal','n',3],['uv','uv',2],['color','c',3]])
        g.setAttribute(name,new T.Float32BufferAttribute(v[attr],sz));
      g.computeBoundingSphere();
      const mesh=new T.Mesh(g,lib[kind]);
      mesh.castShadow=mesh.receiveShadow=shadow;
      group.add(mesh);
    }
  }
  return {box,ball,cyl,link,side,shell,ring,finish};
}

function stationStencil(T, group) {
  if (typeof document === 'undefined') return;
  const canvas=document.createElement('canvas');canvas.width=512;canvas.height=128;
  const c=canvas.getContext('2d'); if(!c) return;
  c.fillStyle='#313a38'; c.fillRect(0,0,512,128);
  c.strokeStyle='#92998b';c.lineWidth=4;c.strokeRect(6,6,500,116);
  c.fillStyle='#e0dbbf';c.font='bold 50px monospace';c.fillText('LOCKPORT',23,62);
  c.fillStyle='#c1c6af';c.font='24px monospace';c.fillText('AR-04    UNIT 017',23,100);
  c.fillStyle='#bf9e61';for(let i=0;i<13;i++)c.fillRect(346+i*10,24,i%3?4:7,59);
  const tex=new T.CanvasTexture(canvas);tex.colorSpace=T.SRGBColorSpace;
  const label=new T.Mesh(new T.PlaneGeometry(.102,.0255),new T.MeshStandardMaterial({map:tex,roughness:.58,metalness:.12,polygonOffset:true,polygonOffsetFactor:-2}));
  label.rotation.y=-PI/2;label.position.set(-.0501,.022,.052);group.add(label);
}

function buildCarbine(T,group) {
  const s=atelier(T,group);
  const tan=0x77796f, dark=0x363e3c, steel=0x626862, black=0x2e3432, rubber=0x353c34;
  // One continuous sloped receiver, a deep stock, and a ventilated fore-end.
  s.side([[.23,.049],[.18,.071],[-.197,.071],[-.24,.045],[-.231,-.028],[-.11,-.043],[-.085,-.076],[.095,-.07],[.138,-.035],[.226,-.027]],.093,0,tan);
  s.side([[.245,.052],[.192,.069],[.17,.049],[.176,-.028],[.23,-.046],[.294,-.108],[.357,-.105],[.357,.012]],.080,0,dark,'rubber');
  s.side([[.233,.026],[.30,.033],[.365,.01],[.366,-.114],[.314,-.11],[.286,-.068],[.23,-.047]],.089,0,tan,'paint');
  s.side([[.357,.014],[.385,.008],[.388,-.125],[.36,-.12]],.094,0,black,'rubber');
  for(let i=0;i<7;i++) s.box(0,-.11+i*.017,.383,.091,.004,.009,steel,'rubber');
  s.side([[.157,-.052],[.105,-.058],[.082,-.087],[.131,-.2],[.184,-.19],[.148,-.09]],.056,0,rubber,'rubber');
  const magGroup=new T.Group();magGroup.name='magazine';group.add(magGroup);
  const magazine=atelier(T,magGroup);
  magazine.side([[-.05,-.057],[-.136,-.052],[-.151,-.131],[-.156,-.179],[-.137,-.244],[-.068,-.24],[-.079,-.174]],.060,0,dark);
  magazine.side([[-.137,-.23],[-.146,-.243],[-.133,-.263],[-.063,-.253],[-.062,-.237]],.069,0,black,'rubber');
  for(let j=0;j<2;j++) for(let i=0;i<4;i++)
    magazine.box(j?.032:-.032,-.105-i*.033,-.109,.004,.005,.058,steel,'rubber',-.05);
  magazine.finish();
  s.side([[-.208,.065],[-.497,.058],[-.528,.037],[-.523,-.025],[-.485,-.049],[-.209,-.051]],.096,0,0x464c40);
  for(const sign of [-1,1]){
    const panel=[[.173,.061],[-.184,.061],[-.203,.05],[-.197,.007],[-.166,-.003],[.098,-.003],[.149,.008],[.172,.027]];
    s.side(panel,.003,sign*.0475,0x605f50,'paint',.0016);
    s.side([[.166,.06],[-.183,.06],[-.199,.049],[-.186,.05],[.153,.056]],.002,sign*.049,0xa6a28b,'alloy',.0005);
    // Narrow polished returns sit on the sloping edges of each worn casting.
    s.side([[.138,-.003],[.099,-.013],[-.082,-.013],[-.116,-.021],[.099,-.018],[.143,-.005]],.002,sign*.048,0x747565,'alloy',.0005);
    for(let i=0;i<9;i++) {
      const z=-.167+i*.033;
      if(i!==3 && i!==6)s.box(sign*.044,.072,z,.002,.0015,.006+(i%3)*.005,0xada894,'alloy');
    }
    for(let i=0;i<9;i++){
      const z=-.223-i*.032;
      s.side([[z,.039],[z-.021,.039],[z-.024,.022],[z-.004,.022]],.002,sign*.049,black,'rubber',0);
      s.box(sign*.048,-.019,z-.004,.005,.021,.008,0x5d6552,'rubber',-.22);
    }
    s.side([[-.031,.049],[-.116,.049],[-.124,.043],[-.124,.028],[-.116,.02],[-.031,.02],[-.024,.027],[-.024,.043]],.004,sign*.0505,0x777a69,'alloy',.001);
    s.side([[-.033,.045],[-.115,.045],[-.12,.041],[-.12,.030],[-.115,.025],[-.033,.025],[-.029,.03],[-.029,.041]],.002,sign*.0531,0x292d2b,'rubber',.0005);
    s.box(sign*.0547,.030,-.082,.0015,.003,.039,0x777b6c,'alloy');
    s.cyl(sign*.056,.038,-.050,.008,.008,.008,0x8b8f7e,'alloy',0,0,PI/2,14);
    s.box(sign*.05,-.030,.074,.008,.009,.022,steel,'alloy',.32);
    for(const z of [-.194,-.122,.123,.186,-.491]) {
      s.cyl(sign*.05,.002,z,.006,.006,.004,steel,'alloy',0,0,PI/2,8);
      s.box(sign*.053,.002,z,.001,.0012,.005,black,'alloy',.4);
    }
  }
  s.box(0,.072,-.158,.047,.011,.665,black,'alloy');
  for(let i=0;i<34;i++) {
    const z=.158-i*.0192;
    s.shell([[.077,0,z-.005,.043,.013],[.081,0,z-.005,.055,.012],[.087,0,z-.005,.051,.009],[.088,0,z-.005,.044,.007]],steel,'alloy');
    if(i%4!==0)s.box(-.024,.0875,z-.006,.0014,.0008,.004+(i%3)*.001,0xa7aa98,'alloy');
  }
  // Open, rounded optical housing. The sight stays readable against bright sky
  // and shadow. The thin inner rings reveal parallax as the optic comes up.
  const opticAxis=.155;
  s.box(0,.094,-.05,.070,.015,.091,black,'alloy');
  s.side([[.002,.098],[-.099,.098],[-.095,.117],[-.075,.134],[-.022,.134],[.005,.115]],.061,0,0x434b49,'alloy');
  s.ring(-.047,opticAxis,.042,.0335,.084,0x505955);
  s.ring(-.094,opticAxis,.044,.0332,.024,0x3c4543);
  s.ring(.001,opticAxis,.043,.0327,.020,0x333a39);
  s.ring(.010,opticAxis,.0415,.0333,.0055,0x737b73);
  s.ring(.007,opticAxis,.0336,.0328,.004,0x2a3231);
  for(const z of [-.095,-.09,-.085,-.064,-.059])s.ring(z,opticAxis,.0443,.043,.0035,0x626b63);
  // Thumb dial and optical trim show a smooth silhouette at arm's length.
  s.cyl(-.048,.157,-.049,.017,.018,.029,0x48514e,'alloy',0,0,PI/2,28);
  s.cyl(-.065,.157,-.049,.018,.018,.01,0x3b4342,'rubber',0,0,PI/2,28);
  for(let i=0;i<17;i++){const a=i/17*2*PI;
    s.box(-.064,.157+.0178*Math.sin(a),-.049+.0178*Math.cos(a),.008,.002,.0035,0x606660,'alloy',-a);}
  s.cyl(.043,.148,-.045,.012,.012,.015,0x646c62,'alloy',0,0,PI/2,24);
  s.cyl(0,.199,-.055,.013,.013,.015,0x4a514b,'alloy',0,0,0,24);
  for(let i=0;i<7;i++)s.box(-.022+i*.007,.19,-.085,.0014,.0008,.004,0xadaa8d,'alloy');
  s.box(-.033,.104,-.05,.005,.010,.053,0x282f2c,'rubber');
  for(const z of [-.070,-.034]){
    s.cyl(-.039,.106,z,.006,.006,.010,0x788074,'alloy',0,0,PI/2,10);
    s.box(-.0444,.106,z,.0013,.0016,.006,0x292c27,'rubber',.55);
  }
  for(let i=0;i<5;i++)s.cyl(0,.003,-.527-i*.016,.023-i*.0014,.023-i*.0014,.019,i%2?black:steel,'alloy',PI/2);
  s.cyl(0,.003,-.667,.015,.016,.17,steel,'alloy',PI/2);
  s.cyl(0,.003,-.75,.022,.023,.075,dark,'alloy',PI/2);
  for(let i=0;i<6;i++){
    const a=2*PI*i/6;
    s.box(Math.cos(a)*.022,.003+Math.sin(a)*.022,-.759,.005,.005,.03,black,'rubber',0,0,a);
  }
  s.cyl(0,.003,-.789,.014,.014,.002,black,'rubber',PI/2);
  s.box(.054,-.011,-.355,.032,.040,.17,black,'alloy');
  s.cyl(.075,-.001,-.39,.030,.027,.115,0x545b4e,'alloy',PI/2);
  s.cyl(.075,-.001,-.448,.024,.024,.012,0x788d83,'alloy',PI/2);
  // Folds around a tapered sleeve and segmented glove knuckles silhouette both arms.
  function sleeve(s,a,b,r1,r2){
    const av=new T.Vector3(...a),bv=new T.Vector3(...b),dir=bv.clone().sub(av).normalize();
    const side=new T.Vector3(1,0,0).cross(dir).normalize(),up=dir.clone().cross(side);
    const knots=[[0,1],[.20,.96],[.27,1.06],[.34,.96],[.47,1.016],[.62,.96],[.69,1.04],[.75,.935],[.84,1.025],[.90,.93],[1,.94]];
    const radial=(t)=>{
      for(let i=1;i<knots.length;i++)if(t<=knots[i][0]+.00001){
        const [t0,v0]=knots[i-1],[t1,v1]=knots[i];
        return (r1+(r2-r1)*t)*(v0+(v1-v0)*(t-t0)/(t1-t0));
      }
      return r2*.94;
    };
    const center=t=>av.clone().lerp(bv,t);
    const on=(t,angle,extra=0)=>center(t).addScaledVector(side,(radial(t)+extra)*Math.cos(angle)).addScaledVector(up,(radial(t)+extra)*Math.sin(angle)).toArray();
    for(let i=1;i<knots.length;i++) {
      const t0=knots[i-1][0], t1=knots[i][0];
      s.link(center(t0).toArray(),center(t1).toArray(),radial(t0),radial(t1),0x575b50,'textile',20);
    }
    for(const angle of [-.53,-.45])for(let i=1;i<knots.length;i++){
      const t0=knots[i-1][0],t1=knots[i][0];
      s.link(on(t0,angle,.001),on(t1,angle,.001),.0018,.0018,0x333b34,'textile',5);
    }
    // Topstitching follows the two curved reinforcement seams and the wrist binding.
    for(let i=0;i<40;i++) {
      const t=.31+i*.016;
      s.link(on(t,-.49,.002),on(t+.008,-.49,.002),.001,.001,0x777a63,'textile',4);
    }
    const cuffStart=.87,cuffEnd=.955;
    s.link(center(cuffStart).toArray(),center(cuffEnd).toArray(),radial(cuffStart)+.004,radial(cuffEnd)+.0035,0x373e36,'textile',20);
    for(const t of [.873,.944])s.link(center(t).toArray(),center(t+.008).toArray(),radial(t)+.0046,radial(t+.008)+.0046,0x646a58,'textile',20);
  }
  const supportGroup=new T.Group();supportGroup.name='supportArm';group.add(supportGroup);
  const support=atelier(T,supportGroup);
  sleeve(support,[-.22,-.35,.22],[-.105,-.117,-.297],.081,.050);
  support.link([-.116,-.135,-.266],[-.098,-.105,-.313],.06,.054,black,'textile');
  support.ball(-.078,-.079,-.337,.113,.108,.146,0x484a3c,'textile',-.35,-.24);
  support.ball(-.11,-.068,-.34,.054,.077,.101,0x312f29,'rubber',-.35,-.24);
  for(let i=0;i<3;i++){
    const x=-.128+i*.012;
    support.ball(x,-.053-i*.002,-.307-i*.009,.014,.024,.055,0x313731,'rubber',-.4,-.18,-.25);
    support.link([x-.005,-.042-i*.002,-.301-i*.009],[x-.002,-.04-i*.002,-.326-i*.009],.0016,.0014,0x8a8770,'textile',5);
  }
  for(let i=0;i<4;i++){
    const z=-.29-i*.029;
    support.ball(-.052,-.08,z,.087,.035,.031,0x4d4d3e,'textile',-.2,0,.28);
    support.ball(-.076,-.066,z-.005,.034,.032,.026,0x30332a,'rubber');
    support.ball(.005,-.066,z-.009,.035,.036,.029,0x37382e,'rubber',0,0,.4);
  }
  support.ball(-.065,-.02,-.336,.042,.050,.13,0x5a5946,'textile',-.21,-.25);
  support.ball(-.06,-.01,-.387,.029,.029,.052,0x35382c,'rubber',-.21,-.25);
  support.ball(-.068,-.002,-.336,.034,.024,.068,0x393e34,'rubber',-.25,-.18,-.16);
  for(let i=0;i<4;i++)support.box(-.069,-.003+i*.0009,-.313-i*.011,.029,.006,.0035,0x787964,'rubber',-.2,-.18,-.23);
  for(let i=0;i<3;i++)support.ball(-.119+i*.002,-.049,-.318-i*.026,.032,.029,.029,0x555b4b,'rubber',.05,-.22,-.28);
  support.finish();
  sleeve(s,[.219,-.36,.39],[.083,-.142,.148],.102,.060);
  s.link([.107,-.18,.19],[.079,-.136,.14],.065,.061,black,'textile');
  s.ball(.063,-.118,.124,.109,.122,.14,0x514f3d,'textile',-.42,0,-.28);
  for(let i=0;i<3;i++)s.ball(.008,-.117-i*.02,.101,.078,.028,.04,0x414033,'rubber',-.23,.12,.05);
  s.ball(.046,-.067,.052,.027,.031,.108,0x545242,'textile',-.10,-.14);
  s.finish();stationStencil(T,group);
}

function flashTexture(T){
  const size=96,bytes=new Uint8Array(size*size*4);
  for(let y=0;y<size;y++)for(let x=0;x<size;x++){
    const xx=(x+.5)/size*2-1,yy=(y+.5)/size*2-1,r=Math.hypot(xx,yy);
    const a=Math.atan2(yy,xx),tip=.20+.59*Math.pow(.5+.5*Math.sin(5*a+1.2*Math.sin(3*a)),4);
    const i=4*(x+y*size),core=Math.exp(-r*r*46);
    bytes[i]=255;bytes[i+1]=130+125*core;bytes[i+2]=43+212*core;
    bytes[i+3]=255*Math.min(1,core+.78*Math.pow(Math.max(0,1-r/tip),2.1));
  }
  const tex=new T.DataTexture(bytes,size,size,T.RGBAFormat);tex.colorSpace=T.SRGBColorSpace;
  tex.magFilter=tex.minFilter=T.LinearFilter;tex.needsUpdate=true;return tex;
}

const opticAxis=.155;
export function createWeapon(T,scene,worldScene){
  const group=new T.Group();scene.add(group);
  let support,magazine,rig,sightDepth=-.061;
  if(worldScene?.environmentRotation)scene.environmentRotation.copy(worldScene.environmentRotation);
  let worldKey,worldHemi;
  worldScene?.traverse(o=>{
    if(o.isDirectionalLight&&(!worldKey||worldKey.intensity<o.intensity))worldKey=o;
    if(o.isHemisphereLight)worldHemi=o;
  });
  const hemi=new T.HemisphereLight(worldHemi?.color??0xd8e4e6,worldHemi?.groundColor??0x67665c,worldHemi?.intensity??1.12);
  // The equipment is rendered in its own camera. Rotate exterior lights into the
  // view frame to keep bright rims on the same side as the environment.
  const sun=new T.DirectionalLight(worldKey?.color??0xffdda8,worldKey?.intensity??3.1);
  const sunPower=sun.intensity,lightDir=new T.Vector3(-34,45,22);
  if(worldKey)lightDir.copy(worldKey.position).sub(worldKey.target.position);
  const bounce=new T.DirectionalLight(0xb2c3cb,.76),bounceDir=new T.Vector3(.46,.78,.63);
  const inv=new T.Quaternion(),lastView=new T.Quaternion(),delta=new T.Quaternion(),euler=new T.Euler(0,0,0,'YXZ');
  scene.add(hemi,sun,bounce);
  const muzzle=new T.Object3D();muzzle.position.set(0,.003,-.8);group.add(muzzle);
  const flare=new T.Sprite(new T.SpriteMaterial({map:flashTexture(T),color:0xffffff,transparent:true,
    blending:T.AdditiveBlending,depthWrite:false,toneMapped:false}));
  muzzle.add(flare);flare.visible=false;
  const lens=new T.Mesh(new T.CircleGeometry(.0329,48),new T.ShaderMaterial({
    transparent:true,depthWrite:false,side:T.DoubleSide,
    vertexShader:'varying vec2 lensUv;void main(){lensUv=uv-.5;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}',
    fragmentShader:`varying vec2 lensUv;void main(){
      float r=length(lensUv)*2.;float edge=smoothstep(.42,.99,r);
      float sheen=exp(-pow((lensUv.x*.68+lensUv.y-.24)*5.8,2.));
      vec3 c=mix(vec3(.14,.32,.30),vec3(.63,.38,.20),sheen*.75);
      gl_FragColor=vec4(c,.048+edge*.19+sheen*.082);
      #include <colorspace_fragment>
    }`
  }));
  lens.position.set(0,opticAxis,-.08);group.add(lens);
  const reticle=new T.Mesh(new T.CircleGeometry(.00124,20),new T.MeshBasicMaterial({color:0xff5436,toneMapped:false,depthWrite:false}));
  const halo=new T.Mesh(new T.RingGeometry(.0025,.0031,28,1,.14,.81*PI),new T.MeshBasicMaterial({color:0xff6745,toneMapped:false,transparent:true,opacity:.75,depthWrite:false}));
  reticle.add(halo);group.add(reticle);reticle.renderOrder=3;
  const localEye=new T.Vector3(),sightDir=new T.Vector3();
  const clamp=T.MathUtils.clamp;
  let stride=0,strafe=0,turnX=0,turnY=0,ring=0,ringVelocity=0,prevFire=0,flashTime=0,shotNo=0;
  let phase=0,camReady=false,airTilt=0,landDip=0,lastShot;
  const ready=equipment(T).then(asset=>{
    rig=mountWeapon(T,group,{held:cloneSkin(asset.held),sight:asset.sight.clone(true)},muzzle,lens,opticAxis);
    sightDepth=rig.back-.008;
  }).catch(error=>{
    console.warn('Using the built-in viewmodel.',error);buildCarbine(T,group);
    support=group.getObjectByName('supportArm');magazine=group.getObjectByName('magazine');
  });
  // Smooth envelopes maintain continuity at each grip change and at the end of reload.
  const between=(p,start,end)=>{const u=clamp((p-start)/(end-start),0,1);return u*u*(3-2*u)};
  function update(dt,v={}){
    const {time=0,ads=0,fire=0,reload=0,walk=0,sprint=0,crouch=0}=v;
    const reset=dt>.25;
    sun.intensity=sunPower*(v.sunVisibility??1);
    if(reset){turnX=turnY=ring=ringVelocity=stride=strafe=flashTime=prevFire=phase=airTilt=landDip=0;lastShot=v.shots;camReady=false}
    const step=Math.min(.08,Math.max(.0001,dt));
    if(v.viewRotation){
      inv.copy(v.viewRotation).invert();
      sun.position.copy(lightDir).applyQuaternion(inv);
      bounce.position.copy(bounceDir).applyQuaternion(inv);
      hemi.position.set(0,1,0).applyQuaternion(inv);
      if(camReady){
        delta.copy(lastView).invert().multiply(v.viewRotation);euler.setFromQuaternion(delta);
        turnX=clamp(turnX+euler.y*.38,-.058,.058);
        turnY=clamp(turnY+euler.x*.34,-.044,.044);
      }
      lastView.copy(v.viewRotation);camReady=true;
    }
    turnX*=Math.exp(-step*12);turnY*=Math.exp(-step*12);
    const aim=clamp(ads,0,1),hip=1-aim,run=clamp(sprint,0,1)*hip;
    const ease=1-Math.exp(-step*16);
    stride+=(walk-stride)*ease;strafe+=((v.strafe||0)-strafe)*ease;
    phase=v.stepPhase??(phase+step*(7.3+run*3.2)*stride);
    if(v.shots!==undefined?(lastShot!==undefined && v.shots>lastShot):fire>prevFire+.15){
      ++shotNo;flashTime=.036;ringVelocity+=1.90*(1-.43*aim);
      flare.material.rotation=(shotNo*2.39996)%(2*PI);
    }
    prevFire=fire;lastShot=v.shots;
    // Closed-form damped spring stays stable at low render rates.
    const decay=Math.exp(-20*step),sn=Math.sin(31*step),cs=Math.cos(31*step);
    const old=ring,v0=ringVelocity;
    ring=decay*(old*cs+(v0+20*old)/31*sn);
    ringVelocity=decay*(v0*cs-(20*v0+1361*old)/31*sn);
    flare.visible=flashTime>0;flare.scale.setScalar(.175+(shotNo%3)*.024);flashTime-=step;

    const grip=between(reload,0,.21)-between(reload,.80,1);
    const handOff=between(reload,.09,.34)-between(reload,.74,.92);
    const pull=between(reload,.28,.46)-between(reload,.53,.73);
    const seat=Math.sin(PI*between(reload,.68,.82));
    if(rig)rig.reload(handOff,pull,seat);
    else if(support){
      support.position.set(.046*handOff,-.010*handOff-.108*pull,.205*handOff);
      support.rotation.set(-.17*handOff+.09*pull,-.08*handOff,.14*handOff);
      magazine.position.set(-.042*pull,-.202*pull+.005*seat,.048*pull);
      magazine.rotation.set(-.22*pull,0,-.14*pull);
    }
    const side=Math.sin(phase)*stride,up=Math.cos(phase*2)*stride;
    const lean=clamp(v.lean||0,-1,1);
    airTilt+=(clamp((v.verticalVelocity||0)/6,-1,1)-airTilt)*(1-Math.exp(-step*9));
    landDip+=((v.landing||0)-landDip)*(1-Math.exp(-step*20));
    const motion=(1-.86*aim)*(1-.40*crouch);
    group.position.set(
      .137*hip+.0065*side*motion+.006*lean*hip+.039*turnX*(1-.55*aim)-.009*strafe*hip-.066*grip-.025*run,
      -.213*hip-opticAxis*aim+.010*airTilt-.020*landDip+.0045*up*motion+.0019*Math.sin(time*1.65)*hip+.022*grip-.045*run,
      -.471+.121*aim+ring*.84+.049*grip-.025*run);
    group.rotation.set(
      .025*hip+.050*airTilt-.077*landDip-turnY*(1-.51*aim)+ring*1.70+.125*grip-.024*seat-.13*run,
      .085*hip-turnX*(1-.51*aim)+.022*strafe*hip+.005*side*motion-.41*grip+.30*run,
      -.104*hip-.036*lean*(1-.78*aim)-.020*strafe*(1-.78*aim)-turnX*.22+.010*side*motion+.86*grip-.15*run+ring*.19);
    // Project the glass dot along the gameplay camera ray. A moving optic admits
    // parallax while the glowing dot points at the same target as game hits.
    inv.copy(group.quaternion).invert();localEye.copy(group.position).multiplyScalar(-1).applyQuaternion(inv);
    sightDir.set(0,0,-1).applyQuaternion(inv);
    const z=sightDepth,t=(z-localEye.z)/sightDir.z;
    reticle.position.copy(localEye).addScaledVector(sightDir,t);
    reticle.visible=aim>.63&&Math.hypot(reticle.position.x,reticle.position.y-opticAxis)<.0309;
  }
  update(1,{});
  return {group,muzzle,update,ready};
}

function patrolTemplate(T) {
  if (patrolTemplates.has(T)) return patrolTemplates.get(T);
  const rig=new T.Group(), body=new T.Group(); body.name='body';rig.add(body);
  const s=atelier(T,body,true);
  const dark=0x242a28, rubber=0x363a34, shell=0x5f695d, pale=0x879083, ochre=0xab6b2c, steel=0x7e8680, light=0xff9629;
  // Upper chassis, impact plates, textile seals, and a vented battery pack.
  s.shell([[.87,0,0,.33,.21],[.98,0,0,.42,.27],[1.1,0,0,.36,.26]],dark,'rubber');
  for(let i=0;i<3;i++)s.shell([[1.02+i*.043,0,.004,.36,.245],[1.046+i*.043,0,.004,.37,.25]],0x535b4e,'rubber');
  s.shell([[1.12,0,0,.38,.26],[1.34,0,-.01,.52,.31],[1.48,0,-.015,.55,.29],[1.54,0,-.01,.34,.23]],shell);
  s.shell([[1.16,0,.104,.31,.11],[1.36,0,.109,.46,.16],[1.45,0,.105,.43,.12],[1.47,0,.1,.31,.10]],0x70796a);
  s.box(0,1.36,.188,.116,.039,.010,dark);
  for(let i=0;i<4;i++)s.box(-.042+i*.028,1.361,.194,.014,.007,.005,i===3?light:steel,i===3?'glow':'alloy');
  // Straps, webbing and staggered utility pouches break up the chest silhouette.
  for(let row=0;row<3;row++) for(let col=0;col<5;col++){
    const x=(col-2)*.066,y=1.25+row*.041;
    s.box(x,y,.188,.046,.016,.010,0x59604d,'textile');
  }
  for(let j=0;j<3;j++){
    const x=(j-1)*.128;
    s.shell([[1.065,x,.144,.114,.071],[1.09,x,.161,.126,.103],
      [1.211,x,.161,.12,.092],[1.22,x,.148,.103,.075]],0x535e4f,'textile');
    s.ball(x,1.19,.202,.115,.060,.028,0x64715e,'textile',-.10);
    s.box(x,1.172,.218,.019,.025,.006,0x959781,'alloy');
  }
  s.box(-.111,1.414,.171,.112,.039,.007,0x473f32,'rubber');
  for(let j=0;j<3;j++)s.box(-.143+j*.023,1.414,.177,.009,.023,.004,0xd2ab64,'paint',0,0,-.3);
  s.ball(-.223,1.19,-.078,.128,.225,.157,0x4e594c,'textile',.18,.10,.10);
  s.shell([[1.30,-.21,-.078,.067,.065],[1.43,-.196,-.06,.098,.091],[1.45,-.19,-.06,.089,.068]],0x383f39,'rubber');
  s.link([-.21,1.431,-.081],[-.241,1.641,-.089],.008,.004,0x545d54,'rubber');
  for(const sign of [-1,1]){
    s.box(sign*.172,1.3,.162,.044,.26,.035,rubber,'textile',-.05,0,sign*-.20);
    s.box(sign*.158,1.27,.185,.056,.046,.02,steel,'alloy',-.08,0,sign*-.20);
    s.box(sign*.173,1.38,.184,.049,.021,.01,ochre,'paint',-.05,0,sign*-.20);
    s.box(sign*.108,1.146,.156,.111,.118,.064,0x474f40,'textile',-.04,0,sign*.065);
    s.box(sign*.108,1.178,.19,.113,.036,.012,0x616753,'textile');
    s.box(sign*.182,.984,.096,.091,.103,.097,0x565c49,'textile');
  }
  s.shell([[1.13,0,-.147,.32,.15],[1.24,0,-.167,.39,.18],[1.45,0,-.16,.35,.20],[1.495,0,-.142,.29,.14]],dark);
  for(let i=0;i<6;i++)s.box(0,1.22+i*.035,-.255,.223,.013,.013,steel,'alloy');
  s.cyl(0,1.536,0,.091,.1,.12,steel,'rubber');
  const head=new T.Group();head.position.set(0,1.565,0);head.name='head';body.add(head);
  const h=atelier(T,head,true);
  // Fabric collar and curved visor sit beneath a continuous rolled helmet rim.
  h.ball(0,.055,.006,.204,.157,.190,0x3f463f,'textile');
  h.ball(0,.142,-.010,.259,.208,.243,0x68725e,'paint',-.10);
  h.ball(0,.106,.079,.225,.106,.127,0x2b3738,'alloy',-.13);
  h.shell([[.131,0,.044,.259,.163],[.143,0,.042,.269,.194],[.157,0,.031,.254,.157]],0x7b8270);
  h.shell([[.018,0,.056,.099,.108],[.034,0,.065,.144,.13],[.064,0,.065,.198,.138],
     [.081,0,.077,.193,.117]],0x4d5750,'rubber');
  for(let j=0;j<4;j++)h.box(-.052+j*.034,.058,.135,.017,.019,.008,0x252e2d,'rubber',-.14);
  h.box(-.022,.110,.145,.135,.012,.005,light,'glow');h.box(-.068,.110,.149,.018,.016,.003,0xffcb78,'glow');
  h.box(.066,.109,.139,.039,.011,.005,0xc2a467,'alloy');
  h.box(0,.191,.108,.064,.054,.027,0x4d554a,'paint',-.24);
  h.box(0,.192,.121,.038,.027,.008,0x353c37,'rubber',-.24);
  for(const sign of [-1,1]) {
    h.cyl(sign*.122,.108,-.015,.056,.05,.031,dark,'rubber',0,0,PI/2);
    h.cyl(sign*.139,.108,-.015,.031,.032,.006,ochre,'paint',0,0,PI/2,8);
  }
  h.link([-.104,.161,-.07],[-.117,.257,-.086],.007,.004,steel,'alloy');h.finish();
  for(const sign of [-1,1]) {
    const x=sign*.29;
    s.ball(x,1.427,-.002,.207,.209,.201,rubber);
    s.shell([[1.333,x,0,.165,.204],[1.422,x,0,.208,.258],[1.489,x,-.008,.167,.212],[1.511,x,-.011,.123,.144]],sign===1?ochre:shell);
    s.box(x,1.42,.128,.101,.019,.007,0xc0baa0);
    const elbow=sign>0?[.351,1.204,-.011]:[-.304,1.113,.066];
    const wrist=sign>0?[.153,1.204,.186]:[.007,1.227,.395];
    s.link([x,1.35,0],elbow,.091,.072,0x53604e,'textile',16);
    s.ball(sign*.317,1.28,.013,.154,.193,.158,0x606b57,'textile',.12,0,sign*-.15);
    s.cyl(elbow[0],elbow[1],elbow[2],.066,.059,.11,steel,'alloy',0,0,PI/2,12);
    s.link(elbow,wrist,.073,.059,dark,'rubber');
    const fore=elbow.map((v,j)=>v+(wrist[j]-v)*.24);
    const cuff=elbow.map((v,j)=>v+(wrist[j]-v)*.74);
    s.link(fore,cuff,.080,.067,sign===1?shell:pale,'paint',12);
    s.ball(...wrist,.12,.11,.14,dark,'rubber',.2);
  }
  // Compact pulse emitter carried across the torso.
  s.box(.116,1.247,.291,.083,.089,.345,dark,'alloy',.03,-.26);
  s.box(.11,1.267,.325,.091,.056,.221,shell,'paint',.03,-.26);
  s.box(.162,1.259,.138,.075,.084,.18,0x586153,'paint',.02,-.26);
  s.box(.162,1.216,.133,.059,.084,.095,dark,'rubber',.12,-.26);
  s.link([.099,1.25,.373],[.050,1.253,.567],.027,.021,dark,'alloy');
  s.link([.059,1.254,.53],[.043,1.253,.588],.031,.03,steel,'alloy');
  s.box(.143,1.198,.202,.049,.105,.058,rubber,'rubber',-.26,-.26);
  s.cyl(.138,1.304,.244,.025,.025,.073,dark,'alloy',PI/2,-.26);
  s.finish();
  for(const sign of [-1,1]){
    const leg=new T.Group();leg.name=sign<0?'legL':'legR';leg.position.set(sign*.133,.919,0);rig.add(leg);
    const l=atelier(T,leg,true);
    l.ball(0,-.035,0,.175,.170,.170,dark);
    l.link([0,-.045,0],[sign*.022,-.385,.016],.082,.066,rubber,'rubber');
    l.shell([[-.369,sign*.018,.003,.132,.142],[-.244,sign*.01,.012,.171,.183],[-.107,0,.002,.188,.199],[-.075,0,.002,.146,.154]],shell);
    l.box(sign*.087,-.17,.017,.021,.126,.103,ochre,'paint',.05,0,sign*.067);
    l.finish();
    const knee=new T.Group();knee.name=sign<0?'kneeL':'kneeR';knee.position.set(0,-.414,.011);leg.add(knee);
    const shinGroup=new T.Group();shinGroup.position.set(0,.414,-.011);knee.add(shinGroup);
    const shin=atelier(T,shinGroup,true);
    shin.cyl(sign*.02,-.414,.011,.074,.074,.157,steel,'alloy',0,0,PI/2);
    shin.shell([[-.487,sign*.02,.046,.116,.096],[-.433,sign*.019,.06,.17,.146],[-.365,sign*.02,.053,.119,.119]],pale);
    shin.link([sign*.02,-.471,0],[sign*.029,-.764,-.012],.063,.045,dark,'rubber');
    shin.shell([[-.787,sign*.03,.013,.101,.119],[-.621,sign*.031,.023,.142,.147],[-.496,sign*.024,.021,.134,.136]],shell);
    shin.link([sign*.084,-.49,-.032],[sign*.074,-.75,-.035],.015,.011,steel,'alloy');
    shin.box(sign*.026,-.581,.096,.049,.018,.008,ochre);
    shin.ball(sign*.031,-.804,0,.108,.105,.108,dark);
    shin.shell([[-.912,sign*.032,.037,.158,.278],[-.864,sign*.032,.037,.158,.279],[-.807,sign*.031,.009,.124,.162]],dark,'rubber');
    shin.box(sign*.032,-.867,.132,.126,.047,.069,shell,'paint',-.11);shin.finish();
  }
  patrolTemplates.set(T,rig);return rig;
}

function createFallbackGuard(T,scene,index=0) {
  const group=new T.Group(),rig=patrolTemplate(T).clone(true);group.add(rig);scene.add(group);
  const body=rig.getObjectByName('body'),head=rig.getObjectByName('head');
  const left=rig.getObjectByName('legL'),right=rig.getObjectByName('legR'),hitMeshes=[];
  rig.traverse(n=>{if(n.isMesh)hitMeshes.push(n)});
  const kneeL=rig.getObjectByName('kneeL'),kneeR=rig.getObjectByName('kneeR');
  let stride=0,collapse=0;
  function update(dt,v={}) {
    const {time=0,moving=0,hit=0,dead=false}=v;
    stride+=(Number(moving)-stride)*(1-Math.exp(-10*dt));
    collapse=dead?Math.min(1,collapse+dt*2.6):0;
    const cycle=time*6.8+index*2.31,step=Math.sin(cycle)*.35*stride;
    left.rotation.x=step;right.rotation.x=-step;
    kneeL.rotation.x=.055+Math.max(0,Math.cos(cycle))*.43*stride;
    kneeR.rotation.x=.055+Math.max(0,-Math.cos(cycle))*.43*stride;
    left.position.y=.917+Math.max(0,Math.cos(cycle))*.016*stride;
    right.position.y=.917+Math.max(0,-Math.cos(cycle))*.016*stride;
    body.position.y=(Math.cos(cycle*2)*.016-.012)*stride+Math.sin(time*2+index)*.002;
    body.rotation.set(-Number(hit)*.13,Math.sin(cycle)*.035*stride,Math.sin(cycle)*.023*stride);
    head.rotation.y=Math.sin(time*1.7+index)*.075*(1-stride);
    const fall=collapse*collapse*(3-2*collapse);
    rig.rotation.z=(index%2===0?1:-1)*1.53*fall;rig.rotation.x=.24*fall;
    rig.position.y=.28*fall;
  }
  return {group,update,hitMeshes};
}

const guardSources=new WeakMap(),guardEquipment=new WeakMap();

function guardSource(T){
  if(!guardSources.has(T)){
    const src=import('./actor-assets/loader.js').then(async({GLTFLoader})=>{
      const gltf=await new GLTFLoader().loadAsync(new URL('./actor-assets/guard.glb',import.meta.url).href);
      const source=gltf.scene,clips=new Map(gltf.animations.map(a=>[a.name,a]));
      // Calibrate to the actual upright pose, including the sole and cap, independently
      // of the file's authoring units. This binds the visual body to gameplay's capsule.
      const mixer=new T.AnimationMixer(source);
      for(const key of ['upper','idle'])mixer.clipAction(clips.get(key)).play();
      mixer.update(0);source.updateMatrixWorld(true);
      const contacts=bootContacts(T,source);
      const bounds=new T.Box3().setFromObject(source,true);
      const height=bounds.max.y-bounds.min.y,scale=1.80/height;
      let hips;source.traverse(o=>{if(o.isBone&&o.name.startsWith('mixamorigHips'))hips=o});
      const mount=hips.getWorldPosition(new T.Vector3());
      mixer.stopAllAction();
      const collapse=clips.get('death'),fall=mixer.clipAction(collapse);
      fall.setLoop(T.LoopOnce,1);fall.clampWhenFinished=true;fall.play();
      mixer.update(collapse.duration);source.updateMatrixWorld(true);
      const fallLift=(bounds.min.y-new T.Box3().setFromObject(source,true).min.y)*scale;
      mixer.stopAllAction();mixer.uncacheRoot(source);
      return {source,clips,scale,fallLift,contacts,offset:new T.Vector3(-mount.x,-bounds.min.y,-mount.z).multiplyScalar(scale)};
    });
    guardSources.set(T,src);
  }
  return guardSources.get(T);
}

function cloneSkin(source){
  const root=source.clone(true),pair=new Map();
  const mapChildren=(a,b)=>{pair.set(a,b);a.children.forEach((c,i)=>mapChildren(c,b.children[i]))};
  mapChildren(source,root);
  source.traverse(o=>{
    if(!o.isSkinnedMesh)return;
    const target=pair.get(o),skin=o.skeleton.clone();
    skin.bones=o.skeleton.bones.map(b=>pair.get(b));target.bind(skin,o.bindMatrix);
    target.castShadow=false;target.receiveShadow=true;target.frustumCulled=false;
  });
  return root;
}

function carriedEquipment(T){
  if(!guardEquipment.has(T)){
    const group=new T.Group(),a=atelier(T,group);
    a.side([[-.22,.065],[-.16,.088],[.21,.082],[.27,.057],[.25,-.010],[.04,-.028],[-.025,-.058],[-.14,-.041],[-.22,-.012]],.078,0,0x454a43,'paint');
    a.side([[-.21,.053],[-.33,.062],[-.36,.042],[-.36,-.082],[-.32,-.08],[-.25,-.025],[-.20,-.019]],.076,0,0x353b36);
    a.side([[.027,-.018],[.113,-.021],[.107,-.135],[.077,-.18],[.012,-.15]],.054,0,0x353a33);
    a.side([[.112,.071],[.297,.065],[.319,.049],[.311,-.003],[.105,-.012]],.079,0,0x536153);
    a.link([0,.029,.29],[0,.029,.445],.018,.014,0x3c4240,'paint',12);
    a.cyl(0,.029,.438,.020,.019,.065,0x3e4642,'paint',PI/2);
    a.box(0,.095,.012,.042,.040,.073,0x373d39);
    for(const sign of [-1,1]){
      for(let j=0;j<5;j++)a.box(.040*sign,.041,.138+j*.03,.003,.015,.022,0x2d3432);
      a.box(.041*sign,.031,-.118,.003,.019,.047,0xc68942);
    }
    a.finish();guardEquipment.set(T,group);
  }
  return guardEquipment.get(T).clone(true);
}

function rigGuard(T,group,asset,prop,index){
  const model=cloneSkin(asset.source),alignment=new T.Group(),weapon=new T.Group();
  alignment.add(model);group.add(alignment,weapon);model.scale.setScalar(asset.scale);model.position.copy(asset.offset);
  if(prop){
    const carried=prop.clone(true);
    carried.scale.setScalar(.50);carried.rotation.y=PI;
    carried.position.set(0,-.006,.1475);weapon.add(carried);
  } else weapon.add(carriedEquipment(T));
  const bones={};
  model.traverse(o=>{if(o.isBone)bones[o.name.replace(/^mixamorig/,'').replace(/_0[0-9]+$/,'')]=o});
  const mix=new T.AnimationMixer(model),actions={};
  for(const [name,clip] of asset.clips){
    const action=mix.clipAction(clip);
    if(name==='death'){action.setLoop(T.LoopOnce,1);action.clampWhenFinished=true;}
    else{action.play();action.paused=true;}
    action.setEffectiveWeight(name==='idle'||name==='upper'?1:0);actions[name]=action;
  }
  const directions=['F','B','L','R'],weights={F:0,B:0,L:0,R:0};
  const speeds={F:1.1733,B:.7285,L:.7455,R:.7148};
  const feet=['Left','Right'].map(side=>plantedLeg(T,bones,side,asset.contacts[side]));
  const previous=new T.Vector3(),left=new T.Vector3(),right=new T.Vector3(),turn=new T.Vector3();
  const inverse=new T.Matrix4(),up=new T.Vector3(0,1,0);
  const q=new T.Quaternion(),parentQ=new T.Quaternion(),localEuler=new T.Euler(0,0,0,'YXZ');
  const torso=[bones.Spine2,bones.Neck,bones.Head],rest=torso.map(b=>b.quaternion.clone());
  const dropPos=new T.Vector3(),dropQ=new T.Quaternion(),groundQ=new T.Quaternion();
  const smooth=T.MathUtils.smoothstep,clamp=T.MathUtils.clamp;
  let valid=false,deadBefore=false,phase=index*.193%1,lastYaw=0,lag=0,alert=0,dropped=false,upperAdjusted=false;
  function poseUpper(bone,rotation){
    q.setFromEuler(rotation);group.getWorldQuaternion(parentQ);q.premultiply(parentQ).multiply(parentQ.invert());
    bone.parent.getWorldQuaternion(parentQ);q.premultiply(parentQ.invert()).multiply(parentQ.invert());
    bone.quaternion.premultiply(q);bone.updateWorldMatrix(false,false);
  }
  function update(dt,state={}){
    const {dead=false,moving=0,hit=0,firing=0,time=0}=state;
    const reset=!valid||dt===0||previous.distanceToSquared(group.position)>1;
    if(reset){phase=index*.193%1;lag=alert=0;lastYaw=group.rotation.y;}
    if(dead!==deadBefore){
      if(dead)actions.death.reset().setEffectiveWeight(0).play();
      else{actions.death.stop();dropped=false;}
      deadBefore=dead;
    }
    for(const leg of feet)leg.restore();
    if(upperAdjusted)torso.forEach((bone,i)=>bone.quaternion.copy(rest[i]));
    const deltaYaw=T.MathUtils.euclideanModulo(group.rotation.y-lastYaw+PI,2*PI)-PI;
    lag=clamp((lag+deltaYaw)*Math.exp(-dt*6.8),-.52,.52);
    lastYaw=group.rotation.y;
    const turnRate=dt>0?Math.abs(deltaYaw/dt):0;
    turn.subVectors(group.position,previous).applyAxisAngle(up,-group.rotation.y);
    previous.copy(group.position);valid=true;
    const lateral=state.strafe??(reset?0:turn.x/dt),forward=state.forward??(reset?0:turn.z/dt);
    const speed=Math.min(1.8,Math.hypot(lateral,forward));
    const pivot=smooth(turnRate,.6,2.8)*(1-smooth(speed,.08,.45));
    const stride=Math.min(1,speed/.36)*Math.min(1,moving*5);
    const side=lateral+pivot*Math.sign(deltaYaw)*.52, sum=Math.max(.001,Math.abs(side)+Math.abs(forward));
    const influence=Math.max(stride,pivot*.59),ease=dt>0?1-Math.exp(-dt*16):1;
    const wanted=[Math.max(0,forward),Math.max(0,-forward),Math.max(0,side),Math.max(0,-side)];
    const life=dead?1-smooth(actions.death.time+dt,0,.20):1;
    let total=0,cycleRate=0;
    for(let i=0;i<directions.length;i++){
      const k=directions[i];weights[k]+=(influence*wanted[i]/sum-weights[k])*ease;total+=weights[k];
      cycleRate+=wanted[i]/sum/(speeds[k]*asset.clips.get(k).duration);
      actions[k].setEffectiveWeight(life*weights[k]);
    }
    phase=(phase+dt*Math.max(speed,.68*pivot)*cycleRate)%1;
    for(const k of directions)actions[k].time=phase*asset.clips.get(k).duration;
    actions.upper.setEffectiveWeight(life);actions.idle.setEffectiveWeight(life*Math.max(0,1-total));
    actions.death.setEffectiveWeight(1-life);mix.update(Math.max(0,dt));
    const fallProgress=actions.death.time/asset.clips.get('death').duration;
    alignment.position.y=dead?asset.fallLift*smooth(fallProgress,.23,.82):0;
    alignment.rotation.y=-lag*life;alignment.rotation.x=-hit*.029*life;alignment.rotation.z=0;
    group.updateWorldMatrix(true,false);inverse.copy(group.matrixWorld).invert();
    alert+=((state.alert?1:0)-alert)*(1-Math.exp(-dt*6));
    const inhale=Math.sin(time*2.1+index*1.18),sway=Math.sin(phase*PI*2)*total;
    upperAdjusted=life>0;
    if(upperAdjusted){
      torso.forEach((b,i)=>rest[i].copy(b.quaternion));
      poseUpper(torso[0],localEuler.set((-.020+.020*inhale-.09*firing-.08*hit)*life,
        (lag*.72+.031*sway)*life,(.013*sway+hit*(index%2?-.08:.08))*life));
      poseUpper(torso[1],localEuler.set((-.012*inhale+.026*firing)*life,
        (lag*.22+Math.sin(time*.94+index)*.075*(1-alert))*life,0));
      poseUpper(torso[2],localEuler.set((Math.cos(time*.78+index)*.021+.015*hit)*life,
        Math.sin(time*.73+index*.8)*(.088-.064*alert)*life,0));
    }
    const cycle=Math.sin((phase-.03)*PI*2);
    feet[0].update(life*(1-total+total*smooth(cycle,-.55,.32)),group.position.y,reset);
    feet[1].update(life*(1-total+total*smooth(-cycle,-.55,.32)),group.position.y,reset);
    if(!dropped){
      bones.LeftHand.getWorldPosition(left).applyMatrix4(inverse);
      bones.RightHand.getWorldPosition(right).applyMatrix4(inverse);
      weapon.position.copy(right);weapon.position.y+=.010;
      turn.subVectors(left,right);
      weapon.rotation.set(-Math.atan2(turn.y,Math.max(.12,Math.hypot(turn.x,turn.z)))-firing*.028,
        Math.atan2(turn.x,turn.z),-.065+hit*.06,'YXZ');
      if(dead && actions.death.time>.56){
        dropped=true;dropPos.copy(weapon.position);dropQ.copy(weapon.quaternion);
        groundQ.setFromEuler(localEuler.set(-.035,weapon.rotation.y+.24,PI*.48));
      }
    } else {
      const t=Math.max(0,actions.death.time-.56);
      const fall=clamp(4.2*t*t,0,1),settle=smooth(t,0,.61);
      weapon.position.copy(dropPos);
      weapon.position.x+=.11*settle;weapon.position.z+=.17*settle;
      weapon.position.y=dropPos.y*(1-fall)+.041*fall;
      weapon.quaternion.slerpQuaternions(dropQ,groundQ,settle);
    }
  }
  update(0,{});
  return update;
}

export function createEnemy(T,scene,index=0){
  const group=new T.Group();scene.add(group);
  const hitMeshes=[];let animate=null,lastState={};
  const ready=Promise.all([guardSource(T),equipment(T).catch(()=>null)]).then(([asset,gear])=>{
    animate=rigGuard(T,group,asset,gear?.carried,index);
    group.traverse(o=>{if(o.isSkinnedMesh)hitMeshes.push(o)});
  }).catch(error=>{
    console.warn('Using the built-in patrol model.',error);
    const fallback=createFallbackGuard(T,group,index);animate=fallback.update;hitMeshes.push(...fallback.hitMeshes);
  }).then(()=>{
    group.traverse(part=>{
      if(part.isMesh && !part.material.transparent) part.castShadow=true;
    });
    animate(0,lastState);
  });
  return {group,hitMeshes,ready,update(dt,state={}){lastState=state;if(animate)animate(dt,state)}};
}
