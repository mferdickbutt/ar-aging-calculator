(function () {
  "use strict";

  var SAMPLE_AS_OF = "2026-09-07";
  var invoices = [];
  var sourceLabel = "sample invoices.json";

  var els = {
    asOf: document.getElementById("asOf"),
    file: document.getElementById("csvFile"),
    loadSample: document.getElementById("loadSample"),
    status: document.getElementById("status"),
    error: document.getElementById("error"),
    kpis: document.getElementById("kpis"),
    customerBody: document.getElementById("customerBody"),
    invoiceBody: document.getElementById("invoiceBody"),
  };

  function todayISO() {
    var n = new Date();
    var y = n.getFullYear();
    var m = String(n.getMonth() + 1).padStart(2, "0");
    var d = String(n.getDate()).padStart(2, "0");
    return y + "-" + m + "-" + d;
  }

  function showError(msg) {
    els.error.hidden = !msg;
    els.error.textContent = msg || "";
  }

  function bucketClass(key) {
    if (key === "current") return "current";
    if (key === "1-30") return "d30";
    if (key === "31-60") return "d60";
    if (key === "61-90") return "d90";
    return "over";
  }

  function render() {
    showError("");
    var asOf = els.asOf.value || SAMPLE_AS_OF;
    var report;
    try {
      report = ARAging.ageInvoices(invoices, asOf);
    } catch (err) {
      showError(err.message || String(err));
      return;
    }

    els.status.textContent =
      sourceLabel +
      " · " +
      report.invoice_count +
      " open invoices" +
      (report.skipped_paid ? " · " + report.skipped_paid + " fully paid omitted" : "") +
      " · as of " +
      asOf;

    var cards = [
      { key: "total", label: "Total AR", value: report.total, cls: "total" },
      { key: "current", label: "Current", value: report.totals.current, cls: "current" },
      { key: "1-30", label: "1–30", value: report.totals["1-30"], cls: "d30" },
      { key: "31-60", label: "31–60", value: report.totals["31-60"], cls: "d60" },
      { key: "61-90", label: "61–90", value: report.totals["61-90"], cls: "d90" },
      { key: "90+", label: "90+", value: report.totals["90+"], cls: "over" },
    ];
    els.kpis.innerHTML = cards
      .map(function (c) {
        return (
          '<div class="kpi ' +
          c.cls +
          '"><div class="label">' +
          c.label +
          '</div><div class="value">' +
          ARAging.formatUsd(c.value) +
          "</div></div>"
        );
      })
      .join("");

    els.customerBody.innerHTML = report.by_customer
      .map(function (c) {
        return (
          "<tr>" +
          '<td class="left">' +
          escapeHtml(c.customer) +
          "</td>" +
          "<td>" +
          c.invoices +
          "</td>" +
          '<td class="num-current">' +
          ARAging.formatUsd(c.buckets.current) +
          "</td>" +
          '<td class="num-d30">' +
          ARAging.formatUsd(c.buckets["1-30"]) +
          "</td>" +
          '<td class="num-d60">' +
          ARAging.formatUsd(c.buckets["31-60"]) +
          "</td>" +
          '<td class="num-d90">' +
          ARAging.formatUsd(c.buckets["61-90"]) +
          "</td>" +
          '<td class="num-over">' +
          ARAging.formatUsd(c.buckets["90+"]) +
          "</td>" +
          "<td>" +
          ARAging.formatUsd(c.total) +
          "</td>" +
          "</tr>"
        );
      })
      .join("");

    els.invoiceBody.innerHTML = report.invoices
      .map(function (inv) {
        var cls = bucketClass(inv.bucket);
        var dueNote = inv.due_date_source === "invoice_date" ? " (from invoice date)" : "";
        return (
          "<tr>" +
          '<td class="left">' +
          escapeHtml(inv.id) +
          "</td>" +
          '<td class="left">' +
          escapeHtml(inv.customer) +
          "</td>" +
          "<td>" +
          inv.invoice_date +
          "</td>" +
          "<td>" +
          inv.due_date +
          dueNote +
          "</td>" +
          "<td>" +
          inv.days_past_due +
          "</td>" +
          '<td class="left"><span class="badge ' +
          cls +
          '">' +
          inv.bucket +
          "</span></td>" +
          "<td>" +
          ARAging.formatUsd(inv.outstanding) +
          "</td>" +
          "</tr>"
        );
      })
      .join("");
  }

  function escapeHtml(s) {
    return String(s)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function loadSample() {
    return fetch("data/invoices.json")
      .then(function (res) {
        if (!res.ok) throw new Error("Could not load data/invoices.json");
        return res.json();
      })
      .then(function (rows) {
        invoices = rows;
        sourceLabel = "sample invoices.json";
        els.asOf.value = SAMPLE_AS_OF;
        els.file.value = "";
        render();
      })
      .catch(function (err) {
        showError(err.message || String(err));
      });
  }

  els.asOf.addEventListener("change", render);
  els.loadSample.addEventListener("click", function () {
    loadSample();
  });
  els.file.addEventListener("change", function () {
    var file = els.file.files && els.file.files[0];
    if (!file) return;
    var reader = new FileReader();
    reader.onload = function () {
      try {
        invoices = ARAging.parseCsv(String(reader.result || ""));
        sourceLabel = file.name;
        render();
      } catch (err) {
        showError(err.message || String(err));
      }
    };
    reader.readAsText(file);
  });

  els.asOf.value = SAMPLE_AS_OF;
  if (!els.asOf.value) els.asOf.value = todayISO();
  loadSample();
})();
