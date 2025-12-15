# VAiyu Configuration Guide

## ⚠️ Required: Supabase Configuration

The application **requires** Supabase to function. I've added placeholder values to your `.env` file that need to be replaced with actual credentials.

## Current .env Status

**Location**: `/Users/ajitsingh/Desktop/vaiyu/vaiyu/web/.env`

```bash
VITE_API_URL=http://localhost:4000

# Supabase Configuration (REQUIRED)
VITE_SUPABASE_URL=your_supabase_project_url
VITE_SUPABASE_ANON_KEY=your_supabase_anon_key
```

## How to Get Supabase Credentials

### Option 1: Existing Supabase Project

If you already have a Supabase project for VAiyu:

1. **Go to your Supabase Dashboard**
   - Visit: https://supabase.com/dashboard
   - Login to your account

2. **Select Your Project**
   - Click on your VAiyu project

3. **Get Project URL**
   - Go to: **Settings** → **API**
   - Copy the **Project URL**
   - Example: `https://abcdefghijklm.supabase.co`

4. **Get Anon Key**
   - Same page: **Settings** → **API**
   - Copy the **anon/public** key
   - Example: `eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...`

5. **Update .env File**
   ```bash
   VITE_SUPABASE_URL=https://your-project.supabase.co
   VITE_SUPABASE_ANON_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...
   ```

### Option 2: Create New Supabase Project

If you don't have a Supabase project yet:

1. **Sign Up for Supabase**
   - Visit: https://supabase.com
   - Click "Start your project"
   - Sign up with GitHub or email

2. **Create New Organization**
   - Choose a name for your organization
   - Select free tier (good for development)

3. **Create New Project**
   - **Name**: VAiyu (or your preferred name)
   - **Database Password**: Choose a strong password (save it!)
   - **Region**: Choose closest to your location
   - **Pricing Plan**: Free tier (for development)
   - Click "Create new project"
   - Wait 2-3 minutes for setup

4. **Get Your Credentials**
   - Once created, go to **Settings** → **API**
   - Copy **Project URL** and **anon key**
   - Update your `.env` file

5. **Set Up Database Schema**
   - The VAiyu application expects specific database tables
   - You may need to run SQL migrations
   - Check `vaiyu/api/migrations/` for SQL files

## Required Environment Variables

### Minimal Configuration (Development)

```bash
# API Endpoint (optional - for Fastify API)
VITE_API_URL=http://localhost:4000

# Supabase (REQUIRED)
VITE_SUPABASE_URL=https://your-project.supabase.co
VITE_SUPABASE_ANON_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...
```

### Full Configuration (Optional Features)

Add these for additional features:

```bash
# Feature Flags
VITE_HAS_REVENUE=true
VITE_HAS_HRMS=true
VITE_HAS_CALENDAR=true
VITE_HAS_WORKFORCE=true

# Analytics (optional)
VITE_ANALYTICS_PROVIDER=
VITE_GA4_ID=
VITE_PLAUSIBLE_DOMAIN=
VITE_MIXPANEL_TOKEN=

# Error Tracking (optional)
VITE_SENTRY_DSN=
VITE_SENTRY_TRACES_SAMPLE_RATE=0.15

# Branding (optional)
VITE_BRAND_NAME=VAiyu
VITE_BRAND_PRIMARY=#0F62FE
VITE_BRAND_ACCENT=#00C853
VITE_BRAND_WARNING=#FF3B30
VITE_BRAND_SUCCESS=#34C759
```

## Verify Configuration

After updating `.env`, verify it's correct:

1. **Check File Contents**
   ```bash
   cat /Users/ajitsingh/Desktop/vaiyu/vaiyu/web/.env
   ```

2. **Ensure No Placeholder Text**
   - ✅ Good: `VITE_SUPABASE_URL=https://xyz123.supabase.co`
   - ❌ Bad: `VITE_SUPABASE_URL=your_supabase_project_url`

3. **Restart Dev Server**
   - If server is running, stop it (Ctrl + C)
   - Start again: `npm run dev -- --port 8080 --host`

## Troubleshooting

### Error: "Missing VITE_SUPABASE_URL"

**Problem**: The .env file has placeholder values

**Solution**:
```bash
# Open .env file
nano /Users/ajitsingh/Desktop/vaiyu/vaiyu/web/.env

# Replace placeholders with actual values
VITE_SUPABASE_URL=https://your-actual-project.supabase.co
VITE_SUPABASE_ANON_KEY=your-actual-anon-key

# Save and restart server
```

### Error: "Supabase connection failed"

**Possible Causes**:
1. Invalid Supabase URL
2. Invalid anon key
3. Project not active/deleted
4. Network/firewall issues

**Solution**:
1. Verify credentials in Supabase dashboard
2. Check project is active (not paused)
3. Try accessing Supabase URL in browser
4. Regenerate keys if needed

### Error: "Table does not exist"

**Problem**: Database schema not set up

**Solution**:
1. Check if migrations need to be run
2. Look in `vaiyu/api/migrations/` for SQL files
3. Run migrations in Supabase SQL Editor:
   - Dashboard → SQL Editor
   - Paste migration SQL
   - Execute

## Database Setup

The application requires these core tables:

- `profiles` - User profiles
- `hotels` - Property information
- `stays` - Guest bookings
- `tickets` - Service requests
- `orders` - Food/service orders
- `chat_threads` - Chat conversations
- `chat_messages` - Messages
- `reviews` - Guest reviews
- `billing` - Bills and invoices

**Check Existing Schema**:
```bash
# In Supabase Dashboard → Table Editor
# Verify these tables exist
```

## Security Notes

### Keep Credentials Secret

1. **Never commit** `.env` to Git
   - Already in `.gitignore`
   - Contains sensitive keys

2. **Use different keys** for production vs. development

3. **Rotate keys regularly** if exposed

4. **Use environment variables** in production (not .env files)

### Anon Key vs. Service Role Key

- **anon key**: Safe for frontend (public)
- **service role key**: Backend only (bypasses RLS)

**For `.env` file**: Use **anon key only**

## Next Steps After Configuration

1. ✅ Update `.env` with real Supabase credentials
2. ✅ Upgrade Node.js to 18.17+ (see HOW_TO_RUN.md)
3. ✅ Install dependencies: `npm install`
4. ✅ Run application: `npm run dev -- --port 8080 --host`
5. ✅ Verify database connection in browser console

## Quick Setup Checklist

```bash
# 1. Get Supabase credentials from dashboard
# 2. Update .env file
cd /Users/ajitsingh/Desktop/vaiyu/vaiyu/web
nano .env  # or use any text editor

# 3. Verify configuration
cat .env

# 4. Restart application
npm run dev -- --port 8080 --host
```

## Example Valid Configuration

```bash
VITE_API_URL=http://localhost:4000

# Real Supabase project
VITE_SUPABASE_URL=https://abcdefghijklmnop.supabase.co
VITE_SUPABASE_ANON_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImFiY2RlZmdoaWprbG1ub3AiLCJyb2xlIjoiYW5vbiIsImlhdCI6MTYzMjg1NTM2NSwiZXhwIjoxOTQ4NDMxMzY1fQ.example_signature

# Optional feature flags
VITE_HAS_REVENUE=true
VITE_HAS_HRMS=true
```

## Getting Help

If you need assistance:

1. **Check Supabase Status**: https://status.supabase.com
2. **Supabase Docs**: https://supabase.com/docs
3. **VAiyu Documentation**: See `memory-bank/` directory

---

**Created**: December 14, 2025  
**Last Updated**: December 14, 2025  
**Project**: VAiyu Hotel Management Platform
