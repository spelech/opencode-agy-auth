import { tool } from '@opencode-ai/plugin';

export const AGY_MODELS_TOOL_NAME = 'agy_models';

export interface ModelCatalogEntry {
  id: string;
  name: string;
  description: string;
  maxTokens: number;
  maxOutputTokens: number;
  reasoning: boolean;
  toolCall: boolean;
  attachment: boolean;
  tiers?: string[];
}

export function createAgyModelsTool(getModels: () => ModelCatalogEntry[]) {
  return tool({
    description: 'List supported Antigravity (Agy) models, tiers, token limits, and capabilities.',
    args: {},
    async execute() {
      const models = getModels();
      if (!models || models.length === 0) {
        return 'No Antigravity models found in catalog.';
      }

      const lines = [
        '### Antigravity (Agy) Available Models',
        '',
        '| Model ID | Display Name | Tiers | Context Window | Max Output | Features |',
        '| :--- | :--- | :--- | :--- | :--- | :--- |'
      ];

      for (const m of models) {
        const tiersStr = m.tiers && m.tiers.length > 0 ? m.tiers.join(', ') : 'standard';
        const contextStr = `${Math.round(m.maxTokens / 1024)}k`;
        const outputStr = `${Math.round(m.maxOutputTokens / 1024)}k`;
        const features = [
          m.reasoning ? 'Thinking/Reasoning' : null,
          m.toolCall ? 'Tools' : null,
          m.attachment ? 'Vision/PDF' : null
        ]
          .filter(Boolean)
          .join(', ');

        lines.push(`| \`${m.id}\` | ${m.name} | \`${tiersStr}\` | ${contextStr} | ${outputStr} | ${features || 'Text'} |`);
      }

      lines.push('');
      lines.push('*Tip: You can select a runtime tier (e.g., `minimal`, `low`, `medium`, `high`) in your model configuration or via headers.*');

      return lines.join('\n');
    }
  });
}
