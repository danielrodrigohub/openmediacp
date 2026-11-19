type AirplayAudio = HTMLAudioElement & { webkitShowPlaybackTargetPicker?: () => void; webkitCurrentPlaybackTargetIsWireless?: boolean };
// The Google SDK is loaded externally only on the public radio page.
type CastWindow = Window & { cast?: any; chrome?: any; __onGCastApiAvailable?: (available: boolean) => void };

export function initRadioWireless(options: { audio: HTMLAudioElement; live: HTMLAudioElement; active: () => HTMLAudioElement; title: string; onEnd: () => void }) {
  const airplay = document.querySelector<HTMLButtonElement>('#radio-airplay')!;
  const castButton = document.querySelector<HTMLButtonElement>('#radio-cast')!;
  const status = document.createElement('p');
  status.setAttribute('role', 'status');
  status.style.fontSize = '13px';
  castButton.closest('.custom-controls')!.after(status);
  const players = [options.audio, options.live];
  for (const player of players) {
    player.setAttribute('x-webkit-airplay', 'allow');
    if ((player as AirplayAudio).webkitShowPlaybackTargetPicker) airplay.hidden = false;
    player.addEventListener('webkitcurrentplaybacktargetiswirelesschanged', () => {
      const wireless = (player as AirplayAudio).webkitCurrentPlaybackTargetIsWireless;
      airplay.setAttribute('aria-pressed', String(Boolean(wireless)));
      status.textContent = wireless ? 'Escuchando por AirPlay' : '';
    });
  }
  airplay.onclick = () => (options.active() as AirplayAudio).webkitShowPlaybackTargetPicker?.();

  const win = window as CastWindow;
  let context: any;
  let remote: any;
  let controller: any;
  let loadedUrl = '';
  let loading = false;
  const connected = () => Boolean(context?.getCurrentSession());
  async function load(player: HTMLAudioElement) {
    const session = context?.getCurrentSession();
    if (!session || loading) return;
    const source = player.currentSrc || player.src;
    if (!source) { status.textContent = 'Selecciona una grabación o el directo.'; return; }
    const url = new URL(source, location.href); url.hash = '';
    const api = win.chrome.cast.media;
    const isLive = player === options.live;
    const type = isLive ? (/\.m3u8(?:\?|$)/i.test(url.href) ? 'application/x-mpegURL' : /\.aac(?:\?|$)/i.test(url.href) ? 'audio/aac' : 'audio/mpeg') : 'audio/ogg';
    const media = new api.MediaInfo(url.href, type);
    media.streamType = isLive ? api.StreamType.LIVE : api.StreamType.BUFFERED;
    media.metadata = new api.MusicTrackMediaMetadata();
    media.metadata.title = options.title;
    const request = new api.LoadRequest(media);
    request.autoplay = true;
    request.currentTime = isLive ? 0 : player.currentTime;
    loading = true;
    status.textContent = 'Conectando con Google Cast…';
    try {
      await session.loadMedia(request);
      loadedUrl = url.href;
      players.forEach(item => item.pause());
      status.textContent = 'Escuchando en ' + session.getCastDevice().friendlyName;
    } catch { status.textContent = 'No se pudo enviar este audio. Comprueba que el dispositivo pueda acceder a la fuente y reproducir su formato.'; }
    finally { loading = false; }
  }
  for (const player of players) player.addEventListener('play', () => {
    if (!connected() || loading) return;
    const url = new URL(player.currentSrc || player.src, location.href); url.hash = '';
    if (url.href !== loadedUrl) void load(player);
    else { player.pause(); if (remote?.isPaused) controller.playOrPause(); }
  });
  document.querySelector('#toggle-play')?.addEventListener('click', event => {
    if (!connected() || !remote?.isMediaLoaded) return;
    event.stopImmediatePropagation(); controller.playOrPause();
  }, true);
  document.querySelector<HTMLInputElement>('#play-volume')?.addEventListener('input', event => {
    if (!connected()) return;
    remote.volumeLevel = Number((event.target as HTMLInputElement).value); controller.setVolumeLevel();
  });
  for (const [id, delta] of [['skip-back', -15], ['skip-forward', 15]] as const) {
    document.getElementById(id)?.addEventListener('click', event => {
      if (!connected() || !remote?.isMediaLoaded) return;
      event.stopImmediatePropagation();
      if (remote.canSeek) { remote.currentTime = Math.max(0, Math.min(remote.duration, remote.currentTime + delta)); controller.seek(); }
    }, true);
  }
  for (const name of ['input', 'change']) document.querySelector('#play-progress')?.addEventListener(name, event => {
    if (!connected() || !remote?.isMediaLoaded) return;
    event.stopImmediatePropagation();
    if (remote.canSeek) { remote.currentTime = remote.duration * Number((event.target as HTMLInputElement).value) / 100; controller.seek(); }
  }, true);
  document.querySelector('#mute-toggle')?.addEventListener('click', event => {
    if (!connected()) return;
    event.stopImmediatePropagation(); controller.muteOrUnmute();
  }, true);
  castButton.onclick = async () => {
    try {
      if (connected()) { context.endCurrentSession(true); return; }
      await context.requestSession();
      await load(options.active());
    } catch { status.textContent = 'No se inició la conexión con Google Cast.'; }
  };
  function initialize(available: boolean) {
    if (!available || !win.cast?.framework) return;
    const framework = win.cast.framework;
    context = framework.CastContext.getInstance();
    context.setOptions({ receiverApplicationId: win.chrome.cast.media.DEFAULT_MEDIA_RECEIVER_APP_ID, autoJoinPolicy: win.chrome.cast.AutoJoinPolicy.ORIGIN_SCOPED });
    remote = new framework.RemotePlayer(); controller = new framework.RemotePlayerController(remote);
    castButton.hidden = false;
    controller.addEventListener(framework.RemotePlayerEventType.CURRENT_TIME_CHANGED, () => {
      if (!connected() || !remote.isMediaLoaded) return;
      const progress = document.querySelector<HTMLInputElement>('#play-progress')!;
      progress.disabled = !remote.canSeek;
      progress.value = remote.duration ? String(100 * remote.currentTime / remote.duration) : '0';
      const format = (value: number) => `${Math.floor(value / 60)}:${Math.floor(value % 60).toString().padStart(2, '0')}`;
      document.querySelector('#play-time')!.textContent = remote.canSeek ? `${format(remote.currentTime)} / ${format(remote.duration)}` : 'En directo';
    });
    controller.addEventListener(framework.RemotePlayerEventType.IS_PAUSED_CHANGED, () => {
      if (!connected()) return;
      const toggle = document.querySelector<HTMLButtonElement>('#toggle-play')!;
      toggle.setAttribute('aria-label', remote.isPaused ? 'Reproducir' : 'Pausar');
      toggle.querySelector<HTMLElement>('.icon-play')!.hidden = !remote.isPaused;
      toggle.querySelector<HTMLElement>('.icon-pause')!.hidden = remote.isPaused;
    });
    context.addEventListener(framework.CastContextEventType.SESSION_STATE_CHANGED, () => {
      castButton.textContent = connected() ? 'Desconectar Cast' : 'Cast';
      castButton.setAttribute('aria-pressed', String(connected()));
      if (!connected()) { loadedUrl = ''; status.textContent = 'Google Cast desconectado'; }
    });
    controller.addEventListener(framework.RemotePlayerEventType.PLAYER_STATE_CHANGED, () => {
      const media = context.getCurrentSession()?.getMediaSession();
      if (media?.idleReason === win.chrome.cast.media.IdleReason.FINISHED) options.onEnd();
    });
  }
  win.__onGCastApiAvailable = initialize;
  if (win.cast?.framework) initialize(true);
  else if (window.isSecureContext && /Chrome|Chromium|Edg\//.test(navigator.userAgent)) {
    const script = document.createElement('script');
    script.src = 'https://www.gstatic.com/cv/js/sender/v1/cast_sender.js?loadCastFramework=1';
    script.async = true;
    script.onerror = () => { castButton.hidden = true; };
    document.head.append(script);
  }
}
