import {playlistAssetIds,maxPlaylistEntries,maxPlaylistVideos,type PlaylistEntry} from '../server/playlist-entries';
import {mediaDuration,mediaTitle,type MediaAsset} from '../lib/media';
import type {AutoDJ} from '../server/playlist';
type Boot={assets:(MediaAsset&{available:boolean})[];selected:string[];policy:AutoDJ;channel:string;revision:string;add:string[]};
type Selection={entries:PlaylistEntry[];mode:string;reshuffle:boolean;every:number;separators:PlaylistEntry[]};
const form=document.querySelector<HTMLFormElement>('[data-playlist-editor]');
if(form){
 const boot:Boot=JSON.parse(form.dataset.config!),assets=new Map(boot.assets.map(a=>[a.id,a]));
 let revision=boot.revision,initial:Selection={entries:boot.policy.entries??[...boot.selected],mode:boot.policy.shuffle?'random':'ordered',reshuffle:boot.policy.reshuffle,every:boot.policy.every,separators:boot.policy.separatorEntries??[...boot.policy.separatorIds]};
 let state:Selection=structuredClone(initial),saving=false,dirty=false,picking:PlaylistEntry[]=[];
 const mode=form.elements.namedItem('mode') as HTMLSelectElement,reshuffle=form.elements.namedItem('reshuffle') as HTMLInputElement,every=form.elements.namedItem('every') as HTMLInputElement;
 const list=form.querySelector<HTMLOListElement>('[data-playlist-items]')!,template=form.querySelector<HTMLTemplateElement>('[data-playlist-row]')!,result=form.querySelector<HTMLElement>('[data-form-result]')!;
 const dialog=form.querySelector<HTMLDialogElement>('[data-separator-dialog]')!;
 const search=form.querySelector<HTMLInputElement>('[data-catalog-search]')!,folder=form.querySelector<HTMLSelectElement>('[data-catalog-folder]')!;
 const save=form.querySelector<HTMLButtonElement>('[data-save-playlist]')!,discard=form.querySelector<HTMLButtonElement>('[data-discard-playlist]')!;
 const fold=(s:string)=>s.toLocaleLowerCase('es').normalize('NFD').replace(/[\u0300-\u036f]/g,'');
 function controls(){mode.value=state.mode;reshuffle.checked=state.reshuffle;reshuffle.disabled=state.mode!=='random';every.value=String(state.every);}
 function error(message:string){result.classList.add('error');result.textContent=message;}
 function update(){
  mode.disabled=saving;every.disabled=saving;reshuffle.disabled=saving||state.mode!=='random';(form!.querySelector('[data-choose-separators]') as HTMLButtonElement).disabled=saving;
  dirty=JSON.stringify(state)!==JSON.stringify(initial);form!.classList.toggle('is-dirty',dirty);save.disabled=saving||!dirty;discard.disabled=saving||!dirty;
  form!.querySelector('[data-save-state]')!.textContent=saving?'Guardando…':dirty?'Cambios sin guardar':'Sin cambios pendientes';
  const ids=playlistAssetIds(state.entries);
  form!.querySelector('[data-playlist-total]')!.textContent=`${ids.length} ${ids.length===1?'video':'videos'}`;
  form!.querySelector('[data-mobile-playlist-count]')!.textContent=String(ids.length);
  list.replaceChildren();
  state.entries.forEach((entry,index)=>{
   const isFolder=typeof entry!=='string';
   const a=isFolder?undefined:assets.get(entry);
   const title=isFolder?entry.folder:a?mediaTitle(a.name):'Archivo no disponible';
   const node=template.content.firstElementChild!.cloneNode(true) as HTMLLIElement;
   node.dataset.entryIndex=String(index);
   node.querySelector('.order-number')!.textContent=String(index+1).padStart(2,'0');
   const name=node.querySelector('strong')!;
   name.textContent=title;
   name.title=a?.name||title;
   const meta=node.querySelector('small')!;
   if(isFolder){
    (node.querySelector('[data-entry-video]') as HTMLElement).hidden=true;
    (node.querySelector('[data-entry-folder]') as HTMLElement).hidden=false;
    meta.textContent=`Carpeta · ${entry.ids.length} ${entry.ids.length===1?'video':'videos'} · Aleatorio`;
    const details=node.querySelector<HTMLDetailsElement>('details')!;
    details.hidden=false;
    const children=details.querySelector('ul')!;
    for(const id of entry.ids){
     const child=document.createElement('li');
     const asset=assets.get(id);
     child.textContent=asset?.available?mediaTitle(asset.name):'Archivo no disponible';
     children.append(child);
    }
   }else{
    meta.textContent=a?.available?`${a.folder||'Carpeta principal'} · ${mediaDuration(a.duration)}`:'Archivo no disponible.';
    if(!a?.available)meta.classList.add('red');
   }
   node.querySelectorAll<HTMLButtonElement>('[data-editor-action]').forEach(button=>{
    const action=button.dataset.editorAction;
    button.setAttribute('aria-label',`${action==='up'?'Subir':action==='down'?'Bajar':'Quitar'} ${title}`);
    button.disabled=saving||action==='up'&&index===0||action==='down'&&index===state.entries.length-1;
   });
   list.append(node);
  });
  (form!.querySelector('[data-playlist-empty]') as HTMLElement).hidden=state.entries.length>0;
  form!.querySelector('[data-order-note]')!.textContent=state.mode==='random'
   ?'El modo aleatorio mezcla los videos de toda la selección.'
   :'Las entradas siguen el orden de la lista. Los videos dentro de cada carpeta se barajan.';
  const durations=ids.map(id=>assets.get(id)?.duration||0);
  const total=durations.reduce((sum,duration)=>sum+duration,0);
  const missing=durations.filter(duration=>!duration).length;
  form!.querySelector('[data-duration-summary]')!.textContent=ids.length
   ?`${missing?'Duración conocida':'Duración de la lista'}: ${total?mediaDuration(total):'No disponible'}${missing?` · ${missing} sin duración`:''}. No incluye separadores variables.`
   :'Sin videos seleccionados se utiliza la cartela de emergencia.';
  const chips=form!.querySelector('[data-separator-chips]')!;
  chips.replaceChildren();
  (form!.querySelector('[data-separator-empty]') as HTMLElement).hidden=state.separators.length>0;
  state.separators.forEach((entry,index)=>{
   const chip=document.createElement('span');
   chip.className='separator-chip';
   const name=document.createElement('span');
   name.textContent=typeof entry==='string'
    ?mediaTitle(assets.get(entry)?.name||'Archivo no disponible')
    :`Carpeta ${entry.folder} · ${entry.ids.length} ${entry.ids.length===1?'video':'videos'}`;
   const button=document.createElement('button');
   button.type='button';
   button.textContent='×';
   button.dataset.removeSeparator=String(index);
   button.disabled=saving;
   button.setAttribute('aria-label','Quitar separador '+name.textContent);
   chip.append(name,button);
   chips.append(chip);
  });
  filter();
 }
 function filter(){let shown=0;form!.querySelectorAll<HTMLElement>('[data-catalog-id]').forEach(row=>{const a=assets.get(row.dataset.catalogId!)!;row.hidden=!(fold(a.name+' '+a.folder).includes(fold(search.value))&&(folder.value==='all'||'folder:'+a.folder===folder.value));if(!row.hidden)shown++;const b=row.querySelector<HTMLButtonElement>('[data-editor-action]')!;b.disabled=saving||state.entries.includes(a.id)||!a.available;b.setAttribute('aria-label',state.entries.includes(a.id)?`${a.name} ya está en la playlist`:`Añadir ${a.name}`);});form!.querySelectorAll<HTMLElement>('[data-catalog-group]').forEach(group=>{
   group.hidden=!group.querySelector('[data-catalog-id]:not([hidden])');
   const details=group.querySelector<HTMLDetailsElement>('details')!;
   if(search.value||folder.value!=='all')details.open=true;
   const button=group.querySelector<HTMLButtonElement>('[data-add-folder]');
   if(button)button.disabled=saving||hasFolder(button.dataset.addFolder!)||!folderAssets(button.dataset.addFolder!).length;
  });(form!.querySelector('[data-catalog-empty]') as HTMLElement).hidden=shown>0||!boot.assets.length;}
 function hasFolder(path:string){
  return state.entries.some(entry=>typeof entry!=='string'&&entry.folder===path);
 }
 function folderAssets(path:string){
  return boot.assets.filter(asset=>asset.folder===path&&asset.available).map(asset=>asset.id);
 }
 function insert(entry:PlaylistEntry,index=state.entries.length){
  if(saving)return;
  const entries=[...state.entries];
  entries.splice(index,0,entry);
  if(entries.length>maxPlaylistEntries||playlistAssetIds(entries).length>maxPlaylistVideos){
   error(`Puedes seleccionar hasta ${maxPlaylistEntries} entradas y ${maxPlaylistVideos} videos distintos.`);
   return;
  }
  result.classList.remove('error');
  result.textContent='';
  state.entries=entries;
  update();
 }
 function addFolder(path:string,index?:number){
  if(!path||hasFolder(path))return;
  const ids=folderAssets(path);
  if(ids.length)insert({folder:path,ids},index);
 }
 function add(id:string,index?:number){
  if(!state.entries.includes(id)&&assets.get(id)?.available)insert(id,index);
 }
 form.addEventListener('click',event=>{
  const target=event.target as Element;
  const folder=target.closest<HTMLButtonElement>('[data-add-folder]');
  if(folder){addFolder(folder.dataset.addFolder!);return;}
  const button=target.closest<HTMLButtonElement>('[data-editor-action]');
  if(button&&!saving){
   const action=button.dataset.editorAction;
   if(action==='add'){add(button.dataset.id!);return;}
   const row=button.closest<HTMLElement>('[data-entry-index]');
   if(!row)return;
   const index=Number(row.dataset.entryIndex);
   if(action==='remove')state.entries.splice(index,1);
   else{
    const next=index+(action==='up'?-1:1);
    if(next>=0&&next<state.entries.length)[state.entries[index],state.entries[next]]=[state.entries[next],state.entries[index]];
   }
   update();
  }
  const chip=target.closest<HTMLButtonElement>('[data-remove-separator]');if(chip&&!saving){state.separators.splice(Number(chip.dataset.removeSeparator),1);update();}
 });
 mode.addEventListener('change',()=>{state.mode=mode.value;if(state.mode!=='random')state.reshuffle=false;controls();update();});reshuffle.addEventListener('change',()=>{state.reshuffle=reshuffle.checked;update();});every.addEventListener('input',()=>{state.every=Number(every.value);update();});search.addEventListener('input',filter);folder.addEventListener('change',filter);
 form.querySelectorAll<HTMLButtonElement>('[data-editor-tab]').forEach(b=>b.addEventListener('click',()=>{form!.dataset.tab=b.dataset.editorTab;form!.querySelectorAll('[data-editor-tab]').forEach(t=>t.setAttribute('aria-selected',String(t===b)));}));
 const pickerInputs=[...dialog.querySelectorAll<HTMLInputElement>('[data-separator-option],[data-separator-folder]')];
 const apply=dialog.querySelector<HTMLButtonElement>('[data-apply-separators]')!;
 const pickingStatus=dialog.querySelector<HTMLElement>('[data-separator-picking]')!;
 function updatePicker(){
  const total=playlistAssetIds(picking).length;
  apply.disabled=picking.length>maxPlaylistEntries||total>maxPlaylistVideos;
  pickingStatus.textContent=apply.disabled?`Máximo ${maxPlaylistEntries} entradas y ${maxPlaylistVideos} videos distintos.`:
   `${total} ${total===1?'video seleccionado':'videos seleccionados'}`;
  for(const input of pickerInputs){
   input.checked=input.hasAttribute('data-separator-folder')
    ?picking.some(entry=>typeof entry!=='string'&&entry.folder===input.value)
    :picking.includes(input.value);
  }
 }
 form.querySelector('[data-choose-separators]')!.addEventListener('click',()=>{
  picking=structuredClone(state.separators);
  updatePicker();
  dialog.showModal();
 });
 pickerInputs.forEach(input=>input.addEventListener('change',()=>{
  const path=input.hasAttribute('data-separator-folder')?input.value:null;
  if(!input.checked){
   picking=picking.filter(entry=>path===null?entry!==input.value:typeof entry==='string'||entry.folder!==path);
  }else{
   picking.push(path===null?input.value:{folder:path,ids:folderAssets(path)});
  }
  updatePicker();
 }));
 dialog.querySelectorAll('[data-cancel-separators]').forEach(button=>button.addEventListener('click',()=>dialog.close()));
 apply.addEventListener('click',()=>{
  if(apply.disabled||saving)return;
  state.separators=structuredClone(picking);
  dialog.close();
  update();
 });
 discard.addEventListener('click',()=>{state=structuredClone(initial);result.textContent='';controls();update();});
 const dragFolder='application/x-openmediacp-folder';
 const dragVideo='application/x-openmediacp-asset';
 const dragEntry='application/x-openmediacp-entry';
 form.addEventListener('dragstart',event=>{
  if(saving||!event.dataTransfer)return;
  const target=event.target as Element;
  const entry=target.closest<HTMLElement>('[data-entry-index]');
  const folder=target.closest<HTMLElement>('[data-drag-folder]')?.dataset.dragFolder;
  const id=target.closest<HTMLElement>('[data-catalog-id]')?.dataset.catalogId;
  if(entry){
   event.dataTransfer.setData(dragEntry,entry.dataset.entryIndex!);
   event.dataTransfer.effectAllowed='move';
  }else if(folder&&!hasFolder(folder)&&folderAssets(folder).length){
   event.dataTransfer.setData(dragFolder,folder);
   event.dataTransfer.effectAllowed='copy';
  }else if(id&&assets.get(id)?.available&&!state.entries.includes(id)){
   event.dataTransfer.setData(dragVideo,id);
   event.dataTransfer.effectAllowed='copy';
  }else event.preventDefault();
 });
 const dropZone=form.querySelector<HTMLElement>('[data-editor-playlist]')!;
 const clearDrop=()=>{
  dropZone.classList.remove('is-drop-target');
  list.querySelectorAll('.drag-over').forEach(row=>row.classList.remove('drag-over'));
 };
 dropZone.addEventListener('dragover',event=>{
  if(saving||!event.dataTransfer?.types.some(type=>[dragEntry,dragFolder,dragVideo].includes(type)))return;
  event.preventDefault();
  clearDrop();
  dropZone.classList.add('is-drop-target');
  (event.target as Element).closest('.playlist-row')?.classList.add('drag-over');
 });
 dropZone.addEventListener('dragleave',event=>{
  if(!dropZone.contains(event.relatedTarget as Node|null))clearDrop();
 });
 dropZone.addEventListener('drop',event=>{
  clearDrop();
  if(saving||!event.dataTransfer)return;
  const row=(event.target as Element).closest<HTMLElement>('[data-entry-index]');
  const index=row?Number(row.dataset.entryIndex):state.entries.length;
  const folder=event.dataTransfer.getData(dragFolder);
  const id=event.dataTransfer.getData(dragVideo);
  const moved=event.dataTransfer.getData(dragEntry);
  if(!folder&&!id&&!moved)return;
  event.preventDefault();
  if(folder){addFolder(folder,index);return;}
  if(id){add(id,index);return;}
  const from=Number(moved);
  if(!Number.isInteger(from)||from<0||from>=state.entries.length||from===index)return;
  const [entry]=state.entries.splice(from,1);
  state.entries.splice(index-(from<index?1:0),0,entry);
  update();
 });
 form.addEventListener('dragend',clearDrop);
 form.addEventListener('submit',async event=>{event.preventDefault();if(saving||!dirty||!form!.reportValidity())return;saving=true;result.classList.remove('error');result.textContent='';update();try{const response=await fetch(`/api/channels/${boot.channel}`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'fallback',assets:playlistAssetIds(state.entries),entries:state.entries,revision,options:{shuffle:state.mode==='random',reshuffle:state.reshuffle,every:state.every,separatorIds:playlistAssetIds(state.separators),separatorEntries:state.separators}})});const data=await response.json();if(!response.ok){error(data.error||'No se pudo guardar la playlist.');return;}revision=data.revision||revision;initial=structuredClone(state);result.textContent=data.message||'Playlist guardada.';const badge=document.querySelector<HTMLElement>('[data-playlist-configured]');if(badge){badge.textContent=state.entries.length?'Respaldo configurado':'Sin playlist configurada';badge.classList.toggle('green',state.entries.length>0);badge.classList.toggle('gray',state.entries.length===0);}}catch{error('No se pudo contactar con el servidor. Tus cambios siguen en el editor.');}finally{saving=false;update();}});
 window.addEventListener('beforeunload',event=>{if(dirty){event.preventDefault();}});
 controls();for(const id of boot.add||[])if(assets.get(id)?.available&&!state.entries.includes(id)&&state.entries.length<maxPlaylistEntries&&(playlistAssetIds(state.entries).includes(id)||playlistAssetIds(state.entries).length<maxPlaylistVideos))state.entries.push(id);if(boot.add?.length){const url=new URL(location.href);url.searchParams.delete('add');history.replaceState(null,'',url);}update();
}
