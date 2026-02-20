import type { EffectConfig } from '../core/types';

export function createSidebar(
  effects: EffectConfig[],
  onSelect: (id: string) => void
): HTMLElement {
  const sidebar = document.createElement('nav');
  sidebar.id = 'sidebar';

  const header = document.createElement('div');
  header.id = 'sidebar-header';
  header.innerHTML = `
    <h1>Gaussian Splat Playground</h1>
  `;
  sidebar.appendChild(header);

  const list = document.createElement('ul');
  list.id = 'effect-list';

  for (const effect of effects) {
    const item = document.createElement('li');
    item.className = 'effect-item';
    item.dataset.id = effect.id;
    item.innerHTML = `
      <div class="effect-item-name">${effect.name}</div>
      <div class="effect-item-desc">${effect.description}</div>
    `;
    item.addEventListener('click', () => onSelect(effect.id));
    list.appendChild(item);
  }

  sidebar.appendChild(list);
  return sidebar;
}

export function setActiveItem(id: string): void {
  document.querySelectorAll('.effect-item').forEach((el) => {
    el.classList.toggle('active', (el as HTMLElement).dataset.id === id);
  });
}
