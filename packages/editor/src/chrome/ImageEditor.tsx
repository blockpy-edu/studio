/**
 * Image preview + pixel editor tab body (M4.5; STUDIO EXTENSION, LD-27).
 *
 * Storage decision (plan M4.5, investigated 2026-07-12): the editable
 * representation is the FILE'S VFS TEXT CONTENTS AS A DATA-URL — edits ride
 * the normal code-change path (VFS write → autosave → dirty), exactly like
 * every other working file. Server-side uploads (placement files) stay in
 * the ImagesManager (M1.6): preview/replace there, no pixel editing —
 * their bytes never enter the VFS.
 *
 * - Preview: checkerboard backdrop, zoom, dimensions readout.
 * - Pixel editor for sprite-scale images (≤ 64×64): paint/erase with a
 *   palette + custom color, new/resize canvas; Apply serializes the canvas
 *   back to a PNG data-URL.
 * - Non-data-URL contents (new/empty files, text) offer the blank-canvas
 *   creator and the raw-text escape.
 */
import { useEffect, useRef, useState } from 'react';
import {
  MAX_PIXEL_DIMENSION,
  emptyGrid,
  gridFromImageData,
  gridHeight,
  gridToImageData,
  gridWidth,
  hexToCell,
  paint,
  resizeGrid,
  type PixelGrid,
} from './pixel-grid';

export interface ImageEditorProps {
  value: string;
  readOnly?: boolean;
  onChange(next: string): void;
  /** "Raw text" escape hatch — the caller swaps in the text editor. */
  onRawView(): void;
}

const ZOOMS = [0.5, 1, 2, 4, 8];

const PALETTE = [
  '#000000',
  '#ffffff',
  '#d9534f',
  '#f0ad4e',
  '#5cb85c',
  '#5bc0de',
  '#428bca',
  '#8b4513',
];

export function isImageDataUrl(value: string): boolean {
  return value.startsWith('data:image/');
}

/** Decode a data-URL into a grid (canvas work — null where unsupported). */
function decodeToGrid(dataUrl: string): Promise<PixelGrid | null> {
  return new Promise((resolve) => {
    const image = new Image();
    image.onload = () => {
      if (
        image.naturalWidth === 0 ||
        image.naturalWidth > MAX_PIXEL_DIMENSION ||
        image.naturalHeight > MAX_PIXEL_DIMENSION
      ) {
        resolve(null);
        return;
      }
      try {
        const canvas = document.createElement('canvas');
        canvas.width = image.naturalWidth;
        canvas.height = image.naturalHeight;
        const context = canvas.getContext('2d');
        if (!context) {
          resolve(null);
          return;
        }
        context.drawImage(image, 0, 0);
        resolve(gridFromImageData(context.getImageData(0, 0, canvas.width, canvas.height)));
      } catch {
        resolve(null); // jsdom / tainted canvas — preview-only.
      }
    };
    image.onerror = () => resolve(null);
    image.src = dataUrl;
  });
}

/** Encode the grid to a PNG data-URL (canvas work — '' where unsupported). */
function encodeGrid(grid: PixelGrid): string {
  try {
    const canvas = document.createElement('canvas');
    canvas.width = gridWidth(grid);
    canvas.height = gridHeight(grid);
    const context = canvas.getContext('2d');
    if (!context) return '';
    const shaped = gridToImageData(grid);
    const imageData = context.createImageData(shaped.width, shaped.height);
    imageData.data.set(shaped.data);
    context.putImageData(imageData, 0, 0);
    return canvas.toDataURL('image/png');
  } catch {
    return '';
  }
}

export function ImageEditor({ value, readOnly, onChange, onRawView }: ImageEditorProps) {
  const [zoom, setZoom] = useState(1);
  const [dimensions, setDimensions] = useState<string | null>(null);
  const [grid, setGrid] = useState<PixelGrid | null>(null);
  const [pixelError, setPixelError] = useState('');
  const [color, setColor] = useState('#000000');
  const [erasing, setErasing] = useState(false);
  const [newWidth, setNewWidth] = useState('16');
  const [newHeight, setNewHeight] = useState('16');
  const dragging = useRef(false);

  const isImage = isImageDataUrl(value);

  useEffect(() => {
    // Leaving the tab or an external write invalidates the edit session.
    setGrid(null);
    setPixelError('');
    setDimensions(null);
  }, [value]);

  const beginPixelEdit = () => {
    void decodeToGrid(value).then((decoded) => {
      if (decoded) {
        setGrid(decoded);
        setPixelError('');
      } else {
        setPixelError(
          `Pixel editing needs a decodable image of at most ${MAX_PIXEL_DIMENSION}×${MAX_PIXEL_DIMENSION}.`,
        );
      }
    });
  };

  const createBlank = () => {
    const width = Math.max(1, Math.min(MAX_PIXEL_DIMENSION, Number(newWidth) || 0));
    const height = Math.max(1, Math.min(MAX_PIXEL_DIMENSION, Number(newHeight) || 0));
    setGrid(emptyGrid(width, height));
    setPixelError('');
  };

  const applyGrid = () => {
    if (!grid) return;
    const encoded = encodeGrid(grid);
    if (encoded === '') {
      setPixelError('This browser cannot encode the canvas back to an image.');
      return;
    }
    onChange(encoded);
    setGrid(null);
  };

  const paintCell = (x: number, y: number) => {
    if (readOnly || !grid) return;
    setGrid((current) =>
      current ? paint(current, x, y, erasing ? '' : hexToCell(color)) : current,
    );
  };

  // -- pixel-edit mode -------------------------------------------------------
  if (grid) {
    const width = gridWidth(grid);
    const height = gridHeight(grid);
    return (
      <div className="blockpy-image-editor">
        <div className="blockpy-image-toolbar">
          {PALETTE.map((swatch) => (
            <button
              key={swatch}
              type="button"
              className={'blockpy-pixel-swatch' + (!erasing && color === swatch ? ' active' : '')}
              style={{ backgroundColor: swatch }}
              title={swatch}
              onClick={() => {
                setColor(swatch);
                setErasing(false);
              }}
            />
          ))}
          <input
            type="color"
            aria-label="Custom color"
            value={color}
            onChange={(event) => {
              setColor(event.target.value);
              setErasing(false);
            }}
          />
          <button
            type="button"
            className={
              'btn btn-sm btn-outline-secondary blockpy-pixel-eraser' + (erasing ? ' active' : '')
            }
            aria-pressed={erasing}
            onClick={() => setErasing((current) => !current)}
          >
            Eraser
          </button>
          <label>
            W:{' '}
            <input
              type="number"
              className="blockpy-pixel-size"
              min={1}
              max={MAX_PIXEL_DIMENSION}
              value={width}
              onChange={(event) =>
                setGrid((current) =>
                  current
                    ? resizeGrid(
                        current,
                        Math.max(1, Math.min(MAX_PIXEL_DIMENSION, Number(event.target.value) || 1)),
                        gridHeight(current),
                      )
                    : current,
                )
              }
            />
          </label>
          <label>
            H:{' '}
            <input
              type="number"
              className="blockpy-pixel-size"
              min={1}
              max={MAX_PIXEL_DIMENSION}
              value={height}
              onChange={(event) =>
                setGrid((current) =>
                  current
                    ? resizeGrid(
                        current,
                        gridWidth(current),
                        Math.max(1, Math.min(MAX_PIXEL_DIMENSION, Number(event.target.value) || 1)),
                      )
                    : current,
                )
              }
            />
          </label>
          <button
            type="button"
            className="btn btn-sm btn-outline-secondary blockpy-pixel-apply"
            disabled={readOnly}
            onClick={applyGrid}
          >
            Apply
          </button>
          <button
            type="button"
            className="btn btn-sm btn-outline-secondary blockpy-pixel-cancel"
            onClick={() => setGrid(null)}
          >
            Cancel
          </button>
        </div>
        {pixelError && <div className="blockpy-image-error">{pixelError}</div>}
        <div
          className="blockpy-pixel-grid blockpy-image-checkerboard"
          role="grid"
          aria-label="Pixel grid"
          onMouseDown={() => (dragging.current = true)}
          onMouseUp={() => (dragging.current = false)}
          onMouseLeave={() => (dragging.current = false)}
        >
          {grid.map((row, y) => (
            <div className="blockpy-pixel-row" key={y}>
              {row.map((cell, x) => (
                <button
                  key={x}
                  type="button"
                  role="gridcell"
                  aria-label={`Pixel ${x},${y}`}
                  className="blockpy-pixel-cell"
                  style={cell ? { backgroundColor: cell } : undefined}
                  onMouseDown={() => paintCell(x, y)}
                  onMouseEnter={() => {
                    if (dragging.current) paintCell(x, y);
                  }}
                />
              ))}
            </div>
          ))}
        </div>
      </div>
    );
  }

  // -- preview / creator mode ------------------------------------------------
  return (
    <div className="blockpy-image-editor">
      <div className="blockpy-image-toolbar">
        {isImage && (
          <>
            <label>
              Zoom:{' '}
              <select
                className="blockpy-image-zoom"
                value={zoom}
                onChange={(event) => setZoom(Number(event.target.value))}
              >
                {ZOOMS.map((option) => (
                  <option key={option} value={option}>
                    {option}×
                  </option>
                ))}
              </select>
            </label>
            <span className="blockpy-image-dimensions">{dimensions ?? '…'}</span>
            {!readOnly && (
              <button
                type="button"
                className="btn btn-sm btn-outline-secondary blockpy-pixel-edit"
                onClick={beginPixelEdit}
              >
                Edit Pixels
              </button>
            )}
          </>
        )}
        <button
          type="button"
          className="btn btn-sm btn-outline-secondary blockpy-image-raw"
          title="Edit the file as raw text"
          onClick={onRawView}
        >
          Raw Text
        </button>
      </div>
      {pixelError && <div className="blockpy-image-error">{pixelError}</div>}
      {isImage ? (
        <div className="blockpy-image-preview blockpy-image-checkerboard">
          <img
            src={value}
            alt="Preview"
            style={{
              width: dimensions ? undefined : 'auto',
              transform: `scale(${zoom})`,
              transformOrigin: 'top left',
            }}
            onLoad={(event) => {
              const image = event.currentTarget;
              setDimensions(`${image.naturalWidth} × ${image.naturalHeight}`);
            }}
          />
        </div>
      ) : (
        <div className="blockpy-image-create">
          <p>
            This file is not an image data-URL yet.
            {readOnly ? '' : ' Create a blank sprite canvas:'}
          </p>
          {!readOnly && (
            <div className="blockpy-image-toolbar">
              <label>
                Width:{' '}
                <input
                  type="number"
                  className="blockpy-pixel-size blockpy-image-new-width"
                  min={1}
                  max={MAX_PIXEL_DIMENSION}
                  value={newWidth}
                  onChange={(event) => setNewWidth(event.target.value)}
                />
              </label>
              <label>
                Height:{' '}
                <input
                  type="number"
                  className="blockpy-pixel-size blockpy-image-new-height"
                  min={1}
                  max={MAX_PIXEL_DIMENSION}
                  value={newHeight}
                  onChange={(event) => setNewHeight(event.target.value)}
                />
              </label>
              <button
                type="button"
                className="btn btn-sm btn-outline-secondary blockpy-image-create-blank"
                onClick={createBlank}
              >
                Create Canvas
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
