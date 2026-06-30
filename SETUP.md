# DutyRoster — Setup Guide

This guide is written for non-technical users. Follow it top to bottom. You only
do Steps 1–2 once.

---

## Step 1 — Run the app on your computer

1. Open **PowerShell** (press Start, type "PowerShell", press Enter).
2. Copy-paste this and press Enter:

   ```powershell
   cd C:\Users\legen\duty-scheduler
   npm run dev
   ```

3. Open your web browser and go to **http://localhost:3000**

You should see the DutyRoster welcome page. To stop the app later, click the
PowerShell window and press `Ctrl + C`.

---

## Step 2 — Connect the free database (Supabase)

This is what powers logins and saves your data. It's free and takes ~5 minutes.

### 2a. Create the project

1. Go to **https://supabase.com** and click **Start your project** → sign in
   (the easiest is "Continue with GitHub", or use your email).
2. Click **New project**.
3. Fill in:
   - **Name:** `duty-roster` (anything is fine)
   - **Database Password:** click **Generate a password**, then **copy it
     somewhere safe** (you won't need it day-to-day, but keep it).
   - **Region:** pick the one closest to you.
4. Click **Create new project** and wait ~2 minutes for it to finish setting up.

### 2b. Create the tables

1. In the left sidebar click **SQL Editor**.
2. Click **+ New query**.
3. Open the file `supabase/schema.sql` from this project, copy **everything** in
   it, and paste it into the editor.
4. Click **Run** (bottom right). You should see "Success. No rows returned."

### 2b.5. Turn off email confirmation (for now)

So you can sign up and log in instantly while testing:

1. In the left sidebar click **Authentication** → **Sign In / Providers** (or
   **Providers**) → **Email**.
2. Turn **OFF** "Confirm email" and click **Save**.

(We can turn this back on before going live if you want email verification.)

### 2c. Copy your keys into the app

1. In the left sidebar click **Project Settings** (gear icon) → **API**.
2. You'll see two values:
   - **Project URL** (looks like `https://abcd1234.supabase.co`)
   - **Project API Keys → `anon` `public`** (a long string)
3. Open the file `.env.local` in this project (it's in the
   `C:\Users\legen\duty-scheduler` folder — open it with Notepad).
4. Paste the values so it looks like this (no quotes, no spaces):

   ```
   NEXT_PUBLIC_SUPABASE_URL=https://abcd1234.supabase.co
   NEXT_PUBLIC_SUPABASE_ANON_KEY=eyJhbGciOi...your-long-key...
   ```

5. **Save** the file.

### 2d. Restart the app

1. Go back to the PowerShell window running the app and press `Ctrl + C`.
2. Run `npm run dev` again.
3. Refresh **http://localhost:3000** — the welcome page now shows **Log in** and
   **Get started**. 🎉

---

## How accounts work

- **You (the manager):** click **Get started → I manage a team**. This creates
  your organization and gives you a **6-character join code**.
- **Your staff:** they go to the same site, click **Get started → I'm joining a
  team**, and enter that join code. They're now linked to your organization.

---

## Later steps (we'll set these up when you're ready)

- **Step 6a — Phone notifications:** generate push keys and paste them into
  `.env.local`.
- **Step 6b — Go live on the internet:** deploy to Vercel (free) so your team can
  use it from their phones, not just your computer.

If anything looks different from these steps, tell me what you see and I'll guide
you.
