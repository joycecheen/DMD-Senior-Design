export function initWebGL2(canvas: HTMLCanvasElement): WebGL2RenderingContext | null {
  const gl = canvas.getContext('webgl2');

  if (!gl) {
    return null;
  }

  resizeCanvasToDisplaySize(canvas, gl);

  return gl;
}

export function resizeCanvasToDisplaySize(
  canvas: HTMLCanvasElement,
  gl: WebGL2RenderingContext
): boolean {
  const dpr = window.devicePixelRatio || 1;
  const displayWidth = Math.round(canvas.clientWidth * dpr);
  const displayHeight = Math.round(canvas.clientHeight * dpr);

  const needsResize = canvas.width !== displayWidth || canvas.height !== displayHeight;

  if (needsResize) {
    canvas.width = displayWidth;
    canvas.height = displayHeight;
    gl.viewport(0, 0, displayWidth, displayHeight);
  }

  return needsResize;
}
