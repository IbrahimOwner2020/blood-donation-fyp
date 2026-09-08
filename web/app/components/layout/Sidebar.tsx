import { NavLink } from "react-router";

type NavItem = {
  to: string;
  label: string;
  end?: boolean;
};

const PRIMARY_NAV: NavItem[] = [
  { to: "/dashboard", label: "Dashboard", end: true },
  { to: "/donors", label: "Donors" },
  { to: "/donations", label: "Donations" },
  { to: "/inventory", label: "Inventory" },
  { to: "/blood-requests", label: "Requests" },
  { to: "/predictions", label: "Forecasts" },
  { to: "/alerts", label: "Alerts" },
  { to: "/notifications", label: "Notify" },
  { to: "/reports", label: "Reports" },
];

const ADMIN_NAV: NavItem[] = [
  { to: "/admin/users", label: "Users" },
  { to: "/admin/roles", label: "Roles" },
  { to: "/admin/activity", label: "Activity" },
];

function navClassName({ isActive }: { isActive: boolean }): string {
  return [
    "block rounded px-3 py-2 text-sm transition-colors",
    isActive
      ? "bg-nbts-blood text-white"
      : "text-slate-200 hover:bg-white/10 hover:text-white",
  ].join(" ");
}

type SidebarProps = {
  open?: boolean;
  onClose?: () => void;
};

export function Sidebar({ open = false, onClose }: SidebarProps) {
  return (
    <>
      {open ? (
        <button
          type="button"
          aria-label="Close navigation"
          className="fixed inset-0 z-30 bg-nbts-slate/50 lg:hidden"
          onClick={onClose}
        />
      ) : null}
      <aside
        className={[
          "fixed inset-y-0 left-0 z-40 flex w-64 shrink-0 flex-col border-r border-nbts-slate bg-nbts-slate text-slate-100 transition-transform duration-200 lg:static lg:h-full lg:min-h-0 lg:w-56 lg:translate-x-0",
          open ? "translate-x-0" : "-translate-x-full",
        ].join(" ")}
      >
        <div className="flex h-14 shrink-0 items-center justify-between border-b border-white/10 px-3 lg:hidden">
          <p className="text-sm font-semibold">Navigation</p>
          <button
            type="button"
            className="rounded border border-white/20 px-2 py-1 text-sm text-white"
            onClick={onClose}
            aria-label="Close navigation"
          >
            ×
          </button>
        </div>
        <nav
          className="flex min-h-0 flex-1 flex-col gap-1 overflow-y-auto p-3"
          aria-label="Main"
        >
          {PRIMARY_NAV.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.end}
              className={navClassName}
              onClick={onClose}
            >
              {item.label}
            </NavLink>
          ))}

          <p className="mt-4 px-3 text-[11px] font-semibold uppercase tracking-wider text-slate-400">
            Admin
          </p>
          {ADMIN_NAV.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              className={navClassName}
              onClick={onClose}
            >
              {item.label}
            </NavLink>
          ))}
        </nav>
        <p className="shrink-0 border-t border-white/10 px-3 py-3 text-[11px] text-slate-400">
          Presentation shell - API is authority
        </p>
      </aside>
    </>
  );
}
