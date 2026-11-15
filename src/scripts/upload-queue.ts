import {collectDropped} from './upload-drop.ts';
type Entry={file:File;path:string;state:'waiting'|'retrying'|'checking'|'uploading'|'processing'|'done'|'skipped'|'error'|'cancelled';row:HTMLTableRowElement;attempts:number;jobId?:string};
const root=document.querySelector<HTMLElement>('[data-upload-queue]');
if(root){
  const entries:Entry[]=[];let active=0,paused=false,selectedCount=0;
  const tbody=root.querySelector<HTMLTableSectionElement>('[data-queue-items]')!;
  const summary=root.querySelector<HTMLElement>('[data-queue-summary]')!;
  const retry=root.querySelector<HTMLButtonElement>('[data-retry-queue]')!;
  const refresh=root.querySelector<HTMLElement>('[data-refresh-library]')!;
  const limit=root.querySelector<HTMLSelectElement>('[data-concurrency]')!;
  const stateLabels={waiting:'En espera',retrying:'Esperando reintento…',checking:'Comprobando si ya existe…',uploading:'Subiendo',processing:'Preparando video…',done:'Completado',skipped:'Omitido (ya estaba subido)',error:'Error',cancelled:'Cancelado'};
  function status(e:Entry,message?:string){e.row.cells[2].textContent=message||stateLabels[e.state];e.row.dataset.state=e.state;}
  function update(){const done=entries.filter(e=>e.state==='done').length,skipped=entries.filter(e=>e.state==='skipped').length,errors=entries.filter(e=>e.state==='error').length,waiting=entries.filter(e=>(e.state==='waiting'||e.state==='retrying')).length;summary.textContent=`${selectedCount} seleccionados · ${done} subidos · ${skipped} omitidos · ${errors} errores · ${waiting} pendientes${active?` · ${active} activos`:''}`;retry.hidden=errors===0;refresh.hidden=active>0||waiting>0||done===0;}
  function add(files:{file:File;path:string}[]){selectedCount+=files.length;(root!.querySelector('[data-transfer-tray]') as HTMLElement).hidden=false;root!.querySelector<HTMLDialogElement>('[data-upload-dialog]')?.close();for(const {file,path} of files){if(entries.length>=1000){summary.textContent='La cola admite hasta 1.000 archivos por lote.';break;}if(entries.some(e=>e.path===path&&e.file.size===file.size&&e.state!=='cancelled'))continue;
   const row=tbody.insertRow();row.insertCell().textContent=path;const progress=document.createElement('progress');progress.max=100;progress.value=0;progress.setAttribute('aria-label',`Progreso de ${file.name}`);row.insertCell().append(progress);row.insertCell();const cancel=document.createElement('button');cancel.type='button';cancel.className='button small';cancel.textContent='Quitar';row.insertCell().append(cancel);
   const entry:Entry={file,path,state:'waiting',row,attempts:0};entries.push(entry);cancel.addEventListener('click',()=>{if(entry.state==='waiting'||entry.state==='retrying'||entry.state==='error'){entry.state='cancelled';status(entry);cancel.disabled=true;update();}});
   if(!/\.(mp4|m4v)$/i.test(file.name)||file.size>128*1024**2){entry.state='error';status(entry,file.size>128*1024**2?'Supera 128 MiB':'Formato no admitido: usa MP4 o M4V');}else status(entry);
  }update();pump();}
  root.querySelector('[data-transfer-collapse]')?.addEventListener('click',event=>{const button=event.currentTarget as HTMLButtonElement;const content=root!.querySelector<HTMLElement>('[data-transfer-content]')!;content.hidden=!content.hidden;button.setAttribute('aria-expanded',String(!content.hidden));});
  function pump(){while(!paused&&active<Number(limit.value)){const next=entries.find(e=>e.state==='waiting');if(!next)break;void upload(next);}update();}
  class TransferError extends Error {constructor(message:string,public retryable=false,public busy=false,public auth=false){super(message);}}
  const delay=(ms:number)=>new Promise(r=>setTimeout(r,ms));
  async function jsonRequest(url:string,options:RequestInit={}){
   const r=await fetch(url,{...options,signal:AbortSignal.timeout(15000)});
   const data=await r.json().catch(()=>({error:`El servidor respondió ${r.status}.`}));
   if(!r.ok)throw new TransferError(data.error||'No se pudo completar la solicitud.',r.status===408||r.status===429||r.status>=500,r.status===429,r.status===401);
   return data;
  }
  async function waitForVideo(e:Entry){
   const deadline=Date.now()+35*60*1000;
   while(Date.now()<deadline){
    const data=await jsonRequest(`/api/assets/jobs/${e.jobId}`);
    if(data.state==='done'){e.jobId=undefined;return data;}
    if(data.state==='error'){e.jobId=undefined;throw new TransferError(data.error||'No se pudo preparar el video.');}
    status(e,'Archivo recibido · preparando video…');await delay(2500);
   }
   throw new TransferError('La preparación está tardando demasiado. Reintenta para consultar su estado.');
  }
  async function upload(e:Entry){
   active++;e.state=e.jobId?'processing':'checking';e.attempts++;status(e);
   (e.row.querySelector('button') as HTMLButtonElement).disabled=true;update();
   const progress=e.row.querySelector('progress')!;let retryDelay=0;
   const parts=e.path.split('/');parts.pop();const folder=[root!.dataset.folder,...parts].filter(Boolean).join('/');
   try{
    let result;
    if(e.jobId)result=await waitForVideo(e);
    else{
     const check=await jsonRequest('/api/assets/check',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({channelId:root!.dataset.channel,name:e.file.name,size:e.file.size,folder})});
     if(check.duplicate){e.state='skipped';progress.value=100;status(e);return;}
     e.state='uploading';status(e);update();progress.value=0;
     const response=await new Promise<{status:number;body:{error?:string;duplicate?:boolean;jobId?:string}}>((resolve,reject)=>{
      const xhr=new XMLHttpRequest();let watchdog:ReturnType<typeof setTimeout>;
      const watch=()=>{clearTimeout(watchdog);watchdog=setTimeout(()=>xhr.abort(),120000);};
      const fail=(message:string)=>{clearTimeout(watchdog);reject(new TransferError(message,true));};
      xhr.open('POST','/api/assets/upload');xhr.setRequestHeader('Content-Type','application/octet-stream');
      xhr.setRequestHeader('X-File-Name',encodeURIComponent(e.file.name));xhr.setRequestHeader('X-Channel-Id',root!.dataset.channel!);
      xhr.setRequestHeader('X-Folder',encodeURIComponent(folder));xhr.setRequestHeader('X-Upload-Async','1');xhr.timeout=35*60*1000;
      xhr.upload.onprogress=event=>{watch();if(event.lengthComputable)progress.value=Math.round(event.loaded/event.total*100);if(event.lengthComputable&&event.loaded===event.total){e.state='processing';status(e,'Archivo enviado · esperando confirmación…');}};
      xhr.onload=()=>{clearTimeout(watchdog);let body;try{body=JSON.parse(xhr.responseText);}catch{body={error:`El servidor respondió ${xhr.status}.`};}resolve({status:xhr.status,body});};
      xhr.onerror=()=>fail('Se interrumpió la conexión.');xhr.ontimeout=()=>fail('La transferencia tardó demasiado.');xhr.onabort=()=>fail('La transferencia dejó de avanzar.');
      watch();xhr.send(e.file);
     });
     if(response.status<200||response.status>=300)throw new TransferError(response.body.error||'No se pudo subir el archivo.',response.status===408||response.status===429||response.status>=500,response.status===429,response.status===401);
     if(response.status===202&&response.body.jobId){e.jobId=response.body.jobId;e.state='processing';result=await waitForVideo(e);}
     else result=response.body;
    }
    e.state=result.duplicate?'skipped':'done';progress.value=100;status(e);document.dispatchEvent(new Event('om-library-uploaded'));
   }catch(error){
    if(error instanceof TransferError&&error.auth){
     paused=true;e.state='waiting';status(e,'Sesión vencida. Inicia sesión en otra pestaña y pulsa Continuar pendientes.');
     root!.querySelector<HTMLButtonElement>('[data-pause-queue]')!.textContent='Continuar pendientes';
     return;
    }
    const transient=!(error instanceof TransferError)||error.retryable;
    const maximum=error instanceof TransferError&&error.busy?120:6;
    if(transient&&e.attempts<maximum){retryDelay=Math.min(30000,2000*2**Math.min(e.attempts-1,4));e.state='retrying';status(e,`Reintentando en ${retryDelay/1000} s…`);}
    else{e.state='error';status(e,error instanceof Error?error.message:'No se pudo subir el archivo.');}
   }finally{
    active--;
    if(e.state==='error'||e.state==='retrying'||e.state==='waiting')(e.row.querySelector('button') as HTMLButtonElement).disabled=false;
    if(retryDelay)setTimeout(()=>{if(e.state==='retrying'){e.state='waiting';status(e);pump();}},retryDelay);
    pump();
   }
  }
  const filesInput=root.querySelector<HTMLInputElement>('[data-files]')!,dirInput=root.querySelector<HTMLInputElement>('[data-directory]')!;
  dirInput.multiple=true;dirInput.setAttribute('webkitdirectory','');(dirInput as HTMLInputElement & {webkitdirectory?:boolean}).webkitdirectory=true;
  const pick=(input:HTMLInputElement)=>{input.value='';input.click();};
  root.querySelector('[data-pick-files]')?.addEventListener('click',()=>pick(filesInput));root.querySelector('[data-pick-folder]')?.addEventListener('click',()=>pick(dirInput));
  filesInput.addEventListener('change',()=>add([...filesInput.files||[]].map(file=>({file,path:file.name}))));dirInput.addEventListener('change',()=>add([...dirInput.files||[]].map(file=>({file,path:file.webkitRelativePath||file.name}))));
  root.querySelector<HTMLButtonElement>('[data-pause-queue]')?.addEventListener('click',event=>{paused=!paused;(event.currentTarget as HTMLButtonElement).textContent=paused?'Continuar pendientes':'Pausar pendientes';pump();});limit.addEventListener('change',pump);
  retry.addEventListener('click',()=>{entries.filter(e=>e.state==='error'&&/\.(mp4|m4v)$/i.test(e.file.name)&&e.file.size<=128*1024**2).forEach(e=>{e.state='waiting';e.attempts=0;status(e);});pump();});
  const drop=root.querySelector<HTMLElement>('[data-drop]')!;drop.addEventListener('click',()=>pick(filesInput));drop.addEventListener('keydown',e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();pick(filesInput);}});drop.addEventListener('dragover',e=>{e.preventDefault();drop.classList.add('drag-over');});drop.addEventListener('dragleave',()=>drop.classList.remove('drag-over'));drop.addEventListener('drop',async e=>{e.preventDefault();drop.classList.remove('drag-over');try{add(await collectDropped([...(e.dataTransfer?.items||[])]));}catch{summary.textContent='No se pudo leer la carpeta. Usa el botón Subir carpeta.';}});
  window.addEventListener('beforeunload',event=>{if(active||entries.some(e=>e.state==='waiting'||e.state==='retrying')){event.preventDefault();}});
}
