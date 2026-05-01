// loading screen overview
export function createLoadingOverlay(): HTMLElement {
  const overlay = document.createElement('div');
  overlay.id = 'loading-overlay';
  overlay.classList.add('hidden');
  overlay.innerHTML = `
    <div class="spinner"></div>
    <div id="loading-text">Loading gallery</div>
  `;
  return overlay;
}
