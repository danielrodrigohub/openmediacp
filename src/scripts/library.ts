import {bindAssetPreview} from './asset-preview';
const library=document.querySelector<HTMLElement>('[data-library]');
if(library){
 const body=library.querySelector<HTMLTableSectionElement>('[data-library-rows]')!,search=library.querySelector<HTMLInputElement>('[data-library-search]')!,type=library.querySelector<HTMLSelectElement>('[data-library-type]')!;
 let rows=[...body.rows];
 bindAssetPreview(library);
 const selected=new Set<string>();let page=0,ascending=true;const perPage=20;
 const fold=(v:string)=>v.toLocaleLowerCase('es').normalize('NFD').replace(/[\u0300-\u036f]/g,'');
 function update(){const q=fold(search.value);const visible=rows.filter(r=>(type.value==='all'||r.dataset.kind===type.value)&&fold(r.dataset.name||'').includes(q)).sort((a,b)=>{const folderOrder=(a.dataset.kind==='folder'?0:1)-(b.dataset.kind==='folder'?0:1);return folderOrder||(a.dataset.name||'').localeCompare(b.dataset.name||'','es')*(ascending?1:-1);});page=Math.max(0,Math.min(page,Math.max(0,Math.ceil(visible.length/perPage)-1)));const onPage=visible.slice(page*perPage,(page+1)*perPage);rows.forEach(r=>r.hidden=true);visible.forEach(r=>body.append(r));onPage.forEach(r=>{
   r.hidden=false;
   const image=r.querySelector<HTMLImageElement>('img[data-thumbnail]');
   if(image&&!image.hasAttribute('src')){
    image.addEventListener('load',()=>{image.hidden=false;},{once:true});
    image.hidden=false;
    image.addEventListener('error',()=>{image.hidden=true;},{once:true});
    image.src=image.dataset.thumbnail!;
   }
  });
  (library!.querySelector('[data-library-empty]') as HTMLElement).hidden=visible.length>0;
  library!.querySelector('[data-library-count]')!.textContent=`Mostrando ${onPage.length} de ${visible.length} elementos`;
  library!.querySelector('[data-library-page]')!.textContent=String(page+1);
  (library!.querySelector('[data-library-prev]') as HTMLButtonElement).disabled=page===0;
  (library!.querySelector('[data-library-next]') as HTMLButtonElement).disabled=(page+1)*perPage>=visible.length;
  const selectors=onPage.flatMap(r=>[...r.querySelectorAll<HTMLInputElement>('[data-select-asset]:not(:disabled)')]);const toggle=library!.querySelector<HTMLInputElement>('[data-select-page]')!;toggle.disabled=!selectors.length;toggle.checked=selectors.length>0&&selectors.every(i=>selected.has(i.value));toggle.indeterminate=!toggle.checked&&selectors.some(i=>selected.has(i.value));
  (library!.querySelector('[data-library-selection]') as HTMLElement).hidden=selected.size===0;library!.querySelector('[data-selection-count]')!.textContent=`${selected.size} ${selected.size===1?'seleccionado':'seleccionados'}`;(library!.querySelector('[data-add-selected]') as HTMLAnchorElement).href=`/cliente/playlists/?channel=${library!.dataset.channel}&add=${[...selected].join(',')}`;
 }
 library.addEventListener('change',event=>{
  const input=event.target as HTMLInputElement;
  if(!input.matches('[data-select-asset]'))return;
  if(input.checked)selected.add(input.value);else selected.delete(input.value);
  input.closest('tr')!.dataset.selected=String(input.checked);
  update();
 });
 library.querySelector<HTMLInputElement>('[data-select-page]')!.addEventListener('change',event=>{const checked=(event.target as HTMLInputElement).checked;rows.filter(r=>!r.hidden).forEach(r=>{const input=r.querySelector<HTMLInputElement>('[data-select-asset]:not(:disabled)');if(input){input.checked=checked;if(checked)selected.add(input.value);else selected.delete(input.value);r.dataset.selected=String(checked);}});update();});
 search.addEventListener('input',()=>{page=0;update();});type.addEventListener('change',()=>{page=0;update();});library.querySelector('[data-sort-library]')!.addEventListener('click',()=>{ascending=!ascending;update();});library.querySelector('[data-library-prev]')!.addEventListener('click',()=>{page--;update();});library.querySelector('[data-library-next]')!.addEventListener('click',()=>{page++;update();});update();

 library.addEventListener('toggle',event=>{
  const menu=event.target as HTMLDetailsElement;
  if(!menu.matches('.row-menu')||!menu.open)return;
  const popup=menu.querySelector<HTMLElement>('.user-popover')!;
  const anchor=menu.querySelector('summary')!.getBoundingClientRect();
  popup.style.position='fixed';popup.style.right='auto';
  popup.style.left=Math.max(12,Math.min(anchor.right-popup.offsetWidth,innerWidth-popup.offsetWidth-12))+'px';
  popup.style.top=(anchor.bottom+popup.offsetHeight+8<innerHeight?anchor.bottom+4:Math.max(12,anchor.top-popup.offsetHeight-4))+'px';
 },true);

 const refreshStatus=document.querySelector<HTMLElement>('[data-library-refresh-status]')!;
 let refreshing=false, pending=false;
 async function refreshLibrary(){
  pending=true;
  if(refreshing)return;
  refreshing=true;
  try{
   while(pending){
    pending=false;
    const response=await fetch(location.href,{cache:'no-store'});
    if(!response.ok)throw new Error();
    const fresh=new DOMParser().parseFromString(await response.text(),'text/html');
    const next=fresh.querySelector<HTMLTableSectionElement>('[data-library-rows]');
    if(!next)throw new Error();
    const previous=new Map(rows.filter(row=>row.dataset.id).map(row=>[row.dataset.id,row]));
    rows=[...next.rows].map(row=>{
     const existing=previous.get(row.dataset.id);
     if(existing&&existing.querySelector<HTMLInputElement>('[data-select-asset]')?.disabled===row.querySelector<HTMLInputElement>('[data-select-asset]')?.disabled)return existing;
     return row;
    });
    const ids=new Set(rows.map(row=>row.dataset.id));
    for(const id of selected)if(!ids.has(id))selected.delete(id);
    for(const row of rows){
     const checkbox=row.querySelector<HTMLInputElement>('[data-select-asset]');
     if(checkbox&&selected.has(checkbox.value)){
      checkbox.checked=true;
      row.dataset.selected='true';
     }
    }
    body.replaceChildren(...rows);
    const storage=fresh.querySelector('[data-library-storage]');
    if(storage)document.querySelector('[data-library-storage]')?.replaceWith(storage);
    update();
    refreshStatus.hidden=true;
   }
  }catch{
   refreshStatus.textContent='El video se subió. Usa «Actualizar biblioteca» para volver a cargar la lista.';
   refreshStatus.hidden=false;
  }finally{
   refreshing=false;
   if(pending)void refreshLibrary();
  }
 }
 document.addEventListener('om-library-uploaded',()=>void refreshLibrary());
 document.querySelector('[data-refresh-library]')?.addEventListener('click',event=>{
  event.preventDefault();
  void refreshLibrary();
 });
}
