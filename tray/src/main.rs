#![cfg_attr(target_os = "windows", windows_subsystem = "windows")]

#[cfg(not(target_os = "windows"))]
fn main() {}

#[cfg(target_os = "windows")]
mod windows_app {
    use if_addrs::get_if_addrs;
    use serde_json::Value;
    use std::{
        fs::OpenOptions,
        io::{Read, Write},
        net::{IpAddr, SocketAddr, TcpStream},
        path::Path,
        sync::{
            Arc,
            atomic::{AtomicBool, Ordering},
            mpsc,
        },
        thread,
        time::Duration,
    };
    use tray_icon::{
        Icon, TrayIcon, TrayIconBuilder,
        menu::{Menu, MenuEvent, MenuItem, PredefinedMenuItem},
    };
    use windows_sys::Win32::{
        Foundation::{CloseHandle, ERROR_ALREADY_EXISTS, GetLastError, HANDLE},
        System::Threading::{CreateMutexW, GetCurrentThreadId},
        UI::WindowsAndMessaging::{
            DispatchMessageW, GetMessageW, MSG, PM_NOREMOVE, PeekMessageW, PostThreadMessageW,
            TranslateMessage, WM_APP,
        },
    };

    const GAME_URL: &str = "https://d1.lunarlab.uk";
    const SERVER_ROOT: &str = r"D:\server";
    const LOG_ROOT: &str = r"D:\server\logs";
    const CORE_PORT: u16 = 28727;
    const EDGE_PORT: u16 = 28729;
    const POLL_INTERVAL: Duration = Duration::from_secs(5);
    const HTTP_TIMEOUT: Duration = Duration::from_millis(900);
    const WAKE_MESSAGE: u32 = WM_APP + 73;

    struct SingleInstance(HANDLE);

    impl SingleInstance {
        fn acquire() -> Option<Self> {
            let name = wide(r"Local\DTAM-V3-Tray");
            let handle = unsafe { CreateMutexW(std::ptr::null(), 1, name.as_ptr()) };
            if handle.is_null() {
                return None;
            }
            if unsafe { GetLastError() } == ERROR_ALREADY_EXISTS {
                unsafe {
                    CloseHandle(handle);
                }
                return None;
            }
            Some(Self(handle))
        }
    }

    impl Drop for SingleInstance {
        fn drop(&mut self) {
            unsafe {
                CloseHandle(self.0);
            }
        }
    }

    #[derive(Clone, Debug, Default)]
    struct Snapshot {
        core_ok: bool,
        edge_ok: bool,
        node: String,
        active_sessions: u64,
        network: String,
    }

    struct TrayUi {
        _tray: TrayIcon,
        status: MenuItem,
        network: MenuItem,
        open_game: MenuItem,
        open_server: MenuItem,
        open_logs: MenuItem,
        refresh: MenuItem,
        exit: MenuItem,
    }

    pub fn run() -> Result<(), String> {
        let Some(_instance) = SingleInstance::acquire() else {
            return Ok(());
        };

        let thread_id = unsafe { GetCurrentThreadId() };
        let mut bootstrap_msg = unsafe { std::mem::zeroed::<MSG>() };
        unsafe {
            PeekMessageW(&mut bootstrap_msg, std::ptr::null_mut(), 0, 0, PM_NOREMOVE);
        }

        let (menu_tx, menu_rx) = mpsc::channel::<MenuEvent>();
        MenuEvent::set_event_handler(Some(move |event| {
            let _ = menu_tx.send(event);
            unsafe {
                PostThreadMessageW(thread_id, WAKE_MESSAGE, 0, 0);
            }
        }));

        let ui = build_tray()?;
        let (snapshot_tx, snapshot_rx) = mpsc::channel::<Snapshot>();
        let (refresh_tx, refresh_rx) = mpsc::channel::<()>();
        let stop = Arc::new(AtomicBool::new(false));
        let worker_stop = Arc::clone(&stop);
        let worker = thread::spawn(move || {
            while !worker_stop.load(Ordering::Relaxed) {
                let snapshot = collect_snapshot();
                if snapshot_tx.send(snapshot).is_err() {
                    break;
                }
                unsafe {
                    PostThreadMessageW(thread_id, WAKE_MESSAGE, 0, 0);
                }

                match refresh_rx.recv_timeout(POLL_INTERVAL) {
                    Ok(()) | Err(mpsc::RecvTimeoutError::Timeout) => {}
                    Err(mpsc::RecvTimeoutError::Disconnected) => break,
                }
            }
        });

        let _ = refresh_tx.send(());
        let mut running = true;
        let mut msg = unsafe { std::mem::zeroed::<MSG>() };
        while running {
            let result = unsafe { GetMessageW(&mut msg, std::ptr::null_mut(), 0, 0) };
            if result <= 0 {
                break;
            }

            if msg.message == WAKE_MESSAGE {
                while let Ok(snapshot) = snapshot_rx.try_recv() {
                    apply_snapshot(&ui, snapshot);
                }
                while let Ok(event) = menu_rx.try_recv() {
                    if event.id == ui.open_game.id() {
                        open_target(GAME_URL);
                    } else if event.id == ui.open_server.id() {
                        open_target(SERVER_ROOT);
                    } else if event.id == ui.open_logs.id() {
                        open_target(LOG_ROOT);
                    } else if event.id == ui.refresh.id() {
                        let _ = refresh_tx.send(());
                    } else if event.id == ui.exit.id() {
                        running = false;
                    }
                }
                continue;
            }

            unsafe {
                TranslateMessage(&msg);
                DispatchMessageW(&msg);
            }

            while let Ok(event) = menu_rx.try_recv() {
                if event.id == ui.open_game.id() {
                    open_target(GAME_URL);
                } else if event.id == ui.open_server.id() {
                    open_target(SERVER_ROOT);
                } else if event.id == ui.open_logs.id() {
                    open_target(LOG_ROOT);
                } else if event.id == ui.refresh.id() {
                    let _ = refresh_tx.send(());
                } else if event.id == ui.exit.id() {
                    running = false;
                }
            }
        }

        stop.store(true, Ordering::Relaxed);
        let _ = refresh_tx.send(());
        let _ = worker.join();
        MenuEvent::set_event_handler(None);
        Ok(())
    }

    fn build_tray() -> Result<TrayUi, String> {
        let menu = Menu::new();
        let status = MenuItem::with_id("status", "正在读取服务状态...", false, None);
        let network = MenuItem::with_id("network", "IPv4/IPv6: 正在读取...", false, None);
        let open_game = MenuItem::with_id("open-game", "打开游戏", true, None);
        let open_server = MenuItem::with_id("open-server", r"打开 D:\server", true, None);
        let open_logs = MenuItem::with_id("open-logs", "打开日志目录", true, None);
        let refresh = MenuItem::with_id("refresh", "立即刷新", true, None);
        let exit = MenuItem::with_id("exit", "退出托盘（不停止服务）", true, None);
        let separator_a = PredefinedMenuItem::separator();
        let separator_b = PredefinedMenuItem::separator();

        for item in [
            &status as &dyn tray_icon::menu::IsMenuItem,
            &network,
            &separator_a,
            &open_game,
            &open_server,
            &open_logs,
            &refresh,
            &separator_b,
            &exit,
        ] {
            menu.append(item).map_err(|error| error.to_string())?;
        }

        let tray = TrayIconBuilder::new()
            .with_menu(Box::new(menu))
            .with_icon(make_icon()?)
            .with_tooltip("DTAM v3 · 正在读取状态")
            .with_menu_on_left_click(true)
            .with_menu_on_right_click(true)
            .build()
            .map_err(|error| error.to_string())?;

        Ok(TrayUi {
            _tray: tray,
            status,
            network,
            open_game,
            open_server,
            open_logs,
            refresh,
            exit,
        })
    }

    fn apply_snapshot(ui: &TrayUi, snapshot: Snapshot) {
        let node = if snapshot.node.is_empty() {
            "shanghai-a"
        } else {
            snapshot.node.as_str()
        };
        let (status, tooltip) = match (snapshot.core_ok, snapshot.edge_ok) {
            (true, true) => (
                format!(
                    "Core 在线 · Edge {node} 在线 · {} 条会话",
                    snapshot.active_sessions
                ),
                format!("DTAM v3 · 在线 · {} 会话", snapshot.active_sessions),
            ),
            (true, false) => (
                "Core 在线 · Edge 离线（v2.8 Tunnel 仍可用）".to_string(),
                "DTAM v3 · Edge 离线".to_string(),
            ),
            (false, true) => (
                "Core 离线 · Edge 在线但无法提供游戏".to_string(),
                "DTAM v3 · Core 离线".to_string(),
            ),
            (false, false) => (
                "Core 离线 · Edge 离线".to_string(),
                "DTAM v3 · 服务离线".to_string(),
            ),
        };
        ui.status.set_text(status);
        ui.network.set_text(snapshot.network);
        let _ = ui._tray.set_tooltip(Some(tooltip));
    }

    fn collect_snapshot() -> Snapshot {
        let core = health_json(CORE_PORT);
        let edge = health_json(EDGE_PORT);
        Snapshot {
            core_ok: core
                .as_ref()
                .and_then(|value| value.get("ok"))
                .and_then(Value::as_bool)
                .unwrap_or(false),
            edge_ok: edge
                .as_ref()
                .and_then(|value| value.get("ok"))
                .and_then(Value::as_bool)
                .unwrap_or(false),
            node: edge
                .as_ref()
                .and_then(|value| value.get("nodeId"))
                .and_then(Value::as_str)
                .unwrap_or_default()
                .to_string(),
            active_sessions: edge
                .as_ref()
                .and_then(|value| value.get("activeSessions"))
                .and_then(Value::as_u64)
                .unwrap_or(0),
            network: network_text(),
        }
    }

    fn health_json(port: u16) -> Option<Value> {
        let address = SocketAddr::from(([127, 0, 0, 1], port));
        let mut stream = TcpStream::connect_timeout(&address, HTTP_TIMEOUT).ok()?;
        stream.set_read_timeout(Some(HTTP_TIMEOUT)).ok()?;
        stream.set_write_timeout(Some(HTTP_TIMEOUT)).ok()?;
        stream
            .write_all(
                b"GET /health HTTP/1.1\r\nHost: 127.0.0.1\r\nConnection: close\r\nAccept: application/json\r\n\r\n",
            )
            .ok()?;

        let mut response = String::new();
        stream.take(64 * 1024).read_to_string(&mut response).ok()?;
        let (headers, body) = response.split_once("\r\n\r\n")?;
        let status = headers.lines().next()?;
        if !status.contains(" 200 ") {
            return None;
        }
        serde_json::from_str(body).ok()
    }

    fn network_text() -> String {
        let mut v4 = Vec::new();
        let mut v6 = Vec::new();
        if let Ok(interfaces) = get_if_addrs() {
            for interface in interfaces {
                if !interface.is_oper_up() {
                    continue;
                }
                match interface.ip() {
                    IpAddr::V4(ip) if ip.is_private() && !ip.is_loopback() => {
                        if !v4.contains(&ip) {
                            v4.push(ip);
                        }
                    }
                    IpAddr::V6(ip)
                        if !ip.is_loopback()
                            && !ip.is_unspecified()
                            && !ip.is_multicast()
                            && !ip.is_unicast_link_local() =>
                    {
                        if !v6.contains(&ip) {
                            v6.push(ip);
                        }
                    }
                    _ => {}
                }
            }
        }
        v4.sort_unstable();
        v6.sort_unstable();
        let v4_text = if v4.is_empty() {
            "无私网 IPv4".to_string()
        } else {
            v4.into_iter()
                .take(3)
                .map(|ip| ip.to_string())
                .collect::<Vec<_>>()
                .join(", ")
        };
        let v6_text = if v6.is_empty() {
            "无可用 IPv6".to_string()
        } else {
            v6.into_iter()
                .take(3)
                .map(|ip| ip.to_string())
                .collect::<Vec<_>>()
                .join(", ")
        };
        format!("IPv4: {v4_text} · IPv6: {v6_text}")
    }

    fn open_target(target: &str) {
        let _ = std::process::Command::new("explorer.exe")
            .arg(target)
            .spawn();
    }

    fn make_icon() -> Result<Icon, String> {
        const SIZE: u32 = 32;
        let mut rgba = vec![0u8; (SIZE * SIZE * 4) as usize];
        for y in 0..SIZE {
            for x in 0..SIZE {
                let dx = x as i32 - 16;
                let dy = y as i32 - 16;
                if dx * dx + dy * dy > 14 * 14 {
                    continue;
                }
                let offset = ((y * SIZE + x) * 4) as usize;
                rgba[offset] = 52;
                rgba[offset + 1] = 211;
                rgba[offset + 2] = 153;
                rgba[offset + 3] = 255;
                if (9..=22).contains(&x) && (8..=11).contains(&y) {
                    rgba[offset] = 255;
                    rgba[offset + 1] = 255;
                    rgba[offset + 2] = 255;
                }
                if (14..=17).contains(&x) && (11..=23).contains(&y) {
                    rgba[offset] = 255;
                    rgba[offset + 1] = 255;
                    rgba[offset + 2] = 255;
                }
            }
        }
        Icon::from_rgba(rgba, SIZE, SIZE).map_err(|error| error.to_string())
    }

    fn wide(value: &str) -> Vec<u16> {
        value.encode_utf16().chain(std::iter::once(0)).collect()
    }

    pub fn log_error(error: &str) {
        let path = Path::new(LOG_ROOT).join("dtam-tray.log");
        if let Ok(mut file) = OpenOptions::new().create(true).append(true).open(path) {
            let _ = writeln!(file, "{error}");
        }
    }
}

#[cfg(target_os = "windows")]
fn main() {
    if let Err(error) = windows_app::run() {
        windows_app::log_error(&error);
    }
}
