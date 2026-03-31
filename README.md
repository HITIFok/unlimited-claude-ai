# Unlimited Claude AI Interface

A fully functional, polished web interface for Anthropic's Claude AI. This project uses the free tier of **Puter.js** for secure access to the Claude API — no backend, no server costs, 100% free.

Built with **Next.js 16**, **TypeScript**, and **Tailwind CSS 4**.

![Live Demo](https://img.shields.io/badge/Demo-Live-brightgreen)
![Next.js](https://img.shields.io/badge/Next.js-16-black)
![License](https://img.shields.io/badge/License-MIT-blue.svg)

---

### Features

- **100% Free Access** — Leverages Puter.js free tier to interact with Claude API at no cost
- **Polished Dark UI** — Clean, modern interface inspired by the official Claude UI
- **Artifact Generation** — Renders code blocks into interactive canvases with syntax highlighting, copy, download, and HTML preview
- **Streaming Responses** — Watch Claude's responses appear in real-time
- **Local Chat History** — Remembers recent conversations in browser's local storage
- **Model Switching** — Toggle between Claude Sonnet 4, Claude Opus 4, and Claude 3.7 Sonnet
- **Responsive Design** — Works on desktop and mobile devices
- **Secure Authentication** — Puter.js authentication handled directly in the browser

---

### How It Works

This interface uses the official **Puter.js** library. On first use, it will ask for a one-time authentication with your Puter account, which securely connects to your account's free Claude API access.

---

### Deploy to Vercel

[![Deploy with Vercel](https://vercel.com/button)](https://vercel.com/new/clone?repository-url=https://github.com/YOUR_USERNAME/unlimited-claude-ai)

1. Fork or clone this repository to your GitHub account
2. Go to [vercel.com/new](https://vercel.com/new)
3. Import your repository
4. Click **Deploy** — that's it!

Vercel will auto-detect Next.js and configure everything. No environment variables needed.

---

### Run Locally

```bash
# Clone the repository
git clone https://github.com/YOUR_USERNAME/unlimited-claude-ai.git
cd unlimited-claude-ai

# Install dependencies
npm install

# Start development server
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) in your browser.

**First use:** A popup will appear asking you to authenticate with Puter. Allow it to enable free Claude access.

---

### Tech Stack

- **Framework:** Next.js 16 (App Router)
- **Language:** TypeScript 5
- **Styling:** Tailwind CSS 4
- **API Integration:** Puter.js SDK (`@puter.com/v2`)
- **Deployment:** Vercel

---

### License

This project is licensed under the **MIT License**. Original project by [Hassan Musthafa](https://github.com/itkcartoons).
