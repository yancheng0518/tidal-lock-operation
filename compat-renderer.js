// Software perspective renderer for browsers without a usable WebGL device.
// Texture sheets contain orthographic renders of the level and its character art.
const axes = [
  [[1,0,0],[0,0,-1],[0,1,0]], [[-1,0,0],[0,0,1],[0,1,0]],
  [[0,0,1],[1,0,0],[0,1,0]], [[0,0,-1],[-1,0,0],[0,1,0]],
  [[0,1,0],[1,0,0],[0,0,-1]], [[0,-1,0],[1,0,0],[0,0,1]]
];
const asset = name => new URL('./compat-assets/'+name+'?v=1.3.0', import.meta.url).href;
const clamp = (x,min,max) => Math.max(min,Math.min(max,x));
const rgba = (r,g,b) => (255<<24)|(b<<16)|(g<<8)|r;
const near = .055;
// Muzzle coordinates in the original 832 x 320 camera, relative to its centre.
const muzzlePositions = [
  [17,35],[15,34],[12,33],[9,32],[6,31],[3,30],[0,29],
  [5,42],[-7,49],[-20,57],[-32,64],
  [37,25],[63,15],[64,15],[64,15],[64,15],[64,15],[64,16],[64,16],[39,24]
];
function makeCanvas(w,h) {
  const c=document.createElement('canvas'); c.width=w; c.height=h;
  return c;
}
function imageTexture(im) {
  const width=im.width,height=im.height,stripHeight=Math.min(96,height);
  const c=makeCanvas(width,stripHeight), cx=c.getContext('2d',{willReadFrequently:true});
  if(!cx)throw Error('无法读取场景纹理');
  const pixels=new Uint32Array(width*height);
  // Limit scratch canvas memory even for the large ground and equipment atlases.
  try {
    for(let y=0;y<height;y+=stripHeight){
      const rows=Math.min(stripHeight,height-y);
      cx.clearRect(0,0,width,rows);
      cx.drawImage(im,0,y,width,rows,0,0,width,rows);
      const data=cx.getImageData(0,0,width,rows).data;
      pixels.set(new Uint32Array(data.buffer,data.byteOffset,width*rows),y*width);
    }
  } finally {c.width=c.height=1}
  return {width,pixels};
}
function loadImage(name) {
  return new Promise((ok,fail)=>{
    const image=new Image();
    image.onload=()=>ok(image); image.onerror=fail; image.src=asset(name);
  });
}
function polygon(ctx,points,colour) {
  ctx.fillStyle=colour;ctx.beginPath();ctx.moveTo(...points[0]);
  for(let i=1;i<points.length;i++)ctx.lineTo(...points[i]);
  ctx.closePath();ctx.fill();
}

function makeFace(x,y,z,normal,right,up,width,height,rect,texture,colour) {
  const [tx,ty,tw,th]=rect;
  const verts=[[-.5,.5,0,0],[.5,.5,1,0],[.5,-.5,1,1],[-.5,-.5,0,1]].map(([a,b,u,v])=>({
    x:x+a*width*right[0]+b*height*up[0],
    y:y+a*width*right[1]+b*height*up[1],
    z:z+a*width*right[2]+b*height*up[2],
    u:tx+.5+u*(tw-1),v:ty+.5+v*(th-1)
  }));
  return {x,y,z,normal,verts,texture,colour};
}
function rectFace(x,y,z,side,w,h,rect,texture,colour) {
  return makeFace(x,y,z,...axes[side],w,h,rect,texture,colour);
}

function filteredColour(source,stride,u,v) {
  // Four-bit bilinear weights permit red and blue to be interpolated together.
  u-=.5;v-=.5;
  const x=u|0,y=v|0,idx=y*stride+x,c=source[idx];
  const right=source[idx+1],below=source[idx+stride],corner=source[idx+stride+1];
  if((c&right&below&corner)>>>24<240)return source[(v+.5|0)*stride+(u+.5|0)];
  const fx=(u-x)*16|0,fy=(v-y)*16|0,ix=16-fx,iy=16-fy,mask=0xff00ff;
  const topRB=(((c&mask)*ix+(right&mask)*fx)>>>4)&mask;
  const lowRB=(((below&mask)*ix+(corner&mask)*fx)>>>4)&mask;
  const rb=(((topRB*iy+lowRB*fy)>>>4)&mask);
  const topG=(c>>>8&255)*ix+(right>>>8&255)*fx;
  const lowG=(below>>>8&255)*ix+(corner>>>8&255)*fx;
  return 0xff000000|rb|((topG*iy+lowG*fy)&0xff00);
}

// These surfaces and silhouettes are available immediately, including when the
// network refuses image downloads. Each obstacle shares the movement collider.
function basicYard(world) {
  const faces=[],unit=[0,0,1,1];
  const add=(x,y,z,id,w,h,c)=>faces.push(rectFace(x,y,z,id,w,h,unit,null,c));
  add(0,-.01,0,4,130,155,rgba(108,101,88));
  for(const [i,b] of world.colliders.entries()){
    const w=b.maxX-b.minX,d=b.maxZ-b.minZ,l=b.minY||0,h=b.height-l;
    const x=(b.minX+b.maxX)/2,z=(b.minZ+b.maxZ)/2,y=l+h/2;
    const pal=h>2&&w<5&&d>5 ? (i%2?[107,67,54]:[54,84,89]) : h<1.1?[145,140,120]:[105,107,98];
    const c=k=>rgba(...pal.map(v=>Math.floor(v*k)));
    add(b.maxX,y,z,0,d,h,c(1.18));add(b.minX,y,z,1,d,h,c(.69));
    add(x,y,b.maxZ,2,w,h,c(.84));add(x,y,b.minZ,3,w,h,c(1.06));
    add(x,b.height,z,4,w,d,c(1.24));
  }
  add(0,6.3,-30.5,2,50,12.6,rgba(117,130,125));
  for(let x=-24;x<=24;x+=8)add(x,6.8,-30,2,.8,13.6,rgba(82,92,90));
  add(0,7.5,-18.6,2,21.6,.9,rgba(65,74,74));
  for(let z=-24;z<23;z+=5)add(0,.011,z,4,.11,2,rgba(208,179,114));
  return faces;
}
function basicGuard(){
  const img=makeCanvas(72,96),p=img.getContext('2d');p.fillStyle='#29312f';
  polygon(p,[[27,52],[35,52],[34,73],[26,87],[20,86],[26,69]],'#303d38');
  polygon(p,[[35,52],[43,52],[43,70],[48,87],[41,88],[35,71]],'#38433d');
  p.fillRect(18,85,10,4);p.fillRect(41,85,11,5);
  polygon(p,[[27,31],[41,31],[46,40],[42,57],[24,56],[23,40]],'#68715c');
  p.fillStyle='#414c40';p.fillRect(26,34,16,17);p.fillStyle='#979776';p.fillRect(29,43,11,4);
  p.fillStyle='#857766';p.fillRect(29,21,11,12);p.fillStyle='#424c41';p.fillRect(27,17,15,9);p.fillRect(25,24,19,3);
  polygon(p,[[26,34],[21,38],[20,49],[34,49],[34,44],[26,42]],'#515a4b');
  p.fillStyle='#222c2b';p.fillRect(27,39,26,4);p.fillRect(34,41,4,8);
  return imageTexture(img);
}
function basicWeapon(ctx,w,h,ads,reload){
  ctx.save();ctx.translate(w*(.68-.18*ads),h*(.81-.29*ads+reload*.12));ctx.scale(h/400,h/400);
  polygon(ctx,[[-34,41],[-85,114],[-41,141],[1,50]],'#69604a');
  polygon(ctx,[[-20,-54],[-10,-56],[53,47],[23,61]],'#363d39');
  polygon(ctx,[[-20,-54],[-12,-58],[1,-40],[-7,-37]],'#171f1c');
  polygon(ctx,[[-7,0],[14,-5],[95,129],[49,138]],'#272d2a');
  ctx.strokeStyle='#575e52';ctx.lineWidth=4;ctx.strokeRect(-11,-12,22,21);
  if(ads>.7){ctx.fillStyle='#ff6a45';ctx.fillRect(-1,-2,2,2)}
  ctx.restore();
}

export function createCompatRenderer(canvas,worldData) {
  const ctx=canvas.getContext('2d',{alpha:false});
  if(!ctx)throw new Error('浏览器无法创建二维画布');
  const backing=makeCanvas(1,1),low=backing.getContext('2d',{alpha:false});
  let frame,pixels,depth,width=0,height=0,displayW=0,displayH=0,focal=1,disposed=false;
  const outline=basicYard(worldData);
  let yard=outline,sky=null,guards=null,hands=null;
  const fallbackGuard=basicGuard();
  const walkers=new WeakMap();
  let quality=1,slowFrames=0,fastFrames=0;

  function resize(w=canvas.clientWidth,h=canvas.clientHeight){
    if(!w||!h)return;
    const scale=Math.min(devicePixelRatio||1,Math.sqrt(2073600/(w*h)));
    displayW=Math.max(1,Math.round(w*scale));displayH=Math.max(1,Math.round(h*scale));
    if(canvas.width!==displayW||canvas.height!==displayH){canvas.width=displayW;canvas.height=displayH}
    const ratio=Math.min(1,Math.sqrt(1500000/(displayW*displayH)))*quality;
    width=Math.max(1,Math.round(displayW*ratio));height=Math.max(1,Math.round(displayH*ratio));
    if(backing.width===width&&backing.height===height&&frame)return;
    backing.width=width;backing.height=height;
    frame=low.createImageData(width,height);pixels=new Uint32Array(frame.data.buffer);depth=new Float32Array(width*height);
  }
  // Load independently: gameplay never waits for optional artwork.
  async function loadYard(){
    const response=await fetch(asset('surfaces.json'));
    if(!response.ok)return;
    const entries=await response.json(),baked=[];
    // Decode one atlas at a time. Larger textures never reserve a matching 2D canvas.
    const count=1+Math.max(...entries.map(entry=>entry[10]));
    let complete=true;
    for(let i=0;i<count;i++){
      if(disposed)return;
      try{
        const img=await loadImage(i?'world-'+i+'.webp':'world.webp');
        if(disposed)return;
        const texture=imageTexture(img);
        for(const [x,y,z,id,w,h,tx,ty,tw,th,tile] of entries){
          if(tile===i)baked.push(rectFace(x,y,z,id,w,h,[tx,ty,tw,th],texture,0));
        }
        yard=baked.concat(outline);
      }catch{complete=false}
    }
    if(complete&&!disposed)yard=baked;
  }
  loadYard().catch(()=>{});
  loadImage('sky.jpg').then(im=>{if(disposed)return;const tex=imageTexture(im),r=160;
    const side=im.width/4;
    sky=axes.map(([n],i)=>rectFace(-n[0]*r,-n[1]*r,-n[2]*r,i,2*r,2*r,[side*(i%4),side*Math.floor(i/4),side,side],tex,0));
  }).catch(()=>{});
  loadImage('guards.webp').then(im=>{if(!disposed)guards=imageTexture(im)}).catch(()=>{});
  loadImage('hands.webp').then(im=>{if(!disposed)hands=im}).catch(()=>{});

  // Perspective-correct scan conversion. Inverse depth is also used for the
  // visibility test, so crouching behind a low wall occludes just the lower body.
  function triangle(a,b,c,tex,solid) {
    if(a.y>b.y){const t=a;a=b;b=t}if(b.y>c.y){const t=b;b=c;c=t}if(a.y>b.y){const t=a;a=b;b=t}
    const abx=b.x-a.x,aby=b.y-a.y,acx=c.x-a.x,acy=c.y-a.y;
    const area=abx*acy-acx*aby;
    if(Math.abs(area)<.035||acy<.001)return;
    const first=Math.max(0,Math.ceil(a.y-.5)),end=Math.min(height,Math.ceil(c.y-.5));
    if(first>=end)return;
    const inv=1/area;
    const zx=((b.q-a.q)*acy-(c.q-a.q)*aby)*inv,zy=(abx*(c.q-a.q)-acx*(b.q-a.q))*inv;
    const ux=((b.u-a.u)*acy-(c.u-a.u)*aby)*inv,uy=(abx*(c.u-a.u)-acx*(b.u-a.u))*inv;
    const vx=((b.v-a.v)*acy-(c.v-a.v)*aby)*inv,vy=(abx*(c.v-a.v)-acx*(b.v-a.v))*inv;
    const long=acx/acy,upper=aby>0?abx/aby:0,lower=c.y>b.y?(c.x-b.x)/(c.y-b.y):0;
    const source=tex?.pixels,stride=tex?.width||0;
    const au=a.u/a.q,av=a.v/a.q;
    const textureArea=(b.u/b.q-au)*(c.v/c.q-av)-(c.u/c.q-au)*(b.v/b.q-av);
    const magnified=source && Math.abs(area)>.85*Math.abs(textureArea);
    for(let y=first;y<end;y++){
      const dy=y+.5-a.y;
      const e1=a.x+dy*long,e2=y+.5<b.y?a.x+dy*upper:b.x+(y+.5-b.y)*lower;
      const x0=Math.max(0,Math.ceil(Math.min(e1,e2)-.5)),x1=Math.min(width,Math.ceil(Math.max(e1,e2)-.5));
      if(x0>=x1)continue;
      const dx=x0+.5-a.x;
      let q=a.q+zy*dy+zx*dx,u=a.u+uy*dy+ux*dx,v=a.v+vy*dy+vx*dx;
      for(let idx=y*width+x0,last=y*width+x1;idx<last;idx++,q+=zx,u+=ux,v+=vx){
        if(q<=depth[idx])continue;
        let colour=solid;
        if(source){
          const distance=1/q;
          const tx=u*distance,ty=v*distance;
          colour=magnified?filteredColour(source,stride,tx,ty):source[(ty|0)*stride+(tx|0)];
          if((colour>>>24)<80)continue;
        }
        depth[idx]=q;pixels[idx]=colour|0xff000000;
      }
    }
  }

  let matrix,eye;
  function drawFace(face,skyFace=false){
    const {normal:n,texture,colour}=face,m=matrix;
    let dx=(skyFace?0:eye.x)-face.x,dy=(skyFace?0:eye.y)-face.y,dz=(skyFace?0:eye.z)-face.z;
    if(n[0]*dx+n[1]*dy+n[2]*dz<-.003)return;
    const cameraPoints=[];let inside=0;
    for(const p of face.verts){
      const x=p.x-(skyFace?0:eye.x),y=p.y-(skyFace?0:eye.y),z=p.z-(skyFace?0:eye.z);
      const d=-(m[2]*x+m[6]*y+m[10]*z);
      if(d>=near)inside++;
      cameraPoints.push({x:m[0]*x+m[4]*y+m[8]*z,y:m[1]*x+m[5]*y+m[9]*z,z:d,u:p.u,v:p.v});
    }
    if(!inside)return;
    let clipped=cameraPoints;
    if(inside!==4){
      clipped=[];
      let p=cameraPoints[3];
      for(const t of cameraPoints){
        if((p.z>=near)!==(t.z>=near)){
          const a=(near-p.z)/(t.z-p.z);
          clipped.push({x:p.x+(t.x-p.x)*a,y:p.y+(t.y-p.y)*a,z:near,u:p.u+(t.u-p.u)*a,v:p.v+(t.v-p.v)*a});
        }
        if(t.z>=near)clipped.push(t);p=t;
      }
    }
    let left=0,right=0,top=0,bottom=0;
    for(const p of clipped){
      const q=1/p.z;p.x=width*.5+p.x*focal*q;p.y=height*.5-p.y*focal*q;p.q=q;p.u*=q;p.v*=q;
      if(p.x<0)left++;else if(p.x>width)right++;if(p.y<0)top++;else if(p.y>height)bottom++;
    }
    const count=clipped.length;
    if(left===count||right===count||top===count||bottom===count)return;
    for(let i=1;i<count-1;i++)triangle(clipped[0],clipped[i],clipped[i+1],texture,colour);
  }

  function drawGuard(enemy,time) {
    const p=enemy.group.position,angle=Math.atan2(eye.x-p.x,eye.z-p.z),rotation=enemy.group.rotation.y;
    const side=(Math.round((angle-rotation)*4/Math.PI)%8+8)%8;
    let state=walkers.get(enemy);
    if(!state||time<state.time){state={x:p.x,z:p.z,time,phase:enemy.index||0,death:-1};walkers.set(enemy,state)}
    state.phase+=Math.hypot(p.x-state.x,p.z-state.z)*1.85;
    state.x=p.x;state.z=p.z;state.time=time;
    let cy=0,pose=Math.floor(state.phase*4)%4;
    if(enemy.hp<=0){
      if(state.death<0)state.death=time;
      const elapsed=time-state.death;
      if(elapsed>.27)pose=4;else cy=-Math.min(.84,elapsed*3.2);
      if(!guards&&elapsed>.27)return;
    } else {state.death=-1;}
    const sn=Math.sin(angle),cs=Math.cos(angle);
    const box=guards?[side*176,pose*192,176,192]:[0,0,72,96];
    const face=makeFace(p.x,p.y+.96+cy,p.z,[sn,0,cs],[cs,0,-sn],[0,1,0],1.98,2.16,box,guards||fallbackGuard,0);
    drawFace(face);
    if(enemy.hp>0&&enemy.firing>.72) {
      const size=.10*enemy.firing;
      drawFace(makeFace(p.x+Math.sin(rotation)*.4,1.32,p.z+Math.cos(rotation)*.4,[sn,0,cs],[cs,0,-sn],[0,1,0],size,size,[0,0,1,1],null,rgba(255,208,127)));
    }
  }

  function viewmodel(v){
    const w=displayW,h=displayH,a=clamp(v.ads||0,0,1),walk=v.walk||0,sprint=v.sprint||0,t=v.time||0;
    const reload=clamp(v.reload||0,0,1),step=v.foot||0;
    if(!hands){basicWeapon(ctx,w,h,a,Math.sin(Math.PI*reload));return}
    const reloadFrame=Math.round(reload*10),runFrame=Math.round(sprint*(1-a)*4);
    let pose=Math.round(a*6);
    if(reloadFrame>0&&reloadFrame<10)pose=10+reloadFrame;
    else if(runFrame>0&&a<.15)pose=6+runFrame;
    // Slide between adjacent sight poses while the grip and perspective change.
    const between=pose<=6?a-pose/6:0;
    const bob=walk*(1-a);
    const swayX=(Math.sin(step)*.008*bob+.004*(v.lean||0)*(1-a)-between*.21)*h;
    const swayY=(Math.cos(2*step)*.005*bob+Math.sin(t*1.45)*.0015*(1-a)+(v.flash||0)*.012+(v.landing||0)*.019-between*.09)*h;
    const scale=h/320,cx=w*.5+swayX,cy=h*.5+swayY;
    if(v.flash>.66){
      const [mx,my]=muzzlePositions[pose];
      ctx.save();ctx.translate(cx+mx*scale,cy+my*scale);ctx.scale(scale,scale);ctx.rotate(t*31);
      polygon(ctx,[[-15,1],[-3,-2],[1,-13],[3,-2],[14,2],[2,3],[-2,12],[-2,2]],'#ffd892');ctx.restore();
    }
    const sw=hands.width/4,sh=hands.height/5;
    ctx.drawImage(hands,(pose%4)*sw,Math.floor(pose/4)*sh,sw,sh,cx-284*scale,cy-20*scale,480*scale,180*scale);
  }
  function render(v) {
    if(disposed||!v.camera)return;
    if(!frame)resize();
    if(!frame)return;
    const begin=performance.now(),camera=v.camera;
    matrix=camera.matrixWorldInverse.elements;eye=camera.position;
    focal=.5*height/Math.tan(camera.fov*Math.PI/360);
    depth.fill(0);
    if(!sky){
      for(let y=0;y<height;y++){const t=y/height;pixels.fill(rgba(94+t*100,128+t*64,156+t*26),y*width,(y+1)*width)}
    }
    for(const face of yard)drawFace(face);
    for(const e of v.enemies||[])drawGuard(e,v.time||0);
    if(sky)for(const face of sky)drawFace(face,true);
    low.putImageData(frame,0,0);ctx.drawImage(backing,0,0,displayW,displayH);
    viewmodel(v);
    const cost=performance.now()-begin;
    slowFrames=cost>27?slowFrames+1:Math.max(0,slowFrames-2);
    fastFrames=cost<12?fastFrames+1:0;
    if(slowFrames>=14&&width*height>230000){quality*=.88;slowFrames=fastFrames=0;resize()}
    else if(fastFrames>=180&&quality<1){quality=Math.min(1,quality*1.1);slowFrames=fastFrames=0;resize()}
  }
  resize();
  return {render,resize,dispose(){disposed=true;yard=[];sky=guards=hands=null;backing.width=backing.height=1}};
}

