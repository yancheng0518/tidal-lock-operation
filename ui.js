import { enterLandscape, leaveLandscape } from "./landscape.js";
import { MAP_PLAN } from "./level.js";
import "./game.js";
const $ = selector => document.querySelector(selector);
const popup = $("#popup"), hud = $("#hud"), body = document.body;
const fmtTime = value => [Math.floor(value / 60), Math.floor(value % 60)].map(v => String(v).padStart(2,"0")).join(":");
const icon = name => '<svg aria-hidden="true"><use href="#i-' + name + '"/></svg>';
let state = {phase:"menu"}, panel = "", lastFocus, plan=MAP_PLAN, feedTimer, markTimer, hurtTimer;
// Keep old shared links and bookmarks on the same deployment page.
const entryUrl=new URL(location.href);
if(entryUrl.searchParams.has("mode") || entryUrl.searchParams.has("v")){
  entryUrl.searchParams.delete("mode");
  entryUrl.searchParams.delete("v");
  try{history.replaceState(history.state,"",entryUrl.href)}catch{}
}
let muted=false, sensitivity=1, aimSensitivity=.65, fieldOfView=72;
function readNumber(key, fallback, min, max){
  const raw=localStorage.getItem(key), value=Number(raw);
  return raw!==null && Number.isFinite(value) ? Math.max(min,Math.min(max,value)) : fallback;
}
try{
  muted=localStorage.getItem("tidal-muted")==="true";
  sensitivity=readNumber("tidal-sensitivity",1,.3,3);
  aimSensitivity=readNumber("tidal-ads",.65,.3,1);
  fieldOfView=readNumber("tidal-fov",72,60,90);
}catch{}
function applyOptions(){
  const game=window.Game;
  if(game){
    game.setMuted(muted);game.setSensitivity(sensitivity);game.setAimSensitivity(aimSensitivity);
    game.setFieldOfView(fieldOfView);
  }
  $("#sound").innerHTML=icon(muted?"mute":"audio");
  $("#sound").setAttribute("aria-pressed",String(!muted));$("#sound").title=muted?"开启音效":"关闭音效";
  try{
    localStorage.setItem("tidal-muted",muted);localStorage.setItem("tidal-sensitivity",sensitivity);
    localStorage.setItem("tidal-ads",aimSensitivity);localStorage.setItem("tidal-fov",fieldOfView);
  }catch{}
}

// A north-up orthographic capture uses the same metre coordinates as the simulation.
const survey=new Image();
survey.onload=()=>{ paintMap($("#map-preview"),"preview");if(panel==="map")paintMap($(".large-map"),"large") };
survey.src="sector-survey.webp";
function paintMap(canvas,mode,live){
  if(!canvas)return;
  const w=canvas.width,h=canvas.height,c=canvas.getContext("2d");
  if(!c)return;
  const isHUD=mode==="hud", isPreview=mode==="preview";
  const scale=isHUD?w/40:isPreview?h/42:Math.min(w/56,h/66);
  const centreX=isHUD?live.x:0,centreZ=isHUD?live.z:-1;
  c.setTransform(1,0,0,1,0,0);c.fillStyle="#2c3634";c.fillRect(0,0,w,h);
  c.save();c.translate(w/2,h/2);c.scale(scale,scale);c.translate(-centreX,-centreZ);
  if(survey.naturalWidth)c.drawImage(survey,-48,-50,96,96);
  else{
    c.fillStyle="#63736c";
    for(const b of plan?.sites||[])c.fillRect(b.x-b.w/2,b.z-b.d/2,b.w,b.d);
  }
  c.beginPath();for(let i=-50;i<=50;i+=5){c.moveTo(i,-50);c.lineTo(i,50);c.moveTo(-50,i);c.lineTo(50,i)}
  c.lineWidth=.6/scale;c.strokeStyle="#d9f0dd3d";c.stroke();
  if(!isHUD&&plan){const b=plan.bounds;c.strokeStyle="#f5c97c";c.lineWidth=1.5/scale;c.setLineDash([1,.6]);c.strokeRect(b.minX,b.minZ,b.maxX-b.minX,b.maxZ-b.minZ);c.setLineDash([])}
  for(const e of (isHUD?live.enemies:plan?.spawns)||[]){
    const size=(isHUD?3.5:4.5)/scale;c.save();c.translate(e.x,e.z);c.rotate(Math.PI/4);
    c.fillStyle="#ff9c52";c.strokeStyle="#30281f";c.lineWidth=1.4/scale;c.fillRect(-size,-size,size*2,size*2);c.strokeRect(-size,-size,size*2,size*2);c.restore();
  }
  c.translate(live?.x??0,live?.z??22);c.rotate((live?.heading||0)*Math.PI/180);
  if(isHUD){const reach=6.1;c.fillStyle="#b6f6ce38";c.beginPath();c.moveTo(0,0);c.arc(0,0,reach,-Math.PI*.67,-Math.PI*.33);c.closePath();c.fill()}
  const size=(isHUD?7:8)/scale;c.beginPath();c.moveTo(0,-size*1.65);c.lineTo(size,size);c.lineTo(0,size*.55);c.lineTo(-size,size);c.closePath();c.fillStyle="#aaf4ca";c.fill();c.strokeStyle="#243b30";c.lineWidth=1.5/scale;c.stroke();c.restore();
}
function closePanel(){
  popup.hidden=true;panel="";popup.dataset.panel="";
  if(state.phase==="menu"&&lastFocus?.isConnected)lastFocus.focus({preventScroll:true});
}
function showPanel(id,tag,title,html,closeable=true){
  if(popup.hidden)lastFocus=document.activeElement;
  panel=id;popup.dataset.panel=id;$("#dlg-tag").textContent=tag;$("#dlg-title").textContent=title;
  $("#dlg-body").innerHTML=html;$("#closePopup").hidden=!closeable;popup.hidden=false;
  const focusTarget=id==="loading"?$("#dlg-title"):popup.querySelector("button:not([hidden]),input");
  focusTarget?.focus({preventScroll:true});
}
const row=(term,value)=>'<div class="row"><dt>'+term+'</dt><dd>'+value+'</dd></div>';
const key=t=>'<kbd>'+t+'</kbd>';
const action=(id,label)=>'<button data-action="'+id+'">'+label+'</button>';
function drawPanel(id){
  if(id==="map"){
    showPanel(id,"SECTOR INTELLIGENCE","潮闸港区",'<canvas class="large-map" width="690" height="465"></canvas><div class="legend"><span>▲ 部署点</span><strong>◆ 守卫初始位置</strong><span>北 ↑</span></div><p>从南侧检修通道进入，搜索装卸场、箱区和主闸门。</p>');
    paintMap($(".large-map"),"large");
  }else if(id==="help"){
    showPanel(id,"FIELD MANUAL","操作手册",'<dl>'+[
      ["移动 / 冲刺",key("W A S D")+"　/　"+key("Shift")],["下蹲","按住 "+key("C")+" 或 "+key("Ctrl")],["转动视角","鼠标移动 / 方向键"],["射击 / 瞄准","鼠标左键 / 按住右键"],["换弹 / 暂停",key("R")+"　/　"+key("Esc")+" "+key("P")],
      ["左探头 / 右探头","按住 "+key("Q")+"　/　"+key("E")+"，松开回正"],["跳跃",key("空格")],
      ["触屏移动 / 探头","左拇指按住摇杆移动，右拇指点「左探」或「右探」。点另一侧换边，再点同侧回正。"],
      ["触屏转向 / 射击","在空白处或探头键上滑动可转向。按住射击键连射，拖动可跟随目标。"]].map(v=>row(...v)).join("")+'</dl><p style="margin:14px 0 0">移动鼠标即可环视。浏览器未锁定鼠标时，移至画面边缘可持续转向。P 键可暂停并调整视野与灵敏度。</p>');
  }else if(id==="settings"){
    const slider=(id,label,min,max,step,value,text)=>'<div class="row"><label for="'+id+'">'+label+'</label><input type="range" id="'+id+'" min="'+min+'" max="'+max+'" step="'+step+'" value="'+value+'"><output id="'+id+'-value">'+text+'</output></div>';
    showPanel(id,"TERMINAL SETTINGS","操控与画面",
      slider("sens","鼠标灵敏度",.3,3,.05,sensitivity,sensitivity.toFixed(2)+"×")+
      slider("aim-sens","举镜灵敏度",.3,1,.05,aimSensitivity,Math.round(aimSensitivity*100)+"%")+
      slider("fov","垂直视野",60,90,1,fieldOfView,fieldOfView+"°")+
      '<div class="row"><label for="snd">行动音效</label><button class="option" id="snd">'+(muted?"关闭":"开启")+'</button></div><a class="credits-link" href="actor-assets/CREDITS.md" target="_blank" rel="noopener">角色、装备与动作署名 ↗</a>　<a class="credits-link" href="world-assets/CREDITS.md" target="_blank" rel="noopener">场景素材署名 ↗</a>');
    $("#snd").onclick=()=>{muted=!muted;applyOptions();$("#snd").textContent=muted?"关闭":"开启"};
    $("#sens").oninput=e=>{sensitivity=Number(e.target.value);$("#sens-value").textContent=sensitivity.toFixed(2)+"×";applyOptions()};
    $("#aim-sens").oninput=e=>{aimSensitivity=Number(e.target.value);$("#aim-sens-value").textContent=Math.round(aimSensitivity*100)+"%";applyOptions()};
    $("#fov").oninput=e=>{fieldOfView=Number(e.target.value);$("#fov-value").textContent=fieldOfView+"°";applyOptions()};

  }
}
let loadTimer, lastProgress;
function updateLoading({stage,label,loaded=0,total=0,loadedBytes=0,totalBytes=0,percent=0}){
  if(panel!=="loading" || state.phase!=="loading")return;
  const value=stage==="done"?100:Math.min(99,Math.max(0,Math.round(percent)));
  const key=[stage,label,loaded,total,loadedBytes,totalBytes,value].join("|");
  if(lastProgress===key)return;
  lastProgress=key;
  const stageLabel=$("#load-stage"),count=$("#load-assets"),bytes=$("#load-bytes"),bar=$("#load-progress");
  if(stageLabel.textContent!==label)stageLabel.textContent=label;
  count.textContent=total>0?"资源 "+loaded+" / "+total:"";
  bytes.hidden=stage!=="assets" || totalBytes<=0;
  if(!bytes.hidden)bytes.textContent="已读取 "+(loadedBytes/1e6).toFixed(1)+" / "+(totalBytes/1e6).toFixed(1)+" MB";
  bar.value=value;
  $("#load-percent").textContent=value+"%";
  const notice=$("#load-notice"), retry=$("#load-retry");
  notice.hidden=true;
  retry.hidden=true;
  clearTimeout(loadTimer);
  if(stage!=="done")loadTimer=setTimeout(()=>{
    notice.textContent=stage==="assets"?"仍在等待资源响应。网络恢复后会继续载入。":"这一步耗时较长，可以继续等待。";
    notice.hidden=false;
    retry.hidden=false;
  },12000);
}
window.addEventListener("game-loading",event=>updateLoading(event.detail));
function phasePanel(phase){
  clearTimeout(loadTimer);
  lastProgress=null;
  if(phase==="playing"||phase==="menu"){closePanel();return}
  if(phase==="loading"){
    showPanel(phase,"DEPLOYMENT","正在进入潮闸港区",
      '<div class="load-summary"><span id="load-stage" role="status"></span><strong id="load-percent" aria-hidden="true">0%</strong></div>'+
      '<progress id="load-progress" max="100" value="0" aria-label="部署进度" aria-describedby="load-stage load-assets load-bytes"></progress>'+
      '<div class="load-footer"><div class="load-amount"><span id="load-assets"></span><span id="load-bytes" hidden></span></div><div class="load-actions">'+
      '<button id="load-retry" data-action="refresh" hidden>重新载入</button>'+action("menu","返回部署")+
      '</div></div><p id="load-notice" role="status" hidden></p>',false);
    updateLoading({stage:"prepare",label:"正在准备场景",percent:0});
    return;
  }
  if(phase==="paused"){showPanel(phase,"OPERATION PAUSED","行动已暂停",'<p>已清除 '+state.kills+' / '+state.total+' 名守卫。</p><div class="actions">'+action("resume","继续行动")+action("settings","操控与画面")+action("restart","重新开始")+action("menu","返回部署")+'</div>',false);return}
  if(phase==="won"||phase==="lost"){
    showPanel(phase,"AFTER ACTION REPORT",phase==="won"?"港区已肃清":"行动中断",'<p>'+(phase==="won"?"港区守卫已全部清除。潮闸港区控制权已恢复。":state.health<=0?"行动员失去作战能力。":"弹药耗尽，行动终止。")+'</p><dl>'+row("清除目标",state.kills+" / "+state.total)+row("行动用时",fmtTime(state.elapsed))+row("命中率",(state.shots?Math.round(100*state.hits/state.shots):0)+"%")+'</dl><div class="actions">'+action("restart","再次部署")+action("menu","返回部署")+'</div>',false);return
  }
  if(phase==="error"){
    showPanel("error","DEPLOYMENT","行动载入中断",'<p id="launch-error"></p><div class="actions">'+action("refresh","重新载入")+action("menu","返回部署")+'</div>',false);
    $("#launch-error").textContent=state.error || "游戏文件未能载入，请检查网络连接后重试。";
  }
}
function deploy(){
  $("#deploy").disabled=true;
  enterLandscape();
  try { applyOptions();window.Game.start(); }
  catch(e){console.error(e);leaveLandscape();body.dataset.phase="error";state={phase:"error",error:e.message||"请重新载入网页。"};phasePanel("error")}
  finally{$("#deploy").disabled=false}
}
function paintCompass(heading){
  const canvas=$("#bearing"),c=canvas.getContext("2d"),w=canvas.width,h=canvas.height,mid=w/2;
  if(!c)return;
  c.clearRect(0,0,w,h);c.textAlign="center";c.lineWidth=1.5;
  const labels=["N","NE","E","SE","S","SW","W","NW"];
  for(let angle=Math.floor((heading-52)/5)*5;angle<=heading+52;angle+=5){
    const deg=(angle%360+360)%360,x=mid+(angle-heading)*6;
    const emphasis=deg%15===0,cardinal=deg%45===0;
    c.globalAlpha=Math.min(1,(1-Math.min(1,Math.abs(x-mid)/mid))*2.2);
    c.strokeStyle="#f0f0dd";c.beginPath();c.moveTo(x,32);c.lineTo(x,emphasis?22:26);c.stroke();
    if(emphasis){c.font=cardinal?"bold 19px Consolas,monospace":"14px Consolas,monospace";c.fillStyle=cardinal?"#fff5dc":"#e5e5d4";c.fillText(cardinal?labels[deg/45]:String(deg),x,18)}
  }
  c.globalAlpha=1;c.fillStyle="#1b2424a8";c.fillRect(mid-25,35,50,23);
  c.font="bold 18px Consolas,monospace";c.fillStyle="#ffcc74";c.fillText(String(Math.round(heading)%360).padStart(3,"0"),mid,53);
}
function displayGame(s){
  const changed=state.phase!==s.phase;state=s;body.dataset.phase=s.phase;
  hud.hidden=!["playing","paused","won","lost"].includes(s.phase);
  if(changed){
    if(s.phase==="menu")leaveLandscape();
    phasePanel(s.phase);
    if(s.phase!=="playing"){
      threatBearing=null;threat.classList.remove("visible");$("#feed").textContent="";
      resetTouchControls();
    }
  }
  if(hud.hidden)return;
  $("#objective").textContent=String(s.kills).padStart(2,"0")+" / "+String(s.total).padStart(2,"0");
  $("#hp").textContent=s.health;$(".hp-track i").style.width=s.health+"%";$(".health").classList.toggle("low",s.health<30);
  $("#rounds").textContent=String(s.ammo).padStart(2,"0");$("#reserve").textContent=s.reserve;
  $("#timer").textContent=fmtTime(s.elapsed);
  $("#stance").textContent=s.airborne?"腾空":s.lean<-.22?"左探":s.lean>.22?"右探":s.crouched?"蹲姿":"站立";
  $("#reloadHint").textContent=s.reloading?"更换弹匣　"+Math.round(s.reloadProgress*100)+"%":"";
  paintMap($("#radar"),"hud",s);
}
const reticle=$(".reticle"), threat=$(".damage-ring");
let lastHeading=NaN,threatBearing=null,threatTimer;
window.addEventListener("game-view",({detail:v})=>{
  if(!Number.isFinite(lastHeading)||Math.abs(v.heading-lastHeading)>.13){paintCompass(v.heading);lastHeading=v.heading}
  reticle.style.opacity=String((1-v.ads)*(1-v.sprint));
  reticle.style.setProperty("--gap",(3+3*v.walk+7*v.flash).toFixed(1)+"px");
  if(threatBearing!==null)threat.style.transform="translate(-50%,-50%) rotate("+(threatBearing-v.heading)+"deg)";
});
window.addEventListener("game-state",e=>displayGame(e.detail));
window.addEventListener("game-fx",({detail:{type,azimuth}})=>{
  if(type==="kill"||type==="hit"){clearTimeout(markTimer);$("#impact").classList.add("show");markTimer=setTimeout(()=>$("#impact").classList.remove("show"),130)}
  if(type==="kill"||type==="empty"){clearTimeout(feedTimer);$("#feed").textContent=type==="kill"?"目标已清除":"弹匣已空";feedTimer=setTimeout(()=>$("#feed").textContent="",1200)}
  if(type==="hurt"){if(Number.isFinite(azimuth)){clearTimeout(threatTimer);threatBearing=azimuth;threat.classList.add("visible");threatTimer=setTimeout(()=>{threatBearing=null;threat.classList.remove("visible")},800)}clearTimeout(hurtTimer);$("#damage").style.opacity="1";hurtTimer=setTimeout(()=>$("#damage").style.opacity="0",160)}
});
$("#deploy").onclick=deploy;
$("#homeNav").onclick=()=>{closePanel();$("#deploy").focus()};
document.querySelectorAll("[data-panel]").forEach(b=>b.onclick=()=>drawPanel(b.dataset.panel));
function dismissPanel(){if(state.phase==="paused"&&panel==="settings")phasePanel("paused");else closePanel()}
$("#closePopup").onclick=dismissPanel;popup.addEventListener("click",e=>{
  if(e.target===popup&&!$("#closePopup").hidden){dismissPanel();return}
  const a=e.target.closest("[data-action]")?.dataset.action;if(!a)return;
  if(a==="resume"||a==="restart")enterLandscape();
  if(a==="settings")drawPanel("settings");else if(a==="refresh")location.reload();
  else if(window.Game)window.Game[a]();else {leaveLandscape();state={phase:"menu"};body.dataset.phase="menu";closePanel()}
});
window.addEventListener("keydown",e=>{
  if(popup.hidden)return;
  if(e.key==="Escape"&&!$("#closePopup").hidden){dismissPanel();e.preventDefault()}
  if(e.key==="Tab"){const items=[...popup.querySelectorAll("button:not([hidden]),input,select")];
    if(!items.length){e.preventDefault();return}
    if(e.shiftKey&&(document.activeElement===items[0]||document.activeElement.id==="dlg-title")){e.preventDefault();items.at(-1).focus()}
    else if(!e.shiftKey&&document.activeElement===items.at(-1)){e.preventDefault();items[0].focus()}}
});
$("#sound").onclick=()=>{muted=!muted;applyOptions()};$("#pause").onclick=()=>window.Game?.pause();
$("#pause").onpointerdown=e=>{
  if(e.pointerType==="touch" && state.phase==="playing"){e.preventDefault();window.Game.pause()}
};
const stick=$("#stick"), peekLeft=$("#touchLeanLeft"), peekRight=$("#touchLeanRight");
const touchPointers=new Map();

// The second thumb may never generate a compatibility click. Activate at
// pointerdown and keep ownership per control, even when a finger slides away.
function bindTouchControl(control, press, drag, release) {
  control.onpointerdown=e=>{
    if(state.phase!=="playing" || e.button!==0 || touchPointers.has(control))return;
    e.preventDefault();
    touchPointers.set(control,{id:e.pointerId,x:e.clientX,y:e.clientY});
    control.setPointerCapture(e.pointerId);
    press(e);
  };
  control.onpointermove=e=>{
    const point=touchPointers.get(control);
    if(point?.id!==e.pointerId)return;
    drag?.(e,point);
    point.x=e.clientX;point.y=e.clientY;
  };
  const finish=(e,cancelled)=>{
    if(touchPointers.get(control)?.id!==e.pointerId)return;
    touchPointers.delete(control);
    release?.(cancelled);
  };
  control.onpointerup=e=>finish(e,false);
  control.onpointercancel=control.onlostpointercapture=e=>finish(e,true);
  if(control.tagName==="BUTTON")control.onclick=e=>{
    if(state.phase==="playing" && e.detail===0 && !e.pointerType){press(e);release?.(false)}
  };
}
function moveStick(e){
  const rect=stick.getBoundingClientRect(), radius=stick.clientWidth*.35;
  const {x,y}=window.Game.screenDelta(e.clientX-rect.left-rect.width/2,e.clientY-rect.top-rect.height/2);
  const scale=1/Math.max(radius,Math.hypot(x,y));
  window.Game.move(x*scale,-y*scale);
  stick.firstElementChild.style.transform='translate('+x*scale*radius+'px,'+y*scale*radius+'px)';
}
function stopStick(){
  window.Game?.move(0,0);
  stick.firstElementChild.style.transform="";
}
const dragToLook=(e,point)=>window.Game.lookScreen(e.clientX-point.x,e.clientY-point.y);
bindTouchControl(stick,moveStick,moveStick,stopStick);
for(const [id,method] of [["#touchAim","aim"],["#touchCrouch","crouch"]]){
  const button=$(id);
  function set(active){button.setAttribute("aria-pressed",String(active));window.Game?.[method](active)}
  button.setAttribute("aria-pressed","false");
  bindTouchControl(button,()=>set(button.getAttribute("aria-pressed")!=="true"),dragToLook,
    cancelled=>{if(cancelled)set(false)});
}
function setPeek(side){
  peekLeft.setAttribute("aria-pressed",String(side===-1));
  peekRight.setAttribute("aria-pressed",String(side===1));
  window.Game?.lean(side);
}
for(const [button,side] of [[peekLeft,-1],[peekRight,1]]){
  bindTouchControl(button,()=>setPeek(button.getAttribute("aria-pressed")==="true"?0:side),dragToLook,
    cancelled=>{if(cancelled && button.getAttribute("aria-pressed")==="true")setPeek(0)});
}
bindTouchControl($("#touchFire"),()=>window.Game.fire(true),dragToLook,()=>window.Game?.fire(false));
bindTouchControl($("#touchJump"),()=>window.Game.jump());
bindTouchControl($("#touchReload"),()=>window.Game.reload());

function resetTouchControls(){
  for(const [control,point] of touchPointers){
    if(control.hasPointerCapture(point.id))control.releasePointerCapture(point.id);
  }
  touchPointers.clear();
  stopStick();setPeek(0);
  $("#touchAim").setAttribute("aria-pressed","false");window.Game?.aim(false);
  $("#touchCrouch").setAttribute("aria-pressed","false");window.Game?.crouch(false);
  window.Game?.fire(false);
}
window.addEventListener("game-orientationchange",resetTouchControls);
applyOptions();
paintMap($("#map-preview"),"preview");
$("#deploy span").textContent="开始行动";
$("#deploy").disabled=false;
