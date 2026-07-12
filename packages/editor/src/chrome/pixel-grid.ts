/**
 * Pure pixel-grid model for the sprite editor (M4.5; STUDIO EXTENSION,
 * LD-27). Cells are CSS `rgba(r,g,b,a)` strings; '' = transparent. All
 * canvas/DOM work stays in the component — these helpers are pure over
 * ImageData-shaped objects so they unit-test without a canvas backend.
 */

export type PixelGrid = string[][]; // [row][column]

/** Pixel editing is for sprite-scale art only (plan M4.5). */
export const MAX_PIXEL_DIMENSION = 64;

export function emptyGrid(width: number, height: number): PixelGrid {
  return Array.from({ length: height }, () => Array<string>(width).fill(''));
}

export function gridWidth(grid: PixelGrid): number {
  return grid[0]?.length ?? 0;
}

export function gridHeight(grid: PixelGrid): number {
  return grid.length;
}

/** Immutable single-cell paint ('' erases). */
export function paint(
  grid: PixelGrid,
  x: number,
  y: number,
  color: string,
): PixelGrid {
  if (y < 0 || y >= grid.length || x < 0 || x >= (grid[y]?.length ?? 0)) {
    return grid;
  }
  if (grid[y]![x] === color) return grid;
  const next = grid.map((row) => [...row]);
  next[y]![x] = color;
  return next;
}

/** Resize preserving the top-left corner; new cells are transparent. */
export function resizeGrid(
  grid: PixelGrid,
  width: number,
  height: number,
): PixelGrid {
  return Array.from({ length: height }, (_, y) =>
    Array.from({ length: width }, (_, x) => grid[y]?.[x] ?? ''),
  );
}

interface ImageDataLike {
  width: number;
  height: number;
  data: Uint8ClampedArray;
}

export function gridFromImageData(image: ImageDataLike): PixelGrid {
  const grid = emptyGrid(image.width, image.height);
  for (let y = 0; y < image.height; y++) {
    for (let x = 0; x < image.width; x++) {
      const offset = (y * image.width + x) * 4;
      const alpha = image.data[offset + 3]!;
      grid[y]![x] =
        alpha === 0
          ? ''
          : `rgba(${image.data[offset]},${image.data[offset + 1]},${image.data[offset + 2]},${(alpha / 255).toFixed(3)})`;
    }
  }
  return grid;
}

const CELL_PATTERN =
  /^rgba\((\d{1,3}),(\d{1,3}),(\d{1,3}),([01](?:\.\d+)?)\)$/;

/**
 * Fill an ImageData-shaped buffer from the grid (the component wraps the
 * result in a real ImageData → putImageData → toDataURL).
 */
export function gridToImageData(grid: PixelGrid): ImageDataLike {
  const width = gridWidth(grid);
  const height = gridHeight(grid);
  const data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const offset = (y * width + x) * 4;
      const match = CELL_PATTERN.exec(grid[y]![x]!);
      if (match) {
        data[offset] = Number(match[1]);
        data[offset + 1] = Number(match[2]);
        data[offset + 2] = Number(match[3]);
        data[offset + 3] = Math.round(Number(match[4]) * 255);
      }
      // No match ('' or foreign color text) = transparent zeros.
    }
  }
  return { width, height, data };
}

/** `#rrggbb` (palette/color-input value) → the cell representation. */
export function hexToCell(hex: string): string {
  const match = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex);
  if (!match) return '';
  return `rgba(${parseInt(match[1]!, 16)},${parseInt(match[2]!, 16)},${parseInt(match[3]!, 16)},1.000)`;
}
