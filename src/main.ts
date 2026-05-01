// main overview
import './style.css';
import { SceneManager } from './core/scene-manager';
import { Router } from './router';
import { createLoadingOverlay } from './ui/loading-screen';
import { createHud, createGrain } from './ui/overlay-hud';
import { createMuseumPanel } from './ui/museum-panel';

function main(): void {
  const app = document.getElementById('app');
  if (!app) return;

  const canvasContainer = document.createElement('div');
  canvasContainer.id = 'canvas-container';
  canvasContainer.appendChild(createLoadingOverlay());

  
  canvasContainer.appendChild(createGrain());

  const hud = createHud();
  canvasContainer.appendChild(hud.element);

  
  let routerRef: Router | null = null;
  const panel = createMuseumPanel({
    onClose: () => routerRef?.handlePanelClose(),
  });
  canvasContainer.appendChild(panel.element);

  app.appendChild(canvasContainer);

  const sceneManager = new SceneManager(canvasContainer, {
    onFrame: (delta) => {
      const safeDelta = Math.max(delta, 1e-6);
      hud.updateFps(1 / safeDelta);
      routerRef?.onFrame();
    },
  });

  const router = new Router(sceneManager, canvasContainer, { hud, panel });
  routerRef = router;
  router.loadDefault();
}

main();
