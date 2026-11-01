const HUES = [12, 38, 150, 175, 200, 230, 265, 320];

function hueFor(name: string) {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0;
  return HUES[h % HUES.length];
}

export const initials = (name: string) =>
  name
    .split(' ')
    .filter(Boolean)
    .map((part) => part[0])
    .join('')
    .slice(0, 2)
    .toUpperCase();

export interface AvatarProps {
  name: string;
  /** the signed-in user: drawn in the accent colour */
  highlight?: boolean;
}

/** Coloured initials. The same name always gets the same colour. Decorative: the name is shown next to it. */
export function Avatar({ name, highlight = false }: AvatarProps) {
  const hue = hueFor(name);
  return (
    <span
      className={highlight ? 'avatar me' : 'avatar'}
      style={highlight ? undefined : { background: `hsl(${hue} 55% 92%)`, color: `hsl(${hue} 45% 32%)` }}
      aria-hidden
    >
      {initials(name)}
    </span>
  );
}
