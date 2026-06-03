import React from 'react';
import { Box, Text } from 'ink';
import type { ChatMessage } from '../types.js';
import { renderMarkdownLines } from './markdown.js';
import { ToolCallView } from './ToolCallView.js';
import { gradient } from './theme.js';
import { StreamingCursor } from './StreamingIndicator.js';

export interface MessageViewProps {
  messages: ChatMessage[];
  maxHeight?: number;
  /**
   * Number of messages to skip from the bottom (the "live" tail). 0 = the
   * most recent messages are visible (follow mode). Positive values scroll
   * the view back into history. The parent owns this state in response to
   * PgUp/PgDn/End keys.
   */
  scrollOffset?: number;
}

export function MessageView({
  messages,
  scrollOffset = 0,
}: MessageViewProps): JSX.Element {
  // Skip empty messages and system messages (handled elsewhere)
  const visible = messages.filter((m) => {
    if (m.role === 'system') return false;
    if (m.role === 'assistant' && !m.content && !m.toolCalls?.length)
      return false;
    return true;
  });

  // Apply scrollback: drop the last `scrollOffset` messages. Clamp so the
  // user can't scroll into the void.
  const safeOffset = Math.max(0, Math.min(scrollOffset, Math.max(0, visible.length - 1)));
  const window = visible.slice(0, Math.max(1, visible.length - safeOffset));
  const hiddenAbove = safeOffset;

  return (
    <Box flexDirection="column" flexGrow={1} paddingX={1}>
      {visible.length === 0 ? <EmptyState /> : null}
      {hiddenAbove > 0 ? (
        <Box marginY={1}>
          <Text color="yellow" dimColor>
            ⬆ {hiddenAbove} earlier message{hiddenAbove === 1 ? '' : 's'} hidden · press{' '}
          </Text>
          <Text color="yellow" bold>
            End
          </Text>
          <Text color="yellow" dimColor>
            {' '}
            or{' '}
          </Text>
          <Text color="yellow" bold>
            PgDn
          </Text>
          <Text color="yellow" dimColor>
            {' '}
            to follow
          </Text>
        </Box>
      ) : null}
      {window.map((m, idx) => (
        <MessageRow key={m.id} message={m} isLast={idx === window.length - 1} />
      ))}
    </Box>
  );
}

function EmptyState(): JSX.Element {
  const colors = gradient(2);
  return (
    <Box flexDirection="column" paddingY={1}>
      <Box>
        <Text color={colors[0]}>╭─</Text>
        <Text color={colors[0]} bold>
          {' '}✨ Welcome to ZIP CODE{' '}
        </Text>
        <Text color={colors[0]}>─╮</Text>
      </Box>
      <Box marginTop={1}>
        <Text color="gray">  Try asking:</Text>
      </Box>
      <Box marginLeft={2}>
        <Text color={colors[1]}>  ▸ </Text>
        <Text color="white">"list files in src/"</Text>
      </Box>
      <Box marginLeft={2}>
        <Text color={colors[1]}>  ▸ </Text>
        <Text color="white">"read package.json and explain it"</Text>
      </Box>
      <Box marginLeft={2}>
        <Text color={colors[1]}>  ▸ </Text>
        <Text color="white">"what does agent.ts do?"</Text>
      </Box>
      <Box marginTop={1}>
        <Text color="gray">  Or browse features:  </Text>
        <Text color={colors[1]} bold>Ctrl+T</Text>
        <Text color="gray"> tools · </Text>
        <Text color={colors[1]} bold>Ctrl+P</Text>
        <Text color="gray"> profiles · </Text>
        <Text color={colors[1]} bold>/help</Text>
      </Box>
    </Box>
  );
}

function MessageRow({
  message,
  isLast,
}: {
  message: ChatMessage;
  isLast: boolean;
}): JSX.Element {
  if (message.role === 'tool') {
    return <ToolCallView message={message} />;
  }

  const isUser = message.role === 'user';
  const label = isUser ? 'You' : 'ZIP CODE';
  const icon = isUser ? '👤' : '🤖';
  const labelColor = isUser ? 'magentaBright' : 'cyanBright';
  const accent = isUser ? 'magenta' : 'cyan';
  const isStreaming = !!message.streaming && isLast;

  return (
    <Box flexDirection="column" marginTop={1}>
      <Box>
        <Text color={accent} bold>▎</Text>
        <Text color={labelColor} bold>
          {' '}{icon} {label}
        </Text>
        {isStreaming ? (
          <Text color="cyan"> · streaming</Text>
        ) : null}
        {message.createdAt ? (
          <Text color="gray"> · {formatTime(message.createdAt)}</Text>
        ) : null}
      </Box>
      {message.content ? (
        <Box marginLeft={2} flexDirection="column">
          {renderMarkdownLines(message.content).map((line, i, arr) => (
            <RenderedLine
              key={i}
              line={line}
              showCursor={isStreaming && i === arr.length - 1}
            />
          ))}
          {/* If content is empty-trailing, still show a cursor */}
          {isStreaming && message.content.endsWith('\n') ? (
            <Box>
              <StreamingCursor active />
            </Box>
          ) : null}
        </Box>
      ) : isStreaming ? (
        <Box marginLeft={2}>
          <StreamingCursor active />
        </Box>
      ) : null}
      {message.toolCalls && message.toolCalls.length > 0 ? (
        <Box marginLeft={2} flexDirection="column" marginTop={1}>
          {message.toolCalls.map((tc) => (
            <Box key={tc.id}>
              <Text color="gray">  → calling </Text>
              <Text color="blueBright" bold>
                {tc.function.name}
              </Text>
            </Box>
          ))}
        </Box>
      ) : null}
    </Box>
  );
}

function RenderedLine({
  line,
  showCursor,
}: {
  line: ReturnType<typeof renderMarkdownLines>[number];
  showCursor?: boolean;
}): JSX.Element {
  switch (line.type) {
    case 'code':
      return (
        <Box>
          <Text color="gray">│ </Text>
          <Text color="cyan">{line.text}</Text>
          {showCursor ? <StreamingCursor active /> : null}
        </Box>
      );
    case 'heading':
      return (
        <Box>
          <Text color="yellow" bold>
            {line.text}
          </Text>
          {showCursor ? <StreamingCursor active /> : null}
        </Box>
      );
    case 'rule':
      return <Text color="gray">────────────────────────────────────</Text>;
    case 'list':
      return (
        <Box>
          <Text color="gray">  • </Text>
          <Text>{line.text}</Text>
          {showCursor ? <StreamingCursor active /> : null}
        </Box>
      );
    case 'quote':
      return (
        <Box>
          <Text color="gray">│ </Text>
          <Text color="gray">{line.text}</Text>
          {showCursor ? <StreamingCursor active /> : null}
        </Box>
      );
    default:
      return (
        <Box>
          <Text>{line.text}</Text>
          {showCursor ? <StreamingCursor active /> : null}
        </Box>
      );
  }
}

function formatTime(ts: number): string {
  const d = new Date(ts);
  const hh = String(d.getHours()).padStart(2, '0');
  const mm = String(d.getMinutes()).padStart(2, '0');
  return `${hh}:${mm}`;
}
