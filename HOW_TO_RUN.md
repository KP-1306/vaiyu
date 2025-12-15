# How to Run VAiyu Web Application

## ⚠️ Important: Node.js Version Requirement

**Current Issue**: Your system has Node.js v14.16.1, but VAiyu requires **Node.js >= 18.17**

## Prerequisites

### Required Software
- **Node.js**: Version 18.17 or higher (20.x recommended)
- **npm**: Version 8 or higher (comes with Node.js)
- **Git**: For version control

## Step 1: Upgrade Node.js

You have several options to upgrade Node.js on macOS:

### Option A: Using Official Installer (Recommended)
1. Visit [nodejs.org](https://nodejs.org/)
2. Download the **LTS version** (Long Term Support)
3. Run the installer and follow instructions
4. Verify installation:
   ```bash
   node --version  # Should show v20.x.x or v18.x.x
   npm --version   # Should show 9.x.x or higher
   ```

### Option B: Using Homebrew
```bash
# Install or update Homebrew
/bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"

# Install Node.js
brew install node@20

# Link it
brew link node@20

# Verify
node --version
```

### Option C: Using nvm (Node Version Manager)
```bash
# Install nvm
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.39.0/install.sh | bash

# Reload shell configuration
source ~/.zshrc  # or source ~/.bash_profile

# Install Node.js 20
nvm install 20
nvm use 20
nvm alias default 20

# Verify
node --version
```

## Step 2: Install Dependencies

Once you have Node.js >= 18.17 installed:

```bash
# Navigate to the web directory
cd /Users/ajitsingh/Desktop/vaiyu/vaiyu/web

# Install dependencies
npm install
```

## Step 3: Run the Application

### Start Development Server on Port 8080

```bash
# From the vaiyu/web directory
npm run dev -- --port 8080 --host
```

**What this does:**
- `npm run dev`: Starts the Vite development server
- `--port 8080`: Runs on port 8080 (default is 5173)
- `--host`: Makes server accessible from network (0.0.0.0)

### Expected Output

When successful, you should see:

```
VITE v5.4.x ready in xxx ms

➜  Local:   http://localhost:8080/
➜  Network: http://192.168.x.x:8080/
➜  press h + enter to show help
```

## Step 4: Access the Application

Open your browser and go to:
- **Local**: http://localhost:8080
- **Network**: http://your-ip-address:8080

## How to Stop the Server

### Method 1: Terminal Interrupt
Press `Ctrl + C` in the terminal where the server is running

### Method 2: Kill Process by Port
```bash
# Find the process using port 8080
lsof -ti:8080

# Kill it (replace PID with actual process ID)
kill -9 $(lsof -ti:8080)
```

### Method 3: Kill all node processes (use with caution)
```bash
killall node
```

## Troubleshooting

### Port Already in Use
If port 8080 is already in use:

```bash
# Check what's using port 8080
lsof -i :8080

# Kill the process
kill -9 <PID>

# Or use a different port
npm run dev -- --port 3000 --host
```

### Permission Errors
```bash
# Clear npm cache
npm cache clean --force

# Remove node_modules and reinstall
rm -rf node_modules package-lock.json
npm install
```

### Module Not Found Errors
```bash
# Ensure you're in the correct directory
cd /Users/ajitsingh/Desktop/vaiyu/vaiyu/web

# Reinstall dependencies
npm install
```

### Supabase Connection Issues
The app requires Supabase configuration. Check your `.env` file:

```bash
# File: vaiyu/web/.env
VITE_API_URL=http://localhost:4000
VITE_SUPABASE_URL=your_supabase_url
VITE_SUPABASE_ANON_KEY=your_anon_key
```

If missing, copy from the example:
```bash
cp .env.local.example .env
# Then edit .env with your actual values
```

## Quick Reference Commands

```bash
# Start on default port (5173)
npm run dev

# Start on port 8080
npm run dev -- --port 8080 --host

# Build for production
npm run build

# Preview production build
npm run preview

# Type check
npm run typecheck

# Stop server
Ctrl + C
```

## Common Issues After Node.js Upgrade

### 1. npm outdated
```bash
# Update npm to latest
npm install -g npm@latest
```

### 2. Dependencies need rebuild
```bash
# Remove and reinstall
rm -rf node_modules package-lock.json
npm install
```

### 3. Multiple Node versions
```bash
# Check which node is being used
which node

# If using nvm, ensure correct version
nvm use 20
```

## Development Workflow

1. **Start the server**: `npm run dev -- --port 8080 --host`
2. **Make changes**: Edit files in `src/`
3. **Auto-reload**: Vite automatically reloads on file changes
4. **Check console**: Browser DevTools for errors
5. **Stop server**: `Ctrl + C` when done

## Next Steps

Once the application is running:

1. **Guest Dashboard**: http://localhost:8080/guest
2. **Owner Console**: http://localhost:8080/owner
3. **Staff Ops Board**: http://localhost:8080/ops
4. **Marketing Page**: http://localhost:8080/

## Environment Configuration

### Feature Flags
Edit `.env` to enable/disable features:

```bash
VITE_HAS_REVENUE=true       # Revenue analytics
VITE_HAS_HRMS=true          # HR management
VITE_HAS_CALENDAR=true      # Bookings calendar
VITE_HAS_WORKFORCE=true     # Workforce hiring
```

### API Configuration
```bash
VITE_API_URL=http://localhost:4000  # Fastify API (optional)
```

## Getting Help

If you encounter issues:

1. Check Node.js version: `node --version` (must be >= 18.17)
2. Check npm version: `npm --version` (must be >= 8)
3. Check terminal for error messages
4. Check browser console (F12) for frontend errors
5. Review `memory-bank/techContext.md` for detailed tech info

## Server Resource Usage

The development server typically uses:
- **Memory**: 200-500 MB
- **CPU**: 10-30% (during file changes)
- **Port**: 8080 (or specified port)

## Production Deployment

For production deployment (not local development):

```bash
# Build the application
npm run build

# Output will be in: vaiyu/web/dist/

# Deploy to Netlify, Vercel, or any static host
```

---

**Last Updated**: December 14, 2025  
**Project**: VAiyu Hotel Management Platform  
**Repository**: /Users/ajitsingh/Desktop/vaiyu
