/** A small color chip identifying a Combatant's Color on the board. */
export function ColorSwatch({ color }: { color: string }) {
  return (
    <span
      aria-label={`color ${color}`}
      style={{
        display: "inline-block",
        width: "0.9em",
        height: "0.9em",
        backgroundColor: color,
        border: "1px solid #999",
        marginRight: "0.4em",
        verticalAlign: "middle",
      }}
    />
  );
}
