import { expect, it } from 'vitest';
import { PACKAGE_NAME } from './index';

it('exposes its package name', () => {
  expect(PACKAGE_NAME).toBe('@blockpy/editor');
});
