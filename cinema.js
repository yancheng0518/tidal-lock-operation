import * as T from './vendor/three.module.js';

// Keep colour in scene-linear units up to the last pass, including the hands.
// Only depth from the world camera is used for contact shadows.
export function createCinema(renderer) {
  if (!renderer.extensions.has('EXT_color_buffer_float')) return null;
  const full = () => new T.WebGLRenderTarget(1, 1, {type:T.HalfFloatType, stencilBuffer:false});
  const world = full(), plate = full();
  world.depthTexture = new T.DepthTexture(1, 1, T.UnsignedIntType);
  const reduced = type => new T.WebGLRenderTarget(1, 1, {type, depthBuffer:false, stencilBuffer:false});
  const contact = reduced(T.UnsignedByteType);
  const bright = reduced(T.HalfFloatType), soft = reduced(T.HalfFloatType);
  const size = new T.Vector2(), plane = new T.BufferGeometry();
  plane.setAttribute('position', new T.Float32BufferAttribute([-1,-1,0, 3,-1,0, -1,3,0], 3));
  const triangle = new T.Mesh(plane), scene = new T.Scene(), ortho = new T.Camera();
  triangle.frustumCulled = false;
  scene.add(triangle);
  const vertexShader = `
    varying vec2 uvFrame;
    void main(){uvFrame=position.xy*.5+.5;gl_Position=vec4(position.xy,0.,1.);}
  `;
  function pass(values, body, toneMapped=false) {
    const uniforms = Object.fromEntries(Object.entries(values).map(([k,v])=>[k,{value:v}]));
    return new T.ShaderMaterial({uniforms, vertexShader, fragmentShader:'varying vec2 uvFrame;\n'+body,
      toneMapped, depthTest:false, depthWrite:false, blending:T.NoBlending});
  }
  const ao = pass({depth:world.depthTexture, proj:new T.Vector2(), clip:new T.Vector2()}, `
    uniform sampler2D depth;
    uniform vec2 proj,clip;
    float metres(vec2 uv){return clip.x*clip.y/(clip.y-texture2D(depth,uv).r*(clip.y-clip.x));}
    vec3 positionAt(vec2 uv){float z=metres(uv);return vec3((uv*2.-1.)*z/proj,-z);}
    void main(){
      vec3 p=positionAt(uvFrame);
      vec3 n=normalize(cross(dFdx(p),dFdy(p)));
      float occ=0.;
      // Fixed screen directions keep quiet surfaces stable during slow pans.
      for(int i=0;i<8;i++){
        float a=float(i)*2.39996323;
        float radius=.13+.67*(float(i)+.5)/8.;
        vec2 offset=vec2(cos(a),sin(a))*proj*.5*radius/max(-p.z,.3);
        vec3 delta=positionAt(clamp(uvFrame+offset,0.,1.))-p;
        float d=max(length(delta),.001);
        occ+=max(dot(n,delta)/d-.13,0.)*(1.-smoothstep(.08,1.1,d));
      }
      float visibility=1.-min(.42,occ*.14)*(1.-smoothstep(28.,65.,-p.z));
      // Depth in the other channels allows bilateral reconstruction at silhouettes.
      float z=log2(1.-p.z)/10.;
      gl_FragColor=vec4(visibility,floor(z*255.)/255.,fract(z*255.),1.);
    }
  `);
  const copy = pass({colour:world.texture, depth:world.depthTexture, mask:contact.texture, maskSize:new T.Vector2(), clip:new T.Vector2()}, `
    uniform sampler2D colour,depth,mask;
    uniform vec2 maskSize,clip;
    void main(){
      float d=texture2D(depth,uvFrame).r;
      float z=log2(1.+clip.x*clip.y/(clip.y-d*(clip.y-clip.x)))/10.;
      vec2 grid=uvFrame*maskSize-.5, base=floor(grid), f=fract(grid);
      float sum=0., weight=0.;
      for(int y=0;y<2;y++)for(int x=0;x<2;x++){
        vec2 corner=vec2(float(x),float(y));
        vec3 m=texture2D(mask,(base+corner+.5)/maskSize).rgb;
        vec2 w=mix(1.-f,f,corner);
        float bilateral=w.x*w.y*exp2(-320.*abs(z-m.g-m.b/255.));
        sum+=bilateral*m.r;weight+=bilateral;
      }
      vec3 radiance=texture2D(colour,uvFrame).rgb;
      gl_FragColor=vec4(radiance*(sum+.002)/(weight+.002),1.);
    }
  `);
  const prefilter = pass({source:plate.texture, pixel:new T.Vector2()}, `
    uniform sampler2D source;uniform vec2 pixel;
    vec3 highlight(vec2 uv){
      vec3 c=min(texture2D(source,uv).rgb,vec3(12.));
      float peak=max(max(c.r,c.g),c.b);
      return c*smoothstep(.88,2.8,peak);
    }
    void main(){
      gl_FragColor=vec4(.25*(highlight(uvFrame+pixel)+highlight(uvFrame-pixel)
        +highlight(uvFrame+vec2(pixel.x,-pixel.y))+highlight(uvFrame+vec2(-pixel.x,pixel.y))),1.);
    }
  `);
  const blur = pass({source:bright.texture, axis:new T.Vector2()}, `
    uniform sampler2D source;uniform vec2 axis;
    void main(){
      vec3 c=texture2D(source,uvFrame).rgb*.227027;
      c+=(texture2D(source,uvFrame+axis*1.384615).rgb+texture2D(source,uvFrame-axis*1.384615).rgb)*.316216;
      c+=(texture2D(source,uvFrame+axis*3.230769).rgb+texture2D(source,uvFrame-axis*3.230769).rgb)*.070270;
      gl_FragColor=vec4(c,1.);
    }
  `);
  const output = pass({colour:plate.texture, glow:bright.texture, texel:new T.Vector2()}, `
    uniform sampler2D colour,glow;uniform vec2 texel;
    float luma(vec3 c){return dot(c,vec3(.2126,.7152,.0722));}
    void main(){
      vec3 c=texture2D(colour,uvFrame).rgb;
      float l=luma(c),n=luma(texture2D(colour,uvFrame+vec2(0.,texel.y)).rgb);
      float s=luma(texture2D(colour,uvFrame-vec2(0.,texel.y)).rgb);
      float e=luma(texture2D(colour,uvFrame+vec2(texel.x,0.)).rgb);
      float w=luma(texture2D(colour,uvFrame-vec2(texel.x,0.)).rgb);
      float hi=max(l,max(max(e,w),max(n,s))),lo=min(l,min(min(e,w),min(n,s)));
      if(hi-lo>max(.05,hi*.16)){
        vec2 edge=vec2(n-s,w-e);
        vec2 off=texel*.55*edge/(max(abs(edge.x),abs(edge.y))+.001);
        vec3 smoothed=.5*(texture2D(colour,uvFrame+off).rgb+texture2D(colour,uvFrame-off).rgb);
        c=mix(c,smoothed,.72);
      }
      c+=texture2D(glow,uvFrame).rgb*.085;
      gl_FragColor=vec4(c,1.);
      #include <tonemapping_fragment>
      // A gentle luma curve separates backlit surfaces and preserves their hue.
      float level=sqrt(clamp(luma(gl_FragColor.rgb),0.,1.));
      float printLevel=mix(level,smoothstep(0.,1.,level),.22);
      gl_FragColor.rgb*=pow((printLevel+.004)/(level+.004),2.);
      #include <colorspace_fragment>
    }
  `,true);
  function draw(target, material) {
    renderer.setRenderTarget(target);
    triangle.material=material;
    renderer.render(scene,ortho);
  }
  function render(environment, camera, hands, sight) {
    renderer.getDrawingBufferSize(size);
    if(world.width!==size.x || world.height!==size.y){
      world.setSize(size.x,size.y);plate.setSize(size.x,size.y);
      contact.setSize(Math.max(1,Math.ceil(size.x*.5)),Math.max(1,Math.ceil(size.y*.5)));
      bright.setSize(Math.max(1,Math.ceil(size.x/6)),Math.max(1,Math.ceil(size.y/6)));
      soft.setSize(bright.width,bright.height);
      copy.uniforms.maskSize.value.set(contact.width,contact.height);
      output.uniforms.texel.value.set(1/size.x,1/size.y);
      prefilter.uniforms.pixel.value.set(1.5/size.x,1.5/size.y);
    }
    ao.uniforms.proj.value.set(camera.projectionMatrix.elements[0],camera.projectionMatrix.elements[5]);
    ao.uniforms.clip.value.set(camera.near,camera.far);copy.uniforms.clip.value.copy(ao.uniforms.clip.value);
    renderer.setRenderTarget(world);renderer.clear();renderer.render(environment,camera);
    draw(contact,ao);draw(plate,copy);
    renderer.clearDepth();renderer.render(hands,sight);
    draw(bright,prefilter);
    blur.uniforms.source.value=bright.texture;blur.uniforms.axis.value.set(1.35/bright.width,0);draw(soft,blur);
    blur.uniforms.source.value=soft.texture;blur.uniforms.axis.value.set(0,1.35/soft.height);draw(bright,blur);
    draw(null,output);
  }
  return {render};
}
