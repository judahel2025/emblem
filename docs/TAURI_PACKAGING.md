# Veyra — Desktop packaging (Tauri) — Phase F

This is the FINAL step: wrap the finished app as a native Windows desktop app (Mica window,
system tray, autostart, always-on "Hey Veyra"). Do this once features are stable, so you
don't repackage after every change.

## Prerequisites (one-time)
Tauri needs the Rust toolchain (not yet installed on this machine):

```powershell
winget install Rustlang.Rustup        # or https://rustup.rs
rustup default stable
winget install Microsoft.VisualStudio.2022.BuildTools   # MSVC build tools (C++)
# WebView2 is already on Windows 11
```

## Add Tauri to the frontend

```powershell
cd C:\VEYRA\frontend
npm install -D @tauri-apps/cli
npx tauri init `
  --app-name Veyra `
  --window-title "Veyra" `
  --frontend-dist ../frontend/dist `
  --dev-url http://127.0.0.1:8788
```

## Make the Python backend a sidecar
Veyra's brain is the FastAPI server. Bundle it so the desktop app starts it automatically:

1. Build a single-file backend exe (one-time, in the venv):
   ```powershell
   C:\VEYRA\.venv\Scripts\python.exe -m pip install pyinstaller
   C:\VEYRA\.venv\Scripts\pyinstaller --onefile --name veyra-core backend\server.py
   ```
2. Copy `dist\veyra-core.exe` into `frontend\src-tauri\binaries\veyra-core-x86_64-pc-windows-msvc.exe`.
3. In `src-tauri/tauri.conf.json` add it under `bundle.externalBin`, and spawn it on startup
   from `src-tauri/src/main.rs` (Command::new_sidecar("veyra-core").spawn()).

## Window styling (Mica / native feel)
In `tauri.conf.json` → `app.windows[0]`: set `"decorations": true`, `"transparent": false`,
and enable Mica via the `window-vibrancy` crate in `main.rs` (`apply_mica(&window)`).

## Build the installer

```powershell
cd C:\VEYRA\frontend
npm run build          # build the UI
npx tauri build        # produces an .msi / .exe installer in src-tauri/target/release/bundle
```

## Tray + autostart (optional)
- Tray: `tauri-plugin-system-tray` (or the built-in tray API in Tauri v2).
- Autostart: `tauri-plugin-autostart`.
- Always-on wake word: keep the app running in the tray; the voice bar's wake listener stays active.

## Status
Everything the app does works in the browser at http://127.0.0.1:8788 today. This packaging
step is purely the native shell — run it last, after the feature set is frozen.
