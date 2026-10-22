// User text is rendered as plain text, so React escapes it.
export function Bio({ text }) {
  return <p className="bio">{text}</p>;
}
