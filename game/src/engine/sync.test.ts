import { describe, expect, it } from 'vitest';
import { SyncMachine } from './sync';

const playing = (t: number) => ({ state: 'playing' as const, currentTime: t });
const buffering = (t: number) => ({ state: 'buffering' as const, currentTime: t });

describe('SyncMachine', () => {
  it('pre-roll ad: playing but time frozen stays waiting, then counts down', () => {
    const m = new SyncMachine();
    for (let i = 0; i < 20; i++) m.tick(playing(0), 0.1);   // ad: time stuck at 0
    expect(m.state).toBe('waiting');
    m.tick(playing(0.05), 0.1);                             // content started
    expect(m.state).toBe('countdown');
    for (let i = 0; i < 31; i++) m.tick(playing(0.05 + i * 0.1), 0.1);
    expect(m.state).toBe('live');
  });
  it('mid-roll ad: stall during live → waiting → countdown → live', () => {
    const m = new SyncMachine(); m.forceLive();
    for (let i = 0; i < 10; i++) m.tick(playing(30 + i * 0.1), 0.1);
    for (let i = 0; i < 8; i++) m.tick(playing(31), 0.1);   // frozen 0.8s > 0.5s threshold
    expect(m.state).toBe('waiting');
  });
  it('buffering behaves like an ad stall', () => {
    const m = new SyncMachine(); m.forceLive();
    for (let i = 0; i < 8; i++) m.tick(buffering(31), 0.1);
    expect(m.state).toBe('waiting');
  });
  it('game-initiated seek (rewind on resume) does not unrank', () => {
    const m = new SyncMachine(); m.forceLive();
    m.tick(playing(30), 0.1);
    m.ignoreNextJump();
    m.tick(playing(27), 0.1);              // our own 3 s rewind
    expect(m.state).toBe('live');
    expect(m.unranked).toBe(false);
    m.tick(playing(90), 0.1);              // a real user seek afterwards still counts
    expect(m.unranked).toBe(true);
  });
  it('user seek marks run unranked but stays live', () => {
    const m = new SyncMachine(); m.forceLive();
    m.tick(playing(30), 0.1);
    m.tick(playing(95), 0.1);                               // jump >> 1.5s
    expect(m.state).toBe('live');
    expect(m.unranked).toBe(true);
  });
  it('pause and resume re-counts in', () => {
    const m = new SyncMachine(); m.forceLive();
    m.tick({ state: 'paused', currentTime: 30 }, 0.1);
    expect(m.state).toBe('paused');
    m.tick(playing(30.05), 0.1);
    expect(m.state).toBe('countdown');
  });
  it('ended', () => {
    const m = new SyncMachine(); m.forceLive();
    m.tick({ state: 'ended', currentTime: 213 }, 0.1);
    expect(m.state).toBe('ended');
  });
});
