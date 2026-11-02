import React from "react";
import type { NavigationDirection } from "@/lib/navigation-instructions";

const PATHS = {
  car: "M5 16.5h14M6.5 16.5v2M17.5 16.5v2M4.5 12l1.8-5A2 2 0 0 1 8.2 5.7h7.6a2 2 0 0 1 1.9 1.3l1.8 5M4.5 12h15a1 1 0 0 1 1 1v3.5h-17V13a1 1 0 0 1 1-1ZM7.5 14.2h.01M16.5 14.2h.01",
  motorcycle: "M5.5 18a3 3 0 1 0 0-6 3 3 0 0 0 0 6ZM18.5 18a3 3 0 1 0 0-6 3 3 0 0 0 0 6ZM8.5 15h4l3-5h-3.5M15.5 10l3 5M14 6h2.5l-1 4M9 10.5h3.5",
  bicycle: "M5.5 18a3 3 0 1 0 0-6 3 3 0 0 0 0 6ZM18.5 18a3 3 0 1 0 0-6 3 3 0 0 0 0 6ZM5.5 15l3.5-6h6l3.5 6M9 9l3 6h-6.5M15 9l-1.2-3H11.5",
  search: "M10.5 17a6.5 6.5 0 1 0 0-13 6.5 6.5 0 0 0 0 13ZM15.5 15.5 20 20",
  locate: "M12 19a7 7 0 1 0 0-14 7 7 0 0 0 0 14ZM12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6ZM12 2v3M12 19v3M2 12h3M19 12h3",
  swap: "M8 4v14M8 4 4.5 7.5M8 4l3.5 3.5M16 20V6M16 20l-3.5-3.5M16 20l3.5-3.5",
  pin: "M12 21s7-6.1 7-11.5a7 7 0 1 0-14 0C5 14.9 12 21 12 21ZM12 12a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5Z",
  chevronDown: "m6 9 6 6 6-6",
  chevronUp: "m6 15 6-6 6 6",
  chevronLeft: "m15 6-6 6 6 6",
  menu: "M4 7h16M4 12h16M4 17h16",
  close: "M6 6l12 12M18 6 6 18",
  refresh: "M20 11a8 8 0 0 0-14.3-4.3L4 8.5M4 4v4.5h4.5M4 13a8 8 0 0 0 14.3 4.3l1.7-1.8M20 20v-4.5h-4.5",
  volumeOn: "M4 9.5v5h3.5L12 18.5v-13L7.5 9.5H4ZM15.5 9a4 4 0 0 1 0 6M18 6.5a8 8 0 0 1 0 11",
  volumeOff: "M4 9.5v5h3.5L12 18.5v-13L7.5 9.5H4ZM16 9.5l5 5M21 9.5l-5 5",
  recenter: "M12 3 5 20l7-3.5L19 20 12 3Z",
  share: "M12 15V4M12 4 8 8M12 4l4 4M5 13v6a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-6",
  sun: "M12 17a5 5 0 1 0 0-10 5 5 0 0 0 0 10ZM12 2v2M12 20v2M2 12h2M20 12h2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4",
  moon: "M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5Z",
  auto: "M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18ZM12 3v18M12 8h6.5M12 12h9M12 16h6.5",
  warning: "M12 4 2.5 20h19L12 4ZM12 10v4.5M12 17.5h.01",
  info: "M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18ZM12 11v5M12 8h.01",
  community: "M9 11a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7ZM3 20a6 6 0 0 1 12 0M16 4.5a3.5 3.5 0 0 1 0 6.5M18 14.5a6 6 0 0 1 3 5.5",
  note: "M5 4h14v11l-5 5H5V4ZM14 20v-5h5M8.5 9h7M8.5 12.5h4",
  play: "M7 4.5v15L19.5 12 7 4.5Z",
  external: "M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5",
  turnLeft: "M18 20v-7a3 3 0 0 0-3-3H6M6 10l4.5-4.5M6 10l4.5 4.5",
  turnRight: "M6 20v-7a3 3 0 0 1 3-3h9M18 10l-4.5-4.5M18 10l-4.5 4.5",
  straight: "M12 20V5M12 5 6.5 10.5M12 5l5.5 5.5",
  uTurn: "M7 20V9.5a4.5 4.5 0 0 1 9 0V14M16 14l-3.5-3.5M16 14l3.5-3.5",
  roundabout: "M12 16a4 4 0 1 0 0-8 4 4 0 0 0 0 8ZM12 21v-5M12 8V3M12 3 9 6M12 3l3 3",
  flag: "M6 21V4M6 4c4-2 8 2 12 0v9c-4 2-8-2-12 0",
} as const;

export type IconName = keyof typeof PATHS;

const DIRECTION_ICONS: Record<NavigationDirection, IconName> = {
  left: "turnLeft",
  right: "turnRight",
  straight: "straight",
  uturn: "uTurn",
  roundabout: "roundabout",
  depart: "straight",
  arrive: "flag",
};

export function directionIcon(direction: NavigationDirection | undefined): IconName {
  return direction ? DIRECTION_ICONS[direction] : "straight";
}

/** Line icons drawn inline, so they follow the text colour and scale without another dependency. */
export function Icon({ name, size = 20, className = "" }: { name: IconName; size?: number; className?: string }) {
  return (
    <svg
      className={`icon ${className}`}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d={PATHS[name]} />
    </svg>
  );
}
