import React, { useMemo, useState } from 'react';
import { Box, Text, useInput } from 'ink';
import TextInput from 'ink-text-input';
import type { SessionRow } from '../types.js';
import { gradient } from './theme.js';

/** Max sessions to render at once. The list is paged when longer. */
const VISIBLE_PAGE = 10;

export interface SessionListProps {
  sessions: SessionRow[];
  currentSessionId: string;
  onSelect: (sessionId: string) => void;
  onNew: () => void;
  onCancel: () => void;
  /** Called when the user renames a session (presses Enter in rename mode). */
  onRename?: (sessionId: string, newTitle: string) => void;
  /** Called when the user confirms a session deletion. */
  onDelete?: (sessionId: string) => void;
}

type Mode = 'normal' | 'renaming' | 'deleting';

/**
 * Modal session picker. Keybinds:
 *  - ↑/↓        navigate
 *  - Enter      open the highlighted session
 *  - n          start a new session
 *  - r          rename the highlighted session (inline TextInput)
 *  - d          start delete-confirm for the highlighted session
 *  - Y (confirm) actually delete
 *  - Esc        cancel current action or close the panel
 */
export function SessionList({
  sessions,
  currentSessionId,
  onSelect,
  onNew,
  onCancel,
  onRename,
  onDelete,
}: SessionListProps): JSX.Element {
  const [selected, setSelected] = useState(() => {
    const idx = sessions.findIndex((s) => s.id === currentSessionId);
    return idx >= 0 ? idx : 0;
  });
  const [mode, setMode] = useState<Mode>('normal');
  const [renameValue, setRenameValue] = useState('');

  const colors = gradient(2);

  useInput((input: string, key: any) => {
    if (mode === 'renaming') {
      // The TextInput owns the keyboard for normal characters; we just
      // need to handle Esc to abort.
      if (key.escape) {
        setMode('normal');
        setRenameValue('');
        return;
      }
      // Let the TextInput's onSubmit handle Enter.
      return;
    }
    if (mode === 'deleting') {
      if (key.escape) {
        setMode('normal');
        return;
      }
      if (input === 'y' || input === 'Y') {
        const sess = sessions[selected];
        if (sess && onDelete) onDelete(sess.id);
        setMode('normal');
        return;
      }
      return;
    }
    // Normal mode
    if (key.escape) {
      onCancel();
      return;
    }
    if (key.upArrow) {
      setSelected((s) => Math.max(0, s - 1));
      return;
    }
    if (key.downArrow) {
      setSelected((s) => Math.min(sessions.length - 1, s + 1));
      return;
    }
    if (key.return) {
      const sess = sessions[selected];
      if (sess) onSelect(sess.id);
      return;
    }
    if (input === 'n' || input === 'N') {
      onNew();
      return;
    }
    if ((input === 'r' || input === 'R') && onRename) {
      const sess = sessions[selected];
      if (!sess) return;
      setRenameValue(sess.title || '');
      setMode('renaming');
      return;
    }
    if ((input === 'd' || input === 'D') && onDelete) {
      const sess = sessions[selected];
      if (!sess) return;
      setMode('deleting');
      return;
    }
  });

  const selectedSession = sessions[selected];
  const showRename = mode === 'renaming' && selectedSession;
  const showDelete = mode === 'deleting' && selectedSession;

  // Pagination: keep the highlighted row visible by shifting the visible
  // window. We render at most VISIBLE_PAGE rows.
  const pageStart = useMemo(() => {
    if (sessions.length <= VISIBLE_PAGE) return 0;
    // Center the window on the selection when possible, clamp to bounds.
    const ideal = selected - Math.floor(VISIBLE_PAGE / 2);
    return Math.max(0, Math.min(ideal, sessions.length - VISIBLE_PAGE));
  }, [selected, sessions.length]);
  const pageEnd = pageStart + VISIBLE_PAGE;
  const visible = sessions.slice(pageStart, pageEnd);
  const hasMoreAbove = pageStart > 0;
  const hasMoreBelow = pageEnd < sessions.length;

  return (
    <Box
      flexDirection="column"
      borderStyle="double"
      borderColor={colors[0]}
      paddingX={2}
      paddingY={1}
    >
      <Box marginBottom={1}>
        <Text color={colors[0]} bold>
          ◆ Sessions
        </Text>
        <Text color="gray">
          {' '}
          · ↑↓ select · Enter open · n new · r rename · d delete · Esc cancel
        </Text>
      </Box>
      {sessions.length === 0 ? (
        <Text color="gray">No sessions yet. Press 'n' to start one.</Text>
      ) : (
        <>
          {hasMoreAbove ? (
            <Text color="gray" dimColor>
              ⬆ {pageStart} more above · press ↑ to scroll
            </Text>
          ) : null}
          {visible.map((s, i) => {
            const realIdx = pageStart + i;
            const active = realIdx === selected;
            const current = s.id === currentSessionId;
            return (
              <Box key={s.id}>
                <Text color={active ? 'cyanBright' : current ? 'magenta' : 'gray'}>
                  {active ? '› ' : '  '}
                </Text>
                <Box flexGrow={1}>
                  <Text
                    color={active ? 'cyanBright' : current ? 'white' : 'white'}
                    bold={active}
                  >
                    {truncate(s.title || '(untitled)', 40)}
                  </Text>
                </Box>
                <Box>
                  <Text color="gray">
                    {s.messageCount} msg · {timeAgo(s.updatedAt)}
                    {current ? ' · current' : ''}
                  </Text>
                </Box>
              </Box>
            );
          })}
          {hasMoreBelow ? (
            <Text color="gray" dimColor>
              ⬇ {sessions.length - pageEnd} more below · press ↓ to scroll
            </Text>
          ) : null}
        </>
      )}
      {showRename ? (
        <Box marginTop={1} flexDirection="column">
          <Text color="cyan" bold>
            ✎ Rename session
          </Text>
          <Box>
            <Text color="cyan">{'  › '}</Text>
            <TextInput
              value={renameValue}
              onChange={setRenameValue}
              onSubmit={(v) => {
                const trimmed = v.trim();
                if (trimmed && onRename && selectedSession) {
                  onRename(selectedSession.id, trimmed);
                }
                setMode('normal');
                setRenameValue('');
              }}
              placeholder="New title (Enter to save, Esc to cancel)"
            />
          </Box>
        </Box>
      ) : null}
      {showDelete ? (
        <Box marginTop={1} flexDirection="column">
          <Text color="red" bold>
            ⚠ Delete "{selectedSession.title || '(untitled)'}"?
          </Text>
          <Text color="gray">
            This will permanently remove the session and its{' '}
            {selectedSession.messageCount} message
            {selectedSession.messageCount === 1 ? '' : 's'}.
          </Text>
          <Text color="gray" dimColor>
            Press <Text color="red" bold>Y</Text> to confirm,{' '}
            <Text color="white" bold>Esc</Text> to cancel.
          </Text>
        </Box>
      ) : null}
    </Box>
  );
}

function truncate(s: string, max: number): string {
  if (s.length <= max) return s;
  return s.slice(0, max - 1) + '…';
}

function timeAgo(ts: number): string {
  const diff = Date.now() - ts;
  const m = Math.floor(diff / 60000);
  if (m < 1) return 'just now';
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  return `${d}d ago`;
}
