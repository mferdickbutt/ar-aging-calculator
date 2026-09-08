/**
 * AR aging math shared by the static demo and Node tests.
 *
 * Convention: invoices are aged by calendar days past due date
 * (as-of date minus due date). If due_date is blank, invoice_date is used.
 *
 * Buckets (inclusive except 90+):
 *   current  daysPastDue <= 0  (not yet due, or due today)
 *   1-30     1..30
 *   31-60    31..60
 *   61-90    61..90
 *   90+      >= 91  (labeled "90+" as conventional AR "over 90")
 *
 * Outstanding = amount - paid. Rows with outstanding <= 0 are omitted.
 * Money is tracked in integer cents to avoid float drift.
 */
(function (root, factory) {
  if (typeof module === "object" && module.exports) {
    module.exports = factory();
  } else {
    root.ARAging = factory();
  }
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  var MS_PER_DAY = 86400000;

  var BUCKETS = [
    { key: "current", label: "Current", min: -Infinity, max: 0 },
    { key: "1-30", label: "1–30", min: 1, max: 30 },
    { key: "31-60", label: "31–60", min: 31, max: 60 },
    { key: "61-90", label: "61–90", min: 61, max: 90 },
    { key: "90+", label: "90+", min: 91, max: Infinity },
  ];

  var HEADER_ALIASES = {
    id: ["id", "invoice_id", "invoice", "invoiceid", "inv"],
    customer: ["customer", "customer_name", "name", "account", "company"],
    invoice_date: ["invoice_date", "invoicedate", "date", "inv_date"],
    due_date: ["due_date", "duedate", "due", "terms_date"],
    amount: ["amount", "invoice_amount", "total", "gross"],
    paid: ["paid", "payments", "amount_paid", "credits"],
  };

  function parseISODate(value) {
    if (value == null) return null;
    var s = String(value).trim();
    if (!s) return null;
    var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
    if (!m) return null;
    var y = Number(m[1]);
    var mo = Number(m[2]);
    var d = Number(m[3]);
    if (mo < 1 || mo > 12 || d < 1 || d > 31) return null;
    var utc = Date.UTC(y, mo - 1, d);
    var check = new Date(utc);
    if (check.getUTCFullYear() !== y || check.getUTCMonth() !== mo - 1 || check.getUTCDate() !== d) {
      return null;
    }
    return utc;
  }

  function formatISODate(utcMs) {
    var dt = new Date(utcMs);
    var y = dt.getUTCFullYear();
    var m = String(dt.getUTCMonth() + 1).padStart(2, "0");
    var d = String(dt.getUTCDate()).padStart(2, "0");
    return y + "-" + m + "-" + d;
  }

  function daysBetween(fromISO, toISO) {
    var a = parseISODate(fromISO);
    var b = parseISODate(toISO);
    if (a == null || b == null) {
      throw new Error("Invalid date (expected YYYY-MM-DD): " + fromISO + " / " + toISO);
    }
    return Math.round((b - a) / MS_PER_DAY);
  }

  function parseMoney(n) {
    if (typeof n === "number") return n;
    var s = String(n == null ? "" : n)
      .trim()
      .replace(/[$,]/g, "");
    if (!s) return 0;
    return Number(s);
  }

  function toCents(n) {
    var num = parseMoney(n);
    if (!isFinite(num)) return 0;
    return Math.round(num * 100);
  }

  function fromCents(cents) {
    return cents / 100;
  }

  function roundMoney(n) {
    return fromCents(toCents(n));
  }

  function bucketForDays(daysPastDue) {
    var i;
    for (i = 0; i < BUCKETS.length; i++) {
      var b = BUCKETS[i];
      if (daysPastDue >= b.min && daysPastDue <= b.max) return b.key;
    }
    return "90+";
  }

  /**
   * Collection priority: higher = more urgent (integer, deterministic).
   * score = max(0, daysPastDue) + round(outstanding / $100) + 50 if 90+ bucket.
   */
  function collectionPriorityScore(daysPastDue, outstandingCents, bucket) {
    var overdueDays = daysPastDue > 0 ? daysPastDue : 0;
    var amountPoints = Math.round(outstandingCents / 10000);
    var over90Bonus = bucket === "90+" ? 50 : 0;
    return overdueDays + amountPoints + over90Bonus;
  }

  function emptyBucketMap() {
    var map = {};
    var i;
    for (i = 0; i < BUCKETS.length; i++) map[BUCKETS[i].key] = 0;
    return map;
  }

  function normalizeInvoice(raw, index) {
    if (!raw || typeof raw !== "object") {
      throw new Error("Invoice at index " + index + " is not an object");
    }
    var id = String(raw.id != null ? raw.id : raw.invoice_id || "").trim();
    var customer = String(raw.customer != null ? raw.customer : raw.customer_name || "").trim();
    var invoiceDate = String(raw.invoice_date || raw.date || "").trim();
    var dueDate = String(raw.due_date || "").trim();
    if (!id) id = "ROW-" + (index + 1);
    if (!customer) customer = "(unnamed)";
    if (!invoiceDate) {
      throw new Error("Invoice " + id + " is missing invoice_date");
    }
    if (parseISODate(invoiceDate) == null) {
      throw new Error("Invoice " + id + " has invalid invoice_date: " + invoiceDate);
    }
    if (dueDate && parseISODate(dueDate) == null) {
      throw new Error("Invoice " + id + " has invalid due_date: " + dueDate);
    }
    var amount = toCents(raw.amount);
    var paid = toCents(raw.paid == null || raw.paid === "" ? 0 : raw.paid);
    return {
      id: id,
      customer: customer,
      invoice_date: invoiceDate,
      due_date: dueDate || invoiceDate,
      due_date_source: dueDate ? "due_date" : "invoice_date",
      amount_cents: amount,
      paid_cents: paid,
      outstanding_cents: amount - paid,
    };
  }

  function ageInvoice(raw, asOfDate, index) {
    var inv = normalizeInvoice(raw, index == null ? 0 : index);
    var days = daysBetween(inv.due_date, asOfDate);
    var bucket = bucketForDays(days);
    return {
      id: inv.id,
      customer: inv.customer,
      invoice_date: inv.invoice_date,
      due_date: inv.due_date,
      due_date_source: inv.due_date_source,
      amount: fromCents(inv.amount_cents),
      paid: fromCents(inv.paid_cents),
      outstanding: fromCents(inv.outstanding_cents),
      outstanding_cents: inv.outstanding_cents,
      days_past_due: days,
      bucket: bucket,
      priority_score: collectionPriorityScore(days, inv.outstanding_cents, bucket),
    };
  }

  function ageInvoices(invoices, asOfDate) {
    if (!asOfDate || parseISODate(asOfDate) == null) {
      throw new Error("asOfDate must be YYYY-MM-DD");
    }
    var list = Array.isArray(invoices) ? invoices : [];
    var aged = [];
    var skippedPaid = 0;
    var i;
    for (i = 0; i < list.length; i++) {
      var row = ageInvoice(list[i], asOfDate, i);
      if (row.outstanding_cents <= 0) {
        skippedPaid += 1;
        continue;
      }
      aged.push(row);
    }
    aged.sort(function (a, b) {
      if (b.days_past_due !== a.days_past_due) return b.days_past_due - a.days_past_due;
      return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
    });

    var totals = emptyBucketMap();
    var totalCents = 0;
    for (i = 0; i < aged.length; i++) {
      totals[aged[i].bucket] += aged[i].outstanding_cents;
      totalCents += aged[i].outstanding_cents;
    }

    var byCustomerMap = {};
    for (i = 0; i < aged.length; i++) {
      var row = aged[i];
      if (!byCustomerMap[row.customer]) {
        byCustomerMap[row.customer] = {
          customer: row.customer,
          invoices: 0,
          buckets: emptyBucketMap(),
          total_cents: 0,
        };
      }
      var c = byCustomerMap[row.customer];
      c.invoices += 1;
      c.buckets[row.bucket] += row.outstanding_cents;
      c.total_cents += row.outstanding_cents;
    }
    var byCustomer = Object.keys(byCustomerMap)
      .map(function (k) {
        return byCustomerMap[k];
      })
      .sort(function (a, b) {
        return b.total_cents - a.total_cents;
      });

    var totalsMoney = {};
    for (i = 0; i < BUCKETS.length; i++) {
      totalsMoney[BUCKETS[i].key] = fromCents(totals[BUCKETS[i].key]);
    }

    return {
      as_of: asOfDate,
      invoice_count: aged.length,
      skipped_paid: skippedPaid,
      invoices: aged,
      totals_cents: totals,
      totals: totalsMoney,
      total: fromCents(totalCents),
      total_cents: totalCents,
      by_customer: byCustomer.map(function (c) {
        var buckets = {};
        var j;
        for (j = 0; j < BUCKETS.length; j++) {
          buckets[BUCKETS[j].key] = fromCents(c.buckets[BUCKETS[j].key]);
        }
        return {
          customer: c.customer,
          invoices: c.invoices,
          buckets: buckets,
          total: fromCents(c.total_cents),
        };
      }),
    };
  }

  function splitCsvLine(line) {
    var out = [];
    var cur = "";
    var i = 0;
    var inQuotes = false;
    while (i < line.length) {
      var ch = line.charAt(i);
      if (inQuotes) {
        if (ch === '"') {
          if (line.charAt(i + 1) === '"') {
            cur += '"';
            i += 2;
            continue;
          }
          inQuotes = false;
          i += 1;
          continue;
        }
        cur += ch;
        i += 1;
        continue;
      }
      if (ch === '"') {
        inQuotes = true;
        i += 1;
        continue;
      }
      if (ch === ",") {
        out.push(cur);
        cur = "";
        i += 1;
        continue;
      }
      cur += ch;
      i += 1;
    }
    out.push(cur);
    return out;
  }

  function normalizeHeader(h) {
    return String(h || "")
      .trim()
      .toLowerCase()
      .replace(/[\s-]+/g, "_");
  }

  function mapHeaders(headers) {
    var map = {};
    var field, aliases, i, j, h;
    for (field in HEADER_ALIASES) {
      if (!Object.prototype.hasOwnProperty.call(HEADER_ALIASES, field)) continue;
      aliases = HEADER_ALIASES[field];
      for (i = 0; i < headers.length; i++) {
        h = normalizeHeader(headers[i]);
        for (j = 0; j < aliases.length; j++) {
          if (h === aliases[j]) {
            map[field] = i;
            break;
          }
        }
        if (map[field] != null) break;
      }
    }
    return map;
  }

  function parseCsv(text) {
    var raw = String(text || "").replace(/^\uFEFF/, "");
    var lines = raw.split(/\r?\n/).filter(function (line) {
      return line.trim().length > 0;
    });
    if (lines.length === 0) return [];
    var headers = splitCsvLine(lines[0]);
    var col = mapHeaders(headers);
    if (col.amount == null) {
      throw new Error("CSV is missing an amount column");
    }
    if (col.invoice_date == null) {
      throw new Error("CSV is missing an invoice_date column");
    }
    var invoices = [];
    var i;
    for (i = 1; i < lines.length; i++) {
      var cells = splitCsvLine(lines[i]);
      function cell(idx) {
        return idx == null ? "" : String(cells[idx] == null ? "" : cells[idx]).trim();
      }
      invoices.push({
        id: cell(col.id),
        customer: cell(col.customer),
        invoice_date: cell(col.invoice_date),
        due_date: cell(col.due_date),
        amount: cell(col.amount),
        paid: cell(col.paid),
      });
    }
    return invoices;
  }

  function formatUsd(n) {
    var neg = n < 0;
    var cents = Math.abs(toCents(n));
    var dollars = Math.floor(cents / 100);
    var frac = String(cents % 100).padStart(2, "0");
    var s = String(dollars);
    var grouped = s.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
    return (neg ? "-$" : "$") + grouped + "." + frac;
  }

  /**
   * RFC4180-style CSV field: quote when the value contains comma, quote, or newline;
   * internal quotes become "".
   */
  function escapeCsvField(value) {
    var s = value == null ? "" : String(value);
    if (/[",\r\n]/.test(s)) {
      return '"' + s.replace(/"/g, '""') + '"';
    }
    return s;
  }

  /** Same labels and order as the Priority-enabled open-invoice table. */
  var INVOICE_CSV_HEADERS = [
    "Invoice",
    "Customer",
    "Invoice date",
    "Due date",
    "Days past due",
    "Bucket",
    "Outstanding",
    "Priority",
  ];

  function invoiceCsvRow(inv) {
    return [
      inv.id,
      inv.customer,
      inv.invoice_date,
      inv.due_date,
      inv.days_past_due,
      inv.bucket,
      formatUsd(inv.outstanding),
      inv.priority_score,
    ]
      .map(escapeCsvField)
      .join(",");
  }

  function sortInvoicesByPriority(invoices) {
    return (invoices || []).slice().sort(function (a, b) {
      if (b.priority_score !== a.priority_score) return b.priority_score - a.priority_score;
      return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
    });
  }

  /**
   * CSV of open invoices sorted by collection-priority score (highest first).
   * Does not mutate the input list.
   */
  function formatInvoicesCsv(invoices) {
    var rows = sortInvoicesByPriority(invoices);
    var lines = [INVOICE_CSV_HEADERS.map(escapeCsvField).join(",")];
    var i;
    for (i = 0; i < rows.length; i++) {
      lines.push(invoiceCsvRow(rows[i]));
    }
    return lines.join("\n") + "\n";
  }

  return {
    BUCKETS: BUCKETS,
    INVOICE_CSV_HEADERS: INVOICE_CSV_HEADERS,
    parseISODate: parseISODate,
    formatISODate: formatISODate,
    daysBetween: daysBetween,
    toCents: toCents,
    fromCents: fromCents,
    roundMoney: roundMoney,
    bucketForDays: bucketForDays,
    collectionPriorityScore: collectionPriorityScore,
    ageInvoice: ageInvoice,
    ageInvoices: ageInvoices,
    parseCsv: parseCsv,
    formatUsd: formatUsd,
    escapeCsvField: escapeCsvField,
    sortInvoicesByPriority: sortInvoicesByPriority,
    formatInvoicesCsv: formatInvoicesCsv,
  };
});
