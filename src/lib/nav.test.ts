import { describe, expect, it } from "vitest";

import {
  NAV_SECTIONS,
  activeNavHref,
  breadcrumbsFor,
  flattenNav,
  isNavActive,
  isNavBranchActive,
} from "./nav";

const campaigns = NAV_SECTIONS.flatMap((s) => s.items).find(
  (i) => i.href === "/campaigns",
)!;
const leads = NAV_SECTIONS.flatMap((s) => s.items).find(
  (i) => i.href === "/leads",
)!;

describe("activeNavHref", () => {
  it("resolves an exact match", () => {
    expect(activeNavHref("/leads")).toBe("/leads");
  });

  it("resolves a child route to its nav parent", () => {
    expect(activeNavHref("/campaigns/9f3a")).toBe("/campaigns");
  });

  // The bug this module exists to kill: /campaigns and its sub-item both lit up.
  it("prefers the deepest match over the parent", () => {
    expect(activeNavHref("/campaigns/templates/cart-recovery")).toBe(
      "/campaigns/templates/cart-recovery",
    );
  });

  it("requires a path boundary, not a bare prefix", () => {
    expect(activeNavHref("/leads-archive")).toBeNull();
  });

  it("returns null for a route that is not in the nav", () => {
    expect(activeNavHref("/pulse")).toBeNull();
  });
});

describe("isNavActive", () => {
  it("lights exactly one entry on a sub-item route", () => {
    const path = "/campaigns/templates/cart-recovery";
    const lit = flattenNav().filter((i) => isNavActive(path, i.href));
    expect(lit.map((i) => i.href)).toEqual([path]);
  });

  it("does not light the parent when a child owns the route", () => {
    expect(isNavActive("/campaigns/templates/cod-confirmation", "/campaigns")).toBe(
      false,
    );
  });
});

describe("isNavBranchActive", () => {
  // The production nav is currently flat — Campaigns, Cart Recovery and COD
  // Confirmation are siblings. The helper still has to work, because the
  // collapsed rail hides children and `NavItem.children` is still supported,
  // so this exercises it against a local fixture rather than deleting it.
  const nested = [
    {
      label: "Outreach",
      items: [
        {
          href: "/campaigns",
          label: "Campaigns",
          icon: campaigns.icon,
          children: [
            {
              href: "/campaigns/templates/cart-recovery",
              label: "Cart Recovery",
              icon: campaigns.icon,
            },
          ],
        },
      ],
    },
  ];

  it("is true for the parent when a child is active", () => {
    expect(
      isNavBranchActive(
        "/campaigns/templates/cart-recovery",
        nested[0].items[0],
        nested,
      ),
    ).toBe(true);
  });

  it("is false for an unrelated branch", () => {
    expect(isNavBranchActive("/campaigns/templates/cart-recovery", leads)).toBe(
      false,
    );
  });

  // Flat nav: a sibling must not light up its neighbour.
  it("does not treat a sibling as part of the branch", () => {
    expect(
      isNavBranchActive("/campaigns/templates/cart-recovery", campaigns),
    ).toBe(false);
  });
});

describe("breadcrumbsFor", () => {
  it("returns one crumb for a top-level page", () => {
    expect(breadcrumbsFor("/leads")).toEqual([
      { label: "Leads", href: "/leads" },
    ]);
  });

  // Cart Recovery lives under /campaigns/… in the URL but is a top-level nav
  // entry, so it gets one crumb — and `Breadcrumbs` renders nothing at one
  // crumb, which is right: the page's own <h1> already says "Cart Recovery".
  it("gives a URL-nested but nav-top-level page a single crumb", () => {
    expect(breadcrumbsFor("/campaigns/templates/cart-recovery")).toEqual([
      { label: "Cart Recovery", href: "/campaigns/templates/cart-recovery" },
    ]);
  });

  it("is empty off-nav, so the topbar renders nothing", () => {
    expect(breadcrumbsFor("/pulse")).toEqual([]);
  });
});
