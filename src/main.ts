import { initWebGL2, resizeCanvasToDisplaySize } from './renderer/webgl-context';
import './style.css';

function main(): void {
  const canvas = document.getElementById('gl-canvas') as HTMLCanvasElement | null;

  if (!canvas) {
    showError('Canvas element not found.');
    return;
  }

  const gl = initWebGL2(canvas);

  if (!gl) {
    showError('WebGL2 is not supported by your browser.');
    return;
  }

  gl.clearColor(0.08, 0.08, 0.12, 1.0);

  window.addEventListener('resize', () => {
    resizeCanvasToDisplaySize(canvas, gl);
  });

  requestAnimationFrame(function frame() {
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    requestAnimationFrame(frame);
  });
}

function showError(message: string): void {
  document.body.innerHTML = `
    <div style="
      color: #ff6b6b;
      font-family: monospace;
      font-size: 1.2rem;
      display: flex;
      align-items: center;
      justify-content: center;
      height: 100vh;
      text-align: center;
      padding: 2rem;
    ">
      ${message}
    </div>
  `;
}

main();
