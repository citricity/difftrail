import { describe, expect, it } from 'vitest';
import { issueUrl } from './issues.ts';

describe('issueUrl', () => {
  it('builds a link from an ordinary tracker', () => {
    expect(issueUrl('https://github.com/citricity/difftrek/issues', '9')).toBe(
      'https://github.com/citricity/difftrek/issues/9',
    );
  });

  it('does not mind a trailing slash', () => {
    expect(issueUrl('https://example.com/issues/', '9')).toBe(
      'https://example.com/issues/9',
    );
  });

  it('refuses a scheme a browser would execute', () => {
    expect(issueUrl('javascript:alert(1)', '9')).toBeNull();
    expect(issueUrl('data:text/html,<script>', '9')).toBeNull();
    expect(issueUrl('file:///etc', '9')).toBeNull();
  });

  it('refuses anything that is not an absolute URL', () => {
    expect(issueUrl('issues', '9')).toBeNull();
    expect(issueUrl('', '9')).toBeNull();
  });

  it('encodes the identifier rather than letting it shape the path', () => {
    expect(issueUrl('https://example.com/issues', '../../admin')).toBe(
      'https://example.com/issues/..%2F..%2Fadmin',
    );
  });

  it('has nothing to link to without a tracker', () => {
    expect(issueUrl(null, '9')).toBeNull();
  });
});
