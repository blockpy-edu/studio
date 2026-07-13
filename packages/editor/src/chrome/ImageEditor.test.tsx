// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, fireEvent, render } from '@testing-library/react';
import { ImageEditor, isImageDataUrl } from './ImageEditor';

// 1×1 transparent PNG.
const PNG_URL =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';

describe('ImageEditor (M4.5, LD-27)', () => {
  afterEach(cleanup);

  it('detects image data-URLs', () => {
    expect(isImageDataUrl(PNG_URL)).toBe(true);
    expect(isImageDataUrl('hello')).toBe(false);
  });

  it('previews data-URL contents on the checkerboard with zoom + raw escape', () => {
    const { container } = render(
      <ImageEditor value={PNG_URL} onChange={() => {}} onRawView={() => {}} />,
    );
    const img = container.querySelector<HTMLImageElement>('.blockpy-image-preview img')!;
    expect(img.src).toBe(PNG_URL);
    expect(container.querySelector('.blockpy-image-checkerboard')).not.toBeNull();
    // Zoom drives the CSS scale transform.
    fireEvent.change(container.querySelector('.blockpy-image-zoom')!, {
      target: { value: '4' },
    });
    expect(img.style.transform).toBe('scale(4)');
    expect(container.querySelector('.blockpy-image-raw')).not.toBeNull();
    expect(container.querySelector('.blockpy-pixel-edit')).not.toBeNull();
  });

  it('read-only preview hides the pixel-edit affordance (D3-A)', () => {
    const { container } = render(
      <ImageEditor value={PNG_URL} readOnly onChange={() => {}} onRawView={() => {}} />,
    );
    expect(container.querySelector('.blockpy-pixel-edit')).toBeNull();
  });

  it('non-image contents offer the blank-canvas creator; painting + Apply needs canvas', () => {
    const { container } = render(<ImageEditor value="" onChange={() => {}} onRawView={() => {}} />);
    expect(container.querySelector('.blockpy-image-create')).not.toBeNull();
    fireEvent.change(container.querySelector('.blockpy-image-new-width')!, {
      target: { value: '2' },
    });
    fireEvent.change(container.querySelector('.blockpy-image-new-height')!, {
      target: { value: '2' },
    });
    fireEvent.click(container.querySelector('.blockpy-image-create-blank')!);
    // Pixel mode: a 2×2 grid of cells with palette + eraser + sizes.
    expect(container.querySelectorAll('.blockpy-pixel-row')).toHaveLength(2);
    expect(container.querySelectorAll('.blockpy-pixel-cell')).toHaveLength(4);
    expect(container.querySelectorAll('.blockpy-pixel-swatch').length).toBeGreaterThan(4);
    // Paint a cell: the style updates to the selected palette color.
    const cell = container.querySelector<HTMLButtonElement>('[aria-label="Pixel 0,0"]')!;
    fireEvent.mouseDown(cell);
    expect(cell.style.backgroundColor).toBe('rgb(0, 0, 0)');
    // Eraser clears it again.
    fireEvent.click(container.querySelector('.blockpy-pixel-eraser')!);
    fireEvent.mouseDown(cell);
    expect(cell.style.backgroundColor).toBe('');
    // Resize keeps the grid rectangular.
    fireEvent.change(container.querySelectorAll('.blockpy-pixel-size')[0]!, {
      target: { value: '3' },
    });
    expect(
      container.querySelectorAll('.blockpy-pixel-row')[0]!.querySelectorAll('.blockpy-pixel-cell'),
    ).toHaveLength(3);
    // Apply in jsdom (no canvas backend) fails soft with the error notice.
    fireEvent.click(container.querySelector('.blockpy-pixel-apply')!);
    expect(container.querySelector('.blockpy-image-error')).not.toBeNull();
    // Cancel returns to the creator view without writing.
    fireEvent.click(container.querySelector('.blockpy-pixel-cancel')!);
    expect(container.querySelector('.blockpy-image-create')).not.toBeNull();
  });
});
