import { describe, expect, it } from 'vitest';
import { readable } from '../../src/content/measure.ts';

describe('class names and ids Jev reads', () => {
  it('lose the hash a build tool appended', () => {
    expect(readable('prc-PageLayout-Content-xWL-A')).toBe('prc-PageLayout-Content');
    expect(readable('prc-PageLayout-ContentWrapper-gR9eG')).toBe('prc-PageLayout-ContentWrapper');
    expect(readable('Box__PalQtd')).toBe('Box');
    expect(readable('listItem__X41oTe')).toBe('listItem');
  });

  it('keep words that only look like a hash', () => {
    for (const name of ['crayons-story__body', 'page-layout__header', 'Button--primary', 'nav-items', 's-avatar__24', 'ot-sdk-twelve']) expect(readable(name)).toBe(name);
  });

  it('drop generated names entirely', () => {
    expect(readable('gNO89b')).toBeUndefined();
    expect(readable('_R_qfaj85_-list-view-container')).toBeUndefined();
    expect(readable('_r_2l_-list-view-metadata')).toBeUndefined();
  });
});
