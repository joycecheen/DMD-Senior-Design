// museum panel overview
export type ControlDescriptor =
  | SliderControl
  | SegmentedControl
  | ToggleControl
  | SwatchControl
  | ButtonControl;

export interface SliderControl {
  kind: 'slider';
  key: string;
  label: string;
  min: number;
  max: number;
  step: number;
  hint?: string;
  format?: (v: number) => string;
  get: () => number;
  set: (v: number) => void;
}

export interface SegmentedControl {
  kind: 'segmented';
  key: string;
  label: string;
  options: Array<{ value: string; label: string }>;
  hint?: string;
  get: () => string;
  set: (v: string) => void;
}

export interface ToggleControl {
  kind: 'toggle';
  key: string;
  label: string;
  hint?: string;
  get: () => boolean;
  set: (v: boolean) => void;
}

export interface SwatchControl {
  kind: 'swatch';
  key: string;
  label: string;
  options: string[];
  hint?: string;
  
  allowCustom?: boolean;
  get: () => string;
  set: (v: string) => void;
}

export interface ButtonControl {
  kind: 'button';
  key: string;
  label: string;
  hint?: string;
  onClick: () => void;
}

export interface TechLine {
  k: string;
  v: string;
}

export interface PanelContent {
  id: string;
  number: string;
  technique: string;
  name: string;
  caption: string;
  controls: ControlDescriptor[];
  tech: {
    summary: string;
    lines: TechLine[];
  };
  
  uploadSpz?: (file: File) => void | Promise<void>;
}

export interface MuseumPanel {
  element: HTMLElement;
  open: (content: PanelContent) => void;
  close: () => void;
  
  refresh: () => void;
}


export function createMuseumPanel(options: { onClose: () => void }): MuseumPanel {
  const panel = document.createElement('aside');
  panel.className = 'panel';
  panel.setAttribute('aria-hidden', 'true');

  const inner = document.createElement('div');
  inner.className = 'panel-inner';
  panel.appendChild(inner);

  
  const stopBubble = (event: Event): void => event.stopPropagation();
  panel.addEventListener('pointerdown', stopBubble);
  panel.addEventListener('pointerup', stopBubble);
  panel.addEventListener('pointermove', stopBubble);
  panel.addEventListener('click', stopBubble);

  let refreshers: Array<() => void> = [];

  const open = (content: PanelContent): void => {
    refreshers = [];
    inner.innerHTML = '';
    inner.dataset.itemId = content.id;

    const top = renderTop(content, options.onClose);
    inner.appendChild(top);

    const name = document.createElement('h2');
    name.className = 'panel-name';
    name.textContent = content.name;

    const caption = document.createElement('p');
    caption.className = 'panel-caption';
    caption.textContent = content.caption;

    const dividerA = document.createElement('div');
    dividerA.className = 'panel-divider';

    const controls = renderControls(content.controls, (fn) => refreshers.push(fn));
    const disclosure = renderDisclosure(content);

    inner.append(name, caption, dividerA, controls, disclosure);

    panel.classList.add('is-open');
    panel.setAttribute('aria-hidden', 'false');
  };

  const close = (): void => {
    panel.classList.remove('is-open');
    panel.setAttribute('aria-hidden', 'true');
    refreshers = [];
  };

  
  const refresh = (): void => {
    for (const fn of refreshers) fn();
  };

  return { element: panel, open, close, refresh };
}



function renderTop(content: PanelContent, onClose: () => void): HTMLElement {
  const top = document.createElement('div');
  top.className = 'panel-top';

  const crumb = document.createElement('div');
  crumb.className = 'panel-crumb';
  crumb.innerHTML = `<span class="panel-num">Effect ${escapeHtml(content.number)}</span>`;

  const actions = document.createElement('div');
  actions.className = 'panel-actions';

  if (content.uploadSpz) {
    const fileInput = document.createElement('input');
    fileInput.type = 'file';
    fileInput.accept = '.spz,application/octet-stream';
    fileInput.className = 'panel-upload-input';
    fileInput.tabIndex = -1;

    const uploadBtn = document.createElement('button');
    uploadBtn.type = 'button';
    uploadBtn.className = 'panel-icon-btn panel-upload';
    uploadBtn.setAttribute('aria-label', 'Upload .spz to replace this capture');
    uploadBtn.title = 'Upload .spz';
    uploadBtn.innerHTML = `
      <svg width="11" height="11" viewBox="0 0 11 11" fill="none" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round">
        <path d="M5.5 8V2.5M5.5 2.5L3 4M5.5 2.5L8 4" />
        <path d="M2 9h7" />
      </svg>
    `;
    uploadBtn.addEventListener('click', () => fileInput.click());

    fileInput.addEventListener('change', () => {
      const file = fileInput.files?.[0];
      fileInput.value = '';
      if (file) void Promise.resolve(content.uploadSpz!(file));
    });

    actions.append(uploadBtn, fileInput);
  }

  const closeBtn = document.createElement('button');
  closeBtn.className = 'panel-icon-btn panel-close';
  closeBtn.setAttribute('aria-label', 'Close');
  closeBtn.type = 'button';
  closeBtn.innerHTML = `
    <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" stroke-width="1.2">
      <path d="M2 2 L8 8 M8 2 L2 8" />
    </svg>
  `;
  closeBtn.addEventListener('click', () => onClose());

  actions.appendChild(closeBtn);
  top.append(crumb, actions);
  return top;
}

function renderControls(
  controls: ControlDescriptor[],
  registerRefresh: (fn: () => void) => void
): HTMLElement {
  const group = document.createElement('div');
  group.className = 'ctl-group';
  for (const control of controls) {
    group.appendChild(renderControl(control, registerRefresh));
  }
  return group;
}

function renderControl(
  control: ControlDescriptor,
  registerRefresh: (fn: () => void) => void
): HTMLElement {
  switch (control.kind) {
    case 'slider':
      return renderSlider(control, registerRefresh);
    case 'segmented':
      return renderSegmented(control, registerRefresh);
    case 'toggle':
      return renderToggle(control, registerRefresh);
    case 'swatch':
      return renderSwatch(control, registerRefresh);
    case 'button':
      return renderButton(control);
  }
}

function applyHint(el: HTMLElement, hint?: string): void {
  if (hint) el.title = hint;
}

function renderSlider(
  control: SliderControl,
  registerRefresh: (fn: () => void) => void
): HTMLElement {
  const wrap = document.createElement('div');
  wrap.className = 'ctl';
  applyHint(wrap, control.hint);

  const head = document.createElement('div');
  head.className = 'ctl-head';

  const label = document.createElement('label');
  label.className = 'ctl-label';
  label.textContent = control.label;

  const valueEl = document.createElement('span');
  valueEl.className = 'ctl-value';

  head.append(label, valueEl);

  const input = document.createElement('input');
  input.className = 'slider';
  input.type = 'range';
  input.min = String(control.min);
  input.max = String(control.max);
  input.step = String(control.step);

  const format = control.format ?? ((v: number) => v.toFixed(2));

  const sync = (): void => {
    const v = control.get();
    const asStr = String(v);
    if (input.value !== asStr) input.value = asStr;
    valueEl.textContent = format(v);
  };
  sync();
  registerRefresh(sync);

  input.addEventListener('input', () => {
    const v = parseFloat(input.value);
    control.set(v);
    valueEl.textContent = format(v);
  });

  wrap.append(head, input);
  return wrap;
}

function renderSegmented(
  control: SegmentedControl,
  registerRefresh: (fn: () => void) => void
): HTMLElement {
  const wrap = document.createElement('div');
  wrap.className = 'ctl';
  applyHint(wrap, control.hint);

  const head = document.createElement('div');
  head.className = 'ctl-head';
  const label = document.createElement('label');
  label.className = 'ctl-label';
  label.textContent = control.label;
  head.appendChild(label);

  const seg = document.createElement('div');
  seg.className = 'segmented';

  const buttons: Array<{ value: string; btn: HTMLButtonElement }> = [];
  for (const opt of control.options) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.textContent = opt.label;
    btn.addEventListener('click', () => {
      control.set(opt.value);
      updatePressed();
    });
    seg.appendChild(btn);
    buttons.push({ value: opt.value, btn });
  }

  const updatePressed = (): void => {
    const current = control.get();
    for (const { value, btn } of buttons) {
      btn.setAttribute('aria-pressed', String(value === current));
    }
  };
  updatePressed();
  registerRefresh(updatePressed);

  wrap.append(head, seg);
  return wrap;
}

function renderToggle(
  control: ToggleControl,
  registerRefresh: (fn: () => void) => void
): HTMLElement {
  const wrap = document.createElement('div');
  wrap.className = 'ctl ctl-inline';
  applyHint(wrap, control.hint);

  const label = document.createElement('label');
  label.className = 'ctl-label';
  label.textContent = control.label;

  const toggle = document.createElement('button');
  toggle.type = 'button';
  toggle.className = 'toggle';
  toggle.setAttribute('role', 'switch');

  const sync = (): void => {
    toggle.setAttribute('aria-checked', String(control.get()));
  };
  sync();
  registerRefresh(sync);

  toggle.addEventListener('click', () => {
    control.set(!control.get());
    sync();
  });

  wrap.append(label, toggle);
  return wrap;
}

function renderSwatch(
  control: SwatchControl,
  registerRefresh: (fn: () => void) => void
): HTMLElement {
  const wrap = document.createElement('div');
  wrap.className = 'ctl ctl-inline';
  applyHint(wrap, control.hint);

  const label = document.createElement('label');
  label.className = 'ctl-label';
  label.textContent = control.label;

  const swatchRow = document.createElement('div');
  swatchRow.className = 'swatches';

  const buttons: Array<{ value: string; btn: HTMLButtonElement }> = [];
  for (const color of control.options) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'swatch';
    btn.style.background = color;
    btn.setAttribute('aria-label', color);
    btn.addEventListener('click', () => {
      control.set(color);
      sync();
    });
    swatchRow.appendChild(btn);
    buttons.push({ value: color, btn });
  }

  const presetSet = new Set(control.options.map((c) => c.toLowerCase()));
  let customBtn: HTMLButtonElement | null = null;
  let customInput: HTMLInputElement | null = null;
  if (control.allowCustom) {
    customBtn = document.createElement('button');
    customBtn.type = 'button';
    customBtn.className = 'swatch swatch-custom';
    customBtn.title = 'Pick a custom color';
    customBtn.setAttribute('aria-label', 'Pick a custom color');

    customInput = document.createElement('input');
    customInput.type = 'color';
    customInput.className = 'swatch-color-input';
    customInput.tabIndex = -1;

    customBtn.addEventListener('click', () => {
      customInput!.value = toHex6(control.get());
      customInput!.click();
    });
    customInput.addEventListener('input', () => {
      control.set(customInput!.value);
      sync();
    });

    swatchRow.append(customBtn, customInput);
  }

  const sync = (): void => {
    const current = control.get();
    const currentLower = current.toLowerCase();
    let presetMatch = false;
    for (const { value, btn } of buttons) {
      const match = value.toLowerCase() === currentLower;
      btn.setAttribute('aria-pressed', String(match));
      if (match) presetMatch = true;
    }
    if (customBtn) {
      const isCustom = !presetMatch && presetSet.size > 0;
      customBtn.setAttribute('aria-pressed', String(isCustom));
      customBtn.style.background = isCustom ? current : '';
    }
  };
  sync();
  registerRefresh(sync);

  wrap.append(label, swatchRow);
  return wrap;
}

function toHex6(color: string): string {
  const trimmed = color.trim();
  if (/^#[0-9a-f]{6}$/i.test(trimmed)) return trimmed;
  if (/^#[0-9a-f]{3}$/i.test(trimmed)) {
    const [, r, g, b] = trimmed.match(/^#(.)(.)(.)$/i)!;
    return `#${r}${r}${g}${g}${b}${b}`.toLowerCase();
  }
  return '#ffffff';
}

function renderButton(control: ButtonControl): HTMLElement {
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'action-button';
  applyHint(btn, control.hint);
  btn.innerHTML = `
    <span>${escapeHtml(control.label)}</span>
    <span class="action-arrow">↺</span>
  `;
  btn.addEventListener('click', () => {
    control.onClick();
    btn.dataset.pulsed = '1';
    setTimeout(() => {
      delete btn.dataset.pulsed;
    }, 400);
  });
  return btn;
}

function renderDisclosure(content: PanelContent): HTMLElement {
  const details = document.createElement('details');
  details.className = 'disclosure';

  const summary = document.createElement('summary');
  summary.className = 'disclosure-summary';
  summary.innerHTML = `
    <span>Implementation</span>
    <span class="chev">›</span>
  `;

  const body = document.createElement('div');
  body.className = 'disclosure-body';

  const p = document.createElement('p');
  p.textContent = content.tech.summary;

  const tech = document.createElement('div');
  tech.className = 'tech';
  for (const line of content.tech.lines) {
    const row = document.createElement('div');
    const k = document.createElement('span');
    k.className = 'k';
    k.textContent = line.k;
    const v = document.createElement('span');
    v.textContent = ` ${line.v}`;
    row.append(k, v);
    tech.appendChild(row);
  }

  body.append(p, tech);
  details.append(summary, body);
  return details;
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
