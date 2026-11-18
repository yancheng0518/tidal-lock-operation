// Original procedural game audio. One-shot samples are baked once so a firefight
// uses one buffer source per sound and the mix does not depend on render rate.
export function createAudio() {
  let context,master,ambience,limiter,muted=false,active=false,footIndex=0;
  const banks=new Map();
  function volume(){
    if(master)master.gain.setTargetAtTime(muted?0:.66,context.currentTime,.025);
    if(ambience)ambience.gain.setTargetAtTime(active&&!muted?.035:0,context.currentTime,.2);
  }
  function bake(kind,index){
    const rate=24000;
    const seconds={shot:.55,incoming:.42,foot:.21,reload:.62,rack:.19,empty:.075,hit:.072,kill:.18,hurt:.23};
    const buffer=context.createBuffer(1,Math.ceil(rate*seconds[kind]),rate),out=buffer.getChannelData(0);
    const variation=.95+index*.027;let seed=0x531b2e+(index*102311)+kind.charCodeAt(0)*19511;
    let pink=0,low=0,metal=0,phase=0;
    const tail=(t,k)=>t<0?0:Math.exp(-t*k);
    for(let i=0;i<out.length;i++){
      seed=(Math.imul(1664525,seed)+1013904223)|0;
      const white=(seed>>>0)/2147483648-1,t=i/rate;
      pink+=(white-pink)*.41;low+=(pink-low)*.053;
      const edge=white-pink;
      let value=0;
      if(kind==='shot'||kind==='incoming'){
        const near=kind==='shot',pitch=(near?57:72)*variation;
        phase+=6.283185*(pitch+(near?101:62)*Math.exp(-t*34))/rate;
        const snap=(near?.88:.42)*edge*tail(t,146);
        const body=(near?.88:.67)*pink*tail(t,23)+Math.sin(phase)*tail(t,near?24:31)*(near?.67:.38);
        const bolt=(edge*.24+pink*.20)*tail(t-.030,170);
        const reflection=low*(.95*tail(t-.051,17)+.58*tail(t-.112,13)+.30*tail(t-.178,11));
        value=(snap+body+bolt+reflection)*Math.min(1,i/13);
      }else if(kind==='foot'){
        const heel=Math.sin(2*Math.PI*(57*t+1.2*(1-Math.exp(-t*36))))*.37*tail(t,42);
        const grit=(pink*.41+low*.80)*tail(t,39)+pink*.27*tail(t-.037,47);
        const rig=edge*.11*tail(t-.075,76)+low*.42*tail(t-.059,39);
        value=(heel+grit+rig)*Math.min(1,i/28);
      }else if(kind==='reload'||kind==='rack'||kind==='empty'){
        const clicks=kind==='reload'?
          .63*tail(t-.008,160)+.80*tail(t-.088,106)+.26*tail(t-.145,95)+.53*tail(t-.47,110):
          kind==='rack'?.91*tail(t,96)+.75*tail(t-.048,157):.75*tail(t,233);
        metal=.88*metal+edge*.12;
        const slide=kind==='reload'?.40*tail(t-.19,13)*(.46+.54*Math.abs(Math.sin(311*t))):
          kind==='rack'?.36*tail(t-.012,42):0;
        value=(edge*.62+metal*.80+Math.sin(2*Math.PI*432*variation*t)*.26)*clicks+pink*slide;
      }else if(kind==='hurt'){
        phase+=2*Math.PI*(36+49*Math.exp(-t*20))/rate;
        value=(Math.sin(phase)*.40+low*.48)*tail(t,17)*Math.min(1,i/85);
      }else{
        const confirm=kind==='kill',f=confirm?630:860;
        const tap=Math.sin(2*Math.PI*f*t)+.27*Math.sin(2*Math.PI*(f*2.46)*t);
        value=(tap*tail(t,confirm?72:93)*.25+edge*tail(t,190)*.32)*Math.min(1,i/17);
        if(confirm&&t>.062)value+=Math.sin(2*Math.PI*967*(t-.062))*.22*tail(t-.062,55);
      }
      out[i]=Math.tanh(value*1.25);
    }
    return buffer;
  }
  function unlock(){
    try{
      if(!context){
        const Audio=window.AudioContext||window.webkitAudioContext;if(!Audio)return;
        context=new Audio({latencyHint:'interactive'});
        master=context.createGain();limiter=context.createDynamicsCompressor();
        limiter.threshold.value=-7;limiter.knee.value=10;limiter.ratio.value=4;limiter.attack.value=.002;limiter.release.value=.11;
        master.connect(limiter).connect(context.destination);
        const wind=context.createBufferSource(),buffer=context.createBuffer(1,48000,24000),out=buffer.getChannelData(0);
        let val=0;for(let i=0;i<out.length;i++){val=.97*val+.03*(Math.random()*2-1);out[i]=val*2.4;}
        wind.buffer=buffer;wind.loop=true;ambience=context.createGain();ambience.gain.value=0;
        wind.connect(ambience).connect(master);wind.start();volume();
        for(const type of ['shot','incoming','foot','reload','rack','empty','hit','kill','hurt']){
          const count=['shot','incoming','foot'].includes(type)?3:1;
          banks.set(type,Array.from({length:count},(_,i)=>bake(type,i)));
        }
      }
      if(context.state==='suspended')context.resume().catch(()=>{});
    }catch{/* Audio is optional when a device is unavailable. */}
  }
  function play(kind,options={}){
    const bank=banks.get(kind);if(!bank||muted||!active||context.state!=='running')return;
    const source=context.createBufferSource(),level=context.createGain();
    const index=kind==='foot'?footIndex++:Math.floor(Math.random()*bank.length);
    source.buffer=bank[index%bank.length];source.playbackRate.value=.96+Math.random()*.08;
    const loudness={shot:.94,incoming:.47,foot:.42,reload:.67,rack:.65,empty:.58,hit:.44,kill:.57,hurt:.53};
    let gain=loudness[kind],pan=0;
    if(kind==='foot'){
      gain*=options.crouch?.45:options.sprint?1.19:1;
      source.playbackRate.value*=options.sprint?1.10:options.crouch?.90:1;
      pan=index%2?.095:-.095;
    }
    if(kind==='incoming'){
      const distance=Math.max(0,Number(options.distance)||10);
      gain*=Math.max(.38,1.25-distance*.023);pan=Math.max(-.87,Math.min(.87,options.pan||0));
    }
    level.gain.value=gain;source.connect(level);
    let spatial;
    if(pan&&context.createStereoPanner){spatial=context.createStereoPanner();spatial.pan.value=pan;level.connect(spatial).connect(master);}
    else level.connect(master);
    source.onended=()=>{source.disconnect();level.disconnect();spatial?.disconnect()};
    source.start();
  }
  return {unlock,play,active(value){active=value;volume()},mute(value){muted=!!value;volume()}};
}
