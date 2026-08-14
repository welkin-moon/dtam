use async_trait::async_trait;
use axum::{
    Json, Router,
    extract::{
        RawQuery, State,
        ws::{Message as AxumMessage, WebSocket, WebSocketUpgrade},
    },
    http::{HeaderMap, StatusCode, header::ORIGIN},
    response::{IntoResponse, Response},
    routing::get,
};
use bytes::BytesMut;
use futures_util::{SinkExt, StreamExt};
use serde::Deserialize;
use serde_json::{Value, json};
use std::{
    collections::HashSet,
    env,
    error::Error,
    fs, io,
    net::{IpAddr, SocketAddr},
    path::PathBuf,
    sync::{
        Arc,
        atomic::{AtomicUsize, Ordering},
    },
    time::Duration,
};
use tokio::{
    net::TcpListener,
    sync::{RwLock, mpsc},
    time::{sleep, timeout},
};
use tokio_tungstenite::{
    connect_async,
    tungstenite::{Message as TungsteniteMessage, client::IntoClientRequest, http::HeaderValue},
};
use webrtc::{
    data_channel::{DataChannel, DataChannelEvent},
    peer_connection::{
        PeerConnection, PeerConnectionBuilder, PeerConnectionEventHandler, RTCConfigurationBuilder,
        RTCIceGatheringState, RTCIceServer, RTCPeerConnectionState, RTCSessionDescription,
    },
};

const VERSION: &str = "3.0.0";
const MAX_EDGE_SESSIONS: usize = 64;
const MAX_SIGNAL_MESSAGE_BYTES: usize = 128 * 1024;
const MAX_APP_MESSAGE_BYTES: usize = 16 * 1024;
const MAX_ICE_BIND_ADDRS: usize = 8;
const SIGNAL_QUEUE: usize = 384;
const CORE_QUEUE: usize = 256;
const ICE_GATHER_WAIT: Duration = Duration::from_secs(6);
const SIGNAL_KEEPALIVE: Duration = Duration::from_secs(20);
const DIRECT_LIVENESS_POLL: Duration = Duration::from_millis(500);

type AnyError = Box<dyn Error + Send + Sync>;

#[derive(Clone, Deserialize)]
#[serde(default)]
struct Config {
    listen: String,
    core_ws: String,
    allowed_origins: Vec<String>,
    stun_servers: Vec<String>,
    udp_bind: Vec<String>,
    node_id: String,
}

impl Default for Config {
    fn default() -> Self {
        Self {
            listen: "127.0.0.1:28729".into(),
            core_ws: "ws://127.0.0.1:28727/ws".into(),
            allowed_origins: vec!["https://d1.lunarlab.uk".into()],
            stun_servers: vec!["stun:stun.cloudflare.com:3478".into()],
            udp_bind: vec!["0.0.0.0:0".into(), "[::]:0".into()],
            node_id: "shanghai-a".into(),
        }
    }
}

#[derive(Clone)]
struct AppState {
    config: Arc<Config>,
    active_sessions: Arc<AtomicUsize>,
}

#[derive(Default)]
struct RtcChannels {
    control: Option<Arc<dyn DataChannel>>,
    fast: Option<Arc<dyn DataChannel>>,
}

impl RtcChannels {
    fn direct_ready(&self) -> bool {
        self.control.is_some() && self.fast.is_some()
    }
}

#[derive(Clone)]
struct EdgePeerHandler {
    channels: Arc<RwLock<RtcChannels>>,
    core_tx: mpsc::Sender<String>,
    signal_tx: mpsc::Sender<String>,
    gather_tx: mpsc::Sender<()>,
    rtc_generation: Arc<AtomicUsize>,
    generation: usize,
}

#[async_trait]
impl PeerConnectionEventHandler for EdgePeerHandler {
    async fn on_ice_gathering_state_change(&self, state: RTCIceGatheringState) {
        if self.rtc_generation.load(Ordering::Acquire) != self.generation {
            return;
        }
        if state == RTCIceGatheringState::Complete {
            let _ = self.gather_tx.try_send(());
        }
    }

    async fn on_connection_state_change(&self, state: RTCPeerConnectionState) {
        if self.rtc_generation.load(Ordering::Acquire) != self.generation {
            return;
        }
        if matches!(
            state,
            RTCPeerConnectionState::Failed | RTCPeerConnectionState::Closed
        ) {
            let _ = self.signal_tx.try_send(
                json!({"__v3":"transport","mode":"fallback","reason":format!("peer {state}")})
                    .to_string(),
            );
        }
    }

    async fn on_data_channel(&self, dc: Arc<dyn DataChannel>) {
        if self.rtc_generation.load(Ordering::Acquire) != self.generation {
            let _ = dc.close().await;
            return;
        }
        let label = dc.label().await.unwrap_or_default();
        if label != "dtam-control" && label != "dtam-fast" {
            let _ = dc.close().await;
            return;
        }

        let channels = Arc::clone(&self.channels);
        let core_tx = self.core_tx.clone();
        let signal_tx = self.signal_tx.clone();
        let rtc_generation = Arc::clone(&self.rtc_generation);
        let generation = self.generation;
        tokio::spawn(async move {
            let channel_id = dc.id();
            loop {
                if rtc_generation.load(Ordering::Acquire) != generation {
                    let _ = dc.close().await;
                    break;
                }
                match dc.poll().await {
                    Some(DataChannelEvent::OnOpen) => {
                        if rtc_generation.load(Ordering::Acquire) != generation {
                            let _ = dc.close().await;
                            break;
                        }
                        let direct = {
                            let mut locked = channels.write().await;
                            if label == "dtam-control" {
                                locked.control = Some(Arc::clone(&dc));
                            } else {
                                locked.fast = Some(Arc::clone(&dc));
                            }
                            locked.direct_ready()
                        };
                        if direct {
                            let _ = signal_tx
                                .try_send(json!({"__v3":"transport","mode":"direct"}).to_string());
                        }
                    }
                    Some(DataChannelEvent::OnMessage(message)) => {
                        if rtc_generation.load(Ordering::Acquire) != generation {
                            break;
                        }
                        if message.data.len() > MAX_APP_MESSAGE_BYTES {
                            continue;
                        }
                        let text = String::from_utf8_lossy(&message.data).into_owned();
                        if core_tx.send(text).await.is_err() {
                            break;
                        }
                    }
                    Some(DataChannelEvent::OnClose) | None => {
                        if rtc_generation.load(Ordering::Acquire) == generation {
                            let mut locked = channels.write().await;
                            if label == "dtam-control" {
                                locked.control = None;
                            } else {
                                locked.fast = None;
                            }
                            drop(locked);
                            let _ = signal_tx.try_send(
                                json!({
                                    "__v3":"transport",
                                    "mode":"fallback",
                                    "reason":format!("data channel {label}/{channel_id} closed")
                                })
                                .to_string(),
                            );
                        }
                        break;
                    }
                    _ => {}
                }
            }
        });
    }
}

fn load_config() -> Result<Config, AnyError> {
    let path = env::var_os("DTAM_EDGE_CONFIG")
        .map(PathBuf::from)
        .unwrap_or_else(|| PathBuf::from("config/edge.json"));
    match fs::read_to_string(&path) {
        Ok(raw) => Ok(serde_json::from_str(&raw)?),
        Err(err) if err.kind() == io::ErrorKind::NotFound => Ok(Config::default()),
        Err(err) => Err(err.into()),
    }
}

fn origin_from_headers(headers: &HeaderMap, config: &Config) -> Option<String> {
    let origin = headers.get(ORIGIN)?.to_str().ok()?.to_owned();
    config
        .allowed_origins
        .iter()
        .any(|allowed| allowed == &origin)
        .then_some(origin)
}

fn connecting_ip_from_headers(headers: &HeaderMap) -> String {
    headers
        .get("cf-connecting-ip")
        .and_then(|value| value.to_str().ok())
        .and_then(|value| value.parse::<IpAddr>().ok())
        .map(|ip| ip.to_string())
        .unwrap_or_else(|| "unknown".into())
}

fn useful_ice_ip(ip: IpAddr) -> bool {
    match ip {
        IpAddr::V4(ip) => {
            !ip.is_loopback()
                && !ip.is_unspecified()
                && !ip.is_multicast()
                && !ip.is_link_local()
                && ip.octets() != [255, 255, 255, 255]
        }
        IpAddr::V6(ip) => {
            !ip.is_loopback()
                && !ip.is_unspecified()
                && !ip.is_multicast()
                && !ip.is_unicast_link_local()
        }
    }
}

fn ice_ip_priority(ip: IpAddr) -> u8 {
    match ip {
        IpAddr::V4(ip) if ip.is_private() => 0,
        IpAddr::V6(ip) if ip.segments()[0] & 0xfe00 == 0xfc00 => 1,
        IpAddr::V6(_) => 2,
        IpAddr::V4(_) => 3,
    }
}

fn current_udp_bind_addrs(fallback: Vec<String>) -> Vec<String> {
    let mut unique = HashSet::new();
    let mut addresses = Vec::<(u8, String)>::new();

    if let Ok(interfaces) = if_addrs::get_if_addrs() {
        for interface in interfaces {
            if !interface.is_oper_up() {
                continue;
            }
            let ip = interface.ip();
            if !useful_ice_ip(ip) || !unique.insert(ip) {
                continue;
            }
            addresses.push((ice_ip_priority(ip), SocketAddr::new(ip, 0).to_string()));
        }
    }

    addresses.sort_by(|left, right| left.0.cmp(&right.0).then_with(|| left.1.cmp(&right.1)));
    let selected: Vec<String> = addresses
        .into_iter()
        .take(MAX_ICE_BIND_ADDRS)
        .map(|(_, address)| address)
        .collect();

    if selected.is_empty() {
        fallback
    } else {
        selected
    }
}

async fn health(State(state): State<AppState>) -> Json<Value> {
    Json(json!({
        "ok": true,
        "service": "dtam-edge",
        "version": VERSION,
        "nodeId": state.config.node_id,
        "transport": "webrtc-datachannel+tunnel-fallback",
        "activeSessions": state.active_sessions.load(Ordering::Relaxed),
        "core": state.config.core_ws,
        "addressing": "dynamic-interface-ice",
    }))
}

async fn edge_upgrade(
    State(state): State<AppState>,
    RawQuery(raw_query): RawQuery,
    headers: HeaderMap,
    ws: WebSocketUpgrade,
) -> Response {
    let Some(origin) = origin_from_headers(&headers, &state.config) else {
        return StatusCode::FORBIDDEN.into_response();
    };
    let connecting_ip = connecting_ip_from_headers(&headers);
    if state.active_sessions.load(Ordering::Relaxed) >= MAX_EDGE_SESSIONS {
        return (StatusCode::SERVICE_UNAVAILABLE, "edge_session_limit").into_response();
    }
    let query = raw_query.unwrap_or_default();
    if query.len() > 4096 {
        return (StatusCode::BAD_REQUEST, "query_too_large").into_response();
    }

    ws.max_message_size(MAX_SIGNAL_MESSAGE_BYTES)
        .on_upgrade(move |socket| edge_session(socket, query, origin, connecting_ip, state))
        .into_response()
}

async fn edge_session(
    socket: WebSocket,
    query: String,
    origin: String,
    connecting_ip: String,
    state: AppState,
) {
    state.active_sessions.fetch_add(1, Ordering::Relaxed);
    let node = state.config.node_id.clone();
    if let Err(err) = run_edge_session(socket, query, origin, connecting_ip, state.clone()).await {
        eprintln!("[dtam-edge:{node}] session ended: {err}");
    }
    state.active_sessions.fetch_sub(1, Ordering::Relaxed);
}

async fn run_edge_session(
    signal_socket: WebSocket,
    query: String,
    origin: String,
    connecting_ip: String,
    state: AppState,
) -> Result<(), AnyError> {
    let core_url = if query.is_empty() {
        state.config.core_ws.clone()
    } else {
        format!("{}?{}", state.config.core_ws, query)
    };
    let mut request = core_url.into_client_request()?;
    request
        .headers_mut()
        .insert("Origin", HeaderValue::from_str(&origin)?);
    request
        .headers_mut()
        .insert("cf-connecting-ip", HeaderValue::from_str(&connecting_ip)?);
    let (core_socket, _) = connect_async(request).await?;

    let (mut signal_sink, mut signal_stream) = signal_socket.split();
    let (mut core_sink, mut core_stream) = core_socket.split();
    let (signal_tx, mut signal_rx) = mpsc::channel::<String>(SIGNAL_QUEUE);
    let (core_tx, mut core_rx) = mpsc::channel::<String>(CORE_QUEUE);
    let (done_tx, mut done_rx) = mpsc::channel::<()>(2);
    let channels = Arc::new(RwLock::new(RtcChannels::default()));
    let rtc_generation = Arc::new(AtomicUsize::new(0));

    let signal_writer = tokio::spawn(async move {
        while let Some(text) = signal_rx.recv().await {
            if signal_sink
                .send(AxumMessage::Text(text.into()))
                .await
                .is_err()
            {
                break;
            }
        }
    });

    let keepalive_tx = signal_tx.clone();
    let signal_keepalive = tokio::spawn(async move {
        loop {
            sleep(SIGNAL_KEEPALIVE).await;
            if keepalive_tx
                .send(json!({"__v3":"info","keepalive":true}).to_string())
                .await
                .is_err()
            {
                break;
            }
        }
    });

    let core_writer_done = done_tx.clone();
    let core_writer = tokio::spawn(async move {
        while let Some(text) = core_rx.recv().await {
            if core_sink
                .send(TungsteniteMessage::Text(text.into()))
                .await
                .is_err()
            {
                break;
            }
        }
        let _ = core_writer_done.try_send(());
    });

    signal_tx
        .send(
            json!({
                "__v3":"ready",
                "version":VERSION,
                "nodeId":state.config.node_id,
                "rtc":true,
                "dynamicIce":true
            })
            .to_string(),
        )
        .await?;

    let core_reader_channels = Arc::clone(&channels);
    let core_reader_signal = signal_tx.clone();
    let core_reader_done = done_tx.clone();
    let core_reader = tokio::spawn(async move {
        while let Some(message) = core_stream.next().await {
            let Ok(message) = message else { break };
            match message {
                TungsteniteMessage::Text(text) => {
                    let text = text.to_string();
                    send_app_to_browser(text, &core_reader_channels, &core_reader_signal).await;
                }
                TungsteniteMessage::Binary(bytes) => {
                    if bytes.len() <= MAX_APP_MESSAGE_BYTES {
                        let text = String::from_utf8_lossy(&bytes).into_owned();
                        send_app_to_browser(text, &core_reader_channels, &core_reader_signal).await;
                    }
                }
                TungsteniteMessage::Close(_) => break,
                _ => {}
            }
        }
        let _ = core_reader_done.try_send(());
    });

    let mut peer: Option<Arc<dyn PeerConnection>> = None;
    let mut signaling_lost_with_direct = false;

    loop {
        tokio::select! {
            _ = done_rx.recv() => break,
            incoming = signal_stream.next() => {
                let incoming = match incoming {
                    Some(Ok(message)) => message,
                    Some(Err(_)) | None => {
                        signaling_lost_with_direct = channels.read().await.direct_ready();
                        break;
                    }
                };
                match incoming {
                    AxumMessage::Text(text) => {
                        if text.len() > MAX_SIGNAL_MESSAGE_BYTES {
                            break;
                        }
                        let text = text.to_string();
                        if let Some(control) = parse_control(&text) {
                            match control.kind.as_str() {
                                "ping" => {
                                    let _ = signal_tx.try_send(json!({"__v3":"pong"}).to_string());
                                }
                                "offer" => {
                                    let generation = rtc_generation.fetch_add(1, Ordering::AcqRel) + 1;
                                    if let Some(old_peer) = peer.take() {
                                        let _ = old_peer.close().await;
                                    }
                                    *channels.write().await = RtcChannels::default();
                                    match negotiate_peer(
                                        control.value.get("description").cloned(),
                                        Arc::clone(&channels),
                                        core_tx.clone(),
                                        signal_tx.clone(),
                                        Arc::clone(&rtc_generation),
                                        generation,
                                        &state.config,
                                    ).await {
                                        Ok(pc) => peer = Some(pc),
                                        Err(err) => {
                                            let _ = signal_tx.try_send(json!({
                                                "__v3":"transport",
                                                "mode":"fallback",
                                                "reason":format!("RTC negotiation failed: {err}")
                                            }).to_string());
                                        }
                                    }
                                }
                                _ => {}
                            }
                        } else if text.len() <= MAX_APP_MESSAGE_BYTES && core_tx.send(text).await.is_err() {
                            break;
                        }
                    }
                    AxumMessage::Binary(bytes) => {
                        if bytes.len() <= MAX_APP_MESSAGE_BYTES {
                            let text = String::from_utf8_lossy(&bytes).into_owned();
                            if core_tx.send(text).await.is_err() {
                                break;
                            }
                        }
                    }
                    AxumMessage::Close(_) => {
                        signaling_lost_with_direct = channels.read().await.direct_ready();
                        break;
                    }
                    _ => {}
                }
            }
        }
    }

    if signaling_lost_with_direct {
        loop {
            tokio::select! {
                _ = done_rx.recv() => break,
                _ = sleep(DIRECT_LIVENESS_POLL) => {
                    if !channels.read().await.direct_ready() {
                        break;
                    }
                }
            }
        }
    }

    rtc_generation.fetch_add(1, Ordering::AcqRel);
    if let Some(pc) = peer {
        let _ = pc.close().await;
    }
    core_reader.abort();
    core_writer.abort();
    signal_keepalive.abort();
    signal_writer.abort();
    Ok(())
}

struct ControlMessage {
    kind: String,
    value: Value,
}

fn parse_control(text: &str) -> Option<ControlMessage> {
    let value: Value = serde_json::from_str(text).ok()?;
    let kind = value.get("__v3")?.as_str()?.to_owned();
    Some(ControlMessage { kind, value })
}

fn is_fast_server_message(text: &str) -> bool {
    serde_json::from_str::<Value>(text)
        .ok()
        .and_then(|value| value.get("t").and_then(Value::as_str).map(str::to_owned))
        .is_some_and(|kind| kind == "pos" || kind == "pong")
}

async fn send_app_to_browser(
    text: String,
    channels: &Arc<RwLock<RtcChannels>>,
    signal_tx: &mpsc::Sender<String>,
) {
    let fast = is_fast_server_message(&text);
    let channel = {
        let locked = channels.read().await;
        if locked.direct_ready() {
            if fast {
                locked.fast.clone()
            } else {
                locked.control.clone()
            }
        } else {
            None
        }
    };

    if let Some(channel) = channel
        && channel.send(BytesMut::from(text.as_bytes())).await.is_ok()
    {
        return;
    }

    if fast {
        let _ = signal_tx.try_send(text);
    } else {
        let _ = signal_tx.send(text).await;
    }
}

async fn negotiate_peer(
    description: Option<Value>,
    channels: Arc<RwLock<RtcChannels>>,
    core_tx: mpsc::Sender<String>,
    signal_tx: mpsc::Sender<String>,
    rtc_generation: Arc<AtomicUsize>,
    generation: usize,
    config: &Config,
) -> Result<Arc<dyn PeerConnection>, AnyError> {
    let description = description.ok_or("missing RTC description")?;
    let offer: RTCSessionDescription = serde_json::from_value(description)?;
    let (gather_tx, mut gather_rx) = mpsc::channel::<()>(2);

    let handler = Arc::new(EdgePeerHandler {
        channels,
        core_tx,
        signal_tx: signal_tx.clone(),
        gather_tx,
        rtc_generation,
        generation,
    });
    let ice_servers = if config.stun_servers.is_empty() {
        Vec::new()
    } else {
        vec![RTCIceServer {
            urls: config.stun_servers.clone(),
            ..Default::default()
        }]
    };
    let fallback_udp_bind = config.udp_bind.clone();
    let udp_addrs =
        tokio::task::spawn_blocking(move || current_udp_bind_addrs(fallback_udp_bind)).await?;
    eprintln!(
        "[dtam-edge] ICE generation {generation} bind addresses: {}",
        udp_addrs.join(", ")
    );
    let pc = PeerConnectionBuilder::new()
        .with_configuration(
            RTCConfigurationBuilder::default()
                .with_ice_servers(ice_servers)
                .build(),
        )
        .with_handler(handler)
        .with_udp_addrs(udp_addrs)
        .with_data_channel_send_buffer_limit(1024 * 1024)
        .build()
        .await?;
    let pc: Arc<dyn PeerConnection> = Arc::new(pc);

    pc.set_remote_description(offer).await?;
    let answer = pc.create_answer(None).await?;
    pc.set_local_description(answer).await?;
    let _ = timeout(ICE_GATHER_WAIT, gather_rx.recv()).await;
    let local = pc
        .local_description()
        .await
        .ok_or("missing local RTC description")?;
    signal_tx
        .send(json!({"__v3":"answer","description":local}).to_string())
        .await?;
    Ok(pc)
}

#[tokio::main(flavor = "current_thread")]
async fn main() -> Result<(), AnyError> {
    let config = Arc::new(load_config()?);
    let listen: SocketAddr = config.listen.parse()?;
    let state = AppState {
        config: Arc::clone(&config),
        active_sessions: Arc::new(AtomicUsize::new(0)),
    };
    let app = Router::new()
        .route("/health", get(health))
        .route("/edge", get(edge_upgrade))
        .with_state(state);
    let listener = TcpListener::bind(listen).await?;
    println!(
        "dtam-edge v{VERSION} node={} listening on {} -> {}",
        config.node_id, config.listen, config.core_ws
    );
    axum::serve(listener, app)
        .with_graceful_shutdown(async {
            let _ = tokio::signal::ctrl_c().await;
        })
        .await?;
    Ok(())
}
