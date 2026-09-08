import {
    index,
    layout,
    route,
    type RouteConfig,
} from "@react-router/dev/routes";

/**
 * Routes aligned with docs/05-frontend-specification.md
 */
export default [
    index("routes/home.tsx"),
    route("login", "routes/login.tsx"),
    route("logout", "routes/logout.tsx"),
    layout("routes/app-layout.tsx", [
        route("dashboard", "routes/dashboard.tsx"),

        route("donors", "routes/donors._index.tsx"),
        route("donors/new", "routes/donors.new.tsx"),
        route("donors/:id", "routes/donors.$id.tsx"),
        route("donors/:id/edit", "routes/donors.$id.edit.tsx"),

        route("donations", "routes/donations._index.tsx"),
        route("donations/new", "routes/donations.new.tsx"),
        route("donations/:id", "routes/donations.$id.tsx"),

        route("inventory", "routes/inventory._index.tsx"),
        route("inventory/:id", "routes/inventory.$id.tsx"),

        route("blood-requests", "routes/blood-requests._index.tsx"),
        route("blood-requests/new", "routes/blood-requests.new.tsx"),
        route("blood-requests/:id", "routes/blood-requests.$id.tsx"),

        route("predictions", "routes/predictions._index.tsx"),
        route("predictions/:id", "routes/predictions.$id.tsx"),

        route("alerts", "routes/alerts._index.tsx"),
        route("alerts/:id", "routes/alerts.$id.tsx"),

        route("notifications", "routes/notifications._index.tsx"),
        route("notifications/new", "routes/notifications.new.tsx"),

        route("reports", "routes/reports.tsx"),

        route("admin/users", "routes/admin.users.tsx"),
        route("admin/users/new", "routes/admin.users.new.tsx"),
        route("admin/users/:id", "routes/admin.users.$id.tsx"),
        route("admin/roles", "routes/admin.roles.tsx"),
        route("admin/activity", "routes/admin.activity.tsx"),
    ]),
] satisfies RouteConfig;
