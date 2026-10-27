/// The URL `starci ui` printed, handed to the app at launch: `--url <url>`, `--url=<url>` or `STARCI_UI_URL`.
/// The web side parses it (origin + token); without it the app shows its connect screen.
#[tauri::command]
fn launch_url() -> Option<String> {
    let mut args = std::env::args().skip(1);
    while let Some(arg) = args.next() {
        if let Some(value) = arg.strip_prefix("--url=") {
            return Some(value.to_string());
        }
        if arg == "--url" {
            return args.next();
        }
    }
    std::env::var("STARCI_UI_URL").ok().filter(|value| !value.is_empty())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![launch_url])
        .run(tauri::generate_context!())
        .expect("error while running StarCi Harness");
}
