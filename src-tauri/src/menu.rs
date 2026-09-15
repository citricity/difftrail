//! The application menu.
//!
//! Tauri installs `Menu::default()` on macOS by default when the builder is
//! given no menu of its own, which is why Diff Trail already has a "Diff Trail"
//! menu with About, Services, Hide and Quit, an Edit menu that makes ⌘C work in
//! the diff, and Window and View menus. None of that is ours.
//!
//! What the default has no way to provide is Settings. `PredefinedMenuItem`
//! covers the items whose behaviour the OS owns — about, services, hide, quit,
//! the clipboard, fullscreen — and a settings item is not one of them, because
//! only the app knows what it should open. So this adds a normal menu item to
//! the menu that is already there, and relays the click to the webview as an
//! event.
//!
//! The item says "Settings…", not "Preferences…": macOS 13 renamed it in the
//! Human Interface Guidelines and the system apps followed.
//!
//! Non-macOS platforms get no default menu from Tauri at all, so this does
//! nothing there and the toolbar button is the way in.

use tauri::Runtime;

/// Identifies the item in `MenuEvent`s.
pub const SETTINGS_ID: &str = "settings";

/// Emitted to the webview when the item is chosen.
pub const SETTINGS_EVENT: &str = "settings-requested";

#[cfg(target_os = "macos")]
pub fn install_settings<R: Runtime>(app: &tauri::AppHandle<R>) -> tauri::Result<()> {
    use tauri::menu::{MenuItem, MenuItemKind, PredefinedMenuItem};
    use tauri::Manager;

    // The first submenu is the application menu on macOS. If there is no menu
    // at all — a default Tauri stopped applying, say — there is nothing to add
    // to, and the toolbar button still works.
    let Some(menu) = app.menu() else {
        return Ok(());
    };

    let Some(MenuItemKind::Submenu(application)) = menu.items()?.into_iter().next() else {
        return Ok(());
    };

    let settings =
        MenuItem::with_id(app, SETTINGS_ID, "Settings…", true, Some("CmdOrCtrl+,"))?;

    // Index 2 is immediately after About and its separator, which is where
    // macOS puts this and where the muscle memory expects it. The separator
    // after it keeps Services in its own group.
    application.insert_items(&[&settings, &PredefinedMenuItem::separator(app)?], 2)?;

    Ok(())
}

#[cfg(not(target_os = "macos"))]
pub fn install_settings<R: Runtime>(_app: &tauri::AppHandle<R>) -> tauri::Result<()> {
    Ok(())
}
