// Agent core - ReAct loop, tool calling, and event-driven streaming

import { EventEmitter } from 'events';
import type { ChatMessage, ToolCall } from './types.js';
import { TOOLS, executeTool } from './tools.js';
import { SYSTEM_PROMPT, loadConfigSync, type AppConfig } from './config.js';
import {
  appendMessage,
  createSession,
  loadMessages,
  newId,
  toApiMessages,
  renameSession,
  getSession,
} from './store.js';

export type AgentEvent =
  | { type: 'session'; sessionId: string }
  | { type: 'session_title'; sessionId: string; title: string }
  | { type: 'message'; message: ChatMessage }
  | { type: 'message_delta'; id: string; delta: string }
  | { type: 'message_done'; id: string }
  | { type: 'tool_start'; message: ChatMessage }
  | { type: 'tool_end'; message: ChatMessage }
  | { type: 'thinking'; on: boolean }
  | { type: 'error'; message: string }
  | { type: 'done' };

export class Agent extends EventEmitter {
  private openai: any = null;
  private config: AppConfig;
  private messages: ChatMessage[] = [];
  private sessionId: string;
  private aborter: AbortController | null = null;

  private constructor(config: AppConfig, sessionId: string) {
    super();
    this.config = config;
    this.sessionId = sessionId;
  }

  static async create(opts?: { sessionId?: string }): Promise<Agent> {
    const config = loadConfigSync();
    let sessionId = opts?.sessionId || '';

    if (!sessionId) {
      const sess = createSession({
        title: 'New session',
        model: config.model,
        provider: config.provider.name,
      });
      sessionId = sess.id;
    }

    const agent = new Agent(config, sessionId);
    await agent.initOpenAI();

    // Hydrate messages from store
    const stored = loadMessages(sessionId);
    if (stored.length === 0) {
      // Seed with system prompt (not stored — it's part of config)
    }
    agent.messages = stored;
    return agent;
  }

  private async initOpenAI(): Promise<void> {
    if (!this.config.apiKey) {
      this.openai = null;
      return;
    }
    const { default: OpenAILib } = await import('openai');
    const clientConfig: any = { apiKey: this.config.apiKey };
    if (
      this.config.provider.type === 'custom' &&
      this.config.provider.baseURL
    ) {
      clientConfig.baseURL = this.config.provider.baseURL;
    }
    this.openai = new OpenAILib(clientConfig);
  }

  async reinitialize(newConfig: AppConfig): Promise<void> {
    this.config = newConfig;
    await this.initOpenAI();
  }

  getConfig(): AppConfig {
    return this.config;
  }

  getSessionId(): string {
    return this.sessionId;
  }

  getMessages(): ChatMessage[] {
    return this.messages;
  }

  async switchSession(sessionId: string): Promise<void> {
    const s = getSession(sessionId);
    if (!s) throw new Error(`Session not found: ${sessionId}`);
    this.sessionId = sessionId;
    this.messages = loadMessages(sessionId);
    this.emit('event', { type: 'session', sessionId } as AgentEvent);
  }

  async newSession(title?: string): Promise<string> {
    const sess = createSession({
      title: title || 'New session',
      model: this.config.model,
      provider: this.config.provider.name,
    });
    this.sessionId = sess.id;
    this.messages = [];
    this.emit('event', {
      type: 'session',
      sessionId: sess.id,
    } as AgentEvent);
    return sess.id;
  }

  cancel(): void {
    if (this.aborter) {
      this.aborter.abort();
      this.aborter = null;
    }
  }

  private push(msg: ChatMessage): void {
    this.messages.push(msg);
    appendMessage(this.sessionId, msg);
    this.emit('event', { type: 'message', message: msg } as AgentEvent);
  }

  private update(msg: ChatMessage): void {
    appendMessage(this.sessionId, msg);
    this.emit('event', { type: 'message', message: msg } as AgentEvent);
  }

  // Send a user message and run the ReAct loop with streaming
  async send(userInput: string): Promise<void> {
    const userMsg: ChatMessage = {
      id: newId('msg'),
      role: 'user',
      content: userInput,
      createdAt: Date.now(),
    };
    this.push(userMsg);

    // Auto-title from first user message
    if (this.messages.filter((m) => m.role === 'user').length === 1) {
      const title = userInput.slice(0, 60).replace(/\s+/g, ' ').trim();
      if (title) {
        renameSession(this.sessionId, title);
        this.emit('event', {
          type: 'session_title',
          sessionId: this.sessionId,
          title,
        } as AgentEvent);
      }
    }

    if (!this.openai) {
      const errMsg: ChatMessage = {
        id: newId('msg'),
        role: 'assistant',
        content:
          'No API key configured. Press **Ctrl+S** to open settings and configure your provider.',
        createdAt: Date.now(),
      };
      this.push(errMsg);
      this.emit('event', { type: 'done' } as AgentEvent);
      return;
    }

    this.aborter = new AbortController();
    const maxIterations = 10;

    try {
      for (let i = 0; i < maxIterations; i++) {
        if (this.aborter.signal.aborted) break;

        this.emit('event', { type: 'thinking', on: true } as AgentEvent);

        const apiMsgs = [
          { role: 'system' as const, content: SYSTEM_PROMPT },
          ...toApiMessages(this.messages),
        ];

        const stream: any = await this.openai.chat.completions.create(
          {
            model: this.config.model,
            messages: apiMsgs,
            tools: TOOLS,
            tool_choice: 'auto',
            temperature: this.config.temperature,
            max_tokens: this.config.maxTokens,
            stream: true,
          },
          { signal: this.aborter.signal }
        );

        const assistantMsg: ChatMessage = {
          id: newId('msg'),
          role: 'assistant',
          content: '',
          createdAt: Date.now(),
          streaming: true,
        };
        // Don't persist yet — emit "message" placeholder and stream deltas
        this.messages.push(assistantMsg);
        this.emit('event', {
          type: 'message',
          message: assistantMsg,
        } as AgentEvent);

        const toolCalls: ToolCall[] = [];
        let firstChunk = true;

        for await (const chunk of stream as AsyncIterable<any>) {
          if (this.aborter.signal.aborted) break;
          if (firstChunk) {
            this.emit('event', { type: 'thinking', on: false } as AgentEvent);
            firstChunk = false;
          }
          const delta: any = chunk.choices?.[0]?.delta;
          if (!delta) continue;

          if (delta.content) {
            assistantMsg.content += delta.content;
            this.emit('event', {
              type: 'message_delta',
              id: assistantMsg.id,
              delta: delta.content,
            } as AgentEvent);
          }

          if (delta.tool_calls) {
            for (const tc of delta.tool_calls as any[]) {
              const idx = tc.index ?? 0;
              if (!toolCalls[idx]) {
                toolCalls[idx] = {
                  id: tc.id || `tc_${idx}`,
                  type: 'function',
                  function: { name: '', arguments: '' },
                };
              }
              if (tc.id) toolCalls[idx].id = tc.id;
              if (tc.function?.name)
                toolCalls[idx].function.name += tc.function.name;
              if (tc.function?.arguments)
                toolCalls[idx].function.arguments += tc.function.arguments;
            }
          }
        }

        assistantMsg.streaming = false;
        if (toolCalls.length > 0) {
          assistantMsg.toolCalls = toolCalls;
        }
        // Persist + emit final
        this.update(assistantMsg);
        this.emit('event', {
          type: 'message_done',
          id: assistantMsg.id,
        } as AgentEvent);

        if (toolCalls.length === 0) {
          break;
        }

        // Execute tool calls in parallel — emit start/end for each
        const toolMsgs: ChatMessage[] = [];
        await Promise.all(
          toolCalls.map(async (tc) => {
            if (!tc.function?.name) return;
            let args: any = {};
            try {
              args = tc.function.arguments
                ? JSON.parse(tc.function.arguments)
                : {};
            } catch {
              args = { _raw: tc.function.arguments };
            }
            const toolMsg: ChatMessage = {
              id: newId('tool'),
              role: 'tool',
              content: '',
              createdAt: Date.now(),
              toolCallId: tc.id,
              toolName: tc.function.name,
              toolArgs: args,
              toolStatus: 'pending',
            };
            this.messages.push(toolMsg);
            this.emit('event', {
              type: 'tool_start',
              message: toolMsg,
            } as AgentEvent);

            const result = await executeTool(tc.function.name, args);
            toolMsg.content = result.success
              ? result.output
              : `Error: ${result.error || 'Tool failed'}`;
            toolMsg.toolStatus = result.success ? 'success' : 'error';
            this.update(toolMsg);
            this.emit('event', {
              type: 'tool_end',
              message: toolMsg,
            } as AgentEvent);
            toolMsgs.push(toolMsg);
          })
        );

        // Continue the loop so the LLM can react to tool results
      }
    } catch (error: any) {
      const isAbort =
        error?.name === 'AbortError' ||
        error?.message?.includes('aborted') ||
        this.aborter?.signal.aborted;
      if (!isAbort) {
        this.emit('event', {
          type: 'error',
          message: error?.message || 'Unknown error',
        } as AgentEvent);
      }
    } finally {
      this.aborter = null;
      this.emit('event', { type: 'thinking', on: false } as AgentEvent);
      this.emit('event', { type: 'done' } as AgentEvent);
    }
  }
}
