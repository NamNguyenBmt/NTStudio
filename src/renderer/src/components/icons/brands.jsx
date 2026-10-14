import { useId } from "react";

export function Facebook({ size = 16, className, colored = true }) {
  const f =
    "M16.67 15.47 17.2 12h-3.33V9.75c0-.95.47-1.88 1.95-1.88h1.51V4.92s-1.37-.23-2.68-.23c-2.74 0-4.53 1.66-4.53 4.66V12H7.08v3.47h3.04V24h3.75v-8.53z";
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} className={className} aria-hidden={true}>
      {colored ? (
        <>
          <circle cx="12" cy="12" r="12" fill="#1877F2" />
          <path d={f} fill="#fff" />
        </>
      ) : (
        <path
          d="M13.5 22v-8.2h2.8l.4-3.2h-3.2V8.5c0-.9.3-1.6 1.6-1.6h1.7V4.1a22 22 0 0 0-2.5-.1c-2.5 0-4.2 1.5-4.2 4.3v2.3H7.3v3.2h2.8V22z"
          fill="currentColor"
        />
      )}
    </svg>
  );
}

export function TikTok({ size = 16, className, colored = true }) {
  const d =
    "M16.6 5.82A4.28 4.28 0 0 1 15.54 3h-3.09v12.4a2.59 2.59 0 0 1-2.59 2.5 2.6 2.6 0 0 1-2.6-2.6 2.6 2.6 0 0 1 3.37-2.48V9.66a5.73 5.73 0 0 0-.77-.05 5.68 5.68 0 0 0-5.68 5.69 5.68 5.68 0 0 0 5.68 5.68 5.68 5.68 0 0 0 5.68-5.68V9.01a7.35 7.35 0 0 0 4.3 1.38V7.3a4.3 4.3 0 0 1-4.24-1.48z";
  if (!colored)
    return (
      <svg viewBox="0 0 24 24" width={size} height={size} className={className} aria-hidden={true}>
        <path d={d} fill="currentColor" />
      </svg>
    );
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} className={className} aria-hidden={true}>
      <path d={d} fill="#25F4EE" transform="translate(-0.9 -0.7)" />
      <path d={d} fill="#FE2C55" transform="translate(0.9 0.7)" />
      <path d={d} className="fill-on-surface" />
    </svg>
  );
}

export function Instagram({ size = 16, className, colored = true }) {
  const id = useId().replace(/:/g, "");
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} className={className} aria-hidden={true}>
      {colored && (
        <defs>
          <radialGradient id={`ig${id}`} cx="30%" cy="107%" r="150%">
            <stop offset="0%" stopColor="#FDF497" />
            <stop offset="5%" stopColor="#FDF497" />
            <stop offset="45%" stopColor="#FD5949" />
            <stop offset="60%" stopColor="#D6249F" />
            <stop offset="90%" stopColor="#285AEB" />
          </radialGradient>
        </defs>
      )}
      {colored && <rect x="0" y="0" width="24" height="24" rx="6.5" fill={`url(#ig${id})`} />}
      <rect
        x="4.5"
        y="4.5"
        width="15"
        height="15"
        rx="4.5"
        fill="none"
        stroke={colored ? "#fff" : "currentColor"}
        strokeWidth="1.9"
      />
      <circle cx="12" cy="12" r="3.6" fill="none" stroke={colored ? "#fff" : "currentColor"} strokeWidth="1.9" />
      <circle cx="16.4" cy="7.6" r="1.1" fill={colored ? "#fff" : "currentColor"} />
    </svg>
  );
}

export function YouTube({ size = 16, className, colored = true }) {
  const body =
    "M23.5 6.2a3 3 0 0 0-2.1-2.1C19.5 3.6 12 3.6 12 3.6s-7.5 0-9.4.5A3 3 0 0 0 .5 6.2 31.3 31.3 0 0 0 0 12a31.3 31.3 0 0 0 .5 5.8 3 3 0 0 0 2.1 2.1c1.9.5 9.4.5 9.4.5s7.5 0 9.4-.5a3 3 0 0 0 2.1-2.1A31.3 31.3 0 0 0 24 12a31.3 31.3 0 0 0-.5-5.8z";
  const play = "M9.6 15.6 15.8 12 9.6 8.4z";
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} className={className} aria-hidden={true}>
      {colored ? (
        <>
          <path d={body} fill="#FF0000" />
          <path d={play} fill="#fff" />
        </>
      ) : (
        <path d={`${body} ${play}`} fill="currentColor" fillRule="evenodd" />
      )}
    </svg>
  );
}
