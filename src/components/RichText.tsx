export function RichText({ text }: { text: string }) {
  const blocks = text.split(/\n{2,}/);
  return (
    <div className="rich">
      {blocks.map((block, index) => {
        const lines = block.split("\n").filter((line, lineIndex, all) => line.trim() || all.length === 1);
        const items = lines.map((line) => line.trim()).filter((line) => /^[-•]\s+/.test(line));
        if (items.length > 0 && items.length === lines.filter((line) => line.trim()).length) {
          return (
            <ul key={index}>
              {items.map((line, itemIndex) => (
                <li key={itemIndex}>{inline(line.replace(/^[-•]\s+/, ""))}</li>
              ))}
            </ul>
          );
        }
        return (
          <p key={index}>
            {lines.map((line, lineIndex) => (
              <span key={lineIndex}>
                {inline(line)}
                {lineIndex < lines.length - 1 ? <br /> : null}
              </span>
            ))}
          </p>
        );
      })}
    </div>
  );
}

function inline(text: string) {
  const parts = text.split(/(\*\*[^*]+\*\*|`[^`]+`)/g);
  return parts.map((part, index) => {
    if (part.startsWith("**") && part.endsWith("**") && part.length > 4) {
      return <strong key={index}>{part.slice(2, -2)}</strong>;
    }
    if (part.startsWith("`") && part.endsWith("`") && part.length > 2) {
      return <code key={index}>{part.slice(1, -1)}</code>;
    }
    return <span key={index}>{part}</span>;
  });
}
