import { escapeHtml } from '../../lib/escape.js';

// User text is escaped before it is rendered as HTML, so it cannot inject markup.
export function Bio({ text }) {
  return <p className="bio" dangerouslySetInnerHTML={{ __html: escapeHtml(text) }} />;
}
