import { DEFAULT_SETTINGS } from './settings-schema';

describe('DEFAULT_SETTINGS', () => {
    it('does not preselect an unavailable default LLM model for empty installs', () => {
        expect(DEFAULT_SETTINGS.llm.defaultModel).toBe('');
        expect(DEFAULT_SETTINGS.llm.providers).toEqual([]);
    });

    it('uses the single supported light appearance theme', () => {
        expect(DEFAULT_SETTINGS.appearance.theme).toBe('light');
    });
});
