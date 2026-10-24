// Sidebar navigation. `stage` marks modules that are placeholders until the
// stage that builds them. `permission` hides an item from roles that cannot use it
// (a convenience only: every page also checks on the server).
export type NavItem = {
  href: string;
  label: string;
  icon: string; // SVG path data, 24×24, stroke icons
  stage?: number;
  permission?: "admin.view";
};

export type NavGroup = { label: string; items: NavItem[] };

export const NAVIGATION: NavGroup[] = [
  {
    label: "Overview",
    items: [{ href: "/dashboard", label: "Dashboard", icon: "M3 3h7v9H3zM14 3h7v5h-7zM14 12h7v9h-7zM3 16h7v5H3z" }],
  },
  {
    label: "Maintenance",
    items: [
      {
        href: "/assets",
        label: "Equipment Assets",
        icon: "M4 4h6v6H4zM14 4h6v6h-6zM4 14h6v6H4zM14 14h2M18 14h2v2M14 18h2v2M18 20h2",
      },
      { href: "/work-orders", label: "Work Orders", icon: "M9 4h6v3H9zM7 5H5v16h14V5h-2M9 12h6M9 16h4" },
      {
        href: "/maintenance",
        label: "Preventive Maintenance",
        icon: "M4 6h16v14H4zM4 10h16M8 3v5M16 3v5M9 15l2 2 4-4",
      },
      {
        href: "/testing",
        label: "Safety Tests and Calibration",
        icon: "M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6zM13 8l-3 5h4l-3 5",
      },
      {
        href: "/inventory",
        label: "Spare Parts Inventory",
        icon: "M3 7l9-4 9 4v10l-9 4-9-4zM3 7l9 4 9-4M12 11v10",
      },
      {
        href: "/suppliers",
        label: "Suppliers and Contracts",
        icon: "M3 9h13v8H3zM16 12h3l2 3v2h-5M7 20a2 2 0 1 0 0-4 2 2 0 0 0 0 4zM18 20a2 2 0 1 0 0-4 2 2 0 0 0 0 4z",
      },
    ],
  },
  {
    label: "Intelligence",
    items: [
      {
        href: "/knowledge",
        label: "Technical Knowledge",
        icon: "M4 5a2 2 0 0 1 2-2h13v16H6a2 2 0 0 0-2 2zM4 19V5M8 7h7M8 11h5",
      },
      {
        href: "/assist",
        label: "IntellAssist",
        icon: "M12 2.5l8.2 4.75v9.5L12 21.5l-8.2-4.75v-9.5zM6.5 12.5h2.5l1.5-3 2 6 1.5-3h3.5",
      },
      { href: "/reports", label: "Reports and Analytics", icon: "M6 3h9l4 4v14H6zM14 3v5h5M9 13h7M9 17h5" },
    ],
  },
  {
    label: "Administration",
    items: [
      {
        href: "/admin",
        label: "User and Organization Administration",
        permission: "admin.view",
        icon: "M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM2 21c0-4 3-6 7-6s7 2 7 6M17 11l2 2 3-3",
      },
      { href: "/settings", label: "Settings", icon: "M4 7h10M18 7h2M4 17h4M12 17h8M14 4v6M8 14v6" },
    ],
  },
];
