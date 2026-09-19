export const MIN_ZOOM = 0.3;
export const MAX_ZOOM = 2;
export const ZOOM_STEP = 0.15;

export const clampZoom = (z: number): number => Math.round(Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, z)) * 100) / 100;

/** The zoom at which the whole map fits the width available — never enlarged past its natural size. */
export const fitZoom = (naturalWidth: number, availableWidth: number): number =>
  availableWidth > 0 && naturalWidth > 0 ? clampZoom(Math.min(1, availableWidth / naturalWidth)) : 1;
