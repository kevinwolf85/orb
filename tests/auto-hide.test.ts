import assert from 'node:assert/strict';
import test from 'node:test';
import { hasProtectedFocus } from '../web/use-auto-hide.ts';

test('protected settings focus blocks auto-hide', () => {
  const input = { matches: (selector: string) => selector.includes('input') } as unknown as Element;
  const button = { matches: () => false } as unknown as Element;
  const settings = { contains: (element: object) => element === input || element === button } as unknown as Element;
  assert.equal(hasProtectedFocus(settings, input), true);
  assert.equal(hasProtectedFocus(settings, button), false);
});
