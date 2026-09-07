# AR aging calculator

Public accounts-receivable aging: open invoice balances into **current / 1–30 / 31–60 / 61–90 / 90+**.

**Aging rule:** calendar days past **due date** (`as_of − due_date`). If `due_date` is blank, **invoice date** is used. Current includes not-yet-due and due today (0 days). **90+** is 91+ days so it does not overlap 61–90. Outstanding = `amount − paid`; fully paid invoices are omitted.

## Run (demo)

Open [the GitHub Pages demo](https://mferdickbutt.github.io/ar-aging-calculator/) or open `index.html` in a browser (or `python3 -m http.server 8080` from this directory). Load the in-repo sample, change the as-of date, or upload a CSV (`id,customer,invoice_date,due_date,amount,paid`).

## Test

```bash
./scripts/test.sh
```

(`npm test` runs the same Node assertions. No extra packages.)

## GitHub Pages

Static files live at the repo root. Enable the live demo (one time, needs repo Settings access): **Settings → Pages → Deploy from a branch → `main` / `/ (root)`**. URL: https://mferdickbutt.github.io/ar-aging-calculator/

Until Pages is switched on, use this README and open `index.html` locally.

**Next improvement:** add a customer-level collection-risk flag when 90+ is more than 25% of that customer’s AR.
