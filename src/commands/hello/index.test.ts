import { describe, expect, it } from 'vitest';
import Hello from './index.js';

describe('hello', () => {
  it('creates hello command class', () => {
    expect(Hello).toBeDefined();
    expect(Hello.description).toBe('Say hello');
  });

  it('has correct static properties', () => {
    expect(Hello.args).toBeDefined();
    expect(Hello.args.person).toBeDefined();
    expect(Hello.flags).toBeDefined();
    expect(Hello.flags.from).toBeDefined();
    expect(Hello.examples).toBeDefined();
  });
});
