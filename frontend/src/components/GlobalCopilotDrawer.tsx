import { useEffect, useMemo, useRef, useState } from 'react';
import { aiApi, type QuickAnalysisResult } from '../api/aiApi';

type Msg = { role: 'user' | 'assistant'; text: string };

function parseBold(text: string): string {
  return text.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
}

export default function GlobalCopilotDrawer() {
  const [open, setOpen] = useState(false);
  const [chatInput, setChatInput] = useState('');
  const [chatLoading, setChatLoading] = useState(false);
  const [messages, setMessages] = useState<Msg[]>([]);
  const [longMemoryQuestions, setLongMemoryQuestions] = useState<string[]>([]);
  const [historyHydrated, setHistoryHydrated] = useState(false);
  const scrollRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    try {
      const stored = window.localStorage.getItem('copilot_messages_v1');
      if (stored) setMessages(JSON.parse(stored));
      const lm = window.localStorage.getItem('copilot_long_memory_v1');
      if (lm) setLongMemoryQuestions(JSON.parse(lm));
    } catch {
      /* ignore */
    } finally {
      setHistoryHydrated(true);
    }
  }, []);

  useEffect(() => {
    if (!historyHydrated) return;
    try {
      window.localStorage.setItem('copilot_messages_v1', JSON.stringify(messages));
    } catch {
      /* ignore */
    }
  }, [messages, historyHydrated]);

  useEffect(() => {
    if (!historyHydrated) return;
    try {
      window.localStorage.setItem('copilot_long_memory_v1', JSON.stringify(longMemoryQuestions));
    } catch {
      /* ignore */
    }
  }, [longMemoryQuestions, historyHydrated]);

  useEffect(() => {
    if (!open) return;
    setTimeout(() => {
      const el = scrollRef.current;
      if (el) el.scrollTop = el.scrollHeight;
    }, 30);
  }, [open, messages.length, chatLoading]);

  const hasHistory = messages.length > 0;

  const resetCopilotHistory = () => {
    setMessages([]);
    setLongMemoryQuestions([]);
    try {
      window.localStorage.removeItem('copilot_messages_v1');
      window.localStorage.removeItem('copilot_long_memory_v1');
    } catch {
      /* ignore */
    }
  };

  const send = async () => {
    const q = chatInput.trim();
    if (!q) return;
    const userMsg: Msg = { role: 'user', text: q };
    const maxUiMessages = 80;
    const shortMemoryText = [...messages, userMsg]
      .slice(-6)
      .map((m) => `${m.role === 'user' ? 'User' : 'Assistant'}: ${m.text}`)
      .join('\n');
    const longMemoryText = longMemoryQuestions.slice(-10).join('\n');

    setChatInput('');
    setMessages((prev) => [...prev, userMsg].slice(-maxUiMessages));
    setChatLoading(true);
    try {
      const r = await aiApi.chat(q, {
        short_memory: shortMemoryText || null,
        long_memory: longMemoryText || null,
      });
      const assistantText =
        'descriptive' in r || 'rows' in r
          ? `**Descriptive**:\n${(r as unknown as QuickAnalysisResult).descriptive}\n\n**Prescriptive**:\n${
              (r as unknown as QuickAnalysisResult).prescriptive
            }`
          : (r as { response: string }).response || '(no response)';
      setMessages((prev) => [
        ...prev,
        { role: 'assistant' as const, text: assistantText },
      ].slice(-maxUiMessages));
      setLongMemoryQuestions((prev) => {
        const normalized = q.trim().toLowerCase();
        if (prev.map((x) => x.trim().toLowerCase()).includes(normalized)) return prev;
        return [...prev, q].slice(-30);
      });
    } catch {
      setMessages((prev) => [
        ...prev,
        { role: 'assistant' as const, text: 'Error generating response.' },
      ].slice(-maxUiMessages));
    } finally {
      setChatLoading(false);
    }
  };

  const recentQuestions = useMemo(
    () =>
      messages
        .filter((m) => m.role === 'user')
        .slice(-8)
        .reverse(),
    [messages],
  );

  return (
    <>
      {!open && (
        <button
          type="button"
          onClick={() => setOpen(true)}
          style={{
            position: 'fixed',
            right: 18,
            bottom: 18,
            zIndex: 3000,
            background: '#2563eb',
            color: '#fff',
            borderRadius: 999,
            padding: '12px 16px',
            fontSize: 18,
            fontWeight: 900,
            boxShadow: '0 10px 30px rgba(37,99,235,.25)',
            cursor: 'pointer',
            border: 'none',
          }}
        >
          Copilot
        </button>
      )}

      {open && (
        <div
          onMouseDown={() => setOpen(false)}
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(15, 23, 42, 0.18)',
            zIndex: 2999,
            display: 'flex',
            justifyContent: 'flex-end',
          }}
        >
          <div
            onMouseDown={(e) => e.stopPropagation()}
            style={{
              width: 480,
              background: '#fff',
              borderLeft: '1px solid #e5e7eb',
              display: 'flex',
              flexDirection: 'column',
            }}
          >
            <div style={{ padding: 16, borderBottom: '1px solid #e5e7eb', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div style={{ fontWeight: 900 }}>Copilot</div>
              <div style={{ display: 'flex', gap: 8 }}>
                <button
                  type="button"
                  className="secondary"
                  onClick={resetCopilotHistory}
                  style={{ padding: '8px 10px', borderRadius: 10 }}
                  title="Clear all Copilot chat and memory history"
                >
                  Reset history
                </button>
                <button type="button" className="secondary" onClick={() => setOpen(false)} style={{ padding: '8px 10px', borderRadius: 10 }}>
                  Close
                </button>
              </div>
            </div>

            <div ref={scrollRef} style={{ flex: 1, overflow: 'auto', background: '#f8fafc', padding: 16, display: 'flex', flexDirection: 'column', gap: 10 }}>
              {!hasHistory ? (
                <div style={{ margin: 'auto', width: '100%' }}>
                  <div style={{ fontSize: 28, fontWeight: 900, marginBottom: 8, textAlign: 'center' }}>How can I help?</div>
                  <div style={{ fontSize: 12, fontWeight: 800, color: '#64748b', marginBottom: 8 }}>Recent chats</div>
                  {recentQuestions.map((q, i) => (
                    <button
                      key={`${q.text}-${i}`}
                      type="button"
                      onClick={() => setChatInput(q.text)}
                      style={{ width: '100%', textAlign: 'left', border: '1px solid #e5e7eb', borderRadius: 10, padding: '10px 12px', background: '#fff', marginBottom: 8 }}
                    >
                      {q.text}
                    </button>
                  ))}
                </div>
              ) : (
                messages.map((m, idx) => (
                  <div
                    key={idx}
                    style={{
                      alignSelf: m.role === 'user' ? 'flex-end' : 'flex-start',
                      maxWidth: '90%',
                      background: m.role === 'user' ? '#e0e7ff' : '#fff',
                      border: '1px solid #e5e7eb',
                      borderRadius: 14,
                      padding: '12px 14px',
                      fontSize: 15,
                      lineHeight: 1.65,
                      color: '#0f172a',
                    }}
                  >
                    <span
                      dangerouslySetInnerHTML={{
                        __html: parseBold(String(m.text)).replace(/\n/g, '<br/>'),
                      }}
                    />
                  </div>
                ))
              )}
              {chatLoading && (
                <div style={{ background: '#fff', border: '1px solid #e5e7eb', borderRadius: 12, padding: 16, fontSize: 12, color: '#64748b' }}>
                  Analyzing...
                </div>
              )}
            </div>

            <div style={{ padding: 14, background: '#fff', borderTop: '1px solid #e5e7eb' }}>
              <div style={{ display: 'flex', gap: 10, border: '1px solid #e5e7eb', borderRadius: 999, padding: '10px 12px', background: '#f8fafc' }}>
                <input
                  value={chatInput}
                  onChange={(e) => setChatInput(e.target.value)}
                  placeholder="Ask a question here..."
                  onKeyDown={(e) => e.key === 'Enter' && !chatLoading && send()}
                  style={{ flex: 1, border: 'none', outline: 'none', background: 'transparent', fontSize: 13 }}
                />
                <button onClick={send} disabled={chatLoading} style={{ width: 34, height: 34, borderRadius: 999, border: 'none', background: chatLoading ? '#cbd5e1' : '#e2e8f0' }}>
                  →
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

