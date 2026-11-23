import { NavLink, Outlet } from "react-router";
import { OfflineBanner } from "./OfflineBanner";

export type NavItem = { path: string; label: string };

export function Layout({ nav, offline }: { nav: NavItem[]; offline: boolean }) {
  return (
    <>
      {offline && <OfflineBanner />}
      <header className="border-b border-slate-200">
        <nav
          aria-label="Główna nawigacja"
          className="mx-auto flex max-w-3xl gap-4 p-4"
        >
          <NavLink
            to="/"
            end
            className="rounded text-sm font-medium focus-visible:outline-2 focus-visible:outline-indigo-600"
          >
            Start
          </NavLink>
          {nav.map((item) => (
            <NavLink
              key={item.path}
              to={item.path}
              className="rounded text-sm font-medium focus-visible:outline-2 focus-visible:outline-indigo-600"
            >
              {item.label}
            </NavLink>
          ))}
        </nav>
      </header>
      <main className="mx-auto max-w-3xl p-8">
        <Outlet />
      </main>
    </>
  );
}
