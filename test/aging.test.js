"use strict";

var fs = require("fs");
var path = require("path");
var assert = require("assert");
var ARAging = require("../js/aging.js");

var GREEN = "\u001b[32m";
var RED = "\u001b[31m";
var BOLD = "\u001b[1m";
var RESET = "\u001b[0m";
var CHECK = "\u2713";
var CROSS = "\u2717";

var passed = 0;
var failed = 0;
var failures = [];

function test(name, fn) {
  try {
    fn();
    passed += 1;
    console.log(GREEN + CHECK + RESET + " " + name);
  } catch (err) {
    failed += 1;
    failures.push({ name: name, err: err });
    console.log(RED + CROSS + RESET + " " + name);
    console.log("    " + (err && err.stack ? err.stack.split("\n").slice(0, 4).join("\n    ") : err));
  }
}

var AS_OF = "2026-09-07";
var samplePath = path.join(__dirname, "..", "data", "invoices.json");
var sampleCsvPath = path.join(__dirname, "..", "data", "invoices.csv");
var sample = JSON.parse(fs.readFileSync(samplePath, "utf8"));
var sampleCsv = fs.readFileSync(sampleCsvPath, "utf8");

test("daysBetween: same day is 0", function () {
  assert.strictEqual(ARAging.daysBetween("2026-09-07", "2026-09-07"), 0);
});

test("daysBetween: future due date is negative (not yet due)", function () {
  assert.strictEqual(ARAging.daysBetween("2026-09-15", "2026-09-07"), -8);
});

test("daysBetween: month and year boundaries", function () {
  assert.strictEqual(ARAging.daysBetween("2026-08-08", "2026-09-07"), 30);
  assert.strictEqual(ARAging.daysBetween("2026-08-07", "2026-09-07"), 31);
  assert.strictEqual(ARAging.daysBetween("2026-07-09", "2026-09-07"), 60);
  assert.strictEqual(ARAging.daysBetween("2026-07-08", "2026-09-07"), 61);
  assert.strictEqual(ARAging.daysBetween("2026-06-09", "2026-09-07"), 90);
  assert.strictEqual(ARAging.daysBetween("2026-06-08", "2026-09-07"), 91);
  assert.strictEqual(ARAging.daysBetween("2026-03-01", "2026-09-07"), 190);
});

test("daysBetween: rejects invalid calendar dates", function () {
  assert.throws(function () {
    ARAging.daysBetween("2026-02-30", "2026-09-07");
  }, /Invalid date/);
});

test("bucketForDays: current includes 0 and negative", function () {
  assert.strictEqual(ARAging.bucketForDays(-8), "current");
  assert.strictEqual(ARAging.bucketForDays(0), "current");
});

test("bucketForDays: 1-30 inclusive at both ends", function () {
  assert.strictEqual(ARAging.bucketForDays(1), "1-30");
  assert.strictEqual(ARAging.bucketForDays(30), "1-30");
});

test("bucketForDays: 31-60 inclusive at both ends", function () {
  assert.strictEqual(ARAging.bucketForDays(31), "31-60");
  assert.strictEqual(ARAging.bucketForDays(60), "31-60");
});

test("bucketForDays: 61-90 inclusive at both ends", function () {
  assert.strictEqual(ARAging.bucketForDays(61), "61-90");
  assert.strictEqual(ARAging.bucketForDays(90), "61-90");
});

test("bucketForDays: 90+ starts at 91 (no overlap with 61-90)", function () {
  assert.strictEqual(ARAging.bucketForDays(91), "90+");
  assert.strictEqual(ARAging.bucketForDays(190), "90+");
});

test("ageInvoice: missing due_date falls back to invoice_date", function () {
  var row = ARAging.ageInvoice(
    { id: "X", customer: "Hooli", invoice_date: "2026-07-20", due_date: "", amount: 1800, paid: 0 },
    AS_OF
  );
  assert.strictEqual(row.due_date, "2026-07-20");
  assert.strictEqual(row.due_date_source, "invoice_date");
  assert.strictEqual(row.days_past_due, 49);
  assert.strictEqual(row.bucket, "31-60");
});

test("ageInvoice: outstanding is amount minus paid", function () {
  var row = ARAging.ageInvoice(
    { id: "P", customer: "Acme Corp", invoice_date: "2026-02-01", due_date: "2026-03-01", amount: 25000, paid: 3000 },
    AS_OF
  );
  assert.strictEqual(row.outstanding, 22000);
  assert.strictEqual(row.bucket, "90+");
});

test("cents rounding: 9999.99 stays exact", function () {
  assert.strictEqual(ARAging.toCents(9999.99), 999999);
  assert.strictEqual(ARAging.fromCents(999999), 9999.99);
});

test("ageInvoices: fully paid invoices are omitted from AR", function () {
  var report = ARAging.ageInvoices(sample, AS_OF);
  var ids = report.invoices.map(function (r) {
    return r.id;
  });
  assert.ok(ids.indexOf("INV-1013") === -1);
  assert.strictEqual(report.skipped_paid, 1);
  assert.strictEqual(report.invoice_count, 13);
});

test("ageInvoices: sample as-of 2026-09-07 lands in every bucket", function () {
  var report = ARAging.ageInvoices(sample, AS_OF);
  var byId = {};
  report.invoices.forEach(function (r) {
    byId[r.id] = r;
  });
  assert.strictEqual(byId["INV-1001"].bucket, "current");
  assert.strictEqual(byId["INV-1001"].days_past_due, -8);
  assert.strictEqual(byId["INV-1002"].bucket, "current");
  assert.strictEqual(byId["INV-1002"].days_past_due, 0);
  assert.strictEqual(byId["INV-1003"].bucket, "1-30");
  assert.strictEqual(byId["INV-1003"].days_past_due, 18);
  assert.strictEqual(byId["INV-1004"].bucket, "1-30");
  assert.strictEqual(byId["INV-1004"].days_past_due, 30);
  assert.strictEqual(byId["INV-1005"].bucket, "31-60");
  assert.strictEqual(byId["INV-1005"].days_past_due, 31);
  assert.strictEqual(byId["INV-1006"].bucket, "31-60");
  assert.strictEqual(byId["INV-1006"].days_past_due, 60);
  assert.strictEqual(byId["INV-1012"].bucket, "31-60");
  assert.strictEqual(byId["INV-1007"].bucket, "61-90");
  assert.strictEqual(byId["INV-1007"].days_past_due, 61);
  assert.strictEqual(byId["INV-1008"].bucket, "61-90");
  assert.strictEqual(byId["INV-1008"].days_past_due, 90);
  assert.strictEqual(byId["INV-1009"].bucket, "90+");
  assert.strictEqual(byId["INV-1009"].days_past_due, 91);
  assert.strictEqual(byId["INV-1010"].bucket, "90+");
  assert.strictEqual(byId["INV-1010"].days_past_due, 190);
  assert.strictEqual(byId["INV-1011"].bucket, "1-30");
  assert.strictEqual(byId["INV-1011"].outstanding, 6000);
  assert.strictEqual(byId["INV-1014"].bucket, "current");
  assert.strictEqual(byId["INV-1014"].outstanding, 4000);
});

test("ageInvoices: bucket totals (cents) match invoice outstanding", function () {
  var report = ARAging.ageInvoices(sample, AS_OF);
  assert.strictEqual(report.totals_cents.current, 500000 + 325000 + 400000);
  assert.strictEqual(report.totals_cents["1-30"], 840000 + 210000 + 600000);
  assert.strictEqual(report.totals_cents["31-60"], 450000 + 675000 + 180000);
  assert.strictEqual(report.totals_cents["61-90"], 120000 + 999999);
  assert.strictEqual(report.totals_cents["90+"], 1500000 + 2200000);
  assert.strictEqual(report.total_cents, 8999999);
  assert.strictEqual(report.total, 89999.99);
});

test("ageInvoices: customer rollup for Acme Corp", function () {
  var report = ARAging.ageInvoices(sample, AS_OF);
  var acme = report.by_customer.filter(function (c) {
    return c.customer === "Acme Corp";
  })[0];
  assert.ok(acme);
  assert.strictEqual(acme.invoices, 3);
  assert.strictEqual(acme.buckets.current, 5000);
  assert.strictEqual(acme.buckets["1-30"], 8400);
  assert.strictEqual(acme.buckets["90+"], 22000);
  assert.strictEqual(acme.total, 35400);
});

test("parseCsv: sample CSV matches sample JSON aging totals", function () {
  var fromCsv = ARAging.ageInvoices(ARAging.parseCsv(sampleCsv), AS_OF);
  var fromJson = ARAging.ageInvoices(sample, AS_OF);
  assert.strictEqual(fromCsv.total_cents, fromJson.total_cents);
  assert.strictEqual(fromCsv.invoice_count, fromJson.invoice_count);
  assert.deepStrictEqual(fromCsv.totals_cents, fromJson.totals_cents);
});

test("parseCsv: quoted customer names and comma amounts", function () {
  var csv = [
    "invoice_id,customer_name,invoice_date,due,amount,payments",
    'INV-9,"Wayne, Inc.",2026-08-01,2026-08-08,"1,250.50",0',
  ].join("\n");
  var rows = ARAging.parseCsv(csv);
  assert.strictEqual(rows[0].id, "INV-9");
  assert.strictEqual(rows[0].customer, "Wayne, Inc.");
  assert.strictEqual(rows[0].due_date, "2026-08-08");
  var report = ARAging.ageInvoices(rows, AS_OF);
  assert.strictEqual(report.invoices[0].outstanding, 1250.5);
  assert.strictEqual(report.invoices[0].days_past_due, 30);
  assert.strictEqual(report.invoices[0].bucket, "1-30");
});

test("parseCsv: escaped quotes", function () {
  var csv = 'id,customer,invoice_date,due_date,amount,paid\n1,"Foo ""Bar"" Co",2026-09-01,2026-09-15,10,0\n';
  var rows = ARAging.parseCsv(csv);
  assert.strictEqual(rows[0].customer, 'Foo "Bar" Co');
});

test("formatUsd: groups thousands and shows cents", function () {
  assert.strictEqual(ARAging.formatUsd(122349.99), "$122,349.99");
  assert.strictEqual(ARAging.formatUsd(0), "$0.00");
  assert.strictEqual(ARAging.formatUsd(-12.5), "-$12.50");
});

test("ageInvoices: empty list is a zeroed report", function () {
  var report = ARAging.ageInvoices([], AS_OF);
  assert.strictEqual(report.total, 0);
  assert.strictEqual(report.invoice_count, 0);
  assert.strictEqual(report.totals.current, 0);
  assert.strictEqual(report.totals["90+"], 0);
});

test("ageInvoices: rejects bad as-of date", function () {
  assert.throws(function () {
    ARAging.ageInvoices(sample, "09/07/2026");
  }, /asOfDate/);
});

console.log("");
if (failed) {
  console.log(RED + BOLD + failed + " failed, " + passed + " passed" + RESET);
  process.exit(1);
}
console.log(GREEN + BOLD + "All " + passed + " tests passed." + RESET);
