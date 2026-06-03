import React, { useState } from 'react';
import { Box, Text, useInput } from 'ink';
import {
  BUILTIN_COMMANDS,
  renderHelpText,
  type CommandSpec,
} from '../help-text.js';
import { renderMarkdownLines } from './markdown.js';

export interface HelpPanelProps {
  /** Custom commands (from the user's slash-commands directory). */
  customCommands?: CommandSpec[];
  onClose: () => void;
}

/**
 * Modal help viewer. Press F1 or /help to open. Lists all commands grouped by
 * category, with their description. Use ↑/↓ to scroll if it overflows.
 */
export function HelpPanel({ customCommands = [], onClose }: HelpPanelProps): JSX.Element {
  const [scroll, setScroll] = useState(0);
  const allCmds = [...BUILTIN_COMMANDS, ...customCommands];
  const helpText = renderHelpText(customCommands);
  const lines = renderMarkdownLines(helpText);

  useInput((input, key) => {
    if (key.escape) {
      onClose();
      return;
    }
    if (input === 'q' || key.return) {
      onClose();
      return;
    }
    if (key.upArrow) setScroll((n) => Math.max(0, n - 1));
    if (key.downArrow) setScroll((n) => n + 1);
    if (key.pageUp) setScroll((n) => Math.max(0, n - 5));
    if (key.pageDown) setScroll((n) => n + 5);
  });

  const visible = lines.slice(scroll, scroll + 30);

  return (
    <Box
      flexDirection="column"
      borderStyle="double"
      borderColor="cyan"
      paddingX={2}
      paddingY={1}
      marginY={1}
    >
      <Box marginBottom={1} justifyContent="space-between">
        <Text color="cyan" bold>
          ? Help — all commands
        </Text>
        <Text color="gray">{allCmds.length} commands · ↑↓ scroll · Esc close</Text>
      </Box>
      <Box flexDirection="column" marginLeft={2}>
        {visible.map((l, i) => (
          <HelpLine key={i} line={l} />
        ))}
      </Box>
      <Box marginTop={1}>
        <Text color="gray" dimColor>
          ↑↓ scroll · PgUp/PgDn page · Esc or q to close
        </Text>
      </Box>
    </Box>
  );
}

function HelpLine({
  line,
}: {
  line: ReturnType<typeof renderMarkdownLines>[number];
}): JSX.Element {
  switch (line.type) {
    case 'heading':
      return (
        <Text color="yellow" bold>
          {line.text}
        </Text>
      );
    case 'rule':
      return <Text color="gray">────────────────</Text>;
    case 'code':
      return (
        <Text color="cyan">
          {'  '}
          {line.text}
        </Text>
      );
    case 'list':
      return <Text>{'  • '}{line.text}</Text>;
    case 'quote':
      return (
        <Text color="gray">
          {'│ '}
          {line.text}
        </Text>
      );
    default:
      return <Text>{line.text}</Text>;
  }
}
