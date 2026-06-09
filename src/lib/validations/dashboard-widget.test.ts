import { describe, expect, it } from "vitest";

import {
  builderWidgetConfigSchema,
  sqlSelectOnlyError,
  sqlWidgetConfigSchema,
} from "@/lib/validations/dashboard-widget";

// This guard is a security boundary (the friendly half of defence-in-depth with
// the Postgres allowlist). A regression that lets a write/DDL keyword through
// must fail loudly here.
describe("sqlSelectOnlyError — accepts read-only SELECT", () => {
  it.each([
    "select count(*) from leads",
    "SELECT status, count(*) FROM calls GROUP BY status",
    "with t as (select 1 as n) select n from t",
    "  select 1  ", // trims
    "select 1;", // trailing semicolon is stripped, allowed
  ])("allows: %s", (sql) => {
    expect(sqlSelectOnlyError(sql)).toBeNull();
  });
});

describe("sqlSelectOnlyError — rejects writes / DDL / multi-statement", () => {
  it.each([
    ["empty", "   "],
    ["insert", "insert into leads (id) values (1)"],
    ["update", "update leads set name='x'"],
    ["delete", "delete from leads"],
    ["drop", "drop table leads"],
    ["alter", "alter table leads add column x int"],
    ["truncate", "truncate leads"],
    ["create", "create table x (id int)"],
    ["grant", "grant all on leads to public"],
    ["copy", "copy leads to '/tmp/x'"],
    ["set", "set role admin"],
    ["does not start with select/with", "explain select 1"],
    ["select ... into", "select * into newtable from leads"],
    ["multi-statement", "select 1; select 2"],
    ["sneaky write after select", "select 1; drop table leads"],
  ])("rejects (%s)", (_label, sql) => {
    expect(sqlSelectOnlyError(sql)).not.toBeNull();
  });
});

describe("sqlWidgetConfigSchema", () => {
  it("accepts a valid read-only SQL widget", () => {
    const parsed = sqlWidgetConfigSchema.safeParse({
      kind: "sql",
      sql: "select status, null, count(*) from calls group by status",
      chart_type: "bar",
    });
    expect(parsed.success).toBe(true);
  });

  it("rejects a SQL widget that contains a write", () => {
    const parsed = sqlWidgetConfigSchema.safeParse({
      kind: "sql",
      sql: "delete from calls",
      chart_type: "bar",
    });
    expect(parsed.success).toBe(false);
  });
});

describe("builderWidgetConfigSchema — chart shape rules", () => {
  it("stat_card must have no dimensions", () => {
    const ok = builderWidgetConfigSchema.safeParse({
      source: "leads",
      metric: { op: "count" },
      chart_type: "stat_card",
    });
    expect(ok.success).toBe(true);
  });

  it("line chart needs a time-bucketed row dimension", () => {
    const noBucket = builderWidgetConfigSchema.safeParse({
      source: "calls",
      metric: { op: "count" },
      chart_type: "line",
      row_dimension: { source: "column", key: "created_at" }, // no bucket
    });
    expect(noBucket.success).toBe(false);

    const withBucket = builderWidgetConfigSchema.safeParse({
      source: "calls",
      metric: { op: "count" },
      chart_type: "line",
      row_dimension: { source: "column", key: "created_at", bucket: "day" },
    });
    expect(withBucket.success).toBe(true);
  });

  it("sum/avg/min/max require a metric column", () => {
    const parsed = builderWidgetConfigSchema.safeParse({
      source: "calls",
      metric: { op: "sum" }, // missing column
      chart_type: "stat_card",
    });
    expect(parsed.success).toBe(false);
  });
});
