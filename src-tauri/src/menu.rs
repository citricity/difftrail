//! The application menu.
//!
//! Tauri installs `Menu::default()` on macOS by default when the builder is
//! given no menu of its own, which is why Diff Trek already has a "Diff Trek"
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

/// The item that installs the `git dt` alias, and the event it sends. Like
/// Settings, what it opens — a confirmation — belongs to the webview.
pub const GIT_ALIAS_ID: &str = "install-git-alias";
pub const GIT_ALIAS_EVENT: &str = "git-alias-requested";

/// The View items that scale the interface, and the event carrying the choice
/// to the webview.
///
/// What crosses is a direction, not a size: the ladder of zoom levels and the
/// preference recording where on it the reader is both belong to the frontend,
/// and the shell only knows that an item was chosen.
pub const ZOOM_IN_ID: &str = "zoom-in";
pub const ZOOM_OUT_ID: &str = "zoom-out";
pub const ZOOM_RESET_ID: &str = "zoom-reset";
pub const ZOOM_EVENT: &str = "zoom-requested";

/// Which way a menu item moves the zoom, as the webview names it — or `None`
/// for an item that is not one of them.
pub fn zoom_direction(id: &tauri::menu::MenuId) -> Option<&'static str> {
    if id == ZOOM_IN_ID {
        Some("in")
    } else if id == ZOOM_OUT_ID {
        Some("out")
    } else if id == ZOOM_RESET_ID {
        Some("reset")
    } else {
        None
    }
}

#[cfg(target_os = "macos")]
pub fn install_app_items<R: Runtime>(app: &tauri::AppHandle<R>) -> tauri::Result<()> {
    // `menu()` is inherent on `AppHandle`, not a `Manager` method, so no trait
    // needs importing here — unlike `commands.rs`, which uses `Manager::path`.
    use tauri::menu::{MenuItem, MenuItemKind, PredefinedMenuItem};

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

    // No shortcut: installing a command is a once-ever action.
    let git_alias = MenuItem::with_id(
        app,
        GIT_ALIAS_ID,
        "Install \u{2018}git dt\u{2019} Command…",
        true,
        None::<&str>,
    )?;

    // Index 2 is immediately after About and its separator, which is where
    // macOS puts Settings and where the muscle memory expects it. The command
    // item follows it in the same group, as VS Code's "Install 'code' command"
    // sits with its app-level items. The separator after them keeps Services
    // in its own group.
    application.insert_items(
        &[&settings, &git_alias, &PredefinedMenuItem::separator(app)?],
        2,
    )?;

    install_view_items(app)
}

/// Zoom In, Zoom Out and Actual Size, in the View menu the default already
/// provides — above Fullscreen, which is where a browser puts them.
///
/// None of this is what makes the keystrokes work: the webview handles them
/// itself, which is the only way they can work on the platforms that get no
/// menu at all, and the only way ⌘⇧+ can work anywhere, since a menu key
/// equivalent matches one keystroke and that is a different one. The items are
/// here so the commands can be found without knowing them, and so macOS shows
/// the shortcut beside the name.
#[cfg(target_os = "macos")]
fn install_view_items<R: Runtime>(app: &tauri::AppHandle<R>) -> tauri::Result<()> {
    use tauri::menu::{MenuItemKind, PredefinedMenuItem};

    let Some(menu) = app.menu() else {
        return Ok(());
    };

    // Found by name: the default menu is Tauri's, and its View submenu is not
    // at an index worth relying on. If it is ever not there at all, the
    // keystrokes still work and there is simply nowhere to put the items.
    let view = menu.items()?.into_iter().find_map(|item| match item {
        MenuItemKind::Submenu(submenu) => match submenu.text() {
            Ok(text) if text == "View" => Some(submenu),
            _ => None,
        },
        _ => None,
    });

    let Some(view) = view else {
        return Ok(());
    };

    // ⌘= rather than ⌘+, because = is the key actually under the finger:
    // shifting it is what makes a +, and the webview picks that up itself.
    let zoom_in = zoom_item(app, ZOOM_IN_ID, "Zoom In", "CmdOrCtrl+Equal")?;
    let zoom_out = zoom_item(app, ZOOM_OUT_ID, "Zoom Out", "CmdOrCtrl+Minus")?;
    let actual_size = zoom_item(app, ZOOM_RESET_ID, "Actual Size", "CmdOrCtrl+Digit0")?;

    // At the top, above Fullscreen, with a separator under them: the grouping
    // a browser's View menu has.
    view.insert_items(
        &[
            &zoom_in,
            &zoom_out,
            &actual_size,
            &PredefinedMenuItem::separator(app)?,
        ],
        0,
    )?;

    Ok(())
}

/// A zoom item, preferring its accelerator but not insisting on it.
///
/// An accelerator is a string parsed at runtime, and one the menu library will
/// not parse must not be what stops Diff Trek starting: without it the item
/// still works from the menu, and the webview still sees the keystroke.
#[cfg(target_os = "macos")]
fn zoom_item<R: Runtime>(
    app: &tauri::AppHandle<R>,
    id: &str,
    text: &str,
    accelerator: &str,
) -> tauri::Result<tauri::menu::MenuItem<R>> {
    use tauri::menu::MenuItem;

    match MenuItem::with_id(app, id, text, true, Some(accelerator)) {
        Ok(item) => Ok(item),
        Err(err) => {
            eprintln!("[difftrek] ignoring unusable accelerator {accelerator}: {err}");
            MenuItem::with_id(app, id, text, true, None::<&str>)
        }
    }
}

#[cfg(not(target_os = "macos"))]
pub fn install_app_items<R: Runtime>(_app: &tauri::AppHandle<R>) -> tauri::Result<()> {
    Ok(())
}
