from pathlib import Path
import re

p = Path('server/src/main.rs')
s = p.read_text(encoding='utf-8')

s, n = re.subn(
    r'(fn reset_lobby\(rt: &mut RoomRuntime, player_id: &str\) \{\s*)if rt\.room\.host_id != player_id \|\| rt\.room\.phase != "ended" \{',
    r'\1// The host may abort an active round and return everyone to the existing lobby.\n    // Wire protocol stays unchanged: old clients can still send {t:"reset"}.\n    if rt.room.host_id != player_id || rt.room.phase == "lobby" {',
    s,
    count=1,
)
if n != 1:
    raise SystemExit(f'reset_lobby patch count={n}')

chat_start = s.find('        "chat" => {')
pos_start = s.find('        "pos" => {', chat_start)
if chat_start < 0 or pos_start < 0:
    raise SystemExit('chat structural anchors not found')

new_chat = '''        "chat" => {
            let text = sanitize_text(msg.get("text").and_then(Value::as_str).unwrap_or(""));
            if text.is_empty() {
                return true;
            }
            let now = now_ms();
            let Some(p) = rt.room.players.get(player_id).cloned() else {
                return true;
            };
            let in_game = matches!(rt.room.phase.as_str(), "playing" | "meeting");
            let meeting = rt.room.phase == "meeting"
                && rt
                    .room
                    .meeting
                    .as_ref()
                    .map(|m| matches!(m.stage.as_str(), "discussion" | "voting" | "result"))
                    .unwrap_or(false);

            let command = text.trim().to_ascii_lowercase();
            if p.id == rt.room.host_id
                && matches!(command.as_str(), "/重开" | "/重置" | "/restart" | "/rematch")
            {
                if rt.room.phase != "lobby" {
                    rt.broadcast(
                        json!({"t":"notice","text":"房主结束本局，返回等待室"}),
                        None,
                    );
                    reset_lobby(rt, player_id);
                }
                return true;
            }

            if in_game && p.alive && !meeting {
                return true;
            }
            if now - p.last_chat_at < 300 {
                return true;
            }
            if let Some(x) = rt.room.players.get_mut(player_id) {
                x.last_chat_at = now;
            }
            let ghost = in_game && !p.alive;
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
'''
s = s[:chat_start] + new_chat + s[pos_start:]

s, n = re.subn(
    r'("service":"d1-realtime-pc","version":)"2\.8"',
    r'\1"2.8.1-serverhotfix"',
    s,
    count=1,
)
if n != 1:
    raise SystemExit(f'health version patch count={n}')

p.write_text(s, encoding='utf-8')
