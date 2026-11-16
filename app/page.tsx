'use client';

import { useChat } from '@ai-sdk/react';
import { DefaultChatTransport } from 'ai';
import ReactMarkdown from 'react-markdown';
import { useState, useRef, useEffect, useCallback } from 'react';

const SESSION_KEY = 'who-we_session';
// 设置在本机也留一份：账号库连不上时，颜色不会每次刷新都回到默认
const SETTINGS_KEY = 'who-we_settings';
const SETTINGS_DIRTY_KEY = 'who-we_settings_unsaved';

// 设置在本机留一份：账号库连不上时，颜色也不会每次刷新都回到默认
function readLocalSettings(): Settings | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.localStorage.getItem(SETTINGS_KEY);
    return raw ? normalizeSettings(JSON.parse(raw)) : null;
  } catch {
    return null;
  }
}

function writeLocalSettings(settings: Settings) {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
  } catch {
    // 隐私模式 / 存储写满：以本机兜底的方案降级，不影响界面
  }
}

// 存账号失败时留个记号：下次打开以本机版本为准，并自动再补存一次
function markSettingsDirty(dirty: boolean) {
  if (typeof window === 'undefined') return;
  try {
    if (dirty) window.localStorage.setItem(SETTINGS_DIRTY_KEY, '1');
    else window.localStorage.removeItem(SETTINGS_DIRTY_KEY);
  } catch {
    // 同上，记不住就只当作这一次没存上
  }
}

function isSettingsDirty(): boolean {
  if (typeof window === 'undefined') return false;
  try {
    return window.localStorage.getItem(SETTINGS_DIRTY_KEY) === '1';
  } catch {
    return false;
  }
}

// ============ 页面入口：认证门控（HttpOnly Cookie 自动认证） ============
export default function Home() {
  const [authed, setAuthed] = useState(false);
  const [phone, setPhone] = useState('');
  const [name, setName] = useState('');
  const [settings, setSettings] = useState<Settings>(DEFAULT_SETTINGS);
  const [settingsUnsaved, setSettingsUnsaved] = useState(false);
  const [dbDown, setDbDown] = useState(false);
  const [authChecked, setAuthChecked] = useState(false);

  // 异步回调里要读最新设置，避免闭包拿到旧值
  const settingsRef = useRef(settings);

  // 先落本机：界面立刻变，账号那边存不上时也不会白改一场
  const applySettings = useCallback((next: Settings) => {
    settingsRef.current = next;
    setSettings(next);
    writeLocalSettings(next);
  }, []);

  const persistSettings = useCallback(async (next: Settings) => {
    try {
      const res = await fetch('/api/auth/settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ settings: next }),
      });
      // 存不上就留个记号：提示用户，并在下次打开时以本机版本为准重试
      markSettingsDirty(!res.ok);
      setSettingsUnsaved(!res.ok);
    } catch {
      markSettingsDirty(true);
      setSettingsUnsaved(true);
    }
  }, []);

  useEffect(() => {
    const local = readLocalSettings();

    // 登录态由 HttpOnly Cookie 维护，直接询问后端
    fetch('/api/auth/me')
      .then((res) => {
        // 503 = 后端连不上数据库（不是没登录），得单独提示，不能装作要重新登录
        if (res.status === 503) {
          setDbDown(true);
          return Promise.reject(new Error('db-down'));
        }
        return res.ok ? res.json() : Promise.reject(new Error('unauthorized'));
      })
      .then((data) => {
        setPhone(data.phone);
        setName(data.name || '');
        // 上次没同步上去的设置，以本机版本为准，并顺手补存一次
        const pendingLocal = isSettingsDirty() ? local : null;
        const fromServer = data.settings ? normalizeSettings(data.settings) : null;
        applySettings(pendingLocal || fromServer || local || DEFAULT_SETTINGS);
        setAuthed(true);
        if (pendingLocal) persistSettings(pendingLocal);
      })
      .catch(() => {
        if (local) applySettings(local);
        setAuthed(false);
      })
      .finally(() => setAuthChecked(true));
  }, [applySettings, persistSettings]);

  // 让 html / body 也跟着所选底色走：移动端上下回弹时不会露出另一套颜色
  useEffect(() => {
    const root = document.documentElement;
    root.dataset.theme = themeOf(settings);
    root.style.setProperty('--bg', settings.bgColor);
    root.style.setProperty('--fg', settings.textColor);
    root.style.backgroundColor = settings.bgColor;
  }, [settings]);

  // 修改显示设置 → 界面立刻生效，再异步存到账号
  const updateSettings = useCallback(
    (patch: Partial<Settings>) => {
      const next = { ...settingsRef.current, ...patch };
      applySettings(next);
      persistSettings(next);
    },
    [applySettings, persistSettings],
  );

  if (!authChecked) {
    return (
      <div
        data-theme={themeOf(settings)}
        className="app-shell flex min-h-[100dvh] flex-col items-center justify-center gap-3 px-6"
        style={themeStyle(settings)}
      >
        <p
          className="text-base app-muted"
          style={{ animation: 'soft-pulse 2.8s ease-in-out infinite' }}
        >
          正在为你准备这次对话…
        </p>
        <p className="text-sm app-faint">别着急，慢慢来</p>
      </div>
    );
  }

  if (!authed) {
    return (
      <AuthScreen
        settings={settings}
        dbDown={dbDown}
        onAuthed={(p, n, s) => {
          setPhone(p);
          setName(n || '');
          applySettings(normalizeSettings(s));
          setAuthed(true);
        }}
      />
    );
  }

  return (
    <ChatScreen
      phone={phone}
      name={name}
      onNameChange={setName}
      settings={settings}
      settingsUnsaved={settingsUnsaved}
      onSettingsChange={updateSettings}
      onLogout={() => {
        fetch('/api/auth/logout', { method: 'POST' });
        setAuthed(false);
        setPhone('');
        setName('');
      }}
    />
  );
}

// ============ 登录 / 注册界面 ============
function AuthScreen({
  settings,
  dbDown,
  onAuthed,
}: {
  settings: Settings;
  // 后端连不上数据库：登录/注册都存不了，得提前说清楚，别让人一直试密码
  dbDown?: boolean;
  onAuthed: (phone: string, name?: string, settings?: any) => void;
}) {
  const [mode, setMode] = useState<'login' | 'register'>('login');
  const [phoneInput, setPhoneInput] = useState('');
  const [password, setPassword] = useState('');
  const [nameInput, setNameInput] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      const url = mode === 'login' ? '/api/auth/login' : '/api/auth/register';
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          phone: phoneInput,
          password,
          name: mode === 'register' ? nameInput : undefined,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || '操作失败');
      // 登录态由 HttpOnly Cookie 维护，无需前端存储
      onAuthed(data.phone, data.name, data.settings);
    } catch (err: any) {
      setError(err.message || '网络错误，请重试');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div
      data-theme={themeOf(settings)}
      className="app-shell flex min-h-[100dvh] w-full items-center justify-center px-6 py-12"
      style={themeStyle(settings)}
    >
      <div className="w-full max-w-sm">
        <div className="mb-9 text-center">
          <h1 className="text-[1.6rem] font-medium tracking-[0.18em]">who-we</h1>
          <p className="mt-2 text-[0.7rem] tracking-[0.32em] app-faint">个人深度梳理</p>
        </div>

        {dbDown && (
          <p className="mb-6 rounded-xl border app-line app-surface px-4 py-3 text-[0.76rem] leading-relaxed app-muted">
            服务器现在连不上数据库，登录和保存都会失败。先检查网络代理是否开着，通了再刷新这页。
          </p>
        )}

        <form onSubmit={submit} className="space-y-4">
          <div>
            <label className="mb-1.5 block text-[0.8rem] app-muted">手机号</label>
            <input
              type="tel"
              value={phoneInput}
              onChange={(e) => setPhoneInput(e.target.value)}
              placeholder="请输入11位手机号"
              className="app-input w-full rounded-xl px-4 py-3 text-base"
            />
          </div>
          <div>
            <label className="mb-1.5 block text-[0.8rem] app-muted">密码</label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder={mode === 'login' ? '请输入密码' : '设置密码（至少6位）'}
              className="app-input w-full rounded-xl px-4 py-3 text-base"
            />
          </div>

          {mode === 'register' && (
            <div>
              <label className="mb-1.5 block text-[0.8rem] app-muted">怎么称呼你？（选填）</label>
              <input
                type="text"
                value={nameInput}
                onChange={(e) => setNameInput(e.target.value)}
                placeholder="例如：小明"
                maxLength={20}
                className="app-input w-full rounded-xl px-4 py-3 text-base"
              />
            </div>
          )}

          {error && <p className="text-sm app-danger">{error}</p>}

          <button
            type="submit"
            disabled={loading || !phoneInput.trim() || !password}
            className="app-accent mt-2 w-full rounded-full py-3 text-sm font-medium tracking-[0.1em] transition disabled:opacity-40"
          >
            {loading ? '请稍候…' : mode === 'login' ? '登录' : '注册'}
          </button>
        </form>

        <p className="mt-7 text-center text-sm app-faint">
          {mode === 'login' ? '还没有账号？' : '已有账号？'}
          <button
            onClick={() => {
              setMode(mode === 'login' ? 'register' : 'login');
              setError('');
            }}
            className="ml-1 app-hover-fg underline decoration-[var(--line-strong)] underline-offset-4 transition"
          >
            {mode === 'login' ? '注册' : '去登录'}
          </button>
        </p>
      </div>
    </div>
  );
}

// ============ 聊天容器：加载会话 ============
function ChatScreen({
  phone,
  name,
  onNameChange,
  settings,
  settingsUnsaved,
  onSettingsChange,
  onLogout,
}: {
  phone: string;
  name: string;
  onNameChange: (n: string) => void;
  settings: Settings;
  settingsUnsaved?: boolean;
  onSettingsChange: (patch: Partial<Settings>) => void;
  onLogout: () => void;
}) {
  const [sessionId, setSessionId] = useState<string>('');
  const [currentModule, setCurrentModule] = useState('module_1');
  const [historyLoaded, setHistoryLoaded] = useState(false);
  const [initialMessages, setInitialMessages] = useState<any[]>([]);

  useEffect(() => {
    let stored = localStorage.getItem(SESSION_KEY);
    if (!stored) {
      stored = 'session_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
      localStorage.setItem(SESSION_KEY, stored);
    }
    setSessionId(stored);

    fetch(`/api/load?sessionId=${stored}`)
      .then((res) => {
        if (res.status === 401) {
          window.location.reload();
          throw new Error('未登录');
        }
        return res.json();
      })
      .then((data) => {
        if (data.currentModule) setCurrentModule(data.currentModule);
        if (data.messages && data.messages.length > 0) {
          setInitialMessages(normalizeMessages(data.messages));
        }
      })
      .catch(() => {})
      .finally(() => {
        setHistoryLoaded(true);
      });
  }, []);

  if (!historyLoaded) {
    return (
      <div
        data-theme={themeOf(settings)}
        className="app-shell flex min-h-[100dvh] flex-col items-center justify-center gap-3 px-6"
        style={themeStyle(settings)}
      >
        <p
          className="text-base app-muted"
          style={{ animation: 'soft-pulse 2.8s ease-in-out infinite' }}
        >
          正在为你准备这次对话…
        </p>
        <p className="text-sm app-faint">别着急，慢慢来</p>
      </div>
    );
  }

  return (
    <ChatApp
      sessionId={sessionId}
      initialMessages={initialMessages}
      currentModule={currentModule}
      setCurrentModule={setCurrentModule}
      phone={phone}
      name={name}
      onNameChange={onNameChange}
      settings={settings}
      settingsUnsaved={settingsUnsaved}
      onSettingsChange={onSettingsChange}
      onLogout={onLogout}
    />
  );
}

// 将旧的 { role, content } 格式消息转换为新的 { role, parts } UIMessage 格式
function normalizeMessages(raw: any[]): any[] {
  return raw.map((m) => {
    if (m && Array.isArray(m.parts)) return m;
    const id = m?.id || `msg_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
    const text = typeof m?.content === 'string' ? m.content : '';
    return {
      id,
      role: m?.role || 'user',
      parts: text ? [{ type: 'text', text }] : [],
    };
  });
}

// 从消息中提取纯文本（兼容新的 parts 格式和旧的 content 格式）
function getMessageText(m: any): string {
  if (m && Array.isArray(m.parts)) {
    return m.parts
      .filter((p: any) => p && p.type === 'text' && typeof p.text === 'string')
      .map((p: any) => p.text)
      .join('');
  }
  return typeof m?.content === 'string' ? m.content : '';
}

// ============ 个性化显示设置 ============
// 白底、黑底都保留，用户自己挑。这里只负责三件事：
// 1) 按背景明暗自动切「白天 / 夜里」那套辅助色（描边、次要文字、强调色）
// 2) 保证字和底永远看得清（对比度太低时自动纠正）
// 3) 字体、字号、行距都照顾长段落阅读，夜里久看不刺眼

type FontFamily = 'sans' | 'serif';
type ThemeName = 'night' | 'day';

interface Settings {
  fontSize: number;
  textColor: string;
  bgColor: string;
  fontFamily: FontFamily;
}

const DEFAULT_SETTINGS: Settings = {
  // 17px：比原来的 16px 松一点，中文长段落更好读
  fontSize: 17,
  // Warm Intelligence：鼠尾草绿系墨灰字 + 象牙白纸面
  textColor: '#50554c',
  bgColor: '#f7f6f0',
  fontFamily: 'sans',
};

const FONT_SIZES = [15, 17, 19, 21];
// 旧版本存过 14/16/18/20，读档时映射到新档位
const LEGACY_FONT_SIZES: Record<number, number> = { 14: 15, 16: 17, 18: 19, 20: 21 };

const FONT_FAMILIES: { label: string; value: FontFamily; hint: string }[] = [
  { label: '常规', value: 'sans', hint: '屏幕久看更稳' },
  { label: '宋体', value: 'serif', hint: '像信，适合慢读' },
];

// 浅底用深字（Warm Intelligence 色系，拉开明度与色相，避免重复）
const LIGHT_TEXT_COLORS = [
  { label: '鼠尾草', value: '#50554c' },
  { label: '墨黑', value: '#33332e' },
  { label: '大地', value: '#7a6a52' },
  { label: '酒红', value: '#8a3b34' },
];

// 深底用暖白：不用纯白，夜里不炸眼
const NIGHT_TEXT_COLORS = [
  { label: '暖白', value: '#e8e6df' },
  { label: '米黄', value: '#ddd6c6' },
  { label: '浅灰', value: '#cfcdc5' },
  { label: '暖棕', value: '#c9b79d' },
];

const BG_COLORS = [
  { label: '象牙白', value: '#f7f6f0' },
  { label: '米白', value: '#fbf8f2' },
  { label: '雾灰', value: '#ecece6' },
  { label: '夜色', value: '#262822' },
  { label: '暖褐', value: '#3b342b' },
  { label: '墨黑', value: '#141414' },
];

const HEX_COLOR = /^#[0-9a-fA-F]{6}$/;

function isHexColor(v: unknown): v is string {
  return typeof v === 'string' && HEX_COLOR.test(v);
}

// 0 = 纯黑，1 = 纯白
function brightnessOf(hex: string): number {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return (0.299 * r + 0.587 * g + 0.114 * b) / 255;
}

function isDarkBackground(hex: string): boolean {
  return isHexColor(hex) ? brightnessOf(hex) < 0.42 : false;
}

// 深底 → 夜里那套辅助色；浅底 → 白天那套
function themeOf(settings: Settings): ThemeName {
  return isDarkBackground(settings.bgColor) ? 'night' : 'day';
}

function textColorOptions(settings: Settings) {
  return isDarkBackground(settings.bgColor) ? NIGHT_TEXT_COLORS : LIGHT_TEXT_COLORS;
}

// 换底色时：原来的字如果看不清了，自动落到同一侧的稳妥字色
function readableTextColor(bg: string, current: string): string {
  const fallback = isDarkBackground(bg) ? NIGHT_TEXT_COLORS[0].value : '#50554c';
  if (!isHexColor(current)) return fallback;
  const delta = Math.abs(brightnessOf(bg) - brightnessOf(current));
  return delta >= 0.28 ? current : fallback;
}

// 读档：兼容旧数据（旧默认白底墨字 / 旧字号档位 / 没有字体字段），并纠正看不清的组合
function normalizeSettings(raw: unknown): Settings {
  const r: Record<string, unknown> =
    raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
  const legacyDefault =
    r.bgColor === '#ffffff' && r.textColor === '#1f2937' && r.fontFamily === undefined;

  const rawSize = typeof r.fontSize === 'number' ? r.fontSize : DEFAULT_SETTINGS.fontSize;
  const fontSize = FONT_SIZES.includes(rawSize)
    ? rawSize
    : LEGACY_FONT_SIZES[rawSize] ?? DEFAULT_SETTINGS.fontSize;

  // 旧默认「纯白 + 墨黑」换成更柔和的暖白纸面；纯白仍留在选项里，随时可以选回
  const bgColor = legacyDefault
    ? DEFAULT_SETTINGS.bgColor
    : isHexColor(r.bgColor)
      ? r.bgColor
      : DEFAULT_SETTINGS.bgColor;

  const desiredText = legacyDefault
    ? DEFAULT_SETTINGS.textColor
    : isHexColor(r.textColor)
      ? r.textColor
      : DEFAULT_SETTINGS.textColor;

  return {
    bgColor,
    textColor: readableTextColor(bgColor, desiredText),
    fontSize,
    fontFamily: r.fontFamily === 'serif' ? 'serif' : 'sans',
  };
}

// 颜色 → CSS 变量（--bg / --fg 由用户决定，其余辅助色由 data-theme 给）
function themeStyle(settings: Settings): React.CSSProperties {
  return {
    '--bg': settings.bgColor,
    '--fg': settings.textColor,
    // 聊天区背景跟着所选底色派生：比全局略深/略浅一层，
    // 调背景色时整个页面一起变，而不是只有顶部标题栏变
    '--chat-bg': `color-mix(in srgb, ${settings.bgColor} 97%, ${settings.textColor} 3%)`,
    backgroundColor: settings.bgColor,
    color: settings.textColor,
    fontSize: `${settings.fontSize}px`,
  } as unknown as React.CSSProperties;
}

// 长文阅读：行高 1.95；选宋体时再叠一层衬线
function readingClassOf(settings: Settings): string {
  return settings.fontFamily === 'serif' ? 'reading reading-serif' : 'reading';
}

function SettingsPanel({
  settings,
  unsaved,
  onChange,
  onClose,
}: {
  settings: Settings;
  // 只存在本机、账号里还没存上
  unsaved?: boolean;
  onChange: (patch: Partial<Settings>) => void;
  onClose: () => void;
}) {
  const textColors = textColorOptions(settings);
  const isDark = isDarkBackground(settings.bgColor);

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center sm:items-center"
      style={{ backgroundColor: 'rgba(12,10,8,0.55)', backdropFilter: 'blur(6px)' }}
      onClick={onClose}
    >
      <div
        className="app-panel max-h-[88vh] w-full overflow-y-auto rounded-t-2xl border app-line p-6 sm:max-w-md sm:rounded-2xl"
        style={{ boxShadow: 'var(--shadow)' }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-6 flex items-center justify-between">
          <h2 className="text-base font-medium tracking-wide">显示设置</h2>
          <button
            onClick={onClose}
            aria-label="关闭"
            className="app-faint app-hover-fg h-8 w-8 rounded-full text-xl leading-none transition"
          >
            ×
          </button>
        </div>

        <div className="space-y-6">
          <div>
            <p className="mb-2 text-[0.78rem] app-muted">字体大小</p>
            <div className="flex gap-2">
              {FONT_SIZES.map((s) => (
                <button
                  key={s}
                  onClick={() => onChange({ fontSize: s })}
                  className={`flex-1 rounded-lg border py-2 text-sm transition ${
                    settings.fontSize === s
                      ? 'app-selected'
                      : 'app-line app-muted app-hover-surface'
                  }`}
                >
                  {s}
                </button>
              ))}
            </div>
          </div>

          <div>
            <p className="mb-2 text-[0.78rem] app-muted">字体</p>
            <div className="flex gap-2">
              {FONT_FAMILIES.map((f) => (
                <button
                  key={f.value}
                  onClick={() => onChange({ fontFamily: f.value })}
                  className={`flex-1 rounded-lg border px-3 py-2 text-left transition ${
                    settings.fontFamily === f.value
                      ? 'app-selected'
                      : 'app-line app-muted app-hover-surface'
                  }`}
                >
                  <span className={`block text-sm ${f.value === 'serif' ? 'reading-serif' : ''}`}>
                    {f.label}
                  </span>
                  <span className="mt-0.5 block text-[0.68rem] opacity-70">{f.hint}</span>
                </button>
              ))}
            </div>
          </div>

          <div>
            <p className="mb-2 text-[0.78rem] app-muted">字体颜色</p>
            <div className="flex flex-wrap gap-2.5">
              {textColors.map((c) => (
                <ColorSwatch
                  key={c.value}
                  value={c.value}
                  label={c.label}
                  selected={settings.textColor === c.value}
                  onClick={() => onChange({ textColor: c.value })}
                />
              ))}
            </div>
          </div>

          <div>
            <p className="mb-2 text-[0.78rem] app-muted">背景颜色</p>
            <div className="flex flex-wrap gap-2.5">
              {BG_COLORS.map((c) => (
                <ColorSwatch
                  key={c.value}
                  value={c.value}
                  label={c.label}
                  selected={settings.bgColor === c.value}
                  onClick={() =>
                    onChange({
                      bgColor: c.value,
                      // 换深底 / 浅底时，把看不清的字色一起带过去
                      textColor: readableTextColor(c.value, settings.textColor),
                    })
                  }
                />
              ))}
            </div>
            <p className="mt-3 text-[0.7rem] leading-relaxed app-faint">
              {isDark
                ? '深色底会自动配一层低刺激的暖色字与描边，夜里看着不扎眼。'
                : '浅色底已调成暖白纸面，不再是一片刺眼的纯白。'}
            </p>
          </div>

          {unsaved && (
            <p className="rounded-lg border app-line app-surface px-3 py-2 text-[0.72rem] leading-relaxed app-muted">
              这次的设置已经在这台设备上生效，只是还没存进账号（服务器连不上）。下次打开页面会自动补存。
            </p>
          )}
        </div>
      </div>
    </div>
  );
}

function ColorSwatch({
  value,
  label,
  selected,
  onClick,
}: {
  value: string;
  label: string;
  selected: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      onClick={onClick}
      className="h-9 w-9 rounded-full border transition"
      style={{
        backgroundColor: value,
        borderColor: selected ? 'var(--accent)' : 'var(--line-strong)',
        transform: selected ? 'scale(1.1)' : undefined,
        boxShadow: selected ? '0 0 0 3px var(--accent-soft)' : undefined,
      }}
    />
  );
}

// ============ 设置称呼弹窗 ============
function NamePrompt({
  currentName,
  onSave,
  onClose,
}: {
  currentName: string;
  onSave: (name: string) => void;
  onClose: () => void;
}) {
  const [value, setValue] = useState(currentName);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const save = async () => {
    const trimmed = value.trim();
    if (!trimmed) {
      setError('称呼不能为空');
      return;
    }
    setSaving(true);
    setError('');
    try {
      const res = await fetch('/api/auth/name', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: trimmed }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || '保存失败');
      onSave(data.name);
    } catch (err: any) {
      setError(err.message || '保存失败，请重试');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center sm:items-center"
      style={{ backgroundColor: 'rgba(12,10,8,0.55)', backdropFilter: 'blur(6px)' }}
      onClick={onClose}
    >
      <div
        className="app-panel w-full rounded-t-2xl border app-line p-6 sm:max-w-sm sm:rounded-2xl"
        style={{ boxShadow: 'var(--shadow)' }}
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="mb-1 text-base font-medium tracking-wide">怎么称呼你？</h2>
        <p className="mb-4 text-sm app-faint">你希望我怎么称呼你？</p>
        <input
          type="text"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder="输入你的称呼"
          maxLength={20}
          className="app-input mb-3 w-full rounded-xl px-4 py-3 text-base"
        />
        {error && <p className="mb-3 text-sm app-danger">{error}</p>}
        <div className="flex gap-2">
          <button
            onClick={onClose}
            className="flex-1 rounded-full border py-2.5 text-sm app-line app-muted app-hover-surface transition"
          >
            取消
          </button>
          <button
            onClick={save}
            disabled={saving || !value.trim()}
            className="app-accent flex-1 rounded-full py-2.5 text-sm font-medium transition disabled:opacity-40"
          >
            {saving ? '保存中…' : '保存'}
          </button>
        </div>
      </div>
    </div>
  );
}

function ChatApp({
  sessionId,
  initialMessages,
  currentModule,
  setCurrentModule,
  phone,
  name,
  onNameChange,
  settings,
  settingsUnsaved,
  onSettingsChange,
  onLogout,
}: {
  sessionId: string;
  initialMessages: any[];
  currentModule: string;
  setCurrentModule: React.Dispatch<React.SetStateAction<string>>;
  phone: string;
  name: string;
  onNameChange: (n: string) => void;
  settings: Settings;
  settingsUnsaved?: boolean;
  onSettingsChange: (patch: Partial<Settings>) => void;
  onLogout: () => void;
}) {
  const [input, setInput] = useState('');
  const [isListening, setIsListening] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [showNamePrompt, setShowNamePrompt] = useState(false);
  const [openingLoading, setOpeningLoading] = useState(false);
  const recognitionRef = useRef<any>(null);
  const openingStarted = useRef(false);
  // 记录开场白消息 id，撤销时保护它不被删除
  const openingIdRef = useRef<string | null>(null);

  const saveConversation = useCallback(
    async (allMessages: any[]) => {
      if (!sessionId) return;
      const moduleOrder = ['module_1', 'module_2', 'module_3', 'module_4', 'module_5', 'finished'];
      const msgCount = allMessages.length;
      const idx = Math.min(Math.floor(msgCount / 6), 5);
      const mod = moduleOrder[idx];
      setCurrentModule(mod);

      await fetch('/api/save', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionId, messages: allMessages, currentModule: mod }),
      });
    },
    [sessionId, setCurrentModule],
  );

  const { messages, sendMessage, status, setMessages, stop } = useChat({
    transport: new DefaultChatTransport({
      api: '/api/chat',
      body: { sessionId },
    }),
    messages: initialMessages,
    onFinish: ({ messages: allMessages }) => {
      saveConversation(allMessages);
    },
  });

  // 跟踪最新 messages，避免在 effect 里读 stale closure 或造成依赖警告
  const messagesRef = useRef(messages);
  useEffect(() => {
    messagesRef.current = messages;
  }, [messages]);

  // 自动滚动：AI 回复时跟随到最新消息
  const messagesEndRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }, [messages]);

  // 防抖自动保存：messages 变化后 1.5 秒内没有新变化则保存到账号
  // （不依赖 onFinish，用户中途退出/刷新也不会丢消息）
  const saveTimer = useRef<any>(null);
  useEffect(() => {
    if (messages.length === 0) return;
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => {
      saveConversation(messages);
    }, 1500);
    return () => {
      if (saveTimer.current) clearTimeout(saveTimer.current);
    };
  }, [messages, saveConversation]);

  // 新会话自动开场：无历史消息时，让 AI 先铺垫今天会做什么并抛出第一个问题（流式打字效果）
  // 注意：依赖只放 sessionId，避免 setMessages 后 effect 重跑 abort 流；
  // StrictMode 下 effect 会 mount→unmount→mount，cleanup 重置 openingStarted 以便二次触发
  useEffect(() => {
    if (openingStarted.current || messagesRef.current.length > 0) return;
    openingStarted.current = true;
    setOpeningLoading(true);

    const openingId = 'opening_' + Date.now();
    openingIdRef.current = openingId;
    const controller = new AbortController();

    (async () => {
      try {
        const res = await fetch('/api/chat', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ sessionId, messages: [] }),
          signal: controller.signal,
        });
        const reader = res.body?.getReader();
        if (!reader) return;
        const decoder = new TextDecoder();
        let buffer = '';
        let acc = '';

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split('\n');
          buffer = lines.pop() || '';
          for (const line of lines) {
            if (line.startsWith('data: ')) {
              try {
                const obj = JSON.parse(line.slice(6));
                if (obj.type === 'text-delta' && typeof obj.delta === 'string') {
                  acc += obj.delta;
                  setMessages([
                    { id: openingId, role: 'assistant', parts: [{ type: 'text', text: acc }] },
                  ]);
                  setOpeningLoading(false);
                }
              } catch {}
            }
          }
        }
      } catch (e) {
        if ((e as any)?.name === 'AbortError') return;
      } finally {
        setOpeningLoading(false);
      }
    })();

    return () => {
      controller.abort();
      // StrictMode 下允许重新触发；真实卸载时组件销毁也无妨
      openingStarted.current = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionId]);

  useEffect(() => {
    const SpeechRecognition =
      (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SpeechRecognition) return;

    const recognition = new SpeechRecognition();
    recognition.lang = 'zh-CN';
    recognition.interimResults = true;
    recognition.continuous = false;

    recognition.onresult = (event: any) => {
      let finalText = '';
      for (let i = event.resultIndex; i < event.results.length; i++) {
        if (event.results[i].isFinal) finalText += event.results[i][0].transcript;
      }
      if (finalText) setInput(finalText);
    };

    recognition.onerror = (event: any) => {
      console.error('语音识别错误:', event.error);
      setIsListening(false);
    };
    recognition.onend = () => setIsListening(false);
    recognitionRef.current = recognition;
  }, []);

  const toggleListening = () => {
    if (!recognitionRef.current) {
      alert('语音输入需要 Chrome 或 Edge 浏览器');
      return;
    }
    if (isListening) {
      recognitionRef.current.stop();
    } else {
      recognitionRef.current.start();
      setIsListening(true);
    }
  };

  const isBusy = status === 'submitted' || status === 'streaming';

  // 撤销功能：只能撤销"最新一条用户消息"，并连带删除 AI 对应的回复
  // AI 开场白（第一条背景）不会被删除
  const lastUserIndex = messages.reduce(
    (acc, m, i) => (m.role === 'user' ? i : acc),
    -1,
  );

  const undoMessage = () => {
    // 如果 AI 正在回复，先停止流式写入，避免删除后内容"复活"
    if (isBusy) stop();
    setMessages((prev) => {
      if (prev.length === 0) return prev;
      // 找最后一条用户消息（也就是"当前最新一句"）
      let lastUserIdx = -1;
      for (let i = prev.length - 1; i >= 0; i--) {
        if (prev[i].role === 'user') {
          lastUserIdx = i;
          break;
        }
      }
      if (lastUserIdx === -1) return prev;
      // 开场白保护：用户消息不可能在开场白之前，这里兜底
      if (prev[lastUserIdx].id === openingIdRef.current) return prev;
      // 删除"最后一条用户消息 + 它之后的所有内容"（对应的一整轮，AI 回复一起删）
      // 这样对应关系绝对正确，且开场白（在此之前）不受影响
      return prev.slice(0, lastUserIdx);
    });
  };

  const readingCls = readingClassOf(settings);

  return (
    <div
      data-theme={themeOf(settings)}
      className="app-shell flex h-[100dvh] w-full flex-col"
      style={{ ...themeStyle(settings), animation: 'fade-in 0.35s ease' }}
    >
      {/* 顶部标题栏 */}
      <header className="border-b app-line px-5 pb-4 pt-6 sm:px-8">
        <div className="mx-auto flex w-full max-w-3xl items-start justify-between gap-4">
          <div>
            <h1 className="text-[1.3rem] font-medium tracking-[0.14em]">who-we</h1>
            <p className="mt-1 text-[0.68rem] tracking-[0.3em] app-faint">个人深度梳理</p>
          </div>
          <div className="flex flex-wrap items-center justify-end gap-x-4 gap-y-1 text-[0.8rem] app-muted">
            {name ? (
              <span className="app-faint">{name}</span>
            ) : (
              <button
                onClick={() => setShowNamePrompt(true)}
                className="app-hover-fg transition"
              >
                设置称呼
              </button>
            )}
            <span className="hidden app-faint sm:inline">{phone}</span>
            <button
              onClick={() => setShowSettings(true)}
              className="app-hover-fg transition"
            >
              设置
            </button>
            <button onClick={onLogout} className="app-hover-fg transition">
              退出登录
            </button>
          </div>
        </div>
      </header>

      {/* 聊天内容区 */}
      <main className="app-chat flex-1 overflow-y-auto px-5 py-8 sm:px-8 sm:py-10">
        <div className="mx-auto w-full max-w-3xl space-y-7 sm:space-y-8">
          {messages.length === 0 && (
            <div className="flex flex-col items-center justify-center gap-3 py-24 text-center">
              {openingLoading ? (
                <>
                  <p
                    className={`text-lg app-muted ${readingCls}`}
                    style={{ animation: 'soft-pulse 3.2s ease-in-out infinite' }}
                  >
                    坐下来，慢慢聊聊你自己
                  </p>
                  <p className="text-sm app-faint">先从最近的感受开始吧</p>
                </>
              ) : (
                <>
                  <p className="text-lg app-muted">开始一段深度梳理对话</p>
                  <p className="text-sm app-faint">
                    从情绪、思维、价值观、优势、方向五个维度了解自己
                  </p>
                </>
              )}
            </div>
          )}

          {messages.map((m, idx) => {
            const isLatestUser = m.role === 'user' && idx === lastUserIndex;
            const canUndo = isLatestUser && !isBusy;
            return (
              <div
                key={m.id}
                className={`flex items-start gap-2 ${
                  m.role === 'user' ? 'justify-end' : 'justify-start'
                }`}
                style={{ animation: 'fade-up 0.35s ease both' }}
              >
                {m.role === 'user' && (
                  <button
                    type="button"
                    onClick={undoMessage}
                    disabled={!canUndo}
                    title={isBusy ? 'AI 回复中，请稍候' : isLatestUser ? '撤销这句话' : '只能撤销最新一句'}
                    className={`mt-1.5 h-8 w-8 shrink-0 rounded-full border text-base transition ${
                      canUndo
                        ? 'app-line app-faint app-hover-surface'
                        : 'cursor-not-allowed border-transparent app-faint opacity-20'
                    }`}
                  >
                    ↶
                  </button>
                )}
                <div
                  className={`max-w-[86%] ${
                    m.role === 'user'
                      ? 'app-bubble-user rounded-2xl rounded-br-md px-4 py-3 text-right'
                      : 'app-bubble-ai rounded-2xl rounded-bl-md px-4 py-3 text-left'
                  }`}
                >
                  {m.role === 'user' && (
                    <div className="mb-1">
                      <span className="text-[0.65rem] tracking-[0.2em] app-faint">你</span>
                    </div>
                  )}
                  {m.role === 'assistant' ? (
                    <div className={`markdown-body ${readingCls}`}>
                      <ReactMarkdown>{getMessageText(m)}</ReactMarkdown>
                    </div>
                  ) : (
                    <p className={`whitespace-pre-wrap ${readingCls}`}>{getMessageText(m)}</p>
                  )}
                </div>
              </div>
            );
          })}

          {/* AI 回复前的"正在输入…"提示 */}
          {isBusy && messages.length > 0 && (
            <div className="flex justify-start">
              <div className="flex items-center gap-1.5 px-1 py-2 app-faint">
                <span className="typing-dot h-1.5 w-1.5 rounded-full bg-current" />
                <span className="typing-dot h-1.5 w-1.5 rounded-full bg-current" />
                <span className="typing-dot h-1.5 w-1.5 rounded-full bg-current" />
                <span className="ml-1.5 text-xs">正在输入</span>
              </div>
            </div>
          )}

          {/* 自动滚动锚点 */}
          <div ref={messagesEndRef} />
        </div>
      </main>

      {/* 底部输入区 */}
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (input.trim() && !isBusy) {
            sendMessage({ text: input });
            setInput('');
          }
        }}
        className="app-chat border-t app-line px-5 py-4 sm:px-8"
      >
        <div className="mx-auto flex w-full max-w-3xl items-center gap-2.5">
          <button
            type="button"
            onClick={toggleListening}
            className={`h-11 shrink-0 rounded-full border px-4 text-[0.8rem] transition ${
              isListening
                ? 'app-accent border-transparent'
                : 'app-line app-muted app-hover-surface'
            }`}
            title="语音输入（需 Chrome 或 Edge）"
          >
            {isListening ? '停止' : '语音输入'}
          </button>

          <input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="输入你的想法..."
            className="app-input h-11 flex-1 rounded-full px-4 text-base"
            disabled={isBusy}
          />

          <button
            type="submit"
            className="app-accent h-11 shrink-0 rounded-full px-5 text-sm font-medium transition disabled:opacity-40"
            disabled={isBusy || !input.trim()}
          >
            {isBusy ? '思考中…' : '发送'}
          </button>
        </div>
      </form>

      {showSettings && (
        <SettingsPanel
          settings={settings}
          unsaved={settingsUnsaved}
          onChange={onSettingsChange}
          onClose={() => setShowSettings(false)}
        />
      )}

      {showNamePrompt && (
        <NamePrompt
          currentName={name}
          onSave={(n) => {
            onNameChange(n);
            setShowNamePrompt(false);
          }}
          onClose={() => setShowNamePrompt(false)}
        />
      )}
    </div>
  );
}