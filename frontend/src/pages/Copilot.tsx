import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, Cell } from 'recharts';
import {
  aiApi,
  type QuickAnalysisDef,
  type QuickAnalysisResult,
  type SavedInsight,
  type FrequentQuestion,
  type MostFrequentQuestion,
} from '../api/aiApi';

function parseBold(text: string): string {
  return text.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
}

export default function Copilot() {
  const [defs, setDefs] = useState<QuickAnalysisDef[]>([]);
  const [loadingDefs, setLoadingDefs] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [chatInput, setChatInput] = useState('');
  const [messages, setMessages] = useState<{
    role: 'user' | 'assistant';
    text: string;
    result?: QuickAnalysisResult;
    title?: string;
    query?: string;
  }[]>([]);
  const [longMemoryQuestions, setLongMemoryQuestions] = useState<string[]>([]);
  const [historyHydrated, setHistoryHydrated] = useState(false);
  const [chatLoading, setChatLoading] = useState(false);
  const [chatStepIdx, setChatStepIdx] = useState(0);
  const chatScrollRef = useRef<HTMLDivElement | null>(null);
  const [searchParams, setSearchParams] = useSearchParams();
  const drawerRequested = searchParams.get('drawer') === '1';
  const [copilotChatOpen, setCopilotChatOpen] = useState(drawerRequested);
  const widgetScrollRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    setCopilotChatOpen(drawerRequested);
  }, [drawerRequested]);

  // Persist chat history and long-memory questions (works across all pages).
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
    // run once
    // eslint-disable-next-line react-hooks/exhaustive-deps
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

  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [analysisResult, setAnalysisResult] = useState<QuickAnalysisResult | null>(null);
  const [analysisLoading, setAnalysisLoading] = useState(false);
  const [hoveredTile, setHoveredTile] = useState<string | null>(null);
  const [dataExpanded, setDataExpanded] = useState(true);
  const [sqlExpanded, setSqlExpanded] = useState(false);

  const [savedInsights, setSavedInsights] = useState<SavedInsight[]>([]);
  const [frequentQuestions, setFrequentQuestions] = useState<FrequentQuestion[]>([]);
  const [mostFrequent, setMostFrequent] = useState<MostFrequentQuestion[]>([]);
  const [saveInsightLoading, setSaveInsightLoading] = useState(false);
  const chatSteps = [
    'Understanding your question',
    'Collecting relevant manufacturing data',
    'Running readiness and shortage checks',
    'Building descriptive and prescriptive insights',
    'Preparing visualization and table output',
  ];

  const refreshSidebar = useCallback(() => {
    aiApi.savedInsights().then(setSavedInsights).catch(() => {});
    aiApi.frequentQuestions().then(setFrequentQuestions).catch(() => {});
    aiApi.mostFrequent().then(setMostFrequent).catch(() => {});
  }, []);

  const closeCopilotDrawer = useCallback(() => {
    setCopilotChatOpen(false);
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      next.delete('drawer');
      return next;
    });
  }, [setSearchParams]);

  useEffect(() => {
    setLoadingDefs(true);
    aiApi.quickAnalyses()
      .then(setDefs)
      .catch((e) => setError(e instanceof Error ? e.message : 'Failed to load'))
      .finally(() => setLoadingDefs(false));
    refreshSidebar();
  }, [refreshSidebar]);

  const defsByKey = useMemo(() => {
    const m = new Map<string, QuickAnalysisDef>();
    for (const d of defs) m.set(d.key, d);
    return m;
  }, [defs]);

  const asAssistantText = useCallback((r: QuickAnalysisResult) => {
    const descriptive = String(r.descriptive || '').trim();
    const prescriptive = String(r.prescriptive || '').trim();
    if (descriptive && prescriptive) return `**Descriptive**:\n${descriptive}\n\n**Prescriptive**:\n${prescriptive}`;
    if (descriptive) return descriptive;
    if (prescriptive) return prescriptive;
    return '(no response)';
  }, []);

  const resetCopilotHistory = useCallback(() => {
    setMessages([]);
    setLongMemoryQuestions([]);
    setAnalysisResult(null);
    setSelectedKey(null);
    try {
      window.localStorage.removeItem('copilot_messages_v1');
      window.localStorage.removeItem('copilot_long_memory_v1');
    } catch {
      /* ignore */
    }
  }, []);

  useEffect(() => {
    if (!chatLoading) return;
    setChatStepIdx(0);
    const t = window.setInterval(() => {
      setChatStepIdx((i) => (i < chatSteps.length - 1 ? i + 1 : i));
    }, 550);
    return () => window.clearInterval(t);
  }, [chatLoading]);

  const send = async () => {
    const q = chatInput.trim();
    if (!q) return;
    const userMsg = { role: 'user' as const, text: q };
    const shortMemoryTurns = 6;
    const maxUiMessages = 80;

    const shortMemoryText = [...messages, userMsg]
      .slice(-shortMemoryTurns)
      .map((m) => `${m.role === 'user' ? 'User' : 'Assistant'}: ${m.text}`)
      .join('\n');

    const longMemoryText = longMemoryQuestions.slice(-10).join('\n');

    setChatInput('');
    setMessages((prev) => [...prev, userMsg].slice(-maxUiMessages));
    setSelectedKey('custom');
    setAnalysisResult(null);
    setChatStepIdx(0);
    setChatLoading(true);
    try {
      const r = await aiApi.chat(q, {
        short_memory: shortMemoryText || null,
        long_memory: longMemoryText || null,
      });
      if ('descriptive' in r || 'rows' in r) {
        // Structured payload from backend: render like a quick tile
        const rr = r as unknown as QuickAnalysisResult;
        setAnalysisResult(rr);
        setMessages((prev) => [
          ...prev,
          { role: 'assistant' as const, text: asAssistantText(rr), result: rr, title: 'custom', query: q },
        ].slice(-maxUiMessages));
      } else {
        // Text-only fallback: still show in the structured panel as Descriptive text
        const resp = (r as { response: string }).response || '(no response)';
        const rr = {
          key: 'custom',
          metrics: {},
          rows: [],
          sql: '',
          descriptive: resp,
          prescriptive: '',
        } as unknown as QuickAnalysisResult;
        setAnalysisResult(rr);
        setMessages((prev) => [
          ...prev,
          { role: 'assistant' as const, text: resp, result: rr, title: 'custom', query: q },
        ].slice(-maxUiMessages));
      }

      setLongMemoryQuestions((prev) => {
        const normalized = q.trim().toLowerCase();
        const existing = prev.map((x) => x.trim().toLowerCase());
        if (existing.includes(normalized)) return prev;
        return [...prev, q].slice(-30);
      });
      refreshSidebar();
    } catch (e: unknown) {
      const errMsg = e instanceof Error ? e.message : 'Chat failed';
      setAnalysisResult({
        key: 'custom',
        metrics: {},
        rows: [],
        sql: '',
        descriptive: `Something went wrong while processing your question.\n\n**Error:** ${errMsg}\n\nPlease try again or rephrase your question.`,
        prescriptive: '',
      } as unknown as QuickAnalysisResult);
      setMessages((prev) => [
        ...prev,
        { role: 'assistant' as const, text: `Error generating response. ${errMsg}` },
      ].slice(-maxUiMessages));
    } finally {
      setChatLoading(false);
    }
  };

  const scrollToBottom = () => {
    setTimeout(() => {
      const el = copilotChatOpen ? widgetScrollRef.current : chatScrollRef.current;
      if (el) el.scrollTop = el.scrollHeight;
    }, 50);
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages.length, analysisResult, analysisLoading, copilotChatOpen]);

  const handleTileClick = async (key: string) => {
    const maxUiMessages = 80;
    const def = defsByKey.get(key);
    setSelectedKey(key);
    setMessages((prev) => [
      ...prev,
      { role: 'user' as const, text: def?.question || def?.title || 'Run analysis' },
    ].slice(-maxUiMessages));
    setAnalysisResult(null);
    setAnalysisLoading(true);
    setDataExpanded(true);
    setSqlExpanded(false);
    setError(null);
    scrollToBottom();
    try {
      const result = await aiApi.runAnalysis(key);
      setAnalysisResult(result);
      setMessages((prev) => [
        ...prev,
        {
          role: 'assistant' as const,
          text: asAssistantText(result),
          result,
          title: def?.title || key,
          query: def?.question || def?.title || 'Run analysis',
        },
      ].slice(-maxUiMessages));
      refreshSidebar();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Analysis failed');
    } finally {
      setAnalysisLoading(false);
    }
  };

  const askFromSidebar = (question: string) => {
    if (chatLoading || analysisLoading) return;
    setChatInput('');
    const userMsg = { role: 'user' as const, text: question };
    const shortMemoryTurns = 6;
    const maxUiMessages = 80;

    const shortMemoryText = [...messages, userMsg]
      .slice(-shortMemoryTurns)
      .map((m) => `${m.role === 'user' ? 'User' : 'Assistant'}: ${m.text}`)
      .join('\n');

    const longMemoryText = longMemoryQuestions.slice(-10).join('\n');

    // Append to history (short memory used for prompt, but full history is displayed).
    setMessages((prev) => [...prev, userMsg].slice(-maxUiMessages));
    setSelectedKey('custom');
    setAnalysisResult(null);
    setChatStepIdx(0);
    setChatLoading(true);
    aiApi
      .chat(question, {
        short_memory: shortMemoryText || null,
        long_memory: longMemoryText || null,
      })
      .then((r) => {
        if ('descriptive' in r || 'rows' in r) {
          const rr = r as unknown as QuickAnalysisResult;
          setAnalysisResult(rr);
          setMessages((prev) => [
            ...prev,
            { role: 'assistant' as const, text: asAssistantText(rr), result: rr, title: 'custom', query: question },
          ].slice(-maxUiMessages));
        } else {
          const resp = (r as { response: string }).response || '(no response)';
          const rr = {
            key: 'custom',
            metrics: {},
            rows: [],
            sql: '',
            descriptive: resp,
            prescriptive: '',
          } as unknown as QuickAnalysisResult;
          setAnalysisResult(rr);
          setMessages((prev) => [
            ...prev,
            { role: 'assistant' as const, text: resp, result: rr, title: 'custom', query: question },
          ].slice(-maxUiMessages));
        }
        setLongMemoryQuestions((prev) => {
          const normalized = question.trim().toLowerCase();
          const existing = prev.map((x) => x.trim().toLowerCase());
          if (existing.includes(normalized)) return prev;
          return [...prev, question].slice(-30);
        });
        refreshSidebar();
      })
      .catch(() => {
        setAnalysisResult({
          key: 'custom',
          metrics: {},
          rows: [],
          sql: '',
          descriptive: 'Something went wrong while processing your question. Please try again.',
          prescriptive: '',
        } as unknown as QuickAnalysisResult);
        setMessages((prev) => [
          ...prev,
          { role: 'assistant' as const, text: 'Error generating response.' },
        ].slice(-maxUiMessages));
      })
      .finally(() => setChatLoading(false));
  };

  const handleDeleteInsight = async (id: number) => {
    try {
      await aiApi.deleteInsight(id);
      setSavedInsights((prev) => prev.filter((i) => i.INSIGHT_ID !== id));
    } catch {
      /* ignore */
    }
  };

  const Icon = ({ kind }: { kind: string }) => {
    const svgProps = {
      width: 18,
      height: 18,
      viewBox: '0 0 24 24',
      fill: 'none',
      xmlns: 'http://www.w3.org/2000/svg' as const,
    };
    const stroke = '#ffffff';
    const strokeWidth = 2;

    if (kind === 'ctb_readiness') {
      return (
        <svg {...svgProps}>
          <path d="M5 19V11" stroke={stroke} strokeWidth={strokeWidth} strokeLinecap="round" />
          <path d="M10 19V7" stroke={stroke} strokeWidth={strokeWidth} strokeLinecap="round" />
          <path d="M15 19V13" stroke={stroke} strokeWidth={strokeWidth} strokeLinecap="round" />
          <path d="M20 19V9" stroke={stroke} strokeWidth={strokeWidth} strokeLinecap="round" />
        </svg>
      );
    }

    if (kind === 'part_shortages') {
      return (
        <svg {...svgProps}>
          <path d="M12 2v5" stroke={stroke} strokeWidth={strokeWidth} strokeLinecap="round" />
          <path d="M12 17v5" stroke={stroke} strokeWidth={strokeWidth} strokeLinecap="round" />
          <path d="M4 12h5" stroke={stroke} strokeWidth={strokeWidth} strokeLinecap="round" />
          <path d="M15 12h5" stroke={stroke} strokeWidth={strokeWidth} strokeLinecap="round" />
          <path d="M7.5 7.5l3 3" stroke={stroke} strokeWidth={strokeWidth} strokeLinecap="round" />
          <path d="M13.5 13.5l3 3" stroke={stroke} strokeWidth={strokeWidth} strokeLinecap="round" />
          <path d="M16.5 7.5l-3 3" stroke={stroke} strokeWidth={strokeWidth} strokeLinecap="round" />
          <path d="M10.5 13.5l-3 3" stroke={stroke} strokeWidth={strokeWidth} strokeLinecap="round" />
        </svg>
      );
    }

    if (kind === 'supplier_performance') {
      return (
        <svg {...svgProps}>
          <path d="M12 8v5l3 2" stroke={stroke} strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round" />
          <path d="M21 12a9 9 0 1 1-9-9" stroke={stroke} strokeWidth={strokeWidth} strokeLinecap="round" />
        </svg>
      );
    }

    return (
      <svg {...svgProps}>
        <path d="M7 4h10a2 2 0 0 1 2 2v14H7a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2Z" stroke={stroke} strokeWidth={strokeWidth} strokeLinejoin="round" />
        <path d="M9 8h8" stroke={stroke} strokeWidth={strokeWidth} strokeLinecap="round" />
        <path d="M9 12h8" stroke={stroke} strokeWidth={strokeWidth} strokeLinecap="round" />
        <path d="M9 16h6" stroke={stroke} strokeWidth={strokeWidth} strokeLinecap="round" />
      </svg>
    );
  };

  const selectedDef = selectedKey ? defsByKey.get(selectedKey) : null;
  const hasAssistantContent = analysisLoading || messages.length > 0;

  const currentQuery = useMemo(() => {
    if (!selectedKey) return '';
    if (selectedKey === 'custom') {
      const lastUser = [...messages].reverse().find((m) => m.role === 'user');
      return lastUser?.text ?? '';
    }
    return selectedDef?.question ?? '';
  }, [selectedKey, messages, selectedDef]);

  const isAlreadySaved = useMemo(() => {
    if (!currentQuery) return false;
    return savedInsights.some((s) => s.QUESTION === currentQuery);
  }, [currentQuery, savedInsights]);

  const handleSaveInsight = useCallback(async () => {
    const q = currentQuery.trim();
    if (!q) return;
    if (isAlreadySaved) return;
    setSaveInsightLoading(true);
    try {
      // Avoid duplicates if savedInsights hasn't finished loading yet.
      const latest = await aiApi.savedInsights();
      const already = latest.some((s) => s.QUESTION === q);
      if (already) {
        setSaveInsightLoading(false);
        setSavedInsights(latest);
        return;
      }
      const title = q.length > 50 ? `${q.slice(0, 50)}...` : q;
      await aiApi.saveInsight(title, q, analysisResult?.sql || '');
      refreshSidebar();
    } catch {
      setError('Failed to save insight.');
    } finally {
      setSaveInsightLoading(false);
    }
  }, [currentQuery, isAlreadySaved, analysisResult?.sql, refreshSidebar]);

  const isSavedQuery = useCallback(
    (q: string) => {
      const normalized = q.trim();
      if (!normalized) return false;
      return savedInsights.some((s) => s.QUESTION === normalized);
    },
    [savedInsights],
  );

  const saveInsightByQuestion = useCallback(
    async (question: string, sql: string) => {
      const q = question.trim();
      if (!q || isSavedQuery(q)) return;
      setSaveInsightLoading(true);
      try {
        const latest = await aiApi.savedInsights();
        const already = latest.some((s) => s.QUESTION === q);
        if (!already) {
          const title = q.length > 50 ? `${q.slice(0, 50)}...` : q;
          await aiApi.saveInsight(title, q, sql || '');
        }
        refreshSidebar();
      } catch {
        setError('Failed to save insight.');
      } finally {
        setSaveInsightLoading(false);
      }
    },
    [isSavedQuery, refreshSidebar],
  );

  const normalizeChartKey = (row: Record<string, unknown>, key: string): unknown => {
    if (key in row) return row[key];
    const upper = key.toUpperCase();
    if (upper in row) return row[upper];
    const lower = key.toLowerCase();
    if (lower in row) return row[lower];
    return undefined;
  };

  const getChartData = (result: QuickAnalysisResult) => {
    if (!result?.chart || !result.rows?.length) return [];
    const { xKey, yKey } = result.chart;
    const parseNumeric = (raw: unknown): number => {
      if (typeof raw === 'number') return raw;
      if (typeof raw === 'string') {
        const sanitized = raw.replace(/,/g, '').trim();
        if (!sanitized) return Number.NaN;
        return Number(sanitized);
      }
      return Number(raw);
    };
    return result.rows
      .slice(0, 15)
      .map((row) => {
        const rawName = normalizeChartKey(row, xKey);
        const rawValue = normalizeChartKey(row, yKey);
        const name = String(rawName ?? '').trim();
        const value = parseNumeric(rawValue);
        return { name, value, hasValue: rawValue != null && rawValue !== '' };
      })
      .filter((d) => d.name.length > 0 && d.hasValue && Number.isFinite(d.value))
      .map(({ name, value }) => ({ name, value }));
  };

  const renderChart = () => {
    if (!analysisResult?.chart || !analysisResult.rows?.length) return null;
    const { type, yKey, color, title } = analysisResult.chart;
    const data = getChartData(analysisResult);
    if (!data.length || data.every((d) => d.value === 0)) return null;

    const isHorizontal = type === 'bar_horizontal';
    const chartHeight = isHorizontal ? Math.max(250, data.length * 26) : 260;

    return (
      <div style={{ marginBottom: 14 }}>
        <div style={{ fontWeight: 800, fontSize: 13, color: '#0f172a', marginBottom: 8 }}>{title}</div>
        <div style={{ background: '#fff', border: '1px solid #e5e7eb', borderRadius: 8, padding: 12 }}>
          <ResponsiveContainer width="100%" height={chartHeight}>
            {isHorizontal ? (
              <BarChart data={data} layout="vertical" margin={{ left: 10, right: 16, top: 5, bottom: 5 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                <XAxis type="number" tick={{ fontSize: 10, fill: '#64748b' }} />
                <YAxis dataKey="name" type="category" width={90} tick={{ fontSize: 10, fill: '#64748b' }} />
                <Tooltip
                  contentStyle={{ borderRadius: 8, border: '1px solid #e5e7eb', fontSize: 11 }}
                  formatter={(val: number) => [val.toLocaleString(), yKey]}
                />
                <Bar dataKey="value" radius={[0, 4, 4, 0]}>
                  {data.map((_, i) => <Cell key={i} fill={color} />)}
                </Bar>
              </BarChart>
            ) : (
              <BarChart data={data} margin={{ left: 5, right: 5, top: 5, bottom: 5 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                <XAxis dataKey="name" tick={{ fontSize: 10, fill: '#64748b' }} />
                <YAxis tick={{ fontSize: 10, fill: '#64748b' }} />
                <Tooltip
                  contentStyle={{ borderRadius: 8, border: '1px solid #e5e7eb', fontSize: 11 }}
                  formatter={(val: number) => [val.toLocaleString(), yKey]}
                />
                <Bar dataKey="value" radius={[4, 4, 0, 0]}>
                  {data.map((_, i) => <Cell key={i} fill={color} />)}
                </Bar>
              </BarChart>
            )}
          </ResponsiveContainer>
        </div>
      </div>
    );
  };

  const renderDataTable = () => {
    if (!analysisResult?.rows?.length) return null;
    const rows = analysisResult.rows;
    const cols = Object.keys(rows[0]);
    if (!cols.length) return null;

    return (
      <div style={{ marginBottom: 14 }}>
        <div style={{ fontWeight: 800, fontSize: 13, color: '#0f172a', marginBottom: 8 }}>Analysis Data</div>
        <div style={{ border: '1px solid #e5e7eb', borderRadius: 8, overflow: 'hidden', background: '#fff' }}>
          <button
            onClick={() => setDataExpanded(!dataExpanded)}
            style={{
              width: '100%',
              padding: '8px 12px',
              background: '#f8fafc',
              border: 'none',
              borderBottom: dataExpanded ? '1px solid #e5e7eb' : 'none',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: 6,
              fontWeight: 700,
              fontSize: 12,
              color: '#334155',
            }}
          >
            <span style={{ transform: dataExpanded ? 'rotate(90deg)' : 'rotate(0)', transition: 'transform .15s', fontSize: 10 }}>&#9654;</span>
            View data table ({rows.length} rows)
          </button>
          {dataExpanded && (
            <div style={{ overflowX: 'auto', maxHeight: 280 }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 11 }}>
                <thead>
                  <tr>
                    {cols.map((c) => (
                      <th
                        key={c}
                        style={{
                          padding: '6px 10px',
                          textAlign: 'left',
                          fontWeight: 800,
                          color: '#475569',
                          background: '#f8fafc',
                          borderBottom: '2px solid #e5e7eb',
                          whiteSpace: 'nowrap',
                          position: 'sticky',
                          top: 0,
                        }}
                      >
                        {c}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row, ri) => (
                    <tr key={ri} style={{ background: ri % 2 === 0 ? '#fff' : '#f8fafc' }}>
                      {cols.map((c) => (
                        <td
                          key={c}
                          style={{
                            padding: '5px 10px',
                            borderBottom: '1px solid #f1f5f9',
                            color: '#0f172a',
                            whiteSpace: 'nowrap',
                          }}
                        >
                          {row[c] != null ? String(row[c]) : '—'}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {analysisResult.sql && (
          <div style={{ border: '1px solid #e5e7eb', borderRadius: 8, overflow: 'hidden', background: '#fff', marginTop: 8 }}>
            <button
              onClick={() => setSqlExpanded(!sqlExpanded)}
              style={{
                width: '100%',
                padding: '8px 12px',
                background: '#f8fafc',
                border: 'none',
                borderBottom: sqlExpanded ? '1px solid #e5e7eb' : 'none',
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                gap: 6,
                fontWeight: 700,
                fontSize: 12,
                color: '#334155',
              }}
            >
              <span style={{ transform: sqlExpanded ? 'rotate(90deg)' : 'rotate(0)', transition: 'transform .15s', fontSize: 10 }}>&#9654;</span>
              View SQL query
            </button>
            {sqlExpanded && (
              <pre
                style={{
                  padding: 12,
                  margin: 0,
                  background: '#1e293b',
                  color: '#e2e8f0',
                  fontSize: 11,
                  lineHeight: 1.5,
                  overflowX: 'auto',
                }}
              >
                {analysisResult.sql.trim()}
              </pre>
            )}
          </div>
        )}
      </div>
    );
  };

  const renderAnalysisInChat = () => {
    if (!analysisResult) return null;

    return (
      <div
        style={{
          alignSelf: 'flex-start',
          width: '100%',
          background: '#fff',
          border: '1px solid #e5e7eb',
          borderRadius: 12,
          padding: 16,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 14 }}>
          <div
            style={{
              width: 32,
              height: 32,
              borderRadius: 8,
              background: '#4f46e5',
              display: 'grid',
              placeItems: 'center',
              flexShrink: 0,
            }}
          >
            <Icon kind={analysisResult.key} />
          </div>
          <div>
            <div style={{ fontWeight: 900, fontSize: 15, color: '#0f172a' }}>
              {selectedDef?.title || analysisResult.key}
            </div>
            {analysisResult.metrics?.summary != null && (
              <div style={{ fontSize: 13, color: '#64748b', fontWeight: 600 }}>
                {String(analysisResult.metrics.summary)}
              </div>
            )}
          </div>
        </div>

        {currentQuery && (
          <div
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'flex-start',
              gap: 12,
              marginBottom: 12,
              marginTop: 2,
            }}
          >
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 13, fontWeight: 800, color: '#64748b', marginBottom: 6 }}>Your question</div>
              <div
                style={{
                  fontSize: 14,
                  fontWeight: 900,
                  color: '#0f172a',
                  lineHeight: 1.3,
                  wordBreak: 'break-word',
                }}
              >
                {currentQuery.length > 100 ? `${currentQuery.slice(0, 100)}...` : currentQuery}
              </div>
            </div>

            <div style={{ flexShrink: 0, paddingTop: 2 }}>
              {isAlreadySaved ? (
                <button
                  disabled
                  style={{
                    padding: '8px 12px',
                    borderRadius: 999,
                    border: '1px solid #e5e7eb',
                    background: '#f8fafc',
                    color: '#94a3b8',
                    fontWeight: 900,
                    fontSize: 12,
                    cursor: 'not-allowed',
                  }}
                >
                  ★ Saved
                </button>
              ) : (
                <button
                  onClick={handleSaveInsight}
                  disabled={saveInsightLoading}
                  style={{
                    padding: '8px 12px',
                    borderRadius: 999,
                    border: '1px solid #e5e7eb',
                    background: saveInsightLoading ? '#f1f5f9' : '#fff',
                    color: '#0f172a',
                    fontWeight: 900,
                    fontSize: 12,
                    cursor: saveInsightLoading ? 'wait' : 'pointer',
                  }}
                  title="Save this answer to Saved insights"
                >
                  {saveInsightLoading ? 'Saving...' : '★ Save'}
                </button>
              )}
            </div>
          </div>
        )}

        {analysisResult.descriptive && (
          <div
            style={{
              padding: 12,
              background: '#e0f2fe',
              borderRadius: 8,
              borderLeft: '4px solid #0284c7',
              marginBottom: 12,
            }}
          >
            <div style={{ fontSize: 13, fontWeight: 800, color: '#0369a1', marginBottom: 6 }}>
              Descriptive — What the data shows
            </div>
            <div
              style={{ color: '#0f172a', fontSize: 15, lineHeight: 1.7 }}
              dangerouslySetInnerHTML={{ __html: parseBold(analysisResult.descriptive) }}
            />
          </div>
        )}

        {analysisResult.prescriptive && (
          <div
            style={{
              padding: 12,
              background: '#f0fdf4',
              borderRadius: 8,
              borderLeft: '4px solid #22c55e',
              marginBottom: 12,
            }}
          >
            <div style={{ fontSize: 13, fontWeight: 800, color: '#15803d', marginBottom: 6 }}>
              Prescriptive — Recommendations & next steps
            </div>
            <div
              style={{ color: '#0f172a', fontSize: 15, lineHeight: 1.8 }}
              dangerouslySetInnerHTML={{
                __html: parseBold(analysisResult.prescriptive).replace(/\n/g, '<br/>'),
              }}
            />
          </div>
        )}

        {renderChart()}
        {renderDataTable()}
      </div>
    );
  };

  const renderChartForResult = (result: QuickAnalysisResult) => {
    if (!result?.chart || !result.rows?.length) return null;
    const { type, yKey, color, title } = result.chart;
    const data = getChartData(result);
    if (!data.length || data.every((d) => d.value === 0)) return null;
    const isHorizontal = type === 'bar_horizontal';
    const chartHeight = isHorizontal ? Math.max(250, data.length * 26) : 260;
    return (
      <div style={{ marginBottom: 14 }}>
        <div style={{ fontWeight: 800, fontSize: 13, color: '#0f172a', marginBottom: 8 }}>{title}</div>
        <div style={{ background: '#fff', border: '1px solid #e5e7eb', borderRadius: 8, padding: 12 }}>
          <ResponsiveContainer width="100%" height={chartHeight}>
            {isHorizontal ? (
              <BarChart data={data} layout="vertical" margin={{ left: 10, right: 16, top: 5, bottom: 5 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                <XAxis type="number" tick={{ fontSize: 10, fill: '#64748b' }} />
                <YAxis dataKey="name" type="category" width={90} tick={{ fontSize: 10, fill: '#64748b' }} />
                <Tooltip contentStyle={{ borderRadius: 8, border: '1px solid #e5e7eb', fontSize: 11 }} formatter={(val: number) => [val.toLocaleString(), yKey]} />
                <Bar dataKey="value" radius={[0, 4, 4, 0]}>{data.map((_, i) => <Cell key={i} fill={color} />)}</Bar>
              </BarChart>
            ) : (
              <BarChart data={data} margin={{ left: 5, right: 5, top: 5, bottom: 5 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                <XAxis dataKey="name" tick={{ fontSize: 10, fill: '#64748b' }} />
                <YAxis tick={{ fontSize: 10, fill: '#64748b' }} />
                <Tooltip contentStyle={{ borderRadius: 8, border: '1px solid #e5e7eb', fontSize: 11 }} formatter={(val: number) => [val.toLocaleString(), yKey]} />
                <Bar dataKey="value" radius={[4, 4, 0, 0]}>{data.map((_, i) => <Cell key={i} fill={color} />)}</Bar>
              </BarChart>
            )}
          </ResponsiveContainer>
        </div>
      </div>
    );
  };

  const renderDataTableForResult = (result: QuickAnalysisResult) => {
    if (!result?.rows?.length) return null;
    const rows = result.rows;
    const cols = Object.keys(rows[0]);
    if (!cols.length) return null;
    return (
      <div style={{ marginBottom: 14 }}>
        <details style={{ border: '1px solid #e5e7eb', borderRadius: 8, overflow: 'hidden', background: '#fff' }}>
          <summary style={{ cursor: 'pointer', padding: '8px 12px', background: '#f8fafc', fontWeight: 700, fontSize: 12, color: '#334155' }}>
            View data table ({rows.length} rows)
          </summary>
          <div style={{ overflowX: 'auto', maxHeight: 280 }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 11 }}>
              <thead>
                <tr>
                  {cols.map((c) => (
                    <th key={c} style={{ padding: '6px 10px', textAlign: 'left', fontWeight: 800, color: '#475569', background: '#f8fafc', borderBottom: '2px solid #e5e7eb', whiteSpace: 'nowrap', position: 'sticky', top: 0 }}>
                      {c}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map((row, ri) => (
                  <tr key={ri} style={{ background: ri % 2 === 0 ? '#fff' : '#f8fafc' }}>
                    {cols.map((c) => (
                      <td key={c} style={{ padding: '5px 10px', borderBottom: '1px solid #f1f5f9', color: '#0f172a', whiteSpace: 'nowrap' }}>
                        {row[c] != null ? String(row[c]) : '—'}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </details>
      </div>
    );
  };

  const renderStructuredMessage = (msg: { result?: QuickAnalysisResult; title?: string; query?: string }) => {
    if (!msg.result) return null;
    const messageQuery = (msg.query || '').trim();
    const alreadySaved = isSavedQuery(messageQuery);
    return (
      <div style={{ alignSelf: 'flex-start', width: '100%', background: '#fff', border: '1px solid #e5e7eb', borderRadius: 12, padding: 16 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, marginBottom: 10 }}>
          <div style={{ fontWeight: 900, fontSize: 15, color: '#0f172a' }}>{msg.title || msg.result.key || 'Analysis'}</div>
          {messageQuery ? (
            <button
              onClick={() => saveInsightByQuestion(messageQuery, msg.result?.sql || '')}
              disabled={saveInsightLoading || alreadySaved}
              style={{
                padding: '8px 12px',
                borderRadius: 999,
                border: '1px solid #e5e7eb',
                background: alreadySaved ? '#f8fafc' : saveInsightLoading ? '#f1f5f9' : '#fff',
                color: alreadySaved ? '#94a3b8' : '#0f172a',
                fontWeight: 700,
                fontSize: 12,
                cursor: alreadySaved ? 'not-allowed' : saveInsightLoading ? 'wait' : 'pointer',
              }}
              title="Save this answer to Saved insights"
            >
              {alreadySaved ? '★ Saved' : saveInsightLoading ? 'Saving...' : '★ Save'}
            </button>
          ) : null}
        </div>
        {msg.query ? (
          <div style={{ fontSize: 13, fontWeight: 700, color: '#64748b', marginBottom: 12 }}>
            Your question: <span style={{ color: '#0f172a' }}>{msg.query}</span>
          </div>
        ) : null}
        {msg.result.descriptive && (
          <div style={{ padding: 12, background: '#e0f2fe', borderRadius: 8, borderLeft: '4px solid #0284c7', marginBottom: 12 }}>
            <div style={{ fontSize: 13, fontWeight: 800, color: '#0369a1', marginBottom: 6 }}>Descriptive — What the data shows</div>
            <div style={{ color: '#0f172a', fontSize: 15, lineHeight: 1.7 }} dangerouslySetInnerHTML={{ __html: parseBold(String(msg.result.descriptive)).replace(/\n/g, '<br/>') }} />
          </div>
        )}
        {msg.result.prescriptive && (
          <div style={{ padding: 12, background: '#f0fdf4', borderRadius: 8, borderLeft: '4px solid #22c55e', marginBottom: 12 }}>
            <div style={{ fontSize: 13, fontWeight: 800, color: '#15803d', marginBottom: 6 }}>Prescriptive — Recommendations & next steps</div>
            <div style={{ color: '#0f172a', fontSize: 15, lineHeight: 1.8 }} dangerouslySetInnerHTML={{ __html: parseBold(String(msg.result.prescriptive)).replace(/\n/g, '<br/>') }} />
          </div>
        )}
        {renderChartForResult(msg.result)}
        {renderDataTableForResult(msg.result)}
      </div>
    );
  };

  const renderChatProgress = (compact = false) => (
    <div
      style={{
        alignSelf: 'flex-start',
        width: '100%',
        background: '#fff',
        border: '1px solid #e5e7eb',
        borderRadius: 12,
        padding: compact ? 14 : 16,
      }}
    >
      <div style={{ fontSize: 14, fontWeight: 800, color: '#4f46e5', marginBottom: 8 }}>Analyzing your question...</div>
      <div style={{ display: 'grid', gap: 6 }}>
        {chatSteps.map((s, idx) => {
          const done = idx < chatStepIdx;
          const active = idx === chatStepIdx;
          return (
            <div
              key={s}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 8,
                fontSize: compact ? 12 : 13,
                fontWeight: active ? 800 : 600,
                color: done ? '#166534' : active ? '#1d4ed8' : '#64748b',
              }}
            >
              <span>{done ? '✓' : active ? '⟳' : '•'}</span>
              <span>{s}</span>
            </div>
          );
        })}
      </div>
    </div>
  );

  return (
    <div>
      <div className="page-hero" style={{ marginBottom: 14 }}>
        <div className="page-hero-title">ReadyToBuild Genie</div>
        <div className="page-hero-subtitle">
          AI-powered analysis for manufacturing readiness, shortage risk, and operational recommendations.
        </div>
      </div>

      {error && <div className="error-msg">{error}</div>}
      {loadingDefs && <div className="loading">Loading Copilot...</div>}

      {!loadingDefs && (
        <div className="grid-4" style={{ marginBottom: 16 }}>
          {defs.map((d) => {
            const isSelected = selectedKey === d.key;
            const isHovered = hoveredTile === d.key;
            return (
              <div
                key={d.key}
                onClick={() => !analysisLoading && handleTileClick(d.key)}
                onMouseEnter={() => setHoveredTile(d.key)}
                onMouseLeave={() => setHoveredTile(null)}
                style={{
                  background: isSelected ? '#e8e4f7' : isHovered ? '#f8fafc' : '#fff',
                  border: `1.5px solid ${isSelected ? '#5046e5' : isHovered ? '#c7d2fe' : '#e5e7eb'}`,
                  borderRadius: 12,
                  padding: 14,
                  boxShadow: isHovered ? '0 4px 16px rgba(79,70,229,.12)' : '0 2px 10px rgba(2,8,23,.04)',
                  display: 'flex',
                  flexDirection: 'column' as const,
                  minHeight: 140,
                  cursor: analysisLoading ? 'wait' : 'pointer',
                  transition: 'all .2s ease',
                  transform: isHovered ? 'translateY(-2px)' : 'none',
                }}
              >
                <div
                  style={{
                    width: 40,
                    height: 40,
                    borderRadius: 10,
                    background: '#4f46e5',
                    display: 'grid',
                    placeItems: 'center',
                    marginBottom: 10,
                  }}
                >
                  <Icon kind={d.key} />
                </div>
                <div style={{ fontWeight: 900, color: '#0f172a', marginBottom: 4, fontSize: 13 }}>{d.title}</div>
                <div style={{ fontSize: 11.5, color: '#94a3b8', lineHeight: 1.35, flex: 1 }}>{d.desc}</div>
                <div
                  style={{
                    marginTop: 10,
                    fontSize: 11,
                    fontWeight: 700,
                    color: '#4f46e5',
                    display: 'flex',
                    alignItems: 'center',
                    gap: 4,
                  }}
                >
                  Click to analyze
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none">
                    <path d="M5 12h14M13 6l6 6-6 6" stroke="#4f46e5" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                </div>
              </div>
            );
          })}
        </div>
      )}

      <div style={{ display: 'grid', gridTemplateColumns: '360px 1fr', gap: 16 }}>
        <div
          style={{
            background: '#fff',
            border: '1px solid #e5e7eb',
            borderRadius: 12,
            padding: 12,
            boxShadow: '0 2px 10px rgba(2,8,23,.04)',
            minHeight: 420,
            alignSelf: 'start',
          }}
        >
          {/* Saved insights */}
          <details
            style={{ border: '1px solid #e5e7eb', borderRadius: 10, padding: 10, marginBottom: 10, background: '#f8fafc' }}
          >
            <summary
              style={{ cursor: 'pointer', listStyle: 'none', fontWeight: 800, color: '#334155', display: 'flex', alignItems: 'center', gap: 8 }}
            >
              <span style={{ width: 18, height: 18, display: 'grid', placeItems: 'center', color: '#64748b', fontWeight: 900 }}>&gt;</span>
              Saved insights
            </summary>
            <div style={{ padding: '8px 4px 4px 8px' }}>
              {savedInsights.length === 0 ? (
                <div style={{ border: '2px dashed #e2e8f0', borderRadius: 10, padding: '12px 10px', textAlign: 'center' }}>
                  <div style={{ fontSize: 12, color: '#94a3b8' }}>Save any Genie answer to see it here.</div>
                </div>
              ) : (
                savedInsights.map((item) => {
                  const label = (item.QUESTION || item.TITLE || '').slice(0, 45) + ((item.QUESTION || item.TITLE || '').length > 45 ? '...' : '');
                  return (
                    <div key={item.INSIGHT_ID} style={{ display: 'flex', alignItems: 'center', gap: 4, marginBottom: 4 }}>
                      <button
                        onClick={() => askFromSidebar(item.QUESTION || item.TITLE)}
                        style={{
                          flex: 1,
                          textAlign: 'left',
                          background: 'none',
                          border: '1px solid #e5e7eb',
                          borderRadius: 8,
                          padding: '6px 10px',
                          fontSize: 12,
                          fontWeight: 600,
                          color: '#334155',
                          cursor: 'pointer',
                          whiteSpace: 'nowrap',
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                        }}
                        title={item.QUESTION}
                      >
                        &#9733; {label}
                      </button>
                      <button
                        onClick={() => handleDeleteInsight(item.INSIGHT_ID)}
                        style={{
                          background: 'none',
                          border: 'none',
                          cursor: 'pointer',
                          color: '#94a3b8',
                          fontSize: 14,
                          fontWeight: 700,
                          padding: '2px 6px',
                          borderRadius: 4,
                        }}
                        title="Delete insight"
                      >
                        &#10005;
                      </button>
                    </div>
                  );
                })
              )}
            </div>
          </details>

          {/* Frequently asked by you */}
          <details
            style={{ border: '1px solid #e5e7eb', borderRadius: 10, padding: 10, marginBottom: 10, background: '#f8fafc' }}
          >
            <summary
              style={{ cursor: 'pointer', listStyle: 'none', fontWeight: 800, color: '#334155', display: 'flex', alignItems: 'center', gap: 8 }}
            >
              <span style={{ width: 18, height: 18, display: 'grid', placeItems: 'center', color: '#64748b', fontWeight: 900 }}>&gt;</span>
              Frequently asked by you
            </summary>
            <div style={{ padding: '8px 4px 4px 8px' }}>
              {frequentQuestions.length === 0 ? (
                <div style={{ border: '2px dashed #e2e8f0', borderRadius: 10, padding: '12px 10px', textAlign: 'center' }}>
                  <div style={{ fontSize: 12, color: '#94a3b8' }}>No questions yet. Ask Genie to see your frequent questions here.</div>
                </div>
              ) : (
                frequentQuestions.slice(0, 5).map((item, i) => {
                  const q = item.NORMALIZED_QUERY || '';
                  const label = q.slice(0, 45) + (q.length > 45 ? '...' : '');
                  return (
                    <button
                      key={i}
                      onClick={() => askFromSidebar(q)}
                      style={{
                        display: 'block',
                        width: '100%',
                        textAlign: 'left',
                        background: 'none',
                        border: '1px solid #e5e7eb',
                        borderRadius: 8,
                        padding: '6px 10px',
                        fontSize: 12,
                        fontWeight: 600,
                        color: '#334155',
                        cursor: 'pointer',
                        marginBottom: 4,
                        whiteSpace: 'nowrap',
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                      }}
                      title={q}
                    >
                      {label} ({item.FREQUENCY}x)
                    </button>
                  );
                })
              )}
            </div>
          </details>

          {/* Most frequent (all users) */}
          <details
            style={{ border: '1px solid #e5e7eb', borderRadius: 10, padding: 10, marginBottom: 10, background: '#f8fafc' }}
          >
            <summary
              style={{ cursor: 'pointer', listStyle: 'none', fontWeight: 800, color: '#334155', display: 'flex', alignItems: 'center', gap: 8 }}
            >
              <span style={{ width: 18, height: 18, display: 'grid', placeItems: 'center', color: '#64748b', fontWeight: 900 }}>&gt;</span>
              Most frequent (all users)
            </summary>
            <div style={{ padding: '8px 4px 4px 8px' }}>
              {mostFrequent.length === 0 ? (
                <div style={{ border: '2px dashed #e2e8f0', borderRadius: 10, padding: '12px 10px', textAlign: 'center' }}>
                  <div style={{ fontSize: 12, color: '#94a3b8' }}>No questions across users yet.</div>
                </div>
              ) : (
                mostFrequent.slice(0, 5).map((item, i) => {
                  const q = item.NORMALIZED_QUERY || '';
                  const label = q.slice(0, 45) + (q.length > 45 ? '...' : '');
                  return (
                    <button
                      key={i}
                      onClick={() => askFromSidebar(q)}
                      style={{
                        display: 'block',
                        width: '100%',
                        textAlign: 'left',
                        background: 'none',
                        border: '1px solid #e5e7eb',
                        borderRadius: 8,
                        padding: '6px 10px',
                        fontSize: 12,
                        fontWeight: 600,
                        color: '#334155',
                        cursor: 'pointer',
                        marginBottom: 4,
                        whiteSpace: 'nowrap',
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                      }}
                      title={q}
                    >
                      {label} ({item.TOTAL_FREQ}x)
                    </button>
                  );
                })
              )}
            </div>
          </details>
        </div>

        <div
          style={{
            background: '#fff',
            border: '1px solid #e5e7eb',
            borderRadius: 12,
            boxShadow: '0 2px 10px rgba(2,8,23,.04)',
            minHeight: 420,
            display: 'flex',
            flexDirection: 'column',
            overflow: 'hidden',
          }}
        >
          <div
            style={{
              padding: 14,
              borderBottom: '1px solid #e5e7eb',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: 10,
            }}
          >
            <div style={{ fontWeight: 900, color: '#0f172a', fontSize: 17 }}>AI Assistant</div>
            <button
              type="button"
              onClick={resetCopilotHistory}
              style={{
                border: '1px solid #e5e7eb',
                background: '#fff',
                color: '#334155',
                borderRadius: 999,
                fontSize: 13,
                fontWeight: 800,
                padding: '6px 12px',
                cursor: 'pointer',
              }}
              title="Clear all Copilot chat and memory history"
            >
              Reset history
            </button>
          </div>

          <div
            ref={chatScrollRef}
            style={{
              flex: 1,
              overflow: 'auto',
              background: '#f8fafc',
              padding: 16,
              display: 'flex',
              flexDirection: 'column',
              gap: 10,
              minHeight: 300,
            }}
          >
            {!hasAssistantContent ? (
              <div style={{ margin: 'auto', textAlign: 'center' }}>
                <div style={{ fontSize: 34, fontWeight: 900, color: '#64748b', marginBottom: 10 }}>Chat</div>
                <div style={{ fontSize: 14, fontWeight: 800, color: '#64748b', marginBottom: 6 }}>Start a Conversation</div>
                <div style={{ fontSize: 12, color: '#94a3b8', maxWidth: 360, lineHeight: 1.5 }}>
                  Ask questions about your ReadyToBuild data, or select a pre-built analysis from the library
                </div>
              </div>
            ) : (
              <>
                {messages.map((m, idx) => (
                  m.role === 'assistant' && m.result ? (
                    <div key={idx}>{renderStructuredMessage(m)}</div>
                  ) : (
                    <div
                      key={idx}
                      style={{
                        alignSelf: m.role === 'user' ? 'flex-end' : 'flex-start',
                        maxWidth: '85%',
                        background: m.role === 'user' ? '#e0e7ff' : '#fff',
                        border: '1px solid #e5e7eb',
                        borderRadius: 14,
                        padding: '10px 12px',
                        whiteSpace: 'pre-wrap',
                        fontSize: 15,
                        lineHeight: 1.55,
                        color: '#0f172a',
                      }}
                    >
                      {m.role === 'assistant' ? (
                        <span dangerouslySetInnerHTML={{ __html: parseBold(String(m.text)).replace(/\n/g, '<br/>') }} />
                      ) : (
                        m.text
                      )}
                    </div>
                  )
                ))}

                {chatLoading && renderChatProgress()}

                {analysisLoading && (
                  <div
                    style={{
                      alignSelf: 'flex-start',
                      width: '100%',
                      background: '#fff',
                      border: '1px solid #e5e7eb',
                      borderRadius: 12,
                      padding: 24,
                      textAlign: 'center',
                    }}
                  >
                    <div style={{ fontSize: 14, fontWeight: 800, color: '#4f46e5', marginBottom: 6 }}>
                      Running {selectedDef?.title || 'analysis'}...
                    </div>
                    <div style={{ color: '#94a3b8', fontSize: 12 }}>Fetching data and generating insights</div>
                  </div>
                )}

              </>
            )}
          </div>

          <div style={{ padding: 14, background: '#fff', borderTop: '1px solid #e5e7eb' }}>
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 10,
                border: '1px solid #e5e7eb',
                borderRadius: 999,
                padding: '10px 12px',
                background: '#f8fafc',
              }}
            >
              <input
                ref={inputRef}
                value={chatInput}
                onChange={(e) => setChatInput(e.target.value)}
                placeholder="Ask a question here..."
                onKeyDown={(e) => e.key === 'Enter' && !chatLoading && send()}
                style={{
                  flex: 1,
                  border: 'none',
                  outline: 'none',
                  background: 'transparent',
                  fontSize: 15,
                  color: '#0f172a',
                }}
              />
              <button
                onClick={send}
                disabled={chatLoading}
                aria-label="Send"
                style={{
                  width: 34,
                  height: 34,
                  borderRadius: 999,
                  border: 'none',
                  background: chatLoading ? '#cbd5e1' : '#e2e8f0',
                  display: 'grid',
                  placeItems: 'center',
                  cursor: chatLoading ? 'not-allowed' : 'pointer',
                }}
              >
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                  <path d="M4 12h14" stroke="#64748b" strokeWidth="2" strokeLinecap="round" />
                  <path d="M12 6l6 6-6 6" stroke="#64748b" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </button>
            </div>
          </div>
        </div>
      </div>

      {copilotChatOpen && (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(15, 23, 42, 0.18)',
            zIndex: 2999,
            display: 'flex',
            justifyContent: 'flex-end',
            alignItems: 'stretch',
          }}
          onMouseDown={closeCopilotDrawer}
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
            <div
              style={{
                padding: 16,
                borderBottom: '1px solid #e5e7eb',
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                gap: 12,
              }}
            >
              <div>
                <div style={{ fontSize: 18, fontWeight: 900, color: '#0f172a' }}>Copilot</div>
                <div style={{ fontSize: 12, color: '#64748b', marginTop: 2 }}>How can I help?</div>
              </div>
              <button
                type="button"
                className="secondary"
                onClick={closeCopilotDrawer}
                style={{ padding: '8px 12px', borderRadius: 10 }}
              >
                Close
              </button>
            </div>

            <div
              ref={widgetScrollRef}
              style={{
                flex: 1,
                overflow: 'auto',
                background: '#f8fafc',
                padding: 16,
                display: 'flex',
                flexDirection: 'column',
                gap: 10,
              }}
            >
              {messages.length === 0 ? (
                <div style={{ margin: 'auto', textAlign: 'center', width: '100%' }}>
                  <div style={{ fontSize: 32, fontWeight: 900, color: '#0f172a', marginBottom: 8 }}>How can I help?</div>
                  <button
                    type="button"
                    className="primary"
                    onClick={() => {
                      const q = mostFrequent[0]?.NORMALIZED_QUERY;
                      if (q) askFromSidebar(q);
                    }}
                    style={{ background: '#2563eb', borderRadius: 999, padding: '10px 16px' }}
                  >
                    Show me what Copilot can do
                  </button>

                  <div style={{ marginTop: 16, textAlign: 'left' }}>
                    <div style={{ fontSize: 12, fontWeight: 900, color: '#475569', marginBottom: 10 }}>Recent chats</div>
                    {mostFrequent.slice(0, 5).map((q) => (
                      <button
                        key={q.NORMALIZED_QUERY}
                        type="button"
                        onClick={() => askFromSidebar(q.NORMALIZED_QUERY)}
                        style={{
                          width: '100%',
                          textAlign: 'left',
                          border: '1px solid #e5e7eb',
                          borderRadius: 10,
                          padding: '10px 12px',
                          background: '#fff',
                          cursor: 'pointer',
                          marginBottom: 8,
                          color: '#0f172a',
                          fontWeight: 700,
                          fontSize: 12,
                        }}
                        title={q.NORMALIZED_QUERY}
                      >
                        {q.NORMALIZED_QUERY}
                      </button>
                    ))}
                  </div>
                </div>
              ) : (
                <>
                  {messages.map((m, idx) => (
                    <div
                      key={idx}
                      style={{
                        alignSelf: m.role === 'user' ? 'flex-end' : 'flex-start',
                        maxWidth: '85%',
                        background: m.role === 'user' ? '#e0e7ff' : '#fff',
                        border: '1px solid #e5e7eb',
                        borderRadius: 14,
                        padding: '10px 12px',
                        whiteSpace: 'pre-wrap',
                        fontSize: 13,
                        lineHeight: 1.55,
                        color: '#0f172a',
                      }}
                      >
                      <span
                        dangerouslySetInnerHTML={{
                          __html: parseBold(String(m.text)).replace(/\n/g, '<br/>'),
                        }}
                      />
                    </div>
                  ))}

                  {chatLoading && renderChatProgress(true)}

                </>
              )}
            </div>

            <div style={{ padding: 14, background: '#fff', borderTop: '1px solid #e5e7eb' }}>
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 10,
                  border: '1px solid #e5e7eb',
                  borderRadius: 999,
                  padding: '10px 12px',
                  background: '#f8fafc',
                }}
              >
                <input
                  value={chatInput}
                  onChange={(e) => setChatInput(e.target.value)}
                  placeholder="Ask a question here..."
                  onKeyDown={(e) => e.key === 'Enter' && !chatLoading && send()}
                  style={{
                    flex: 1,
                    border: 'none',
                    outline: 'none',
                    background: 'transparent',
                    fontSize: 13,
                    color: '#0f172a',
                  }}
                />
                <button
                  onClick={send}
                  disabled={chatLoading}
                  aria-label="Send"
                  style={{
                    width: 34,
                    height: 34,
                    borderRadius: 999,
                    border: 'none',
                    background: chatLoading ? '#cbd5e1' : '#e2e8f0',
                    display: 'grid',
                    placeItems: 'center',
                    cursor: chatLoading ? 'not-allowed' : 'pointer',
                  }}
                >
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                    <path d="M4 12h14" stroke="#64748b" strokeWidth="2" strokeLinecap="round" />
                    <path d="M12 6l6 6-6 6" stroke="#64748b" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
