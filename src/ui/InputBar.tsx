import React, { useEffect, useRef } from 'react';
import { Box, Text, useInput } from 'ink';
import TextInput from 'ink-text-input';
import Spinner from 'ink-spinner';
import { gradient } from './theme.js';
import type { CommandSpec } from '../help-text.js';

export interface InputBarProps {
  value: string;
  onChange: (v: string) => void;
  onSubmit: (v: string) => void;
  disabled?: boolean;
  placeholder?: string;
  /**
   * Visible status that explains why input is disabled. When set, the
   * disabled state is rendered with an inline spinner and label instead of
   * the ambiguous "…".
   */
  statusLabel?: string;
  /**
   * Optional slash-command suggestions shown as an inline popup above the
   * input. The parent owns the list (typically results of filterCommands);
   * the InputBar just renders the highlighted one and reports Tab/arrow
   * acceptances.
   */
  suggestions?: CommandSpec[];
  /** Index into `suggestions` that is currently highlighted. */
  suggestionIndex?: number;
  /** Called when the user accepts a suggestion (Tab). */
  onAcceptSuggestion?: (cmd: CommandSpec) => void;
  /** Called when the user moves the suggestion highlight. */
  onSuggestionHighlight?: (idx: number) => void;
  /**
   * History navigation. The InputBar handles ↑ / ↓ as history navigation
   * when no slash suggestions are visible (i.e. when the user is editing
   * a regular message and the buffer is one line).
   */
  onHistoryPrev?: () => void;
  onHistoryNext?: () => void;
  /** Number of lines currently in the multi-line buffer. */
  lineCount?: number;
  /** True when a code fence has been opened but not closed. */
  inFence?: boolean;
  /** True when in multi-line mode (parent owns state). */
  multiline?: boolean;
  /** Lines already committed to the multi-line buffer (parent owns). */
  committedLines?: string[];
  /** Called when the user requests to send the multi-line buffer (Ctrl+D). */
  onSendMulti?: () => void;
  /** Called when the user wants to exit multi-line mode (Esc). */
  onExitMulti?: () => void;
  /**
   * Called when the user wants to add a newline in multi-line mode
   * (Shift+Enter). The parent updates the input/committedLines state.
   */
  onAddNewline?: () => void;
  /** Called when the user wants to clear the input (Ctrl+U). */
  onClearInput?: () => void;
}

export function InputBar({
  value,
  onChange,
  onSubmit,
  disabled,
  placeholder,
  statusLabel,
  suggestions,
  suggestionIndex = 0,
  onAcceptSuggestion,
  onSuggestionHighlight,
  onHistoryPrev,
  onHistoryNext,
  lineCount = 1,
  inFence = false,
  multiline = false,
  committedLines = [],
  onSendMulti,
  onExitMulti,
  onAddNewline,
  onClearInput,
}: InputBarProps): JSX.Element {
  const colors = gradient(2);
  const isSlash = value.startsWith('/');
  const charCount = value.length;
  const showSuggestions = !!suggestions && suggestions.length > 0;
  // Ink's TextInput fires onSubmit on *any* Enter (including Shift+Enter), so
  // we suppress the next submit when we handle a multi-line key ourselves.
  const suppressNextSubmit = useRef(false);

  // Capture keys even when the inner TextInput would otherwise consume them.
  useInput(
    (inputChar, key) => {
      if (disabled) return;
      // Enter when suggestions are visible → accept the highlighted one if
      // the typed value isn't already a complete command. This matches the
      // expectation set by Claude Code / VSCode: Enter on a partial query
      // completes the command, not sends the partial text.
      if (key.return && showSuggestions && !key.shift && onAcceptSuggestion) {
        const choice = suggestions![suggestionIndex];
        const q = value.slice(1); // strip leading '/'
        const isCompleteCmd =
          q === choice?.name || q.startsWith(choice?.name + ' ');
        if (!isCompleteCmd && choice) {
          onAcceptSuggestion(choice);
          suppressNextSubmit.current = true;
          return;
        }
      }
      // Tab → accept highlighted suggestion when visible
      if (key.tab && showSuggestions) {
        const choice = suggestions![suggestionIndex];
        if (choice && onAcceptSuggestion) {
          onAcceptSuggestion(choice);
        }
        return;
      }
      // ↑ / ↓ on suggestions → move highlight
      if (key.upArrow && showSuggestions && onSuggestionHighlight) {
        onSuggestionHighlight(
          (suggestionIndex - 1 + suggestions!.length) % suggestions!.length
        );
        return;
      }
      if (key.downArrow && showSuggestions && onSuggestionHighlight) {
        onSuggestionHighlight((suggestionIndex + 1) % suggestions!.length);
        return;
      }
      // ↑ / ↓ on regular (non-suggestion) input → history navigation
      if (
        key.upArrow &&
        !showSuggestions &&
        !multiline &&
        onHistoryPrev
      ) {
        onHistoryPrev();
        return;
      }
      if (
        key.downArrow &&
        !showSuggestions &&
        !multiline &&
        onHistoryNext
      ) {
        onHistoryNext();
        return;
      }
      // Ctrl+D → send multi-line buffer
      if (key.ctrl && (inputChar === 'd' || inputChar === '\u0004')) {
        if (multiline && onSendMulti) {
          onSendMulti();
        }
        return;
      }
      // Shift+Enter → add newline (auto-promote to multi-line if needed)
      if (key.shift && key.return && onAddNewline) {
        onAddNewline();
        // Ink's TextInput fires onSubmit for any Enter, including Shift+Enter.
        // Suppress the next submit so the line isn't also sent to the agent.
        suppressNextSubmit.current = true;
        return;
      }
      // Ctrl+U → clear input
      if (key.ctrl && (inputChar === 'u' || inputChar === '\u0015') && onClearInput) {
        onClearInput();
        return;
      }
      // Esc when in multi-line → exit multi mode
      if (key.escape && multiline && onExitMulti) {
        onExitMulti();
        return;
      }
    },
    { isActive: !disabled }
  );

  if (disabled) {
    return (
      <Box
        flexDirection="row"
        borderStyle="round"
        borderColor="gray"
        paddingX={1}
      >
        <Box marginRight={1}>
          {statusLabel ? (
            <Text color="cyan">
              <Spinner type="dots12" />
            </Text>
          ) : (
            <Text color="gray">⏳</Text>
          )}
        </Box>
        <Box flexGrow={1}>
          {statusLabel ? (
            <Text color="cyan">
              {statusLabel}
              <Text color="gray"> · press </Text>
              <Text color="white" bold>
                Esc
              </Text>
              <Text color="gray"> to cancel</Text>
            </Text>
          ) : (
            <Text color="gray" dimColor>
              {value || placeholder || 'input unavailable'}
            </Text>
          )}
        </Box>
      </Box>
    );
  }

  return (
    <Box flexDirection="column">
      {/* Slash-command suggestion popup */}
      {showSuggestions ? (
        <Box
          flexDirection="column"
          borderStyle="single"
          borderColor="magenta"
          paddingX={1}
          marginBottom={0}
        >
          <Text color="gray" dimColor>
            ↳ slash commands (Tab to accept, ↑↓ to navigate)
          </Text>
          {suggestions.slice(0, 6).map((s, i) => {
            const active = i === suggestionIndex;
            return (
              <Box key={s.name}>
                <Text color={active ? 'cyanBright' : 'gray'}>
                  {active ? '› ' : '  '}
                </Text>
                <Box width={18}>
                  <Text color={active ? 'white' : 'cyan'} bold={active}>
                    /{s.name}
                  </Text>
                </Box>
                <Text color={active ? 'white' : 'gray'}>{s.description}</Text>
              </Box>
            );
          })}
        </Box>
      ) : value.startsWith('/') && value.length > 1 && !disabled ? (
        // The user is typing a slash command but no commands match — tell
        // them instead of leaving them wondering why nothing happened.
        <Box
          flexDirection="column"
          borderStyle="single"
          borderColor="gray"
          paddingX={1}
          marginBottom={0}
        >
          <Text color="gray" dimColor>
            ↳ no slash commands match "{value}" (Enter to send to model, Esc to clear)
          </Text>
        </Box>
      ) : null}

      {/* Main input row */}
      <Box
        flexDirection="row"
        borderStyle="round"
        borderColor={isSlash ? 'magenta' : colors[0]}
        paddingX={1}
      >
        <Box marginRight={1}>
          <Text
            color={isSlash ? 'magentaBright' : colors[0]}
            bold
          >
            {isSlash ? '⚡' : '▶'}
          </Text>
        </Box>
        <Box flexGrow={1}>
          <TextInput
            value={value}
            onChange={(v) => {
              onChange(v);
            }}
            onSubmit={(v) => {
              // If we just handled Shift+Enter (newline) above, swallow this
              // submit so the line isn't also sent to the agent.
              if (suppressNextSubmit.current) {
                suppressNextSubmit.current = false;
                return;
              }
              // Send through parent — it knows about history and slash
              // command handling.
              onSubmit(v);
            }}
            placeholder={
              multiline
                ? inFence
                  ? 'Inside ``` fence — Esc to exit multi-line, Ctrl+D to send'
                  : 'Multi-line · Shift+Enter newline · Ctrl+D to send · Esc to exit'
                : placeholder || 'Type a message or /help…'
            }
          />
        </Box>
        {!multiline && charCount > 0 ? (
          <Box marginLeft={1}>
            <Text color="gray" dimColor>
              {charCount}
            </Text>
          </Box>
        ) : null}
        {multiline ? (
          <Box marginLeft={1}>
            <Text color="cyan" dimColor>
              ⮐ multi ({lineCount} line{lineCount === 1 ? '' : 's'}{inFence ? ' · in fence' : ''} · Shift+Enter newline · Ctrl+D send · Esc exit)
            </Text>
          </Box>
        ) : null}
      </Box>

      {/* Multi-line preview: render the committed lines above the live input
          so the user can see what they've typed so far. The current `value`
          is already rendered as the live input below. */}
      {multiline && committedLines.length > 0 ? (
        <Box flexDirection="column" marginLeft={2} marginTop={0}>
          <Text color="gray" dimColor>
            ┊ {committedLines.length} committed line{committedLines.length === 1 ? '' : 's'}
          </Text>
          {committedLines.slice(-3).map((line, i) => (
            <Text key={i} color="gray" dimColor>
              ┊ {line || '⏎'}
            </Text>
          ))}
        </Box>
      ) : null}
    </Box>
  );
}
