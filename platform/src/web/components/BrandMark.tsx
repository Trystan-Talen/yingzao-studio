import { useId } from 'react';

/** The 映造 seal: an aurora stamp with a beam of light passing through an aperture. */
export function BrandMark({ size = 36 }: { size?: number }) {
  // Each mark needs its own gradient id: a hidden copy (e.g. the desktop rail on mobile)
  // must not be the one every other mark references.
  const gradientId = 'yz-mark-' + useId().replace(/[^a-zA-Z0-9_-]/g, '');
  return (
    <svg
      className="yz-mark"
      width={size}
      height={size}
      viewBox="0 0 40 40"
      fill="none"
      aria-hidden="true"
    >
      <defs>
        <linearGradient
          id={gradientId}
          x1="0"
          y1="0"
          x2="40"
          y2="40"
          gradientUnits="userSpaceOnUse"
        >
          <stop offset="0" stopColor="#ff6a3d" />
          <stop offset="0.55" stopColor="#ff3d6a" />
          <stop offset="1" stopColor="#8f7dff" />
        </linearGradient>
      </defs>
      <rect width="40" height="40" rx="11" fill={`url(#${gradientId})`} />
      <path
        d="M11 29V11h11"
        stroke="#160603"
        strokeWidth="3.4"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M29 11v18H18"
        stroke="#fff7f2"
        strokeWidth="3.4"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <circle cx="20" cy="20" r="3.2" fill="#fff7f2" />
    </svg>
  );
}
