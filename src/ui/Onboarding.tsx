// First-run onboarding modal.
//
// Shown only when:
//   1. There are no providers in the SQLite `providers` table, AND
//   2. The user has not previously dismissed onboarding (flag stored in
//      `app_config.onboardingDone`).
//
// Skippable with Esc. If dismissed, the flag is set so it never reappears
// unless the user clears all providers AND the flag (e.g. via
// `--reset-onboarding`, a hidden escape hatch — not currently exposed).
//
// Renders inline (no separate file watcher, no async dependencies) so it can
// be shown synchronously on first paint.

import React, { useState } from 'react';
import { Box, Text, useInput } from 'ink';
import { getConfigValue, setConfigValue } from '../store.js';
import { gradient } from './theme.js';

export interface OnboardingProps {
  hasProvider: boolean;
  onOpenSettings: () => void;
  onSkip: () => void;
}

/** Returns true if onboarding should be shown now. */
export function shouldShowOnboarding(hasProvider: boolean): boolean {
  if (hasProvider) return false;
  return getConfigValue('onboardingDone') !== 'true';
}

export function markOnboardingDone(): void {
  setConfigValue('onboardingDone', 'true');
}

type Step = 'welcome' | 'choose';

export function Onboarding({
  hasProvider,
  onOpenSettings,
  onSkip,
}: OnboardingProps): JSX.Element {
  const [step, setStep] = useState<Step>('welcome');
  const colors = gradient(2);

  useInput((input, key) => {
    if (key.escape) {
      markOnboardingDone();
      onSkip();
      return;
    }
    if (step === 'welcome') {
      if (input === 's' || input === 'S' || key.return) {
        setStep('choose');
        return;
      }
      if (input === 'q' || input === 'Q') {
        markOnboardingDone();
        onSkip();
        return;
      }
      return;
    }
    // step === 'choose'
    if (key.return || input === '1' || input === 'o' || input === 'O') {
      // Default: open settings — the user can pick the provider type
      // inside the settings panel. The UI text advertises "press Enter".
      markOnboardingDone();
      onOpenSettings();
      return;
    }
    if (input === '2' || input === 'c' || input === 'C') {
      markOnboardingDone();
      onOpenSettings();
      return;
    }
    if (input === 'e' || input === 'E') {
      markOnboardingDone();
      onSkip();
      return;
    }
  });

  if (step === 'welcome') {
    return (
      <Box
        flexDirection="column"
        borderStyle="double"
        borderColor={colors[0]}
        paddingX={3}
        paddingY={1}
      >
        <Text color={colors[0]} bold>
          ✨ Welcome to ZIP CODE
        </Text>
        <Text color="gray">
          Your AI coding assistant — multi-agent, 33+ tools, MCP, and more.
        </Text>

        <Box marginTop={1} flexDirection="column">
          <Text>
            <Text color="gray">To start chatting you'll need an </Text>
            <Text color="white" bold>API key</Text>
            <Text color="gray">.</Text>
          </Text>
          <Text color="gray">ZIP CODE works with:</Text>
          <Box marginLeft={2} flexDirection="column">
            <Text>
              <Text color="cyan">▸ </Text>
              <Text color="white">OpenAI</Text>
              <Text color="gray"> — gpt-4, gpt-4-turbo, gpt-3.5-turbo</Text>
            </Text>
            <Text>
              <Text color="cyan">▸ </Text>
              <Text color="white">Any OpenAI-compatible endpoint</Text>
              <Text color="gray"> — Ollama, vLLM, LM Studio, …</Text>
            </Text>
          </Box>
        </Box>

        <Box marginTop={1} flexDirection="column">
          <Text>
            <Text color="green" bold>[S] </Text>
            <Text>Set up now</Text>
            <Text color="gray">  ·  </Text>
            <Text color="gray">[Q] </Text>
            <Text>Skip for now</Text>
            <Text color="gray">  ·  </Text>
            <Text color="gray">[Esc] </Text>
            <Text>dismiss</Text>
          </Text>
        </Box>

        <Box marginTop={1}>
          <Text color="gray" dimColor>
            Get an OpenAI key at platform.openai.com/api-keys
          </Text>
        </Box>
      </Box>
    );
  }

  // step === 'choose'
  return (
    <Box
      flexDirection="column"
      borderStyle="double"
      borderColor={colors[0]}
      paddingX={3}
      paddingY={1}
    >
      <Text color={colors[0]} bold>
        ⚙ Set up a provider
      </Text>
      <Text color="gray">Choose a starting point — you can change it later.</Text>

      <Box marginTop={1} flexDirection="column">
        <Text>
          <Text color="green" bold>[1] </Text>
          <Text color="white">OpenAI</Text>
          <Text color="gray"> — paste your OPENAI_API_KEY</Text>
        </Text>
        <Text>
          <Text color="green" bold>[2] </Text>
          <Text color="white">Custom (OpenAI-compatible)</Text>
          <Text color="gray"> — Ollama, vLLM, etc.</Text>
        </Text>
      </Box>

      <Box marginTop={1}>
        <Text color="gray">
          Or press <Text color="white" bold>Enter</Text> to open settings.
        </Text>
      </Box>
    </Box>
  );
}
