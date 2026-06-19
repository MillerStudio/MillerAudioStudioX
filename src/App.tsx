import { useEffect, useMemo, useRef, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { getCurrentWindow } from '@tauri-apps/api/window';
import './App.css';

type AudioDevice = { name?: string; direction?: string; status?: string; id?: string };
type AppProcess = { app?: string; process?: string; pid?: number; title?: string; ramMb?: number; activity?: number; session?: string; volume?: number };
type AudioSession = { app?: string; process?: string; pid?: number; volume?: number; peak?: number; active?: boolean; route?: string; device?: string; source?: string; recent?: boolean; lastSeen?: number; pids?: number[]; muted?: boolean; mutedBySolo?: boolean; solo?: boolean };
type MixerPersist = Record<string, { app?: string; process?: string; volume: number; route: string; muted: boolean; mutedBySolo: boolean; solo: boolean; previousVolume?: number; lastSeen: number }>;
type MillerState = {
  ok?: boolean;
  timestamp?: string;
  warning?: string;
  hardware?: { inputs?: AudioDevice[]; outputs?: AudioDevice[]; preferredInput?: AudioDevice | null; preferredOutput?: AudioDevice | null };
  apps?: AppProcess[];
  performance?: { sampleRate?: number; buffer?: number; latencyMs?: number; cpu?: number };
  logsPath?: string;
  rawDeviceLines?: string[];
};
type DebugReport = { timestamp?: string; ok?: boolean; logsPath?: string; hardware?: MillerState['hardware']; appsCount?: number; rawDeviceLines?: string[]; warnings?: string[] };
type Tab = 'dashboard' | 'devices' | 'apps' | 'smartMic' | 'routes' | 'settings' | 'support' | 'license' | 'studio';
type Lang = 'pt-BR' | 'en-US' | 'es-ES';
type Theme = 'miller-blue' | 'miller-red' | 'miller-purple' | 'miller-green' | 'miller-gold' | 'miller-orange' | 'miller-ice' | 'miller-carbon' | 'miller-cyberpunk' | 'miller-midnight' | 'miller-matrix' | 'carbon-black' | 'cyber-neon' | 'studio-pro';
type SmartMic = { noise: number; keyboard: number; gate: number; compressor: number; limiter: number; natural: number; autoGain: boolean; protectLaugh: boolean; protectScream: boolean };
type Profile = { id: string; name: string; desc: string; smartMic: SmartMic; inputId?: string; outputId?: string; mode: string; routeId?: string };
type RoutePreset = { id: string; name: string; matrix: Record<string, boolean[]>; outputs?: string[] };
type Settings = { language: Lang; theme: Theme; scale: number; animations: boolean; transparency: boolean; autoRefresh: boolean; startWithWindows: boolean; startMinimized: boolean; closeToTray: boolean; checkUpdates: boolean; updateChannel: 'stable'|'beta'|'dev'; qualityMode: 'lowLatency'|'balanced'|'quality'; showAdvancedAudio: boolean; engine: string; sampleRate: number; buffer: number; micEngine: string; logsEnabled: boolean; advancedLogs: boolean; saveAudits: boolean; monitorMicrophone: boolean };
type LicenseState = { licenseType: string; licenseKey: string; machineId: string; activated: boolean; owner: string; planLimit: string; freeSecondsLeft: number; lastCheckUnix?: number; message: string };
type UpdateInfo = { currentVersion: string; latestVersion: string; channel: string; updateAvailable: boolean; downloadUrl: string; notes: string[]; message: string };

const dict = {
  'pt-BR': {
    nav: { dashboard:'Painel', devices:'Dispositivos', apps:'Aplicativos', smartMic:'Smart Mic', routes:'Rotas', settings:'Configurações', support:'Suporte', license:'Licença', studio:'Studio' },
    auto:'Auto', refresh:'Atualizar dispositivos', core:'Núcleo Rust ativo', ok:'OK', warn:'Aviso', error:'Erro', notFound:'Não encontrado', save:'Salvar', new:'Novo', clone:'Clonar', delete:'Excluir', apply:'Aplicar', edit:'Editar', name:'Nome', description:'Descrição', status:'Status', actions:'Ações', current:'Atual', remaining:'Restante', minutes:'minutos', open:'Abrir', export:'Exportar', copy:'Copiar', continueFree:'Continuar Free', buyPro:'Comprar Pro', activate:'Ativar licença', licenseKey:'Chave de licença', pcId:'ID deste computador', freePlan:'Plano Free', proPlan:'Plano Pro', studioPlan:'Plano Studio', future:'Próxima etapa', advanced:'Avançado', simpleMode:'Modo simples', showAdvanced:'Mostrar opções avançadas', hideAdvanced:'Ocultar opções avançadas', running:'Rodando...', logsPath:'Pasta de logs', runAudit:'Executar diagnóstico', openLogs:'Abrir logs', exportReport:'Exportar relatório', lastRead:'Última leitura', inputs:'Entradas', outputs:'Saídas', apps:'Aplicativos', microphone:'Microfone', input:'Entrada', output:'Saída', latency:'Latência', session:'Sessão', volume:'Volume', activity:'Atividade', process:'Processo', instances:'Instâncias', route:'Rota', settingsSaved:'Configurações salvas automaticamente.', samples:'amostras',
    dashboardTitle:'Painel inteligente', dashboardSub:'Resumo simples do estado do Miller, dispositivos, aplicativos e sessão atual.', devicesTitle:'Dispositivos', devicesSub:'Escolha o microfone e a saída principal que o Miller deve usar.', appsTitle:'Aplicativos', appsSub:'Hoje esta tela mostra processos detectados. Na fase de áudio real, ela mostrará apenas apps emitindo som e seus níveis.', smartTitle:'Smart Mic', smartSub:'Perfis e ajustes do microfone em uma única tela, de forma mais didática.', routesTitle:'Rotas', routesSub:'Defina para onde cada aplicativo será enviado. O áudio real será conectado nesta base depois.', settingsTitle:'Configurações', settingsSub:'Idioma, aparência, áudio, atualizações, inicialização e opções avançadas.', supportTitle:'Suporte', supportSub:'Diagnóstico, auditoria, logs e relatório técnico para suporte.', licenseTitle:'Licença', licenseSub:'Controle do plano Free, ativação Pro/Studio e ID único deste computador.',
    profileCurrent:'Perfil atual', quickProfiles:'Perfis rápidos', micSettings:'Configurações do microfone', noise:'Redução de ruído', noiseHelp:'Remove ventilador, ambiente e ruídos constantes.', keyboard:'Anti-teclado', keyboardHelp:'Reduz teclado e cliques de mouse.', gate:'Gate', gateHelp:'Fecha o microfone quando você não está falando.', compressor:'Compressor', compressorHelp:'Deixa o volume da voz mais estável.', limiter:'Limiter', limiterHelp:'Evita estouros quando você fala alto.', natural:'Naturalidade', naturalHelp:'Mantém a voz menos robótica.', autoGain:'Ganho automático', laugh:'Não cortar risadas', scream:'Não cortar gritos',
    general:'Geral', language:'Idioma', appearance:'Aparência', theme:'Tema', scale:'Escala', animations:'Animações', transparency:'Transparência', startup:'Inicialização', startWithWindows:'Iniciar com Windows', startMinimized:'Iniciar minimizado', closeToTray:'Fechar minimiza para bandeja', updates:'Atualizações', checkUpdates:'Verificar atualizações automaticamente', channel:'Canal', audio:'Áudio', quality:'Qualidade de áudio', lowLatency:'Baixa latência', lowLatencyHelp:'Menos atraso, ideal para jogos e comunicação.', balanced:'Equilibrado', balancedHelp:'Melhor escolha para a maioria dos usuários.', maxQuality:'Máxima qualidade', maxQualityHelp:'Mais estabilidade e qualidade, com um pouco mais de atraso.', engine:'Engine', sampleRate:'Taxa de amostragem', sampleRateHelp:'Qualidade base do áudio. 48 kHz é o recomendado para streaming.', buffer:'Buffer', bufferHelp:'Menor = menos atraso. Maior = mais estabilidade.', aiEngine:'IA do microfone', aiHelp:'RNNoise e WebRTC serão ativados nas próximas fases.', performance:'Desempenho', performanceHelp:'Informações técnicas movidas para Configurações > Avançado.', cpu:'CPU', memory:'Memória', systemStatus:'Status do sistema', smartMicStatus:'Smart Mic', routesStatus:'Rotas', audit:'Auditoria', logs:'Logs',
    wizardTitle:'Assistente inicial', wizardSub:'Configure o Miller em poucos passos.', stepMic:'Escolha seu microfone', stepOutput:'Escolha sua saída', stepUse:'Qual será seu uso principal?', useDiscord:'Discord', useFiveM:'FiveM RP', useStreaming:'Streaming', useGames:'Jogos', usePodcast:'Podcast', finishWizard:'Aplicar e começar', skipWizard:'Pular assistente',
    freeNote:'No Free, futuramente a sessão será pausada a cada 1 hora até você clicar em Continuar Free.', buyNote:'O botão Comprar Pro abrirá seu link de pagamento quando estiver configurado.', proBenefits:'Benefícios Pro', realAudio:'Áudio real por aplicativo', vuMeter:'Medidores de volume', unlimited:'Perfis e rotas ilimitados', premiumThemes:'Temas premium', latencyPending:'Aguardando medição real', micPermissionHelp:'Permita acesso ao microfone para retorno e teste real.', micMonitorActive:'Retorno do microfone ativo', micRecordReady:'Teste gravado e pronto para reproduzir', realRoutesOnly:'Rotas exibem apenas sessões reais de áudio detectadas.'
  },
  'en-US': {
    nav: { dashboard:'Dashboard', devices:'Devices', apps:'Applications', smartMic:'Smart Mic', routes:'Routing', settings:'Settings', support:'Support', license:'License', studio:'Studio' },
    auto:'Auto', refresh:'Refresh devices', core:'Rust Core active', ok:'OK', warn:'Warning', error:'Error', notFound:'Not found', save:'Save', new:'New', clone:'Clone', delete:'Delete', apply:'Apply', edit:'Edit', name:'Name', description:'Description', status:'Status', actions:'Actions', current:'Current', remaining:'Remaining', minutes:'minutes', open:'Open', export:'Export', copy:'Copy', continueFree:'Continue Free', buyPro:'Buy Pro', activate:'Activate license', licenseKey:'License key', pcId:'This computer ID', freePlan:'Free Plan', proPlan:'Pro Plan', studioPlan:'Studio Plan', future:'Next stage', advanced:'Advanced', simpleMode:'Simple mode', showAdvanced:'Show advanced options', hideAdvanced:'Hide advanced options', running:'Running...', logsPath:'Logs folder', runAudit:'Run diagnostics', openLogs:'Open logs', exportReport:'Export report', lastRead:'Last read', inputs:'Inputs', outputs:'Outputs', apps:'Applications', microphone:'Microphone', input:'Input', output:'Output', latency:'Latency', session:'Session', volume:'Volume', activity:'Activity', process:'Process', instances:'Instances', route:'Route', settingsSaved:'Settings are saved automatically.', samples:'samples',
    dashboardTitle:'Smart dashboard', dashboardSub:'Simple overview of Miller status, devices, applications and current session.', devicesTitle:'Devices', devicesSub:'Choose the microphone and main output Miller should use.', appsTitle:'Applications', appsSub:'This screen currently shows detected processes. In the real-audio phase, it will show only apps producing sound and their levels.', smartTitle:'Smart Mic', smartSub:'Microphone profiles and adjustments in one simpler screen.', routesTitle:'Routing', routesSub:'Define where each application should be sent. Real audio will be connected to this base later.', settingsTitle:'Settings', settingsSub:'Language, appearance, audio, updates, startup and advanced options.', supportTitle:'Support', supportSub:'Diagnostics, audit, logs and technical support report.', licenseTitle:'License', licenseSub:'Free plan control, Pro/Studio activation and this computer unique ID.',
    profileCurrent:'Current profile', quickProfiles:'Quick profiles', micSettings:'Microphone settings', noise:'Noise reduction', noiseHelp:'Removes fan, room and constant background noise.', keyboard:'Anti-keyboard', keyboardHelp:'Reduces keyboard and mouse clicks.', gate:'Gate', gateHelp:'Closes the microphone when you are not speaking.', compressor:'Compressor', compressorHelp:'Keeps voice volume more stable.', limiter:'Limiter', limiterHelp:'Prevents clipping when you speak loudly.', natural:'Naturalness', naturalHelp:'Keeps your voice less robotic.', autoGain:'Auto gain', laugh:'Do not cut laughter', scream:'Do not cut screams',
    general:'General', language:'Language', appearance:'Appearance', theme:'Theme', scale:'Scale', animations:'Animations', transparency:'Transparency', startup:'Startup', startWithWindows:'Start with Windows', startMinimized:'Start minimized', closeToTray:'Close minimizes to tray', updates:'Updates', checkUpdates:'Check updates automatically', channel:'Channel', audio:'Audio', quality:'Audio quality', lowLatency:'Low latency', lowLatencyHelp:'Less delay, ideal for gaming and voice chat.', balanced:'Balanced', balancedHelp:'Best choice for most users.', maxQuality:'Maximum quality', maxQualityHelp:'More stability and quality, with slightly more delay.', engine:'Engine', sampleRate:'Sample rate', sampleRateHelp:'Base audio quality. 48 kHz is recommended for streaming.', buffer:'Buffer', bufferHelp:'Lower = less delay. Higher = more stability.', aiEngine:'Microphone AI', aiHelp:'RNNoise and WebRTC will be enabled in upcoming phases.', performance:'Performance', performanceHelp:'Technical information moved to Settings > Advanced.', cpu:'CPU', memory:'Memory', systemStatus:'System status', smartMicStatus:'Smart Mic', routesStatus:'Routing', audit:'Audit', logs:'Logs',
    wizardTitle:'Setup assistant', wizardSub:'Configure Miller in a few steps.', stepMic:'Choose your microphone', stepOutput:'Choose your output', stepUse:'What is your main use?', useDiscord:'Discord', useFiveM:'FiveM RP', useStreaming:'Streaming', useGames:'Games', usePodcast:'Podcast', finishWizard:'Apply and start', skipWizard:'Skip assistant',
    freeNote:'In Free, the session will later pause every 1 hour until you click Continue Free.', buyNote:'The Buy Pro button will open your payment link when configured.', proBenefits:'Pro benefits', realAudio:'Real per-app audio', vuMeter:'Volume meters', unlimited:'Unlimited profiles and routes', premiumThemes:'Premium themes', latencyPending:'Waiting for real measurement', micPermissionHelp:'Allow microphone access for monitoring and real test.', micMonitorActive:'Microphone monitoring active', micRecordReady:'Test recorded and ready to play', realRoutesOnly:'Routes show only detected real audio sessions.'
  },
  'es-ES': {
    nav: { dashboard:'Panel', devices:'Dispositivos', apps:'Aplicaciones', smartMic:'Smart Mic', routes:'Rutas', settings:'Configuración', support:'Soporte', license:'Licencia', studio:'Studio' },
    auto:'Auto', refresh:'Actualizar dispositivos', core:'Núcleo Rust activo', ok:'OK', warn:'Aviso', error:'Error', notFound:'No encontrado', save:'Guardar', new:'Nuevo', clone:'Clonar', delete:'Eliminar', apply:'Aplicar', edit:'Editar', name:'Nombre', description:'Descripción', status:'Estado', actions:'Acciones', current:'Actual', remaining:'Restante', minutes:'minutos', open:'Abrir', export:'Exportar', copy:'Copiar', continueFree:'Continuar Free', buyPro:'Comprar Pro', activate:'Activar licencia', licenseKey:'Clave de licencia', pcId:'ID de este equipo', freePlan:'Plan Free', proPlan:'Plan Pro', studioPlan:'Plan Studio', future:'Próxima etapa', advanced:'Avanzado', simpleMode:'Modo simple', showAdvanced:'Mostrar opciones avanzadas', hideAdvanced:'Ocultar opciones avanzadas', running:'Ejecutando...', logsPath:'Carpeta de logs', runAudit:'Ejecutar diagnóstico', openLogs:'Abrir logs', exportReport:'Exportar informe', lastRead:'Última lectura', inputs:'Entradas', outputs:'Salidas', apps:'Aplicaciones', microphone:'Micrófono', input:'Entrada', output:'Salida', latency:'Latencia', session:'Sesión', volume:'Volumen', activity:'Actividad', process:'Proceso', instances:'Instancias', route:'Ruta', settingsSaved:'La configuración se guarda automáticamente.', samples:'muestras',
    dashboardTitle:'Panel inteligente', dashboardSub:'Resumen simple del estado de Miller, dispositivos, aplicaciones y sesión actual.', devicesTitle:'Dispositivos', devicesSub:'Elige el micrófono y la salida principal que Miller debe usar.', appsTitle:'Aplicaciones', appsSub:'Esta pantalla ahora muestra procesos detectados. En la fase de audio real, mostrará solo apps que emiten sonido y sus niveles.', smartTitle:'Smart Mic', smartSub:'Perfiles y ajustes del micrófono en una sola pantalla más simple.', routesTitle:'Rutas', routesSub:'Define a dónde se enviará cada aplicación. El audio real se conectará a esta base después.', settingsTitle:'Configuración', settingsSub:'Idioma, apariencia, audio, actualizaciones, inicio y opciones avanzadas.', supportTitle:'Soporte', supportSub:'Diagnóstico, auditoría, logs e informe técnico para soporte.', licenseTitle:'Licencia', licenseSub:'Control del plan Free, activación Pro/Studio e ID único de este equipo.',
    profileCurrent:'Perfil actual', quickProfiles:'Perfiles rápidos', micSettings:'Configuración del micrófono', noise:'Reducción de ruido', noiseHelp:'Elimina ventilador, ambiente y ruidos constantes.', keyboard:'Anti-teclado', keyboardHelp:'Reduce teclado y clics del mouse.', gate:'Gate', gateHelp:'Cierra el micrófono cuando no estás hablando.', compressor:'Compresor', compressorHelp:'Mantiene el volumen de voz más estable.', limiter:'Limiter', limiterHelp:'Evita saturación cuando hablas fuerte.', natural:'Naturalidad', naturalHelp:'Mantiene la voz menos robótica.', autoGain:'Ganancia automática', laugh:'No cortar risas', scream:'No cortar gritos',
    general:'General', language:'Idioma', appearance:'Apariencia', theme:'Tema', scale:'Escala', animations:'Animaciones', transparency:'Transparencia', startup:'Inicio', startWithWindows:'Iniciar con Windows', startMinimized:'Iniciar minimizado', closeToTray:'Cerrar minimiza a bandeja', updates:'Actualizaciones', checkUpdates:'Buscar actualizaciones automáticamente', channel:'Canal', audio:'Audio', quality:'Calidad de audio', lowLatency:'Baja latencia', lowLatencyHelp:'Menos retraso, ideal para juegos y comunicación.', balanced:'Equilibrado', balancedHelp:'Mejor opción para la mayoría de usuarios.', maxQuality:'Máxima calidad', maxQualityHelp:'Más estabilidad y calidad, con un poco más de retraso.', engine:'Engine', sampleRate:'Frecuencia de muestreo', sampleRateHelp:'Calidad base del audio. 48 kHz es recomendado para streaming.', buffer:'Buffer', bufferHelp:'Menor = menos retraso. Mayor = más estabilidad.', aiEngine:'IA del micrófono', aiHelp:'RNNoise y WebRTC se activarán en próximas fases.', performance:'Rendimiento', performanceHelp:'Información técnica movida a Configuración > Avanzado.', cpu:'CPU', memory:'Memoria', systemStatus:'Estado del sistema', smartMicStatus:'Smart Mic', routesStatus:'Rutas', audit:'Auditoría', logs:'Logs',
    wizardTitle:'Asistente inicial', wizardSub:'Configura Miller en pocos pasos.', stepMic:'Elige tu micrófono', stepOutput:'Elige tu salida', stepUse:'¿Cuál será tu uso principal?', useDiscord:'Discord', useFiveM:'FiveM RP', useStreaming:'Streaming', useGames:'Juegos', usePodcast:'Podcast', finishWizard:'Aplicar y empezar', skipWizard:'Omitir asistente',
    freeNote:'En Free, la sesión se pausará cada 1 hora hasta que hagas clic en Continuar Free.', buyNote:'Comprar Pro abrirá tu enlace de pago cuando esté configurado.', proBenefits:'Beneficios Pro', realAudio:'Audio real por aplicación', vuMeter:'Medidores de volumen', unlimited:'Perfiles y rutas ilimitados', premiumThemes:'Temas premium', latencyPending:'Aguardando medição real', micPermissionHelp:'Permita acesso ao microfone para retorno e teste real.', micMonitorActive:'Retorno do microfone ativo', micRecordReady:'Teste gravado e pronto para reproduzir', realRoutesOnly:'Rotas exibem apenas sessões reais de áudio detectadas.'
  }
} as const;


const languageExtras = {
  'pt-BR': {
    estimated:'estimada', off:'OFF', freeStatus:'FREE', mainRoute:'Rota Principal', virtualBus:'Barramento Miller', selectDevice:'Selecionar dispositivo', routeOutputs:'Saídas da rota', outputBusHelp:'Escolha qual dispositivo físico ou barramento virtual cada saída A1-A5 representa.', outputMatrix:'Matriz de saída', primaryOutput:'Saída principal', monitorOutput:'Monitor', streamMix:'Mix da transmissão', recording:'Gravação', cloneSuffix:'Cópia', noAudioDevice:'Nenhum dispositivo físico', automatic:'Automático', disabled:'Desligado', futureAsio:'ASIO (futuro)', low:'Baixo', silent:'Silencioso', active:'Ativo', coreAudioNext:'V4.6: WASAPI/Core Audio real para medir, capturar e rotear áudio.', freeStatusText:'Grátis', routeDeleteHelp:'Mantenha ao menos uma rota salva.', appListOptimization:'Lista otimizada: os processos são agrupados para reduzir uso de CPU. Na fase de áudio real, apenas aplicativos emitindo som serão exibidos.', nextAudioPhase:'Na próxima fase, esta lista será trocada por sessões reais de áudio com medidor por aplicativo.', noAudioWarning:'Nenhum dispositivo de áudio foi detectado.', noInputWarning:'Nenhum microfone foi detectado; saídas foram detectadas normalmente.', noOutputWarning:'Nenhuma saída de áudio foi detectada; microfones foram detectados normalmente.', monitorMic:'Ouvir retorno do microfone', monitorMicHelp:'Prévia do retorno local do microfone. A captura real será conectada ao Core de Áudio no Pack C.', ticketTitle:'Enviar ticket de suporte', ticketContact:'Seu e-mail ou Discord', ticketCategory:'Tipo do problema', ticketMessage:'Descreva o erro ou sugestão', ticketCreate:'Gerar ticket', ticketCreated:'Ticket salvo em', ticketHelp:'Recomendado: o app gera um arquivo de ticket com auditoria. Você pode enviar por e-mail, Discord ou anexar no suporte.', ticketCategoryBug:'Bug / erro', ticketCategoryIdea:'Sugestão', ticketCategoryAudio:'Áudio / dispositivo', ticketCategoryLicense:'Licença', trayRefresh:'Atualizar dispositivos', trayProfiles:'Meus perfis', currentVersion:'Versão atual', latestVersion:'Última versão', UPDATE_LATEST:'Você já está na versão mais recente deste canal.', UPDATE_NOTE_AUDIO_SESSIONS:'Base de sessões de áudio preparada', UPDATE_NOTE_VU_METER:'VU Meter inicial preparado', UPDATE_NOTE_FREE_PRO_RULES:'Regras Free/Pro/Studio aplicadas', audioSessions:'Sessões de áudio', audioSessionsHelp:'Primeira base de Audio Real: mostra apps prováveis com áudio e medidores iniciais.', audioAppsSub:'Aplicativos com base de áudio ativa e medidores iniciais.', vuMeter:'VU Meter', freeProfileLimit:'Plano Free permite no máximo 5 perfis rápidos.', freeRouteLimit:'Plano Free permite no máximo 2 rotas.', proOnlySupport:'Suporte disponível no Pro', proOnlySupportHelp:'No Free, você pode exportar diagnóstico. Tickets diretos ficam disponíveis no Pro.', FREE_ACTIVE:'Modo Free ativo', FREE_SESSION_EXPIRED:'Sessão Free expirada. Clique em Continuar Free.', FREE_SESSION_RESTARTED:'Sessão Free reiniciada por 1 hora', LICENSE_PRO_ACTIVE:'Licença PRO ativada neste computador', LICENSE_STUDIO_ACTIVE:'Licença STUDIO ativada neste computador', myProfiles:'Meus perfis', officialLibrary:'Biblioteca Oficial', officialLibraryHelp:'Perfis prontos do Miller. Eles são somente leitura; duplique para editar.', duplicateToMyProfiles:'Duplicar para meus perfis', previewApply:'Aplicar prévia', readOnlyProfile:'Perfil oficial · somente leitura', customProfile:'Perfil personalizado', noUserProfiles:'Nenhum perfil criado ainda. Clique em Novo ou duplique um perfil oficial.', defaultUserProfile:'Meu Perfil', defaultUserProfileDesc:'Perfil editável criado pelo usuário.', voiceGames:'Jogos com Voz', voiceGamesDesc:'Jogos online, RP, FPS e comunicação por voz.', meetingProfile:'Reuniões', cleanProfile:'Ultra Limpo', notebookProfile:'Notebook', keyboardProfile:'Teclado Mecânico', wizardUseVoiceGames:'Jogos com Voz', wizardUseGeneral:'Uso Geral', studioTitle:'Studio', studioSub:'Centro avançado para perfil inteligente, mixer, backup, teste de microfone e análise do ambiente.', smartRules:'Perfil inteligente por aplicativo', defaultProfile:'Perfil padrão', applyAutomatically:'Aplicar automaticamente', askBeforeSwitch:'Perguntar antes de trocar', backupProfiles:'Backup e importação', exportProfiles:'Exportar perfis', importProfiles:'Importar perfis', micTest:'Teste de microfone', recordTest:'Gravar teste de 5 segundos', playTest:'Ouvir teste', noiseAnalyzer:'Noise AI Analyzer', analyzeEnvironment:'Analisar ambiente por 3 segundos', analyzerResult:'Sugestão do analisador', liveDashboard:'Dashboard vivo', analytics:'Analytics', health:'Saúde do sistema', excellent:'Excelente', mixer:'Mixer', mute:'Mute', solo:'Solo', profileLibrary:'Biblioteca de perfis', officialVoiceGames:'Jogos com Voz', officialVoiceGamesDesc:'Jogos online, RP, FPS e comunicação por voz.', officialStreaming:'Streaming', officialStreamingDesc:'Voz estável para OBS, Twitch, Kick e YouTube.', officialDiscord:'Discord', officialDiscordDesc:'Comunicação limpa para chamadas e chat de voz.', officialMeetings:'Reuniões', officialMeetingsDesc:'Equilibrado para Teams, Meet, Zoom e trabalho.', officialPodcast:'Podcast', officialPodcastDesc:'Voz natural e cheia para gravação.', officialUltraClean:'Ultra Limpo', officialUltraCleanDesc:'Máxima remoção de ruído para ambientes difíceis.', officialNotebook:'Notebook', officialNotebookDesc:'Configuração segura para microfones integrados.', officialKeyboard:'Teclado Mecânico', officialKeyboardDesc:'Foco em reduzir teclado e cliques.'
  },
  'en-US': {
    estimated:'estimated', off:'OFF', freeStatus:'FREE', mainRoute:'Main Route', virtualBus:'Miller Bus', selectDevice:'Select device', routeOutputs:'Route outputs', outputBusHelp:'Choose which physical device or virtual bus each A1-A5 output represents.', outputMatrix:'Output matrix', primaryOutput:'Main output', monitorOutput:'Monitor', streamMix:'Stream mix', recording:'Recording', cloneSuffix:'Copy', noAudioDevice:'No physical device', automatic:'Automatic', disabled:'Disabled', futureAsio:'ASIO (future)', low:'Low', silent:'Silent', active:'Active', coreAudioNext:'V4.6: Real WASAPI/Core Audio to meter, capture and route audio.', freeStatusText:'Free', routeDeleteHelp:'Keep at least one saved route.', appListOptimization:'Optimized list: processes are grouped to reduce CPU usage. In the real-audio phase, only apps producing sound will be displayed.', nextAudioPhase:'In the next phase, this list will be replaced by real audio sessions with per-app meters.', noAudioWarning:'No audio device was detected.', noInputWarning:'No microphone was detected; outputs were detected normally.', noOutputWarning:'No output device was detected; microphones were detected normally.', monitorMic:'Monitor microphone return', monitorMicHelp:'Local microphone monitoring preview. Real capture will be connected to the Audio Core in Pack C.', ticketTitle:'Send support ticket', ticketContact:'Your email or Discord', ticketCategory:'Problem type', ticketMessage:'Describe the error or suggestion', ticketCreate:'Generate ticket', ticketCreated:'Ticket saved at', ticketHelp:'Recommended: the app generates a ticket file with audit data. You can send it by email, Discord or attach it to support.', ticketCategoryBug:'Bug / error', ticketCategoryIdea:'Suggestion', ticketCategoryAudio:'Audio / device', ticketCategoryLicense:'License', trayRefresh:'Refresh devices', trayProfiles:'My profiles', currentVersion:'Current version', latestVersion:'Latest version', UPDATE_LATEST:'You are already on the latest version for this channel.', UPDATE_NOTE_AUDIO_SESSIONS:'Audio session foundation prepared', UPDATE_NOTE_VU_METER:'Initial VU meter prepared', UPDATE_NOTE_FREE_PRO_RULES:'Free/Pro/Studio rules applied', audioSessions:'Audio sessions', audioSessionsHelp:'First real-audio foundation: shows likely audio apps with initial meters.', audioAppsSub:'Applications with audio foundation enabled and initial meters.', vuMeter:'VU Meter', freeProfileLimit:'Free plan allows up to 5 quick profiles.', freeRouteLimit:'Free plan allows up to 2 routes.', proOnlySupport:'Support available on Pro', proOnlySupportHelp:'On Free, you can export diagnostics. Direct tickets are available on Pro.', FREE_ACTIVE:'Free mode active', FREE_SESSION_EXPIRED:'Free session expired. Click Continue Free.', FREE_SESSION_RESTARTED:'Free session restarted for 1 hour', LICENSE_PRO_ACTIVE:'PRO license active on this computer', LICENSE_STUDIO_ACTIVE:'STUDIO license active on this computer', myProfiles:'My profiles', officialLibrary:'Official Library', officialLibraryHelp:'Ready-made Miller profiles. They are read-only; duplicate to edit.', duplicateToMyProfiles:'Duplicate to my profiles', previewApply:'Apply preview', readOnlyProfile:'Official profile · read-only', customProfile:'Custom profile', noUserProfiles:'No user profile yet. Click New or duplicate an official profile.', defaultUserProfile:'My Profile', defaultUserProfileDesc:'Editable profile created by the user.', voiceGames:'Voice Games', voiceGamesDesc:'Online games, RP, FPS and voice chat.', meetingProfile:'Meetings', cleanProfile:'Ultra Clean', notebookProfile:'Notebook', keyboardProfile:'Mechanical Keyboard', wizardUseVoiceGames:'Voice Games', wizardUseGeneral:'General Use', studioTitle:'Studio', studioSub:'Advanced center for intelligent profiles, mixer, backup, microphone test and environment analysis.', smartRules:'App intelligent profile', defaultProfile:'Default profile', applyAutomatically:'Apply automatically', askBeforeSwitch:'Ask before switching', backupProfiles:'Backup and import', exportProfiles:'Export profiles', importProfiles:'Import profiles', micTest:'Microphone test', recordTest:'Record 5-second test', playTest:'Play test', noiseAnalyzer:'Noise AI Analyzer', analyzeEnvironment:'Analyze environment for 3 seconds', analyzerResult:'Analyzer suggestion', liveDashboard:'Live dashboard', analytics:'Analytics', health:'System health', excellent:'Excellent', mixer:'Mixer', mute:'Mute', solo:'Solo', profileLibrary:'Profile library', officialVoiceGames:'Voice Games', officialVoiceGamesDesc:'Online games, RP, FPS and voice chat.', officialStreaming:'Streaming', officialStreamingDesc:'Stable voice for OBS, Twitch, Kick and YouTube.', officialDiscord:'Discord', officialDiscordDesc:'Clean communication for calls and voice chat.', officialMeetings:'Meetings', officialMeetingsDesc:'Balanced for Teams, Meet, Zoom and work.', officialPodcast:'Podcast', officialPodcastDesc:'Natural full voice for recording.', officialUltraClean:'Ultra Clean', officialUltraCleanDesc:'Maximum noise removal for difficult rooms.', officialNotebook:'Notebook', officialNotebookDesc:'Safe setup for built-in microphones.', officialKeyboard:'Mechanical Keyboard', officialKeyboardDesc:'Focus on reducing keyboard and clicks.'
  },
  'es-ES': {
    estimated:'estimada', off:'OFF', freeStatus:'FREE', mainRoute:'Ruta Principal', virtualBus:'Bus Miller', selectDevice:'Seleccionar dispositivo', routeOutputs:'Salidas de la ruta', outputBusHelp:'Elige qué dispositivo físico o bus virtual representa cada salida A1-A5.', outputMatrix:'Matriz de salida', primaryOutput:'Salida principal', monitorOutput:'Monitor', streamMix:'Mezcla de transmisión', recording:'Grabación', cloneSuffix:'Copia', noAudioDevice:'Ningún dispositivo físico', automatic:'Automático', disabled:'Desactivado', futureAsio:'ASIO (futuro)', low:'Bajo', silent:'Silencioso', active:'Activo', coreAudioNext:'V4.6: WASAPI/Core Audio real para medir, capturar y enrutar audio.', freeStatusText:'Gratis', routeDeleteHelp:'Mantén al menos una ruta guardada.', appListOptimization:'Lista optimizada: los procesos se agrupan para reducir el uso de CPU. En la fase de audio real, solo se mostrarán las aplicaciones que emiten sonido.', nextAudioPhase:'En la próxima fase, esta lista será reemplazada por sesiones de audio reales con medidores por aplicación.', noAudioWarning:'No se detectó ningún dispositivo de audio.', noInputWarning:'No se detectó ningún micrófono; las salidas se detectaron correctamente.', noOutputWarning:'No se detectó ninguna salida de audio; los micrófonos se detectaron correctamente.', monitorMic:'Escuchar retorno del micrófono', monitorMicHelp:'Vista previa del retorno local del micrófono. La captura real se conectará al Core de Audio en el Pack C.', ticketTitle:'Enviar ticket de soporte', ticketContact:'Tu e-mail o Discord', ticketCategory:'Tipo de problema', ticketMessage:'Describe el error o sugerencia', ticketCreate:'Generar ticket', ticketCreated:'Ticket guardado en', ticketHelp:'Recomendado: la app genera un archivo de ticket con auditoría. Puedes enviarlo por e-mail, Discord o adjuntarlo al soporte.', ticketCategoryBug:'Bug / error', ticketCategoryIdea:'Sugerencia', ticketCategoryAudio:'Audio / dispositivo', ticketCategoryLicense:'Licencia', trayRefresh:'Actualizar dispositivos', trayProfiles:'Mis perfiles', currentVersion:'Versión actual', latestVersion:'Última versión', UPDATE_LATEST:'Ya tienes la versión más reciente de este canal.', UPDATE_NOTE_AUDIO_SESSIONS:'Base de sesiones de audio preparada', UPDATE_NOTE_VU_METER:'VU Meter inicial preparado', UPDATE_NOTE_FREE_PRO_RULES:'Reglas Free/Pro/Studio aplicadas', audioSessions:'Sesiones de audio', audioSessionsHelp:'Primera base de audio real: muestra apps probables con audio y medidores iniciales.', audioAppsSub:'Aplicaciones con base de audio activa y medidores iniciales.', vuMeter:'VU Meter', freeProfileLimit:'El plan Free permite hasta 5 perfiles rápidos.', freeRouteLimit:'El plan Free permite hasta 2 rutas.', proOnlySupport:'Soporte disponible en Pro', proOnlySupportHelp:'En Free puedes exportar diagnóstico. Los tickets directos están disponibles en Pro.', FREE_ACTIVE:'Modo Free activo', FREE_SESSION_EXPIRED:'Sesión Free expirada. Haz clic en Continuar Free.', FREE_SESSION_RESTARTED:'Sesión Free reiniciada por 1 hora', LICENSE_PRO_ACTIVE:'Licencia PRO activa en este equipo', LICENSE_STUDIO_ACTIVE:'Licencia STUDIO activa en este equipo', myProfiles:'Mis perfiles', officialLibrary:'Biblioteca Oficial', officialLibraryHelp:'Perfiles listos de Miller. Son de solo lectura; duplica para editar.', duplicateToMyProfiles:'Duplicar a mis perfiles', previewApply:'Aplicar vista previa', readOnlyProfile:'Perfil oficial · solo lectura', customProfile:'Perfil personalizado', noUserProfiles:'Aún no hay perfil del usuario. Haz clic en Nuevo o duplica un perfil oficial.', defaultUserProfile:'Mi Perfil', defaultUserProfileDesc:'Perfil editable creado por el usuario.', voiceGames:'Juegos con Voz', voiceGamesDesc:'Juegos online, RP, FPS y chat de voz.', meetingProfile:'Reuniones', cleanProfile:'Ultra Limpio', notebookProfile:'Notebook', keyboardProfile:'Teclado Mecánico', wizardUseVoiceGames:'Juegos con Voz', wizardUseGeneral:'Uso General', studioTitle:'Studio', studioSub:'Centro avanzado para perfiles inteligentes, mixer, backup, prueba de micrófono y análisis del ambiente.', smartRules:'Perfil inteligente por aplicación', defaultProfile:'Perfil predeterminado', applyAutomatically:'Aplicar automáticamente', askBeforeSwitch:'Preguntar antes de cambiar', backupProfiles:'Backup e importación', exportProfiles:'Exportar perfiles', importProfiles:'Importar perfiles', micTest:'Prueba de micrófono', recordTest:'Grabar prueba de 5 segundos', playTest:'Escuchar prueba', noiseAnalyzer:'Noise AI Analyzer', analyzeEnvironment:'Analizar ambiente por 3 segundos', analyzerResult:'Sugerencia del analizador', liveDashboard:'Dashboard vivo', analytics:'Analytics', health:'Salud del sistema', excellent:'Excelente', mixer:'Mixer', mute:'Silenciar', solo:'Solo', profileLibrary:'Biblioteca de perfiles', officialVoiceGames:'Juegos con Voz', officialVoiceGamesDesc:'Juegos online, RP, FPS y chat de voz.', officialStreaming:'Streaming', officialStreamingDesc:'Voz estable para OBS, Twitch, Kick y YouTube.', officialDiscord:'Discord', officialDiscordDesc:'Comunicación limpia para llamadas y chat de voz.', officialMeetings:'Reuniones', officialMeetingsDesc:'Equilibrado para Teams, Meet, Zoom y trabajo.', officialPodcast:'Podcast', officialPodcastDesc:'Voz natural y completa para grabación.', officialUltraClean:'Ultra Limpio', officialUltraCleanDesc:'Máxima eliminación de ruido para ambientes difíciles.', officialNotebook:'Notebook', officialNotebookDesc:'Configuración segura para micrófonos integrados.', officialKeyboard:'Teclado Mecánico', officialKeyboardDesc:'Enfocado en reducir teclado y clics.'
  }
} as const;

const DEFAULT_STATE: MillerState = { ok: true, timestamp: 'N/A', warning: '', hardware: { inputs: [], outputs: [], preferredInput: null, preferredOutput: null }, apps: [], performance: { sampleRate: 48000, buffer: 128, latencyMs: 0, cpu: 0 } };
const DEFAULT_SMART: SmartMic = { noise: 75, keyboard: 70, gate: 55, compressor: 60, limiter: 70, natural: 80, autoGain: true, protectLaugh: true, protectScream: true };
const DEFAULT_SETTINGS: Settings = { language: 'pt-BR', theme: 'miller-blue', scale: 100, animations: true, transparency: true, autoRefresh: true, startWithWindows: false, startMinimized: false, closeToTray: true, checkUpdates: true, updateChannel: 'stable', qualityMode: 'balanced', showAdvancedAudio: false, engine: 'auto', sampleRate: 48000, buffer: 128, micEngine: 'off', logsEnabled: true, advancedLogs: false, saveAudits: true, monitorMicrophone: false };
const DEFAULT_PROFILES: Profile[] = [
  { id: 'user-default', name: 'Meu Perfil', desc: 'Perfil editável criado pelo usuário.', smartMic: { ...DEFAULT_SMART }, mode: 'Custom' }
];
const OFFICIAL_PROFILES: Profile[] = [
  { id: 'official-voice-games', name: 'Jogos com Voz', desc: 'Jogos online, RP, FPS e comunicação por voz.', smartMic: { ...DEFAULT_SMART, noise: 82, keyboard: 85, gate: 68, compressor: 62, limiter: 72, natural: 68 }, mode: 'Voice Games' },
  { id: 'official-stream', name: 'Streaming', desc: 'Voz estável para OBS, Twitch, Kick e YouTube.', smartMic: { ...DEFAULT_SMART, noise: 55, keyboard: 55, gate: 38, compressor: 68, limiter: 72, natural: 88 }, mode: 'Streaming' },
  { id: 'official-discord', name: 'Discord', desc: 'Comunicação limpa para chamadas e chat de voz.', smartMic: { ...DEFAULT_SMART, noise: 70, keyboard: 75, gate: 60, compressor: 60, limiter: 70, natural: 75 }, mode: 'Communication' },
  { id: 'official-meeting', name: 'Reuniões', desc: 'Equilibrado para Teams, Meet, Zoom e trabalho.', smartMic: { ...DEFAULT_SMART, noise: 60, keyboard: 65, gate: 45, compressor: 58, limiter: 65, natural: 85 }, mode: 'Meetings' },
  { id: 'official-podcast', name: 'Podcast', desc: 'Voz natural e cheia para gravação.', smartMic: { ...DEFAULT_SMART, noise: 50, keyboard: 35, gate: 30, compressor: 74, limiter: 68, natural: 92 }, mode: 'Podcast' },
  { id: 'official-clean', name: 'Ultra Limpo', desc: 'Máxima remoção de ruído para ambientes difíceis.', smartMic: { ...DEFAULT_SMART, noise: 95, keyboard: 95, gate: 82, compressor: 66, limiter: 76, natural: 50 }, mode: 'Clean' },
  { id: 'official-notebook', name: 'Notebook', desc: 'Configuração segura para microfones integrados.', smartMic: { ...DEFAULT_SMART, noise: 78, keyboard: 80, gate: 65, compressor: 60, limiter: 70, natural: 70 }, mode: 'Notebook' },
  { id: 'official-keyboard', name: 'Teclado Mecânico', desc: 'Foco em reduzir teclado e cliques.', smartMic: { ...DEFAULT_SMART, noise: 88, keyboard: 100, gate: 78, compressor: 62, limiter: 72, natural: 60 }, mode: 'Keyboard' }
];
const OFFICIAL_PROFILE_NAMES = new Set(OFFICIAL_PROFILES.map(p => p.name.toLowerCase()));
const DEFAULT_ROUTES: RoutePreset[] = [{ id: 'default', name: 'Rota Principal', matrix: {}, outputs: ['', '', '', '', ''] }];

function safeArray<T>(v: unknown): T[] { return Array.isArray(v) ? v as T[] : []; }
function n(v: unknown, fallback = 0): number { const x = Number(v); return Number.isFinite(x) ? x : fallback; }
function text(v: unknown, fallback = '—'): string { return typeof v === 'string' && v.trim() ? v : fallback; }
function loadLS<T>(key: string, fallback: T): T { try { const raw = localStorage.getItem(key); return raw ? { ...fallback as any, ...JSON.parse(raw) } : fallback; } catch { return fallback; } }
function loadArray<T>(key: string, fallback: T[]): T[] { try { const raw = localStorage.getItem(key); const v = raw ? JSON.parse(raw) : fallback; return Array.isArray(v) ? v : fallback; } catch { return fallback; } }
function makeId() { return globalThis.crypto?.randomUUID?.() || String(Date.now() + Math.random()); }
function shortId(v?: string) { return v && v.length > 92 ? `${v.slice(0, 92)}...` : (v || ''); }
function machineId() { let v = localStorage.getItem('miller_machine_id'); if (!v) { v = `MILLER-PC-${Math.random().toString(16).slice(2,10).toUpperCase()}${Date.now().toString(16).slice(-4).toUpperCase()}`; localStorage.setItem('miller_machine_id', v); } return v; }
function isPaidPlan(lic: LicenseState | null) { return !!lic?.activated && ['PRO','STUDIO'].includes(String(lic.licenseType || '').toUpperCase()); }
function translateMessage(msg: string | undefined, t: any) { const m = String(msg || ''); return t[m] || m; }
function planLimits(lic: LicenseState | null) { const paid = isPaidPlan(lic); return { paid, maxProfiles: paid ? Infinity : 5, maxRoutes: paid ? Infinity : 2, themes: paid ? null : ['miller-blue','miller-red'] }; }

function formatTimeMMSS(seconds: unknown) {
  const total = Math.max(0, Math.floor(n(seconds, 3600)));
  const mm = String(Math.floor(total / 60)).padStart(2, '0');
  const ss = String(total % 60).padStart(2, '0');
  return `${mm}:${ss}`;
}
function appGroupKey(a: any) {
  const process = String(a?.process || '').toLowerCase();
  const app = String(a?.app || '').toLowerCase();
  if (process.includes('chrome')) return 'chrome.exe';
  if (process.includes('msedgewebview2')) return 'msedgewebview2.exe';
  if (process.includes('msedge')) return 'msedge.exe';
  if (process.includes('discord')) return 'discord.exe';
  if (process.includes('spotify')) return 'spotify.exe';
  if (process.includes('obs')) return 'obs.exe';
  if (process.includes('fivem')) return 'fivem.exe';
  return process || app || 'unknown';
}
function groupAudioRows(rows: any[]) {
  const map = new Map<string, any>();
  for (const row of rows || []) {
    const key = appGroupKey(row);
    const cur = map.get(key) || { ...row, count: 0, pids: [], volume: 0, peak: 0, activity: 0 };
    cur.count += Number(row.count || 1);
    if (row.pid) cur.pids.push(row.pid);
    cur.volume = Math.max(n(cur.volume), n(row.volume || row.activity));
    cur.peak = Math.max(n(cur.peak), n(row.peak ?? row.activity));
    cur.activity = Math.max(n(cur.activity), n(row.activity));
    cur.active = Boolean(cur.active || row.active || n(row.peak ?? row.activity) > 8);
    cur.route = cur.route || row.route || 'A1';
    cur.process = cur.process || row.process || key;
    cur.app = cur.app || row.app || key;
    map.set(key, cur);
  }
  return [...map.values()].sort((a,b)=>n(b.peak ?? b.activity)-n(a.peak ?? a.activity));
}


function sessionKey(a: any) {
  const proc = String(a?.process || appGroupKey(a) || 'unknown.exe').toLowerCase();
  return proc || String(a?.app || 'unknown').toLowerCase();
}
function isEffectivelyMuted(row: any) { return !!row?.muted || !!row?.mutedBySolo; }
function hasAnySolo(persist: MixerPersist) { return Object.values(persist || {}).some((x: any) => !!x?.solo); }
function makePersistItem(row: any, existing?: MixerPersist[string]): MixerPersist[string] {
  return {
    app: row?.app,
    process: row?.process || sessionKey(row),
    volume: n(existing?.volume ?? row?.volume, 100),
    route: existing?.route || row?.route || 'A1',
    muted: !!existing?.muted,
    mutedBySolo: !!existing?.mutedBySolo,
    solo: !!existing?.solo,
    previousVolume: existing?.previousVolume,
    lastSeen: Date.now(),
  };
}
function normalizeMixerPersist(raw: any): MixerPersist {
  const out: MixerPersist = {};
  for (const [key, value] of Object.entries(raw || {}) as any) {
    out[key] = {
      app: value?.app,
      process: value?.process || key,
      volume: n(value?.volume, 100),
      route: value?.route || 'A1',
      muted: !!value?.muted,
      mutedBySolo: !!value?.mutedBySolo,
      solo: !!value?.solo,
      previousVolume: value?.previousVolume,
      lastSeen: n(value?.lastSeen, Date.now()),
    };
  }
  return out;
}
function loadMixerPersist(): MixerPersist { try { return normalizeMixerPersist(JSON.parse(localStorage.getItem('miller_mixer_persist_v653') || localStorage.getItem('miller_mixer_persist_v652') || '{}') || {}); } catch { return {}; } }
function saveMixerPersist(v: MixerPersist) { localStorage.setItem('miller_mixer_persist_v653', JSON.stringify(normalizeMixerPersist(v))); }
function mergeSessionsWithPersist(rows: any[], persist: MixerPersist, includeRecent = false) {
  const now = Date.now();
  const map = new Map<string, any>();
  for (const r of groupAudioRows(rows || [])) {
    const key = sessionKey(r);
    const saved = persist[key];
    map.set(key, { ...r, key, volume: saved?.volume ?? n(r.volume, 100), route: saved?.route || r.route || 'A1', muted: !!saved?.muted, mutedBySolo: !!saved?.mutedBySolo, solo: !!saved?.solo, recent: false, lastSeen: now });
  }
  if (includeRecent) {
    for (const [key, saved] of Object.entries(persist)) {
      if (!map.has(key) && saved.lastSeen && now - saved.lastSeen < 1000 * 60 * 60 * 24 * 7) {
        map.set(key, { key, app: saved.app || saved.process || key, process: saved.process || key, pid: 0, pids: [], volume: saved.volume, peak: 0, active: false, route: saved.route || 'A1', muted: !!saved.muted, mutedBySolo: !!saved.mutedBySolo, solo: !!saved.solo, recent: true, lastSeen: saved.lastSeen, source: 'RECENT' });
      }
    }
  }
  return [...map.values()].sort((a,b)=>Number(a.recent)-Number(b.recent) || n(b.peak)-n(a.peak));
}
function freeExpiryKey(machine?: string) { return `miller_free_expires_at_${machine || machineId()}`; }
function freeLeftFromLocal(machine?: string) { const exp = Number(localStorage.getItem(freeExpiryKey(machine)) || 0); return exp ? Math.max(0, Math.floor((exp - Date.now()) / 1000)) : null; }

function latencyText(perf: any, t: any) { const v = n(perf?.latencyMs, 0); return v > 0 ? `${v} ms` : (t.latencyPending || 'Aguardando medição real'); }
function card(title: string, value: string, sub?: string, status: 'ok' | 'warn' | 'off' = 'ok') { return <div className="stat-card"><span>{title}</span><b className={status}>{value}</b>{sub && <small>{sub}</small>}</div>; }
function row(label: string, value: string | number, status: 'ok' | 'warn' | 'off' | '' = '') { return <div className="row"><span>{label}</span><b className={status}>{value}</b></div>; }


function warningText(raw: unknown, t: any) {
  const v = String(raw || '');
  if (!v) return '';
  if (v === 'NO_AUDIO_DEVICES') return t.noAudioWarning || t.notFound;
  if (v === 'NO_INPUT_DEVICES') return t.noInputWarning || t.notFound;
  if (v === 'NO_OUTPUT_DEVICES') return t.noOutputWarning || t.notFound;
  if (v.startsWith('Core:')) return v;
  return v;
}

function routeDisplayName(name: string | undefined, t: any) {
  if (!name || name === 'Rota Principal' || name === 'Main Route' || name === 'Ruta Principal') return t.mainRoute;
  return name;
}
function defaultRouteOutputs(outputs: AudioDevice[]) {
  return [0,1,2,3,4].map(i => outputs[i]?.id || '');
}
function routeOutputLabel(bus: string, idx: number, outputs: AudioDevice[], t: any) {
  const found = outputs.find(d => d.id === bus);
  if (found) return found.name || `${t.output} A${idx+1}`;
  const labels = [t.primaryOutput, t.monitorOutput, `${t.monitorOutput} 2`, t.streamMix, t.recording];
  return `${t.virtualBus} ${idx+1} · ${labels[idx] || `A${idx+1}`}`;
}

function officialProfileText(profile: Profile, t: any) {
  const map: Record<string, [string,string]> = {
    'official-voice-games': [t.officialVoiceGames, t.officialVoiceGamesDesc],
    'official-stream': [t.officialStreaming, t.officialStreamingDesc],
    'official-discord': [t.officialDiscord, t.officialDiscordDesc],
    'official-meeting': [t.officialMeetings, t.officialMeetingsDesc],
    'official-podcast': [t.officialPodcast, t.officialPodcastDesc],
    'official-clean': [t.officialUltraClean, t.officialUltraCleanDesc],
    'official-notebook': [t.officialNotebook, t.officialNotebookDesc],
    'official-keyboard': [t.officialKeyboard, t.officialKeyboardDesc],
  };
  const entry = map[profile.id];
  return entry ? { name: entry[0], desc: entry[1] } : { name: profile.name, desc: profile.desc };
}
function profileName(profile: Profile, t: any) { return officialProfileText(profile, t).name; }
function profileDesc(profile: Profile, t: any) { return officialProfileText(profile, t).desc; }


export default function App() {
  const [tab, setTab] = useState<Tab>('dashboard');
  const [state, setState] = useState<MillerState>(DEFAULT_STATE);
  const [settings, setSettings] = useState<Settings>(() => loadLS('miller_settings_v44', DEFAULT_SETTINGS));
  const [profiles, setProfiles] = useState<Profile[]>(() => { const loaded = loadArray<Profile>('miller_profiles_v44', DEFAULT_PROFILES); const custom = loaded.filter(p => p && !String(p.id||'').startsWith('official-') && !OFFICIAL_PROFILE_NAMES.has(String(p.name||'').toLowerCase())); return custom.length ? custom : DEFAULT_PROFILES; });
  const [routes, setRoutes] = useState<RoutePreset[]>(() => loadArray('miller_routes_v44', DEFAULT_ROUTES));
  const [selectedProfile, setSelectedProfile] = useState(0);
  const [selectedRoute, setSelectedRoute] = useState(0);
  const [debug, setDebug] = useState<DebugReport | null>(null);
  const [logsPath, setLogsPath] = useState('');
  const [loading, setLoading] = useState(false);
  const [debugLoading, setDebugLoading] = useState(false);
  const [wizard, setWizard] = useState(() => localStorage.getItem('miller_wizard_done_v44') !== 'true');
  const [licenseKey, setLicenseKey] = useState('');
  const [licenseOwner, setLicenseOwner] = useState('');
  const [licenseState, setLicenseState] = useState<LicenseState | null>(null);
  const [licenseMsg, setLicenseMsg] = useState('');
  const [updateInfo, setUpdateInfo] = useState<UpdateInfo | null>(null);
  const [audioSessions, setAudioSessions] = useState<AudioSession[]>([]);
  const [mixerPersist, setMixerPersist] = useState<MixerPersist>(() => loadMixerPersist());
  const [updateLoading, setUpdateLoading] = useState(false);
  const refreshingRef = useRef(false);
  const preferredInputRef = useRef<string | null>(localStorage.getItem('miller_input'));
  const preferredOutputRef = useRef<string | null>(localStorage.getItem('miller_output'));

  const t = useMemo(() => {
    const base = (dict as any)[settings.language] || (dict as any)['pt-BR'];
    const extra = (languageExtras as any)[settings.language] || {};
    return { ...base, ...extra, nav: { ...base.nav, ...(extra.nav || {}) } };
  }, [settings.language]);
  const inputs = safeArray<AudioDevice>(state.hardware?.inputs);
  const outputs = safeArray<AudioDevice>(state.hardware?.outputs);
  const apps = safeArray<AppProcess>(state.apps);
  const prefIn = state.hardware?.preferredInput || inputs[0] || null;
  const prefOut = state.hardware?.preferredOutput || outputs[0] || null;
  const perf = state.performance || DEFAULT_STATE.performance!;
  const currentProfile = profiles[selectedProfile] || profiles[0];

  useEffect(() => { document.body.dataset.theme = settings.theme; document.body.dataset.animations = String(settings.animations); document.body.style.setProperty('--ui-scale', String(settings.scale / 100)); }, [settings.theme, settings.scale, settings.animations]);
  useEffect(() => { getCurrentWindow().maximize().catch(()=>{}); }, []);
  useEffect(() => { localStorage.setItem('miller_settings_v44', JSON.stringify(settings)); }, [settings]);
  useEffect(() => {
    invoke('set_runtime_options', { closeToTray: settings.closeToTray, startMinimized: settings.startMinimized }).catch(()=>{});
  }, [settings.closeToTray, settings.startMinimized]);
  useEffect(() => { localStorage.setItem('miller_profiles_v44', JSON.stringify(profiles)); }, [profiles]);
  useEffect(() => { localStorage.setItem('miller_routes_v44', JSON.stringify(routes)); }, [routes]);
  useEffect(() => { saveMixerPersist(mixerPersist); }, [mixerPersist]);

  async function refreshAudioSessions() {
    try {
      const v = await invoke<AudioSession[]>('get_audio_sessions');
      const raw = Array.isArray(v) ? v : [];
      setAudioSessions(raw);
      if (raw.length) {
        const grouped = groupAudioRows(raw);
        setMixerPersist(prev => {
          const next: MixerPersist = { ...prev };
          const now = Date.now();
          for (const r of grouped) {
            const key = sessionKey(r);
            next[key] = { app: r.app, process: r.process || key, volume: next[key]?.volume ?? n(r.volume, 100), route: next[key]?.route || r.route || 'A1', muted: !!next[key]?.muted, mutedBySolo: hasAnySolo(next) && !next[key]?.solo, solo: !!next[key]?.solo, previousVolume: next[key]?.previousVolume, lastSeen: now };
          }
          return next;
        });
        const soloActive = hasAnySolo(mixerPersist);
        if (soloActive) {
          for (const r of grouped) {
            const saved = mixerPersist[sessionKey(r)];
            if (!saved?.solo) applyMuteToSession(r, true);
          }
        }
      }
      if (!!licenseState && !licenseState.activated && licenseState.licenseType === 'FREE' && n(licenseState.freeSecondsLeft, 3600) <= 0) {
        invoke('set_all_audio_sessions_muted', { muted: true }).catch(()=>{});
      }
    } catch {
      setAudioSessions([]);
    }
  }

  async function refresh(manual = false) {
    if (refreshingRef.current) return;
    refreshingRef.current = true;
    if (manual) setLoading(true);
    try {
      const res = await invoke<MillerState>('get_miller_state', { preferredInputId: preferredInputRef.current, preferredOutputId: preferredOutputRef.current });
      setState({ ...DEFAULT_STATE, ...res, hardware: { ...DEFAULT_STATE.hardware, ...(res?.hardware || {}) }, performance: { ...DEFAULT_STATE.performance, ...(res?.performance || {}) } });
      await refreshAudioSessions();
    } catch (e) { setState(s => ({ ...s, warning: `Core: ${String(e)}` })); }
    finally { refreshingRef.current = false; if (manual) setLoading(false); }
  }
  async function runAudit() { setDebugLoading(true); try { const res = await invoke<DebugReport>('get_debug_report', { preferredInputId: preferredInputRef.current, preferredOutputId: preferredOutputRef.current }); setDebug(res); } finally { setDebugLoading(false); } }
  async function openLogs() { try { await invoke('open_logs_folder'); } catch { /* noop */ } }
  async function loadLicense() { try { const res = await invoke<LicenseState>('get_license_state'); const localLeft = freeLeftFromLocal(res.machineId); const merged = (!res.activated && res.licenseType === 'FREE' && localLeft !== null) ? { ...res, freeSecondsLeft: Math.min(n(res.freeSecondsLeft, 3600), localLeft), message: localLeft <= 0 ? 'FREE_SESSION_EXPIRED' : res.message } : res; if (!res.activated && res.licenseType === 'FREE' && localLeft === null) localStorage.setItem(freeExpiryKey(res.machineId), String(Date.now() + n(res.freeSecondsLeft, 3600) * 1000)); setLicenseState(merged); if (res.licenseKey && !licenseKey) setLicenseKey(res.licenseKey); } catch (e) { setLicenseMsg(String(e)); } }
  async function activateCurrentLicense() { try { const res = await invoke<LicenseState>('activate_license', { licenseKey, owner: licenseOwner }); setLicenseState(res); setLicenseMsg(res.message || 'OK'); } catch (e) { setLicenseMsg(String(e)); } }
  async function continueFree() { try { const res = await invoke<LicenseState>('continue_free_session'); localStorage.setItem(freeExpiryKey(res.machineId), String(Date.now() + 3600 * 1000)); setLicenseState({ ...res, freeSecondsLeft: 3600, message: res.message || 'FREE_SESSION_RESTARTED' }); setLicenseMsg(res.message || 'OK'); } catch (e) { setLicenseMsg(String(e)); } }
  async function checkUpdatesNow() { setUpdateLoading(true); try { const res = await invoke<UpdateInfo>('check_for_updates', { channel: settings.updateChannel }); setUpdateInfo(res); } catch (e) { setUpdateInfo({ currentVersion: '6.1.1 Profile Library', latestVersion: 'N/A', channel: settings.updateChannel, updateAvailable: false, downloadUrl: '', notes: [], message: String(e) }); } finally { setUpdateLoading(false); } }

  useEffect(() => { refresh(true); invoke<string>('get_logs_path').then(setLogsPath).catch(()=>{}); loadLicense(); checkUpdatesNow(); }, []);
  useEffect(() => { if (!settings.autoRefresh) return; const id = setInterval(() => refresh(false), 60000); return () => clearInterval(id); }, [settings.autoRefresh]);
  useEffect(() => { if (!settings.autoRefresh) return; const id = setInterval(() => refreshAudioSessions(), 1000); return () => clearInterval(id); }, [settings.autoRefresh]);

  useEffect(() => {
    const id = setInterval(() => {
      setLicenseState(prev => {
        if (!prev || prev.activated || prev.licenseType !== 'FREE') return prev;
        const localLeft = freeLeftFromLocal(prev.machineId);
        const left = localLeft !== null ? localLeft : Math.max(0, (prev.freeSecondsLeft || 0) - 1);
        return { ...prev, freeSecondsLeft: left, message: left <= 0 ? 'FREE_SESSION_EXPIRED' : prev.message };
      });
    }, 1000);
    const sync = setInterval(() => invoke<LicenseState>('tick_free_session').then(res => setLicenseState(() => {
      const localLeft = freeLeftFromLocal(res.machineId);
      if (!res.activated && res.licenseType === 'FREE' && localLeft !== null) return { ...res, freeSecondsLeft: Math.min(n(res.freeSecondsLeft, 3600), localLeft), message: localLeft <= 0 ? 'FREE_SESSION_EXPIRED' : res.message };
      return res;
    })).catch(()=>{}), 30000);
    return () => { clearInterval(id); clearInterval(sync); };
  }, []);

  const freeLocked = !!licenseState && !licenseState.activated && licenseState.licenseType === 'FREE' && n(licenseState.freeSecondsLeft, 3600) <= 0;

  useEffect(() => {
    invoke('set_all_audio_sessions_muted', { muted: freeLocked }).catch(()=>{});
  }, [freeLocked]);

  useEffect(() => {
    let unlisten: (() => void) | undefined;
    listen<string>('tray-action', (event) => {
      const action = String(event.payload || '');
      if (action === 'refresh-devices') refresh(true);
      if (action.startsWith('profile:')) {
        const key = action.replace('profile:', '').toLowerCase();
        const idx = profiles.findIndex(p => p.id.toLowerCase() === key || p.name.toLowerCase().includes(key));
        if (idx >= 0) setSelectedProfile(idx);
      }
      if (action === 'open-smart-mic') setTab('smartMic');
    }).then(fn => { unlisten = fn; }).catch(()=>{});
    return () => { if (unlisten) unlisten(); };
  }, [profiles]);


  const groupedApps = useMemo(() => {
    const map = new Map<string, AppProcess & { count: number; pids: number[]; ramTotal: number }>();
    for (const a of apps) {
      const key = text(a.process, 'unknown.exe').toLowerCase();
      const item = map.get(key) || { ...a, count: 0, pids: [], ramTotal: 0 };
      item.count += 1; item.pids.push(n(a.pid)); item.ramTotal += n(a.ramMb); item.activity = Math.max(n(item.activity), n(a.activity)); map.set(key, item);
    }
    return [...map.values()].slice(0, 30);
  }, [apps]);

  function updateSettings(patch: Partial<Settings>) { if (Object.prototype.hasOwnProperty.call(patch, 'startWithWindows')) { invoke('set_startup_enabled', { enabled: !!patch.startWithWindows }).catch(()=>{}); } setSettings(s => ({ ...s, ...patch })); }
  function patchProfile(patch: Partial<Profile>) { setProfiles(list => list.map((p, i) => i === selectedProfile ? { ...p, ...patch } : p)); }
  function patchSmartMic(patch: Partial<SmartMic>) { patchProfile({ smartMic: { ...currentProfile.smartMic, ...patch } }); }
  function applyQuality(mode: Settings['qualityMode']) { const map = { lowLatency: { buffer: 64 }, balanced: { buffer: 128 }, quality: { buffer: 256 } } as const; updateSettings({ qualityMode: mode, engine: 'auto', sampleRate: 48000, buffer: map[mode].buffer }); }


  const visibleSessions = useMemo(() => mergeSessionsWithPersist(audioSessions, mixerPersist, false), [audioSessions, mixerPersist]);
  const routeSessions = useMemo(() => mergeSessionsWithPersist(audioSessions, mixerPersist, true), [audioSessions, mixerPersist]);
  async function applyVolumeToSession(row: any, volume: number) {
    const pids = Array.isArray(row?.pids) && row.pids.length ? row.pids : (row?.pid ? [row.pid] : []);
    for (const pid of pids) await invoke('set_audio_session_volume', { pid: Number(pid), volume: Math.max(0, Math.min(100, Math.round(volume))) }).catch(()=>{});
  }
  async function applyMuteToSession(row: any, muted: boolean) {
    const pids = Array.isArray(row?.pids) && row.pids.length ? row.pids : (row?.pid ? [row.pid] : []);
    for (const pid of pids) await invoke('set_audio_session_muted', { pid: Number(pid), muted }).catch(()=>{});
  }
  async function applyPersistedMuteState(rows: any[], persist: MixerPersist) {
    for (const r of rows) {
      const saved = persist[sessionKey(r)];
      if (saved) await applyMuteToSession(r, !!saved.muted || !!saved.mutedBySolo);
    }
  }
  async function updateMixerRow(row: any, patch: Partial<{volume:number; route:string; muted:boolean; solo:boolean}>) {
    const key = sessionKey(row);
    const allRows = mergeSessionsWithPersist(audioSessions, mixerPersist, true);
    const next: MixerPersist = normalizeMixerPersist(mixerPersist);
    const current = makePersistItem(row, next[key]);
    next[key] = { ...current, ...patch, app: row.app, process: row.process || key, lastSeen: Date.now() };

    if (patch.volume !== undefined) {
      next[key].volume = Math.max(0, Math.min(100, Math.round(patch.volume)));
      next[key].muted = false;
    }
    if (patch.muted !== undefined) next[key].muted = !!patch.muted;

    if (patch.solo !== undefined) {
      next[key].solo = !!patch.solo;
      if (patch.solo) next[key].mutedBySolo = false;
      const anySoloAfter = Object.values(next).some((x: any) => !!x?.solo);
      for (const other of allRows) {
        const ok = sessionKey(other);
        next[ok] = makePersistItem(other, next[ok]);
        next[ok].mutedBySolo = anySoloAfter && !next[ok].solo;
      }
      if (!anySoloAfter) Object.values(next).forEach((x: any) => { x.mutedBySolo = false; });
    }

    setMixerPersist(next);
    if (patch.volume !== undefined) await applyVolumeToSession(row, next[key].volume);
    await applyPersistedMuteState(allRows, next);
  }
  const nav: [Tab,string][] = [['dashboard',t.nav.dashboard],['devices',t.nav.devices],['apps',t.nav.apps],['smartMic',t.nav.smartMic],['routes',t.nav.routes],['settings',t.nav.settings],['support',t.nav.support],['license',t.nav.license],['studio',t.nav.studio || t.studioTitle || 'Studio']];

  return <div className="app-shell">
    <aside className="sidebar">
      <div className="brand"><span className="dot"/><div><h1>Miller</h1><p>Audio Studio X</p></div></div>
      {nav.map(([id,label]) => <button key={id} className={tab===id?'nav active':'nav'} onClick={() => setTab(id)}>{label}</button>)}
      <small className="version">V6.5.3 Stability & Performance</small>
    </aside>
    <main className="main">
      <div className="top-actions"><label className="auto-pill"><input type="checkbox" checked={settings.autoRefresh} onChange={e=>updateSettings({autoRefresh:e.target.checked})}/>{t.auto}</label><button onClick={()=>refresh(true)}>{loading?t.running:t.refresh}</button><button>{t.core}</button></div>
      {warningText(state.warning, t) && <div className="alert">{warningText(state.warning, t)}</div>}
      {wizard && <SetupWizard t={t} inputs={inputs} outputs={outputs} onDone={(inputId: string, outputId: string, profile: string)=>{ if(inputId){preferredInputRef.current=inputId; localStorage.setItem('miller_input',inputId)} if(outputId){preferredOutputRef.current=outputId; localStorage.setItem('miller_output',outputId)} const idx=profiles.findIndex(p=>p.name.toLowerCase().includes(profile.toLowerCase().split(' ')[0])); if(idx>=0) setSelectedProfile(idx); localStorage.setItem('miller_wizard_done_v44','true'); setWizard(false); refresh(true); }} onSkip={()=>{localStorage.setItem('miller_wizard_done_v44','true'); setWizard(false);}} />}
      <MicMonitor enabled={!!settings.monitorMicrophone} />
      {tab==='dashboard' && <Dashboard t={t} inputs={inputs} outputs={outputs} apps={groupedApps} prefIn={prefIn} prefOut={prefOut} perf={perf} profile={currentProfile} routes={routes} timestamp={state.timestamp || 'N/A'} licenseState={licenseState} />}
      {tab==='devices' && <Devices t={t} inputs={inputs} outputs={outputs} prefIn={prefIn} prefOut={prefOut} onInput={(id: string)=>{preferredInputRef.current=id; localStorage.setItem('miller_input', id); refresh(true)}} onOutput={(id: string)=>{preferredOutputRef.current=id; localStorage.setItem('miller_output', id); refresh(true)}} timestamp={state.timestamp || 'N/A'} />}
      {tab==='apps' && <Applications t={t} sessions={visibleSessions} updateMixerRow={updateMixerRow}/>} 
      {tab==='smartMic' && <SmartMicPanel licenseState={licenseState} t={t} profiles={profiles} setProfiles={setProfiles} selected={selectedProfile} setSelected={setSelectedProfile} profile={currentProfile} patchProfile={patchProfile} patchSmartMic={patchSmartMic} settings={settings} updateSettings={updateSettings}/>} 
      {tab==='routes' && <Routes licenseState={licenseState} t={t} apps={routeSessions} outputs={outputs} routes={routes} setRoutes={setRoutes} selected={selectedRoute} setSelected={setSelectedRoute}/>} 
      {tab==='settings' && <SettingsPanel licenseState={licenseState} t={t} settings={settings} updateSettings={updateSettings} perf={perf} logsPath={logsPath} runAudit={runAudit} openLogs={openLogs} debugLoading={debugLoading} applyQuality={applyQuality} updateInfo={updateInfo} updateLoading={updateLoading} checkUpdatesNow={checkUpdatesNow}/>} 
      {tab==='support' && <Support licenseState={licenseState} t={t} state={state} debug={debug} logsPath={logsPath} inputs={inputs} outputs={outputs} profiles={profiles} routes={routes} runAudit={runAudit} openLogs={openLogs} debugLoading={debugLoading}/>} 
      {tab==='license' && <LicensePanel t={t} licenseKey={licenseKey} setLicenseKey={setLicenseKey} owner={licenseOwner} setOwner={setLicenseOwner} licenseState={licenseState} licenseMsg={licenseMsg} activateLicense={activateCurrentLicense} continueFree={continueFree}/>}
      {freeLocked && <FreeLockModal t={t} licenseState={licenseState} continueFree={continueFree}/>}
      {tab==='studio' && <StudioPanel t={t} apps={groupedApps} sessions={routeSessions} profiles={profiles} routes={routes} state={state} perf={perf} licenseState={licenseState} updateMixerRow={updateMixerRow}/>} 
    </main>
  </div>;
}

function Dashboard({t, inputs, outputs, apps, prefIn, prefOut, perf, profile, routes, timestamp, licenseState}: any) { return <section><h2>{t.dashboardTitle}</h2><p className="sub">{t.dashboardSub}</p><div className="stats">{card(t.microphone, prefIn?t.ok:t.off, prefIn?.name || t.notFound, prefIn?'ok':'warn')}{card(t.output, prefOut?t.ok:t.off, prefOut?.name || t.notFound, prefOut?'ok':'warn')}{card(t.smartMicStatus, profile ? profileName(profile,t) : '—', t.profileCurrent)}{card(t.latency, latencyText(perf,t), '', 'warn')}</div><div className="grid3"><div className="panel"><h3>{t.systemStatus}</h3>{row(t.inputs, inputs.length, inputs.length?'ok':'warn')}{row(t.outputs, outputs.length, outputs.length?'ok':'warn')}{row(t.apps, apps.length)}{row(t.routesStatus, routes.length)}{row(t.lastRead, timestamp)}</div><div className="panel"><h3>{t.smartTitle}</h3>{row(t.profileCurrent, profile ? profileName(profile,t) : '—','ok')}{row(t.noise, `${profile?.smartMic?.noise || 0}%`)}{row(t.keyboard, `${profile?.smartMic?.keyboard || 0}%`)}{row(t.natural, `${profile?.smartMic?.natural || 0}%`)}</div><div className="panel"><h3>{t.license}</h3>{row(t.status, licenseState?.licenseType || t.freeStatus, licenseState?.activated?'ok':'warn')}{row(t.remaining, licenseState?.activated ? '∞' : formatTimeMMSS(licenseState?.freeSecondsLeft || 3600))}<p className="hint">{translateMessage(licenseState?.message, t) || t.freeNote}</p></div></div></section>; }
function Devices({t, inputs, outputs, prefIn, prefOut, onInput, onOutput, timestamp}: any) { return <section><h2>{t.devicesTitle}</h2><p className="sub">{t.devicesSub}</p><div className="grid2"><div className="panel"><h3>{t.current}</h3><label>{t.microphone}<select value={prefIn?.id || ''} onChange={e=>onInput(e.target.value)}><option value="">{t.notFound}</option>{inputs.map((d:AudioDevice)=><option key={d.id} value={d.id}>{d.name}</option>)}</select></label><label>{t.output}<select value={prefOut?.id || ''} onChange={e=>onOutput(e.target.value)}><option value="">{t.notFound}</option>{outputs.map((d:AudioDevice)=><option key={d.id} value={d.id}>{d.name}</option>)}</select></label>{row(t.lastRead, timestamp)}</div><DeviceList title={t.inputs} devices={inputs} empty={t.notFound} t={t}/></div><div className="grid2"><DeviceList title={t.outputs} devices={outputs} empty={t.notFound} t={t}/><div className="panel"><h3>{t.future}</h3><p className="hint">{t.coreAudioNext}</p></div></div></section>; }
function DeviceList({title, devices, empty, t}: {title:string; devices:AudioDevice[]; empty:string; t:any}) { const dirLabel=(d?:string)=>d==='input'?t.input:d==='output'?t.output:d; return <div className="panel"><h3>{title}</h3>{devices.length ? devices.map((d,i)=><div className="device" key={`${d.id}-${i}`}><b>{d.name}</b><span className="ok">{d.status || t.ok}</span><small>{dirLabel(d.direction)} · {shortId(d.id)}</small></div>) : <p className="empty">{empty}</p>}</div>; }
function Applications({t, sessions, updateMixerRow}: any) {
  const rows = Array.isArray(sessions) ? sessions.slice(0, 24) : [];
  const updateRow = async (row:any, patch:any) => updateMixerRow(row, patch);
  return <section>
    <h2>{t.appsTitle}</h2>
    <p className="sub">{t.audioAppsSub || 'Sessões reais de áudio do Windows. Aqui só entra o que o Core WASAPI encontrou de verdade.'}</p>
    <div className="panel">
      <h3>{t.audioSessions || 'Audio Sessions'}</h3>
      <p className="hint">{t.realAudioOnly || 'Dados reais: sem estimativa por RAM/CPU. Se um app não aparecer, ele não está emitindo áudio detectável no momento ou o Windows ainda não criou uma sessão para ele.'}</p>
      {rows.length ? <table><thead><tr><th>{t.apps}</th><th>{t.process}</th><th>{t.pid || 'PID'}</th><th>{t.volume}</th><th>{t.vuMeter}</th><th>{t.status}</th><th>{t.source || 'Fonte'}</th></tr></thead><tbody>{rows.map((a:any,i:number)=><tr key={`${a.key || a.process}-${a.pid}-${i}`}><td><b>{a.app || '—'}</b></td><td>{a.process}</td><td>{a.pid || '—'}</td><td><input className="volume-slider" type="range" min="0" max="100" value={n(a.muted ? 0 : a.volume)} onChange={e=>updateRow(a,{volume:Number(e.target.value), muted:false})}/><small>{n(a.muted ? 0 : a.volume)}%</small></td><td><span className="mini-bar"><i style={{width:`${n(a.peak)}%`}}/></span><small>{n(a.peak)}%</small></td><td className={a.active?'ok':'warn'}>{a.active?t.active:t.silent}</td><td><small>{a.source || 'WASAPI_SESSION_REAL'}</small></td></tr>)}</tbody></table> : <div className="empty-state"><b>{t.noRealAudioSessions || 'Nenhuma sessão de áudio real detectada.'}</b><p>{t.noRealAudioSessionsHelp || 'Abra um vídeo, música, Discord, OBS ou jogo emitindo som. O Miller atualiza as sessões automaticamente a cada segundo.'}</p></div>}
    </div>
  </section>;
}
function SmartMicPanel({t, profiles, setProfiles, selected, setSelected, patchProfile, patchSmartMic, settings, updateSettings, licenseState}: any) {
  const safeSelected = Math.min(selected, Math.max(0, profiles.length - 1));
  const activeProfile = profiles[safeSelected] || DEFAULT_PROFILES[0];
  const sm = activeProfile?.smartMic || DEFAULT_SMART;
  const limits = planLimits(licenseState);
  const canAddProfile = profiles.length < limits.maxProfiles;
  const add = () => {
    if(!canAddProfile){ alert(t.freeProfileLimit); return; }
    const p: Profile = { id: makeId(), name: `${t.new} Smart Mic`, desc: t.customProfile || '', smartMic: { ...sm }, mode: 'Custom' };
    setProfiles([...profiles, p]); setSelected(profiles.length);
  };
  const duplicateOfficial = (official: Profile) => {
    if(!canAddProfile){ alert(t.freeProfileLimit); return; }
    const ot = officialProfileText(official, t); const p: Profile = { ...official, id: makeId(), name: `${ot.name} - ${t.customProfile || 'Custom'}`, desc: ot.desc, smartMic: { ...official.smartMic } };
    setProfiles([...profiles, p]); setSelected(profiles.length);
  };
  const previewOfficial = (official: Profile) => {
    const ot = officialProfileText(official, t); patchProfile({ smartMic: { ...official.smartMic }, mode: official.mode, desc: ot.desc });
  };
  return <section><h2>{t.smartTitle}</h2><p className="sub">{t.smartSub}</p><div className="grid2 wide-left"><div className="panel"><h3>{t.myProfiles}</h3><label>{t.profileCurrent}<select value={safeSelected} onChange={e=>setSelected(Number(e.target.value))}>{profiles.map((p:Profile,i:number)=><option value={i} key={p.id}>{i===safeSelected?'✓ ':''}{profileName(p,t)}</option>)}</select></label>{profiles.length===0&&<p className="hint">{t.noUserProfiles}</p>}<label>{t.name}<input value={activeProfile ? profileName(activeProfile,t) : ''} onChange={e=>patchProfile({name:e.target.value})}/></label><label>{t.description}<textarea value={activeProfile ? profileDesc(activeProfile,t) : ''} onChange={e=>patchProfile({desc:e.target.value})}/></label><div className="btn-row"><button onClick={()=>patchProfile({smartMic:{...sm}})}>{t.save}</button><button disabled={!canAddProfile} onClick={add}>{t.new}</button><button disabled={!canAddProfile} onClick={()=>{ if(!canAddProfile){ alert(t.freeProfileLimit); return; } setProfiles([...profiles,{...activeProfile,id:makeId(),name:`${profileName(activeProfile,t)} ${t.cloneSuffix}`}]);}}>{t.clone}</button><button disabled={profiles.length<=1} onClick={()=>{setProfiles(profiles.filter((_:Profile,i:number)=>i!==safeSelected)); setSelected(0);}}>{t.delete}</button></div><h3>{t.quickProfiles}</h3><p className="hint">{t.myProfiles} · {t.customProfile}</p><div className="profile-chips">{profiles.map((p:Profile,i:number)=><button className={i===safeSelected?'chip active':'chip'} onClick={()=>setSelected(i)} key={p.id}>{i===safeSelected?'✓ ':''}{profileName(p,t)}</button>)}</div><h3>{t.officialLibrary}</h3><p className="hint">{t.officialLibraryHelp}</p><div className="library-grid">{OFFICIAL_PROFILES.map((p:Profile)=><div className="library-card" key={p.id}><b>{profileName(p,t)}</b><small>{t.readOnlyProfile}</small><p>{profileDesc(p,t)}</p><div className="btn-row"><button onClick={()=>previewOfficial(p)}>{t.previewApply}</button><button disabled={!canAddProfile} onClick={()=>duplicateOfficial(p)}>{t.duplicateToMyProfiles}</button></div></div>)}</div></div><div className="panel"><h3>{t.micSettings}</h3><Slider label={t.noise} help={t.noiseHelp} value={sm.noise} onChange={v=>patchSmartMic({noise:v})}/><Slider label={t.keyboard} help={t.keyboardHelp} value={sm.keyboard} onChange={v=>patchSmartMic({keyboard:v})}/><Slider label={t.gate} help={t.gateHelp} value={sm.gate} onChange={v=>patchSmartMic({gate:v})}/><Slider label={t.compressor} help={t.compressorHelp} value={sm.compressor} onChange={v=>patchSmartMic({compressor:v})}/><Slider label={t.limiter} help={t.limiterHelp} value={sm.limiter} onChange={v=>patchSmartMic({limiter:v})}/><Slider label={t.natural} help={t.naturalHelp} value={sm.natural} onChange={v=>patchSmartMic({natural:v})}/><Check label={t.monitorMic} checked={!!settings.monitorMicrophone} onChange={v=>updateSettings({monitorMicrophone:v})}/><p className="hint">{t.monitorMicHelp}</p><Check label={t.autoGain} checked={!!sm.autoGain} onChange={v=>patchSmartMic({autoGain:v})}/><Check label={t.laugh} checked={!!sm.protectLaugh} onChange={v=>patchSmartMic({protectLaugh:v})}/><Check label={t.scream} checked={!!sm.protectScream} onChange={v=>patchSmartMic({protectScream:v})}/></div></div></section>;
}

function Routes({t, apps, outputs, routes, setRoutes, selected, setSelected, licenseState}: any) {
  const route = routes[selected] || routes[0] || DEFAULT_ROUTES[0];
  const limits = planLimits(licenseState);
  const canAddRoute = routes.length < limits.maxRoutes;
  const routeOutputs = route.outputs && route.outputs.length === 5 ? route.outputs : defaultRouteOutputs(outputs);
  const updateRoute = (patch: Partial<RoutePreset>) => {
    const next = [...routes];
    next[selected] = { ...route, ...patch };
    setRoutes(next);
  };
  const toggle = (proc: string, idx: number) => {
    const matrix = { ...(route.matrix || {}) };
    const arr = [...(matrix[proc] || [true, false, false, false, false])];
    arr[idx] = !arr[idx];
    matrix[proc] = arr;
    updateRoute({ matrix });
  };
  const rename = (name: string) => updateRoute({ name });
  const setBus = (idx: number, value: string) => {
    const nextOutputs = [...routeOutputs];
    nextOutputs[idx] = value;
    updateRoute({ outputs: nextOutputs });
  };
  const addRoute = () => {
    setRoutes([...routes, { id: makeId(), name: `${t.new} ${t.route}`, matrix: {}, outputs: defaultRouteOutputs(outputs) }]);
    setSelected(routes.length);
  };
  const cloneRoute = () => setRoutes([...routes, { ...route, id: makeId(), name: `${routeDisplayName(route.name, t)} ${t.cloneSuffix}`, outputs: [...routeOutputs] }]);
  const deleteRoute = () => { setRoutes(routes.filter((_: RoutePreset, i: number) => i !== selected)); setSelected(0); };
  const outputOptions = [
    ...outputs.map((d: AudioDevice) => [d.id || '', d.name || t.noAudioDevice]),
    ['', t.noAudioDevice]
  ];
  return <section><h2>{t.routesTitle}</h2><p className="sub">{t.routesSub}</p><div className="grid2 wide-left"><div className="panel"><h3>{t.routesTitle}</h3><label>{t.route}<select value={selected} onChange={e=>setSelected(Number(e.target.value))}>{routes.map((r:RoutePreset,i:number)=><option value={i} key={r.id}>{routeDisplayName(r.name, t)}</option>)}</select></label><label>{t.name}<input value={routeDisplayName(route?.name, t)} onChange={e=>rename(e.target.value)}/></label><p className="hint">{t.realRoutesOnly}</p><div className="btn-row"><button disabled={!canAddRoute} onClick={()=>{ if(!canAddRoute){ alert(t.freeRouteLimit); return; } addRoute(); }}>{t.new}</button><button disabled={!canAddRoute} onClick={()=>{ if(!canAddRoute){ alert(t.freeRouteLimit); return; } cloneRoute(); }}>{t.clone}</button><button disabled={routes.length<=1} title={t.routeDeleteHelp} onClick={deleteRoute}>{t.delete}</button></div><table><thead><tr><th>{t.apps}</th><th>{t.process}</th><th>A1</th><th>A2</th><th>A3</th><th>A4</th><th>A5</th></tr></thead><tbody>{(apps.length?apps:[{app:'—',process:'—'}]).slice(0,18).map((a:any,i:number)=>{ const proc=String(a.process||`app-${i}`); const arr=route?.matrix?.[proc]||[true,false,false,false,false]; return <tr key={i}><td><b>{a.app}</b></td><td>{proc}{a.recent && <small> · {t.recentApp || 'Recente'}</small>}</td>{[0,1,2,3,4].map(x=><td key={x}><button className={arr[x]?'circle on':'circle'} onClick={()=>toggle(proc,x)}>A{x+1}</button></td>)}</tr>;})}</tbody></table></div><div className="panel"><h3>{t.routeOutputs}</h3><p className="hint">{t.outputBusHelp}</p><div className="bus-list">{[0,1,2,3,4].map(i=><label className="bus-select" key={i}>A{i+1}<select value={routeOutputs[i] || ''} onChange={e=>setBus(i,e.target.value)}>{outputOptions.map(([id, label]: any, n: number)=><option key={`${id}-${n}`} value={id}>{label}</option>)}</select><small>{routeOutputLabel(routeOutputs[i], i, outputs, t)}</small></label>)}</div><h3>{t.outputMatrix}</h3>{[0,1,2,3,4].map(i=>row(`A${i+1}`, routeOutputLabel(routeOutputs[i], i, outputs, t), routeOutputs[i]?'ok':'warn'))}</div></div></section>;
}

function SettingsPanel({licenseState, t, settings, updateSettings, perf, logsPath, runAudit, openLogs, debugLoading, applyQuality, updateInfo, updateLoading, checkUpdatesNow}: any) { const limits = planLimits(licenseState); const allThemeOptions = [['miller-blue','Miller Blue'],['miller-red','Miller Red'],['miller-purple','Miller Purple'],['miller-green','Miller Green'],['miller-gold','Miller Gold'],['miller-orange','Miller Orange'],['miller-ice','Miller Ice'],['miller-carbon','Miller Carbon'],['miller-cyberpunk','Miller Cyberpunk'],['miller-midnight','Miller Midnight'],['miller-matrix','Miller Matrix'],['carbon-black','Carbon Black'],['cyber-neon','Cyber Neon'],['studio-pro','Studio Pro']]; const themeOptions = limits.themes ? allThemeOptions.filter((x:any)=>(limits.themes as string[]).includes(x[0])) : allThemeOptions; return <section><h2>{t.settingsTitle}</h2><p className="sub">{t.settingsSub}</p><div className="settings-grid"><div className="panel"><h3>{t.general}</h3><Select label={t.language} value={settings.language} options={[['pt-BR','🇧🇷 Português (Brasil)'],['en-US','🇺🇸 English'],['es-ES','🇪🇸 Español']]} onChange={(v)=>updateSettings({language:v})}/><h3>{t.startup}</h3><Check label={t.startWithWindows} checked={settings.startWithWindows} onChange={(v)=>updateSettings({startWithWindows:v})}/><Check label={t.startMinimized} checked={settings.startMinimized} onChange={(v)=>updateSettings({startMinimized:v})}/><Check label={t.closeToTray} checked={settings.closeToTray} onChange={(v)=>updateSettings({closeToTray:v})}/><h3>{t.updates}</h3><Check label={t.checkUpdates} checked={settings.checkUpdates} onChange={(v)=>updateSettings({checkUpdates:v})}/><Select label={t.channel} value={settings.updateChannel} options={['stable','beta','dev']} onChange={(v)=>updateSettings({updateChannel:v})}/><button onClick={checkUpdatesNow} disabled={updateLoading}>{updateLoading?t.running:(t.checkNow || 'Verificar agora')}</button>{updateInfo && <div className="update-box">{row(t.currentVersion, updateInfo.currentVersion)}{row(t.latestVersion, updateInfo.latestVersion, updateInfo.updateAvailable?'warn':'ok')}<p className="hint">{translateMessage(updateInfo.message, t)}</p>{(updateInfo.notes||[]).map((note:string,i:number)=><small className="field-help" key={i}>{translateMessage(note, t)}</small>)}</div>}</div><div className="panel"><h3>{t.appearance}</h3><Select label={t.theme} value={settings.theme} options={themeOptions} onChange={(v)=>updateSettings({theme:v})}/><Select label={t.scale} value={settings.scale} options={[90,100,110,125]} onChange={(v)=>updateSettings({scale:Number(v)})}/><Check label={t.animations} checked={settings.animations} onChange={(v)=>updateSettings({animations:v})}/><Check label={t.transparency} checked={settings.transparency} onChange={(v)=>updateSettings({transparency:v})}/></div><div className="panel"><h3>{t.audio}</h3><div className="quality-grid"><QualityCard active={settings.qualityMode==='lowLatency'} title={t.lowLatency} help={t.lowLatencyHelp} onClick={()=>applyQuality('lowLatency')}/><QualityCard active={settings.qualityMode==='balanced'} title={t.balanced} help={t.balancedHelp} onClick={()=>applyQuality('balanced')}/><QualityCard active={settings.qualityMode==='quality'} title={t.maxQuality} help={t.maxQualityHelp} onClick={()=>applyQuality('quality')}/></div><button onClick={()=>updateSettings({showAdvancedAudio:!settings.showAdvancedAudio})}>{settings.showAdvancedAudio?t.hideAdvanced:t.showAdvanced}</button>{settings.showAdvancedAudio && <div><Select label={t.engine} value={settings.engine} options={[['auto',t.automatic],['wasapi_shared','WASAPI Shared'],['wasapi_exclusive','WASAPI Exclusive'],['asio',t.futureAsio]]} onChange={(v)=>updateSettings({engine:v})}/><SmallHelp text={t.bufferHelp}/><Select label={t.buffer} value={settings.buffer} options={[64,128,256,512]} onChange={(v)=>updateSettings({buffer:Number(v)})}/><SmallHelp text={t.sampleRateHelp}/><Select label={t.sampleRate} value={settings.sampleRate} options={[44100,48000,96000]} onChange={(v)=>updateSettings({sampleRate:Number(v)})}/><SmallHelp text={t.aiHelp}/><Select label={t.aiEngine} value={settings.micEngine} options={[['off',t.disabled],['rnnoise','RNNoise'],['webrtc','WebRTC'],['deepfilternet','DeepFilterNet']]} onChange={(v)=>updateSettings({micEngine:v})}/></div>}</div><div className="panel"><h3>{t.advanced}</h3><p className="hint">{t.performanceHelp}</p>{row(t.latency, latencyText(perf,t), 'warn')}{row(t.buffer, `${settings.buffer} ${t.samples}`)}{row(t.sampleRate, `${settings.sampleRate} Hz`)}{row(t.logsPath, logsPath || '—')}<button onClick={openLogs}>{t.openLogs}</button><button onClick={runAudit} disabled={debugLoading}>{debugLoading?t.running:t.runAudit}</button></div></div></section>; }
function Support({licenseState, t, state, debug, logsPath, inputs, outputs, profiles, routes, runAudit, openLogs, debugLoading}: any) {
  const [ticketContact, setTicketContact] = useState('');
  const [ticketCategory, setTicketCategory] = useState('bug');
  const [ticketMessage, setTicketMessage] = useState('');
  const [ticketResult, setTicketResult] = useState('');
  const data = debug || { timestamp: state.timestamp, ok: state.ok, logsPath, hardware: state.hardware, appsCount: state.apps?.length || 0, rawDeviceLines: state.rawDeviceLines || [], warnings: state.warning ? [state.warning] : [] }; const paid = isPaidPlan(licenseState);
  async function createTicket() {
    const reportJson = JSON.stringify(data, null, 2);
    try {
      const path = await invoke<string>('create_support_ticket', { contact: ticketContact, category: ticketCategory, message: ticketMessage, reportJson });
      setTicketResult(`${t.ticketCreated}: ${path}`);
    } catch (e) {
      setTicketResult(String(e));
    }
  }
  return <section><h2>{t.supportTitle}</h2><p className="sub">{t.supportSub}</p>
    <div className="grid2">
      <div className="panel"><h3>{t.systemStatus}</h3>{row(t.microphone, inputs.length ? t.ok : t.notFound, inputs.length?'ok':'warn')}{row(t.output, outputs.length ? t.ok : t.notFound, outputs.length?'ok':'warn')}{row(t.smartMicStatus, profiles.length ? t.ok : t.warn, profiles.length?'ok':'warn')}{row(t.routesStatus, routes.length ? t.ok : t.warn, routes.length?'ok':'warn')}{row(t.lastRead, state.timestamp || 'N/A')}</div>
      <div className="panel"><h3>{t.actions}</h3><button onClick={runAudit} disabled={debugLoading}>{debugLoading?t.running:t.runAudit}</button><button onClick={openLogs}>{t.openLogs}</button><button onClick={()=>navigator.clipboard?.writeText(JSON.stringify(data,null,2))}>{t.exportReport}</button><p className="hint">{paid ? t.ticketHelp : t.proOnlySupportHelp}</p></div>
    </div>
    <div className="grid2">
      <div className="panel"><h3>{t.ticketTitle}</h3>
        <label>{t.ticketContact}<input value={ticketContact} onChange={e=>setTicketContact(e.target.value)} placeholder="email@exemplo.com / Discord#0000" /></label>
        <label>{t.ticketCategory}<select value={ticketCategory} onChange={e=>setTicketCategory(e.target.value)}><option value="bug">{t.ticketCategoryBug}</option><option value="audio">{t.ticketCategoryAudio}</option><option value="license">{t.ticketCategoryLicense}</option><option value="idea">{t.ticketCategoryIdea}</option></select></label>
        <label>{t.ticketMessage}<textarea value={ticketMessage} onChange={e=>setTicketMessage(e.target.value)} /></label>
        <button disabled={!paid} onClick={createTicket}>{paid ? t.ticketCreate : t.proOnlySupport}</button>
        {ticketResult && <p className="hint">{ticketResult}</p>}
      </div>
      <div className="panel"><h3>{t.audit}</h3><pre>{JSON.stringify(data, null, 2)}</pre></div>
    </div>
  </section>;
}

function LicensePanel({t, licenseKey, setLicenseKey, owner, setOwner, licenseState, licenseMsg, activateLicense, continueFree}: any) {
  const pc = licenseState?.machineId || machineId();
  const plan = licenseState?.licenseType || 'FREE';
  const activated = !!licenseState?.activated;
  const timeLeft = formatTimeMMSS(licenseState?.freeSecondsLeft || 3600);
  return <section><h2>{t.licenseTitle}</h2><p className="sub">{t.licenseSub}</p>
    <div className="grid3">
      <div className="panel"><h3>{t.freePlan}</h3>{row(t.status, activated ? plan : t.freeStatus, activated?'ok':'warn')}{row(t.pcId, pc)}{row(t.remaining, activated ? '∞' : timeLeft)}<p className="hint">{translateMessage(licenseState?.message, t) || t.freeNote}</p><button onClick={continueFree} disabled={activated || n(licenseState?.freeSecondsLeft, 3600) > 0}>{t.continueFree}</button></div>
      <div className="panel"><h3>{t.activate}</h3><label>{t.name || 'Nome'}<input value={owner} onChange={(e:any)=>setOwner(e.target.value)} placeholder="Cliente"/></label><label>{t.licenseKey}<input value={licenseKey} onChange={(e:any)=>setLicenseKey(e.target.value)} placeholder="MASX-PRO-XXXX-XXXX-XXXX"/></label><button onClick={activateLicense}>{t.activate}</button><button onClick={()=>alert(t.buyNote)}>{t.buyPro}</button>{licenseMsg && <p className="hint">{translateMessage(licenseMsg, t)}</p>}<p className="hint">{t.buyNote}</p></div>
      <div className="panel"><h3>{t.proBenefits}</h3>{row(t.realAudio,t.future,'warn')}{row(t.vuMeter,t.future,'warn')}{row(t.unlimited, activated ? t.ok : t.proPlan, activated?'ok':'warn')}{row(t.premiumThemes,t.ok,'ok')}{row(t.pcId, pc)}</div>
    </div>
  </section>;
}
function FreeLockModal({t, licenseState, continueFree}: any) {
  return <div className="free-lock-backdrop">
    <div className="free-lock-modal">
      <h2>{t.freeLockedTitle || 'Sessão Free pausada'}</h2>
      <p>{t.freeLockedText || 'O tempo gratuito desta sessão acabou. As saídas do Miller ficam bloqueadas até continuar uma nova sessão Free ou ativar o Pro.'}</p>
      {row(t.remaining || 'Restante', formatTimeMMSS(licenseState?.freeSecondsLeft || 0), 'warn')}
      <div className="btn-row"><button onClick={continueFree}>{t.continueFree || 'Continuar Free'}</button><button onClick={()=>{ localStorage.setItem('miller_prefer_license_tab','true'); }}>{t.activate || 'Ativar licença'}</button></div>
    </div>
  </div>;
}

function SetupWizard({t, inputs, outputs, onDone, onSkip}: any) { const [input, setInput] = useState(inputs[0]?.id || ''); const [output, setOutput] = useState(outputs[0]?.id || ''); const [use, setUse] = useState(t.wizardUseVoiceGames || t.useGames); return <div className="wizard-backdrop"><div className="wizard"><h2>{t.wizardTitle}</h2><p className="sub">{t.wizardSub}</p><label>{t.stepMic}<select value={input} onChange={e=>setInput(e.target.value)}>{inputs.map((d:AudioDevice)=><option key={d.id} value={d.id}>{d.name}</option>)}</select></label><label>{t.stepOutput}<select value={output} onChange={e=>setOutput(e.target.value)}>{outputs.map((d:AudioDevice)=><option key={d.id} value={d.id}>{d.name}</option>)}</select></label><label>{t.stepUse}<select value={use} onChange={e=>setUse(e.target.value)}><option>{t.wizardUseVoiceGames || t.useGames}</option><option>{t.useDiscord}</option><option>{t.useStreaming}</option><option>{t.usePodcast}</option><option>{t.wizardUseGeneral}</option></select></label><div className="btn-row"><button onClick={()=>onDone(input, output, use)}>{t.finishWizard}</button><button onClick={onSkip}>{t.skipWizard}</button></div></div></div>; }

function StudioPanel({t, apps, sessions, profiles, routes, state, perf, licenseState, updateMixerRow}: any) {
  const liveRows = (sessions && sessions.length ? sessions : groupAudioRows(apps || [])).slice(0, 12);
  const [noiseResult, setNoiseResult] = useState('');
  const exportProfiles = () => {
    const payload = JSON.stringify({ version: 'V6.3', exportedAt: new Date().toISOString(), profiles }, null, 2);
    navigator.clipboard?.writeText(payload);
    alert(t.exportProfiles + ' OK');
  };
  const analyze = () => {
    const avg = Math.round(liveRows.reduce((a:any,b:any)=>a+n(b.peak ?? b.activity),0) / Math.max(1, liveRows.length));
    const suggestion = avg > 55
      ? `${t.noise}: 82% · ${t.gate}: 68% · ${t.compressor}: 62% · ${t.natural}: 65%`
      : `${t.noise}: 58% · ${t.gate}: 42% · ${t.compressor}: 55% · ${t.natural}: 82%`;
    setNoiseResult(suggestion);
  };
  return <section><h2>{t.studioTitle}</h2><p className="sub">{t.studioSub}</p>
    <div className="grid3">
      <div className="panel"><h3>{t.liveDashboard}</h3>{row(t.health, t.excellent, 'ok')}{row(t.cpu, `${n(perf?.cpu)}%`)}{row(t.latency, latencyText(perf,t), 'warn')}{row(t.apps, liveRows.length)}{row(t.remaining, licenseState?.activated ? '∞' : formatTimeMMSS(licenseState?.freeSecondsLeft || 0))}</div>
      <div className="panel"><h3>{t.smartRules}</h3><table><tbody>{[['Discord','Discord'],['OBS','Streaming'],['Jogos com Voz','Jogos com Voz'],['Chrome','Uso Geral'],['Padrão',t.defaultProfile]].map((r:any)=><tr key={r[0]}><td>{r[0]}</td><td><b className="ok">{r[1]}</b></td></tr>)}</tbody></table><Check label={t.applyAutomatically} checked={true} onChange={()=>{}}/><Check label={t.askBeforeSwitch} checked={false} onChange={()=>{}}/></div>
      <div className="panel"><h3>{t.backupProfiles}</h3><button onClick={exportProfiles}>{t.exportProfiles}</button><button onClick={()=>alert(t.importProfiles)}>{t.importProfiles}</button><p className="hint">.msp / JSON local · {t.settingsSaved}</p></div>
    </div>
    <div className="grid2">
      <MicTestPanel t={t}/>
      <div className="panel"><h3>{t.noiseAnalyzer}</h3><p className="hint">{t.analyzeEnvironment}</p><button onClick={analyze}>{t.analyzeEnvironment}</button>{noiseResult && <p className="hint"><b>{t.analyzerResult}:</b><br/>{noiseResult}</p>}</div>
    </div>
    <div className="panel"><h3>{t.mixer}</h3><p className="hint">{t.mixerRealHelp || 'Mixer conectado às sessões WASAPI: volume, mute, solo e rota ficam salvos por aplicativo. A rota ainda prepara o motor A1-A5 da V6.6.'}</p><table><thead><tr><th>{t.apps}</th><th>{t.volume}</th><th>{t.vuMeter}</th><th>{t.route}</th><th>{t.mute}</th><th>{t.solo}</th></tr></thead><tbody>{liveRows.map((a:any,i:number)=><tr key={`${a.key || a.process}-${i}`} className={a.recent?'recent-row':''}><td><b>{a.app}</b><small>{a.process}{a.recent ? ` · ${t.recentApp || 'Recente'}` : ''}</small></td><td><input className="volume-slider" type="range" min="0" max="100" value={n(isEffectivelyMuted(a) ? 0 : a.volume)} onChange={e=>updateMixerRow(a,{volume:Number(e.target.value), muted:false})}/><small>{n(isEffectivelyMuted(a) ? 0 : a.volume)}%</small></td><td><span className="mini-bar"><i style={{width:`${n(a.peak ?? a.activity)}%`}}/></span></td><td><select className="route-select" value={a.route || 'A1'} onChange={e=>updateMixerRow(a,{route:e.target.value})}>{['A1','A2','A3','A4','A5'].map(x=><option key={x}>{x}</option>)}</select></td><td><button className={isEffectivelyMuted(a)?'danger active':''} onClick={()=>updateMixerRow(a,{muted:!a.muted})}>{isEffectivelyMuted(a) ? (t.unmute || 'Unmute') : t.mute}</button></td><td><button className={a.solo?'active':''} onClick={()=>updateMixerRow(a,{solo:!a.solo})}>{t.solo}</button></td></tr>)}</tbody></table></div>
    <div className="panel"><h3>{t.analytics}</h3>{row(t.profileCurrent, profiles?.[0] ? profileName(profiles[0],t) : '—')}{row(t.routesStatus, routes?.length || 0)}{row(t.lastRead, state?.timestamp || 'N/A')}</div>
  </section>;
}


function MicMonitor({ enabled }: { enabled: boolean }) {
  const ctxRef = useRef<AudioContext | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  useEffect(() => {
    let cancelled = false;
    async function start() {
      if (!enabled) return;
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false } });
        if (cancelled) { stream.getTracks().forEach(t => t.stop()); return; }
        const ctx = new AudioContext();
        const source = ctx.createMediaStreamSource(stream);
        const gain = ctx.createGain();
        gain.gain.value = 0.8;
        source.connect(gain).connect(ctx.destination);
        streamRef.current = stream;
        ctxRef.current = ctx;
      } catch (e) {
        console.warn('mic monitor failed', e);
      }
    }
    start();
    return () => {
      cancelled = true;
      streamRef.current?.getTracks().forEach(t => t.stop());
      streamRef.current = null;
      ctxRef.current?.close().catch(()=>{});
      ctxRef.current = null;
    };
  }, [enabled]);
  return null;
}

function MicTestPanel({ t }: { t: any }) {
  const [status, setStatus] = useState('');
  const [audioUrl, setAudioUrl] = useState('');
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  async function record() {
    try {
      setStatus(t.running || 'Gravando...');
      if (audioUrl) URL.revokeObjectURL(audioUrl);
      setAudioUrl('');
      chunksRef.current = [];
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const recorder = new MediaRecorder(stream);
      recorderRef.current = recorder;
      recorder.ondataavailable = e => { if (e.data?.size) chunksRef.current.push(e.data); };
      recorder.onstop = () => {
        stream.getTracks().forEach(track => track.stop());
        const blob = new Blob(chunksRef.current, { type: 'audio/webm' });
        setAudioUrl(URL.createObjectURL(blob));
        setStatus(t.micRecordReady || 'Teste gravado e pronto para reproduzir');
      };
      recorder.start();
      setTimeout(() => { if (recorder.state !== 'inactive') recorder.stop(); }, 5000);
    } catch (e) {
      setStatus(`${t.error || 'Erro'}: ${String(e)}`);
    }
  }
  return <div className="panel"><h3>{t.micTest}</h3><p className="hint">{t.micPermissionHelp || t.recordTest}</p><button onClick={record}>{t.recordTest}</button>{audioUrl && <audio controls src={audioUrl} style={{width:'100%',marginTop:12}}/>}{status && <p className="hint">{status}</p>}</div>;
}

function Slider({label, help, value, onChange}: {label:string; help:string; value:number; onChange:(v:number)=>void}) { return <label>{label} <b>{value}%</b><input type="range" min="0" max="100" value={value} onChange={e=>onChange(Number(e.target.value))}/><small className="field-help">{help}</small></label>; }
function Check({label, checked, onChange}: {label:string; checked:boolean; onChange:(v:boolean)=>void}) { return <label className="check"><input type="checkbox" checked={checked} onChange={e=>onChange(e.target.checked)}/><span>{label}</span></label>; }
function Select({label, value, options, onChange}: {label:string; value:any; options:any[]; onChange:(v:any)=>void}) { return <label>{label}<select value={value} onChange={e=>onChange(e.target.value)}>{options.map((o:any)=>Array.isArray(o)?<option key={o[0]} value={o[0]}>{o[1]}</option>:<option key={o} value={o}>{o}</option>)}</select></label>; }
function QualityCard({active,title,help,onClick}: {active:boolean; title:string; help:string; onClick:()=>void}) { return <button className={active?'quality-card active':'quality-card'} onClick={onClick}><b>{title}</b><small>{help}</small></button>; }
function SmallHelp({text}: {text:string}) { return <small className="field-help">{text}</small>; }
