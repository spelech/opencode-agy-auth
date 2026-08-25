import { describe, it, expect } from 'vitest';
import { createAgyModelsTool, AGY_MODELS_TOOL_NAME, type ModelCatalogEntry } from '../../src/plugin/models-command';

describe('createAgyModelsTool', () => {
  it('has expected tool name', () => {
    expect(AGY_MODELS_TOOL_NAME).toBe('agy_models');
  });

  it('handles empty models list', async () => {
    const modelsTool = createAgyModelsTool(() => []);
    const result = await modelsTool.execute({});
    expect(result).toBe('No Antigravity models found in catalog.');
  });

  it('renders models catalog table correctly', async () => {
    const sampleModels: ModelCatalogEntry[] = [
      {
        id: 'gemini-3.7-flash',
        name: 'Gemini 3.7 Flash',
        description: 'Fast multimodal model',
        maxTokens: 1048576,
        maxOutputTokens: 65536,
        reasoning: true,
        toolCall: true,
        attachment: true,
        tiers: ['low', 'medium', 'high']
      },
      {
        id: 'gpt-oss-120b-medium',
        name: 'GPT-OSS 120B',
        description: 'Open weights model',
        maxTokens: 131072,
        maxOutputTokens: 32768,
        reasoning: false,
        toolCall: false,
        attachment: false
      }
    ];

    const modelsTool = createAgyModelsTool(() => sampleModels);
    const result = await modelsTool.execute({});

    expect(result).toContain('### Antigravity (Agy) Available Models');
    expect(result).toContain('`gemini-3.7-flash`');
    expect(result).toContain('Gemini 3.7 Flash');
    expect(result).toContain('`low, medium, high`');
    expect(result).toContain('Thinking/Reasoning, Tools, Vision/PDF');
    expect(result).toContain('`gpt-oss-120b-medium`');
    expect(result).toContain('`standard`');
  });
});
