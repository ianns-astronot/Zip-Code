import React, { useEffect, useMemo, useRef, useState, useCallback } from 'react';
import { Box, Text, useApp, useInput } from 'ink';
import { Header } from './Header.js';
import { MessageView } from './MessageView.js';
import { StatusBar } from './StatusBar.js';
import { InputBar } from './InputBar.js';
import { SettingsPanel } from './SettingsPanel.js';
import { SessionList } from './SessionList.js';
import { Banner } from './Banner.js';
import { ToolsPanel } from './ToolsPanel.js';
import { ProfilesPanel } from './ProfilesPanel.js';
import { TemplatesPanel } from './TemplatesPanel.js';
import { BudgetPanel } from './BudgetPanel.js';
import { MemoryPanel } from './MemoryPanel.js';
import { MCPPanel } from './MCPPanel.js';
import { ExportPanel } from './ExportPanel.js';
import { Agent, type AgentEvent } from '../agent.js';
import {
  loadConfigSync,
  getProviderInfo,
  type AppConfig,
} from '../config.js';
import {
  listProviders,
  listSessions,
  renameSession,
  deleteSession,
  updateProviderModel,
  getActiveProvider,
} from '../store.js';
import { TOOLS } from '../tools.js';
import { mcpManager } from '../mcp-client.js';
import { budgetGuard } from '../budget-guard.js';
import { promptTemplates } from '../prompt-templates.js';
import { filterCommands, type CommandSpec } from '../help-text.js';
import { inputHistory } from '../input-history.js';
import { Onboarding, shouldShowOnboarding } from './Onboarding.js';
import { slashCommands as slashCommandManager } from '../slash-commands.js';
import { CommandPalette } from './CommandPalette.js';
import { HelpPanel } from './HelpPanel.js';
import type { ChatMessage, SessionRow } from '../types.js';

/**
 * Load custom slash commands synchronously by triggering the async loader
 * and reading from the manager's cache. Returns [] on first call; subsequent
 * calls return the populated list.
 */
function loadCustomCommands(): CommandSpec[] {
  // Kick off the async load; on next render, the cache will be populated.
  void slashCommandManager.list().catch(() => []);
  return mapCustomToSpec([]);
}

/** Map a SlashCommand (from the file system loader) to a CommandSpec. */
function mapCustomToSpec(cmds: Array<{ name: string; description: string }>): CommandSpec[] {
  return cmds.map((c) => ({
    name: c.name,
    description: c.description,
    group: 'Templates' as const,
    custom: true,
  }));
}

type Modal =
  | 'none'
  | 'settings'
  | 'sessions'
  | 'tools'
  | 'profiles'
  | 'templates'
  | 'budget'
  | 'memory'
  | 'mcp'
  | 'export'
  | 'palette'
  | 'help';

export function App(): JSX.Element {
  const { exit } = useApp();
  const [config, setConfig] = useState<AppConfig>(() => loadConfigSync());
  const [agent, setAgent] = useState<Agent | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [thinking, setThinking] = useState(false);
  const [pendingTools, setPendingTools] = useState(0);
  const [modal, setModal] = useState<Modal>('none');
  const [sessions, setSessions] = useState<SessionRow[]>([]);
  const [input, setInput] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [sessionTitle, setSessionTitle] = useState('New session');
  const [showBanner, setShowBanner] = useState(true);
  const [budgetSnapshot, setBudgetSnapshot] = useState(() => budgetGuard.snapshot());
  const [mcpServerCount, setMcpServerCount] = useState(0);
  // Streaming progress tracking for the current assistant message
  const [streamingId, setStreamingId] = useState<string | null>(null);
  const [streamCharCount, setStreamCharCount] = useState(0);
  const [streamStartedAt, setStreamStartedAt] = useState<number | undefined>(undefined);
  const [streamLastDeltaAt, setStreamLastDeltaAt] = useState<number | undefined>(undefined);
  // Onboarding is shown only on first run (no providers + not dismissed).
  const [showOnboarding, setShowOnboarding] = useState<boolean>(() =>
    shouldShowOnboarding(listProviders().length > 0)
  );
  // Inline error display state: collapsed (one line) by default, 'e' to expand.
  const [errorExpanded, setErrorExpanded] = useState(false);
  useEffect(() => {
    if (!error) setErrorExpanded(false);
  }, [error]);
  // Message-area scrollback. 0 = at the bottom (follow mode). Increments of 1
  // shift the visible window up by one message. When > 0, new messages still
  // arrive but the view stays put until the user hits End.
  const [scrollOffset, setScrollOffset] = useState(0);
  // Last user-submitted message text, for the retry-after-error shortcut.
  const [lastUserMessage, setLastUserMessage] = useState<string | null>(null);
  // Input history cursor. -1 = editing current draft. 0 = most recent entry.
  const [historyCursor, setHistoryCursor] = useState<number>(-1);
  // Buffer of the in-progress draft, so we can restore it when the user
  // navigates back from history.
  const [draftBuffer, setDraftBuffer] = useState<string>('');
  // Multi-line input state. `multiline` is on once we see a newline or
  // a triple-backtick fence. We keep a list of *committed* lines plus the
  // *current* line being edited (which is `input`).
  const [multiline, setMultiline] = useState(false);
  const [committedLines, setCommittedLines] = useState<string[]>([]);
  // Slash-command suggestions shown above the input.
  const [suggestionIndex, setSuggestionIndex] = useState(0);
  // Load custom commands lazily (file system) and refresh them on each render
  // is wasteful — load once and re-load when slash command palette opens.
  const [customCommands, setCustomCommands] = useState<CommandSpec[]>(() => {
    void slashCommandManager.list()
      .then((cmds) => setCustomCommands(mapCustomToSpec(cmds)))
      .catch(() => {});
    return [];
  });
  const allCommands: CommandSpec[] = useMemo(
    () => filterCommands('', customCommands),
    [customCommands]
  );
  const suggestions: CommandSpec[] = useMemo(() => {
    if (!input.startsWith('/')) return [];
    const q = input.slice(1);
    if (q.length === 0) return allCommands.slice(0, 8);
    return filterCommands(q, customCommands).slice(0, 8);
  }, [input, allCommands, customCommands]);
  // The current line count for multi-line display.
  const lineCount = multiline ? committedLines.length + 1 : 1;
  // Detect an open code fence.
  const inFence = (() => {
    const combined = committedLines.concat([input]).join('\n');
    const matches = combined.match(/```/g);
    return matches ? matches.length % 2 === 1 : false;
  })();

  const agentRef = useRef<Agent | null>(null);

  // Bootstrap agent
  useEffect(() => {
    let cancelled = false;
    Agent.create()
      .then((a) => {
        if (cancelled) return;
        agentRef.current = a;
        setAgent(a);
        setMessages(a.getMessages());
        // Initialize input history schema + warm the cache for this session.
        try {
          inputHistory.ensureSchema();
          inputHistory.reload(a.getSessionId());
        } catch {
          /* non-critical */
        }
      })
      .catch((e) => {
        setError(e?.message || 'Failed to start agent');
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // Refresh budget + mcp status periodically
  useEffect(() => {
    const id = setInterval(() => {
      setBudgetSnapshot(budgetGuard.snapshot());
      setMcpServerCount(mcpManager.getServerStatus().filter((s) => s.connected).length);
    }, 2000);
    return () => clearInterval(id);
  }, []);

  // Subscribe to agent events
  useEffect(() => {
    if (!agent) return;
    const handler = (event: AgentEvent) => {
      switch (event.type) {
        case 'message': {
          setMessages((prev) => {
            const idx = prev.findIndex((m) => m.id === event.message.id);
            if (idx >= 0) {
              const next = prev.slice();
              next[idx] = { ...event.message };
              return next;
            }
            return [...prev, event.message];
          });
          if (event.message.role === 'user') setShowBanner(false);
          break;
        }
        case 'message_delta': {
          // Track streaming progress for the active message
          const now = Date.now();
          setStreamingId(event.id);
          setStreamLastDeltaAt(now);
          setStreamStartedAt((prev) => prev ?? now);
          setStreamCharCount((prev) => prev + (event.delta?.length || 0));

          setMessages((prev) => {
            const idx = prev.findIndex((m) => m.id === event.id);
            if (idx < 0) return prev;
            const next = prev.slice();
            next[idx] = {
              ...next[idx],
              content: next[idx].content + event.delta,
            };
            return next;
          });
          break;
        }
        case 'message_done': {
          // Reset streaming tracking when this message finishes
          setStreamingId((sid) => (sid === event.id ? null : sid));
          if (streamingId === event.id || !streamingId) {
            setStreamCharCount(0);
            setStreamStartedAt(undefined);
            setStreamLastDeltaAt(undefined);
          }
          setMessages((prev) => {
            const idx = prev.findIndex((m) => m.id === event.id);
            if (idx < 0) return prev;
            const next = prev.slice();
            next[idx] = { ...next[idx], streaming: false };
            return next;
          });
          break;
        }
        case 'tool_start': {
          setPendingTools((n) => n + 1);
          setMessages((prev) => {
            const idx = prev.findIndex((m) => m.id === event.message.id);
            if (idx >= 0) {
              const next = prev.slice();
              next[idx] = { ...event.message };
              return next;
            }
            return [...prev, event.message];
          });
          break;
        }
        case 'tool_end': {
          setPendingTools((n) => Math.max(0, n - 1));
          setMessages((prev) => {
            const idx = prev.findIndex((m) => m.id === event.message.id);
            if (idx < 0) return [...prev, event.message];
            const next = prev.slice();
            next[idx] = { ...event.message };
            return next;
          });
          break;
        }
        case 'thinking': {
          setThinking(event.on);
          break;
        }
        case 'error': {
          setError(event.message);
          // Clear streaming on error
          setStreamingId(null);
          setStreamCharCount(0);
          setStreamStartedAt(undefined);
          setStreamLastDeltaAt(undefined);
          break;
        }
        case 'session': {
          setMessages(agent.getMessages());
          // Pull the latest title from the store so the Header is correct
          // after newSession() or switchSession().
          try {
            const s = listSessions().find((x) => x.id === event.sessionId);
            if (s) setSessionTitle(s.title);
          } catch {
            /* ignore */
          }
          break;
        }
        case 'session_title': {
          if (event.sessionId === agent.getSessionId()) {
            setSessionTitle(event.title);
          }
          break;
        }
        case 'done':
          // Final cleanup - ensure streaming indicators are off
          setStreamingId(null);
          setStreamCharCount(0);
          setStreamStartedAt(undefined);
          setStreamLastDeltaAt(undefined);
          break;
      }
    };
    agent.on('event', handler);
    return () => {
      agent.off('event', handler);
    };
  }, [agent]);

  // Global keybinds
  useInput(
    useCallback(
      (inputCh: string, key: any) => {
        // Ctrl+C — quit
        if (key.ctrl && (inputCh === 'c' || inputCh === '\u0003')) {
          exit();
          return;
        }
        // Ctrl+S — settings
        if (key.ctrl && inputCh === 's') {
          setModal((m) => (m === 'settings' ? 'none' : 'settings'));
          return;
        }
        // Ctrl+L — sessions list
        if (key.ctrl && inputCh === 'l') {
          if (modal !== 'sessions') {
            setSessions(listSessions());
          }
          setModal((m) => (m === 'sessions' ? 'none' : 'sessions'));
          return;
        }
        // Ctrl+N — new session
        if (key.ctrl && inputCh === 'n') {
          handleNewSession();
          return;
        }
        // Ctrl+T — tools
        if (key.ctrl && inputCh === 't') {
          setModal((m) => (m === 'tools' ? 'none' : 'tools'));
          return;
        }
        // Ctrl+P — profiles
        if (key.ctrl && inputCh === 'p') {
          setModal((m) => (m === 'profiles' ? 'none' : 'profiles'));
          return;
        }
        // Ctrl+M — memory
        if (key.ctrl && inputCh === 'm') {
          setModal((m) => (m === 'memory' ? 'none' : 'memory'));
          return;
        }
        // Ctrl+B — budget
        if (key.ctrl && inputCh === 'b') {
          setModal((m) => (m === 'budget' ? 'none' : 'budget'));
          return;
        }
        // Ctrl+E — export
        if (key.ctrl && inputCh === 'e') {
          setModal((m) => (m === 'export' ? 'none' : 'export'));
          return;
        }
        // Ctrl+K — command palette
        if (key.ctrl && inputCh === 'k') {
          setModal((m) => (m === 'palette' ? 'none' : 'palette'));
          return;
        }
        // Ctrl+H — help modal
        if (key.ctrl && (inputCh === 'h' || inputCh === '\u0008')) {
          setModal((m) => (m === 'help' ? 'none' : 'help'));
          return;
        }
        // 'e' (lowercase, no ctrl) — toggle error expand when an error is
        // shown. Important: only fire this when the input is empty, otherwise
        // typing the letter 'e' while writing a message would also expand
        // the error. (Ink's useInput handlers all fire per keystroke, so
        // TextInput and the global handler would both see the same 'e'.)
        if (
          !key.ctrl &&
          !key.meta &&
          !key.shift &&
          inputCh === 'e' &&
          error &&
          input === ''
        ) {
          setErrorExpanded((v) => !v);
          return;
        }
        // PgUp — scroll message area up (older messages)
        if (key.pageUp) {
          setScrollOffset((n) => Math.min(n + 5, Math.max(0, messages.length - 1)));
          return;
        }
        // PgDn — scroll message area down (newer messages)
        if (key.pageDown) {
          setScrollOffset((n) => Math.max(0, n - 5));
          return;
        }
        // End — return to the live (latest) messages
        if (key.end && !key.ctrl) {
          setScrollOffset(0);
          return;
        }
        // Home — jump to the very top of the message history
        if (key.home && !key.ctrl) {
          setScrollOffset(Math.max(0, messages.length - 1));
          return;
        }
        // Ctrl+R — retry last user message after an error
        if (key.ctrl && (inputCh === 'r' || inputCh === '\u0012') && error && lastUserMessage) {
          // Clear the error and resend.
          setError(null);
          setErrorExpanded(false);
          handleSubmit(lastUserMessage);
          return;
        }
        // Esc when busy → cancel
        if (key.escape && (thinking || pendingTools > 0)) {
          agent?.cancel();
          return;
        }
      },
      [
        agent,
        modal,
        thinking,
        pendingTools,
        exit,
        error,
        messages.length,
        lastUserMessage,
      ]
    )
  );

  const handleSubmit = (value: string) => {
    const v = value.trim();
    if (!v || !agent) return;
    setInput('');
    setError(null);
    // Reset history navigation and multi-line state.
    setHistoryCursor(-1);
    setDraftBuffer('');
    setCommittedLines([]);
    setMultiline(false);
    // Jump to the bottom of the message area on submit so the new turn is
    // visible even if the user had been scrolled up reading history.
    setScrollOffset(0);
    // Remember the last user message so the user can retry with Ctrl+R if
    // the assistant errors out.
    if (!v.startsWith('/')) {
      setLastUserMessage(v);
    }
    // Persist to history (trims, dedupes, persists).
    try {
      inputHistory.push(agent.getSessionId(), v);
    } catch {
      /* non-critical */
    }

    // Slash commands
    if (v === '/quit' || v === '/exit') {
      exit();
      return;
    }
    if (v === '/help') {
      // Open the help modal instead of dumping the markdown into the
      // message stream — easier to browse and doesn't pollute history.
      setModal('help');
      return;
    }
    if (v === '/clear') {
      setMessages([]);
      return;
    }
    if (v === '/new') {
      handleNewSession();
      return;
    }
    if (v === '/banner') {
      // Toggle the welcome banner (only the user can ask to see it again).
      setShowBanner((b) => !b);
      return;
    }
    if (v === '/sessions') {
      setSessions(listSessions());
      setModal('sessions');
      return;
    }
    if (v === '/settings') {
      setModal('settings');
      return;
    }
    if (v === '/tools') {
      setModal('tools');
      return;
    }
    if (v === '/profiles') {
      setModal('profiles');
      return;
    }
    if (v === '/templates') {
      setModal('templates');
      return;
    }
    if (v === '/memory') {
      setModal('memory');
      return;
    }
    if (v === '/budget') {
      setModal('budget');
      return;
    }
    if (v === '/budget reset' || v.startsWith('/budget reset')) {
      budgetGuard.reset();
      setBudgetSnapshot(budgetGuard.snapshot());
      const msg: ChatMessage = {
        id: `budget_${Date.now()}`,
        role: 'assistant',
        content: '✓ Budget counters reset.',
        createdAt: Date.now(),
      };
      setMessages((p) => [...p, msg]);
      return;
    }
    if (v === '/mcp') {
      setModal('mcp');
      return;
    }
    if (v === '/export') {
      setModal('export');
      return;
    }
    if (v === '/model' || v.startsWith('/model ')) {
      // /model           → show the current model + a hint to run /model <name>
      // /model <name>    → switch the active provider's model
      const rest = v.slice('/model'.length).trim();
      const active = getActiveProvider();
      if (!active) {
        const msg: ChatMessage = {
          id: `model_${Date.now()}`,
          role: 'assistant',
          content:
            'No active provider configured. Run /settings to add one first.',
          createdAt: Date.now(),
        };
        setMessages((p) => [...p, msg]);
        return;
      }
      if (!rest) {
        const msg: ChatMessage = {
          id: `model_${Date.now()}`,
          role: 'assistant',
          content: `Current model: **${active.model}** (provider: ${active.name}).\n\nTo switch, run \`/model <name>\` — e.g. \`/model gpt-4-turbo\`.`,
          createdAt: Date.now(),
        };
        setMessages((p) => [...p, msg]);
        return;
      }
      updateProviderModel(active.id, rest);
      // Update the in-memory config so Header re-renders the new model.
      setConfig((c) => ({ ...c, model: rest }));
      const msg: ChatMessage = {
        id: `model_${Date.now()}`,
        role: 'assistant',
        content: `✓ Model switched to **${rest}** (applies to the next message).`,
        createdAt: Date.now(),
      };
      setMessages((p) => [...p, msg]);
      return;
    }
    // /template <name> [vars JSON]
    if (v.startsWith('/template ')) {
      const rest = v.slice('/template '.length).trim();
      const spaceIdx = rest.indexOf(' ');
      const name = spaceIdx > 0 ? rest.slice(0, spaceIdx) : rest;
      const varsStr = spaceIdx > 0 ? rest.slice(spaceIdx + 1) : '';
      let vars: Record<string, string> = {};
      if (varsStr) {
        try {
          vars = JSON.parse(varsStr);
        } catch {
          // ignore
        }
      }
      promptTemplates
        .render(name, vars)
        .then((rendered) => {
          void agent.send(rendered);
        })
        .catch((e) => {
          const msg: ChatMessage = {
            id: `tmpl_${Date.now()}`,
            role: 'assistant',
            content: `❌ Template error: ${e?.message || e}`,
            createdAt: Date.now(),
          };
          setMessages((p) => [...p, msg]);
        });
      return;
    }

    void agent.send(v);
  };

  function handleNewSession() {
    if (!agent) return;
    void agent.newSession().then(() => {
      setMessages([]);
      setSessionTitle('New session');
      // Don't re-show the banner on every new session — the banner is a
      // first-paint affordance, not a per-session one. Users who want to
      // see it again can run /banner.
      setScrollOffset(0);
      setLastUserMessage(null);
      // Refresh history for the new session id.
      try {
        inputHistory.reload(agent.getSessionId());
        setHistoryCursor(-1);
        setDraftBuffer('');
      } catch {
        /* non-critical */
      }
    });
  }

  function handleSelectSession(id: string) {
    if (!agent) return;
    void agent.switchSession(id).then(() => {
      const s = listSessions().find((x) => x.id === id);
      if (s) setSessionTitle(s.title);
      setShowBanner(false);
      setModal('none');
      setScrollOffset(0);
      setLastUserMessage(null);
      // Reload input history for the newly-active session so ↑ shows
      // entries from this session, not the previous one.
      try {
        inputHistory.reload(id);
        setHistoryCursor(-1);
        setDraftBuffer('');
      } catch {
        /* non-critical */
      }
    });
  }

  async function handleSavedConfig(next: AppConfig) {
    setConfig(next);
    if (agent) {
      await agent.reinitialize(next);
    }
  }

  // Rename a session in-place and update local state so the picker reflects
  // the new title immediately.
  function handleRenameSession(id: string, newTitle: string) {
    renameSession(id, newTitle);
    setSessions((prev) => prev.map((s) => (s.id === id ? { ...s, title: newTitle } : s)));
    if (agent && id === agent.getSessionId()) {
      setSessionTitle(newTitle);
    }
  }

  // Delete a session. If it's the active one, fall back to another session
  // or create a new one so the user is never left without a working session.
  function handleDeleteSession(id: string) {
    deleteSession(id);
    const remaining = sessions.filter((s) => s.id !== id);
    setSessions(remaining);
    if (agent && id === agent.getSessionId()) {
      if (remaining.length > 0) {
        handleSelectSession(remaining[0].id);
      } else {
        handleNewSession();
      }
    }
  }

  const cwd = process.cwd();

  // Compute header badges
  const totalToolCount = TOOLS.length + mcpManager.getToolDefinitions().length;
  const budgetActive = budgetGuard.isActive();
  const budgetPercent = budgetActive
    ? Math.max(
        budgetSnapshot.percentages.usd || 0,
        budgetSnapshot.percentages.tokens || 0,
        budgetSnapshot.percentages.toolCalls || 0
      )
    : undefined;

  return (
    <Box flexDirection="column">
      {showBanner ? (
        <Banner subtitle="AI coding agent · Ctrl+H help · /help commands · Ctrl+T tools · Ctrl+P profiles · Ctrl+K palette" />
      ) : null}

      <Header
        providerName={config.provider.name}
        model={config.provider.model || '(no model)'}
        cwd={cwd}
        sessionTitle={sessionTitle}
        toolCount={totalToolCount}
        mcpServers={mcpServerCount}
        budgetActive={budgetActive}
        budgetPercent={budgetPercent}
        messageCount={messages.length}
      />

      {!config.apiKey && !showOnboarding ? (
        <Box paddingX={1}>
          <Text color="yellow">⚠ {getProviderInfo(config)}</Text>
        </Box>
      ) : null}

      {showOnboarding ? (
        <Box paddingX={1} marginTop={1}>
          <Onboarding
            hasProvider={listProviders().length > 0}
            onOpenSettings={() => {
              setShowOnboarding(false);
              setModal('settings');
            }}
            onSkip={() => setShowOnboarding(false)}
          />
        </Box>
      ) : null}

      <MessageView messages={messages} scrollOffset={scrollOffset} />

      <InputBar
        value={input}
        onChange={(v) => {
          setInput(v);
          // If the user pasted/typed a newline or opened a code fence,
          // switch to multi-line mode.
          if (!multiline && (v.includes('\n') || v.includes('```'))) {
            setMultiline(true);
            const lines = v.split('\n');
            setCommittedLines(lines.slice(0, -1));
          }
          // Detect fence closure → end multi-line automatically? No: keep
          // multi-line mode until the user sends.
          setSuggestionIndex(0);
        }}
        onSubmit={handleSubmit}
        disabled={modal !== 'none' || thinking}
        placeholder={
          thinking
            ? 'Working… press Esc to cancel'
            : 'Type a message or /help for commands…'
        }
        suggestions={modal === 'none' ? suggestions : []}
        suggestionIndex={Math.min(suggestionIndex, Math.max(suggestions.length - 1, 0))}
        onAcceptSuggestion={(cmd) => {
          // Accept slash command → fill the input with the command name and
          // a trailing space so the user can type args.
          setInput('/' + cmd.name + ' ');
          setSuggestionIndex(0);
        }}
        onSuggestionHighlight={setSuggestionIndex}
        onHistoryPrev={() => {
          if (!agent) return;
          const sessionId = agent.getSessionId();
          if (historyCursor === -1) {
            setDraftBuffer(input);
          }
          const n = historyCursor + 1;
          const entry = inputHistory.get(sessionId, n);
          if (entry !== undefined) {
            setHistoryCursor(n);
            setInput(entry);
          }
        }}
        onHistoryNext={() => {
          if (!agent) return;
          const sessionId = agent.getSessionId();
          if (historyCursor <= 0) {
            setHistoryCursor(-1);
            setInput(draftBuffer);
          } else {
            const n = historyCursor - 1;
            const entry = inputHistory.get(sessionId, n);
            if (entry !== undefined) {
              setHistoryCursor(n);
              setInput(entry);
            }
          }
        }}
        lineCount={lineCount}
        inFence={inFence}
        multiline={multiline}
        committedLines={committedLines}
        onSendMulti={() => {
          const fullText = committedLines.concat([input]).join('\n');
          setInput('');
          setCommittedLines([]);
          setMultiline(false);
          handleSubmit(fullText);
        }}
        onExitMulti={() => {
          // Exit multi-line; commit the buffer back to the input.
          setInput(committedLines.concat([input]).join('\n'));
          setCommittedLines([]);
          setMultiline(false);
        }}
        onAddNewline={() => {
          if (!multiline) {
            // First newline: promote to multi-line so the user can keep typing.
            setMultiline(true);
          }
          // Commit the current line to the buffer and start a fresh line.
          setCommittedLines([...committedLines, input]);
          setInput('');
        }}
        onClearInput={() => {
          setInput('');
          setDraftBuffer('');
          setHistoryCursor(-1);
          setCommittedLines([]);
          setMultiline(false);
        }}
      />

      <StatusBar
        thinking={thinking}
        pendingTools={pendingTools}
        error={error || undefined}
        streaming={streamingId !== null}
        streamCharCount={streamCharCount}
        streamStartedAt={streamStartedAt}
        streamLastDeltaAt={streamLastDeltaAt}
        errorExpanded={errorExpanded}
        onToggleErrorExpand={() => setErrorExpanded((v) => !v)}
        errorAction={
          error
            ? lastUserMessage
              ? 'Ctrl+R retry · Ctrl+S settings · E expand/collapse · Esc dismiss'
              : 'Ctrl+S settings · E expand/collapse · Esc dismiss'
            : undefined
        }
      />

      {/* Modal panels */}
      {modal === 'settings' ? (
        <Box flexDirection="column" marginTop={1}>
          <SettingsPanel
            initial={config}
            onSaved={handleSavedConfig}
            onClose={() => setModal('none')}
          />
        </Box>
      ) : null}

      {modal === 'sessions' ? (
        <Box flexDirection="column" marginTop={1}>
          <SessionList
            sessions={sessions}
            currentSessionId={agent?.getSessionId() || ''}
            onSelect={handleSelectSession}
            onNew={() => {
              handleNewSession();
              setModal('none');
            }}
            onRename={handleRenameSession}
            onDelete={handleDeleteSession}
            onCancel={() => setModal('none')}
          />
        </Box>
      ) : null}

      {modal === 'tools' ? (
        <Box flexDirection="column" marginTop={1}>
          <ToolsPanel onClose={() => setModal('none')} />
        </Box>
      ) : null}

      {modal === 'profiles' ? (
        <Box flexDirection="column" marginTop={1}>
          <ProfilesPanel onClose={() => setModal('none')} />
        </Box>
      ) : null}

      {modal === 'templates' ? (
        <Box flexDirection="column" marginTop={1}>
          <TemplatesPanel
            onClose={() => setModal('none')}
            onUse={(cmd) => setInput(cmd)}
          />
        </Box>
      ) : null}

      {modal === 'budget' ? (
        <Box flexDirection="column" marginTop={1}>
          <BudgetPanel onClose={() => setModal('none')} />
        </Box>
      ) : null}

      {modal === 'memory' ? (
        <Box flexDirection="column" marginTop={1}>
          <MemoryPanel onClose={() => setModal('none')} />
        </Box>
      ) : null}

      {modal === 'mcp' ? (
        <Box flexDirection="column" marginTop={1}>
          <MCPPanel onClose={() => setModal('none')} />
        </Box>
      ) : null}

      {modal === 'export' ? (
        <Box flexDirection="column" marginTop={1}>
          <ExportPanel
            messages={messages}
            sessionTitle={sessionTitle}
            onClose={() => setModal('none')}
          />
        </Box>
      ) : null}

      {modal === 'palette' ? (
        <CommandPalette
          commands={allCommands}
          onPick={(cmd) => {
            // Insert the command into the input (with trailing space) and
            // dismiss the palette. The user can then type args.
            setInput('/' + cmd.name + ' ');
            setSuggestionIndex(0);
            setHistoryCursor(-1);
            setDraftBuffer('');
            setModal('none');
          }}
          onClose={() => setModal('none')}
        />
      ) : null}

      {modal === 'help' ? (
        <HelpPanel
          customCommands={customCommands}
          onClose={() => setModal('none')}
        />
      ) : null}
    </Box>
  );
}

