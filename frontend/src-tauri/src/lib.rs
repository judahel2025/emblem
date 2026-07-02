// Veyra mobile entry point (Android/iOS).
// Desktop uses main.rs which calls run() after spawning the local Python backend.
// On mobile there is no local backend — the Svelte frontend connects to the desktop
// engine over the network.

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .run(tauri::generate_context!())
        .expect("error while running Veyra");
}
