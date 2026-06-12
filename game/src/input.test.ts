import { describe, expect, it } from 'vitest';
import { InputMapper } from './input';

describe('InputMapper', () => {
  it('maps default DFJK codes to lanes', () => {
    const m = new InputMapper(['KeyD', 'KeyF', 'KeyJ', 'KeyK']);
    expect(m.laneFor('KeyD')).toBe(0);
    expect(m.laneFor('KeyK')).toBe(3);
    expect(m.laneFor('KeyQ')).toBeNull();
  });
  it('rebinds', () => {
    const m = new InputMapper(['KeyD', 'KeyF', 'KeyJ', 'KeyK']);
    m.rebind(0, 'KeyA');
    expect(m.laneFor('KeyA')).toBe(0);
    expect(m.laneFor('KeyD')).toBeNull();
  });
});
