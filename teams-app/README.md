# Teams App Manifest

This directory contains the Microsoft Teams app manifest and icons for sideloading the bot.

## Required Files

1. **manifest.json** - The app manifest (already created)
2. **color.png** - Color icon (192x192 pixels)
3. **outline.png** - Outline icon (32x32 pixels)

## Creating Icons

You need to create two PNG icon files:

### color.png (192x192 pixels)
- Full color icon with transparent or white background
- Will be displayed in the Teams app catalog and bot profile

### outline.png (32x32 pixels)
- Monochrome outline icon with transparent background
- Will be displayed in the Teams left navigation bar

### Quick Icon Generation Options:

1. **Use an online icon generator:**
   - Visit https://www.favicon-generator.org/
   - Upload a simple logo or create one
   - Download as PNG and resize to required dimensions

2. **Use GIMP or Photoshop:**
   - Create new images with the required dimensions
   - Add text or simple graphics
   - Export as PNG with transparency

3. **Use a placeholder service:**
   - Color: https://via.placeholder.com/192x192/4285F4/FFFFFF?text=FC
   - Outline: https://via.placeholder.com/32x32/000000/FFFFFF?text=FC

## Before Sideloading

1. Update `manifest.json`:
   - Replace `REPLACE-WITH-YOUR-BOT-APP-ID` with your actual Azure Bot App ID (in 2 places)
   - Update developer information (name, URLs)
   - Update `validDomains` if needed

2. Add icon files:
   - Place `color.png` (192x192) in this directory
   - Place `outline.png` (32x32) in this directory

3. Create app package:
   ```bash
   cd teams-app
   zip -r teams-freshchat-bot.zip manifest.json color.png outline.png
   ```

4. Sideload in Teams:
   - Open Microsoft Teams
   - Go to Apps → Manage your apps → Upload an app
   - Select "Upload a custom app"
   - Choose the `teams-freshchat-bot.zip` file
   - Add to a team or use in personal chat

## Verification

After uploading, verify:
- [ ] Bot appears in Teams app list
- [ ] Can add bot to a team or chat
- [ ] Bot sends welcome message when added
- [ ] Messages are forwarded to Freshchat
- [ ] Agent replies appear in Teams
