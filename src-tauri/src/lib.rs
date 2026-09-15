pub mod commands;
pub mod error;
pub mod git;
pub mod launch;
pub mod state;

use state::AppState;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .manage(AppState::default())
        .invoke_handler(tauri::generate_handler![
            commands::get_repository_info,
            commands::get_changed_files,
            commands::get_file_diff,
            commands::get_file_contents,
        ])
        .run(tauri::generate_context!())
        .expect("error while running Diff Trail");
}
