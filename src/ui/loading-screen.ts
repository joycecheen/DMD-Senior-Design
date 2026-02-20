export function createLoadingOverlay(): HTMLElement {
  const overlay = document.createElement('div');
  overlay.id = 'loading-overlay';
  overlay.classList.add('hidden'); // start hidden while loading is disabled
  overlay.innerHTML = `
    <div class="spinner"></div>
    <div id="loading-text">Loading splats...</div>
  `;
  return overlay;
}

// Temporarily disabled – re-enable by restoring show/hide logic
export function showLoading(_container: HTMLElement): void {
  // no-op
}

export function hideLoading(_container: HTMLElement): void {
  // no-op
}
