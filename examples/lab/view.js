// Rendering and presentation consume committed public-field data only.
import { STRUCTURE_BOND_LEFT_MASK, STRUCTURE_BOND_RIGHT_MASK, STRUCTURE_BOND_UP_MASK, STRUCTURE_BOND_DOWN_MASK } from '../../dist/sdk/state-space.js';

export const bondMarkers = bonds => [STRUCTURE_BOND_LEFT_MASK, STRUCTURE_BOND_RIGHT_MASK, STRUCTURE_BOND_UP_MASK, STRUCTURE_BOND_DOWN_MASK].map(mask => bonds & mask ? '●' : '·').join(' ');
export function locateCell(canvas, event, width, height) {
  const box = canvas.getBoundingClientRect();
  return { x: Math.max(0, Math.min(width - 1, Math.floor((event.clientX - box.left) / box.width * width))),
    y: Math.max(0, Math.min(height - 1, Math.floor((event.clientY - box.top) / box.height * height))) };
}

export function drawField(canvas, view, mode, selected) {
  const { width, height } = view.snapshot, scale = 20;
  canvas.width = width * scale; canvas.height = height * scale;
  if (canvas.style) canvas.style.maxWidth = `${520 * width / height}px`;
  const ctx = canvas.getContext('2d');
  const colors = new Map(view.catalog.materials.map(material => [material.id, material.color]));
  view.samples.forEach((cell, index) => {
    const x = index % width * scale, y = Math.floor(index / width) * scale;
    let color = colors.get(cell.material);
    if (mode === 'temperature') color = `hsl(${240 - Math.min(1, cell.temperatureQ / (400 * 256)) * 240} 70% ${cell.material ? 52 : 16}%)`;
    if (mode === 'integrity') color = cell.integrity ? `hsl(${cell.integrity / 255 * 100} 60% 52%)` : '#18221e';
    if (mode === 'support') color = view.plan.distances[index] < 0 ? '#24312b' : `hsl(${Math.max(0, 130 - view.plan.distances[index] * 5)} 60% 50%)`;
    ctx.fillStyle = cell.material === 0 && mode === 'material' ? '#101a17' : color;
    ctx.fillRect(x, y, scale, scale);
    ctx.strokeStyle = '#00000018'; ctx.strokeRect(x, y, scale, scale);
  });
  // Overlay after all cell fills so a neighbor cannot paint over its bond.
  view.samples.forEach((cell, index) => {
    const x = index % width * scale, y = Math.floor(index / width) * scale;
    if (mode === 'material') {
      ctx.strokeStyle = '#e6ffc790'; ctx.lineWidth = 1;
      if (cell.bonds & STRUCTURE_BOND_RIGHT_MASK) { ctx.beginPath(); ctx.moveTo(x + scale / 2, y + scale / 2); ctx.lineTo(x + scale * 1.5, y + scale / 2); ctx.stroke(); }
      if (cell.bonds & STRUCTURE_BOND_DOWN_MASK) { ctx.beginPath(); ctx.moveTo(x + scale / 2, y + scale / 2); ctx.lineTo(x + scale / 2, y + scale * 1.5); ctx.stroke(); }
    }
    if (cell.anchored) { ctx.fillStyle = '#f8fff0'; ctx.fillRect(x + 7, y + 7, 6, 6); }
  });
  ctx.strokeStyle = '#f3ffab'; ctx.lineWidth = 2; ctx.strokeRect(selected.x * scale + 1, selected.y * scale + 1, scale - 2, scale - 2);
}

export function fillDefinitions(element, entries) {
  element.replaceChildren(...entries.flatMap(([key, value]) => {
    const term = document.createElement('dt'), detail = document.createElement('dd');
    term.textContent = key; detail.textContent = String(value); return [term, detail];
  }));
}
