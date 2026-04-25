# Regenerating README screenshots

The PNGs in this directory are taken from demo mode. To refresh them
after a UI change, run the demo and capture the listed views in your
browser at the listed viewport.

## Setup

```bash
cd /path/to/synthesis-console
launchctl unload ~/Library/LaunchAgents/org.synthesisengineering.console.plist 2>/dev/null  # if autostart is running
bun run demo  # serves on http://localhost:5555 with the bundled demo data only
```

Window: ~1280 wide, height as needed.

## Views to capture

| Filename | URL | What it shows |
|----------|-----|---------------|
| `dashboard.png` | http://localhost:5555/projects | Project list grouped by status with badges, search, filter toggles |
| `filtered.png` | http://localhost:5555/projects?status=active | Same view filtered to one status |
| `project-detail.png` | http://localhost:5555/projects/demo/synthesis-console-build (or any demo project) | Project detail: metadata sidebar + rendered CONTEXT.md + REFERENCE.md |
| `lessons.png` | http://localhost:5555/lessons | Cross-project lessons, date-sorted |
| `plans-calendar.png` | http://localhost:5555/plans | Calendar with today highlighted; click any dated cell |
| `plan-detail.png` | http://localhost:5555/plans/demo/2026-04-12 | **v0.6 features visible:** mention pills, channel pills, draft action bar (Copy + Open-in-Slack on demo source) |

## Capture commands (macOS)

```bash
# Window selection (interactive — click the browser window):
screencapture -i screenshots/<filename>.png

# Region selection (interactive — drag a region):
screencapture -i -s screenshots/<filename>.png
```

## After capturing

```bash
# Verify PNGs are reasonable size (~50-300 KB each)
ls -lh screenshots/

# Commit
git add screenshots/*.png
git commit -m "Refresh README screenshots for vX.Y UI"
git push
```

## When autostart runs again

```bash
launchctl load ~/Library/LaunchAgents/org.synthesisengineering.console.plist
```
