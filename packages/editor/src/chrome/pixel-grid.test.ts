import { describe, expect, it } from 'vitest';
import {
  emptyGrid,
  gridFromImageData,
  gridToImageData,
  hexToCell,
  paint,
  resizeGrid,
} from './pixel-grid';

describe('pixel-grid model (M4.5, LD-27)', () => {
  it('creates transparent grids and paints immutably', () => {
    const grid = emptyGrid(2, 2);
    expect(grid).toEqual([
      ['', ''],
      ['', ''],
    ]);
    const painted = paint(grid, 1, 0, 'rgba(1,2,3,1.000)');
    expect(painted[0]).toEqual(['', 'rgba(1,2,3,1.000)']);
    expect(grid[0]).toEqual(['', '']); // original untouched
    // Out-of-bounds paints are no-ops (drag can exit the grid).
    expect(paint(grid, 5, 5, 'rgba(1,2,3,1.000)')).toBe(grid);
    // Erase = paint with ''.
    expect(paint(painted, 1, 0, '')[0]).toEqual(['', '']);
  });

  it('resizes preserving the top-left corner', () => {
    const grid = paint(emptyGrid(2, 2), 0, 0, 'rgba(9,9,9,1.000)');
    const grown = resizeGrid(grid, 3, 3);
    expect(grown[0]).toEqual(['rgba(9,9,9,1.000)', '', '']);
    expect(grown[2]).toEqual(['', '', '']);
    const shrunk = resizeGrid(grown, 1, 1);
    expect(shrunk).toEqual([['rgba(9,9,9,1.000)']]);
  });

  it('round-trips through ImageData-shaped buffers', () => {
    const grid = [
      ['rgba(255,0,0,1.000)', ''],
      ['', 'rgba(0,128,255,0.502)'],
    ];
    const shaped = gridToImageData(grid);
    expect(shaped.width).toBe(2);
    expect([...shaped.data.slice(0, 4)]).toEqual([255, 0, 0, 255]);
    expect([...shaped.data.slice(4, 8)]).toEqual([0, 0, 0, 0]); // transparent
    const back = gridFromImageData(shaped);
    expect(back[0]![0]).toBe('rgba(255,0,0,1.000)');
    expect(back[0]![1]).toBe('');
    // Alpha survives within rounding (0.502 → 128/255).
    expect(back[1]![1]).toBe('rgba(0,128,255,0.502)');
  });

  it('hexToCell converts palette values; garbage becomes transparent', () => {
    expect(hexToCell('#ff8000')).toBe('rgba(255,128,0,1.000)');
    expect(hexToCell('not-a-color')).toBe('');
  });
});
