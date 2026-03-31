# Super Z — Premium AI Assistant

A fully functional, polished web application for **Super Z**, a premium AI assistant powered by the free tier of **Puter.js**. No backend, no server costs, 100% free.

Built with **Next.js 16**, **TypeScript**, and **Tailwind CSS 4**.

![Live Demo](https://img.shields.io/badge/Demo-Live-brightgreen)
![Next.js](https://img.shields.io/badge/Next.js-16-black)
![License](https://img.shields.io/badge/License-MIT-blue.svg)

---

### Features

- **100% Free & Unlimited** — Powered by Puter.js at no cost
- **Premium AI Models** — Opus 4.6, Sonnet 4.6, Opus 4.5, Sonnet 4.5, and more
- **Extended Thinking** — Deep reasoning mode for premium models
- **Polished Dark UI** — Clean, modern interface with smooth animations
- **File Upload** — Drag-and-drop or click to attach images, PDFs, code files, and more
- **Artifact Generation** — Interactive code canvases with copy, download, and HTML preview
- **Streaming Responses** — Watch responses appear in real-time
- **Projects** — Organize conversations into color-coded projects
- **Cloud Sync** — Firebase Firestore for persistent conversation storage
- **Local Chat History** — Remembered in browser's local storage
- **Responsive Design** — Works on desktop and mobile devices

---

### How It Works

Super Z uses the **Puter.js** SDK to access powerful AI models. On first use, a one-time authentication with your Puter account is required. After that, you're set — no API keys, no subscriptions.

---

### Deploy to Vercel

1. Fork this repository to your GitHub account
2. Go to [vercel.com/new](https://vercel.com/new)
3. Import your repository
4. Click **Deploy** — that's it!

For Firebase sync, add your environment variables in the Vercel dashboard (see `.env.example`).

---

### Run Locally

```bash
git clone https://github.com/HITIFok/unlimited-claude-ai.git
cd unlimited-claude-ai
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) in your browser.

**First use:** A popup will appear for Puter authentication. Allow it to enable free access.

---

### Tech Stack

- **Framework:** Next.js 16 (App Router)
- **Language:** TypeScript 5
- **Styling:** Tailwind CSS 4
- **API Integration:** Puter.js SDK
- **Database:** Firebase Firestore (optional)
- **Deployment:** Vercel

---

### License

This project is licensed under the **MIT License**.
