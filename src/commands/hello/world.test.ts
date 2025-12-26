import { describe, expect, it } from 'vitest';
import World from './world.js';

describe('hello world', () => {
  it('creates world command class', () => {
    expect(World).toBeDefined();
    expect(World.description).toBe('Say hello world');
  });

  it('has correct static properties', () => {
    expect(World.args).toBeDefined();
    expect(World.flags).toBeDefined();
    expect(World.examples).toBeDefined();
  });
});
