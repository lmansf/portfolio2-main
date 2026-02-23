# Portfolio Website

This repository contains a static personal portfolio website with a dedicated blog page. The site is designed to be lightweight, fast, and easy to deploy, using plain HTML, CSS, and JavaScript.

## Website Overview

The website has two core views:

- **Home page** (`index.html`) — the main landing experience for visitors.
- **Projects page** (`projects.html`) — a curated overview of selected work.
- **Blog page** (`blog.html`) — a separate page for blog content.

Both pages share the same style and interaction scripts from the `assets/` folder so the design feels consistent across the site.

## Layout and File Structure

The project is organized as follows:

```text
portfolio2-main/
├─ index.html          # Main portfolio landing page
├─ projects.html       # Projects showcase page
├─ blog.html           # Blog page
├─ vercel.json         # Deployment/routing configuration for Vercel
└─ assets/
   ├─ style.css        # Global styling, spacing, typography, and layout rules
   ├─ transition.js    # Page/UI transition behavior
   ├─ time.js          # Time/date related UI logic
   └─ blog.js          # Blog page interaction logic
```

## Design Intent

- Keep navigation and visual language consistent between pages.
- Centralize styling in `assets/style.css` for maintainability.
- Keep JavaScript modular by separating responsibilities per file.
- Preserve a static-site architecture for quick loads and simple hosting.

## AI Development Note

This website and the user-facing implementation were developed with assistance from the following models:

- **GPT-5.3-Codex**
- **Gemini 3.1 Pro**

