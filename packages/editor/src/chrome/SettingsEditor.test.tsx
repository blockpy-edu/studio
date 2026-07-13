// @vitest-environment jsdom
/**
 * M3.5: the Assignment Settings form — legacy ASSIGNMENT_SETTINGS_EDITOR
 * port. Canonical contract: Save merges ONLY edited keys over the original
 * blob (unknown keys round-trip, D5-B/LD-5); defaults don't pollute the
 * blob; assignment columns travel separately.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render } from '@testing-library/react';
import { SettingsEditor } from './SettingsEditor';

afterEach(cleanup);

const BLOB = JSON.stringify({
  toolbox: 'ct',
  hide_files: false,
  // A key Studio has never heard of — must survive (LD-5).
  time_limit: '50min',
});

describe('SettingsEditor', () => {
  it('initializes from the blob and round-trips unknown keys on save', () => {
    const onSave = vi.fn();
    const { container, getByText } = render(<SettingsEditor blob={BLOB} onSave={onSave} />);
    // Prefilled from the blob.
    const toolbox = container.querySelector<HTMLSelectElement>('#blockpy-settings-toolbox')!;
    expect(toolbox.value).toBe('ct');
    const hideFiles = container.querySelector<HTMLInputElement>('#blockpy-settings-hide_files')!;
    expect(hideFiles.checked).toBe(false);

    // Edit one boolean, save.
    fireEvent.click(container.querySelector('#blockpy-settings-disable_timeout')!);
    fireEvent.click(getByText('Save changes'));
    expect(onSave).toHaveBeenCalledTimes(1);
    const [blob, fields] = onSave.mock.calls[0] as [string, object];
    const parsed = JSON.parse(blob);
    expect(parsed.time_limit).toBe('50min'); // unknown key survived
    expect(parsed.toolbox).toBe('ct'); // untouched original kept
    expect(parsed.disable_timeout).toBe(true); // the edit
    // Unedited defaults do NOT pollute the blob.
    expect('hide_evaluate' in parsed).toBe(false);
    expect(fields).toEqual({});
  });

  it('shows defaults for absent keys (hide_files defaults TRUE per A4)', () => {
    const { container } = render(<SettingsEditor blob="" onSave={() => undefined} />);
    expect(container.querySelector<HTMLInputElement>('#blockpy-settings-hide_files')!.checked).toBe(
      true,
    );
    expect(container.querySelector<HTMLInputElement>('#blockpy-settings-can_blocks')!.checked).toBe(
      true,
    );
    expect(
      container.querySelector<HTMLInputElement>('#blockpy-settings-allow_real_requests')!.checked,
    ).toBe(false);
  });

  it('carries edited assignment columns through the second argument', () => {
    const onSave = vi.fn();
    const { container, getByText } = render(
      <SettingsEditor
        blob=""
        assignment={{ name: 'Old Name', url: 'old_url', hidden: false }}
        onSave={onSave}
      />,
    );
    const name = container.querySelector<HTMLInputElement>('#blockpy-settings-name')!;
    fireEvent.change(name, { target: { value: 'New Name' } });
    fireEvent.click(container.querySelector('#blockpy-settings-hidden')!);
    fireEvent.click(getByText('Save changes'));
    const [, fields] = onSave.mock.calls[0] as [string, { name: string; hidden: boolean }];
    expect(fields.name).toBe('New Name');
    expect(fields.hidden).toBe(true);
  });

  it('raw-JSON escape hatch overrides the form and rejects bad JSON', () => {
    const onSave = vi.fn();
    const { container, getByText } = render(<SettingsEditor blob={BLOB} onSave={onSave} />);
    fireEvent.click(getByText('Edit raw JSON'));
    const textarea = container.querySelector<HTMLTextAreaElement>('.blockpy-settings-raw')!;
    fireEvent.change(textarea, { target: { value: '{not json' } });
    fireEvent.click(getByText('Save changes'));
    expect(onSave).not.toHaveBeenCalled(); // invalid JSON blocked

    fireEvent.change(textarea, {
      target: { value: '{"toolbox": "minimal", "custom_key": 1}' },
    });
    fireEvent.click(getByText('Save changes'));
    expect(JSON.parse(onSave.mock.calls[0]![0] as string)).toEqual({
      toolbox: 'minimal',
      custom_key: 1,
    });
  });
});
