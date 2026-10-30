export interface Viewport {
  x: number;
  y: number;
  scale: number;
}
// The pointer position is relative to the center of the diagram canvas.
export function zoomAt(view: Viewport, factor: number, x = 0, y = 0): Viewport {
  const scale = Math.max(0.2, Math.min(8, view.scale * factor));
  const ratio = scale / view.scale;
  return { scale, x: x - (x - view.x) * ratio, y: y - (y - view.y) * ratio };
}
