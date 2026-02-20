export function createHud(): {
  element: HTMLElement;
  updateFps: (fps: number) => void;
} {
  const hud = document.createElement('div');
  hud.id = 'effect-hud';

  const fpsDisplay = document.createElement('div');
  fpsDisplay.className = 'fps-display';
  fpsDisplay.textContent = 'FPS —';
  hud.appendChild(fpsDisplay);

  return {
    element: hud,
    updateFps(fps: number) {
      fpsDisplay.textContent = `FPS ${Math.round(fps)}`;
    },
  };
}

export function updateHud(_name: string, _description: string): void {
  // No text overlay in 3D view; effect name/description omitted by design
}
