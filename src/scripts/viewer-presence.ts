export function trackViewer(root:HTMLElement,channel:string){
 const id=Array.from(crypto.getRandomValues(new Uint8Array(16)),n=>n.toString(16).padStart(2,'0')).join('');
 const url='/viewers/'+channel;
 let counted=false,lastTime=-1;
 function send(playing:boolean){
  counted=playing;
  void fetch(url,{method:'POST',headers:{'Content-Type':'application/json'},
   body:JSON.stringify({id,playing}),keepalive:true}).catch(()=>{});
 }
 function sample(){
  const video=root.querySelector('video');
  const playing=!!video&&!video.paused&&!video.ended&&video.readyState>=2&&video.currentTime!==lastTime;
  lastTime=video?.currentTime??-1;
  if(playing||counted)send(playing);
 }
 const timer=window.setInterval(sample,15000);
 root.addEventListener('playing',()=>{if(!counted)sample();},true);
 root.addEventListener('pause',()=>{if(counted)send(false);},true);
 window.addEventListener('pagehide',event=>{if(counted)send(false);if(!event.persisted)clearInterval(timer);});
}
