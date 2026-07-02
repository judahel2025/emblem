// Veyra desktop entry point (Windows/macOS/Linux).
// Spawns the local Python backend before handing off to lib::run().
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::process::{Child, Command};
use std::sync::Mutex;
use std::time::{Duration, Instant};
use tauri::{Manager, WindowEvent};

const BACKEND_PORT: u16 = 8788;
const HEALTH_URL: &str = "http://127.0.0.1:8788/api/health";
const STARTUP_TIMEOUT_SECS: u64 = 30;

struct Backend(Mutex<Option<Child>>);

fn veyra_root() -> String {
    std::env::var("VEYRA_BASE").unwrap_or_else(|_| r"C:\VEYRA".to_string())
}

fn spawn_backend() -> Option<Child> {
    let root = veyra_root();
    let python = format!(r"{root}\.venv\Scripts\python.exe");
    let backend_dir = format!(r"{root}\backend");
    let port = BACKEND_PORT.to_string();

    let mut cmd = Command::new(&python);
    cmd.args(["-m", "uvicorn", "veyra.api.app:app", "--host", "0.0.0.0", "--port", &port])
        .current_dir(&backend_dir)
        .env("PYTHONPATH", &backend_dir)
        .env("VEYRA_BASE", &root);

    #[cfg(all(windows, not(debug_assertions)))]
    {
        use std::os::windows::process::CommandExt;
        cmd.creation_flags(0x08000000);
    }

    match cmd.spawn() {
        Ok(c) => { eprintln!("[Veyra] backend spawned (pid {})", c.id()); Some(c) }
        Err(e) => { eprintln!("[Veyra] failed to start backend: {e}"); None }
    }
}

fn wait_for_backend(timeout: Duration) -> bool {
    let start = Instant::now();
    loop {
        if start.elapsed() >= timeout {
            return false;
        }
        match ureq::get(HEALTH_URL).timeout(Duration::from_secs(2)).call() {
            Ok(resp) if resp.status() == 200 => return true,
            _ => {}
        }
        std::thread::sleep(Duration::from_millis(400));
    }
}

fn kill_backend(state: &tauri::State<Backend>) {
    if let Ok(mut guard) = state.0.lock() {
        if let Some(mut child) = guard.take() {
            let _ = child.kill();
            let _ = child.wait();
        }
    }
}

fn main() {
    let child = spawn_backend();
    let ready = wait_for_backend(Duration::from_secs(STARTUP_TIMEOUT_SECS));
    if !ready {
        eprintln!("[Veyra] WARNING: backend may not be running — UI will load anyway");
    }

    tauri::Builder::default()
        .setup(move |app| {
            app.manage(Backend(Mutex::new(child)));
            Ok(())
        })
        .on_window_event(|window, event| {
            if matches!(event, WindowEvent::Destroyed) {
                if let Some(state) = window.app_handle().try_state::<Backend>() {
                    kill_backend(&state);
                }
            }
        })
        .run(tauri::generate_context!())
        .expect("error while running Veyra");
}
