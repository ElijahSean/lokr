# Lokr

> **Your secrets, your machine.**

A local password manager that runs entirely in your browser. No accounts. No cloud. No servers. Everything stays on your device, encrypted with your master password.

---

## Table of Contents

- [Features](#features)
- [Running Locally](#running-locally)
- [Windows Desktop Shortcut](#windows-desktop-shortcut)
- [How to Use](#how-to-use)
- [Backup & Recovery](#backup--recovery)
- [Security Notes](#security-notes)
- [How the Encryption Works](#how-the-encryption-works)

---

## Features

### Vault
- Store passwords, passphrases, and numeric PINs (ATM codes, lock codes, etc.)
- Search across site name, username, and notes
- Passwords masked by default — reveal only when you click the eye icon
- One-click copy for username and password
- Clipboard auto-clears after **30 seconds**
- Notes field for extra info (recovery email, 2FA codes, card details, etc.)

### Password History
- Every time you change a password, the previous one is saved automatically (up to 10 per entry)
- Expand the **History** section on any entry to see all previous passwords with their dates
- Each history entry can be individually revealed or copied

### PIN & Code Storage
- Dedicated **PIN / Code** entry type for ATM cards, door codes, and numeric secrets
- Digits only, 4–8 characters
- Displayed as `• • • •` in the vault (distinct from password masking)

### Generator
Four modes, all cryptographically random:

| Mode | What it makes | Example |
|---|---|---|
| **Password** | Configurable character mix, 12–64 chars | `Kx#9mP!qZr2n` |
| **Passphrase** | Random words joined by hyphens, 3–8 words | `calm-bird-grow-fuel-loud` |
| **Username** | Adjective + noun + number | `swift_eagle427` |
| **PIN** | Pure digits, 4–8 characters | `3847` |

There is also a **Generate** shortcut button inside the Add Entry form — fills a strong 20-character password without opening the Generator tab.

### Security Health Dashboard
Scans all your entries and flags:
- **Weak / Fair passwords** — low-entropy passwords that could be guessed
- **Reused passwords** — same password used on multiple sites
- **Old passwords** — not changed in 90+ days

### Backup & Restore
- **Export .vault** — encrypted entries, password history and sticky notes, safe to store in a cloud drive or USB stick
- **Import .vault** — restore your vault on any device running Lokr
- **Export .csv** — separate plaintext credential and sticky-note files (requires typing `CONFIRM`)
- **Full Reset** — wipe all vault data from this device (requires typing `RESET`)
- Reminder banner if no backup in 7+ days

### Encrypted Notes
- Rich-text notes with eight paper colours, pins, notebook lines, headings, lists, checklists, tables, and links
- Up to five encrypted pictures per note, re-encoded to drop camera metadata
- Find inside an open note with **Ctrl+F** (Cmd+F on macOS) or the magnifier: every match highlighted, "n of m", Enter / Shift+Enter to step

### Note Files
- **Export one note** — creates `lokr-note.lokrnote`, encrypted with a separate 12+ character file password
- **Import a note** — accepts `.lokrnote`, UTF-8 `.txt`, and raw-text `.md` files up to 100 KB
- Individual note files never use or reveal the vault master password

### Auto-Lock
- Locks after **5 minutes** of inactivity
- Locks immediately when you **switch tabs** or minimize the browser, except while a note is open full-window; the 5-minute idle lock still applies there
- Lock button always visible in the top-right corner

### Appearance
- Starts in **Dark mode** on a new browser profile
- Use the sun/moon control in the top-right corner to switch between Dark and Light
- The choice persists across reloads and browser restarts
- Only the word `light` or `dark` is stored in a local preference cookie; no vault data is included

---

## Running Locally

### Prerequisites

| Requirement | Version | Install |
|---|---|---|
| Node.js | v18 or later | [nodejs.org](https://nodejs.org/) |
| pnpm | any | `npm install -g pnpm` |

### Install dependencies

```bash
cd lokr
pnpm install
```

This installs Next.js, React, Dexie.js, argon2-browser, Tiptap, TypeScript, Tailwind CSS, Vitest, and ESLint.

## Windows Desktop Shortcut

The recommended way to run Lokr on Windows is its Desktop shortcut. From
PowerShell in the Lokr repository, run:

```bash
pnpm shortcut:install
```

This builds the production app first, then creates or refreshes **Lokr.lnk** on
the current user's Desktop. The installer gives each revision of the committed
Lokr icon a versioned local path so Windows does not keep showing an older cached
image.

To use it:

1. Double-click **Lokr** on the Desktop.
2. The shortcut starts Lokr silently on `127.0.0.1:3001` if it is not already running.
3. It waits for Lokr to become ready, then opens [http://localhost:3001](http://localhost:3001) as a Chrome app window (no tabs or address bar) in a dedicated Google Chrome profile stored at `%LOCALAPPDATA%\Lokr\ChromeProfile`.
4. The window gets its own taskbar button with the Lokr padlock, separate from Chrome.
5. Double-clicking it again reuses the existing Lokr server and brings the open Lokr window to the front (restored if minimised) instead of opening another one.

Links you Ctrl+click in a note open in an ordinary Chrome window of the same
dedicated profile, which shows Chrome's icon while it is open.

To keep Lokr on the taskbar, open it, right-click its padlock button and choose
**Pin to taskbar**. Windows saves the pin when the Lokr window next closes. After
that, one click on the pinned padlock starts the hidden server if it isn't
running and opens Lokr on that same button. Pinning the Desktop shortcut itself,
or adding it to the Start menu, does not work: Windows records no pin from it.

The shortcut does not change the Windows default browser or modify your normal
Chrome profile. Chrome must already be installed. The dedicated profile persists,
so its Lokr vault and appearance setting remain available on later launches.

### Moving an existing vault into the dedicated profile

Chrome keeps IndexedDB data separate by profile, so an existing normal-profile
vault does not appear automatically. Transfer it through Lokr's authenticated,
encrypted backup format—never by copying Chrome profile or database files:

1. Open normal Chrome manually, visit [http://localhost:3001](http://localhost:3001), unlock the existing vault, and use **Backup → Download lokr-backup.vault**.
2. Open the Desktop shortcut. On the dedicated profile's first launch, create an empty temporary vault so you can reach the **Backup** tab.
3. Under **Import backup**, select the downloaded `.vault` file, and enter the original vault's master password. Restore fully replaces the temporary vault.
4. Verify the entries, notes and attachments, then lock and unlock once with the original master password before removing any old data.

The old normal-profile vault is not changed or deleted by installing or launching
the shortcut. Keep the encrypted backup until the restored vault is verified.

After pulling updates or changing source code, run `pnpm shortcut:install` again.
The existing shortcut is replaced only after the new production build succeeds.

The hidden server remains available for later launches until its Node process
ends or you sign out of Windows. Deleting **Lokr.lnk** removes only the shortcut;
it does not remove the repository or browser vault data.

### Shortcut troubleshooting

- **Missing production build:** run `pnpm shortcut:install` again.
- **Google Chrome was not found:** install Chrome in its standard per-user or system location, then launch Lokr again.
- **Port 3001 is already in use:** close the unrelated application using that port, then launch Lokr again. The launcher will not reuse a server unless its response identifies it as Lokr.
- **The repository was moved:** rerun `pnpm shortcut:install` from its new location so the shortcut paths are refreshed.
- **The shortcut does not appear on the Desktop:** run the installer from a normal PowerShell window for the same Windows account that will use Lokr.

### Development mode

For live reloading while changing the source code, run:

```bash
pnpm dev
```

Open [http://localhost:3001](http://localhost:3001) in your browser. Stop the
development server with `Ctrl+C` in its terminal.

The development server uses the same port and the same `.next` build folder as
the Desktop shortcut's hidden production server. Stop that server first (end
its `node` process), and run `pnpm shortcut:install` afterwards so the shortcut
has a production build again. Running `pnpm dev` alongside it overwrites the
production build, and the shortcut's Lokr then fails to load.

### Other commands

```bash
pnpm build        # Production build (type-check + bundle)
pnpm shortcut:install # Build and create/refresh the Windows Desktop shortcut
pnpm test:launcher    # Test the launcher and shortcut in isolation
pnpm icon:windows     # Regenerate the Windows icon from public/logo.svg
pnpm lint         # Run ESLint
pnpm type-check   # TypeScript check without building
pnpm test         # Unit tests for lib/ (Vitest, specs in tests/)
```

### Recommended: Use a dedicated browser profile

Create a separate browser profile just for Lokr. This isolates it from extensions that could read clipboard data or inspect the page DOM.

---

## How to Use

### Creating Your Vault (First Time)

1. Open Lokr from the Desktop shortcut, or browse to [http://localhost:3001](http://localhost:3001)
2. The **Create Your Vault** form appears
3. Type a strong master password — the strength meter gives live feedback
4. Confirm the password
5. Click **Create Vault** — Argon2id derives your encryption key (~1–2 seconds)
6. You are taken to your vault

> **There is no password recovery.** If you forget your master password, your vault cannot be opened. Write it down and keep it somewhere physically safe.

### Unlocking

1. Open Lokr from the Desktop shortcut, or browse to [http://localhost:3001](http://localhost:3001)
2. Enter your master password and click **Unlock**
3. After 3 wrong attempts each retry is delayed (up to 30 seconds); after 10, unlocking is blocked for 15 minutes. The counter is stored with the vault, so a new tab or reload does not reset it

### Changing Light or Dark Mode

Use the sun/moon button in the top-right corner of the unlock screen or vault
header. The change is immediate and remains selected the next time Lokr opens.

### Adding a Password Entry

1. Go to the **Vault** tab → click **Add Entry**
2. Make sure **Password / Passphrase** is selected (the default)
3. Fill in **Site or Service** (e.g. `github.com`)
4. Fill in **Username / Email**
5. Enter a password, or click **Generate** to fill one automatically
6. Add optional notes (recovery email, 2FA codes, etc.)
7. Click **Add Entry**

### Adding a PIN or Code

1. Click **Add Entry**
2. Click **PIN / Code** to switch entry type
3. Fill in **Account / Card Name** (e.g. `Visa Debit`)
4. Fill in **Card / Account Label** (e.g. `ending in 4242`)
5. Enter your 4–8 digit PIN (non-digit characters are blocked automatically)
6. Add optional notes (bank name, branch, card type, etc.)
7. Click **Add Entry**

### Finding Text in a Note

1. Open a note and press **Ctrl+F** (Cmd+F on macOS), or click the magnifier in the tool row
2. Type a word: every match is highlighted and the count shows "2 of 7"
3. Press **Enter** for the next match and **Shift+Enter** for the previous one; both wrap round
4. Press **Esc** to close find; the cursor stays at the match. Press **Esc** again to close the note

Outside an open note, Ctrl+F is the browser's own find. The search term is never saved.

### Copying a Password

- Click the **clipboard icon** next to the username to copy the username
- Click the **clipboard icon** in the password row to copy the password
- A checkmark confirms the copy; clipboard clears in 30 seconds

### Revealing a Password

- Click the **eye icon** in the password row to show the password
- Click again to hide it

### Editing an Entry

1. Click **Edit** on any entry card
2. Change any field — if you change the password, the old one is saved to history automatically
3. Click **Save Changes**

### Viewing Password History

1. Find the entry in the vault
2. Click the **History** toggle below the password row
3. Previous passwords are listed newest-first with their dates
4. Each history item has its own reveal and copy button

### Generating a Password, Passphrase, Username, or PIN

1. Go to the **Generator** tab
2. Select a mode: **Password**, **Passphrase**, **Username**, or **PIN**
3. Adjust options (length, character types, word count, etc.)
4. Click **Copy** to copy, or **Regenerate** for a new one

### Checking Security Health

1. Go to the **Health** tab
2. Lokr decrypts all entries and analyses them
3. Issues are grouped: weak/fair passwords, reused passwords, old passwords
4. Fix issues by editing entries, then click **Re-analyze**

---

## Backup & Recovery

### Creating a Backup

1. Go to the **Backup** tab
2. Click **Download lokr-backup.vault**
3. Save the file to a cloud drive, USB stick, or email it to yourself
4. The `.vault` file is fully encrypted — it cannot be read without your master password

### Restoring a Backup

1. On any device running Lokr, go to the **Backup** tab
2. Under **Import Backup**, click the file picker and select your `.vault` file
3. Lokr verifies the file's integrity and imports all entries, history and sticky notes
4. Your existing vault data is replaced — export a backup first if needed

### Exporting to CSV (for Migration)

Use these only for migration or a plaintext copy you will secure immediately.

1. Go to the **Backup** tab → scroll to **Export Plaintext CSV**
2. Read the warning — the files contain **passwords or sticky notes in plain text**
3. Type `CONFIRM` once to unlock both export buttons
4. Download `lokr-export.csv` for credentials and/or `lokr-notes-export.csv` for notes
5. Import the credential CSV into your new password manager; note bodies are plain text in the notes CSV
6. **Delete the CSV files immediately after use**

### Moving One Note

1. Open a note and click **Export note**
2. Type a new file password of at least 12 characters twice, then download `lokr-note.lokrnote`
3. In another vault, open the **Notes** tab and click **Import**
4. Select the `.lokrnote` and enter its file password
5. You can also import UTF-8 `.txt` or `.md` files; Markdown stays as raw text rather than being formatted

### Full Reset

Use this to wipe all data from the device (e.g. before lending the device).

1. Go to the **Backup** tab → scroll to **Full Reset**
2. Export a backup first if you want to keep your passwords
3. Type `RESET` in the input field
4. Click **Permanently Delete Everything**
5. All vault data is removed and the app returns to the setup screen

---

## Security Notes

### What Lokr protects against
- Someone who copies your IndexedDB files from disk — all data is AES-256-GCM encrypted
- Network-based attacks — the Content Security Policy blocks all outbound connections
- Shoulder-surfing — auto-lock on tab hide, passwords masked by default
- Offline brute-force after device theft — Argon2id makes each guess take ~1–2 seconds and 64 MB of RAM

### What Lokr does not protect against
- An attacker with live access to your unlocked browser session
- Browser extensions with full host permissions on `localhost` — use a dedicated browser profile
- Physical access to an unlocked screen (auto-lock fires after 5 minutes, not instantly)
- Forgetting your master password — there is no recovery by design
- Malware that intercepts clipboard before the 30-second auto-clear

### Storage note
IndexedDB data is stored in your browser profile directory. If you use browser sync, disable syncing for `localhost` to prevent encrypted vault data from being uploaded to the browser's cloud.

Never commit a backup or export to this repository. `.gitignore` excludes
`.vault`, `.csv` and `.lokrnote` files, and the vault itself lives only in the
browser profile, never in the project folder.

The separate `lokr-theme` cookie stores only `light` or `dark` so the correct
appearance can be rendered before the page first appears. It contains no vault
identifier, password, key, ciphertext, or account data.

---

## How the Encryption Works

```
Master Password + Random Salt
         │
         ▼  Argon2id (3 iterations, 64 MiB RAM — intentionally slow)
  64 bytes of key material
         │
         ├── Bytes 0–31  →  AES-256-GCM key  →  encrypts/decrypts each password
         └── Bytes 32–63 →  HMAC-SHA256 key  →  signs the entire vault after every write
```

**Each password entry** is encrypted individually with a fresh random IV. The AES-GCM authentication tag means any tampering with the stored data is detected at decryption time.

**The master password is never stored** anywhere. The derived key lives only in browser memory and is set to `null` on every lock event.

**The HMAC signature** covers all encrypted entries. On every unlock, the signature is verified before the session key is accepted — a wrong password or tampered IndexedDB both fail this check.

---

## Tech Stack

| Layer | Technology | Role |
|---|---|---|
| Framework | Next.js 14 (App Router) | App shell, routing, security headers |
| Language | TypeScript strict mode | Type safety across all files |
| Styling | Tailwind CSS | Utility classes, SPACED-inspired light/dark colour tokens |
| Note editor | Tiptap 3 (ProseMirror) | Rich notes stored as sanitised JSON, never HTML |
| Key derivation | argon2-browser (Argon2id) | Master password → encryption key |
| Encryption | Web Crypto API — AES-256-GCM | Per-entry encryption with authentication |
| Integrity | Web Crypto API — HMAC-SHA256 | Vault-level tamper detection |
| Randomness | crypto.getRandomValues() | Passwords, PINs, IVs |
| Storage | IndexedDB via Dexie.js | Persistent encrypted storage, browser-native |
| Package manager | pnpm | Dependency management |
