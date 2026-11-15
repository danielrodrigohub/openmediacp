export type FileEntryLike={
  isFile:boolean;
  isDirectory:boolean;
  name:string;
  file:(ok:(file:File)=>void,fail:(error:Error)=>void)=>void;
  createReader:()=>{readEntries:(ok:(entries:FileEntryLike[])=>void,fail:(error:Error)=>void)=>void};
};
export type DropItemLike={
  webkitGetAsEntry?:()=>unknown;
  getAsFile:()=>File|null;
};
export type DroppedFile={file:File;path:string};

// Drag data is protected and revoked as soon as the drop handler yields.
// Capture every entry and file synchronously before the first await, otherwise
// only the first dropped item survives and the rest of the queue is lost.
export function captureDropItems(items:DropItemLike[]):{entry:FileEntryLike|null;file:File|null}[] {
  return items.map(item=>{
    let entry:FileEntryLike|null=null;
    try{entry=(item.webkitGetAsEntry?.() as FileEntryLike|undefined)??null;}catch{entry=null;}
    let file:File|null=null;
    try{file=item.getAsFile();}catch{file=null;}
    return {entry,file};
  });
}
export async function walkEntry(entry:FileEntryLike,prefix=''):Promise<DroppedFile[]> {
  if(entry.isFile){
    const file=await new Promise<File>((ok,fail)=>entry.file(ok,fail));
    return [{file,path:prefix+file.name}];
  }
  const result:DroppedFile[]=[];
  const reader=entry.createReader();
  while(true){
    const children=await new Promise<FileEntryLike[]>((ok,fail)=>reader.readEntries(ok,fail));
    if(!children.length)break;
    for(const child of children)result.push(...await walkEntry(child,prefix+entry.name+'/'));
    if(result.length>1000)break;
  }
  return result;
}
export async function collectDropped(items:DropItemLike[]):Promise<DroppedFile[]> {
  const captures=captureDropItems(items),all:DroppedFile[]=[];
  for(const capture of captures){
    if(capture.entry)all.push(...await walkEntry(capture.entry));
    else if(capture.file)all.push({file:capture.file,path:capture.file.name});
  }
  return all;
}
