import playerUrl from 'ovenplayer/dist/ovenplayer.js?url';

type Player = { remove(): void };
type Oven = { create(element: HTMLElement, options: unknown): Player };

export function bindAssetPreview(library: HTMLElement) {
 const dialog = document.querySelector<HTMLDialogElement>('[data-asset-preview]')!;
 const title = dialog.querySelector<HTMLElement>('h2')!;
 const screen = dialog.querySelector<HTMLElement>('.asset-preview-screen')!;
 const status = dialog.querySelector<HTMLElement>('[data-preview-status]')!;
 let loading: Promise<Oven> | undefined;
 let player: Player | undefined;
 let version = 0;

 function load() {
  return loading ??= new Promise<Oven>((resolve, reject) => {
   const script = document.createElement('script');
   script.src = playerUrl;
   script.onload = () => {
    const oven = (window as unknown as { OvenPlayer?: Oven }).OvenPlayer;
    if (oven) resolve(oven);
    else reject(new Error('OvenPlayer no está disponible.'));
   };
   script.onerror = () => reject(new Error('No se pudo cargar OvenPlayer.'));
   document.head.append(script);
  }).catch(error => { loading = undefined; throw error; });
 }

 library.addEventListener('click', async event => {
  const button = (event.target as Element).closest<HTMLButtonElement>('[data-preview-asset]');
  const id = button?.closest('tr')?.dataset.id;
  if (!id || dialog.open) return;
  const current = ++version;
  const file = '/api/assets/' + id;
  title.textContent = button.closest('tr')!.dataset.name || 'Vista previa del video';
  status.textContent = 'Cargando vista previa…';
  dialog.showModal();
  try {
   const oven = await load();
   if (!dialog.open || current !== version) return;
   const mount = document.createElement('div');
   screen.replaceChildren(mount);
   player = oven.create(mount, {
    sources: [{ type: 'mp4', file }],
    image: file + '?thumbnail=1',
    autoStart: false,
    aspectRatio: '16:9',
    controls: true,
    showBigPlayButton: true,
   });
   const labels = {
    '.op-play-button': 'Reproducir o pausar',
    '.op-volume-button': 'Activar o silenciar audio',
    '.op-setting-button': 'Ajustes de reproducción',
    '.op-fullscreen-button': 'Pantalla completa',
   };
   for (const [selector, label] of Object.entries(labels)) screen.querySelector(selector)?.setAttribute('aria-label', label);
   status.textContent = '';
  } catch {
   if (dialog.open && current === version) status.textContent = 'No se pudo abrir la vista previa. Cierra e inténtalo otra vez.';
  }
 });

 dialog.addEventListener('close', () => {
  ++version;
  player?.remove();
  player = undefined;
  screen.replaceChildren();
 });
}
