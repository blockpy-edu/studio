/**
 * Versioned decoder conformance (spec §14.5) and settings round-trip (LD-5).
 */
import { describe, expect, it } from 'vitest';
import { decodeAssignment, encodeAssignment, mergeSettings } from './decoder';
import { clientMayEmit, EVENT_REGISTRY } from './events';

describe('assignment decoder (§14.5)', () => {
  it('round-trips unknown fields losslessly', () => {
    const raw = {
      id: 7,
      name: 'Test',
      url: 'test_url',
      type: 'blockpy',
      version: 3,
      instructions: 'Do it',
      starting_code: 'x = 1',
      on_run: 'from pedal import *',
      settings: '{"toolbox": "normal"}',
      // fields the rewrite does not consume:
      forked_id: 42,
      forked_version: 9,
      owner_id: 5,
      course_id: 3,
      subordinate: false,
      future_field_from_2029: { nested: true },
    };
    const decoded = decodeAssignment(raw);
    expect(decoded.name).toBe('Test');
    expect(decoded.startingCode).toBe('x = 1');

    decoded.instructions = 'Updated';
    const encoded = encodeAssignment(decoded);
    expect(encoded.instructions).toBe('Updated');
    expect(encoded.forked_id).toBe(42);
    expect(encoded.future_field_from_2029).toEqual({ nested: true });
    expect(encoded.starting_code).toBe('x = 1');
  });
});

describe('settings merge (D5-B, ledger LD-5)', () => {
  it('preserves server-only keys the legacy client destroyed', () => {
    const original = JSON.stringify({
      toolbox: 'normal',
      time_limit: 45,
      protected_ip_ranges: '10.0.0.0/8',
      poolRandomness: 'SEEDED',
    });
    const merged = JSON.parse(mergeSettings(original, { toolbox: 'ctvt', start_view: 'split' }));
    expect(merged).toEqual({
      toolbox: 'ctvt',
      start_view: 'split',
      time_limit: 45,
      protected_ip_ranges: '10.0.0.0/8',
      poolRandomness: 'SEEDED',
    });
  });

  it('tolerates an empty or unparseable original blob', () => {
    expect(JSON.parse(mergeSettings('', { a: 1 }))).toEqual({ a: 1 });
    expect(JSON.parse(mergeSettings('not json', { a: 1 }))).toEqual({ a: 1 });
  });
});

describe('event registry (D2)', () => {
  it('permits live and X- extension events only', () => {
    expect(clientMayEmit('Run.Program')).toBe(true);
    expect(clientMayEmit('X-Engine.Mode')).toBe(true); // new X- extension
    expect(clientMayEmit('Session.Start')).toBe(false); // server-fabricated
    expect(clientMayEmit('Session.End')).toBe(false); // dead
    expect(clientMayEmit('Totally.New')).toBe(false); // non-X unknown
  });

  it('records deprecation metadata for the fixed-in-studio identifiers', () => {
    const paste = EVENT_REGISTRY.find((e) => e.eventType === 'X-Editor.Paste');
    expect(paste?.deprecation?.untrustworthyBefore).toBe('studio');
    const ip = EVENT_REGISTRY.find((e) => e.eventType === 'X-IP.Change');
    expect(ip?.deprecation?.untrustworthyBefore).toBe('studio');
  });
});
