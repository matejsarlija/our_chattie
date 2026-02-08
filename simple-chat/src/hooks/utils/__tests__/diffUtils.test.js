import { buildTrackedChangesHtml } from '../diffUtils';

describe('buildTrackedChangesHtml', () => {
  test('creates insertion and deletion markup', () => {
    const result = buildTrackedChangesHtml('Hello world', 'Hello brave world');
    expect(result.html).toContain('<ins data-change="insert">brave</ins>');
    expect(result.html).toContain('<ins data-change="insert"> </ins>');
    expect(result.html).toContain('Hello ');
    expect(result.html).toContain('world');
    expect(result.textLength).toBeGreaterThan(0);
  });

  test('creates deletion markup when text is removed', () => {
    const result = buildTrackedChangesHtml('Hello brave world', 'Hello world');
    expect(result.html).toContain('<del data-change="delete">brave</del>');
    expect(result.html).toContain('<del data-change="delete"> </del>');
    expect(result.textLength).toBeGreaterThan(0);
  });
});
