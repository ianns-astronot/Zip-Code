import React, { useEffect, useMemo, useState } from 'react';
import { Box, Text, useInput } from 'ink';
import { filterCommands, type CommandSpec } from '../help-text.js';

export interface CommandPaletteProps {
  /** All available commands (builtin + custom) to display. */
  commands: CommandSpec[];
  /** Called when the user picks a command. */
  onPick: (cmd: CommandSpec) => void;
  /** Called when the user dismisses the palette. */
  onClose: () => void;
}

/**
 * VSCode-style command palette. Shows a fuzzy-searchable list of all
 * commands grouped by category. ↑↓ navigates, Enter activates, Esc closes.
 */
export function CommandPalette({ commands, onPick, onClose }: CommandPaletteProps): JSX.Element {
  const [query, setQuery] = useState('');
  const [idx, setIdx] = useState(0);

  // Custom commands are passed in as part of `commands`; extract them so
  // filterCommands() can include them in the typed-query search. The earlier
  // version called filterCommands(query, []) which silently dropped every
  // user-added slash command from the result list.
  const customCommands = useMemo(
    () => commands.filter((c) => c.custom),
    [commands]
  );
  const filtered = useMemo(() => {
    if (query.length === 0) return commands;
    return filterCommands(query, customCommands);
  }, [query, commands, customCommands]);

  useEffect(() => {
    setIdx(0);
  }, [query]);

  useInput((inputChar, key) => {
    if (key.escape) {
      onClose();
      return;
    }
    if (key.return) {
      const choice = filtered[idx];
      if (choice) onPick(choice);
      return;
    }
    if (key.upArrow) {
      setIdx((i) => (i - 1 + filtered.length) % Math.max(filtered.length, 1));
      return;
    }
    if (key.downArrow) {
      setIdx((i) => (i + 1) % Math.max(filtered.length, 1));
      return;
    }
    if (key.backspace || key.delete) {
      setQuery((q) => q.slice(0, -1));
      return;
    }
    // Plain character input → append to query
    if (inputChar && inputChar.length > 0 && !key.ctrl && !key.meta) {
      setQuery((q) => q + inputChar);
    }
  });

  // Group by category
  const grouped: Record<string, CommandSpec[]> = {};
  for (const cmd of filtered) {
    const g = cmd.group;
    if (!grouped[g]) grouped[g] = [];
    grouped[g].push(cmd);
  }

  // Flatten with section headers for cursor math
  const flat: Array<{ kind: 'header' | 'cmd'; label: string; cmd?: CommandSpec }> = [];
  for (const g of Object.keys(grouped)) {
    flat.push({ kind: 'header', label: g });
    for (const c of grouped[g]) {
      flat.push({ kind: 'cmd', label: c.name, cmd: c });
    }
  }

  // Find the index-th cmd item (skip headers)
  let cmdCounter = 0;
  let cursorItemIndex = 0;
  for (let i = 0; i < flat.length; i++) {
    if (flat[i].kind === 'cmd') {
      if (cmdCounter === idx) {
        cursorItemIndex = i;
        break;
      }
      cmdCounter++;
    }
  }

  return (
    <Box
      flexDirection="column"
      borderStyle="double"
      borderColor="cyan"
      paddingX={1}
      marginY={1}
    >
      <Box>
        <Text color="cyanBright" bold>
          ⚡ Command Palette
        </Text>
        <Text color="gray"> · ↑↓ navigate · Enter run · Esc close</Text>
      </Box>
      <Box marginY={1} borderStyle="single" borderColor="gray" paddingX={1}>
        <Text color="cyanBright">{'> '}</Text>
        <Text color="white">{query || ' '}</Text>
        <Text color="gray" dimColor>{' '}(type to filter)</Text>
      </Box>
      {filtered.length === 0 ? (
        <Text color="gray" dimColor>
          (no commands match "{query}")
        </Text>
      ) : (
        flat.slice(0, 16).map((item, i) => {
          if (item.kind === 'header') {
            return (
              <Text key={`h-${i}`} color="magentaBright" bold>
                {item.label}
              </Text>
            );
          }
          const active = i === cursorItemIndex;
          return (
            <Box key={item.cmd!.name}>
              <Text color={active ? 'cyanBright' : 'gray'}>
                {active ? '› ' : '  '}
              </Text>
              <Box width={20}>
                <Text color={active ? 'white' : 'cyan'} bold={active}>
                  /{item.cmd!.name}
                </Text>
              </Box>
              <Text color={active ? 'white' : 'gray'}>{item.cmd!.description}</Text>
            </Box>
          );
        })
      )}
    </Box>
  );
}
