import './style.css';
import { SceneManager } from './core/scene-manager';
import { Router } from './router';
import { createLoadingOverlay } from './ui/loading-screen';
import { createHud } from './ui/overlay-hud';

function main(): void {
  const app = document.getElementById('app');
  if (!app) return;

  const canvasContainer = document.createElement('div');
  canvasContainer.id = 'canvas-container';
  canvasContainer.appendChild(createLoadingOverlay());
  const { element: hud, updateFps } = createHud();
  canvasContainer.appendChild(hud);

  // Append container to DOM first so it has valid size when SceneManager is created
  app.appendChild(canvasContainer);

  const sceneManager = new SceneManager(canvasContainer, {
    onFrame: (delta) => {
      const safeDelta = Math.max(delta, 1e-6);
      updateFps(1 / safeDelta);
    },
  });
  const router = new Router(sceneManager, canvasContainer);

  router.loadDefault();
}

main();
