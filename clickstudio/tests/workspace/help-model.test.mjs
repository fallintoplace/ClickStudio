import assert from 'node:assert/strict';
import test from 'node:test';
import { english } from '../../.workspace-build/web/i18n-english.js';
import { helpSections } from '../../.workspace-build/web/components/workspace-help-model.js';

test('experimental help topics stay grouped after the standard help topics', () => {
    const sections = helpSections(english.common);
    const experimental = sections.filter(section => section.experimental).map(section => section.id);
    const firstExperimentalIndex = sections.findIndex(section => section.experimental);

    assert.deepEqual(experimental, ['monitoring', 'query', 'geo', 'explain', 'storage', 'dependencies', 'compare']);
    assert.ok(firstExperimentalIndex > 0);
    assert.ok(sections.slice(0, firstExperimentalIndex).every(section => !section.experimental));
    assert.ok(sections.slice(firstExperimentalIndex).every(section => section.experimental));
    assert.ok(sections.findIndex(section => section.id === 'reference') < firstExperimentalIndex);
});
