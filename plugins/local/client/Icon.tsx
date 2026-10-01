type Props = {
  /** The size of the icon, 24px is default to match standard icons. */
  size?: number;
  /** The color of the icon, defaults to the current text color. */
  color?: string;
};

/**
 * A simple "L" monogram used as the sign-in button icon for the local
 * (insecure, development-only) authentication provider.
 */
export default function LocalIcon({ size = 24, color = "currentColor" }: Props) {
  return (
    <svg
      fill={color}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      version="1.1"
    >
      <circle cx="12" cy="12" r="11" fill="none" stroke={color} strokeWidth="1.5" />
      <path d="M9 6.5h1.8v9.2h5.2v1.8H9z" />
    </svg>
  );
}
