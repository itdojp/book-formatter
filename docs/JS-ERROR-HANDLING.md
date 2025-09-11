# JavaScript Error Handling (Safe Main)

To prevent minor client-side errors from breaking entire pages, include the shared safe runtime and use safe wrappers for non-critical enhancements.

## Usage
1) Add the script tag in your `docs/_layouts/book.html` before `</body>`:

```liquid
<script src="{{ '/assets/js/safe-main.js' | relative_url }}"></script>
```

2) Optional: define or extend functions like `initSidebar`, `initTheme` in your repo and wrap with `BookFormatterSafe.safeExecute` if needed.

## What it does
- Catches errors in enhancement functions and logs them to console.
- Defers heavy operations (TOC generation, heading IDs, link/image tweaks).
- Adds fallback heading IDs (`heading-#`) and alt text derived from filename.

This keeps core content readable even when enhancements fail.
