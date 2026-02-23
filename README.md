# Portfolio Site Deployment (Vercel)

This project is a static website and is ready to deploy for free on Vercel.

## One-time setup (no terminal)

1. Open [https://vercel.com/new](https://vercel.com/new).
2. Import the GitHub repository that contains this project.
3. In **Configure Project**:
   - **Framework Preset**: `Other`
   - **Root Directory**: repository root (the folder containing `index.html`)
   - **Build Command**: leave empty
   - **Output Directory**: `.` (if prompted)
4. Click **Deploy**.

## Verify after deploy

- Home page loads: `/` (served from `index.html`)
- Blog page loads: `/blog.html`
- Optional pretty URL also works: `/blog`

## Ongoing updates

Every push to your connected GitHub branch triggers an automatic redeploy in Vercel.

