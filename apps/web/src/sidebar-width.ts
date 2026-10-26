// The open sidebar can be dragged between these widths, in pixels.
export const sidebarWidth = { min: 220, max: 480, initial: 264 };

const key = 'endeavor.sidebarWidth';

export function clampSidebarWidth(width: number): number {
  if (!Number.isFinite(width)) return sidebarWidth.initial;
  return Math.round(Math.min(sidebarWidth.max, Math.max(sidebarWidth.min, width)));
}

export function readSidebarWidth(): number {
  try {
    const saved = localStorage.getItem(key);
    return saved === null ? sidebarWidth.initial : clampSidebarWidth(Number(saved));
  } catch {
    return sidebarWidth.initial;
  }
}

export function writeSidebarWidth(width: number): void {
  try {
    if (width === sidebarWidth.initial) localStorage.removeItem(key);
    else localStorage.setItem(key, String(width));
  } catch {
    // The width still works for this page when browser storage is unavailable.
  }
}
