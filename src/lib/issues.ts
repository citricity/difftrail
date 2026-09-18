/**
 * Issue links from a changelog's tracker URL.
 *
 * The tracker comes out of a changelog file, which is ordinary repository
 * content: written by an agent, possibly fetched from a colleague or a CI
 * artifact, and never validated on the way in. Interpolating it straight into
 * an `href` would let `javascript:` - or anything else a browser will run -
 * ride in on a click, which neither `target` nor `rel` does anything about.
 */

/**
 * The URL for one issue, or null when the tracker cannot be trusted with a
 * link. The caller then shows the identifier as plain text, which is what it
 * already does for a changelog with no tracker at all.
 */
export function issueUrl(tracker: string | null, issue: string): string | null {
  if (tracker === null) return null;

  let url: URL;
  try {
    url = new URL(`${tracker.replace(/\/+$/, '')}/${encodeURIComponent(issue)}`);
  } catch {
    // Not absolute, or not a URL at all.
    return null;
  }

  // Only the two schemes a tracker could honestly be. Everything else -
  // javascript:, data:, file: - is refused rather than sanitised, because
  // there is no version of those that a reader asked for.
  return url.protocol === 'http:' || url.protocol === 'https:' ? url.href : null;
}
