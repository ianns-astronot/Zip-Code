// Single source of truth for the /help text and the slash-command catalog
// used by autocomplete, the command palette, and the /help message.
//
// Keeping this in one place means /help, autocomplete, and Ctrl+K can never
// drift out of sync.

export interface CommandSpec {
  /** Name as the user types it, without the leading slash. */
  name: string;
  /** Short, one-line description shown in autocomplete/palette. */
  description: string;
  /** Group used for sectioning in /help and the palette. */
  group: 'Session' | 'Settings' | 'Browse' | 'Templates' | 'Quit';
  /** Optional usage hint, e.g. "<name> [vars json]". */
  usage?: string;
  /** Whether this command opens a modal panel. */
  opensPanel?: boolean;
  /** Whether this is a custom command (loaded from disk). Filled in at runtime. */
  custom?: boolean;
}

/**
 * Built-in commands. The runtime merges this with custom commands loaded from
 * `~/.zipcode/commands/*.md` and `./.zipcode/commands/*.md` — see
 * `slash-commands.ts`.
 */
export const BUILTIN_COMMANDS: CommandSpec[] = [
  // Session
  { name: 'help',      description: 'Show this help message',             group: 'Session' },
  { name: 'new',       description: 'Start a new session',                group: 'Session' },
  { name: 'sessions',  description: 'Open the session browser',           group: 'Session', opensPanel: true },
  { name: 'clear',     description: 'Clear the visible transcript',       group: 'Session' },
  { name: 'quit',      description: 'Quit ZIP CODE',                      group: 'Quit' },
  { name: 'exit',      description: 'Quit ZIP CODE (alias for /quit)',    group: 'Quit' },

  // Settings
  { name: 'settings',  description: 'Open the settings panel',           group: 'Settings', opensPanel: true },

  // Browse
  { name: 'tools',     description: 'Browse all native + MCP tools',      group: 'Browse', opensPanel: true },
  { name: 'profiles',  description: 'Browse the 7 agent profiles',        group: 'Browse', opensPanel: true },
  { name: 'memory',    description: 'Browse persistent memory',           group: 'Browse', opensPanel: true },
  { name: 'mcp',       description: 'Show connected MCP servers',         group: 'Browse', opensPanel: true },
  { name: 'budget',    description: 'Show budget usage',                  group: 'Browse', opensPanel: true },
  { name: 'export',    description: 'Export conversation (md/html/json)', group: 'Browse', opensPanel: true },
  { name: 'model',     description: 'Show or switch model (/model gpt-4)', group: 'Settings' },

  // Templates
  { name: 'templates', description: 'Browse prompt templates',            group: 'Templates', opensPanel: true },
  { name: 'template',  description: 'Render a template and send it',      group: 'Templates', usage: '<name> [vars json]' },
];

/** /budget reset is a sub-command of /budget; kept here so autocomplete works. */
export const BUDGET_RESET_ALIAS = '/budget reset';

/** Returns the command list merged with any custom commands. */
export function getAllCommands(custom: CommandSpec[] = []): CommandSpec[] {
  return [...BUILTIN_COMMANDS, ...custom];
}

/** Look up a command by name (case-insensitive). */
export function findCommand(
  name: string,
  custom: CommandSpec[] = []
): CommandSpec | undefined {
  const lower = name.toLowerCase();
  return getAllCommands(custom).find((c) => c.name.toLowerCase() === lower);
}

/**
 * Filter commands by a partial input. Returns matches ordered by best score:
 *   - exact prefix match first
 *   - substring match
 *   - fuzzy (every char in order) as a last resort
 */
export function filterCommands(
  query: string,
  commands: CommandSpec[] = BUILTIN_COMMANDS,
  limit = 8
): CommandSpec[] {
  const q = query.toLowerCase().replace(/^\//, '');
  if (!q) return commands.slice(0, limit);

  const scored: Array<{ cmd: CommandSpec; score: number }> = [];
  for (const cmd of commands) {
    const name = cmd.name.toLowerCase();
    let score = 0;
    if (name.startsWith(q)) score = 100 - (name.length - q.length);
    else if (name.includes(q)) score = 50 - (name.indexOf(q));
    else if (fuzzyMatch(q, name)) score = 10 + fuzzyScore(q, name);

    if (score > 0) scored.push({ cmd, score });
  }
  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, limit).map((s) => s.cmd);
}

function fuzzyMatch(needle: string, hay: string): boolean {
  let i = 0;
  for (const c of hay) {
    if (c === needle[i]) i++;
    if (i === needle.length) return true;
  }
  return false;
}

function fuzzyScore(needle: string, hay: string): number {
  // Bonus for matches near the start.
  const idx = hay.indexOf(needle[0]);
  return idx >= 0 ? 10 - Math.min(idx, 9) : 0;
}

/** Build the multi-section /help markdown. */
export function renderHelpText(custom: CommandSpec[] = []): string {
  const all = getAllCommands(custom);
  const groups: CommandSpec['group'][] = [
    'Session',
    'Settings',
    'Browse',
    'Templates',
    'Quit',
  ];

  const lines: string[] = ['## Slash Commands', ''];

  for (const g of groups) {
    const items = all.filter((c) => c.group === g);
    if (items.length === 0) continue;
    lines.push(`**${g}**`);
    for (const c of items) {
      const usage = c.usage ? ` ${c.usage}` : '';
      const tag = c.custom ? ' *(custom)*' : '';
      lines.push(`- \`/${c.name}${usage}\` — ${c.description}${tag}`);
    }
    lines.push('');
  }

  lines.push('## Keybinds', '');
  lines.push('- **Enter** — send message');
  lines.push('- **Shift+Enter** — newline in input (multi-line message)');
  lines.push('- **↑ / ↓** — navigate input history');
  lines.push('- **Tab** — autocomplete slash command');
  lines.push('- **Esc** — cancel in-flight call (or close panel)');
  lines.push('- **Ctrl+S** — settings');
  lines.push('- **Ctrl+L** — sessions');
  lines.push('- **Ctrl+N** — new session');
  lines.push('- **Ctrl+T** — tools panel');
  lines.push('- **Ctrl+P** — profiles panel');
  lines.push('- **Ctrl+M** — memory panel');
  lines.push('- **Ctrl+B** — budget panel');
  lines.push('- **Ctrl+E** — export panel');
  lines.push('- **Ctrl+K** — command palette (fuzzy search)');
  lines.push('- **Ctrl+C** — quit');
  return lines.join('\n');
}

/**
 * Fuzzy filter used by the Ctrl+K palette — broader than filterCommands
 * (matches against description and group too, not just name).
 */
export function fuzzyFilter(
  query: string,
  commands: CommandSpec[] = BUILTIN_COMMANDS,
  limit = 20
): CommandSpec[] {
  const q = query.toLowerCase().replace(/^\//, '').trim();
  if (!q) return commands.slice(0, limit);

  const scored: Array<{ cmd: CommandSpec; score: number }> = [];
  for (const cmd of commands) {
    const name = cmd.name.toLowerCase();
    const desc = cmd.description.toLowerCase();
    let score = 0;
    if (name.startsWith(q)) score = 100;
    else if (name.includes(q)) score = 60;
    else if (desc.includes(q)) score = 30;
    else if (fuzzyMatch(q, name)) score = 15;
    else if (fuzzyMatch(q, desc)) score = 5;

    if (score > 0) scored.push({ cmd, score });
  }
  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, limit).map((s) => s.cmd);
}
