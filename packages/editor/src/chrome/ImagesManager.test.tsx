// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';

afterEach(cleanup);
import {
  canModifyPlacement,
  ImagesManager,
  type UploadedFilesMap,
  type UploadsController,
} from './ImagesManager';

const LISTING: UploadedFilesMap = {
  assignment: [
    ['capitals.txt', '/api/download_file?placement=assignment&directory=101&filename=capitals.txt'],
  ],
  submission: [
    ['mine.png', '/api/download_file?placement=submission&directory=5001&filename=mine.png'],
  ],
};

function controller(overrides: Partial<UploadsController> = {}): UploadsController {
  return {
    list: vi.fn(() => Promise.resolve(LISTING)),
    upload: vi.fn(() => Promise.resolve()),
    remove: vi.fn(() => Promise.resolve()),
    rename: vi.fn(() => Promise.resolve()),
    ...overrides,
  };
}

describe('canModifyPlacement (blockpy.js:1119)', () => {
  it('students modify only submission/user placements', () => {
    expect(canModifyPlacement('submission', false)).toBe(true);
    expect(canModifyPlacement('user', false)).toBe(true);
    expect(canModifyPlacement('assignment', false)).toBe(false);
    expect(canModifyPlacement('course', false)).toBe(false);
    expect(canModifyPlacement('assignment', true)).toBe(true);
  });
});

describe('ImagesManager (legacy IMAGE_EDITOR_HTML)', () => {
  it('lists files per placement on entry with previews', async () => {
    const uploads = controller();
    render(<ImagesManager uploads={uploads} />);
    await waitFor(() => {
      expect(screen.getByText('capitals.txt')).toBeDefined();
    });
    expect(uploads.list).toHaveBeenCalledTimes(1);
    expect(screen.getByText('Assignment')).toBeDefined(); // capitalized group
    expect(screen.getByText('mine.png')).toBeDefined();
  });

  it('students see actions only on their own placements', async () => {
    const { container } = render(<ImagesManager uploads={controller()} />);
    await waitFor(() => screen.getByText('mine.png'));
    // One modifiable row (submission) → one Delete/Rename pair.
    expect(container.querySelectorAll('button.btn-danger')).toHaveLength(2);
    const { container: instructorView } = render(
      <ImagesManager uploads={controller()} instructor />,
    );
    await waitFor(() =>
      expect(instructorView.querySelectorAll('button.btn-danger')).toHaveLength(4),
    );
  });

  it('delete/rename parse the placement/directory from the file URL', async () => {
    const uploads = controller();
    vi.spyOn(window, 'prompt').mockReturnValue('renamed.txt');
    render(<ImagesManager uploads={uploads} instructor />);
    await waitFor(() => screen.getByText('capitals.txt'));
    const rows = screen.getAllByRole('row');
    const capitalsRow = rows.find((row) => row.textContent?.includes('capitals.txt'))!;
    fireEvent.click(capitalsRow.querySelector('button')!); // Delete
    expect(uploads.remove).toHaveBeenCalledWith('assignment', '101', 'capitals.txt');
    fireEvent.click(capitalsRow.querySelectorAll('button')[1]!); // Rename
    expect(uploads.rename).toHaveBeenCalledWith('assignment', '101', 'capitals.txt', 'renamed.txt');
  });

  it('uploads the chosen file; filename pre-fills; placement gated', async () => {
    const uploads = controller();
    const { container } = render(<ImagesManager uploads={uploads} />);
    await waitFor(() => screen.getByText('mine.png'));
    // Students cannot choose a placement (canChoosePlacement = instructor).
    expect(container.querySelector('.blockpy-editor-images-upload-placement')).toBeNull();
    const file = new File(['x,y'], 'points.csv');
    fireEvent.change(container.querySelector('.blockpy-editor-images-upload-file')!, {
      target: { files: [file] },
    });
    const nameInput = container.querySelector(
      '.blockpy-editor-images-upload-filename',
    ) as HTMLInputElement;
    expect(nameInput.value).toBe('points.csv'); // pre-filled (images.js:120)
    fireEvent.click(screen.getByRole('button', { name: 'Upload' }));
    await waitFor(() => {
      expect(uploads.upload).toHaveBeenCalledWith('submission', 'points.csv', file);
    });
    // Success reloads the listing (images.js:229-231).
    expect(uploads.list).toHaveBeenCalledTimes(2);
  });
});
