import { describe, it, expect } from 'vitest';
import {
  BUILTIN_COMMANDS,
  filterCommands,
  fuzzyFilter,
  getAllCommands,
  findCommand,
  renderHelpText,
  type CommandSpec,
} from '../src/help-text';

describe('help-text catalog', () => {
  it('includes the core session commands', () => {
    const names = BUILTIN_COMMANDS.map((c) => c.name);
    for (const required of [
      'help',
      'new',
      'sessions',
      'clear',
      'quit',
      'exit',
      'settings',
      'tools',
      'profiles',
      'memory',
      'mcp',
      'budget',
      'export',
      'templates',
      'template',
    ]) {
      expect(names).toContain(required);
    }
  });

  it('has no duplicate command names', () => {
    const seen = new Set<string>();
    for (const c of BUILTIN_COMMANDS) {
      expect(seen.has(c.name)).toBe(false);
      seen.add(c.name);
    }
  });

  it('assigns a valid group to every command', () => {
    const validGroups = new Set(['Session', 'Settings', 'Browse', 'Templates', 'Quit']);
    for (const c of BUILTIN_COMMANDS) {
      expect(validGroups.has(c.group)).toBe(true);
    }
  });

  it('has a non-empty description for every command', () => {
    for (const c of BUILTIN_COMMANDS) {
      expect(c.description.length).toBeGreaterThan(0);
    }
  });
});

describe('filterCommands', () => {
  it('returns the first N commands for an empty query', () => {
    const result = filterCommands('', BUILTIN_COMMANDS, 5);
    expect(result.length).toBe(5);
    expect(result[0].name).toBe('help');
  });

  it('returns prefix matches before substring matches', () => {
    const result = filterCommands('s', BUILTIN_COMMANDS, 10);
    // 's' should match: sessions, settings, ... (all start with s).
    expect(result.length).toBeGreaterThan(0);
    // First result should be a name that starts with 's'.
    expect(result[0].name.startsWith('s')).toBe(true);
  });

  it('strips a leading slash from the query', () => {
    const withSlash = filterCommands('/help');
    const withoutSlash = filterCommands('help');
    expect(withSlash[0].name).toBe('help');
    expect(withoutSlash[0].name).toBe('help');
  });

  it('finds fuzzy matches when there is no prefix or substring match', () => {
    // 'qit' is not a substring of 'quit' but the chars appear in order.
    const result = filterCommands('qit', BUILTIN_COMMANDS);
    expect(result.map((c) => c.name)).toContain('quit');
  });

  it('returns an empty list when nothing matches', () => {
    const result = filterCommands('zzzzzzz', BUILTIN_COMMANDS);
    expect(result).toEqual([]);
  });

  it('respects the limit parameter', () => {
    const result = filterCommands('', BUILTIN_COMMANDS, 3);
    expect(result.length).toBe(3);
  });

  it('matches against custom commands too (regression: CommandPalette used to drop them)', () => {
    // The CommandPalette bug was that filterCommands was called with an
    // empty custom-commands list, so typed queries never matched any
    // user-added slash command. This test pins the correct behavior.
    const custom: CommandSpec[] = [
      { name: 'deploy', description: 'Deploy to staging', group: 'Templates', custom: true },
      { name: 'review', description: 'Open a PR review', group: 'Templates', custom: true },
    ];
    const result = filterCommands('dep', custom);
    expect(result.map((c) => c.name)).toContain('deploy');
    const result2 = filterCommands('rev', custom);
    expect(result2.map((c) => c.name)).toContain('review');
  });
});

describe('fuzzyFilter', () => {
  it('matches against command descriptions', () => {
    const result = fuzzyFilter('budget', BUILTIN_COMMANDS);
    expect(result.map((c) => c.name)).toContain('budget');
  });

  it('returns commands in score order', () => {
    // 'mem' should put 'memory' first.
    const result = fuzzyFilter('mem', BUILTIN_COMMANDS);
    expect(result[0].name).toBe('memory');
  });

  it('returns an empty list for nonsense queries', () => {
    const result = fuzzyFilter('zzqxqzxqz', BUILTIN_COMMANDS);
    expect(result).toEqual([]);
  });
});

describe('findCommand', () => {
  it('finds a command case-insensitively', () => {
    expect(findCommand('HELP')?.name).toBe('help');
    expect(findCommand('Quit')?.name).toBe('quit');
  });

  it('returns undefined for unknown names', () => {
    expect(findCommand('nonexistent')).toBeUndefined();
  });

  it('finds custom commands', () => {
    const custom: CommandSpec[] = [
      { name: 'deploy', description: 'Deploy to staging', group: 'Templates' },
    ];
    expect(findCommand('deploy', custom)?.name).toBe('deploy');
  });
});

describe('getAllCommands', () => {
  it('merges builtin and custom commands', () => {
    const custom: CommandSpec[] = [
      { name: 'deploy', description: 'Deploy to staging', group: 'Templates' },
    ];
    const all = getAllCommands(custom);
    expect(all.length).toBe(BUILTIN_COMMANDS.length + 1);
    expect(all.map((c) => c.name)).toContain('deploy');
  });

  it('returns builtins only when no custom provided', () => {
    const all = getAllCommands();
    expect(all.length).toBe(BUILTIN_COMMANDS.length);
  });
});

describe('renderHelpText', () => {
  it('lists every builtin command by name', () => {
    const help = renderHelpText();
    for (const cmd of BUILTIN_COMMANDS) {
      expect(help).toContain('/' + cmd.name);
    }
  });

  it('has a Slash Commands section and a Keybinds section', () => {
    const help = renderHelpText();
    expect(help).toContain('## Slash Commands');
    expect(help).toContain('## Keybinds');
  });

  it('documents Ctrl+K (palette) and Ctrl+E (export) keybinds', () => {
    const help = renderHelpText();
    expect(help).toContain('Ctrl+K');
    expect(help).toContain('Ctrl+E');
  });

  it('exposes /model in the settings group (F-1 quick switch)', () => {
    const modelCmd = BUILTIN_COMMANDS.find((c) => c.name === 'model');
    expect(modelCmd).toBeDefined();
    expect(modelCmd!.group).toBe('Settings');
    // And it should be discoverable in the slash command palette. We
    // pass the builtin commands explicitly (not []) to make sure the
    // second arg defaults work as documented.
    const result = filterCommands('/model', BUILTIN_COMMANDS);
    expect(result.find((c) => c.name === 'model')).toBeDefined();
  });

  it('includes a (custom) tag for custom commands', () => {
    const custom: CommandSpec[] = [
      { name: 'deploy', description: 'Deploy to staging', group: 'Templates', custom: true },
    ];
    const help = renderHelpText(custom);
    expect(help).toContain('/deploy');
    expect(help).toContain('(custom)');
  });
});
