'use client';

import { useChat } from '@ai-sdk/react';
import { DefaultChatTransport } from 'ai';
import ReactMarkdown from 'react-markdown';
import { useState, useRef, useEffect, useCallback } from 'react';

const SESSION_KEY = 'who-we_session';

// ============ 页面入口：认证门控（HttpOnly Cookie 自动认证） ============
export default function Home() {
  const [authed, setAuthed] = useState(false);
  const [phone, setPhone] = useState('');
  const [name, setName] = useState('');
  const [settings, setSettings] = useState<Settings>(DEFAULT_SETTINGS);
  const [authChecked, setAuthChecked] = useState(false);

  useEffect(() => {
    // 登录态由 HttpOnly Cookie 维护，直接询问后端
    fetch('/api/auth/me')
      .then((res) => (res.ok ? res.json() : Promise.reject()))
      .then((data) => {
        setPhone(data.phone);
        setName(data.name || '');
        setSettings({ ...DEFAULT_SETTINGS, ...(data.settings || {}) });
        setAuthed(true);
      })
      .catch(() => setAuthed(false))
      .finally(() => setAuthChecked(true));
  }, []);

  // 修改显示设置 → 实时保存到账号
  const updateSettings = useCallback((patch: Partial<Settings>) => {
    setSettings((prev) => {
      const next = { ...prev, ...patch };
      fetch('/api/auth/settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ settings: next }),
      });
      return next;
    });
  }, []);

  if (!authChecked) {
    return (
      <div className="flex h-screen flex-col items-center justify-center gap-2 bg-white">
        <p className="text-neutral-400 text-base">正在为你准备这次对话…</p>
        <p className="text-neutral-300 text-sm">别着急，慢慢来</p>
      </div>
    );
  }

  if (!authed) {
    return (
      <AuthScreen
        onAuthed={(p, n, s) => {
          setPhone(p);
          setName(n || '');
          setSettings({ ...DEFAULT_SETTINGS, ...(s || {}) });
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
function AuthScreen({ onAuthed }: { onAuthed: (phone: string, name?: string, settings?: any) => void }) {
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
    <div className="flex h-screen w-full items-center justify-center bg-white text-neutral-900">
      <div className="w-full max-w-sm px-6">
        <h1 className="text-2xl font-semibold tracking-tight text-center mb-1">who-we</h1>
        <p className="text-sm text-neutral-500 text-center mb-8">个人深度梳理</p>

        <form onSubmit={submit} className="space-y-4">
          <div>
            <label className="block text-sm text-neutral-600 mb-1">手机号</label>
            <input
              type="tel"
              value={phoneInput}
              onChange={(e) => setPhoneInput(e.target.value)}
              placeholder="请输入11位手机号"
              className="w-full border border-neutral-300 px-3 py-2.5 text-base focus:outline-none focus:border-neutral-500 bg-white"
            />
          </div>
          <div>
            <label className="block text-sm text-neutral-600 mb-1">密码</label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder={mode === 'login' ? '请输入密码' : '设置密码（至少6位）'}
              className="w-full border border-neutral-300 px-3 py-2.5 text-base focus:outline-none focus:border-neutral-500 bg-white"
            />
          </div>

          {mode === 'register' && (
            <div>
              <label className="block text-sm text-neutral-600 mb-1">怎么称呼你？（选填）</label>
              <input
                type="text"
                value={nameInput}
                onChange={(e) => setNameInput(e.target.value)}
                placeholder="例如：小明"
                maxLength={20}
                className="w-full border border-neutral-300 px-3 py-2.5 text-base focus:outline-none focus:border-neutral-500 bg-white"
              />
            </div>
          )}

          {error && <p className="text-sm text-red-600">{error}</p>}

          <button
            type="submit"
            disabled={loading || !phoneInput.trim() || !password}
            className="w-full bg-neutral-900 text-white py-2.5 text-sm font-medium hover:bg-neutral-700 disabled:opacity-40 transition"
          >
            {loading ? '请稍候...' : mode === 'login' ? '登录' : '注册'}
          </button>
        </form>

        <p className="text-center text-sm text-neutral-500 mt-6">
          {mode === 'login' ? '还没有账号？' : '已有账号？'}
          <button
            onClick={() => {
              setMode(mode === 'login' ? 'register' : 'login');
              setError('');
            }}
            className="text-neutral-900 underline underline-offset-2 ml-1"
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
  onSettingsChange,
  onLogout,
}: {
  phone: string;
  name: string;
  onNameChange: (n: string) => void;
  settings: Settings;
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
      <div className="flex h-screen flex-col items-center justify-center gap-2 bg-white">
        <p className="text-neutral-400 text-base">正在为你准备这次对话…</p>
        <p className="text-neutral-300 text-sm">别着急，慢慢来</p>
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
interface Settings {
  fontSize: number;
  textColor: string;
  bgColor: string;
}

const DEFAULT_SETTINGS: Settings = {
  fontSize: 16,
  textColor: '#1f2937',
  bgColor: '#ffffff',
};

const FONT_SIZES = [14, 16, 18, 20];
const TEXT_COLORS = [
  { label: '墨黑', value: '#1f2937' },
  { label: '深灰', value: '#4b5563' },
  { label: '藏青', value: '#1e3a5f' },
  { label: '森林绿', value: '#14532d' },
  { label: '酒红', value: '#7f1d1d' },
];
const BG_COLORS = [
  { label: '纯白', value: '#ffffff' },
  { label: '米白', value: '#fdf6e3' },
  { label: '浅灰', value: '#f5f5f4' },
  { label: '雾蓝', value: '#eef2f7' },
  { label: '浅绿', value: '#f0fdf4' },
];

function SettingsPanel({
  settings,
  onChange,
  onClose,
}: {
  settings: Settings;
  onChange: (patch: Partial<Settings>) => void;
  onClose: () => void;
}) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center"
      style={{ backgroundColor: 'rgba(0,0,0,0.35)' }}
      onClick={onClose}
    >
      <div
        className="w-full max-w-sm rounded-xl p-6 shadow-xl"
        style={{ backgroundColor: '#ffffff', color: '#1f2937' }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-5">
          <h2 className="text-lg font-semibold">显示设置</h2>
          <button onClick={onClose} className="text-neutral-400 hover:text-neutral-900 text-xl leading-none">
            ×
          </button>
        </div>

        <div className="space-y-5">
          <div>
            <p className="text-sm text-neutral-500 mb-2">字体大小</p>
            <div className="flex gap-2">
              {FONT_SIZES.map((s) => (
                <button
                  key={s}
                  onClick={() => onChange({ fontSize: s })}
                  className={`flex-1 py-2 text-sm border transition rounded ${
                    settings.fontSize === s
                      ? 'bg-neutral-900 text-white border-neutral-900'
                      : 'border-neutral-300 text-neutral-700 hover:bg-neutral-50'
                  }`}
                >
                  {s}
                </button>
              ))}
            </div>
          </div>

          <div>
            <p className="text-sm text-neutral-500 mb-2">字体颜色</p>
            <div className="flex gap-3">
              {TEXT_COLORS.map((c) => (
                <button
                  key={c.value}
                  onClick={() => onChange({ textColor: c.value })}
                  title={c.label}
                  className={`w-9 h-9 rounded-full border-2 transition ${
                    settings.textColor === c.value ? 'border-neutral-900 scale-110' : 'border-transparent'
                  }`}
                  style={{ backgroundColor: c.value }}
                />
              ))}
            </div>
          </div>

          <div>
            <p className="text-sm text-neutral-500 mb-2">背景颜色</p>
            <div className="flex gap-3">
              {BG_COLORS.map((c) => (
                <button
                  key={c.value}
                  onClick={() => onChange({ bgColor: c.value })}
                  title={c.label}
                  className={`w-9 h-9 rounded-full border-2 transition ${
                    settings.bgColor === c.value ? 'border-neutral-900 scale-110' : 'border-neutral-300'
                  }`}
                  style={{ backgroundColor: c.value }}
                />
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
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
      className="fixed inset-0 z-50 flex items-center justify-center"
      style={{ backgroundColor: 'rgba(0,0,0,0.35)' }}
      onClick={onClose}
    >
      <div
        className="w-full max-w-sm rounded-xl p-6 shadow-xl"
        style={{ backgroundColor: '#ffffff', color: '#1f2937' }}
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="text-lg font-semibold mb-1">怎么称呼你？</h2>
        <p className="text-sm text-neutral-500 mb-4">你希望我怎么称呼你？</p>
        <input
          type="text"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder="输入你的称呼"
          maxLength={20}
          className="w-full border border-neutral-300 px-3 py-2.5 text-base focus:outline-none focus:border-neutral-500 mb-3"
        />
        {error && <p className="text-sm text-red-600 mb-3">{error}</p>}
        <div className="flex gap-2">
          <button
            onClick={onClose}
            className="flex-1 py-2.5 text-sm font-medium border border-neutral-300 text-neutral-700 hover:bg-neutral-50 transition"
          >
            取消
          </button>
          <button
            onClick={save}
            disabled={saving || !value.trim()}
            className="flex-1 py-2.5 text-sm font-medium bg-neutral-900 text-white hover:bg-neutral-700 disabled:opacity-40 transition"
          >
            {saving ? '保存中...' : '保存'}
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

  const { messages, sendMessage, status, setMessages } = useChat({
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

  const undoMessage = (idx: number) => {
    setMessages((prev) => {
      if (idx < 0 || idx >= prev.length) return prev;
      const next = [...prev];
      next.splice(idx, 1); // 删除用户消息
      // 如果下一条是 AI 回复（对应这个问题的回答），一并删除
      if (idx < next.length && next[idx].role === 'assistant') {
        next.splice(idx, 1);
      }
      return next;
    });
  };

  return (
    <div
      className="flex flex-col h-screen w-full"
      style={{
        backgroundColor: settings.bgColor,
        color: settings.textColor,
        fontSize: settings.fontSize,
        animation: 'fade-in 0.3s ease',
      }}
    >
      {/* 顶部标题栏 */}
      <header className="border-b border-neutral-200 px-8 py-6">
        <div className="max-w-5xl mx-auto flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">who-we</h1>
            <p className="text-sm text-neutral-500 mt-1">个人深度梳理</p>
          </div>
          <div className="flex items-center gap-4">
            {currentModule !== 'module_1' && (
              <span className="text-sm text-neutral-400">上次进度：{currentModule}</span>
            )}
            {name ? (
              <span className="text-sm text-neutral-500">{name}</span>
            ) : (
              <button
                onClick={() => setShowNamePrompt(true)}
                className="text-sm text-neutral-400 hover:text-neutral-900 transition"
              >
                设置称呼
              </button>
            )}
            <span className="text-sm text-neutral-500">{phone}</span>
            <button
              onClick={() => setShowSettings(true)}
              className="text-sm text-neutral-400 hover:text-neutral-900 transition"
            >
              设置
            </button>
            <button
              onClick={onLogout}
              className="text-sm text-neutral-400 hover:text-neutral-900 transition"
            >
              退出登录
            </button>
          </div>
        </div>
      </header>

      {/* 聊天内容区 */}
      <main
        className="flex-1 overflow-y-auto px-8 py-8"
        style={{ backgroundColor: settings.bgColor }}
      >
        <div className="max-w-5xl mx-auto space-y-6">
          {messages.length === 0 && (
            <div className="h-full flex flex-col items-center justify-center text-center py-20">
              {openingLoading ? (
                <>
                  <p className="text-xl mb-3" style={{ opacity: 0.7 }}>坐下来，慢慢聊聊你自己</p>
                  <p className="text-base" style={{ opacity: 0.5 }}>
                    先从最近的感受开始吧
                  </p>
                </>
              ) : (
                <>
                  <p className="text-xl mb-3" style={{ opacity: 0.7 }}>开始一段深度梳理对话</p>
                  <p className="text-base" style={{ opacity: 0.5 }}>
                    从情绪、思维、价值观、优势、方向五个维度了解自己
                  </p>
                </>
              )}
            </div>
          )}

          {messages.map((m, idx) => {
            const isLatestUser = m.role === 'user' && idx === lastUserIndex;
            return (
              <div
                key={m.id}
                className={`flex items-center ${
                  m.role === 'user' ? 'justify-end' : 'justify-start'
                }`}
              >
                {m.role === 'user' && (
                  <button
                    type="button"
                    onClick={() => undoMessage(idx)}
                    disabled={!isLatestUser}
                    title={isLatestUser ? '撤销这句话' : '只能撤销最新一句'}
                    className={`shrink-0 mr-2 text-lg rounded-full w-8 h-8 flex items-center justify-center transition ${
                      isLatestUser
                        ? 'text-neutral-400 hover:text-neutral-900 hover:bg-neutral-100'
                        : 'text-neutral-200 cursor-not-allowed'
                    }`}
                  >
                    ↶
                  </button>
                )}
                <div
                  className={`max-w-[80%] rounded-xl px-4 py-3 ${
                    m.role === 'user' ? 'text-right' : 'text-left'
                  }`}
                  style={
                    m.role === 'user'
                      ? { backgroundColor: 'rgba(128,128,128,0.12)', color: settings.textColor }
                      : { color: settings.textColor }
                  }
                >
                  {m.role === 'user' && (
                    <div className="mb-1">
                      <span className="text-xs" style={{ opacity: 0.4 }}>
                        你
                      </span>
                    </div>
                  )}
                  {m.role === 'assistant' ? (
                    <div className="markdown-body leading-relaxed">
                      <ReactMarkdown>{getMessageText(m)}</ReactMarkdown>
                    </div>
                  ) : (
                    <p className="leading-relaxed whitespace-pre-wrap">
                      {getMessageText(m)}
                    </p>
                  )}
                </div>
              </div>
            );
          })}

          {/* AI 回复前的"正在输入…"提示 */}
          {(status === 'submitted' || status === 'streaming') && messages.length > 0 && (
            <div className="flex justify-start">
              <div className="rounded-xl px-4 py-3 text-left">
                <span className="text-sm" style={{ opacity: 0.5 }}>
                  正在输入…
                </span>
              </div>
            </div>
          )}
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
        className="border-t px-8 py-5"
        style={{ backgroundColor: settings.bgColor, borderColor: 'rgba(128,128,128,0.2)' }}
      >
        <div className="max-w-5xl mx-auto flex items-center gap-3">
          <button
            type="button"
            onClick={toggleListening}
            className={`shrink-0 px-4 py-2.5 text-sm font-medium border transition ${
              isListening
                ? 'bg-neutral-900 text-white border-neutral-900'
                : 'bg-white text-neutral-700 border-neutral-300 hover:bg-neutral-50'
            }`}
            title="语音输入（需 Chrome 或 Edge）"
          >
            {isListening ? '停止' : '语音输入'}
          </button>

          <input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="输入你的想法..."
            className="flex-1 border px-4 py-2.5 text-base focus:outline-none rounded-lg"
            style={{
              backgroundColor: settings.bgColor,
              color: settings.textColor,
              borderColor: 'rgba(128,128,128,0.3)',
            }}
            disabled={isBusy}
          />

          <button
            type="submit"
            className="shrink-0 px-6 py-2.5 text-sm font-medium bg-neutral-900 text-white hover:bg-neutral-700 disabled:opacity-40 transition"
            disabled={isBusy || !input.trim()}
          >
            {isBusy ? '思考中...' : '发送'}
          </button>
        </div>
      </form>

      {showSettings && (
        <SettingsPanel
          settings={settings}
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