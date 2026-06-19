use chrono::Local;
use serde::{Deserialize, Serialize};
use std::fs::{create_dir_all, read_to_string, write};
use std::path::PathBuf;
use std::process::Command;
use std::sync::{Arc, Mutex};
use tauri::{Emitter, Manager, WindowEvent};
use tauri::menu::{Menu, MenuItem, Submenu};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use sysinfo::System;


#[derive(Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct RuntimeOptionsData {
    close_to_tray: bool,
    start_minimized: bool,
}

impl Default for RuntimeOptionsData {
    fn default() -> Self {
        Self { close_to_tray: true, start_minimized: false }
    }
}

type RuntimeOptions = Arc<Mutex<RuntimeOptionsData>>;

fn app_data_dir() -> PathBuf {
    let base = std::env::var("APPDATA")
        .or_else(|_| std::env::var("LOCALAPPDATA"))
        .unwrap_or_else(|_| ".".to_string());
    let dir = PathBuf::from(base).join("MillerAudioStudioX");
    let _ = create_dir_all(&dir);
    dir
}

fn runtime_settings_path() -> PathBuf {
    app_data_dir().join("runtime_settings.json")
}

fn load_runtime_options() -> RuntimeOptionsData {
    let path = runtime_settings_path();
    if let Ok(raw) = read_to_string(path) {
        serde_json::from_str(&raw).unwrap_or_default()
    } else {
        RuntimeOptionsData::default()
    }
}

fn save_runtime_options(options: &RuntimeOptionsData) {
    let _ = write(runtime_settings_path(), serde_json::to_string_pretty(options).unwrap_or_default());
}

fn set_windows_startup(enabled: bool) -> Result<(), String> {
    #[cfg(target_os = "windows")]
    {
        let exe = std::env::current_exe().map_err(|e| e.to_string())?;
        let exe_str = exe.display().to_string();
        if enabled {
            let cmd = format!(r#"reg add HKCU\Software\Microsoft\Windows\CurrentVersion\Run /v MillerAudioStudioX /t REG_SZ /d "{}" /f"#, exe_str);
            let out = Command::new("cmd.exe").args(["/C", &cmd]).output().map_err(|e| e.to_string())?;
            if !out.status.success() { return Err(String::from_utf8_lossy(&out.stderr).to_string()); }
        } else {
            let out = Command::new("cmd.exe").args(["/C", "reg", "delete", r#"HKCU\Software\Microsoft\Windows\CurrentVersion\Run"#, "/v", "MillerAudioStudioX", "/f"]).output().map_err(|e| e.to_string())?;
            if !out.status.success() {
                let stderr = String::from_utf8_lossy(&out.stderr).to_string();
                if !stderr.to_lowercase().contains("unable") && !stderr.to_lowercase().contains("não") { return Err(stderr); }
            }
        }
    }
    Ok(())
}

#[derive(Serialize, Clone, Default)]
#[serde(rename_all = "camelCase")]
struct AudioDevice {
    name: String,
    direction: String,
    status: String,
    id: String,
}

#[derive(Serialize, Clone, Default)]
#[serde(rename_all = "camelCase")]
struct AppProcess {
    app: String,
    process: String,
    pid: u32,
    title: String,
    ram_mb: f64,
    activity: u32,
    session: String,
    volume: u32,
}

#[derive(Serialize, Clone, Default)]
#[serde(rename_all = "camelCase")]
struct AudioSessionState {
    app: String,
    process: String,
    pid: u32,
    volume: u32,
    peak: u32,
    active: bool,
    route: String,
    device: String,
    #[serde(default)]
    source: String,
}

#[derive(Serialize, Default, Clone)]
#[serde(rename_all = "camelCase")]
struct HardwareState {
    inputs: Vec<AudioDevice>,
    outputs: Vec<AudioDevice>,
    preferred_input: Option<AudioDevice>,
    preferred_output: Option<AudioDevice>,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct PerformanceState {
    sample_rate: u32,
    buffer: u32,
    latency_ms: f64,
    input_latency_ms: f64,
    output_latency_ms: f64,
    round_trip_latency_ms: f64,
    cpu: u32,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct MillerState {
    ok: bool,
    timestamp: String,
    warning: String,
    hardware: HardwareState,
    apps: Vec<AppProcess>,
    performance: PerformanceState,
    logs_path: String,
    raw_device_lines: Vec<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct DebugReport {
    timestamp: String,
    ok: bool,
    logs_path: String,
    hardware: HardwareState,
    apps_count: usize,
    raw_device_lines: Vec<String>,
    warnings: Vec<String>,
}

fn clean(s: &str) -> String {
    s.replace('\r', "").replace('\n', " ").trim().to_string()
}

fn logs_dir() -> PathBuf {
    let dir = app_data_dir().join("logs");
    let _ = create_dir_all(&dir);
    dir
}

fn append_log(name: &str, content: &str) {
    use std::fs::OpenOptions;
    use std::io::Write as IoWrite;

    let path = logs_dir().join(name);
    if let Ok(mut file) = OpenOptions::new().create(true).append(true).open(path) {
        let _ = writeln!(file, "{} | {}", Local::now().format("%Y-%m-%d %H:%M:%S"), content);
    }
}

fn save_log(name: &str, content: &str) {
    let _ = write(logs_dir().join(name), content);
}

fn ps(script: &str) -> Result<String, String> {
    let wrapped = format!(
        "$ErrorActionPreference='SilentlyContinue'; $OutputEncoding=[Console]::OutputEncoding=[System.Text.UTF8Encoding]::new(); {}",
        script
    );

    let out = Command::new("powershell.exe")
        .args(["-NoLogo", "-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", &wrapped])
        .output()
        .map_err(|e| e.to_string())?;

    let stdout = String::from_utf8_lossy(&out.stdout).to_string();
    let stderr = String::from_utf8_lossy(&out.stderr).to_string();
    if !out.status.success() && stdout.trim().is_empty() {
        return Err(stderr);
    }
    Ok(stdout)
}

fn cmd_output(args: &[&str]) -> Result<String, String> {
    let out = Command::new("cmd.exe")
        .args(args)
        .output()
        .map_err(|e| e.to_string())?;
    let stdout = String::from_utf8_lossy(&out.stdout).to_string();
    let stderr = String::from_utf8_lossy(&out.stderr).to_string();
    if !out.status.success() && stdout.trim().is_empty() {
        return Err(stderr);
    }
    Ok(stdout)
}

fn parse_device_line(line: &str, direction_hint: &str) -> Option<AudioDevice> {
    let parts: Vec<&str> = line.split("||").collect();
    if parts.len() < 4 {
        return None;
    }

    let name = clean(parts[0]);
    if name.is_empty() || name.eq_ignore_ascii_case("FriendlyName") {
        return None;
    }

    let class_name = clean(parts[1]).to_lowercase();
    let status = clean(parts[2]);
    let id = clean(parts[3]);
    let n = name.to_lowercase();
    let iid = id.to_lowercase();

    let capture_mark = iid.contains("{0.0.1.")
        || iid.contains("\\capture\\")
        || iid.contains("mmdevapi\\capture\\")
        || direction_hint == "input";
    let render_mark = iid.contains("{0.0.0.")
        || iid.contains("\\render\\")
        || iid.contains("mmdevapi\\render\\")
        || direction_hint == "output";

    let looks_input = capture_mark
        || n.contains("micro")
        || n.contains("mic")
        || n.contains("input")
        || n.contains("capture")
        || n.contains("entrada");

    let looks_output = render_mark
        || n.contains("alto")
        || n.contains("speaker")
        || n.contains("fone")
        || n.contains("headphone")
        || n.contains("headset")
        || n.contains("hands-free")
        || n.contains("airdot")
        || n.contains("redmi")
        || n.contains("realtek")
        || n.contains("output")
        || n.contains("saida")
        || n.contains("saída")
        || n.contains("audio");

    let direction = if looks_input && !render_mark {
        "input"
    } else if looks_output {
        "output"
    } else if class_name.contains("audioendpoint") && direction_hint == "input" {
        "input"
    } else if class_name.contains("audioendpoint") {
        "output"
    } else {
        "unknown"
    };

    if direction == "unknown" {
        return None;
    }

    Some(AudioDevice {
        name,
        direction: direction.to_string(),
        status: if status.is_empty() { "OK".into() } else { status },
        id,
    })
}

fn pnp_audioendpoint_probe() -> (Vec<AudioDevice>, Vec<String>) {
    // NÃO usar apenas -Class AudioEndpoint, pois em alguns Windows/Tauri vem vazio.
    // Primeiro busca todos e filtra Class, exatamente como funcionou no PowerShell manual enviado.
    let script = r#"
$ErrorActionPreference='Continue'
$items = @(Get-PnpDevice | Where-Object { $_.Class -eq 'AudioEndpoint' })
foreach($i in $items){
  $name=[string]$i.FriendlyName
  $cls=[string]$i.Class
  $st=[string]$i.Status
  $id=[string]$i.InstanceId
  if(-not [string]::IsNullOrWhiteSpace($name)){ Write-Output ($name + '||' + $cls + '||' + $st + '||' + $id) }
}
"#;

    let raw = ps(script).unwrap_or_else(|e| format!("POWERSHELL_PNP_ERROR||AudioEndpoint||ERROR||{}", clean(&e)));
    let mut lines: Vec<String> = raw.lines().map(clean).filter(|l| !l.is_empty()).collect();
    let mut devices: Vec<AudioDevice> = lines.iter().filter_map(|l| parse_device_line(l, "")).collect();

    // Fallback extra: Win32_PnPEntity também lista AudioEndpoint em máquinas onde Get-PnpDevice falha dentro do app.
    if devices.is_empty() {
        let cim_script = r#"
$items = @(Get-CimInstance Win32_PnPEntity | Where-Object { $_.PNPClass -eq 'AudioEndpoint' })
foreach($i in $items){
  $name=[string]$i.Name
  $cls=[string]$i.PNPClass
  $st=[string]$i.Status
  $id=[string]$i.PNPDeviceID
  if(-not [string]::IsNullOrWhiteSpace($name)){ Write-Output ($name + '||' + $cls + '||' + $st + '||' + $id) }
}
"#;
        let raw2 = ps(cim_script).unwrap_or_else(|e| format!("POWERSHELL_CIM_AUDIOENDPOINT_ERROR||AudioEndpoint||ERROR||{}", clean(&e)));
        lines.push("=== CIM_AUDIOENDPOINT_FALLBACK ===".into());
        lines.extend(raw2.lines().map(clean).filter(|l| !l.is_empty()));
        devices = lines.iter().filter_map(|l| parse_device_line(l, "")).collect();
    }

    append_log("core.log", &format!("PNP probe returned {} raw lines and {} parsed devices", lines.len(), devices.len()));
    (devices, lines)
}

fn registry_powershell_probe(direction: &str) -> (Vec<AudioDevice>, Vec<String>) {
    let hive = if direction == "input" { "Capture" } else { "Render" };
    let script = format!(r#"
$base='HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\MMDevices\Audio\{}'
Get-ChildItem $base | ForEach-Object {{
  $id=$_.PSChildName
  $p=Join-Path $_.PsPath 'Properties'
  $props=Get-ItemProperty $p
  $name=$props.'{{a45c254e-df1c-4efd-8020-67d146a850e0}},2'
  if([string]::IsNullOrWhiteSpace($name)){{ $name=$props.'{{b3f8fa53-0004-438e-9003-51a46e139bfc}},6' }}
  if(-not [string]::IsNullOrWhiteSpace($name)){{ Write-Output ($name + '||AudioEndpoint||OK||MMDEVAPI\\{}\\' + $id) }}
}}
"#, hive, hive);

    let raw = ps(&script).unwrap_or_else(|e| format!("POWERSHELL_REG_{}_ERROR||AudioEndpoint||ERROR||{}", hive, clean(&e)));
    let lines: Vec<String> = raw.lines().map(clean).filter(|l| !l.is_empty()).collect();
    let devices = lines.iter().filter_map(|l| parse_device_line(l, direction)).collect();
    (devices, lines)
}

fn registry_cmd_probe(direction: &str) -> (Vec<AudioDevice>, Vec<String>) {
    let hive = if direction == "input" { "Capture" } else { "Render" };
    let reg_path = format!(r#"HKLM\SOFTWARE\Microsoft\Windows\CurrentVersion\MMDevices\Audio\{}"#, hive);
    let raw = cmd_output(&["/C", "reg", "query", &reg_path, "/s"])
        .unwrap_or_else(|e| format!("REG_QUERY_{}_ERROR {}", hive, clean(&e)));

    let mut lines = Vec::new();
    let mut devices = Vec::new();
    let mut current_key = String::new();

    for raw_line in raw.lines() {
        let line = clean(raw_line);
        if line.is_empty() { continue; }
        lines.push(format!("REG_{}: {}", hive, line));

        if line.starts_with("HKEY_") {
            current_key = line.clone();
            continue;
        }

        // Nome amigável do endpoint no registro:
        // {a45c254e-df1c-4efd-8020-67d146a850e0},2    REG_SZ    Microfone (Realtek...)
        if line.contains("{a45c254e-df1c-4efd-8020-67d146a850e0},2") && line.contains("REG_SZ") {
            let name = line.split("REG_SZ").last().map(clean).unwrap_or_default();
            if !name.is_empty() {
                let id = current_key.split('\\').last().unwrap_or("").to_string();
                let flat = format!("{}||AudioEndpoint||OK||MMDEVAPI\\{}\\{}", name, hive, id);
                if let Some(dev) = parse_device_line(&flat, direction) {
                    devices.push(dev);
                }
            }
        }
    }

    (devices, lines)
}

fn sounddevice_fallback() -> (Vec<AudioDevice>, Vec<String>) {
    let script = r#"
Get-CimInstance Win32_SoundDevice | ForEach-Object {
  $name=[string]$_.Name
  $st=[string]$_.Status
  $id=[string]$_.PNPDeviceID
  if(-not [string]::IsNullOrWhiteSpace($name)){ Write-Output ($name + '||SoundDevice||' + $st + '||' + $id) }
}
"#;

    let raw = ps(script).unwrap_or_else(|e| format!("POWERSHELL_SOUNDDEVICE_ERROR||SoundDevice||ERROR||{}", clean(&e)));
    let lines: Vec<String> = raw.lines().map(clean).filter(|l| !l.is_empty()).collect();

    // Win32_SoundDevice não separa entrada/saída; usamos como saída genérica só se Render falhar.
    let devices = lines.iter().filter_map(|l| parse_device_line(l, "output")).collect();
    (devices, lines)
}

fn push_unique(target: &mut Vec<AudioDevice>, device: AudioDevice) {
    let exists = target.iter().any(|d| {
        (!d.id.is_empty() && !device.id.is_empty() && d.id == device.id)
            || d.name.eq_ignore_ascii_case(&device.name)
    });
    if !exists {
        target.push(device);
    }
}

fn detect_audio_devices() -> (Vec<AudioDevice>, Vec<AudioDevice>, Vec<String>) {
    let mut raw_lines: Vec<String> = Vec::new();
    let mut inputs: Vec<AudioDevice> = Vec::new();
    let mut outputs: Vec<AudioDevice> = Vec::new();

    // 1) PnP: rápido e compatível com a maioria dos PCs.
    let (pnp_devices, pnp_lines) = pnp_audioendpoint_probe();
    raw_lines.push("=== PNP_AUDIO_ENDPOINT ===".into());
    raw_lines.extend(pnp_lines);
    for dev in pnp_devices {
        if dev.direction == "input" { push_unique(&mut inputs, dev); }
        else if dev.direction == "output" { push_unique(&mut outputs, dev); }
    }

    // 2) Fallbacks pesados: só roda se o PnP não encontrar entrada OU saída.
    // A versão anterior sempre rodava REG /s, gerando ~580 KB de raw log e travando o WebView.
    if inputs.is_empty() || outputs.is_empty() {
        append_log("core.log", "PNP incomplete; running registry fallback");

        if inputs.is_empty() {
            let (reg_inputs, reg_in_lines) = registry_cmd_probe("input");
            raw_lines.push("=== REG_CAPTURE_CMD_FALLBACK ===".into());
            raw_lines.extend(reg_in_lines.into_iter().take(80));
            for dev in reg_inputs { push_unique(&mut inputs, dev); }
        }

        if outputs.is_empty() {
            let (reg_outputs, reg_out_lines) = registry_cmd_probe("output");
            raw_lines.push("=== REG_RENDER_CMD_FALLBACK ===".into());
            raw_lines.extend(reg_out_lines.into_iter().take(80));
            for dev in reg_outputs { push_unique(&mut outputs, dev); }
        }
    }

    // 3) Registro via PowerShell: último fallback quando REG.EXE vier vazio.
    if inputs.is_empty() {
        let (fb_inputs, fb_lines) = registry_powershell_probe("input");
        raw_lines.push("=== REG_CAPTURE_POWERSHELL_FALLBACK ===".into());
        raw_lines.extend(fb_lines.into_iter().take(80));
        for dev in fb_inputs { push_unique(&mut inputs, dev); }
    }
    if outputs.is_empty() {
        let (fb_outputs, fb_lines) = registry_powershell_probe("output");
        raw_lines.push("=== REG_RENDER_POWERSHELL_FALLBACK ===".into());
        raw_lines.extend(fb_lines.into_iter().take(80));
        for dev in fb_outputs { push_unique(&mut outputs, dev); }
    }

    // 4) Último fallback: Win32_SoundDevice pelo menos mostra placa/driver como saída.
    if outputs.is_empty() {
        let (sd_outputs, sd_lines) = sounddevice_fallback();
        raw_lines.push("=== WIN32_SOUNDDEVICE_FALLBACK ===".into());
        raw_lines.extend(sd_lines.into_iter().take(80));
        for dev in sd_outputs { push_unique(&mut outputs, dev); }
    }

    inputs.sort_by_key(|d| rank_device(&d.name, true));
    outputs.sort_by_key(|d| rank_device(&d.name, false));

    let raw_compact: Vec<String> = raw_lines.iter().take(120).cloned().collect();
    let raw_text = raw_compact.join("\n");
    save_log("hardware_raw.txt", &raw_text);
    let hardware_json = serde_json::to_string_pretty(&serde_json::json!({
        "inputs": &inputs,
        "outputs": &outputs,
        "rawPreview": &raw_compact,
        "rawTotalLines": raw_lines.len()
    })).unwrap_or_default();
    save_log("hardware.json", &hardware_json);

    (inputs, outputs, raw_compact)
}

fn rank_device(name: &str, input: bool) -> i32 {
    let n = name.to_lowercase();
    if input && n.contains("hyperx") { return 0; }
    if input && (n.contains("microfone") || n.contains("microphone") || n.contains("mic")) { return 1; }
    if !input && (n.contains("fone") || n.contains("headset") || n.contains("airdot") || n.contains("redmi") || n.contains("hyperx")) { return 0; }
    if !input && (n.contains("alto") || n.contains("speaker") || n.contains("realtek")) { return 1; }
    10
}

fn detect_apps() -> Vec<AppProcess> {
    let mut sys = System::new_all();
    sys.refresh_all();

    let mut apps: Vec<AppProcess> = sys.processes().iter().filter_map(|(pid, process)| {
        let name = process.name().to_string_lossy().to_string();
        let lower = name.to_lowercase();
        let blocked = ["idle", "system", "registry", "smss.exe", "csrss.exe", "wininit.exe", "services.exe", "lsass.exe"];
        if blocked.contains(&lower.as_str()) {
            return None;
        }

        let ram_mb = process.memory() as f64 / 1024.0 / 1024.0;
        let cpu = process.cpu_usage() as f64;
        let activity = estimate_activity(&name, ram_mb, cpu);
        let session = if activity > 55 { "Ativo" } else if activity > 18 { "Baixo" } else { "Silencioso" };

        Some(AppProcess {
            app: friendly_app_name(&name),
            process: if lower.ends_with(".exe") { name.clone() } else { format!("{}.exe", name) },
            pid: pid.as_u32(),
            title: infer_title(&name),
            ram_mb,
            activity,
            session: session.into(),
            volume: activity.min(100),
        })
    }).collect();

    apps.sort_by(|a, b| b.ram_mb.partial_cmp(&a.ram_mb).unwrap_or(std::cmp::Ordering::Equal));
    apps.truncate(40);
    save_log("apps.json", &serde_json::to_string_pretty(&apps).unwrap_or_default());
    apps
}

fn estimate_activity(process: &str, ram_mb: f64, cpu: f64) -> u32 {
    let p = process.to_lowercase();
    let mut score = ((ram_mb / 55.0) as u32).min(65) + ((cpu * 2.0) as u32).min(30);
    if p.contains("chrome") || p.contains("edge") || p.contains("discord") || p.contains("obs") || p.contains("fivem") || p.contains("spotify") {
        score += 18;
    }
    score.min(100)
}

fn friendly_app_name(process: &str) -> String {
    let p = process.to_lowercase();
    if p.contains("chrome") { "Google Chrome".into() }
    else if p.contains("msedge") { "Microsoft Edge".into() }
    else if p.contains("discord") { "Discord".into() }
    else if p.contains("obs") { "OBS Studio".into() }
    else if p.contains("fivem") { "FiveM".into() }
    else if p.contains("spotify") { "Spotify".into() }
    else if p.contains("audiodg") { "Windows Audio Engine".into() }
    else { process.trim_end_matches(".exe").to_string() }
}

fn infer_title(process: &str) -> String {
    let p = process.to_lowercase();
    if p.contains("chrome") || p.contains("edge") { "Browser / mídia possível".into() }
    else if p.contains("obs") { "Streaming / captura".into() }
    else if p.contains("discord") { "Comunicação".into() }
    else { "—".into() }
}

fn now_time() -> String {
    Local::now().format("%H:%M:%S").to_string()
}

fn build_state(preferred_input_id: Option<String>, preferred_output_id: Option<String>) -> MillerState {
    let _ = create_dir_all(logs_dir());
    append_log("core.log", "build_state started");
    let (inputs, outputs, raw_lines) = detect_audio_devices();
    let apps = detect_apps();

    let preferred_input = preferred_input_id
        .filter(|id| !id.trim().is_empty())
        .and_then(|id| inputs.iter().find(|d| d.id == id).cloned())
        .or_else(|| inputs.first().cloned());

    let preferred_output = preferred_output_id
        .filter(|id| !id.trim().is_empty())
        .and_then(|id| outputs.iter().find(|d| d.id == id).cloned())
        .or_else(|| outputs.first().cloned());

    append_log("core.log", &format!("devices: inputs={} outputs={} raw_lines={}", inputs.len(), outputs.len(), raw_lines.len()));

    let warning = if inputs.is_empty() && outputs.is_empty() {
        "NO_AUDIO_DEVICES".to_string()
    } else if inputs.is_empty() {
        "NO_INPUT_DEVICES".to_string()
    } else if outputs.is_empty() {
        "NO_OUTPUT_DEVICES".to_string()
    } else {
        String::new()
    };

    MillerState {
        ok: true,
        timestamp: now_time(),
        warning,
        hardware: HardwareState { inputs, outputs, preferred_input, preferred_output },
        apps,
        performance: PerformanceState { sample_rate: 48000, buffer: 128, latency_ms: 12.0, input_latency_ms: 4.0, output_latency_ms: 8.0, round_trip_latency_ms: 12.0, cpu: 0 },
        logs_path: logs_dir().display().to_string(),
        raw_device_lines: raw_lines,
    }
}

#[tauri::command]
fn get_miller_state(preferred_input_id: Option<String>, preferred_output_id: Option<String>) -> MillerState {
    build_state(preferred_input_id, preferred_output_id)
}

#[tauri::command]
fn get_debug_report(preferred_input_id: Option<String>, preferred_output_id: Option<String>) -> DebugReport {
    append_log("core.log", "Debug audit requested from React");
    let state = build_state(preferred_input_id, preferred_output_id);
    let mut warnings = Vec::new();
    if state.hardware.inputs.is_empty() { warnings.push("inputs_empty".to_string()); }
    if state.hardware.outputs.is_empty() { warnings.push("outputs_empty".to_string()); }
    if state.apps.is_empty() { warnings.push("apps_empty".to_string()); }

    let report = DebugReport {
        timestamp: state.timestamp,
        ok: state.ok,
        logs_path: state.logs_path,
        hardware: state.hardware,
        apps_count: state.apps.len(),
        raw_device_lines: state.raw_device_lines,
        warnings,
    };

    let audit_json = serde_json::to_string_pretty(&report).unwrap_or_default();
    save_log("audit_latest.json", &audit_json);
    let safe_name = Local::now().format("audit_%Y-%m-%d_%H-%M-%S.json").to_string();
    save_log(&safe_name, &audit_json);
    append_log("audit.log", &format!("Audit saved: {}", safe_name));

    report
}

#[tauri::command]
fn get_logs_path() -> String {
    let dir = logs_dir();
    append_log("core.log", "Logs path requested from React");
    save_log("startup_check.txt", "Miller Audio Studio X logs folder OK");
    dir.display().to_string()
}

#[tauri::command]
fn open_logs_folder() -> Result<(), String> {
    let dir = logs_dir();
    create_dir_all(&dir).map_err(|e| e.to_string())?;
    Command::new("explorer.exe")
        .arg(dir)
        .spawn()
        .map_err(|e| e.to_string())?;
    Ok(())
}




#[derive(Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
struct LicenseState {
    license_type: String,
    license_key: String,
    machine_id: String,
    activated: bool,
    owner: String,
    plan_limit: String,
    free_seconds_left: u32,
    #[serde(default)]
    last_check_unix: i64,
    message: String,
}

#[derive(Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
struct UpdateInfo {
    current_version: String,
    latest_version: String,
    channel: String,
    update_available: bool,
    download_url: String,
    notes: Vec<String>,
    message: String,
}

fn license_path() -> PathBuf { app_data_dir().join("license.json") }

fn machine_fingerprint() -> String {
    use std::collections::hash_map::DefaultHasher;
    use std::hash::{Hash, Hasher};
    let mut raw = String::new();
    for key in ["COMPUTERNAME", "USERNAME", "PROCESSOR_IDENTIFIER", "PROCESSOR_ARCHITECTURE"] {
        raw.push_str(&std::env::var(key).unwrap_or_default());
        raw.push('|');
    }
    let mut hasher = DefaultHasher::new();
    raw.hash(&mut hasher);
    format!("MILLER-PC-{:016X}", hasher.finish())
}

fn default_license_state() -> LicenseState {
    LicenseState {
        license_type: "FREE".into(),
        license_key: String::new(),
        machine_id: machine_fingerprint(),
        activated: false,
        owner: String::new(),
        plan_limit: "1 hora por sessão, perfis e rotas limitados".into(),
        free_seconds_left: 3600,
        last_check_unix: Local::now().timestamp(),
        message: "FREE_ACTIVE".into(),
    }
}

fn load_license_state() -> LicenseState {
    let mut lic = if let Ok(raw) = read_to_string(license_path()) {
        serde_json::from_str(&raw).unwrap_or_else(|_| default_license_state())
    } else {
        default_license_state()
    };
    lic.machine_id = machine_fingerprint();
    if lic.last_check_unix <= 0 {
        lic.last_check_unix = Local::now().timestamp();
    }
    if !lic.activated && lic.license_type == "FREE" {
        let now = Local::now().timestamp();
        let elapsed = (now - lic.last_check_unix).max(0) as u32;
        if elapsed > 0 {
            lic.free_seconds_left = lic.free_seconds_left.saturating_sub(elapsed);
            lic.last_check_unix = now;
            if lic.free_seconds_left == 0 {
                lic.message = "FREE_SESSION_EXPIRED".into();
            } else {
                lic.message = "FREE_ACTIVE".into();
            }
            save_license_state(&lic);
        }
    }
    lic
}

fn save_license_state(license: &LicenseState) {
    let _ = write(license_path(), serde_json::to_string_pretty(license).unwrap_or_default());
}

#[tauri::command]
fn get_machine_id() -> String { machine_fingerprint() }

#[tauri::command]
fn get_license_state() -> LicenseState {
    let lic = load_license_state();
    append_log("license.log", &format!("License state requested: {} activated={}", lic.license_type, lic.activated));
    lic
}

#[tauri::command]
fn activate_license(license_key: String, owner: Option<String>) -> Result<LicenseState, String> {
    let key = license_key.trim().to_uppercase();
    let plan = if key.starts_with("MASX-PRO-") {
        "PRO"
    } else if key.starts_with("MASX-STUDIO-") {
        "STUDIO"
    } else {
        append_log("license.log", &format!("Invalid license attempt: {}", key));
        return Err("Chave inválida. Use MASX-PRO-... ou MASX-STUDIO-...".into());
    };

    if key.len() < 18 {
        return Err("Chave muito curta.".into());
    }

    let lic = LicenseState {
        license_type: plan.into(),
        license_key: key.clone(),
        machine_id: machine_fingerprint(),
        activated: true,
        owner: owner.unwrap_or_default(),
        plan_limit: if plan == "STUDIO" { "Até 3 computadores; recursos premium".into() } else { "1 computador; recursos premium".into() },
        free_seconds_left: 0,
        last_check_unix: Local::now().timestamp(),
        message: format!("LICENSE_{}_ACTIVE", plan),
    };
    save_license_state(&lic);
    append_log("license.log", &format!("License activated: {}", plan));
    Ok(lic)
}

#[tauri::command]
fn continue_free_session() -> LicenseState {
    let mut lic = load_license_state();
    if !lic.activated {
        lic.license_type = "FREE".into();
        lic.free_seconds_left = 3600;
        lic.last_check_unix = Local::now().timestamp();
        lic.message = "FREE_SESSION_RESTARTED".into();
        save_license_state(&lic);
    }
    append_log("license.log", "Free session continued");
    lic
}

#[tauri::command]
fn check_for_updates(channel: Option<String>) -> UpdateInfo {
    let ch = channel.unwrap_or_else(|| "stable".into());
    append_log("updates.log", &format!("Update check requested: channel={}", ch));
    UpdateInfo {
        current_version: "6.5 Mic Real + Audio Session Stability".into(),
        latest_version: "6.5 Mic Real + Audio Session Stability".into(),
        channel: ch,
        update_available: false,
        download_url: "".into(),
        notes: vec![
            "UPDATE_NOTE_AUDIO_SESSIONS".into(),
            "UPDATE_NOTE_VU_METER".into(),
            "UPDATE_NOTE_FREE_PRO_RULES".into(),
        ],
        message: "UPDATE_LATEST".into(),
    }
}
#[tauri::command]
fn set_runtime_options(state: tauri::State<RuntimeOptions>, close_to_tray: bool, start_minimized: bool) -> Result<(), String> {
    let mut guard = state.lock().map_err(|_| "runtime_options_lock_failed".to_string())?;
    guard.close_to_tray = close_to_tray;
    guard.start_minimized = start_minimized;
    save_runtime_options(&guard);
    append_log("core.log", &format!("Runtime options updated: close_to_tray={} start_minimized={}", close_to_tray, start_minimized));
    Ok(())
}

#[tauri::command]
fn set_startup_enabled(enabled: bool) -> Result<(), String> {
    let result = set_windows_startup(enabled);
    match &result {
        Ok(_) => append_log("core.log", &format!("Windows startup updated: {}", enabled)),
        Err(e) => append_log("core.log", &format!("Windows startup update failed: {}", e)),
    }
    result
}


#[tauri::command]
fn create_support_ticket(contact: String, category: String, message: String, report_json: String) -> Result<String, String> {
    let tickets_dir = app_data_dir().join("support_tickets");
    create_dir_all(&tickets_dir).map_err(|e| e.to_string())?;
    let file_name = format!("ticket_{}.json", Local::now().format("%Y-%m-%d_%H-%M-%S"));
    let path = tickets_dir.join(file_name);
    let payload = serde_json::json!({
        "createdAt": Local::now().to_rfc3339(),
        "contact": contact,
        "category": category,
        "message": message,
        "recommendedChannel": "email_or_discord",
        "report": serde_json::from_str::<serde_json::Value>(&report_json).unwrap_or(serde_json::Value::String(report_json))
    });
    write(&path, serde_json::to_string_pretty(&payload).unwrap_or_default()).map_err(|e| e.to_string())?;
    append_log("support.log", &format!("Support ticket created: {}", path.display()));
    Ok(path.display().to_string())
}

#[tauri::command]
fn tick_free_session() -> LicenseState {
    load_license_state()
}


fn process_label_from_pid(pid: u32) -> (String, String) {
    let mut sys = System::new_all();
    sys.refresh_all();
    for (spid, process) in sys.processes() {
        if spid.as_u32() == pid {
            let name = process.name().to_string_lossy().to_string();
            return (friendly_app_name(&name), if name.to_lowercase().ends_with(".exe") { name } else { format!("{}.exe", name) });
        }
    }
    ("Sistema de Áudio".into(), format!("pid_{}", pid))
}

#[cfg(target_os = "windows")]
fn wasapi_audio_sessions() -> Result<Vec<AudioSessionState>, String> {
    use windows::core::Interface;
    use windows::Win32::Media::Audio::{
        eMultimedia, eRender, AudioSessionStateActive, IAudioSessionControl2,
        IAudioSessionManager2, IMMDeviceEnumerator, ISimpleAudioVolume, MMDeviceEnumerator,
    };
    use windows::Win32::Media::Audio::Endpoints::IAudioMeterInformation;
    use windows::Win32::System::Com::{
        CoCreateInstance, CoInitializeEx, CLSCTX_ALL, COINIT_APARTMENTTHREADED,
    };

    const RPC_E_CHANGED_MODE_CODE: i32 = -2147417850; // 0x80010106

    unsafe {
        let hr = CoInitializeEx(None, COINIT_APARTMENTTHREADED);
        if hr.is_err() && hr.0 != RPC_E_CHANGED_MODE_CODE {
            return Err(format!("CoInitializeEx failed: {:?}", hr));
        }

        let enumerator: IMMDeviceEnumerator = CoCreateInstance(&MMDeviceEnumerator, None, CLSCTX_ALL)
            .map_err(|e| format!("CoCreateInstance IMMDeviceEnumerator failed: {:?}", e))?;

        let device = enumerator
            .GetDefaultAudioEndpoint(eRender, eMultimedia)
            .map_err(|e| format!("GetDefaultAudioEndpoint eRender failed: {:?}", e))?;

        let manager: IAudioSessionManager2 = device
            .Activate(CLSCTX_ALL, None)
            .map_err(|e| format!("Activate IAudioSessionManager2 failed: {:?}", e))?;

        let session_enum = manager
            .GetSessionEnumerator()
            .map_err(|e| format!("GetSessionEnumerator failed: {:?}", e))?;

        let count = session_enum
            .GetCount()
            .map_err(|e| format!("GetCount failed: {:?}", e))?;

        let mut sessions: Vec<AudioSessionState> = Vec::new();

        for i in 0..count {
            let session = match session_enum.GetSession(i) {
                Ok(s) => s,
                Err(e) => {
                    append_log("audio_core.log", &format!("GetSession({}) failed: {:?}", i, e));
                    continue;
                }
            };

            let control2: IAudioSessionControl2 = match session.cast() {
                Ok(c) => c,
                Err(_) => continue,
            };

            let pid = control2.GetProcessId().unwrap_or(0);
            let state = session.GetState().ok();
            let active_state = state.map(|s| s == AudioSessionStateActive).unwrap_or(false);

            let meter: Option<IAudioMeterInformation> = session.cast().ok();
            let peak_f = meter
                .as_ref()
                .and_then(|m| m.GetPeakValue().ok())
                .unwrap_or(0.0)
                .clamp(0.0, 1.0);

            let volume_iface: Option<ISimpleAudioVolume> = session.cast().ok();
            let volume_f = volume_iface
                .as_ref()
                .and_then(|v| v.GetMasterVolume().ok())
                .unwrap_or(1.0)
                .clamp(0.0, 1.0);

            let (app, process) = process_label_from_pid(pid);
            let peak = (peak_f * 100.0).round() as u32;
            let volume = (volume_f * 100.0).round() as u32;
            let active = active_state || peak > 0;

            // Dados reais: só mostramos sessões do Windows que existem de verdade.
            // Sessões completamente silenciosas permanecem fora da lista para evitar ruído visual.
            if !active && peak == 0 {
                continue;
            }

            sessions.push(AudioSessionState {
                app,
                process,
                pid,
                volume,
                peak,
                active,
                route: "A1".into(),
                device: "Windows Default".into(),
                source: "WASAPI_SESSION_REAL".into(),
            });
        }

        sessions.sort_by(|a, b| b.peak.cmp(&a.peak).then_with(|| a.app.cmp(&b.app)));
        sessions.truncate(32);
        Ok(sessions)
    }
}

#[cfg(not(target_os = "windows"))]
fn wasapi_audio_sessions() -> Result<Vec<AudioSessionState>, String> {
    Err("WASAPI real audio sessions are only available on Windows".into())
}

#[cfg(target_os = "windows")]
fn set_wasapi_session_volume_by_pid(target_pid: u32, target_volume: u32) -> Result<(), String> {
    use windows::core::Interface;
    use windows::Win32::Media::Audio::{
        eMultimedia, eRender, IAudioSessionControl2, IAudioSessionManager2,
        IMMDeviceEnumerator, ISimpleAudioVolume, MMDeviceEnumerator,
    };
    use windows::Win32::System::Com::{
        CoCreateInstance, CoInitializeEx, CLSCTX_ALL, COINIT_APARTMENTTHREADED,
    };

    const RPC_E_CHANGED_MODE_CODE: i32 = -2147417850; // 0x80010106

    unsafe {
        let hr = CoInitializeEx(None, COINIT_APARTMENTTHREADED);
        if hr.is_err() && hr.0 != RPC_E_CHANGED_MODE_CODE {
            return Err(format!("CoInitializeEx failed: {:?}", hr));
        }

        let enumerator: IMMDeviceEnumerator = CoCreateInstance(&MMDeviceEnumerator, None, CLSCTX_ALL)
            .map_err(|e| format!("CoCreateInstance IMMDeviceEnumerator failed: {:?}", e))?;
        let device = enumerator.GetDefaultAudioEndpoint(eRender, eMultimedia)
            .map_err(|e| format!("GetDefaultAudioEndpoint failed: {:?}", e))?;
        let manager: IAudioSessionManager2 = device.Activate(CLSCTX_ALL, None)
            .map_err(|e| format!("Activate IAudioSessionManager2 failed: {:?}", e))?;
        let session_enum = manager.GetSessionEnumerator()
            .map_err(|e| format!("GetSessionEnumerator failed: {:?}", e))?;
        let count = session_enum.GetCount().map_err(|e| format!("GetCount failed: {:?}", e))?;
        let value = (target_volume.min(100) as f32 / 100.0).clamp(0.0, 1.0);

        for i in 0..count {
            let session = match session_enum.GetSession(i) { Ok(s) => s, Err(_) => continue };
            let control2: IAudioSessionControl2 = match session.cast() { Ok(c) => c, Err(_) => continue };
            let pid = control2.GetProcessId().unwrap_or(0);
            if pid == target_pid {
                let vol: ISimpleAudioVolume = session.cast().map_err(|e| format!("ISimpleAudioVolume cast failed: {:?}", e))?;
                vol.SetMasterVolume(value, std::ptr::null()).map_err(|e| format!("SetMasterVolume failed: {:?}", e))?;
                append_log("audio_core.log", &format!("Set real WASAPI session volume: pid={} volume={}", target_pid, target_volume));
                return Ok(());
            }
        }

        Err(format!("Audio session for pid {} not found", target_pid))
    }
}

#[cfg(not(target_os = "windows"))]
fn set_wasapi_session_volume_by_pid(_target_pid: u32, _target_volume: u32) -> Result<(), String> {
    Err("WASAPI real volume control is only available on Windows".into())
}

#[cfg(target_os = "windows")]
fn set_wasapi_session_mute_by_pid(target_pid: u32, muted: bool) -> Result<(), String> {
    use windows::core::Interface;
    use windows::Win32::Foundation::BOOL;
    use windows::Win32::Media::Audio::{
        eMultimedia, eRender, IAudioSessionControl2, IAudioSessionManager2,
        IMMDeviceEnumerator, ISimpleAudioVolume, MMDeviceEnumerator,
    };
    use windows::Win32::System::Com::{
        CoCreateInstance, CoInitializeEx, CLSCTX_ALL, COINIT_APARTMENTTHREADED,
    };

    const RPC_E_CHANGED_MODE_CODE: i32 = -2147417850;

    unsafe {
        let hr = CoInitializeEx(None, COINIT_APARTMENTTHREADED);
        if hr.is_err() && hr.0 != RPC_E_CHANGED_MODE_CODE {
            return Err(format!("CoInitializeEx failed: {:?}", hr));
        }
        let enumerator: IMMDeviceEnumerator = CoCreateInstance(&MMDeviceEnumerator, None, CLSCTX_ALL)
            .map_err(|e| format!("CoCreateInstance IMMDeviceEnumerator failed: {:?}", e))?;
        let device = enumerator.GetDefaultAudioEndpoint(eRender, eMultimedia)
            .map_err(|e| format!("GetDefaultAudioEndpoint failed: {:?}", e))?;
        let manager: IAudioSessionManager2 = device.Activate(CLSCTX_ALL, None)
            .map_err(|e| format!("Activate IAudioSessionManager2 failed: {:?}", e))?;
        let session_enum = manager.GetSessionEnumerator()
            .map_err(|e| format!("GetSessionEnumerator failed: {:?}", e))?;
        let count = session_enum.GetCount().map_err(|e| format!("GetCount failed: {:?}", e))?;

        let mut changed = 0usize;
        for i in 0..count {
            let session = match session_enum.GetSession(i) { Ok(s) => s, Err(_) => continue };
            let control2: IAudioSessionControl2 = match session.cast() { Ok(c) => c, Err(_) => continue };
            let pid = control2.GetProcessId().unwrap_or(0);
            if pid == target_pid {
                let vol: ISimpleAudioVolume = session.cast().map_err(|e| format!("ISimpleAudioVolume cast failed: {:?}", e))?;
                vol.SetMute(BOOL(muted as i32), std::ptr::null()).map_err(|e| format!("SetMute failed: {:?}", e))?;
                changed += 1;
            }
        }
        if changed > 0 {
            append_log("audio_core.log", &format!("Set real WASAPI mute: pid={} muted={} sessions={}", target_pid, muted, changed));
            Ok(())
        } else {
            Err(format!("Audio session for pid {} not found", target_pid))
        }
    }
}

#[cfg(not(target_os = "windows"))]
fn set_wasapi_session_mute_by_pid(_target_pid: u32, _muted: bool) -> Result<(), String> {
    Err("WASAPI real mute control is only available on Windows".into())
}

#[cfg(target_os = "windows")]
fn set_all_wasapi_sessions_mute(muted: bool) -> Result<usize, String> {
    use windows::core::Interface;
    use windows::Win32::Foundation::BOOL;
    use windows::Win32::Media::Audio::{
        eMultimedia, eRender, IAudioSessionManager2, IMMDeviceEnumerator,
        ISimpleAudioVolume, MMDeviceEnumerator,
    };
    use windows::Win32::System::Com::{
        CoCreateInstance, CoInitializeEx, CLSCTX_ALL, COINIT_APARTMENTTHREADED,
    };

    const RPC_E_CHANGED_MODE_CODE: i32 = -2147417850;

    unsafe {
        let hr = CoInitializeEx(None, COINIT_APARTMENTTHREADED);
        if hr.is_err() && hr.0 != RPC_E_CHANGED_MODE_CODE {
            return Err(format!("CoInitializeEx failed: {:?}", hr));
        }
        let enumerator: IMMDeviceEnumerator = CoCreateInstance(&MMDeviceEnumerator, None, CLSCTX_ALL)
            .map_err(|e| format!("CoCreateInstance IMMDeviceEnumerator failed: {:?}", e))?;
        let device = enumerator.GetDefaultAudioEndpoint(eRender, eMultimedia)
            .map_err(|e| format!("GetDefaultAudioEndpoint failed: {:?}", e))?;
        let manager: IAudioSessionManager2 = device.Activate(CLSCTX_ALL, None)
            .map_err(|e| format!("Activate IAudioSessionManager2 failed: {:?}", e))?;
        let session_enum = manager.GetSessionEnumerator()
            .map_err(|e| format!("GetSessionEnumerator failed: {:?}", e))?;
        let count = session_enum.GetCount().map_err(|e| format!("GetCount failed: {:?}", e))?;
        let mut changed = 0usize;
        for i in 0..count {
            let session = match session_enum.GetSession(i) { Ok(s) => s, Err(_) => continue };
            let vol: ISimpleAudioVolume = match session.cast() { Ok(v) => v, Err(_) => continue };
            if vol.SetMute(BOOL(muted as i32), std::ptr::null()).is_ok() { changed += 1; }
        }
        append_log("audio_core.log", &format!("Set all WASAPI sessions muted={} sessions={}", muted, changed));
        Ok(changed)
    }
}

#[cfg(not(target_os = "windows"))]
fn set_all_wasapi_sessions_mute(_muted: bool) -> Result<usize, String> {
    Err("WASAPI global mute is only available on Windows".into())
}

#[tauri::command]
fn get_audio_sessions() -> Vec<AudioSessionState> {
    match wasapi_audio_sessions() {
        Ok(sessions) => {
            append_log("audio_core.log", &format!("WASAPI real sessions returned {} rows", sessions.len()));
            save_log("audio_sessions_real.json", &serde_json::to_string_pretty(&sessions).unwrap_or_default());
            sessions
        }
        Err(e) => {
            append_log("audio_core.log", &format!("WASAPI real sessions failed: {}", e));
            save_log("audio_sessions_real.json", &serde_json::json!({"ok": false, "error": e}).to_string());
            Vec::new()
        }
    }
}

#[tauri::command]
fn set_audio_session_volume(pid: u32, volume: u32) -> Result<(), String> {
    set_wasapi_session_volume_by_pid(pid, volume)
}

#[tauri::command]
fn set_audio_session_muted(pid: u32, muted: bool) -> Result<(), String> {
    set_wasapi_session_mute_by_pid(pid, muted)
}

#[tauri::command]
fn set_all_audio_sessions_muted(muted: bool) -> Result<usize, String> {
    set_all_wasapi_sessions_mute(muted)
}

#[derive(Deserialize, Debug)]
#[serde(rename_all = "camelCase")]
struct RoutingPayload {
    a1: Option<bool>,
    a2: Option<bool>,
    a3: Option<bool>,
    a4: Option<bool>,
    a5: Option<bool>,
}

#[tauri::command]
fn set_audio_session_route(pid: u32, route: String, routing: RoutingPayload) -> Result<(), String> {
    let has_route = routing.a1.unwrap_or(false)
        || routing.a2.unwrap_or(false)
        || routing.a3.unwrap_or(false)
        || routing.a4.unwrap_or(false)
        || routing.a5.unwrap_or(false);
    append_log(
        "routing_core.log",
        &format!(
            "V6.6.5 route request pid={} route={} has_route={} A1={:?} A2={:?} A3={:?} A4={:?} A5={:?}",
            pid, route, has_route, routing.a1, routing.a2, routing.a3, routing.a4, routing.a5
        ),
    );
    if !has_route {
        return set_wasapi_session_mute_by_pid(pid, true);
    }
    Ok(())
}


#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let runtime_options: RuntimeOptions = Arc::new(Mutex::new(load_runtime_options()));
    let close_options = runtime_options.clone();

    tauri::Builder::default()
        .manage(runtime_options.clone())
        .plugin(tauri_plugin_opener::init())
        .setup(move |app| {
            let open_item = MenuItem::with_id(app, "open", "Abrir Miller", true, None::<&str>)?;
            let refresh_item = MenuItem::with_id(app, "refresh-devices", "Atualizar dispositivos", true, None::<&str>)?;
            let smart_mic_item = MenuItem::with_id(app, "open-smart-mic", "Smart Mic", true, None::<&str>)?;
            let profile_default = MenuItem::with_id(app, "profile:user-default", "✓ Meu Perfil", true, None::<&str>)?;
            let manage_profiles = MenuItem::with_id(app, "open-smart-mic", "Gerenciar perfis", true, None::<&str>)?;
            let profiles_menu = Submenu::with_items(app, "Perfis", true, &[&profile_default, &manage_profiles])?;
            let quit_item = MenuItem::with_id(app, "quit", "Sair", true, None::<&str>)?;
            let menu = Menu::with_items(app, &[&open_item, &refresh_item, &smart_mic_item, &profiles_menu, &quit_item])?;
            let icon = app.default_window_icon().cloned();
            let mut tray_builder = TrayIconBuilder::new()
                .menu(&menu)
                .tooltip("Miller Audio Studio X")
                .on_menu_event(|app, event| match event.id().as_ref() {
                    "open" => {
                        if let Some(window) = app.get_webview_window("main") {
                            let _ = window.show();
                            let _ = window.set_focus();
                        }
                    }
                    "refresh-devices" => {
                        let _ = app.emit("tray-action", "refresh-devices");
                        if let Some(window) = app.get_webview_window("main") {
                            let _ = window.show();
                            let _ = window.set_focus();
                        }
                    }
                    "open-smart-mic" => {
                        let _ = app.emit("tray-action", "open-smart-mic");
                        if let Some(window) = app.get_webview_window("main") {
                            let _ = window.show();
                            let _ = window.set_focus();
                        }
                    }
                    "profile:user-default" => {
                        let _ = app.emit("tray-action", event.id().as_ref());
                        if let Some(window) = app.get_webview_window("main") {
                            let _ = window.show();
                            let _ = window.set_focus();
                        }
                    }
                    "quit" => {
                        append_log("core.log", "Tray quit requested");
                        app.exit(0);
                    }
                    _ => {}
                })
                .on_tray_icon_event(|tray, event| {
                    if let TrayIconEvent::Click { button: MouseButton::Left, button_state: MouseButtonState::Up, .. } = event {
                        let app = tray.app_handle();
                        if let Some(window) = app.get_webview_window("main") {
                            let _ = window.show();
                            let _ = window.set_focus();
                        }
                    }
                });
            if let Some(icon) = icon { tray_builder = tray_builder.icon(icon); }
            let _tray = tray_builder.build(app)?;

            if let Some(window) = app.get_webview_window("main") {
                let opts = runtime_options.lock().map(|g| g.clone()).unwrap_or_default();
                if opts.start_minimized {
                    let _ = window.hide();
                }
            }
            append_log("core.log", "System tray initialized");
            Ok(())
        })
        .on_window_event(move |window, event| {
            if let WindowEvent::CloseRequested { api, .. } = event {
                let should_hide = close_options.lock().map(|g| g.close_to_tray).unwrap_or(true);
                if should_hide {
                    api.prevent_close();
                    let _ = window.hide();
                    append_log("core.log", "Close intercepted: minimized to tray");
                }
            }
        })
        .invoke_handler(tauri::generate_handler![
            get_miller_state,
            get_debug_report,
            get_logs_path,
            open_logs_folder,
            set_runtime_options,
            set_startup_enabled,
            get_machine_id,
            get_license_state,
            activate_license,
            continue_free_session,
            check_for_updates,
            create_support_ticket,
            tick_free_session,
            get_audio_sessions,
            set_audio_session_volume,
            set_audio_session_muted,
            set_all_audio_sessions_muted,
            set_audio_session_route
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
