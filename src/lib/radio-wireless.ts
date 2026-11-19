type AirplayAudio = HTMLAudioElement & { webkitShowPlaybackTargetPicker?: () => void; webkitCurrentPlaybackTargetIsWireless?: boolean };
// The Google SDK is loaded externally only on the public radio page.
type CastWindow = Window & { cast?: any; chrome?: any; __onGCastApiAvailable?: (available: boolean) => void };

export type CastMediaDetails = {
  title: string;
  artist: string;
  subtitle: string;
  artwork?: string;
  castUrl?: string;
  isLive: boolean;
  startTime?: number;
};

export function initRadioWireless(options: {
  audio: HTMLAudioElement;
  live: HTMLAudioElement;
  active: () => HTMLAudioElement;
  title: string;
  getDetails?: () => CastMediaDetails;
  onEnd: () => void;
}) {
  const airplay = document.querySelector<HTMLButtonElement>('#radio-airplay')!;
  const castButton = document.querySelector<HTMLButtonElement>('#radio-cast')!;
  const status = document.createElement('p');
  status.className = 'wireless-status';
  status.setAttribute('role', 'status');
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
  let loadSeq = 0;
  let requestingSession = false;
  let endedMedia: unknown = null;
  const connected = () => Boolean(context?.getCurrentSession());

  const formatClock = (seconds: number) => {
    if (!Number.isFinite(seconds) || seconds < 0) return '0:00';
    const total = Math.floor(seconds);
    const hrs = Math.floor(total / 3600);
    const mins = Math.floor((total % 3600) / 60);
    const secs = total % 60;
    if (hrs > 0) return `${hrs}:${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  function resolveCastUrlAndType(player: HTMLAudioElement, details?: CastMediaDetails): { url: string; type: string; isLive: boolean } | null {
    const isLive = details ? details.isLive : player === options.live;
    const rawSource = details?.castUrl || player.src || player.currentSrc;
    if (!rawSource) return null;
    const url = new URL(rawSource, location.href);
    url.hash = '';
    let type = 'audio/mpeg';
    if (/\.m3u8(?:\?|$)/i.test(url.href)) type = 'application/x-mpegURL';
    else if (/\.aac(?:\?|$)/i.test(url.href)) type = 'audio/aac';
    else if (/\.webm(?:\?|$)/i.test(url.href)) type = 'audio/webm';
    else if (/\.ogg(?:\?|$)/i.test(url.href)) type = 'audio/ogg';
    else type = 'audio/mpeg';
    return { url: url.href, type, isLive };
  }

  async function load(player: HTMLAudioElement, forceReload = false) {
    const session = context?.getCurrentSession();
    if (!session) return;

    const details = options.getDetails?.();
    const resolved = resolveCastUrlAndType(player, details);
    if (!resolved) {
      status.textContent = 'Selecciona una grabación o el directo.';
      return;
    }
    if (!forceReload && resolved.url === loadedUrl && remote?.isMediaLoaded) {
      players.forEach(item => item.pause());
      if (remote.isPaused) controller.playOrPause();
      return;
    }

    const mySeq = ++loadSeq;
    const api = win.chrome.cast.media;
    const media = new api.MediaInfo(resolved.url, resolved.type);
    media.streamType = resolved.isLive ? api.StreamType.LIVE : api.StreamType.BUFFERED;

    const metadata = new api.MusicTrackMediaMetadata();
    metadata.metadataType = api.MetadataType.MUSIC_TRACK;
    metadata.title = details?.title || options.title;
    metadata.artist = details?.artist || options.title;
    if (details?.subtitle) metadata.albumName = details.subtitle;
    if (details?.artwork) {
      try {
        const artUrl = new URL(details.artwork, location.href).href;
        metadata.images = [new win.chrome.cast.Image(artUrl)];
      } catch {}
    }
    media.metadata = metadata;

    const request = new api.LoadRequest(media);
    request.autoplay = true;
    if (!resolved.isLive) {
      const startPos = typeof details?.startTime === 'number' && details.startTime > 0
        ? details.startTime
        : (Number.isFinite(player.currentTime) ? player.currentTime : 0);
      if (startPos > 0) request.currentTime = startPos;
    }

    players.forEach(item => item.pause());
    status.textContent = 'Enviando audio a Google Cast…';
    try {
      await Promise.race([
        session.loadMedia(request),
        new Promise((_, reject) => setTimeout(() => reject({ code: 'timeout' }), 15_000)),
      ]);
      if (mySeq !== loadSeq) return;
      loadedUrl = resolved.url;
      endedMedia = null;
      players.forEach(item => item.pause());
      const deviceName = session.getCastDevice()?.friendlyName || 'Google Cast';
      status.textContent = `Reproduciendo en ${deviceName}`;
      const badgeText = document.querySelector<HTMLElement>('#play-state-text');
      if (badgeText) badgeText.textContent = `Cast · ${deviceName}`;
    } catch (err) {
      if (mySeq !== loadSeq) return;
      loadedUrl = '';
      const code = typeof err === 'string' ? err : (err as { code?: string })?.code || '';
      status.textContent = `No se pudo enviar el audio al receptor${code ? ` (${code})` : ''}.`;
    }
  }

  for (const player of players) {
    player.addEventListener('play', () => {
      if (!connected()) return;
      const details = options.getDetails?.();
      const resolved = resolveCastUrlAndType(player, details);
      if (!resolved) return;
      player.pause();
      if (resolved.url !== loadedUrl || !remote?.isMediaLoaded) void load(player, true);
      else if (remote?.isPaused) controller.playOrPause();
    });
  }

  document.querySelector('#toggle-play')?.addEventListener('click', event => {
    if (!connected()) return;
    event.stopImmediatePropagation();
    if (remote?.isMediaLoaded) controller.playOrPause();
    else void load(options.active(), true);
  }, true);

  document.querySelector<HTMLInputElement>('#play-volume')?.addEventListener('input', event => {
    if (!connected()) return;
    const vol = Number((event.target as HTMLInputElement).value);
    remote.volumeLevel = vol;
    controller.setVolumeLevel();
  });

  for (const [id, delta] of [['skip-back', -15], ['skip-forward', 15]] as const) {
    document.getElementById(id)?.addEventListener('click', event => {
      if (!connected() || !remote?.isMediaLoaded) return;
      event.stopImmediatePropagation();
      if (remote.canSeek && remote.duration > 0) {
        remote.currentTime = Math.max(0, Math.min(remote.duration, remote.currentTime + delta));
        controller.seek();
      }
    }, true);
  }

  for (const name of ['input', 'change']) {
    document.querySelector('#play-progress')?.addEventListener(name, event => {
      if (!connected() || !remote?.isMediaLoaded) return;
      event.stopImmediatePropagation();
      if (remote.canSeek && remote.duration > 0) {
        const pct = Number((event.target as HTMLInputElement).value);
        (event.target as HTMLInputElement).style.setProperty('--progress', `${pct}%`);
        if (name === 'change') {
          remote.currentTime = (remote.duration * pct) / 100;
          controller.seek();
        }
      }
    }, true);
  }

  document.querySelector('#mute-toggle')?.addEventListener('click', event => {
    if (!connected()) return;
    event.stopImmediatePropagation();
    controller.muteOrUnmute();
  }, true);

  castButton.onclick = async () => {
    if (requestingSession) return;
    requestingSession = true;
    try {
      if (connected()) { context.endCurrentSession(true); return; }
      status.textContent = 'Selecciona un dispositivo Google Cast.';
      await context.requestSession();
    } catch (error) {
      const code = typeof error === 'string' ? error : (error as { code?: string })?.code;
      if (context.getCastState() === win.cast.framework.CastState.NO_DEVICES_AVAILABLE || code === 'receiver_unavailable') {
        status.textContent = 'Chrome no detecta dispositivos Google Cast en la red local.';
      } else if (code === 'cancel') {
        status.textContent = '';
      } else if (code === 'timeout') {
        status.textContent = 'El dispositivo no respondió. Vuelve a intentar la conexión.';
      } else {
        status.textContent = 'No se pudo conectar con Google Cast' + (code ? ` (${code})` : '') + '.';
      }
    } finally { requestingSession = false; }
  };

  function initialize(available: boolean) {
    if (!available || !win.cast?.framework) return;
    const framework = win.cast.framework;
    context = framework.CastContext.getInstance();
    const receiverAppId = win.chrome?.cast?.media?.DEFAULT_MEDIA_RECEIVER_APP_ID || 'CC1AD845';
    context.setOptions({
      receiverApplicationId: receiverAppId,
      autoJoinPolicy: win.chrome.cast.AutoJoinPolicy.ORIGIN_SCOPED,
    });
    remote = new framework.RemotePlayer();
    controller = new framework.RemotePlayerController(remote);

    const launcher = document.createElement('google-cast-launcher');
    launcher.id = 'radio-cast-launcher';
    launcher.setAttribute('aria-label', 'Enviar audio con Google Cast');
    launcher.setAttribute('title', 'Enviar audio con Google Cast');
    launcher.style.cssText = 'display:grid;place-items:center;width:38px;height:38px;padding:8px;border-radius:4px;cursor:pointer;flex-shrink:0;--connected-color:#93c5fd;--disconnected-color:#ffffff;';
    castButton.before(launcher);
    castButton.hidden = true;

    const updateAvailability = () => {
      const unavailable = context.getCastState() === framework.CastState.NO_DEVICES_AVAILABLE;
      const label = unavailable ? 'Google Cast: sin receptores detectados en la red' : 'Enviar a Google Cast';
      castButton.title = label;
      castButton.setAttribute('aria-label', label);
      launcher.setAttribute('title', label);
      launcher.style.opacity = unavailable && !connected() ? '0.55' : '1';
      if (!connected() && !requestingSession) status.textContent = '';
    };
    context.addEventListener(framework.CastContextEventType.CAST_STATE_CHANGED, updateAvailability);
    updateAvailability();

    controller.addEventListener(framework.RemotePlayerEventType.CURRENT_TIME_CHANGED, () => {
      if (!connected() || !remote.isMediaLoaded) return;
      const progress = document.querySelector<HTMLInputElement>('#play-progress');
      const playTime = document.querySelector<HTMLElement>('#play-time');
      if (progress) {
        progress.disabled = !remote.canSeek;
        const pct = remote.canSeek && remote.duration > 0 ? Math.min(100, Math.max(0, (100 * remote.currentTime) / remote.duration)) : 100;
        progress.value = String(pct);
        progress.style.setProperty('--progress', `${pct}%`);
      }
      if (playTime) {
        playTime.textContent = remote.canSeek && remote.duration > 0
          ? `${formatClock(remote.currentTime)} / ${formatClock(remote.duration)}`
          : 'En directo';
      }
    });

    controller.addEventListener(framework.RemotePlayerEventType.IS_PAUSED_CHANGED, () => {
      if (!connected()) return;
      const toggle = document.querySelector<HTMLButtonElement>('#toggle-play');
      if (!toggle) return;
      toggle.setAttribute('aria-label', remote.isPaused ? 'Reproducir' : 'Pausar');
      const playIcon = toggle.querySelector<HTMLElement>('.icon-play');
      const pauseIcon = toggle.querySelector<HTMLElement>('.icon-pause');
      if (playIcon) playIcon.hidden = !remote.isPaused;
      if (pauseIcon) pauseIcon.hidden = remote.isPaused;
    });

    context.addEventListener(framework.CastContextEventType.SESSION_STATE_CHANGED, (event: any) => {
      const isConn = connected();
      const label = isConn ? 'Desconectar Google Cast' : 'Enviar a Google Cast';
      castButton.title = label;
      castButton.setAttribute('aria-label', label);
      castButton.setAttribute('aria-pressed', String(isConn));

      if (!isConn) {
        loadSeq++;
        loadedUrl = '';
        status.textContent = '';
        const badgeText = document.querySelector<HTMLElement>('#play-state-text');
        if (badgeText) badgeText.textContent = options.active() === options.live ? 'En directo' : 'Grabación';
        return;
      }
      if (event.sessionState === framework.SessionState.SESSION_STARTED) {
        void load(options.active(), true);
      } else if (event.sessionState === framework.SessionState.SESSION_RESUMED) {
        const media = context.getCurrentSession()?.getMediaSession();
        const deviceName = context.getCurrentSession()?.getCastDevice()?.friendlyName || 'Google Cast';
        if (media) {
          loadedUrl = media.media.contentId;
          players.forEach(player => player.pause());
          status.textContent = `Reproduciendo en ${deviceName}`;
        } else {
          void load(options.active(), true);
        }
      } else if (event.sessionState === framework.SessionState.SESSION_START_FAILED) {
        status.textContent = `No se pudo conectar con el receptor (${event.errorCode || 'sesión fallida'}).`;
      }
    });

    controller.addEventListener(framework.RemotePlayerEventType.PLAYER_STATE_CHANGED, () => {
      const media = context.getCurrentSession()?.getMediaSession();
      if (media?.idleReason === win.chrome.cast.media.IdleReason.FINISHED && endedMedia !== media) {
        endedMedia = media;
        options.onEnd();
        void load(options.live, true);
      }
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

  return {
    isConnected: connected,
    syncActive: (forceReload = true) => {
      if (connected()) void load(options.active(), forceReload);
    },
  };
}
