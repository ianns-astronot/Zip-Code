import React from 'react';
import { Box, Text } from 'ink';
import { gradient } from './theme.js';

export interface HeaderProps {
  providerName: string;
  model: string;
  cwd: string;
  sessionTitle: string;
  profile?: string;
  toolCount?: number;
  mcpServers?: number;
  budgetActive?: boolean;
  budgetPercent?: number;
  /** Number of messages in the current session. Shown as a small badge. */
  messageCount?: number;
}

export function Header({
  providerName,
  model,
  cwd,
  sessionTitle,
  profile,
  toolCount,
  mcpServers,
  budgetActive,
  budgetPercent,
  messageCount,
}: HeaderProps): JSX.Element {
  const colors = gradient(2);

  // Budget badge color based on usage
  const budgetColor =
    budgetPercent !== undefined && budgetPercent >= 90
      ? 'red'
      : budgetPercent !== undefined && budgetPercent >= 75
      ? 'yellow'
      : 'green';

  return (
    <Box
      flexDirection="row"
      justifyContent="space-between"
      borderStyle="round"
      borderColor={colors[0]}
      paddingX={1}
    >
      {/* Left: brand + provider/model */}
      <Box flexDirection="row">
        <Text color={colors[0]} bold>
          ZIP CODE
        </Text>
        <Text color="gray"> · </Text>
        <Text color={colors[1]}>{providerName}</Text>
        <Text color="gray">/</Text>
        <Text color="white">{model}</Text>
        {profile && profile !== 'general' ? (
          <>
            <Text color="gray"> · </Text>
            <Text color="magentaBright">🎭 {profile}</Text>
          </>
        ) : null}
      </Box>

      {/* Middle: session + badges */}
      <Box flexDirection="row" marginX={2}>
        <Text color="gray">{sessionTitle}</Text>
        {messageCount !== undefined && messageCount > 0 ? (
          <>
            <Text color="gray"> · </Text>
            <Text color="gray">💬 {messageCount}</Text>
          </>
        ) : null}
        {toolCount !== undefined ? (
          <>
            <Text color="gray"> · </Text>
            <Text color="cyan">🔧 {toolCount}</Text>
          </>
        ) : null}
        {mcpServers !== undefined && mcpServers > 0 ? (
          <>
            <Text color="gray"> · </Text>
            <Text color="blue">🔌 {mcpServers}</Text>
          </>
        ) : null}
        {budgetActive ? (
          <>
            <Text color="gray"> · </Text>
            <Text color={budgetColor}>💰 {(budgetPercent || 0).toFixed(0)}%</Text>
          </>
        ) : null}
      </Box>

      {/* Right: cwd */}
      <Box>
        <Text color="gray">📁 {shorten(cwd, 32)}</Text>
      </Box>
    </Box>
  );
}

function shorten(s: string, max: number): string {
  if (s.length <= max) return s;
  return '…' + s.slice(s.length - max + 1);
}
