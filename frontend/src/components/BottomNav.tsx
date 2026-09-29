import { NavLink } from "react-router-dom";
import { Icon } from "./ui";

const ITEMS = [
  { to: "/", label: "Home", icon: "home" },
  { to: "/pay", label: "Pay", icon: "send" },
  { to: "/activity", label: "Activity", icon: "history" },
  { to: "/policy", label: "Policy", icon: "verified_user" },
  { to: "/settings", label: "Settings", icon: "tune" },
];

export default function BottomNavigation() {
  return (
    <nav className="bottom-nav">
      {ITEMS.map((item) => (
        <NavLink key={item.to} to={item.to} end={item.to === "/"} className="nav-item">
          <Icon name={item.icon} />
          <span>{item.label}</span>
        </NavLink>
      ))}
    </nav>
  );
}
