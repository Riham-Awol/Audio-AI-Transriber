'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import {
  ArrowRight,
  Bot,
  Calendar,
  Clock,
  Compass,
  Database,
  ExternalLink,
  Filter,
  MessageSquare,
  Play,
  Plus,
  RefreshCw,
  Search,
  Send,
  Sparkles,
  Trash2,
  User,
} from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { apiRequest } from '@/lib/api';

function formatMs(ms) {
  const totalSeconds = Math.max(0, Math.floor(Number(ms || 0) / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
}

const CROSS_MEETING_STARTERS = [
  {
    title: 'Key Cross-Meeting Decisions',
    desc: 'What decisions were agreed upon regarding architecture, pricing, or product roadmap?',
    query: 'Summarize all major decisions agreed upon across our recent meetings.',
  },
  {
    title: 'Action Items & Deliverables',
    desc: 'List all action items assigned to team members across all projects.',
    query: 'List all action items, assignees, and deadlines mentioned in our meetings.',
  },
  {
    title: 'Technical Roadblocks & Risks',
    desc: 'What technical challenges, blockers, or risks were flagged by engineers?',
    query: 'What technical blockers, risks, or performance concerns were identified across meetings?',
  },
  {
    title: 'Customer & Client Feedback',
    desc: 'What client requests or complaints were discussed in team syncs?',
    query: 'What customer feedback or client requests were discussed in our meetings?',
  },
];

export default function GlobalAssistantPage() {
  const [activeTab, setActiveTab] = useState('chat'); // 'chat' | 'search'
  const [sessions, setSessions] = useState([]);
  const [activeSessionId, setActiveSessionId] = useState(null);
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [initialLoading, setInitialLoading] = useState(true);
  const [error, setError] = useState(null);

  // Filters
  const [meetings, setMeetings] = useState([]);
  const [selectedMeetingId, setSelectedMeetingId] = useState('all');
  const [dateFilter, setDateFilter] = useState('all'); // 'all' | '7d' | '30d'

  // Semantic Search tab state
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState([]);
  const [searching, setSearching] = useState(false);
  const [searched, setSearched] = useState(false);

  const messagesEndRef = useRef(null);
  const inputRef = useRef(null);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  // Load sessions and meetings list
  useEffect(() => {
    async function init() {
      try {
        const [sessData, meetData] = await Promise.all([
          apiRequest('/assistant/sessions'),
          apiRequest('/meetings?limit=50'),
        ]);
        setSessions(sessData.sessions || []);
        setMeetings(meetData.meetings || []);

        if (sessData.sessions && sessData.sessions.length > 0) {
          selectSession(sessData.sessions[0].id);
        } else {
          setInitialLoading(false);
        }
      } catch (err) {
        setError(err.message || 'Failed to load assistant sessions.');
        setInitialLoading(false);
      }
    }
    init();
  }, []);

  useEffect(() => {
    if (activeTab === 'chat') {
      scrollToBottom();
    }
  }, [messages, loading, activeTab]);

  const selectSession = async (sessionId) => {
    setActiveSessionId(sessionId);
    setLoading(true);
    setError(null);
    try {
      const data = await apiRequest(`/assistant/sessions/${sessionId}`);
      setMessages(data.messages || []);
    } catch (err) {
      setError(err.message || 'Failed to load conversation history.');
    } finally {
      setLoading(false);
      setInitialLoading(false);
    }
  };

  const handleCreateNewChat = () => {
    setActiveSessionId(null);
    setMessages([]);
    setError(null);
    setTimeout(() => inputRef.current?.focus(), 50);
  };

  const handleDeleteSession = async (e, sessionId) => {
    e.stopPropagation();
    if (!window.confirm('Delete this AI conversation?')) return;
    try {
      await apiRequest(`/assistant/sessions/${sessionId}`, { method: 'DELETE' });
      setSessions((prev) => prev.filter((s) => s.id !== sessionId));
      if (activeSessionId === sessionId) {
        handleCreateNewChat();
      }
    } catch (err) {
      setError(err.message || 'Failed to delete chat.');
    }
  };

  const handleSendMessage = async (textToSend) => {
    const text = String(textToSend || input).trim();
    if (!text || loading) return;

    setError(null);
    setInput('');

    // Compute date range
    let dateFrom = null;
    const now = new Date();
    if (dateFilter === '7d') {
      dateFrom = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString();
    } else if (dateFilter === '30d') {
      dateFrom = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000).toISOString();
    }

    const meetingIds = selectedMeetingId !== 'all' ? [selectedMeetingId] : null;

    // Optimistic user message
    const tempUserMsg = {
      id: `temp-${Date.now()}`,
      role: 'user',
      content: text,
      createdAt: new Date().toISOString(),
    };
    setMessages((prev) => [...prev, tempUserMsg]);
    setLoading(true);

    try {
      const data = await apiRequest('/assistant/chat', {
        method: 'POST',
        body: {
          sessionId: activeSessionId || undefined,
          message: text,
          meetingIds,
          dateFrom,
        },
      });

      if (!activeSessionId && data.sessionId) {
        setActiveSessionId(data.sessionId);
        // Refresh sessions list
        const sessData = await apiRequest('/assistant/sessions');
        setSessions(sessData.sessions || []);
      }

      if (data.message) {
        setMessages((prev) => [
          ...prev.filter((m) => m.id !== tempUserMsg.id),
          tempUserMsg,
          data.message,
        ]);
      }
    } catch (err) {
      setError(err.message || 'Failed to generate cross-meeting response.');
    } finally {
      setLoading(false);
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  };

  const handleSemanticSearch = async (e) => {
    e.preventDefault();
    const q = searchQuery.trim();
    if (!q || searching) return;

    setSearching(true);
    setSearched(true);
    try {
      const url =
        `/assistant/search?q=${encodeURIComponent(q)}` +
        (selectedMeetingId !== 'all' ? `&meetingId=${selectedMeetingId}` : '');
      const data = await apiRequest(url);
      setSearchResults(data.results || []);
    } catch (err) {
      setError(err.message || 'Semantic search failed.');
    } finally {
      setSearching(false);
    }
  };

  const handleKeyDown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSendMessage();
    }
  };

  return (
    <div className="space-y-5">
      {/* Page Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-xl sm:text-2xl font-bold tracking-tight text-ink">
              Global AI Assistant
            </h1>
            <Badge variant="midnight" className="text-[10px] tracking-wide uppercase">
              ChromaDB RAG
            </Badge>
          </div>
          <p className="text-xs sm:text-sm text-ink-muted">
            Cross-meeting semantic intelligence powered by vector retrieval and Qwen 3.5.
          </p>
        </div>

        {/* View Switcher Tabs */}
        <div className="flex items-center rounded-lg border border-border bg-surface-subtle p-1 self-start sm:self-auto">
          <button
            type="button"
            onClick={() => setActiveTab('chat')}
            className={`inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${
              activeTab === 'chat'
                ? 'bg-midnight text-white shadow-xs'
                : 'text-ink-muted hover:text-ink'
            }`}
          >
            <MessageSquare className="h-3.5 w-3.5" />
            AI Chat
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('search')}
            className={`inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${
              activeTab === 'search'
                ? 'bg-midnight text-white shadow-xs'
                : 'text-ink-muted hover:text-ink'
            }`}
          >
            <Search className="h-3.5 w-3.5" />
            Semantic Search
          </button>
        </div>
      </div>

      {/* Main Container Layout */}
      <div className="grid grid-cols-1 lg:grid-cols-4 gap-5">
        {/* Left Sidebar: Chat Sessions & Scope Filters */}
        <div className="space-y-4 lg:col-span-1">
          {/* Action button */}
          <Button
            type="button"
            onClick={handleCreateNewChat}
            className="w-full gap-2 justify-center"
          >
            <Plus className="h-4 w-4" />
            New Conversation
          </Button>

          {/* Scope Filters Card */}
          <Card>
            <CardHeader className="py-3 px-4">
              <CardTitle className="text-xs font-semibold text-ink flex items-center gap-1.5 uppercase tracking-wider">
                <Filter className="h-3.5 w-3.5 text-burgundy" />
                Knowledge Scope
              </CardTitle>
            </CardHeader>
            <CardContent className="p-4 pt-0 space-y-3">
              <div>
                <label className="block text-[11px] font-medium text-ink-muted mb-1">
                  Target Meetings
                </label>
                <select
                  value={selectedMeetingId}
                  onChange={(e) => setSelectedMeetingId(e.target.value)}
                  className="w-full rounded-md border border-border bg-surface px-2.5 py-1.5 text-xs text-ink focus:border-burgundy outline-hidden"
                >
                  <option value="all">🌐 All Organization Meetings</option>
                  {meetings.map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.title}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-[11px] font-medium text-ink-muted mb-1">
                  Date Range
                </label>
                <select
                  value={dateFilter}
                  onChange={(e) => setDateFilter(e.target.value)}
                  className="w-full rounded-md border border-border bg-surface px-2.5 py-1.5 text-xs text-ink focus:border-burgundy outline-hidden"
                >
                  <option value="all">All Time</option>
                  <option value="7d">Last 7 Days</option>
                  <option value="30d">Last 30 Days</option>
                </select>
              </div>
            </CardContent>
          </Card>

          {/* Conversations History List */}
          <Card>
            <CardHeader className="py-3 px-4">
              <div className="flex items-center justify-between">
                <CardTitle className="text-xs font-semibold text-ink uppercase tracking-wider">
                  Conversations ({sessions.length})
                </CardTitle>
              </div>
            </CardHeader>
            <CardContent className="p-2 pt-0 max-h-[380px] overflow-y-auto space-y-1">
              {sessions.length === 0 ? (
                <p className="p-3 text-xs text-ink-muted text-center">No past conversations.</p>
              ) : (
                sessions.map((s) => {
                  const isActive = activeSessionId === s.id;
                  return (
                    <div
                      key={s.id}
                      onClick={() => selectSession(s.id)}
                      className={`group flex items-center justify-between rounded-lg px-3 py-2 text-xs cursor-pointer transition-colors ${
                        isActive
                          ? 'bg-burgundy/10 text-burgundy font-medium'
                          : 'text-ink hover:bg-surface-subtle'
                      }`}
                    >
                      <div className="flex items-center gap-2 truncate pr-2">
                        <MessageSquare className="h-3.5 w-3.5 shrink-0 opacity-70" />
                        <span className="truncate">{s.title || 'Untitled Conversation'}</span>
                      </div>
                      <button
                        type="button"
                        onClick={(e) => handleDeleteSession(e, s.id)}
                        className="opacity-0 group-hover:opacity-100 text-ink-muted hover:text-red-600 transition-opacity p-0.5"
                        title="Delete chat"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  );
                })
              )}
            </CardContent>
          </Card>
        </div>

        {/* Right Main Panel: Either AI Chat or Semantic Search */}
        <div className="lg:col-span-3 space-y-4">
          {activeTab === 'chat' ? (
            <Card className="min-h-[600px] flex flex-col justify-between">
              {/* Card Header */}
              <CardHeader className="py-3.5 px-4 sm:px-6 border-b border-border">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2.5">
                    <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-burgundy/10 text-burgundy">
                      <Sparkles className="h-4 w-4" />
                    </div>
                    <div>
                      <h2 className="text-sm font-semibold text-ink">
                        {activeSessionId
                          ? sessions.find((s) => s.id === activeSessionId)?.title || 'AI Chat'
                          : 'New Knowledge Assistant Chat'}
                      </h2>
                      <p className="text-[11px] text-ink-muted">
                        Scope:{' '}
                        <span className="font-medium text-ink">
                          {selectedMeetingId === 'all'
                            ? 'All Organization Transcripts'
                            : meetings.find((m) => m.id === selectedMeetingId)?.title || 'Selected Meeting'}
                        </span>
                        {dateFilter !== 'all' && ` • Filtered: ${dateFilter.toUpperCase()}`}
                      </p>
                    </div>
                  </div>

                  <Badge variant="outline" className="text-[11px] font-mono">
                    Qwen 3.5 RAG
                  </Badge>
                </div>
              </CardHeader>

              {/* Chat Messages Body */}
              <CardContent className="p-4 sm:p-6 flex-1 flex flex-col justify-between space-y-4">
                <div className="space-y-4 max-h-[500px] overflow-y-auto pr-1">
                  {initialLoading ? (
                    <div className="flex items-center justify-center py-20 text-sm text-ink-muted gap-2">
                      <RefreshCw className="h-4 w-4 animate-spin text-burgundy" />
                      Loading assistant...
                    </div>
                  ) : messages.length === 0 ? (
                    <div className="py-8 text-center space-y-5">
                      <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-burgundy/10 text-burgundy shadow-inner">
                        <Compass className="h-7 w-7" />
                      </div>
                      <div className="max-w-md mx-auto space-y-1">
                        <h3 className="text-base font-semibold text-ink">
                          Cross-Meeting Intelligence
                        </h3>
                        <p className="text-xs text-ink-muted leading-relaxed">
                          Ask comprehensive questions across all recorded transcripts, executive
                          summaries, and action items in your workspace.
                        </p>
                      </div>

                      {/* Starter prompt cards */}
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 max-w-xl mx-auto text-left pt-2">
                        {CROSS_MEETING_STARTERS.map((s, idx) => (
                          <div
                            key={idx}
                            onClick={() => handleSendMessage(s.query)}
                            className="rounded-xl border border-border bg-surface-subtle p-3.5 hover:border-burgundy/50 hover:bg-burgundy/5 transition-all cursor-pointer space-y-1 group"
                          >
                            <div className="flex items-center justify-between text-xs font-semibold text-ink group-hover:text-burgundy">
                              <span>{s.title}</span>
                              <ArrowRight className="h-3 w-3 opacity-0 group-hover:opacity-100 transition-opacity" />
                            </div>
                            <p className="text-[11px] text-ink-muted leading-tight">{s.desc}</p>
                          </div>
                        ))}
                      </div>
                    </div>
                  ) : (
                    messages.map((msg) => {
                      const isUser = msg.role === 'user';
                      return (
                        <div
                          key={msg.id}
                          className={`flex gap-3 ${isUser ? 'justify-end' : 'justify-start'}`}
                        >
                          {!isUser && (
                            <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-burgundy/10 text-burgundy font-semibold text-xs mt-0.5">
                              <Bot className="h-4 w-4" />
                            </div>
                          )}

                          <div
                            className={`rounded-xl px-4 py-3 max-w-[85%] sm:max-w-[75%] space-y-2 text-sm ${
                              isUser
                                ? 'bg-midnight text-white'
                                : 'bg-surface-subtle border border-border text-ink'
                            }`}
                          >
                            <div className="flex items-center justify-between gap-3 text-[11px] opacity-75">
                              <span className="font-medium">
                                {isUser ? 'You' : 'VoxaMeet Assistant'}
                              </span>
                              {msg.createdAt && (
                                <span>
                                  {new Date(msg.createdAt).toLocaleTimeString([], {
                                    hour: '2-digit',
                                    minute: '2-digit',
                                  })}
                                </span>
                              )}
                            </div>

                            <div className="whitespace-pre-wrap leading-relaxed text-[13px]">
                              {msg.content}
                            </div>

                            {/* Citations for Assistant */}
                            {!isUser && Array.isArray(msg.citations) && msg.citations.length > 0 && (
                              <div className="pt-2 border-t border-border/60 space-y-2">
                                <p className="text-[11px] font-semibold text-ink-muted flex items-center gap-1">
                                  <Clock className="h-3 w-3" />
                                  Grounded Citations ({msg.citations.length})
                                </p>
                                <div className="space-y-1.5">
                                  {msg.citations.map((c, cIdx) => (
                                    <div
                                      key={cIdx}
                                      className="rounded-lg border border-border bg-surface p-2 text-xs space-y-1"
                                    >
                                      <div className="flex items-center justify-between gap-2 font-medium">
                                        <div className="flex items-center gap-1.5 text-burgundy truncate">
                                          <span className="font-semibold">{c.speakerName}</span>
                                          <span className="text-[10px] text-ink-muted">
                                            ({formatMs(c.startMs)})
                                          </span>
                                        </div>
                                        {c.meetingId && (
                                          <Link
                                            href={`/meetings/${c.meetingId}`}
                                            className="inline-flex items-center gap-1 text-[11px] text-midnight hover:underline shrink-0"
                                          >
                                            <span>{c.meetingTitle || 'View Meeting'}</span>
                                            <ExternalLink className="h-2.5 w-2.5" />
                                          </Link>
                                        )}
                                      </div>
                                      <p className="text-[11px] text-ink-muted italic">&quot;{c.quote}&quot;</p>
                                    </div>
                                  ))}
                                </div>
                              </div>
                            )}
                          </div>

                          {isUser && (
                            <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-midnight/10 text-midnight dark:bg-white/10 dark:text-white font-semibold text-xs mt-0.5">
                              <User className="h-4 w-4" />
                            </div>
                          )}
                        </div>
                      );
                    })
                  )}

                  {loading && (
                    <div className="flex gap-3 justify-start">
                      <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-burgundy/10 text-burgundy font-semibold text-xs mt-0.5">
                        <Bot className="h-4 w-4" />
                      </div>
                      <div className="rounded-xl px-4 py-3 bg-surface-subtle border border-border text-xs text-ink-muted flex items-center gap-2">
                        <span className="flex gap-1 items-center">
                          <span className="h-1.5 w-1.5 rounded-full bg-burgundy animate-bounce" style={{ animationDelay: '0ms' }} />
                          <span className="h-1.5 w-1.5 rounded-full bg-burgundy animate-bounce" style={{ animationDelay: '150ms' }} />
                          <span className="h-1.5 w-1.5 rounded-full bg-burgundy animate-bounce" style={{ animationDelay: '300ms' }} />
                        </span>
                        <span>Retrieving semantic chunks across organization transcripts...</span>
                      </div>
                    </div>
                  )}

                  {error && (
                    <div className="rounded-lg border border-red-200 bg-red-50 dark:bg-red-950/30 px-3.5 py-2 text-xs text-red-700 dark:text-red-300">
                      {error}
                    </div>
                  )}

                  <div ref={messagesEndRef} />
                </div>

                {/* Input form */}
                <div className="pt-2">
                  <form
                    onSubmit={(e) => {
                      e.preventDefault();
                      handleSendMessage();
                    }}
                    className="flex items-center gap-2"
                  >
                    <textarea
                      ref={inputRef}
                      rows={1}
                      value={input}
                      onChange={(e) => setInput(e.target.value)}
                      onKeyDown={handleKeyDown}
                      placeholder="Ask a question across all meetings... (Press Enter to send)"
                      className="flex-1 resize-none rounded-lg border border-border bg-surface px-3.5 py-2 text-xs text-ink placeholder:text-ink-muted focus:border-burgundy focus:ring-1 focus:ring-burgundy outline-hidden"
                    />
                    <Button
                      type="submit"
                      disabled={!input.trim() || loading}
                      className="shrink-0 gap-1.5"
                    >
                      <Send className="h-3.5 w-3.5" />
                      <span>Send</span>
                    </Button>
                  </form>
                </div>
              </CardContent>
            </Card>
          ) : (
            /* Semantic Search Tab */
            <Card className="min-h-[600px]">
              <CardHeader className="py-4 px-6 border-b border-border">
                <CardTitle className="text-sm font-semibold text-ink flex items-center gap-2">
                  <Search className="h-4 w-4 text-burgundy" />
                  Semantic Transcript Search
                </CardTitle>
                <p className="text-xs text-ink-muted">
                  Vector similarity search powered by nomic-embed-text dense embeddings.
                </p>
              </CardHeader>
              <CardContent className="p-6 space-y-5">
                <form onSubmit={handleSemanticSearch} className="flex gap-2">
                  <input
                    type="text"
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    placeholder="Search by topic, quote, or semantic concept (e.g. 'pricing models', 'database clustering')..."
                    className="flex-1 rounded-lg border border-border bg-surface px-3.5 py-2 text-xs text-ink placeholder:text-ink-muted focus:border-burgundy focus:ring-1 focus:ring-burgundy outline-hidden"
                  />
                  <Button type="submit" disabled={!searchQuery.trim() || searching}>
                    {searching ? <RefreshCw className="h-3.5 w-3.5 animate-spin" /> : 'Search'}
                  </Button>
                </form>

                {/* Results list */}
                <div className="space-y-3">
                  {searching ? (
                    <div className="py-16 text-center text-xs text-ink-muted flex items-center justify-center gap-2">
                      <RefreshCw className="h-4 w-4 animate-spin text-burgundy" />
                      Searching dense vectors in ChromaDB...
                    </div>
                  ) : searched && searchResults.length === 0 ? (
                    <div className="py-12 text-center text-xs text-ink-muted space-y-1">
                      <p className="font-semibold text-ink">No matching transcript segments found.</p>
                      <p>Try rephrasing your search query or removing filters.</p>
                    </div>
                  ) : (
                    searchResults.map((item, idx) => {
                      const meta = item.metadata || {};
                      const scorePct = Math.round((item.score || 0.8) * 100);
                      return (
                        <div
                          key={item.id || idx}
                          className="rounded-xl border border-border bg-surface-subtle p-4 space-y-2 hover:border-burgundy/40 transition-colors"
                        >
                          <div className="flex items-center justify-between gap-2">
                            <div className="flex items-center gap-2 text-xs">
                              <span className="font-semibold text-burgundy">{meta.speaker_name || meta.speakerName || 'Speaker'}</span>
                              <span className="text-ink-muted">• {formatMs(meta.start_ms || meta.startMs)}</span>
                              <Badge variant="outline" className="text-[10px]">
                                {scorePct}% match
                              </Badge>
                            </div>
                            {meta.meeting_id && (
                              <Link
                                href={`/meetings/${meta.meeting_id}`}
                                className="inline-flex items-center gap-1 text-xs text-midnight hover:underline font-medium"
                              >
                                <span>{meta.meeting_title || 'Open Meeting'}</span>
                                <ExternalLink className="h-3 w-3" />
                              </Link>
                            )}
                          </div>
                          <p className="text-xs text-ink leading-relaxed">&quot;{item.text}&quot;</p>
                        </div>
                      );
                    })
                  )}
                </div>
              </CardContent>
            </Card>
          )}
        </div>
      </div>
    </div>
  );
}
