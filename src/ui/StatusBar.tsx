import React, { useEffect, useState } from 'react';
import { Box, Text, useInput } from 'ink';
import Spinner from 'ink-spinner';
import { StreamingIndicator } from './StreamingIndicator.js';
import { gradient } from './theme.js';

export interface StatusBarProps {
  thinking: boolean;
  pendingTools: number;
  hint?: string;
  error?: string;
  warnings?: string[];
  // Streaming progress for the active assistant message
  streaming?: boolean;
  streamCharCount?: number;
  streamStartedAt?: number;
  streamLastDeltaAt?: number;
  // Optional: current profile name shown in left status
  profile?: string;
  /**
   * When true, the error block expands to show the full error and any
   * recovery hints. When false (default), the error is shown as a one-line
   * summary with a "press E to expand" affordance.
   */
  errorExpanded?: boolean;
  onToggleErrorExpand?: () => void;
  /** Optional second-line action prompt (e.g. "Ctrl+S to configure"). */
  errorAction?: string;
}

/**
 * Choose a contextual hint for the right-hand side of the status bar.
 * Matches the user's current activity so the affordances shown are the
 * ones that actually do something useful.
 */
function pickHint(
  thinking: boolean,
  pendingTools: number,
  streaming: boolean | undefined,
  error: string | undefined
): string {
  if (error) return 'Ctrl+S settings · Ctrl+L sessions · Esc dismiss';
  if (streaming) return 'Esc cancel · Ctrl+K palette';
  if (thinking) return 'Esc cancel · Ctrl+T tools';
  if (pendingTools > 0) return 'Esc cancel · Ctrl+T tools';
  return '/help · Ctrl+H help · Ctrl+T tools · Ctrl+P profiles · Ctrl+K palette · Ctrl+C quit';
}

/** Truncate an error to a single short line for the collapsed state. */
function shortError(s: string): string {
  const firstLine = s.split(/\r?\n/)[0] ?? s;
  if (firstLine.length <= 110) return firstLine;
  return firstLine.slice(0, 109) + '…';
}

export function StatusBar({
  thinking,
  pendingTools,
  hint,
  error,
  warnings,
  streaming,
  streamCharCount,
  streamStartedAt,
  streamLastDeltaAt,
  profile,
  errorExpanded = false,
  onToggleErrorExpand,
  errorAction,
}: StatusBarProps): JSX.Element {
  const colors = gradient(2);
  const contextualHint = hint || pickHint(thinking, pendingTools, !!streaming, error);

  return (
    <Box flexDirection="column">
      {/* Warnings row */}
      {warnings && warnings.length > 0 ? (
        <Box paddingX={1} flexDirection="column">
          {warnings.map((w, i) => (
            <Text key={i} color="yellow">
              ⚠ {w}
            </Text>
          ))}
        </Box>
      ) : null}

      {/* Streaming progress row - only when actively streaming */}
      {streaming ? (
        <Box paddingX={1}>
          <StreamingIndicator
            streaming={streaming}
            charCount={streamCharCount}
            startedAt={streamStartedAt}
            lastDeltaAt={streamLastDeltaAt}
            label="receiving response"
          />
        </Box>
      ) : null}

      {/* Error block (collapsed by default, expandable) */}
      {error ? (
        <Box
          flexDirection="column"
          borderStyle="round"
          borderColor="red"
          paddingX={1}
          marginX={0}
        >
          <Box>
            <Text color="red" bold>
              ⚠ Error:{' '}
            </Text>
            {errorExpanded ? (
              <Text color="red">{error}</Text>
            ) : (
              <Text color="red">{shortError(error)}</Text>
            )}
            {onToggleErrorExpand ? (
              <Text color="gray" dimColor>
                {'  '}
                [{errorExpanded ? 'E' : 'E'}] {errorExpanded ? 'collapse' : 'expand'}
              </Text>
            ) : null}
          </Box>
          {errorAction ? (
            <Text color="yellow">{errorAction}</Text>
          ) : null}
        </Box>
      ) : null}

      {/* Main status row */}
      <Box
        flexDirection="row"
        justifyContent="space-between"
        paddingX={1}
        borderStyle="single"
        borderColor={
          error
            ? 'red'
            : thinking || pendingTools > 0 || streaming
            ? colors[1]
            : 'gray'
        }
      >
        <Box>
          {thinking ? (
            <Text color="cyan">
              <Spinner type="dots12" /> thinking…
            </Text>
          ) : pendingTools > 0 ? (
            <Text color="blue">
              <Spinner type="dots12" /> running {pendingTools} tool
              {pendingTools > 1 ? 's' : ''}…
            </Text>
          ) : streaming ? (
            <Text color="cyan">⟳ streaming</Text>
          ) : error ? (
            <Text color="red" bold>
              ● error
            </Text>
          ) : (
            <>
              <Text color="green" bold>● ready</Text>
              {profile && profile !== 'general' ? (
                <Text color="gray">
                  {' '}
                  · profile: <Text color="magentaBright">{profile}</Text>
                </Text>
              ) : null}
            </>
          )}
        </Box>
        <Box>
          <Text color="gray">{contextualHint}</Text>
        </Box>
      </Box>
    </Box>
  );
}
