type Props = {
  /** The size of the icon, 24px is default to match standard icons. */
  size?: number;
  /** The color of the icon, defaults to the current text color. */
  color?: string;
};

/**
 * A simple "K" monogram used as the sign-in button icon for the Kompassi
 * authentication provider.
 */
export default function KompassiIcon({ size = 24, color = "currentColor" }: Props) {
  return (
    <svg
      fill={color}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      version="1.1"
    >
      <circle cx="12" cy="12" r="11" fill="none" stroke={color} strokeWidth="1.5" />
      <path d="M7.5 6.5h1.8v5l4.6-5h2.3l-4.9 5.2 5.2 5.8h-2.4l-4.1-4.6-.7.7v3.9H7.5z" />
    </svg>
  );
}
