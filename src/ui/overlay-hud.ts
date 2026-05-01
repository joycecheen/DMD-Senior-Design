// overlay hud overview
export interface Hud {
  element: HTMLElement;
  updateFps: (fps: number) => void;
  setSelectedId: (id: string | null) => void;
}

export function createGrain(): HTMLElement {
  const grain = document.createElement('div');
  grain.className = 'stage-grain';
  return grain;
}

export function createHud(): Hud {
  const hud = document.createElement('div');
  hud.id = 'effect-hud';

  const wordmark = document.createElement('div');
  wordmark.className = 'wordmark';
  wordmark.innerHTML = `
    <span class="wordmark-title">Gaussian Splat Playground</span>
    <span class="wordmark-sep"></span>
    <span class="wordmark-sub">Joyce Chen · DMD Senior Design</span>
  `;
  hud.appendChild(wordmark);

  const helpHint = document.createElement('div');
  helpHint.className = 'help-hint';
  hud.appendChild(helpHint);

  const fpsDisplay = document.createElement('div');
  fpsDisplay.className = 'fps-display';
  fpsDisplay.textContent = '-- fps';
  hud.appendChild(fpsDisplay);

  const renderHelp = (selectedId: string | null): void => {
    helpHint.innerHTML = selectedId
      ? `<span class="help-hint-item"><span class="kbd">Esc</span> deselect</span>`
      : `<span class="help-hint-item"><span class="kbd">Click</span> examine object</span>
         <span class="help-hint-item"><span class="kbd">Esc</span> deselect</span>`;
  };
  renderHelp(null);

  return {
    element: hud,
    updateFps(fps: number) {
      const rounded = Math.max(0, Math.min(999, Math.round(fps)));
      fpsDisplay.textContent = `${String(rounded).padStart(2, '0')} fps`;
    },
    setSelectedId(id: string | null) {
      renderHelp(id);
    },
  };
}
