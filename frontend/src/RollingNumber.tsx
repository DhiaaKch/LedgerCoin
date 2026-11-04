// Shows a number whose digits roll like a counter when the value changes.
const DIGITS = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9];

export function RollingNumber({ value }: { value: string }) {
  const chars = value.split("");
  return (
    <span className="roll" role="text" aria-label={value}>
      {chars.map((ch, i) => {
        const fromRight = chars.length - i; // same key for the same position, so digits animate
        if (!/\d/.test(ch)) {
          return (
            <span key={`sep-${fromRight}`} className="roll-sep" aria-hidden="true">
              {ch}
            </span>
          );
        }
        return (
          <span key={`digit-${fromRight}`} className="roll-digit" aria-hidden="true">
            <span className="roll-strip" style={{ transform: `translateY(-${Number(ch) * 10}%)` }}>
              {DIGITS.map((d) => (
                <span key={d}>{d}</span>
              ))}
            </span>
          </span>
        );
      })}
    </span>
  );
}
