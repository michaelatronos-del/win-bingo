# Deploying to Render

This guide will help you deploy your Win Bingo application to Render.

## Prerequisites

1. A GitHub account with your code pushed to a repository
2. A Render account (sign up at https://render.com)

## Deployment Steps

### Step 1: Deploy the Backend (Web Service)

1. Go to your Render dashboard: https://dashboard.render.com
2. Click **"New +"** → **"Web Service"**
3. Connect your GitHub repository
4. Configure the service:
   - **Name**: `win-bingo-backend` (or any name you prefer)
   - **Environment**: `Node`
   - **Region**: Choose closest to your users
   - **Branch**: `main` (or your default branch)
   - **Root Directory**: `server`
   - **Build Command**: `npm install`
   - **Start Command**: `npm start`
   - **Plan**: Free (or choose a paid plan)

5. Add Environment Variables:
   - `NODE_ENV` = `production`
   - `PORT` = `10000` (Render will override this automatically, but it's good to set it)

6. Click **"Create Web Service"**

7. **Important**: Copy the service URL (e.g., `https://win-bingo-backend.onrender.com`)

### Step 2: Deploy the Frontend (Static Site)

1. In your Render dashboard, click **"New +"** → **"Static Site"**
2. Connect the same GitHub repository
3. Configure the service:
   - **Name**: `win-bingo-frontend` (or any name you prefer)
   - **Branch**: `main` (or your default branch)
   - **Root Directory**: `client`
   - **Build Command**: `npm install && npm run build`
   - **Publish Directory**: `dist`
   - **Plan**: Free (or choose a paid plan)

4. Add Environment Variables:
   - `NODE_ENV` = `production`
   - `VITE_API_URL` = Your backend URL (e.g., `https://win-bingo-backend.onrender.com`)
   
   **Important**: Set `VITE_API_URL` to your backend service URL so the frontend can connect to it.

5. Click **"Create Static Site"**

6. **Important**: Copy the frontend URL (e.g., `https://win-bingo-frontend.onrender.com`)

**Note**: The frontend code has been updated to automatically use the `VITE_API_URL` environment variable if set, otherwise it will use `window.location.origin` in production. Make sure to set `VITE_API_URL` to your backend URL in Step 2.

### Step 3: Configure CORS (if needed)

Your server already has CORS enabled with `cors()` middleware, which should work. If you encounter CORS issues:

1. Update `server/src/index.js` to allow your frontend domain:
   ```javascript
   app.use(cors({
     origin: process.env.FRONTEND_URL || '*',
     credentials: true
   }));
   ```

2. Add `FRONTEND_URL` environment variable in Render backend settings.

## Alternative: Using render.yaml (Partial)

**Note**: Render's `render.yaml` doesn't support static sites. The included `render.yaml` will only deploy the backend.

1. In Render dashboard, click **"New +"** → **"Blueprint"**
2. Connect your GitHub repository
3. Render will automatically detect `render.yaml` and create the backend service
4. Review and apply the configuration
5. **Then manually deploy the frontend** following Step 2 above (Static Site deployment)

## Notes

- **Free Tier**: Render's free tier spins down after 15 minutes of inactivity. The first request after spin-down may take 30-60 seconds.
- **Socket.io**: Make sure your Socket.io server is configured to work with Render's reverse proxy.
- **Environment Variables**: Keep sensitive data in Render's environment variables, not in code.

## Troubleshooting

### Backend won't start
- Check the build logs in Render dashboard
- Ensure `server/package.json` has a `start` script
- Verify Node.js version compatibility

### Frontend can't connect to backend
- Check CORS settings
- Verify backend URL is correct
- Check browser console for errors

### Socket.io connection issues
- Ensure Socket.io is configured for production
- Check that the backend URL is accessible
- Verify WebSocket support on Render

## Support

For Render-specific issues, check:
- Render Documentation: https://render.com/docs
- Render Community: https://community.render.com

