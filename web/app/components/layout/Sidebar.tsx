import { NavLink } from "react-router";
import { UI_PERMISSIONS, hasUiPermission, type AuthSession } from "~/lib/auth";

type NavItem = {
  to: string;
  label: string;
  end?: boolean;
  permission?: string;
  anyPermission?: string[];
  role?: string;
};

const PRIMARY_NAV: NavItem[] = [
  { to: "/dashboard", label: "Dashboard", end: true },
  { to: "/my-donor-profile", label: "My donor profile", role: "Registered Donor" },
  {
    to: "/donors",
    label: "Donors",
    anyPermission: [UI_PERMISSIONS.donorsRead, UI_PERMISSIONS.donorsCreate],
  },
  { to: "/donations", label: "Donations", permission: UI_PERMISSIONS.donationsRead },
  { to: "/inventory", label: "Inventory", permission: UI_PERMISSIONS.inventoryRead },
  { to: "/blood-requests", label: "Requests", permission: UI_PERMISSIONS.requestsRead },
  { to: "/notifications", label: "Notify", permission: UI_PERMISSIONS.notificationsRead },
  { to: "/reports", label: "Reports", permission: UI_PERMISSIONS.reportsRead },
];

const ADMIN_NAV: NavItem[] = [
  {
    to: "/admin/users",
    label: "Users",
    anyPermission: [
      UI_PERMISSIONS.usersManage,
      UI_PERMISSIONS.usersManageFacility,
    ],
  },
  {
    to: "/admin/facilities",
    label: "Facilities",
    anyPermission: [
      UI_PERMISSIONS.facilitiesRead,
      UI_PERMISSIONS.facilitiesCreate,
      UI_PERMISSIONS.facilitiesUpdate,
    ],
  },
  { to: "/admin/activity", label: "Activity", permission: UI_PERMISSIONS.activityRead },
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
  session: AuthSession;
  open?: boolean;
  onClose?: () => void;
};

function canShowNavItem(session: AuthSession, item: NavItem): boolean {
  if (item.role) {
    return (session.roleLabels ?? []).includes(item.role);
  }
  if (item.permission) {
    return hasUiPermission(session, item.permission);
  }
  if (item.anyPermission?.length) {
    return item.anyPermission.some((permission) =>
      hasUiPermission(session, permission),
    );
  }
  return true;
}

export function Sidebar({ session, open = false, onClose }: SidebarProps) {
  const primaryItems = PRIMARY_NAV.filter((item) => canShowNavItem(session, item));
  const adminItems = ADMIN_NAV.filter((item) => canShowNavItem(session, item));

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
          {primaryItems.map((item) => (
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

          {adminItems.length > 0 ? (
            <>
              <p className="mt-4 px-3 text-[11px] font-semibold uppercase tracking-wider text-slate-400">
                Admin
              </p>
              {adminItems.map((item) => (
                <NavLink
                  key={item.to}
                  to={item.to}
                  className={navClassName}
                  onClick={onClose}
                >
                  {item.label}
                </NavLink>
              ))}
            </>
          ) : null}
        </nav>
        <p className="shrink-0 border-t border-white/10 px-3 py-3 text-[11px] text-slate-400">
          Blood Donation Management System
        </p>
      </aside>
    </>
  );
}
