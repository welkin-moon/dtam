use axum::{
    body::Bytes,
    extract::{
        ws::{CloseFrame, Message, WebSocket, WebSocketUpgrade},
        DefaultBodyLimit, Query, State,
    },
    http::{HeaderMap, HeaderValue, Method, StatusCode},
    response::{IntoResponse, Response},
    routing::{any, get},
    Json, Router,
};
use futures_util::{SinkExt, StreamExt};
use rand::{seq::SliceRandom, Rng};
use reqwest::Client;
use serde::{Deserialize, Serialize};
use serde_json::{json, Map, Value};
use std::{
    collections::{HashMap, HashSet},
    fs,
    io::Write,
    net::SocketAddr,
    path::{Path, PathBuf},
    sync::{
        atomic::{AtomicUsize, Ordering},
        Arc, Mutex as StdMutex, OnceLock,
    },
    time::{Duration, Instant, SystemTime, UNIX_EPOCH},
};
use tokio::sync::{mpsc, Mutex, RwLock};
use uuid::Uuid;

const MAX_PLAYERS: usize = 15;
const MIN_PLAYERS: usize = 2;
const MAP_SIZE: i32 = 150;
const MAP_PROTOCOL_ID: &str = "dtam-map-150-v1";
const PLAYER_RADIUS: f64 = 0.32;
const RECONNECT_GRACE_MS: i64 = 180_000;
const SHAPESHIFT_DURATION_MS: i64 = 12_000;
const PHANTOM_DURATION_MS: i64 = 8_000;
const VIPER_DISSOLVE_MS: i64 = 12_000;
const ROLE_ABILITY_COOLDOWN_MS: i64 = 30_000;
const TRACK_DURATION_MS: i64 = 20_000;
const SCIENTIST_VIEW_MS: i64 = 9_000;
const DETECTIVE_COOLDOWN_MS: i64 = 18_000;
const GUARDIAN_PROTECT_MS: i64 = 10_000;
const GUARDIAN_COOLDOWN_MS: i64 = 30_000;
const ENGINEER_VENT_MAX_MS: i64 = 8_000;
const ENGINEER_VENT_COOLDOWN_MS: i64 = 20_000;
const START_KILL_COOLDOWN_MS: i64 = 10_000;
const POST_MEETING_KILL_COOLDOWN_MS: i64 = 8_000;
const DOOR_LOCK_MS: i64 = 10_000;
const MAX_AVATAR_CHARS: usize = 5000;
const MAX_WS_MESSAGE_BYTES: usize = 16 * 1024;
const WS_OUTBOX_CAPACITY: usize = 96;
const MAX_CONCURRENT_WS: usize = 256;
const MAX_WS_PER_IP: usize = 32;
const WS_IDLE_TIMEOUT_MS: i64 = 90_000;
const MAX_WS_MESSAGES_PER_SEC: u32 = 60;
const MAX_VOICE_BODY_BYTES: usize = 64 * 1024;
const VOICE_API_CALLS_PER_10S: u32 = 80;
const VOICE_NEW_SESSIONS_PER_MIN: u32 = 12;
const VOICE_GRANT_TTL_MS: i64 = 4 * 60 * 60 * 1000;
const EMERGENCY_STATION: &str = "console-c1";

const COLORS: [&str; 15] = [
    "#ef4444", "#f97316", "#eab308", "#84cc16", "#22c55e", "#10b981", "#14b8a6", "#06b6d4",
    "#3b82f6", "#6366f1", "#8b5cf6", "#a855f7", "#d946ef", "#f43f5e", "#ec4899",
];
const ANIMALS: [&str; 8] = [
    "fox", "blackcat", "graycat", "calico", "creamcat", "rabbit", "redpanda", "shiba",
];
fn normalize_animal(value: &str) -> String {
    if ANIMALS.contains(&value) {
        return value.into();
    }
    match value {
        "chicken" => "calico",
        "cat" => "blackcat",
        "raccoon" => "redpanda",
        "goat" => "graycat",
        _ => "blackcat",
    }
    .into()
}
const SPAWNS: [(f64, f64); 15] = [
    (75.5, 75.5),
    (73.5, 75.5),
    (77.5, 75.5),
    (75.5, 73.5),
    (75.5, 77.5),
    (72.5, 72.5),
    (78.5, 72.5),
    (72.5, 78.5),
    (78.5, 78.5),
    (74.0, 72.0),
    (76.0, 72.0),
    (72.0, 74.0),
    (78.0, 74.0),
    (72.0, 76.0),
    (78.0, 76.0),
];
const BUSH_ZONES: [(&str, f64, f64, f64, f64); 5] = [
    ("bush-nw", 32.0, 8.0, 10.0, 10.0),
    ("bush-w", 8.0, 32.0, 10.0, 10.0),
    ("bush-ne", 108.0, 32.0, 10.0, 10.0),
    ("bush-sw", 32.0, 108.0, 10.0, 10.0),
    ("bush-se", 108.0, 108.0, 10.0, 10.0),
];
const DOOR_CELLS: [(i32, i32); 12] = [
    (75, 56),
    (75, 57),
    (75, 58),
    (75, 91),
    (75, 92),
    (75, 93),
    (66, 75),
    (67, 75),
    (68, 75),
    (81, 75),
    (82, 75),
    (83, 75),
];

#[derive(Clone, Copy)]
struct ObjectDef {
    id: &'static str,
    x: f64,
    y: f64,
    label: &'static str,
}
const OBJECT_DEFS: [ObjectDef; 12] = [
    ObjectDef {
        id: "power-nw",
        x: 7.5,
        y: 7.5,
        label: "西北配电箱",
    },
    ObjectDef {
        id: "relay-n",
        x: 42.5,
        y: 7.5,
        label: "北区中继器",
    },
    ObjectDef {
        id: "sensor-ne",
        x: 92.5,
        y: 7.5,
        label: "东北传感器",
    },
    ObjectDef {
        id: "gate-e",
        x: 142.5,
        y: 32.5,
        label: "东侧门禁",
    },
    ObjectDef {
        id: "pump-w",
        x: 7.5,
        y: 57.5,
        label: "西区水泵",
    },
    ObjectDef {
        id: "console-c1",
        x: 67.5,
        y: 57.5,
        label: "中央控制台 A",
    },
    ObjectDef {
        id: "console-c2",
        x: 82.5,
        y: 92.5,
        label: "中央控制台 B",
    },
    ObjectDef {
        id: "radio-e",
        x: 142.5,
        y: 82.5,
        label: "东区无线电",
    },
    ObjectDef {
        id: "beacon-sw",
        x: 17.5,
        y: 117.5,
        label: "西南信标",
    },
    ObjectDef {
        id: "panel-s",
        x: 67.5,
        y: 142.5,
        label: "南区面板",
    },
    ObjectDef {
        id: "relay-se",
        x: 117.5,
        y: 142.5,
        label: "东南中继器",
    },
    ObjectDef {
        id: "gate-s",
        x: 142.5,
        y: 117.5,
        label: "南侧门禁",
    },
];

#[derive(Clone, Copy)]
struct VentDef {
    id: &'static str,
    x: f64,
    y: f64,
    links: &'static [&'static str],
}
const VENT_NW: [&str; 2] = ["vent-n", "vent-ne"];
const VENT_N: [&str; 2] = ["vent-nw", "vent-ne"];
const VENT_NE: [&str; 2] = ["vent-nw", "vent-n"];
const VENT_SW: [&str; 2] = ["vent-c", "vent-se"];
const VENT_C: [&str; 2] = ["vent-sw", "vent-se"];
const VENT_SE: [&str; 2] = ["vent-sw", "vent-c"];
const VENT_DEFS: [VentDef; 6] = [
    VentDef {
        id: "vent-nw",
        x: 30.5,
        y: 30.5,
        links: &VENT_NW,
    },
    VentDef {
        id: "vent-n",
        x: 69.5,
        y: 31.5,
        links: &VENT_N,
    },
    VentDef {
        id: "vent-ne",
        x: 112.5,
        y: 32.5,
        links: &VENT_NE,
    },
    VentDef {
        id: "vent-sw",
        x: 20.5,
        y: 92.5,
        links: &VENT_SW,
    },
    VentDef {
        id: "vent-c",
        x: 75.5,
        y: 112.5,
        links: &VENT_C,
    },
    VentDef {
        id: "vent-se",
        x: 130.5,
        y: 92.5,
        links: &VENT_SE,
    },
];

#[derive(Clone, Copy)]
struct SabotageDef {
    label: &'static str,
    stations: &'static [&'static str],
    duration_ms: i64,
}
const SAB_LIGHTS: [&str; 1] = ["power-nw"];
const SAB_REACTOR: [&str; 2] = ["relay-n", "relay-se"];
const SAB_O2: [&str; 2] = ["sensor-ne", "pump-w"];
fn sabotage_def(kind: &str) -> Option<SabotageDef> {
    match kind {
        "lights" => Some(SabotageDef {
            label: "断电",
            stations: &SAB_LIGHTS,
            duration_ms: 0,
        }),
        "reactor" => Some(SabotageDef {
            label: "反应堆熔毁",
            stations: &SAB_REACTOR,
            duration_ms: 35_000,
        }),
        "o2" => Some(SabotageDef {
            label: "O₂ 耗尽",
            stations: &SAB_O2,
            duration_ms: 35_000,
        }),
        _ => None,
    }
}

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct Settings {
    normal_impostors: i64,
    shapeshifters: i64,
    phantoms: i64,
    vipers: i64,
    engineers: i64,
    scientists: i64,
    trackers: i64,
    noisemakers: i64,
    detectives: i64,
    guardian_angels: i64,
    impostors: i64,
    tasks_per_crew: i64,
    move_speed: f64,
    kill_cooldown: i64,
    discussion: i64,
    voting: i64,
    emergency_meetings: i64,
    sabotage_cooldown: i64,
    confirm_ejects: bool,
    #[serde(default = "default_music_control")]
    music_control: String,
}
impl Default for Settings {
    fn default() -> Self {
        Self {
            normal_impostors: 1,
            shapeshifters: 0,
            phantoms: 0,
            vipers: 0,
            engineers: 0,
            scientists: 0,
            trackers: 0,
            noisemakers: 0,
            detectives: 0,
            guardian_angels: 0,
            impostors: 1,
            tasks_per_crew: 4,
            move_speed: 4.6,
            kill_cooldown: 20,
            discussion: 15,
            voting: 45,
            emergency_meetings: 1,
            sabotage_cooldown: 20,
            confirm_ejects: true,
            music_control: default_music_control(),
        }
    }
}

fn default_music_control() -> String {
    "all".into()
}

#[derive(Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
struct MusicState {
    track: String,
    playing: bool,
    position_ms: i64,
    changed_at: i64,
}

#[derive(Clone, Serialize, Deserialize, Default)]
struct Pos {
    x: f64,
    y: f64,
}

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ActiveTask {
    id: String,
    token: String,
    #[serde(rename = "type")]
    task_type: String,
    answer: String,
    min_complete_at: i64,
    payload: Value,
    started_at: i64,
}

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct Player {
    id: String,
    token: String,
    #[serde(default)]
    client_instance_id: String,
    name: String,
    color: String,
    animal: String,
    avatar: String,
    pos: Pos,
    #[serde(default)]
    move_seq: u64,
    #[serde(skip)]
    direct_ready: bool,
    #[serde(skip)]
    transport_generation: u64,
    connected: bool,
    connection_id: String,
    joined_at: i64,
    last_seen: i64,
    last_move_at: i64,
    last_chat_at: i64,
    role: String,
    ghost_role: String,
    alive: bool,
    tasks: Vec<String>,
    fake_tasks: Vec<String>,
    completed: Vec<String>,
    kill_ready_at: i64,
    ability_ready_at: i64,
    ability_until: i64,
    disguise_target_id: String,
    hidden_until: i64,
    tracked_id: String,
    track_until: i64,
    vent_ready_at: i64,
    vent_exit_at: i64,
    protected_until: i64,
    last_case_id: String,
    last_case_area: String,
    poisoned_by: String,
    poison_ends_at: i64,
    voice_session_id: String,
    voice_track_name: String,
    voice_enabled: bool,
    emergency_used: i64,
    in_vent: bool,
    vent_id: String,
    active_task: Option<ActiveTask>,
}

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct Body {
    id: String,
    player_id: String,
    name: String,
    color: String,
    x: f64,
    y: f64,
    created_at: i64,
    dissolve_at: i64,
}

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct Meeting {
    id: String,
    stage: String,
    caller_id: String,
    body_id: String,
    reason_text: String,
    discussion_ends_at: i64,
    voting_ends_at: i64,
    votes: HashMap<String, String>,
    eligible_voters: usize,
    result: Option<Value>,
    resume_at: i64,
}

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct Sabotage {
    #[serde(rename = "type")]
    kind: String,
    started_at: i64,
    ends_at: i64,
    fixed_stations: Vec<String>,
}

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct RestartVote {
    id: String,
    votes: HashMap<String, bool>,
    expires_at: i64,
}

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct Room {
    initialized: bool,
    created_at: i64,
    host_id: String,
    players: HashMap<String, Player>,
    bodies: Vec<Body>,
    phase: String,
    started_at: i64,
    ended_at: i64,
    winner: String,
    reason: String,
    meeting: Option<Meeting>,
    settings: Settings,
    #[serde(default)]
    music: MusicState,
    #[serde(default)]
    restart_vote: Option<RestartVote>,
    sabotage: Option<Sabotage>,
    sabotage_ready_at: i64,
    door_lock_until: i64,
}
impl Default for Room {
    fn default() -> Self {
        Self {
            initialized: false,
            created_at: 0,
            host_id: String::new(),
            players: HashMap::new(),
            bodies: vec![],
            phase: "lobby".into(),
            started_at: 0,
            ended_at: 0,
            winner: String::new(),
            reason: String::new(),
            meeting: None,
            settings: Settings::default(),
            music: MusicState::default(),
            restart_vote: None,
            sabotage: None,
            sabotage_ready_at: 0,
            door_lock_until: 0,
        }
    }
}
impl Room {
    fn restore_transients(&mut self) {
        for p in self.players.values_mut() {
            p.connected = false;
            p.connection_id.clear();
            p.active_task = None;
            p.ability_until = 0;
            p.disguise_target_id.clear();
            p.hidden_until = 0;
            p.vent_exit_at = 0;
            p.poisoned_by.clear();
            p.poison_ends_at = 0;
            p.voice_session_id.clear();
            p.voice_track_name.clear();
            p.voice_enabled = false;
            if p.role == "morpher" {
                p.role = "shapeshifter".into();
            }
            if p.role == "cloaker" {
                p.role = "phantom".into();
            }
            p.animal = normalize_animal(&p.animal);
            p.avatar = sanitize_avatar(&p.avatar);
        }
    }
}

#[derive(Clone, Deserialize)]
struct Config {
    #[serde(default = "default_bind")]
    bind: String,
    #[serde(default = "default_data_dir")]
    data_dir: String,
    #[serde(default)]
    calls_app_id: String,
    #[serde(default)]
    calls_secret: String,
    #[serde(default = "default_allowed_origin")]
    allowed_origin: String,
}
fn default_bind() -> String {
    "127.0.0.1:28727".into()
}
fn default_data_dir() -> String {
    r"D:\server\data".into()
}
fn default_allowed_origin() -> String {
    "https://d1.lunarlab.uk".into()
}

#[derive(Clone)]
struct VoiceSessionGrant {
    room: String,
    player_id: String,
    last_used: i64,
}
#[derive(Clone, Default)]
struct VoiceRate {
    short_window_start: i64,
    short_count: u32,
    new_window_start: i64,
    new_count: u32,
}

#[derive(Clone)]
struct AppState {
    rooms: Arc<RwLock<HashMap<String, Arc<Mutex<RoomRuntime>>>>>,
    data_dir: Arc<PathBuf>,
    calls_app_id: Arc<String>,
    calls_secret: Arc<String>,
    allowed_origin: Arc<String>,
    voice_sessions: Arc<Mutex<HashMap<String, VoiceSessionGrant>>>,
    voice_rates: Arc<Mutex<HashMap<String, VoiceRate>>>,
    active_ws: Arc<AtomicUsize>,
    ip_connections: Arc<StdMutex<HashMap<String, usize>>>,
    http: Client,
}

#[derive(Clone)]
enum Outgoing {
    Text(String),
    Close(u16, String),
}
#[derive(Clone)]
struct ClientConn {
    connection_id: String,
    tx: mpsc::Sender<Outgoing>,
}
struct RoomRuntime {
    room: Room,
    clients: HashMap<String, ClientConn>,
    voice_api_sessions: HashMap<String, HashSet<String>>,
    dirty: bool,
}
impl RoomRuntime {
    fn new(room: Room) -> Self {
        Self {
            room,
            clients: HashMap::new(),
            voice_api_sessions: HashMap::new(),
            dirty: false,
        }
    }
    fn send_to(&self, id: &str, v: Value) {
        if let Some(c) = self.clients.get(id) {
            let _ = c.tx.try_send(Outgoing::Text(v.to_string()));
        }
    }
    fn close_client(&self, id: &str, code: u16, reason: &str) {
        if let Some(c) = self.clients.get(id) {
            let _ = c.tx.try_send(Outgoing::Close(code, reason.into()));
        }
    }
    fn broadcast(&self, v: Value, except: Option<&str>) {
        let text = v.to_string();
        for (id, c) in &self.clients {
            if except == Some(id.as_str()) {
                continue;
            }
            let _ = c.tx.try_send(Outgoing::Text(text.clone()));
        }
    }
    fn broadcast_state(&self) {
        for id in self.clients.keys() {
            if let Some(p) = self.room.players.get(id) {
                self.send_to(id, json!({"t":"state","players":public_players(&self.room),"bodies":self.room.bodies,
                    "game":public_game(&self.room,id),"selfState":self_state(&self.room,p)}));
            }
        }
    }
    fn broadcast_voice_directory(&self) {
        for id in self.clients.keys() {
            if let Some(p) = self.room.players.get(id) {
                self.send_to(
                    id,
                    json!({"t":"voice_directory","voices":voice_directory(&self.room,Some(p))}),
                );
            }
        }
    }
    fn mark_dirty(&mut self) {
        self.dirty = true;
    }
}

fn now_ms() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as i64
}
fn clamp(v: f64, min: f64, max: f64) -> f64 {
    v.max(min).min(max)
}
fn clamp_i(v: i64, min: i64, max: i64) -> i64 {
    v.max(min).min(max)
}
fn sanitize_name(s: &str) -> String {
    let filtered: String = s.chars().filter(|c| !c.is_control()).collect();
    let t = filtered.trim();
    let t = if t.is_empty() { "玩家" } else { t };
    t.chars().take(12).collect()
}
fn requested_name_valid(name: &str) -> bool {
    !name
        .chars()
        .last()
        .map(|c| c.is_ascii_digit())
        .unwrap_or(false)
}
fn unique_player_name(room: &Room, base: &str) -> String {
    let used: HashSet<&str> = room.players.values().map(|p| p.name.as_str()).collect();
    if !used.contains(base) {
        return base.to_string();
    }
    for n in 2..=99 {
        let suffix = n.to_string();
        let keep = 12usize.saturating_sub(suffix.chars().count()).max(1);
        let stem: String = base.chars().take(keep).collect();
        let candidate = format!("{}{}", stem, suffix);
        if !used.contains(candidate.as_str()) {
            return candidate;
        }
    }
    format!(
        "玩家{}",
        Uuid::new_v4()
            .simple()
            .to_string()
            .chars()
            .take(4)
            .collect::<String>()
    )
}
fn sanitize_client_instance_id(s: &str) -> String {
    let t = s.trim();
    if (16..=64).contains(&t.len())
        && t.bytes()
            .all(|b| b.is_ascii_alphanumeric() || b == b'-' || b == b'_')
    {
        t.to_string()
    } else {
        String::new()
    }
}
fn sanitize_text(s: &str) -> String {
    s.chars()
        .filter(|c| !c.is_control() || *c == '\n' || *c == '\t')
        .collect::<String>()
        .trim()
        .chars()
        .take(100)
        .collect()
}
fn sanitize_avatar(s: &str) -> String {
    if s.is_empty() || s.len() > MAX_AVATAR_CHARS || !s.starts_with("data:image/webp;base64,") {
        return String::new();
    }
    if s[23..]
        .bytes()
        .all(|b| b.is_ascii_alphanumeric() || b == b'+' || b == b'/' || b == b'=')
    {
        s.into()
    } else {
        String::new()
    }
}
fn is_impostor(role: &str) -> bool {
    matches!(role, "impostor" | "shapeshifter" | "phantom" | "viper")
}
fn is_crew(role: &str) -> bool {
    matches!(
        role,
        "crewmate" | "engineer" | "scientist" | "tracker" | "noisemaker" | "detective"
    )
}
fn role_label(role: &str) -> &'static str {
    match role {
        "impostor" => "普通内鬼",
        "shapeshifter" => "变形者",
        "phantom" => "隐身者",
        "viper" => "毒蛇",
        "crewmate" => "普通船员",
        "engineer" => "工程师",
        "scientist" => "科学家",
        "tracker" => "追踪者",
        "noisemaker" => "噪音制造者",
        "detective" => "侦探",
        "guardian" => "守护天使",
        _ => "",
    }
}
fn spawn(i: usize) -> Pos {
    let (x, y) = SPAWNS[i % SPAWNS.len()];
    Pos { x, y }
}
fn dist(a: &Pos, b: &Pos) -> f64 {
    ((a.x - b.x).powi(2) + (a.y - b.y).powi(2)).sqrt()
}
fn object(id: &str) -> Option<ObjectDef> {
    OBJECT_DEFS.iter().copied().find(|o| o.id == id)
}
fn vent(id: &str) -> Option<VentDef> {
    VENT_DEFS.iter().copied().find(|v| v.id == id)
}
fn task_ids() -> Vec<String> {
    OBJECT_DEFS
        .iter()
        .filter(|o| o.id != EMERGENCY_STATION)
        .map(|o| o.id.to_string())
        .collect()
}
fn task_type(id: &str) -> &'static str {
    match id {
        "power-nw" | "relay-n" | "relay-se" => "sequence",
        "sensor-ne" | "radio-e" => "keypad",
        "gate-e" | "gate-s" => "align",
        _ => "hold",
    }
}
fn area_code(x: f64, y: f64) -> String {
    let sx = clamp((x / 25.0).floor(), 0.0, 5.0) as u8;
    let sy = clamp((y / 25.0).floor(), 0.0, 5.0) as i64;
    format!("{}{}", (b'A' + sx) as char, sy + 1)
}

static MAP: OnceLock<Vec<u8>> = OnceLock::new();
fn map_data() -> &'static Vec<u8> {
    MAP.get_or_init(|| {
        let mut map = vec![0u8; (MAP_SIZE * MAP_SIZE) as usize];
        let mut set_wall = |x: i32, y: i32, v: u8| {
            if (0..MAP_SIZE).contains(&x) && (0..MAP_SIZE).contains(&y) {
                map[(y * MAP_SIZE + x) as usize] = v;
            }
        };
        for i in 0..MAP_SIZE {
            set_wall(i, 0, 1);
            set_wall(i, MAP_SIZE - 1, 1);
            set_wall(0, i, 1);
            set_wall(MAP_SIZE - 1, i, 1);
        }
        let lines = [25, 50, 75, 100, 125];
        for (li, x) in lines.iter().enumerate() {
            for y in 1..MAP_SIZE - 1 {
                let sector = y / 25;
                let local = y % 25;
                let ds = if (sector + li as i32) % 2 == 0 { 6 } else { 16 };
                if local < ds || local > ds + 2 {
                    set_wall(*x, y, 1);
                }
            }
        }
        for (li, y) in lines.iter().enumerate() {
            for x in 1..MAP_SIZE - 1 {
                let sector = x / 25;
                let local = x % 25;
                let ds = if (sector + li as i32 + 1) % 2 == 0 {
                    6
                } else {
                    16
                };
                if local < ds || local > ds + 2 {
                    set_wall(x, *y, 1);
                }
            }
        }
        for sy in 0..6 {
            for sx in 0..6 {
                if sx == 3 && sy == 3 {
                    continue;
                }
                if (sx + sy) % 2 != 0 {
                    continue;
                }
                let cx = sx * 25 + 13;
                let cy = sy * 25 + 13;
                let horizontal = (sx * 3 + sy) % 2 == 0;
                let w = if horizontal { 5 } else { 2 };
                let h = if horizontal { 2 } else { 5 };
                for oy in -(h / 2)..=(h / 2) {
                    for ox in -(w / 2)..=(w / 2) {
                        set_wall(cx + ox, cy + oy, 1);
                    }
                }
            }
        }
        for y in 70..=80 {
            for x in 70..=80 {
                set_wall(x, y, 0);
            }
        }
        for o in OBJECT_DEFS {
            let cx = o.x.floor() as i32;
            let cy = o.y.floor() as i32;
            for y in cy - 1..=cy + 1 {
                for x in cx - 1..=cx + 1 {
                    set_wall(x, y, 0);
                }
            }
        }
        for v in VENT_DEFS {
            let cx = v.x.floor() as i32;
            let cy = v.y.floor() as i32;
            for y in cy - 1..=cy + 1 {
                for x in cx - 1..=cx + 1 {
                    set_wall(x, y, 0);
                }
            }
        }
        map
    })
}
fn is_wall(c: i32, r: i32) -> bool {
    c < 0 || r < 0 || c >= MAP_SIZE || r >= MAP_SIZE || map_data()[(r * MAP_SIZE + c) as usize] == 1
}
fn is_door(c: i32, r: i32) -> bool {
    DOOR_CELLS.contains(&(c, r))
}
fn circle_hits_wall(x: f64, y: f64, radius: f64, doors_closed: bool) -> bool {
    let minx = (x - radius).floor() as i32;
    let maxx = (x + radius).floor() as i32;
    let miny = (y - radius).floor() as i32;
    let maxy = (y + radius).floor() as i32;
    for row in miny..=maxy {
        for col in minx..=maxx {
            if !(is_wall(col, row) || (doors_closed && is_door(col, row))) {
                continue;
            }
            let nx = clamp(x, col as f64, (col + 1) as f64);
            let ny = clamp(y, row as f64, (row + 1) as f64);
            let dx = x - nx;
            let dy = y - ny;
            if dx * dx + dy * dy < radius * radius {
                return true;
            }
        }
    }
    false
}
fn has_line_of_sight(a: &Pos, b: &Pos, doors_closed: bool) -> bool {
    let d = dist(a, b);
    let steps = ((d / 0.12).ceil() as i32).max(1);
    for i in 1..steps {
        let t = i as f64 / steps as f64;
        let x = a.x + (b.x - a.x) * t;
        let y = a.y + (b.y - a.y) * t;
        let c = x.floor() as i32;
        let r = y.floor() as i32;
        if is_wall(c, r) || (doors_closed && is_door(c, r)) {
            return false;
        }
    }
    true
}
fn bush_region(pos: &Pos) -> &'static str {
    for (id, x, y, w, h) in BUSH_ZONES {
        if pos.x >= x && pos.x < x + w && pos.y >= y && pos.y < y + h {
            return id;
        }
    }
    ""
}
fn can_see_player(a: &Pos, b: &Pos, doors_closed: bool) -> bool {
    if !has_line_of_sight(a, b, doors_closed) {
        return false;
    }
    let target_bush = bush_region(b);
    target_bush.is_empty() || bush_region(a) == target_bush
}

fn val_i(raw: &Value, key: &str, fb: i64) -> i64 {
    raw.get(key)
        .and_then(Value::as_f64)
        .map(|x| x.round() as i64)
        .unwrap_or(fb)
}
fn val_f(raw: &Value, key: &str, fb: f64) -> f64 {
    raw.get(key).and_then(Value::as_f64).unwrap_or(fb)
}
fn normalize_settings(raw: &Value, base: &Settings) -> Settings {
    let legacy = raw.get("normalImpostors").is_none()
        && (raw.get("morphers").is_some() || raw.get("cloakers").is_some());
    let mut normal = clamp_i(
        val_i(
            raw,
            "normalImpostors",
            if legacy { 0 } else { base.normal_impostors },
        ),
        0,
        5,
    );
    let shape = clamp_i(
        raw.get("shapeshifters")
            .or_else(|| raw.get("morphers"))
            .and_then(Value::as_f64)
            .map(|x| x.round() as i64)
            .unwrap_or(base.shapeshifters),
        0,
        5,
    );
    let phantom = clamp_i(
        raw.get("phantoms")
            .or_else(|| raw.get("cloakers"))
            .and_then(Value::as_f64)
            .map(|x| x.round() as i64)
            .unwrap_or(base.phantoms),
        0,
        5,
    );
    let vipers = clamp_i(val_i(raw, "vipers", base.vipers), 0, 5);
    if normal + shape + phantom + vipers < 1 {
        normal = 1;
    }
    let imps = normal + shape + phantom + vipers;
    Settings {
        normal_impostors: normal,
        shapeshifters: shape,
        phantoms: phantom,
        vipers,
        impostors: imps,
        engineers: clamp_i(val_i(raw, "engineers", base.engineers), 0, 5),
        scientists: clamp_i(val_i(raw, "scientists", base.scientists), 0, 5),
        trackers: clamp_i(val_i(raw, "trackers", base.trackers), 0, 5),
        noisemakers: clamp_i(val_i(raw, "noisemakers", base.noisemakers), 0, 5),
        detectives: clamp_i(val_i(raw, "detectives", base.detectives), 0, 5),
        guardian_angels: clamp_i(val_i(raw, "guardianAngels", base.guardian_angels), 0, 5),
        tasks_per_crew: clamp_i(val_i(raw, "tasksPerCrew", base.tasks_per_crew), 2, 6),
        move_speed: (clamp(val_f(raw, "moveSpeed", base.move_speed), 3.45, 13.8) * 100.0).round()
            / 100.0,
        kill_cooldown: clamp_i(val_i(raw, "killCooldown", base.kill_cooldown), 10, 60),
        discussion: clamp_i(val_i(raw, "discussion", base.discussion), 0, 90),
        voting: clamp_i(val_i(raw, "voting", base.voting), 15, 180),
        emergency_meetings: clamp_i(
            val_i(raw, "emergencyMeetings", base.emergency_meetings),
            0,
            5,
        ),
        sabotage_cooldown: clamp_i(
            val_i(raw, "sabotageCooldown", base.sabotage_cooldown),
            10,
            60,
        ),
        confirm_ejects: raw
            .get("confirmEjects")
            .and_then(Value::as_bool)
            .unwrap_or(base.confirm_ejects),
        music_control: match raw.get("musicControl").and_then(Value::as_str) {
            Some("host") => "host".into(),
            Some("all") => "all".into(),
            _ if base.music_control == "host" => "host".into(),
            _ => "all".into(),
        },
    }
}

fn public_players(room: &Room) -> Vec<Value> {
    room.players.values().map(|p|json!({"id":p.id,"name":p.name,"color":p.color,"pos":p.pos,"moveSeq":p.move_seq,"directReady":p.direct_ready,"isHost":p.id==room.host_id,"connected":p.connected,"alive":p.alive,"inVent":p.in_vent,"animal":p.animal,"disguiseTargetId":p.disguise_target_id,"abilityUntil":p.ability_until,"hiddenUntil":p.hidden_until,"protectedUntil":p.protected_until})).collect()
}
fn profiles(room: &Room) -> Vec<Value> {
    room.players
        .values()
        .map(|p| json!({"id":p.id,"animal":p.animal,"avatar":sanitize_avatar(&p.avatar)}))
        .collect()
}
fn voice_directory(room: &Room, viewer: Option<&Player>) -> Vec<Value> {
    let dead = viewer.map(|p| !p.alive).unwrap_or(false);
    room.players.values().filter(|p|!p.voice_session_id.is_empty()&&!p.voice_track_name.is_empty()).filter(|p|room.phase!="playing"||dead||p.alive).map(|p|json!({"playerId":p.id,"sessionId":p.voice_session_id,"trackName":p.voice_track_name,"enabled":p.voice_enabled,"connected":p.connected})).collect()
}
fn task_progress(room: &Room) -> (usize, usize) {
    let (mut done, mut total) = (0, 0);
    for p in room.players.values() {
        if is_crew(&p.role) {
            total += p.tasks.len();
            done += p.completed.len();
        }
    }
    (done, total)
}
fn self_state(room: &Room, p: &Player) -> Value {
    json!({"role":p.role,"roleLabel":role_label(&p.role),"ghostRole":p.ghost_role,"alive":p.alive,"tasks":p.tasks,"completed":p.completed,"fakeTasks":p.fake_tasks,"allies":if is_impostor(&p.role){room.players.values().filter(|x|x.id!=p.id&&is_impostor(&x.role)).map(|x|Value::String(x.id.clone())).collect::<Vec<_>>()}else{vec![]},"killReadyAt":p.kill_ready_at,"abilityReadyAt":p.ability_ready_at,"abilityUntil":p.ability_until,"trackedId":p.tracked_id,"trackUntil":p.track_until,"ventReadyAt":p.vent_ready_at,"ventExitAt":p.vent_exit_at,"protectedUntil":p.protected_until,"sabotageReadyAt":if is_impostor(&p.role){room.sabotage_ready_at}else{0},"emergencyUsed":p.emergency_used,"inVent":p.in_vent,"ventId":p.vent_id})
}
fn public_meeting(m: &Meeting, my_id: &str) -> Value {
    json!({"id":m.id,"stage":m.stage,"reasonText":m.reason_text,"callerId":m.caller_id,"bodyId":m.body_id,"discussionEndsAt":m.discussion_ends_at,"votingEndsAt":m.voting_ends_at,"resumeAt":m.resume_at,"myVote":m.votes.get(my_id).cloned().unwrap_or_default(),"votesCast":m.votes.len(),"eligibleVoters":m.eligible_voters,"result":if m.stage=="result"{m.result.clone().unwrap_or(Value::Null)}else{Value::Null}})
}
fn public_sabotage(s: &Sabotage) -> Value {
    let d = sabotage_def(&s.kind);
    json!({"type":s.kind,"label":d.map(|x|x.label).unwrap_or(&s.kind),"startedAt":s.started_at,"endsAt":s.ends_at,"fixedStations":s.fixed_stations,"requiredStations":d.map(|x|x.stations.iter().map(|z|z.to_string()).collect::<Vec<_>>()).unwrap_or_default()})
}
fn public_restart_vote(room: &Room, my_id: &str) -> Value {
    let Some(v) = &room.restart_vote else {
        return Value::Null;
    };
    if v.expires_at <= now_ms() {
        return Value::Null;
    }
    let connected: Vec<_> = room.players.values().filter(|p| p.connected).collect();
    let votes = connected
        .iter()
        .filter(|p| v.votes.get(&p.id).copied().unwrap_or(false))
        .count();
    let needed = connected.len() / 2 + 1;
    json!({"id":v.id,"votes":votes,"needed":needed,"voted":v.votes.get(my_id).copied().unwrap_or(false),"expiresAt":v.expires_at})
}
fn public_game(room: &Room, my_id: &str) -> Value {
    let (d, t) = task_progress(room);
    json!({"phase":room.phase,"winner":room.winner,"reason":room.reason,"taskDone":d,"taskTotal":t,"meeting":room.meeting.as_ref().map(|m|public_meeting(m,my_id)).unwrap_or(Value::Null),"settings":room.settings,"music":room.music,"restartVote":public_restart_vote(room,my_id),"sabotage":room.sabotage.as_ref().map(public_sabotage).unwrap_or(Value::Null),"doorLockUntil":room.door_lock_until})
}

fn elect_host(room: &mut Room) {
    let mut ps: Vec<_> = room.players.values().filter(|p| p.connected).collect();
    ps.sort_by_key(|p| p.joined_at);
    if let Some(p) = ps.first() {
        room.host_id = p.id.clone();
        return;
    }
    let mut ps: Vec<_> = room.players.values().collect();
    ps.sort_by_key(|p| p.joined_at);
    room.host_id = ps.first().map(|p| p.id.clone()).unwrap_or_default();
}
fn reset_if_empty(room: &mut Room) -> bool {
    if !room.players.is_empty() {
        return false;
    }
    *room = Room::default();
    true
}
fn announce_host_change(rt: &RoomRuntime, previous: &str) {
    if previous == rt.room.host_id {
        return;
    }
    if let Some(p) = rt.room.players.get(&rt.room.host_id) {
        rt.broadcast(
            json!({"t":"notice","text":format!("房主已自动转让给 {}",p.name)}),
            None,
        );
    }
}
fn next_color(room: &Room) -> String {
    let used: HashSet<_> = room.players.values().map(|p| p.color.as_str()).collect();
    COLORS
        .iter()
        .find(|c| !used.contains(**c))
        .copied()
        .unwrap_or(COLORS[room.players.len() % COLORS.len()])
        .into()
}
fn next_animal(room: &Room) -> String {
    ANIMALS[room.players.len() % ANIMALS.len()].into()
}

fn end_game(rt: &mut RoomRuntime, winner: &str, reason: &str) -> bool {
    if rt.room.phase == "ended" {
        return true;
    }
    rt.room.phase = "ended".into();
    rt.room.winner = winner.into();
    rt.room.reason = reason.into();
    rt.room.ended_at = now_ms();
    rt.room.meeting = None;
    rt.room.sabotage = None;
    rt.room.door_lock_until = 0;
    for p in rt.room.players.values() {
        rt.send_to(&p.id,json!({"t":"game_over","winner":winner,"reason":reason,"selfState":self_state(&rt.room,p),"roles":rt.room.players.values().map(|x|(x.id.clone(),Value::String(x.role.clone()))).collect::<Map<String,Value>>() }));
    }
    rt.mark_dirty();
    true
}
fn check_win(rt: &mut RoomRuntime, source: &str) -> bool {
    if rt.room.phase == "lobby" || rt.room.phase == "ended" {
        return false;
    }
    let alive: Vec<_> = rt.room.players.values().filter(|p| p.alive).collect();
    let imps = alive.iter().filter(|p| is_impostor(&p.role)).count();
    let crew = alive.iter().filter(|p| is_crew(&p.role)).count();
    let (done, total) = task_progress(&rt.room);
    if rt.room.players.values().any(|p| is_impostor(&p.role)) && imps == 0 {
        return end_game(rt, "crewmate", "所有内鬼都已被淘汰");
    }
    if total > 0 && done >= total {
        return end_game(rt, "crewmate", "所有船员任务已经完成");
    }
    if imps > 0 && imps >= crew && matches!(source, "kill" | "vote" | "leave") {
        return end_game(rt, "impostor", "内鬼人数已经不低于剩余船员");
    }
    false
}

fn cleanup_expired(rt: &mut RoomRuntime, now: i64) -> bool {
    let ids: Vec<String> = rt
        .room
        .players
        .values()
        .filter(|p| !p.connected && now - p.last_seen > RECONNECT_GRACE_MS)
        .map(|p| p.id.clone())
        .collect();
    if ids.is_empty() {
        return false;
    }
    for id in ids {
        rt.room.players.remove(&id);
        rt.clients.remove(&id);
        rt.voice_api_sessions.remove(&id);
    }
    if !reset_if_empty(&mut rt.room) {
        if !rt
            .room
            .players
            .get(&rt.room.host_id)
            .map(|p| p.connected)
            .unwrap_or(false)
        {
            elect_host(&mut rt.room);
        }
        let ids: HashSet<String> = rt.room.players.keys().cloned().collect();
        rt.room.bodies.retain(|b| ids.contains(&b.player_id));
    }
    rt.mark_dirty();
    true
}
fn remove_player(rt: &mut RoomRuntime, id: &str, announce: bool) {
    let Some(p) = rt.room.players.remove(id) else {
        return;
    };
    let prev = rt.room.host_id.clone();
    rt.room.bodies.retain(|b| b.player_id != id);
    rt.clients.remove(id);
    rt.voice_api_sessions.remove(id);
    if !reset_if_empty(&mut rt.room)
        && (prev == id
            || !rt
                .room
                .players
                .get(&rt.room.host_id)
                .map(|p| p.connected)
                .unwrap_or(false))
    {
        elect_host(&mut rt.room);
    }
    if announce {
        rt.broadcast(
            json!({"t":"notice","text":format!("{} 离开了房间",p.name)}),
            None,
        );
    }
    announce_host_change(rt, &prev);
    rt.mark_dirty();
    rt.broadcast_state();
    check_win(rt, "leave");
}

fn create_task_challenge(id: &str) -> ActiveTask {
    let typ = task_type(id);
    let token = Uuid::new_v4().to_string();
    let now = now_ms();
    let mut rng = rand::thread_rng();
    match typ {
        "sequence" => {
            let mut seq = vec![0, 1, 2, 3];
            seq.shuffle(&mut rng);
            ActiveTask {
                id: id.into(),
                token,
                task_type: typ.into(),
                answer: seq
                    .iter()
                    .map(|n| n.to_string())
                    .collect::<Vec<_>>()
                    .join(","),
                min_complete_at: now + 500,
                payload: json!({"sequence":seq}),
                started_at: now,
            }
        }
        "keypad" => {
            let code = rng.gen_range(1000..=9999).to_string();
            ActiveTask {
                id: id.into(),
                token,
                task_type: typ.into(),
                answer: code.clone(),
                min_complete_at: now + 600,
                payload: json!({"code":code}),
                started_at: now,
            }
        }
        "align" => {
            let target = rng.gen_range(18..=82);
            ActiveTask {
                id: id.into(),
                token,
                task_type: typ.into(),
                answer: target.to_string(),
                min_complete_at: now + 500,
                payload: json!({"target":target}),
                started_at: now,
            }
        }
        _ => ActiveTask {
            id: id.into(),
            token,
            task_type: "hold".into(),
            answer: "ok".into(),
            min_complete_at: now + 1200,
            payload: json!({"duration":1200}),
            started_at: now,
        },
    }
}

fn start_game(rt: &mut RoomRuntime, player_id: &str) {
    if rt.room.host_id != player_id || rt.room.phase != "lobby" {
        return;
    }
    let active_ids: Vec<String> = rt
        .room
        .players
        .values()
        .filter(|p| p.connected)
        .map(|p| p.id.clone())
        .collect();
    if active_ids.len() < MIN_PLAYERS {
        rt.send_to(player_id,json!({"t":"error","code":"not_enough_players","message":format!("至少需要 {} 名玩家",MIN_PLAYERS)}));
        return;
    }
    let waiting_for_direct = active_ids
        .iter()
        .filter(|id| {
            rt.room
                .players
                .get(*id)
                .map(|p| !p.direct_ready)
                .unwrap_or(true)
        })
        .count();
    if waiting_for_direct > 0 {
        rt.send_to(
            player_id,
            json!({
                "t":"error",
                "code":"direct_not_ready",
                "message":format!("仍有 {} 名玩家未完成 Server 直连", waiting_for_direct),
                "close":false
            }),
        );
        return;
    }
    let now = now_ms();
    let mut rng = rand::thread_rng();
    let mut order = active_ids.clone();
    order.shuffle(&mut rng);
    let max_imp = ((active_ids.len() - 1) / 2).max(1);
    let mut requested = vec![];
    requested.extend(std::iter::repeat_n(
        "impostor",
        rt.room.settings.normal_impostors as usize,
    ));
    requested.extend(std::iter::repeat_n(
        "shapeshifter",
        rt.room.settings.shapeshifters as usize,
    ));
    requested.extend(std::iter::repeat_n(
        "phantom",
        rt.room.settings.phantoms as usize,
    ));
    requested.extend(std::iter::repeat_n(
        "viper",
        rt.room.settings.vipers as usize,
    ));
    if requested.is_empty() {
        requested.push("impostor");
    }
    requested.shuffle(&mut rng);
    requested.truncate(max_imp);
    let imp_count = requested.len();
    let mut crew_roles = vec![];
    crew_roles.extend(std::iter::repeat_n(
        "engineer",
        rt.room.settings.engineers as usize,
    ));
    crew_roles.extend(std::iter::repeat_n(
        "scientist",
        rt.room.settings.scientists as usize,
    ));
    crew_roles.extend(std::iter::repeat_n(
        "tracker",
        rt.room.settings.trackers as usize,
    ));
    crew_roles.extend(std::iter::repeat_n(
        "noisemaker",
        rt.room.settings.noisemakers as usize,
    ));
    crew_roles.extend(std::iter::repeat_n(
        "detective",
        rt.room.settings.detectives as usize,
    ));
    crew_roles.shuffle(&mut rng);
    crew_roles.truncate(order.len().saturating_sub(imp_count));
    let mut role_by = HashMap::new();
    for (i, id) in order.iter().take(imp_count).enumerate() {
        role_by.insert(id.clone(), requested[i].to_string());
    }
    for (i, id) in order.iter().skip(imp_count).enumerate() {
        role_by.insert(
            id.clone(),
            crew_roles.get(i).copied().unwrap_or("crewmate").to_string(),
        );
    }
    rt.room.bodies.clear();
    rt.room.restart_vote = None;
    rt.room.phase = "playing".into();
    rt.room.started_at = now;
    rt.room.ended_at = 0;
    rt.room.winner.clear();
    rt.room.reason.clear();
    rt.room.meeting = None;
    rt.room.sabotage = None;
    rt.room.door_lock_until = 0;
    rt.room.sabotage_ready_at = now + 10_000;
    let tasks = task_ids();
    for (i, id) in active_ids.iter().enumerate() {
        if let Some(p) = rt.room.players.get_mut(id) {
            p.role = role_by
                .get(id)
                .cloned()
                .unwrap_or_else(|| "crewmate".into());
            p.ghost_role.clear();
            p.alive = true;
            p.completed.clear();
            let mut ts = tasks.clone();
            ts.shuffle(&mut rng);
            if is_crew(&p.role) {
                p.tasks = ts
                    .iter()
                    .take(rt.room.settings.tasks_per_crew as usize)
                    .cloned()
                    .collect();
                p.fake_tasks.clear();
            } else {
                p.fake_tasks = ts
                    .iter()
                    .take(rt.room.settings.tasks_per_crew as usize)
                    .cloned()
                    .collect();
                p.tasks.clear();
            }
            p.kill_ready_at = if is_impostor(&p.role) {
                now + START_KILL_COOLDOWN_MS.min(rt.room.settings.kill_cooldown * 1000)
            } else {
                0
            };
            p.ability_ready_at = if matches!(
                p.role.as_str(),
                "shapeshifter" | "phantom" | "tracker" | "scientist" | "detective"
            ) {
                now + 8000
            } else {
                0
            };
            p.ability_until = 0;
            p.disguise_target_id.clear();
            p.hidden_until = 0;
            p.tracked_id.clear();
            p.track_until = 0;
            p.vent_ready_at = 0;
            p.vent_exit_at = 0;
            p.protected_until = 0;
            p.last_case_id.clear();
            p.last_case_area.clear();
            p.poisoned_by.clear();
            p.poison_ends_at = 0;
            p.emergency_used = 0;
            p.pos = spawn(i);
            p.move_seq = p.move_seq.saturating_add(1);
            p.last_move_at = now;
            p.in_vent = false;
            p.vent_id.clear();
            p.active_task = None;
        }
    }
    for id in &active_ids {
        if let Some(p) = rt.room.players.get(id) {
            rt.send_to(id,json!({"t":"game_start","game":public_game(&rt.room,id),"selfState":self_state(&rt.room,p)}));
        }
    }
    rt.broadcast_state();
    rt.broadcast(json!({"t":"notice","text":"游戏开始"}), None);
    rt.mark_dirty();
}

fn begin_task(rt: &mut RoomRuntime, player_id: &str, id: &str) {
    let Some(def) = object(id) else {
        return;
    };
    let ok = rt
        .room
        .players
        .get(player_id)
        .map(|p| {
            rt.room.phase == "playing"
                && is_crew(&p.role)
                && p.tasks.iter().any(|x| x == id)
                && !p.completed.iter().any(|x| x == id)
                && !p.in_vent
                && ((p.pos.x - def.x).powi(2) + (p.pos.y - def.y).powi(2)).sqrt() <= 1.65
        })
        .unwrap_or(false);
    if !ok {
        return;
    }
    let c = create_task_challenge(id);
    if let Some(p) = rt.room.players.get_mut(player_id) {
        p.active_task = Some(c.clone());
    }
    rt.send_to(player_id,json!({"t":"task_challenge","id":id,"token":c.token,"type":c.task_type,"payload":c.payload,"label":def.label}));
    rt.mark_dirty();
}
fn finish_task(rt: &mut RoomRuntime, player_id: &str, msg: &Value) {
    let id = msg.get("id").and_then(Value::as_str).unwrap_or("");
    let token = msg.get("token").and_then(Value::as_str).unwrap_or("");
    let Some(c) = rt
        .room
        .players
        .get(player_id)
        .and_then(|p| p.active_task.clone())
    else {
        return;
    };
    if rt.room.phase != "playing"
        || c.id != id
        || c.token != token
        || !rt
            .room
            .players
            .get(player_id)
            .map(|p| is_crew(&p.role))
            .unwrap_or(false)
    {
        return;
    }
    if now_ms() < c.min_complete_at {
        rt.send_to(
            player_id,
            json!({"t":"task_fail","message":"操作太快，请再试"}),
        );
        return;
    }
    let Some(def) = object(id) else {
        return;
    };
    let near = rt
        .room
        .players
        .get(player_id)
        .map(|p| ((p.pos.x - def.x).powi(2) + (p.pos.y - def.y).powi(2)).sqrt() <= 1.75)
        .unwrap_or(false);
    if !near {
        return;
    }
    let ans = msg
        .get("answer")
        .map(|v| {
            if let Some(s) = v.as_str() {
                s.to_string()
            } else {
                v.to_string()
            }
        })
        .unwrap_or_default();
    let ok = match c.task_type.as_str() {
        "hold" => true,
        "align" => ans
            .parse::<f64>()
            .ok()
            .zip(c.answer.parse::<f64>().ok())
            .map(|(a, b)| (a - b).abs() <= 4.0)
            .unwrap_or(false),
        _ => ans == c.answer,
    };
    if !ok {
        rt.send_to(
            player_id,
            json!({"t":"task_fail","message":"任务操作不正确"}),
        );
        return;
    }
    if let Some(p) = rt.room.players.get_mut(player_id) {
        p.active_task = None;
        if !p.completed.iter().any(|x| x == id) {
            p.completed.push(id.into());
        }
        if p.role == "scientist" {
            p.ability_ready_at = (now_ms() + 2500).max(p.ability_ready_at - 5000);
        }
    }
    let (done, total) = task_progress(&rt.room);
    let completed = rt
        .room
        .players
        .get(player_id)
        .map(|p| p.completed.clone())
        .unwrap_or_default();
    rt.send_to(
        player_id,
        json!({"t":"task_done","completed":completed,"taskDone":done,"taskTotal":total}),
    );
    rt.broadcast(
        json!({"t":"task_progress","taskDone":done,"taskTotal":total}),
        Some(player_id),
    );
    if matches!(id, "beacon-sw" | "panel-s") {
        rt.broadcast(
            json!({"t":"visual_task","stationId":id,"playerId":player_id,"until":now_ms()+1600}),
            None,
        );
    }
    rt.mark_dirty();
    check_win(rt, "tasks");
}
fn complete_legacy_task(rt: &mut RoomRuntime, player_id: &str, id: &str) {
    let Some(def) = object(id) else {
        return;
    };
    let ok = rt
        .room
        .players
        .get(player_id)
        .map(|p| {
            rt.room.phase == "playing"
                && is_crew(&p.role)
                && p.tasks.iter().any(|x| x == id)
                && !p.completed.iter().any(|x| x == id)
                && ((p.pos.x - def.x).powi(2) + (p.pos.y - def.y).powi(2)).sqrt() <= 1.65
        })
        .unwrap_or(false);
    if !ok {
        return;
    }
    if let Some(p) = rt.room.players.get_mut(player_id) {
        p.completed.push(id.into());
    }
    let (done, total) = task_progress(&rt.room);
    let completed = rt
        .room
        .players
        .get(player_id)
        .map(|p| p.completed.clone())
        .unwrap_or_default();
    rt.send_to(
        player_id,
        json!({"t":"task_done","completed":completed,"taskDone":done,"taskTotal":total}),
    );
    rt.broadcast(
        json!({"t":"task_progress","taskDone":done,"taskTotal":total}),
        Some(player_id),
    );
    rt.mark_dirty();
    check_win(rt, "tasks");
}

fn use_ability(rt: &mut RoomRuntime, player_id: &str, target_id: &str) {
    let now = now_ms();
    let Some(me) = rt.room.players.get(player_id).cloned() else {
        return;
    };
    if rt.room.phase != "playing" || me.in_vent {
        return;
    }
    let target = rt.room.players.get(target_id).cloned();
    if me.ghost_role == "guardian" && !me.alive {
        let Some(t) = target else {
            return;
        };
        if now < me.ability_ready_at
            || !t.connected
            || !t.alive
            || !is_crew(&t.role)
            || dist(&me.pos, &t.pos) > 2.2
        {
            return;
        }
        if let Some(x) = rt.room.players.get_mut(target_id) {
            x.protected_until = now + GUARDIAN_PROTECT_MS;
        }
        if let Some(x) = rt.room.players.get_mut(player_id) {
            x.ability_ready_at = now + GUARDIAN_COOLDOWN_MS;
        }
        let s = rt
            .room
            .players
            .get(player_id)
            .map(|p| self_state(&rt.room, p))
            .unwrap_or(Value::Null);
        rt.send_to(player_id, json!({"t":"ability_ok","selfState":s}));
        rt.send_to(
            target_id,
            json!({"t":"protected","until":now+GUARDIAN_PROTECT_MS}),
        );
        rt.mark_dirty();
        rt.broadcast_state();
        return;
    }
    if !me.alive {
        return;
    }
    if now < me.ability_ready_at {
        rt.send_to(
            player_id,
            json!({"t":"error","code":"ability_cooldown","message":"能力冷却中"}),
        );
        return;
    }
    match me.role.as_str() {
        "shapeshifter" => {
            let Some(t) = target else {
                return;
            };
            if t.id == me.id
                || !t.connected
                || !t.alive
                || t.in_vent
                || dist(&me.pos, &t.pos) > 1.8
                || !can_see_player(&me.pos, &t.pos, rt.room.door_lock_until > now)
            {
                return;
            }
            if let Some(p) = rt.room.players.get_mut(player_id) {
                p.disguise_target_id = t.id;
                p.ability_until = now + SHAPESHIFT_DURATION_MS;
                p.ability_ready_at = now + ROLE_ABILITY_COOLDOWN_MS;
            }
        }
        "phantom" => {
            if let Some(p) = rt.room.players.get_mut(player_id) {
                p.hidden_until = now + PHANTOM_DURATION_MS;
                p.ability_until = p.hidden_until;
                p.ability_ready_at = now + ROLE_ABILITY_COOLDOWN_MS;
            }
        }
        "tracker" => {
            let Some(t) = target else {
                return;
            };
            if t.id == me.id
                || !t.connected
                || !t.alive
                || dist(&me.pos, &t.pos) > 1.8
                || !can_see_player(&me.pos, &t.pos, rt.room.door_lock_until > now)
            {
                return;
            }
            if let Some(p) = rt.room.players.get_mut(player_id) {
                p.tracked_id = t.id;
                p.track_until = now + TRACK_DURATION_MS;
                p.ability_ready_at = now + ROLE_ABILITY_COOLDOWN_MS;
            }
        }
        "scientist" => {
            if let Some(p) = rt.room.players.get_mut(player_id) {
                p.ability_until = now + SCIENTIST_VIEW_MS;
                p.ability_ready_at = now + 20_000;
            }
        }
        "detective" => {
            let Some(t) = target else {
                return;
            };
            if t.id == me.id
                || !t.connected
                || !t.alive
                || dist(&me.pos, &t.pos) > 1.8
                || !can_see_player(&me.pos, &t.pos, rt.room.door_lock_until > now)
            {
                return;
            }
            if t.last_case_id.is_empty() || t.last_case_area.is_empty() {
                rt.send_to(
                    player_id,
                    json!({"t":"error","code":"no_case","message":"目前没有可调查的案件"}),
                );
                return;
            }
            if let Some(p) = rt.room.players.get_mut(player_id) {
                p.ability_ready_at = now + DETECTIVE_COOLDOWN_MS;
            }
            rt.send_to(player_id,json!({"t":"detective_result","targetId":t.id,"targetName":t.name,"area":t.last_case_area,"caseId":t.last_case_id}));
        }
        _ => return,
    }
    let state = rt
        .room
        .players
        .get(player_id)
        .map(|p| self_state(&rt.room, p))
        .unwrap_or(Value::Null);
    rt.send_to(player_id, json!({"t":"ability_ok","selfState":state}));
    rt.mark_dirty();
    rt.broadcast_state();
}

fn kill_player(rt: &mut RoomRuntime, killer_id: &str, target_id: &str) {
    let now = now_ms();
    let Some(k) = rt.room.players.get(killer_id).cloned() else {
        return;
    };
    if rt.room.phase != "playing" || !is_impostor(&k.role) || !k.alive || k.in_vent {
        return;
    }
    if now < k.kill_ready_at {
        rt.send_to(
            killer_id,
            json!({"t":"error","code":"kill_cooldown","message":"击杀冷却中"}),
        );
        return;
    }
    let Some(t) = rt.room.players.get(target_id).cloned() else {
        return;
    };
    if !t.connected
        || !t.alive
        || t.in_vent
        || t.id == k.id
        || is_impostor(&t.role)
        || dist(&k.pos, &t.pos) > 1.2
        || !can_see_player(&k.pos, &t.pos, rt.room.door_lock_until > now)
    {
        return;
    }
    if t.protected_until > now {
        if let Some(p) = rt.room.players.get_mut(killer_id) {
            p.kill_ready_at = now + 5000;
        }
        rt.send_to(
            killer_id,
            json!({"t":"kill_blocked","killReadyAt":now+5000}),
        );
        rt.send_to(target_id, json!({"t":"protected_hit"}));
        rt.mark_dirty();
        return;
    }
    let body_id = Uuid::new_v4().to_string();
    for q in rt.room.players.values_mut() {
        q.last_case_id = body_id.clone();
        q.last_case_area = area_code(q.pos.x, q.pos.y);
    }
    if let Some(p) = rt.room.players.get_mut(target_id) {
        p.alive = false;
        p.in_vent = false;
        p.vent_id.clear();
        p.vent_exit_at = 0;
        p.protected_until = 0;
    }
    rt.room.bodies.push(Body {
        id: body_id.clone(),
        player_id: t.id.clone(),
        name: t.name.clone(),
        color: t.color.clone(),
        x: t.pos.x,
        y: t.pos.y,
        created_at: now,
        dissolve_at: if k.role == "viper" {
            now + VIPER_DISSOLVE_MS
        } else {
            0
        },
    });
    if is_crew(&t.role) {
        let assigned = rt
            .room
            .players
            .values()
            .filter(|p| p.ghost_role == "guardian")
            .count() as i64;
        if assigned < rt.room.settings.guardian_angels {
            if let Some(p) = rt.room.players.get_mut(target_id) {
                p.ghost_role = "guardian".into();
                p.ability_ready_at = now + 5000;
            }
        }
    }
    if let Some(p) = rt.room.players.get_mut(killer_id) {
        p.kill_ready_at = now + rt.room.settings.kill_cooldown * 1000;
    }
    let st = rt
        .room
        .players
        .get(target_id)
        .map(|p| self_state(&rt.room, p))
        .unwrap_or(Value::Null);
    rt.send_to(target_id, json!({"t":"killed","selfState":st}));
    if t.role == "noisemaker" {
        for p in rt.room.players.values() {
            if p.id != t.id && is_crew(&p.role) {
                rt.send_to(&p.id,json!({"t":"noisemaker","playerId":t.id,"x":t.pos.x,"y":t.pos.y,"until":now+6000}));
            }
        }
    }
    let kr = rt
        .room
        .players
        .get(killer_id)
        .map(|p| p.kill_ready_at)
        .unwrap_or(0);
    rt.send_to(killer_id, json!({"t":"kill_ok","killReadyAt":kr}));
    rt.broadcast(json!({"t":"bodies","bodies":rt.room.bodies}), None);
    rt.broadcast_state();
    rt.mark_dirty();
    check_win(rt, "kill");
}

fn start_meeting(rt: &mut RoomRuntime, player_id: &str, body_id: &str, reason: &str) {
    let now = now_ms();
    rt.room.phase = "meeting".into();
    rt.room.sabotage = None;
    rt.room.door_lock_until = 0;
    rt.room.sabotage_ready_at = now + rt.room.settings.sabotage_cooldown * 1000;
    for p in rt.room.players.values_mut() {
        if p.role == "engineer" && p.in_vent {
            p.vent_ready_at = now + ENGINEER_VENT_COOLDOWN_MS;
        }
        p.in_vent = false;
        p.vent_id.clear();
        p.vent_exit_at = 0;
        p.disguise_target_id.clear();
        p.hidden_until = 0;
        p.ability_until = 0;
    }
    let de = now + rt.room.settings.discussion * 1000;
    rt.room.meeting = Some(Meeting {
        id: Uuid::new_v4().to_string(),
        stage: if rt.room.settings.discussion > 0 {
            "discussion"
        } else {
            "voting"
        }
        .into(),
        caller_id: player_id.into(),
        body_id: body_id.into(),
        reason_text: reason.into(),
        discussion_ends_at: de,
        voting_ends_at: de + rt.room.settings.voting * 1000,
        votes: HashMap::new(),
        eligible_voters: rt
            .room
            .players
            .values()
            .filter(|p| p.alive && p.connected)
            .count(),
        result: None,
        resume_at: 0,
    });
    for p in rt.room.players.values() {
        if let Some(m) = &rt.room.meeting {
            rt.send_to(
                &p.id,
                json!({"t":"meeting","meeting":public_meeting(m,&p.id)}),
            );
        }
    }
    rt.broadcast_state();
    rt.mark_dirty();
}
fn report_body(rt: &mut RoomRuntime, player_id: &str, body_id: &str) {
    let Some(p) = rt.room.players.get(player_id).cloned() else {
        return;
    };
    if rt.room.phase != "playing" || !p.alive || p.in_vent {
        return;
    }
    let Some(b) = rt.room.bodies.iter().find(|b| b.id == body_id).cloned() else {
        return;
    };
    if ((p.pos.x - b.x).powi(2) + (p.pos.y - b.y).powi(2)).sqrt() > 1.7 {
        return;
    }
    start_meeting(
        rt,
        player_id,
        &b.id,
        &format!("{} 报告了 {} 的尸体", p.name, b.name),
    );
}
fn call_emergency(rt: &mut RoomRuntime, player_id: &str) {
    let Some(p) = rt.room.players.get(player_id).cloned() else {
        return;
    };
    if rt.room.phase != "playing"
        || !p.alive
        || p.in_vent
        || p.emergency_used >= rt.room.settings.emergency_meetings
    {
        return;
    }
    if rt.room.sabotage.is_some() {
        rt.send_to(
            player_id,
            json!({"t":"error","code":"sabotage_active","message":"破坏期间不能召开紧急会议"}),
        );
        return;
    }
    let Some(s) = object(EMERGENCY_STATION) else {
        return;
    };
    if ((p.pos.x - s.x).powi(2) + (p.pos.y - s.y).powi(2)).sqrt() > 1.6 {
        return;
    }
    if let Some(x) = rt.room.players.get_mut(player_id) {
        x.emergency_used += 1;
    }
    start_meeting(rt, player_id, "", &format!("{} 召开了紧急会议", p.name));
}
fn cast_vote(rt: &mut RoomRuntime, player_id: &str, target: &str) {
    let now = now_ms();
    let Some(p) = rt.room.players.get(player_id) else {
        return;
    };
    if rt.room.phase != "meeting" || !p.alive || !p.connected {
        return;
    }
    let Some(m) = rt.room.meeting.as_ref() else {
        return;
    };
    if m.stage != "voting" || now >= m.voting_ends_at || m.votes.contains_key(player_id) {
        return;
    }
    if target != "skip"
        && !rt
            .room
            .players
            .get(target)
            .map(|p| p.alive)
            .unwrap_or(false)
    {
        return;
    }
    if let Some(m) = rt.room.meeting.as_mut() {
        m.votes.insert(player_id.into(), target.into());
        m.eligible_voters = rt
            .room
            .players
            .values()
            .filter(|p| p.alive && p.connected)
            .count();
    }
    rt.mark_dirty();
    if let Some(m) = &rt.room.meeting {
        for p in rt.room.players.values() {
            rt.send_to(
                &p.id,
                json!({"t":"meeting","meeting":public_meeting(m,&p.id)}),
            );
        }
    }
    let all = rt
        .room
        .players
        .values()
        .filter(|p| p.alive && p.connected)
        .all(|p| {
            rt.room
                .meeting
                .as_ref()
                .map(|m| m.votes.contains_key(&p.id))
                .unwrap_or(false)
        });
    if all {
        resolve_meeting(rt);
    }
}
fn resolve_meeting(rt: &mut RoomRuntime) {
    if rt.room.phase != "meeting"
        || rt.room.meeting.as_ref().map(|m| m.stage.as_str()) != Some("voting")
    {
        return;
    }
    let votes = rt.room.meeting.as_ref().unwrap().votes.clone();
    let mut counts: HashMap<String, i64> = HashMap::new();
    counts.insert("skip".into(), 0);
    for target in votes.values() {
        *counts.entry(target.clone()).or_insert(0) += 1;
    }
    let mut top = 0;
    let mut winners = vec![];
    for (id, n) in &counts {
        if id == "skip" {
            continue;
        }
        if *n > top {
            top = *n;
            winners = vec![id.clone()];
        } else if *n == top && *n > 0 {
            winners.push(id.clone());
        }
    }
    let skip = *counts.get("skip").unwrap_or(&0);
    let tie = winners.len() > 1 || (winners.len() == 1 && top == skip && top > 0);
    let ejected = if winners.len() == 1 && top > skip {
        rt.room.players.get(&winners[0]).cloned()
    } else {
        None
    };
    if let Some(e) = &ejected {
        if let Some(p) = rt.room.players.get_mut(&e.id) {
            p.alive = false;
        }
    }
    let text = if let Some(e) = &ejected {
        format!(
            "{} 被放逐了。{}",
            e.name,
            if rt.room.settings.confirm_ejects {
                if is_impostor(&e.role) {
                    "TA 是内鬼。"
                } else {
                    "TA 不是内鬼。"
                }
            } else {
                ""
            }
        )
    } else if tie {
        "票数持平，无人被放逐。".into()
    } else if skip > 0 && skip >= top {
        "跳过票占优，无人被放逐。".into()
    } else {
        "无人被放逐。".into()
    };
    let result = json!({"text":text,"ejectedId":ejected.as_ref().map(|e|e.id.clone()).unwrap_or_default(),"tie":tie,"counts":counts,"votes":votes});
    if let Some(m) = rt.room.meeting.as_mut() {
        m.stage = "result".into();
        m.result = Some(result);
        m.resume_at = now_ms() + 6500;
    }
    if let Some(m) = &rt.room.meeting {
        for p in rt.room.players.values() {
            rt.send_to(
                &p.id,
                json!({"t":"meeting_result","meeting":public_meeting(m,&p.id)}),
            );
        }
    }
    rt.broadcast_state();
    rt.mark_dirty();
}
fn resume_after_meeting(rt: &mut RoomRuntime) {
    if rt.room.phase != "meeting"
        || rt.room.meeting.as_ref().map(|m| m.stage.as_str()) != Some("result")
    {
        return;
    }
    if check_win(rt, "vote") {
        return;
    }
    let now = now_ms();
    rt.room.phase = "playing".into();
    rt.room.meeting = None;
    rt.room.bodies.clear();
    let ids: Vec<String> = rt.room.players.keys().cloned().collect();
    for (i, id) in ids.iter().enumerate() {
        if let Some(p) = rt.room.players.get_mut(id) {
            p.pos = spawn(i);
            p.move_seq = p.move_seq.saturating_add(1);
            p.last_move_at = now;
            p.in_vent = false;
            p.vent_id.clear();
            p.vent_exit_at = 0;
            if is_impostor(&p.role) && p.alive {
                p.kill_ready_at =
                    now + POST_MEETING_KILL_COOLDOWN_MS.min(rt.room.settings.kill_cooldown * 1000);
            }
        }
    }
    for p in rt.room.players.values() {
        rt.send_to(&p.id,json!({"t":"resume_play","players":public_players(&rt.room),"selfState":self_state(&rt.room,p)}));
    }
    rt.broadcast_state();
    rt.mark_dirty();
}

fn start_sabotage(rt: &mut RoomRuntime, player_id: &str, kind: &str) {
    let now = now_ms();
    let Some(p) = rt.room.players.get(player_id).cloned() else {
        return;
    };
    if rt.room.phase != "playing" || !is_impostor(&p.role) || !p.alive || p.in_vent {
        return;
    }
    if now < rt.room.sabotage_ready_at {
        rt.send_to(
            player_id,
            json!({"t":"error","code":"sabotage_cooldown","message":"破坏冷却中"}),
        );
        return;
    }
    if kind == "doors" {
        if rt.room.sabotage.is_some() {
            rt.send_to(player_id,json!({"t":"error","code":"sabotage_active","message":"关键破坏进行中，暂时不能封锁门禁"}));
            return;
        }
        rt.room.door_lock_until = now + DOOR_LOCK_MS;
        rt.room.sabotage_ready_at = now + rt.room.settings.sabotage_cooldown * 1000;
        rt.broadcast(json!({"t":"doors","until":rt.room.door_lock_until}), None);
        rt.broadcast_state();
        rt.mark_dirty();
        return;
    }
    let Some(d) = sabotage_def(kind) else {
        return;
    };
    if rt.room.sabotage.is_some() {
        rt.send_to(
            player_id,
            json!({"t":"error","code":"sabotage_active","message":"已有破坏正在进行"}),
        );
        return;
    }
    rt.room.sabotage = Some(Sabotage {
        kind: kind.into(),
        started_at: now,
        ends_at: if d.duration_ms > 0 {
            now + d.duration_ms
        } else {
            0
        },
        fixed_stations: vec![],
    });
    if let Some(s) = &rt.room.sabotage {
        rt.broadcast(json!({"t":"sabotage","sabotage":public_sabotage(s)}), None);
    }
    rt.broadcast_state();
    rt.mark_dirty();
}
fn fix_sabotage(rt: &mut RoomRuntime, player_id: &str, station: &str) {
    let Some(p) = rt.room.players.get(player_id).cloned() else {
        return;
    };
    if rt.room.phase != "playing" || !p.alive || p.in_vent {
        return;
    }
    let Some(s) = rt.room.sabotage.clone() else {
        return;
    };
    let Some(d) = sabotage_def(&s.kind) else {
        return;
    };
    if !d.stations.contains(&station) || s.fixed_stations.iter().any(|x| x == station) {
        return;
    }
    let Some(o) = object(station) else {
        return;
    };
    if ((p.pos.x - o.x).powi(2) + (p.pos.y - o.y).powi(2)).sqrt() > 1.7 {
        return;
    }
    if let Some(s) = rt.room.sabotage.as_mut() {
        s.fixed_stations.push(station.into());
    }
    let done = d.stations.iter().all(|id| {
        rt.room
            .sabotage
            .as_ref()
            .map(|s| s.fixed_stations.iter().any(|x| x == id))
            .unwrap_or(false)
    });
    if done {
        rt.room.sabotage = None;
        rt.room.sabotage_ready_at = now_ms() + rt.room.settings.sabotage_cooldown * 1000;
        rt.broadcast(json!({"t":"sabotage","sabotage":Value::Null}), None);
        rt.broadcast(
            json!({"t":"notice","text":format!("{} 已修复",d.label)}),
            None,
        );
        rt.broadcast_state();
    } else {
        if let Some(s) = &rt.room.sabotage {
            rt.broadcast(json!({"t":"sabotage","sabotage":public_sabotage(s)}), None);
        }
        rt.broadcast_state();
        rt.send_to(player_id, json!({"t":"repair_ok","stationId":station}));
    }
    rt.mark_dirty();
}
fn handle_vent(rt: &mut RoomRuntime, player_id: &str, action: &str, vent_id: &str) {
    let now = now_ms();
    let Some(p0) = rt.room.players.get(player_id).cloned() else {
        return;
    };
    let engineer = p0.role == "engineer";
    if rt.room.phase != "playing" || !(is_impostor(&p0.role) || engineer) || !p0.alive {
        return;
    }
    match action {
        "enter" => {
            if p0.in_vent {
                return;
            }
            if engineer && now < p0.vent_ready_at {
                rt.send_to(
                    player_id,
                    json!({"t":"error","code":"vent_cooldown","message":"通风管冷却中"}),
                );
                return;
            }
            let Some(v) = vent(vent_id) else {
                return;
            };
            if ((p0.pos.x - v.x).powi(2) + (p0.pos.y - v.y).powi(2)).sqrt() > 1.15 {
                return;
            }
            if let Some(p) = rt.room.players.get_mut(player_id) {
                p.in_vent = true;
                p.vent_id = v.id.into();
                p.pos = Pos { x: v.x, y: v.y };
                p.move_seq = p.move_seq.saturating_add(1);
                p.last_move_at = now;
                if engineer {
                    p.vent_exit_at = now + ENGINEER_VENT_MAX_MS;
                }
            }
        }
        "travel" => {
            if !p0.in_vent {
                return;
            }
            let Some(from) = vent(&p0.vent_id) else {
                return;
            };
            let Some(to) = vent(vent_id) else {
                return;
            };
            if !from.links.contains(&to.id) {
                return;
            }
            if let Some(p) = rt.room.players.get_mut(player_id) {
                p.vent_id = to.id.into();
                p.pos = Pos { x: to.x, y: to.y };
                p.move_seq = p.move_seq.saturating_add(1);
                p.last_move_at = now;
            }
        }
        "exit" => {
            if !p0.in_vent {
                return;
            }
            let Some(v) = vent(&p0.vent_id) else {
                return;
            };
            if let Some(p) = rt.room.players.get_mut(player_id) {
                p.in_vent = false;
                p.vent_id.clear();
                p.pos = Pos { x: v.x, y: v.y };
                p.move_seq = p.move_seq.saturating_add(1);
                p.last_move_at = now;
                if engineer {
                    p.vent_exit_at = 0;
                    p.vent_ready_at = now + ENGINEER_VENT_COOLDOWN_MS;
                }
            }
        }
        _ => return,
    }
    if let Some(p) = rt.room.players.get(player_id) {
        rt.send_to(player_id,json!({"t":"vent_state","id":p.id,"x":p.pos.x,"y":p.pos.y,"moveSeq":p.move_seq,"inVent":p.in_vent,"ventId":p.vent_id,"ventReadyAt":p.vent_ready_at,"ventExitAt":p.vent_exit_at}));
        rt.broadcast(
            json!({"t":"vent_state","id":p.id,"x":p.pos.x,"y":p.pos.y,"moveSeq":p.move_seq,"inVent":p.in_vent}),
            Some(player_id),
        );
    }
    rt.mark_dirty();
}
fn return_to_lobby(rt: &mut RoomRuntime, reason: &str) {
    if rt.room.phase == "lobby" {
        return;
    }
    rt.room.phase = "lobby".into();
    rt.room.restart_vote = None;
    rt.room.winner.clear();
    rt.room.reason.clear();
    rt.room.started_at = 0;
    rt.room.ended_at = 0;
    rt.room.meeting = None;
    rt.room.bodies.clear();
    rt.room.sabotage = None;
    rt.room.door_lock_until = 0;
    rt.room.sabotage_ready_at = 0;
    let ids: Vec<String> = rt.room.players.keys().cloned().collect();
    for (i, id) in ids.iter().enumerate() {
        if let Some(p) = rt.room.players.get_mut(id) {
            p.role.clear();
            p.ghost_role.clear();
            p.alive = true;
            p.tasks.clear();
            p.fake_tasks.clear();
            p.completed.clear();
            p.kill_ready_at = 0;
            p.ability_ready_at = 0;
            p.ability_until = 0;
            p.disguise_target_id.clear();
            p.hidden_until = 0;
            p.tracked_id.clear();
            p.track_until = 0;
            p.vent_ready_at = 0;
            p.vent_exit_at = 0;
            p.protected_until = 0;
            p.last_case_id.clear();
            p.last_case_area.clear();
            p.poisoned_by.clear();
            p.poison_ends_at = 0;
            p.emergency_used = 0;
            p.in_vent = false;
            p.vent_id.clear();
            p.active_task = None;
            p.pos = spawn(i);
            p.move_seq = p.move_seq.saturating_add(1);
            p.last_move_at = now_ms();
        }
    }
    rt.broadcast(
        json!({"t":"lobby_reset","players":public_players(&rt.room),"reason":reason}),
        None,
    );
    rt.broadcast_state();
    rt.mark_dirty();
}
fn reset_lobby(rt: &mut RoomRuntime, player_id: &str) {
    if rt.room.phase != "ended"
        || !rt
            .room
            .players
            .get(player_id)
            .map(|p| p.connected)
            .unwrap_or(false)
    {
        return;
    }
    return_to_lobby(rt, "本局已结束");
}
fn cast_restart_vote(rt: &mut RoomRuntime, player_id: &str) {
    let connected_player = rt
        .room
        .players
        .get(player_id)
        .map(|p| p.connected)
        .unwrap_or(false);
    if !connected_player || !matches!(rt.room.phase.as_str(), "playing" | "meeting") {
        return;
    }
    let now = now_ms();
    if rt
        .room
        .restart_vote
        .as_ref()
        .map(|v| v.expires_at <= now)
        .unwrap_or(true)
    {
        rt.room.restart_vote = Some(RestartVote {
            id: Uuid::new_v4().to_string(),
            votes: HashMap::new(),
            expires_at: now + 30_000,
        });
    }
    if let Some(v) = rt.room.restart_vote.as_mut() {
        v.votes.insert(player_id.into(), true);
    }
    let connected: Vec<_> = rt.room.players.values().filter(|p| p.connected).collect();
    let votes = rt
        .room
        .restart_vote
        .as_ref()
        .map(|v| {
            connected
                .iter()
                .filter(|p| v.votes.get(&p.id).copied().unwrap_or(false))
                .count()
        })
        .unwrap_or(0);
    let needed = connected.len() / 2 + 1;
    if votes >= needed {
        rt.broadcast(
            json!({"t":"notice","text":"重开投票通过，返回等待室"}),
            None,
        );
        return_to_lobby(rt, "多数玩家同意重新开始");
        return;
    }
    rt.broadcast_state();
    rt.mark_dirty();
}

fn process_message(rt: &mut RoomRuntime, player_id: &str, conn_id: &str, text: &str) -> bool {
    let current = rt
        .room
        .players
        .get(player_id)
        .map(|p| p.connection_id == conn_id)
        .unwrap_or(false);
    if !current {
        rt.send_to(
            player_id,
            json!({"t":"error","code":"session_invalid","message":"会话已失效"}),
        );
        return false;
    }
    if let Some(p) = rt.room.players.get_mut(player_id) {
        p.connected = true;
        p.last_seen = now_ms();
    }
    let Ok(msg) = serde_json::from_str::<Value>(text) else {
        return true;
    };
    let Some(t) = msg.get("t").and_then(Value::as_str) else {
        return true;
    };
    if t == "transport_ready" {
        let direct = msg.get("direct").and_then(Value::as_bool).unwrap_or(false);
        let generation = msg.get("generation").and_then(Value::as_u64).unwrap_or(0);
        let mut changed = false;
        if let Some(p) = rt.room.players.get_mut(player_id) {
            if generation >= p.transport_generation {
                changed = p.direct_ready != direct || p.transport_generation != generation;
                p.direct_ready = direct;
                p.transport_generation = generation;
            }
        }
        if changed {
            rt.broadcast_state();
        }
        return true;
    }
    let direct_required = matches!(rt.room.phase.as_str(), "playing" | "meeting")
        && rt
            .room
            .players
            .get(player_id)
            .map(|p| !p.direct_ready)
            .unwrap_or(true);
    if direct_required && !matches!(t, "leave" | "voice_state") {
        return true;
    }
    match t {
        "ping" => {
            let echo = msg.get("at").cloned().unwrap_or(Value::Null);
            let seq = msg.get("seq").cloned().unwrap_or(Value::Null);
            rt.send_to(
                player_id,
                json!({"t":"pong","at":echo,"seq":seq,"serverAt":now_ms()}),
            );
        }
        "chat" => {
            let text = sanitize_text(msg.get("text").and_then(Value::as_str).unwrap_or(""));
            if text.is_empty() {
                return true;
            }
            let now = now_ms();
            let Some(p) = rt.room.players.get(player_id).cloned() else {
                return true;
            };
            let meeting = rt.room.phase == "meeting"
                && rt
                    .room
                    .meeting
                    .as_ref()
                    .map(|m| matches!(m.stage.as_str(), "discussion" | "voting" | "result"))
                    .unwrap_or(false);
            if rt.room.phase == "playing" && p.alive && !meeting {
                return true;
            }
            if now - p.last_chat_at < 300 {
                return true;
            }
            if let Some(x) = rt.room.players.get_mut(player_id) {
                x.last_chat_at = now;
            }
            let ghost = rt.room.phase == "playing" && !p.alive;
            let payload = json!({"t":"chat","playerId":p.id,"name":p.name,"text":text,"at":now,"dead":ghost,"channel":if ghost{"ghost"}else if meeting{"meeting"}else{"room"}});
            if ghost {
                for q in rt.room.players.values() {
                    if !q.alive {
                        rt.send_to(&q.id, payload.clone());
                    }
                }
            } else {
                rt.broadcast(payload, None);
            }
        }
        "pos" => {
            let Some(p0) = rt.room.players.get(player_id).cloned() else {
                return true;
            };
            if rt.room.phase != "playing" || p0.in_vent {
                return true;
            }
            let Some(x) = msg.get("x").and_then(Value::as_f64) else {
                return true;
            };
            let Some(y) = msg.get("y").and_then(Value::as_f64) else {
                return true;
            };
            let now = now_ms();
            if x < PLAYER_RADIUS
                || y < PLAYER_RADIUS
                || x > MAP_SIZE as f64 - PLAYER_RADIUS
                || y > MAP_SIZE as f64 - PLAYER_RADIUS
                || (p0.alive
                    && circle_hits_wall(x, y, PLAYER_RADIUS, rt.room.door_lock_until > now))
            {
                rt.send_to(player_id, json!({"t":"correct","x":p0.pos.x,"y":p0.pos.y}));
                return true;
            }
            let dt = clamp((now - p0.last_move_at) as f64 / 1000.0, 0.016, 0.35);
            let maxd = rt.room.settings.move_speed * dt + 0.7;
            if ((x - p0.pos.x).powi(2) + (y - p0.pos.y).powi(2)).sqrt() > maxd {
                rt.send_to(player_id, json!({"t":"correct","x":p0.pos.x,"y":p0.pos.y}));
                return true;
            }
            if let Some(p) = rt.room.players.get_mut(player_id) {
                p.pos = Pos { x, y };
                p.last_move_at = now;
                p.move_seq = p.move_seq.saturating_add(1);
            }
            let move_seq = rt
                .room
                .players
                .get(player_id)
                .map(|p| p.move_seq)
                .unwrap_or(0);
            rt.broadcast(
                json!({"t":"pos","id":player_id,"x":x,"y":y,"moveSeq":move_seq,"alive":p0.alive,"inVent":false}),
                Some(player_id),
            );
            rt.mark_dirty();
        }
        "kick" => {
            if rt.room.host_id != player_id || rt.room.phase != "lobby" {
                return true;
            }
            let id = msg
                .get("id")
                .and_then(Value::as_str)
                .unwrap_or("")
                .to_string();
            if id.is_empty() || id == player_id || !rt.room.players.contains_key(&id) {
                return true;
            }
            let name = rt
                .room
                .players
                .get(&id)
                .map(|p| p.name.clone())
                .unwrap_or_default();
            rt.send_to(&id, json!({"t":"kicked"}));
            rt.close_client(&id, 4003, "kicked");
            rt.room.players.remove(&id);
            rt.clients.remove(&id);
            rt.voice_api_sessions.remove(&id);
            rt.broadcast(
                json!({"t":"notice","text":format!("{} 被移出了房间",name)}),
                None,
            );
            rt.broadcast_state();
            rt.mark_dirty();
        }
        "settings" => {
            if rt.room.host_id == player_id && rt.room.phase == "lobby" {
                let raw = msg
                    .get("settings")
                    .cloned()
                    .unwrap_or(Value::Object(Map::new()));
                rt.room.settings = normalize_settings(&raw, &rt.room.settings);
                rt.broadcast_state();
                rt.send_to(
                    player_id,
                    json!({"t":"settings_ok","settings":rt.room.settings}),
                );
                rt.mark_dirty();
            }
        }
        "music" => {
            let allowed = rt.room.settings.music_control != "host" || rt.room.host_id == player_id;
            if !allowed {
                rt.send_to(player_id,json!({"t":"action_fail","code":"music_forbidden","message":"当前仅房主可以切换音乐"}));
                return true;
            }
            let requested = msg
                .get("track")
                .and_then(Value::as_str)
                .unwrap_or(&rt.room.music.track)
                .trim()
                .chars()
                .take(80)
                .collect::<String>();
            if requested.contains('/')
                || requested.contains('\\')
                || requested.contains("..")
                || requested.chars().any(char::is_control)
            {
                rt.send_to(
                    player_id,
                    json!({"t":"action_fail","code":"music_invalid","message":"曲目名称无效"}),
                );
                return true;
            }
            let playing = msg
                .get("playing")
                .and_then(Value::as_bool)
                .unwrap_or(rt.room.music.playing);
            let position_ms = msg
                .get("positionMs")
                .and_then(Value::as_f64)
                .map(|v| v.round() as i64)
                .unwrap_or(rt.room.music.position_ms)
                .clamp(0, 24 * 60 * 60 * 1000);
            rt.room.music = MusicState {
                track: requested,
                playing,
                position_ms,
                changed_at: now_ms(),
            };
            rt.broadcast(json!({"t":"music","music":rt.room.music}), None);
            rt.mark_dirty();
        }
        "start" => start_game(rt, player_id),
        "task_begin" => begin_task(
            rt,
            player_id,
            msg.get("id").and_then(Value::as_str).unwrap_or(""),
        ),
        "task_complete" => finish_task(rt, player_id, &msg),
        "task" => complete_legacy_task(
            rt,
            player_id,
            msg.get("id").and_then(Value::as_str).unwrap_or(""),
        ),
        "profile" => {
            let raw = msg.get("avatar").and_then(Value::as_str).unwrap_or("");
            let avatar = sanitize_avatar(raw);
            if !raw.is_empty() && avatar.is_empty() {
                rt.send_to(player_id,json!({"t":"error","code":"avatar_invalid","message":"头像过大或格式不支持","close":false}));
                return true;
            }
            if let Some(p) = rt.room.players.get_mut(player_id) {
                p.avatar = avatar.clone();
                let animal = p.animal.clone();
                rt.broadcast(
                    json!({"t":"profile","id":player_id,"animal":animal,"avatar":avatar}),
                    None,
                );
            }
            rt.mark_dirty();
        }
        "voice_publish" => {
            let sid = msg
                .get("sessionId")
                .and_then(Value::as_str)
                .unwrap_or("")
                .chars()
                .take(128)
                .collect::<String>();
            let tn = msg
                .get("trackName")
                .and_then(Value::as_str)
                .unwrap_or("")
                .chars()
                .take(128)
                .collect::<String>();
            let owned = valid_voice_session_id(&sid)
                && rt
                    .voice_api_sessions
                    .get(player_id)
                    .map(|sessions| sessions.contains(&sid))
                    .unwrap_or(false);
            if !owned {
                rt.send_to(
                    player_id,
                    json!({"t":"error","code":"voice_session_invalid","message":"语音会话已失效，请重连语音","close":false}),
                );
                return true;
            }
            if !tn.is_empty() && tn.len() <= 128 && !tn.chars().any(char::is_control) {
                if let Some(p) = rt.room.players.get_mut(player_id) {
                    p.voice_session_id = sid;
                    p.voice_track_name = tn;
                    p.voice_enabled = msg.get("enabled").and_then(Value::as_bool).unwrap_or(true);
                }
                rt.broadcast_voice_directory();
                rt.mark_dirty();
            }
        }
        "voice_state" => {
            if let Some(p) = rt.room.players.get_mut(player_id) {
                p.voice_enabled = msg.get("enabled").and_then(Value::as_bool).unwrap_or(false);
            }
            rt.broadcast_voice_directory();
            rt.mark_dirty();
        }
        "ability" => use_ability(
            rt,
            player_id,
            msg.get("targetId").and_then(Value::as_str).unwrap_or(""),
        ),
        "kill" => kill_player(
            rt,
            player_id,
            msg.get("targetId").and_then(Value::as_str).unwrap_or(""),
        ),
        "report" => report_body(
            rt,
            player_id,
            msg.get("bodyId").and_then(Value::as_str).unwrap_or(""),
        ),
        "emergency" => call_emergency(rt, player_id),
        "vote" => cast_vote(
            rt,
            player_id,
            msg.get("target").and_then(Value::as_str).unwrap_or(""),
        ),
        "sabotage" => start_sabotage(
            rt,
            player_id,
            msg.get("kind").and_then(Value::as_str).unwrap_or(""),
        ),
        "sabotage_fix" => fix_sabotage(
            rt,
            player_id,
            msg.get("stationId").and_then(Value::as_str).unwrap_or(""),
        ),
        "vent" => handle_vent(
            rt,
            player_id,
            msg.get("action").and_then(Value::as_str).unwrap_or(""),
            msg.get("ventId").and_then(Value::as_str).unwrap_or(""),
        ),
        "restart_vote" => cast_restart_vote(rt, player_id),
        "reset" => reset_lobby(rt, player_id),
        "leave" => {
            rt.close_client(player_id, 1000, "leave");
            remove_player(rt, player_id, true);
            return false;
        }
        _ => {}
    }
    true
}

fn tick_room(rt: &mut RoomRuntime) {
    let now = now_ms();
    if rt
        .room
        .restart_vote
        .as_ref()
        .map(|v| v.expires_at <= now)
        .unwrap_or(false)
    {
        rt.room.restart_vote = None;
        rt.broadcast_state();
        rt.mark_dirty();
    }
    let changed = cleanup_expired(rt, now);
    let before = rt.room.bodies.len();
    rt.room
        .bodies
        .retain(|b| b.dissolve_at == 0 || now < b.dissolve_at);
    if rt.room.bodies.len() != before {
        rt.broadcast(json!({"t":"bodies","bodies":rt.room.bodies}), None);
        rt.broadcast_state();
        rt.mark_dirty();
    }
    let eng_ids: Vec<String> = rt
        .room
        .players
        .values()
        .filter(|p| {
            p.role == "engineer" && p.in_vent && p.vent_exit_at > 0 && now >= p.vent_exit_at
        })
        .map(|p| p.id.clone())
        .collect();
    for id in eng_ids {
        let vid = rt
            .room
            .players
            .get(&id)
            .map(|p| p.vent_id.clone())
            .unwrap_or_default();
        let v = vent(&vid);
        if let Some(p) = rt.room.players.get_mut(&id) {
            p.in_vent = false;
            p.vent_id.clear();
            p.vent_exit_at = 0;
            p.vent_ready_at = now + ENGINEER_VENT_COOLDOWN_MS;
            if let Some(v) = v {
                p.pos = Pos { x: v.x, y: v.y };
            }
            p.move_seq = p.move_seq.saturating_add(1);
        }
        if let Some(p) = rt.room.players.get(&id) {
            rt.send_to(&id,json!({"t":"vent_state","id":id,"x":p.pos.x,"y":p.pos.y,"moveSeq":p.move_seq,"inVent":false,"ventId":"","ventReadyAt":p.vent_ready_at}));
            rt.broadcast(
                json!({"t":"vent_state","id":id,"x":p.pos.x,"y":p.pos.y,"moveSeq":p.move_seq,"inVent":false}),
                Some(&id),
            );
        }
        rt.mark_dirty();
    }
    if rt.room.door_lock_until > 0 && now >= rt.room.door_lock_until {
        rt.room.door_lock_until = 0;
        rt.broadcast(json!({"t":"doors","until":0}), None);
        rt.broadcast_state();
        rt.mark_dirty();
    }
    if changed {
        rt.broadcast_state();
        check_win(rt, "leave");
    }
    if rt.room.phase == "playing" {
        if let Some(s) = rt.room.sabotage.clone() {
            if s.ends_at > 0 && now >= s.ends_at {
                let label = sabotage_def(&s.kind).map(|d| d.label).unwrap_or("关键破坏");
                end_game(rt, "impostor", &format!("{} 未能及时修复", label));
                return;
            }
        }
    }
    if rt.room.phase == "meeting" {
        let stage = rt
            .room
            .meeting
            .as_ref()
            .map(|m| m.stage.clone())
            .unwrap_or_default();
        if stage == "discussion"
            && rt
                .room
                .meeting
                .as_ref()
                .map(|m| now >= m.discussion_ends_at)
                .unwrap_or(false)
        {
            if let Some(m) = rt.room.meeting.as_mut() {
                m.stage = "voting".into();
                m.eligible_voters = rt
                    .room
                    .players
                    .values()
                    .filter(|p| p.alive && p.connected)
                    .count();
            }
            if let Some(m) = &rt.room.meeting {
                for p in rt.room.players.values() {
                    rt.send_to(
                        &p.id,
                        json!({"t":"meeting","meeting":public_meeting(m,&p.id)}),
                    );
                }
            }
            rt.mark_dirty();
        } else if stage == "voting"
            && rt
                .room
                .meeting
                .as_ref()
                .map(|m| now >= m.voting_ends_at)
                .unwrap_or(false)
        {
            resolve_meeting(rt);
        } else if stage == "result"
            && rt
                .room
                .meeting
                .as_ref()
                .map(|m| now >= m.resume_at)
                .unwrap_or(false)
        {
            resume_after_meeting(rt);
        }
    }
}

fn room_file(data_dir: &Path, room: &str) -> PathBuf {
    data_dir.join("rooms").join(format!("{}.json", room))
}
fn persist_room(data_dir: &Path, code: &str, room: &Room) -> std::io::Result<()> {
    let dir = data_dir.join("rooms");
    fs::create_dir_all(&dir)?;
    let path = room_file(data_dir, code);
    let tmp = dir.join(format!("{}.json.tmp", code));
    let bak = dir.join(format!("{}.json.bak", code));
    let bytes = serde_json::to_vec(room).map_err(std::io::Error::other)?;
    {
        let mut file = fs::File::create(&tmp)?;
        file.write_all(&bytes)?;
        file.sync_data()?;
    }
    if path.exists() {
        let _ = fs::remove_file(&bak);
        fs::rename(&path, &bak)?;
    }
    match fs::rename(&tmp, &path) {
        Ok(()) => {
            let _ = fs::remove_file(&bak);
            Ok(())
        }
        Err(e) => {
            if !path.exists() && bak.exists() {
                let _ = fs::rename(&bak, &path);
            }
            let _ = fs::remove_file(&tmp);
            Err(e)
        }
    }
}
fn load_room(data_dir: &Path, code: &str) -> Room {
    let p = room_file(data_dir, code);
    let bak = data_dir.join("rooms").join(format!("{}.json.bak", code));
    let load = |path: &Path| {
        fs::read(path)
            .ok()
            .and_then(|b| serde_json::from_slice::<Room>(&b).ok())
    };
    let mut room = load(&p).or_else(|| load(&bak)).unwrap_or_default();
    room.restore_transients();
    room
}
async fn get_room(state: &AppState, code: &str) -> Arc<Mutex<RoomRuntime>> {
    if let Some(r) = state.rooms.read().await.get(code).cloned() {
        return r;
    }
    let mut w = state.rooms.write().await;
    if let Some(r) = w.get(code).cloned() {
        return r;
    }
    let r = Arc::new(Mutex::new(RoomRuntime::new(load_room(
        &state.data_dir,
        code,
    ))));
    w.insert(code.into(), r.clone());
    r
}

#[derive(Deserialize)]
struct WsQuery {
    room: String,
    #[serde(default)]
    name: String,
    #[serde(default)]
    create: String,
    #[serde(default)]
    token: String,
    #[serde(default, rename = "client")]
    client_instance: String,
    #[serde(default, rename = "handoff")]
    handoff_instance: String,
    #[serde(default, rename = "v")]
    _v: String,
    #[serde(default, rename = "map")]
    map_id: String,
}
fn origin_allowed(headers: &HeaderMap, allowed_origin: &str) -> bool {
    headers
        .get("origin")
        .and_then(|v| v.to_str().ok())
        .map(|v| v == allowed_origin)
        .unwrap_or(false)
}

async fn ws_handler(
    ws: WebSocketUpgrade,
    Query(q): Query<WsQuery>,
    State(state): State<AppState>,
    headers: HeaderMap,
) -> Response {
    if !origin_allowed(&headers, state.allowed_origin.as_str()) {
        return (StatusCode::FORBIDDEN, "Forbidden origin").into_response();
    }
    let client_ip = connecting_ip(&headers);
    ws.max_message_size(MAX_WS_MESSAGE_BYTES)
        .max_frame_size(MAX_WS_MESSAGE_BYTES)
        .on_upgrade(move |socket| handle_socket(socket, q, state, client_ip))
}
struct WsConnGuard(Arc<AtomicUsize>);
impl Drop for WsConnGuard {
    fn drop(&mut self) {
        self.0.fetch_sub(1, Ordering::Relaxed);
    }
}

struct IpConnGuard {
    ip: String,
    counts: Arc<StdMutex<HashMap<String, usize>>>,
}
impl Drop for IpConnGuard {
    fn drop(&mut self) {
        let mut counts = self.counts.lock().unwrap_or_else(|e| e.into_inner());
        if let Some(count) = counts.get_mut(&self.ip) {
            *count = count.saturating_sub(1);
            if *count == 0 {
                counts.remove(&self.ip);
            }
        }
    }
}

fn connecting_ip(headers: &HeaderMap) -> String {
    headers
        .get("cf-connecting-ip")
        .and_then(|v| v.to_str().ok())
        .filter(|v| !v.is_empty() && v.len() <= 64)
        .unwrap_or("unknown")
        .to_string()
}

async fn handle_socket(mut socket: WebSocket, q: WsQuery, state: AppState, client_ip: String) {
    let active = state.active_ws.fetch_add(1, Ordering::Relaxed) + 1;
    if active > MAX_CONCURRENT_WS {
        state.active_ws.fetch_sub(1, Ordering::Relaxed);
        let _ = socket
            .send(Message::Text(
                json!({"t":"error","code":"server_busy","message":"服务器连接数已满，请稍后重试"})
                    .to_string(),
            ))
            .await;
        let _ = socket.close().await;
        return;
    }
    let _connection_guard = WsConnGuard(state.active_ws.clone());
    if q.map_id != MAP_PROTOCOL_ID {
        let _ = socket
            .send(Message::Text(
                json!({"t":"error","code":"version_mismatch","message":"客户端版本已过期，请刷新页面"})
                    .to_string(),
            ))
            .await;
        let _ = socket.close().await;
        return;
    }
    let ip_active = {
        let mut counts = state
            .ip_connections
            .lock()
            .unwrap_or_else(|e| e.into_inner());
        let count = counts.entry(client_ip.clone()).or_insert(0);
        *count += 1;
        *count
    };
    let _ip_guard = IpConnGuard {
        ip: client_ip,
        counts: state.ip_connections.clone(),
    };
    if ip_active > MAX_WS_PER_IP {
        let _ = socket
            .send(Message::Text(
                json!({"t":"error","code":"ip_connection_limit","message":"同一网络连接过多，请稍后重试"}).to_string(),
            ))
            .await;
        let _ = socket.close().await;
        return;
    }
    if q.room.len() != 2 || !q.room.chars().all(|c| c.is_ascii_digit()) {
        let _ = socket
            .send(Message::Text(
                json!({"t":"error","code":"bad_room","message":"房间号格式错误"}).to_string(),
            ))
            .await;
        let _ = socket.close().await;
        return;
    }
    let name = sanitize_name(&q.name);
    let client_instance_id = sanitize_client_instance_id(&q.client_instance);
    let handoff_instance_id = sanitize_client_instance_id(&q.handoff_instance);
    let room_arc = get_room(&state, &q.room).await;
    let (tx, mut rx) = mpsc::channel::<Outgoing>(WS_OUTBOX_CAPACITY);
    let (connection_id, player_id);
    {
        let mut rt = room_arc.lock().await;
        let now = now_ms();
        cleanup_expired(&mut rt, now);
        if rt.room.initialized && rt.room.players.is_empty() {
            reset_if_empty(&mut rt.room);
        }
        let mut player_opt = if !q.token.is_empty() {
            rt.room
                .players
                .values()
                .find(|p| p.token == q.token)
                .cloned()
        } else {
            None
        };
        let mut resumed = false;
        if let Some(p) = &player_opt {
            if p.connected {
                let same_instance = !client_instance_id.is_empty()
                    && !p.client_instance_id.is_empty()
                    && p.client_instance_id == client_instance_id;
                let legacy_unbound = p.client_instance_id.is_empty();
                let valid_handoff = !client_instance_id.is_empty()
                    && client_instance_id != p.client_instance_id
                    && !handoff_instance_id.is_empty()
                    && handoff_instance_id == p.client_instance_id;
                if !(same_instance || legacy_unbound || valid_handoff) {
                    let _ = socket
                        .send(Message::Text(
                            json!({"t":"error","code":"session_in_use","message":"这个会话正在另一实例中使用，将作为新玩家加入"})
                                .to_string(),
                        ))
                        .await;
                    let _ = socket.close().await;
                    return;
                }
            }
            if now - p.last_seen <= RECONNECT_GRACE_MS || p.connected {
                if let Some(old) = rt.clients.get(&p.id) {
                    let _ = old.tx.try_send(Outgoing::Close(4002, "replaced".into()));
                }
                resumed = true;
            } else {
                rt.room.players.remove(&p.id);
                player_opt = None;
            }
        }
        if player_opt.is_none() {
            if !requested_name_valid(&name) {
                let _ = socket
                    .send(Message::Text(
                        json!({"t":"error","code":"name_invalid","message":"昵称不能以数字结尾；重名时系统会自动添加数字"})
                            .to_string(),
                    ))
                    .await;
                let _ = socket.close().await;
                return;
            }
            let create = q.create == "1";
            if create && rt.room.initialized && !rt.room.players.is_empty() {
                let _ = socket
                    .send(Message::Text(
                        json!({"t":"error","code":"room_exists","message":"房间号已存在"})
                            .to_string(),
                    ))
                    .await;
                let _ = socket.close().await;
                return;
            }
            if !create && !rt.room.initialized {
                let _ = socket
                    .send(Message::Text(
                        json!({"t":"error","code":"room_not_found","message":"房间不存在"})
                            .to_string(),
                    ))
                    .await;
                let _ = socket.close().await;
                return;
            }
            if rt.room.phase != "lobby" {
                let _=socket.send(Message::Text(json!({"t":"error","code":"game_in_progress","message":"游戏已经开始，只能用原会话重连"}).to_string())).await;
                let _ = socket.close().await;
                return;
            }
            if rt.room.players.len() >= MAX_PLAYERS {
                let _ = socket
                    .send(Message::Text(
                        json!({"t":"error","code":"room_full","message":"房间已满"}).to_string(),
                    ))
                    .await;
                let _ = socket.close().await;
                return;
            }
            if create && !rt.room.initialized {
                rt.room.initialized = true;
                rt.room.created_at = now;
            }
            let id = Uuid::new_v4().to_string();
            let p = Player {
                id: id.clone(),
                token: Uuid::new_v4().to_string(),
                client_instance_id: client_instance_id.clone(),
                name: unique_player_name(&rt.room, &name),
                color: next_color(&rt.room),
                animal: next_animal(&rt.room),
                avatar: String::new(),
                pos: spawn(rt.room.players.len()),
                move_seq: 0,
                direct_ready: false,
                transport_generation: 0,
                connected: true,
                connection_id: String::new(),
                joined_at: now,
                last_seen: now,
                last_move_at: now,
                last_chat_at: 0,
                role: String::new(),
                ghost_role: String::new(),
                alive: true,
                tasks: vec![],
                fake_tasks: vec![],
                completed: vec![],
                kill_ready_at: 0,
                ability_ready_at: 0,
                ability_until: 0,
                disguise_target_id: String::new(),
                hidden_until: 0,
                tracked_id: String::new(),
                track_until: 0,
                vent_ready_at: 0,
                vent_exit_at: 0,
                protected_until: 0,
                last_case_id: String::new(),
                last_case_area: String::new(),
                poisoned_by: String::new(),
                poison_ends_at: 0,
                voice_session_id: String::new(),
                voice_track_name: String::new(),
                voice_enabled: false,
                emergency_used: 0,
                in_vent: false,
                vent_id: String::new(),
                active_task: None,
            };
            rt.room.players.insert(id.clone(), p);
            if rt.room.host_id.is_empty() {
                rt.room.host_id = id.clone();
            }
            player_opt = rt.room.players.get(&id).cloned();
        }
        let mut p = player_opt.unwrap();
        if resumed {
            p.token = Uuid::new_v4().to_string();
        }
        if !client_instance_id.is_empty() {
            p.client_instance_id = client_instance_id.clone();
        }
        let prev = rt.room.host_id.clone();
        connection_id = Uuid::new_v4().to_string();
        p.connected = true;
        p.direct_ready = false;
        p.transport_generation = 0;
        p.connection_id = connection_id.clone();
        p.last_seen = now;
        rt.room.players.insert(p.id.clone(), p.clone());
        if !rt
            .room
            .players
            .get(&rt.room.host_id)
            .map(|x| x.connected)
            .unwrap_or(false)
        {
            elect_host(&mut rt.room);
        }
        player_id = p.id.clone();
        rt.clients.insert(
            player_id.clone(),
            ClientConn {
                connection_id: connection_id.clone(),
                tx: tx.clone(),
            },
        );
        announce_host_change(&rt, &prev);
        rt.send_to(&player_id,json!({"t":"welcome","room":q.room,"mapId":MAP_PROTOCOL_ID,"resumed":resumed,"self":{"id":p.id,"token":p.token,"name":p.name},"features":{"bushVision":true,"mapManifest":"/maps/east-beach-v1.json","musicSync":true,"roomIdentityV2":true,"serverPrimaryV2":true},"hostId":rt.room.host_id,"players":public_players(&rt.room),"profiles":profiles(&rt.room),"voices":voice_directory(&rt.room,Some(&p)),"bodies":rt.room.bodies,"game":public_game(&rt.room,&p.id),"selfState":self_state(&rt.room,&p)}));
        if !resumed {
            rt.broadcast(
                json!({"t":"notice","text":format!("{} 加入了房间",p.name)}),
                Some(&player_id),
            );
        }
        rt.broadcast_state();
        rt.mark_dirty();
    }
    let (mut ws_tx, mut ws_rx) = socket.split();
    let room_for_loop = room_arc.clone();
    let mut rate_window = Instant::now();
    let mut rate_count = 0u32;
    let mut idle_tick = tokio::time::interval(Duration::from_secs(15));
    idle_tick.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Delay);
    loop {
        tokio::select! {
            _ = idle_tick.tick() => {
                let stale = {
                    let rt = room_for_loop.lock().await;
                    rt.room.players
                        .get(&player_id)
                        .filter(|p| p.connection_id == connection_id)
                        .map(|p| now_ms() - p.last_seen > WS_IDLE_TIMEOUT_MS)
                        .unwrap_or(true)
                };
                if stale {
                    let _ = ws_tx
                        .send(Message::Close(Some(CloseFrame {
                            code: 4001,
                            reason: "idle timeout".into(),
                        })))
                        .await;
                    break;
                }
            }
            out = rx.recv() => {
                match out {
                    Some(Outgoing::Text(s)) => {
                        if ws_tx.send(Message::Text(s)).await.is_err() { break; }
                    }
                    Some(Outgoing::Close(code, reason)) => {
                        let _ = ws_tx.send(Message::Close(Some(CloseFrame { code, reason: reason.into() }))).await;
                        break;
                    }
                    None => break,
                }
            }
            incoming = ws_rx.next() => {
                let message = match incoming {
                    Some(Ok(m)) => m,
                    Some(Err(_)) | None => break,
                };
                let is_app_message = matches!(&message, Message::Text(_) | Message::Binary(_));
                if is_app_message {
                    if rate_window.elapsed() >= Duration::from_secs(1) {
                        rate_window = Instant::now();
                        rate_count = 0;
                    }
                    rate_count += 1;
                    if rate_count > MAX_WS_MESSAGES_PER_SEC {
                        let _ = ws_tx.send(Message::Close(Some(CloseFrame { code: 4008, reason: "rate limit".into() }))).await;
                        break;
                    }
                }
                match message {
                    Message::Text(t) => {
                        if t.len() > MAX_WS_MESSAGE_BYTES {
                            let _ = ws_tx.send(Message::Close(Some(CloseFrame { code: 1009, reason: "message too large".into() }))).await;
                            break;
                        }
                        let mut rt = room_for_loop.lock().await;
                        if !process_message(&mut rt, &player_id, &connection_id, &t) { break; }
                    }
                    Message::Binary(b) => {
                        if b.len() > MAX_WS_MESSAGE_BYTES {
                            let _ = ws_tx.send(Message::Close(Some(CloseFrame { code: 1009, reason: "message too large".into() }))).await;
                            break;
                        }
                        if let Ok(t) = String::from_utf8(b.to_vec()) {
                            let mut rt = room_for_loop.lock().await;
                            if !process_message(&mut rt, &player_id, &connection_id, &t) { break; }
                        }
                    }
                    Message::Ping(p) => { let _ = ws_tx.send(Message::Pong(p)).await; }
                    Message::Close(_) => break,
                    _ => {}
                }
            }
        }
    }
    let mut rt = room_arc.lock().await;
    let is_current = rt
        .room
        .players
        .get(&player_id)
        .map(|p| p.connection_id == connection_id)
        .unwrap_or(false);
    if is_current {
        let prev = rt.room.host_id.clone();
        if let Some(p) = rt.room.players.get_mut(&player_id) {
            p.connected = false;
            p.last_seen = now_ms();
            p.connection_id.clear();
            p.voice_enabled = false;
        }
        if rt.clients.get(&player_id).map(|c| c.connection_id.as_str())
            == Some(connection_id.as_str())
        {
            rt.clients.remove(&player_id);
        }
        if player_id == prev && rt.room.players.values().any(|p| p.connected) {
            elect_host(&mut rt.room);
        }
        announce_host_change(&rt, &prev);
        rt.broadcast_voice_directory();
        rt.broadcast_state();
        rt.mark_dirty();
    }
}

async fn health(State(state): State<AppState>) -> Json<Value> {
    Json(
        json!({"ok":true,"service":"d1-realtime-pc","version":"2.8.6-music-map","voice":!state.calls_app_id.is_empty()&&!state.calls_secret.is_empty(),"backend":"rust+cloudflared"}),
    )
}
#[derive(Deserialize)]
struct RoomQuery {
    room: String,
}
fn cors_headers(origin: &str) -> HeaderMap {
    let mut h = HeaderMap::new();
    if let Ok(value) = HeaderValue::from_str(origin) {
        h.insert("access-control-allow-origin", value);
    }
    h.insert(
        "access-control-allow-headers",
        HeaderValue::from_static("content-type,x-dtam-token"),
    );
    h.insert(
        "access-control-allow-methods",
        HeaderValue::from_static("POST,PUT,OPTIONS"),
    );
    h.insert("vary", HeaderValue::from_static("Origin"));
    h
}

fn parse_voice_path<'a>(path: &'a str, method: &Method) -> Option<(&'static str, Option<&'a str>)> {
    let parts: Vec<&str> = path.trim_matches('/').split('/').collect();
    match parts.as_slice() {
        ["sessions", "new"] if *method == Method::POST => Some(("new", None)),
        ["sessions", sid, "tracks", "new"]
            if *method == Method::POST && valid_voice_session_id(sid) =>
        {
            Some(("tracks", Some(*sid)))
        }
        ["sessions", sid, "renegotiate"]
            if *method == Method::PUT && valid_voice_session_id(sid) =>
        {
            Some(("renegotiate", Some(*sid)))
        }
        _ => None,
    }
}
fn valid_voice_session_id(s: &str) -> bool {
    !s.is_empty()
        && s.len() <= 128
        && s.bytes()
            .all(|b| b.is_ascii_alphanumeric() || b == b'-' || b == b'_')
}

async fn voice_handler(
    State(state): State<AppState>,
    method: Method,
    axum::extract::Path(path): axum::extract::Path<String>,
    Query(q): Query<RoomQuery>,
    headers: HeaderMap,
    body: Bytes,
) -> Response {
    let cors = cors_headers(state.allowed_origin.as_str());
    if !origin_allowed(&headers, state.allowed_origin.as_str()) {
        return (StatusCode::FORBIDDEN, cors, "Forbidden origin").into_response();
    }
    if method == Method::OPTIONS {
        return (StatusCode::NO_CONTENT, cors).into_response();
    }
    if q.room.len() != 2 || !q.room.chars().all(|c| c.is_ascii_digit()) {
        return (StatusCode::BAD_REQUEST, cors, "Bad room").into_response();
    }
    let Some((kind, path_session_id)) = parse_voice_path(&path, &method) else {
        return (StatusCode::METHOD_NOT_ALLOWED, cors, "Not allowed").into_response();
    };
    let room_arc = get_room(&state, &q.room).await;
    let token = headers
        .get("x-dtam-token")
        .and_then(|v| v.to_str().ok())
        .unwrap_or("");
    let (player_id, allowed_voice);
    {
        let rt = room_arc.lock().await;
        let Some(p) = rt
            .room
            .players
            .values()
            .find(|p| p.token == token && p.connected)
        else {
            return (StatusCode::FORBIDDEN, cors, "Forbidden").into_response();
        };
        player_id = p.id.clone();
        allowed_voice = voice_directory(&rt.room, Some(p))
            .iter()
            .filter_map(|v| {
                Some(format!(
                    "{}|{}",
                    v.get("sessionId")?.as_str()?,
                    v.get("trackName")?.as_str()?
                ))
            })
            .collect::<HashSet<_>>();
    }
    if state.calls_app_id.is_empty() || state.calls_secret.is_empty() {
        return (StatusCode::SERVICE_UNAVAILABLE, cors, "Voice unavailable").into_response();
    }
    let now = now_ms();
    let rate_key = format!("{}:{}", q.room, player_id);
    {
        let mut rates = state.voice_rates.lock().await;
        let r = rates.entry(rate_key).or_default();
        if now - r.short_window_start >= 10_000 {
            r.short_window_start = now;
            r.short_count = 0;
        }
        r.short_count += 1;
        if r.short_count > VOICE_API_CALLS_PER_10S {
            return (StatusCode::TOO_MANY_REQUESTS, cors, "Voice rate limit").into_response();
        }
        if kind == "new" {
            if now - r.new_window_start >= 60_000 {
                r.new_window_start = now;
                r.new_count = 0;
            }
            r.new_count += 1;
            if r.new_count > VOICE_NEW_SESSIONS_PER_MIN {
                return (
                    StatusCode::TOO_MANY_REQUESTS,
                    cors,
                    "Voice session rate limit",
                )
                    .into_response();
            }
        }
    }
    if let Some(sid) = path_session_id {
        let mut grants = state.voice_sessions.lock().await;
        grants.retain(|_, g| now - g.last_used <= VOICE_GRANT_TTL_MS);
        let allowed = grants
            .get_mut(sid)
            .filter(|g| g.room == q.room && g.player_id == player_id);
        let Some(grant) = allowed else {
            return (StatusCode::FORBIDDEN, cors, "Voice session forbidden").into_response();
        };
        grant.last_used = now;
    }
    if kind == "tracks" && !body.is_empty() {
        let payload = match serde_json::from_slice::<Value>(&body) {
            Ok(v) => v,
            Err(_) => return (StatusCode::BAD_REQUEST, cors, "Invalid JSON").into_response(),
        };
        if payload
            .get("tracks")
            .and_then(Value::as_array)
            .map(|a| {
                a.iter().any(|t| {
                    t.get("location").and_then(Value::as_str) == Some("remote")
                        && !allowed_voice.contains(&format!(
                            "{}|{}",
                            t.get("sessionId").and_then(Value::as_str).unwrap_or(""),
                            t.get("trackName").and_then(Value::as_str).unwrap_or("")
                        ))
                })
            })
            .unwrap_or(false)
        {
            return (StatusCode::FORBIDDEN, cors, "Voice track forbidden").into_response();
        }
    }
    let suffix = format!("/{}", path);
    let url = format!(
        "https://rtc.live.cloudflare.com/v1/apps/{}{}",
        state.calls_app_id, suffix
    );
    let mut req = state
        .http
        .request(method.clone(), url)
        .bearer_auth(state.calls_secret.as_str())
        .header("content-type", "application/json");
    if method == Method::POST || method == Method::PUT {
        req = req.body(body.to_vec());
    }
    match req.send().await {
        Ok(up) => {
            let status =
                StatusCode::from_u16(up.status().as_u16()).unwrap_or(StatusCode::BAD_GATEWAY);
            let ct = up.headers().get("content-type").cloned();
            let bytes = up.bytes().await.unwrap_or_default();
            if kind == "new" && status.is_success() {
                if let Ok(v) = serde_json::from_slice::<Value>(&bytes) {
                    if let Some(sid) = v
                        .get("sessionId")
                        .and_then(Value::as_str)
                        .filter(|s| valid_voice_session_id(s))
                    {
                        state.voice_sessions.lock().await.insert(
                            sid.to_string(),
                            VoiceSessionGrant {
                                room: q.room.clone(),
                                player_id: player_id.clone(),
                                last_used: now,
                            },
                        );
                        let mut rt = room_arc.lock().await;
                        let sessions = rt.voice_api_sessions.entry(player_id.clone()).or_default();
                        if sessions.len() >= 32 {
                            sessions.clear();
                        }
                        sessions.insert(sid.to_string());
                    }
                }
            }
            let mut resp = (status, cors, bytes).into_response();
            if let Some(ct) = ct {
                resp.headers_mut().insert("content-type", ct);
            }
            resp
        }
        Err(e) => {
            eprintln!("voice upstream error: {}", e);
            (StatusCode::BAD_GATEWAY, cors, "Voice upstream unavailable").into_response()
        }
    }
}

async fn background(state: AppState) {
    let mut tick = tokio::time::interval(Duration::from_millis(250));
    let mut flush_counter = 0u32;
    loop {
        tick.tick().await;
        let rooms: Vec<(String, Arc<Mutex<RoomRuntime>>)> = state
            .rooms
            .read()
            .await
            .iter()
            .map(|(k, v)| (k.clone(), v.clone()))
            .collect();
        for (_, r) in &rooms {
            let mut rt = r.lock().await;
            tick_room(&mut rt);
        }
        flush_counter += 1;
        if flush_counter >= 20 {
            flush_counter = 0;
            for (code, r) in &rooms {
                let snapshot = {
                    let mut rt = r.lock().await;
                    if rt.dirty {
                        rt.dirty = false;
                        Some(rt.room.clone())
                    } else {
                        None
                    }
                };
                let Some(room) = snapshot else {
                    continue;
                };
                let data_dir = state.data_dir.clone();
                let code_owned = code.clone();
                let write_result = tokio::task::spawn_blocking(move || {
                    persist_room(data_dir.as_ref().as_path(), &code_owned, &room)
                })
                .await;
                let failed = match write_result {
                    Ok(Ok(())) => false,
                    Ok(Err(e)) => {
                        eprintln!("persist {} failed: {}", code, e);
                        true
                    }
                    Err(e) => {
                        eprintln!("persist {} task failed: {}", code, e);
                        true
                    }
                };
                if failed {
                    r.lock().await.dirty = true;
                }
            }
        }
    }
}

#[tokio::main(flavor = "current_thread")]
async fn main() {
    let config_path =
        std::env::var("DTAM_CONFIG").unwrap_or_else(|_| r"D:\server\config\server.json".into());
    let cfg: Config = fs::read(&config_path)
        .ok()
        .and_then(|b| serde_json::from_slice(&b).ok())
        .unwrap_or(Config {
            bind: default_bind(),
            data_dir: default_data_dir(),
            calls_app_id: String::new(),
            calls_secret: String::new(),
            allowed_origin: default_allowed_origin(),
        });
    let data_dir = PathBuf::from(&cfg.data_dir);
    fs::create_dir_all(data_dir.join("rooms")).expect("create data dir");
    let state = AppState {
        rooms: Arc::new(RwLock::new(HashMap::new())),
        data_dir: Arc::new(data_dir),
        calls_app_id: Arc::new(cfg.calls_app_id),
        calls_secret: Arc::new(cfg.calls_secret),
        allowed_origin: Arc::new(cfg.allowed_origin),
        voice_sessions: Arc::new(Mutex::new(HashMap::new())),
        voice_rates: Arc::new(Mutex::new(HashMap::new())),
        active_ws: Arc::new(AtomicUsize::new(0)),
        ip_connections: Arc::new(StdMutex::new(HashMap::new())),
        http: Client::builder()
            .pool_idle_timeout(Duration::from_secs(60))
            .build()
            .expect("http client"),
    };
    tokio::spawn(background(state.clone()));
    let app = Router::new()
        .route("/health", get(health))
        .route("/ws", get(ws_handler))
        .route("/voice/*path", any(voice_handler))
        .layer(DefaultBodyLimit::max(MAX_VOICE_BODY_BYTES))
        .with_state(state);
    let addr: SocketAddr = cfg.bind.parse().expect("invalid bind");
    println!("dtam-server 2.8 listening on {}", addr);
    let listener = tokio::net::TcpListener::bind(addr).await.expect("bind");
    axum::serve(listener, app)
        .with_graceful_shutdown(async {
            let _ = tokio::signal::ctrl_c().await;
        })
        .await
        .expect("server");
}
