const coarse = matchMedia('(pointer: coarse)');
const portrait = matchMedia('(orientation: portrait)');
const orientation = screen.orientation;
let active = false, requesting = false, ownsFullscreen = false, requestedLock = false;
let lastLayout = '';

function syncLayout() {
  const rotated = active && coarse.matches && portrait.matches;
  document.body.classList.toggle('rotated-landscape', rotated);
  const layout = [rotated, portrait.matches, orientation?.angle ?? window.orientation ?? 0].join('/');
  if (layout !== lastLayout) {
    lastLayout = layout;
    window.dispatchEvent(new Event('game-orientationchange'));
  }
}

function unlock() {
  if (!requestedLock) return;
  requestedLock = false;
  try { orientation.unlock(); } catch { /* The browser may already have released it. */ }
}

function exitOwnedFullscreen() {
  if (!ownsFullscreen || document.fullscreenElement !== document.documentElement) return;
  ownsFullscreen = false;
  document.exitFullscreen().catch(() => {});
}

// Call directly from a touch activation. Some browsers only grant the lock
// after entering fullscreen. The rotated play surface works during either request.
export async function enterLandscape() {
  if (!coarse.matches) return;
  active = true;
  syncLayout();
  if (requesting) return;
  requesting = true;
  try {
    if (!document.fullscreenElement && document.fullscreenEnabled) {
      try {
        await document.documentElement.requestFullscreen();
        ownsFullscreen = true;
      } catch { /* Embedded browsers can decline fullscreen. */ }
    }
    if (!active) { exitOwnedFullscreen(); return; }
    if (orientation?.lock && !requestedLock) {
      requestedLock = true;
      try { await orientation.lock('landscape'); }
      catch { requestedLock = false; }
      if (!active) unlock();
    }
  } finally {
    requesting = false;
    syncLayout();
  }
}

export function leaveLandscape() {
  active = false;
  unlock();
  exitOwnedFullscreen();
  syncLayout();
}

document.addEventListener('fullscreenchange', () => {
  if (ownsFullscreen && !document.fullscreenElement) {
    ownsFullscreen = false;
    unlock();
    if (active) window.Game?.pause();
  }
  syncLayout();
});
window.addEventListener('resize', syncLayout);
window.addEventListener('orientationchange', syncLayout);
orientation?.addEventListener('change', syncLayout);
coarse.addEventListener('change', syncLayout);
portrait.addEventListener('change', syncLayout);
syncLayout();
