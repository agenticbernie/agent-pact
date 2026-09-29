import { NavLink } from "react-router-dom";

const ICONS = {
  home: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 10.5 12 3l9 7.5" />
      <path d="M5 9.5V21h14V9.5" />
      <path d="M10 21v-6h4v6" />
    </svg>
  ),
  pay: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M22 2 11 13" />
      <path d="M22 2 15 22l-4-9-9-4z" />
    </svg>
  ),
  activity: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
      <path d="M4 6h16M4 12h16M4 18h10" />
    </svg>
  ),
  policy: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 3l7 3v5c0 5-3.5 8.5-7 9.5C8.5 19.5 5 16 5 11V6z" />
      <path d="M9 11.5l2 2 4-4.5" />
    </svg>
  ),
  settings: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
      <path d="M4 7h9M17 7h3" />
      <circle cx="15" cy="7" r="2" />
      <path d="M4 17h3M11 17h9" />
      <circle cx="9" cy="17" r="2" />
    </svg>
  ),
};

const ITEMS = [
  { to: "/", label: "Home", icon: ICONS.home },
  { to: "/pay", label: "Pay", icon: ICONS.pay },
  { to: "/activity", label: "Activity", icon: ICONS.activity },
  { to: "/policy", label: "Policy", icon: ICONS.policy },
  { to: "/settings", label: "Settings", icon: ICONS.settings },
];

export default function BottomNav() {
  return (
    <nav className="bottom-nav">
      {ITEMS.map((item) => (
        <NavLink key={item.to} to={item.to} end={item.to === "/"} className="nav-item">
          {item.icon}
          <span>{item.label}</span>
        </NavLink>
      ))}
    </nav>
  );
}
