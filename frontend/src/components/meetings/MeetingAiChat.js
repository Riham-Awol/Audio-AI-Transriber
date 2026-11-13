'use client';

import { useEffect, useRef, useState } from 'react';
import {
  Bot,
  CheckCircle2,
  Clock,
  Database,
  ExternalLink,
  MessageSquare,
  Play,
  RefreshCw,
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

const STARTER_PROMPTS = [
  'What were the key decisions made in this meeting?',
  'List all action items and who is responsible for each.',
  'What were the main challenges or concerns discussed?',
  'Summarize the immediate next steps.',
];

export function MeetingAiChat({ meeting, summary, decisions, actionItems, seekToMs }) {
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [initialLoading, setInitialLoading] = useState(true);
  const [reindexing, setReindexing] = useState(false);
  const [reindexDone, setReindexDone] = useState(false);
  const [error, setError] = useState(null);

  const messagesEndRef = useRef(null);
  const inputRef = useRef(null);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  const loadHistory = useCallback(async () => {
    if (!meeting?.id) return;
    try {
      const data = await apiRequest(`/meetings/${meeting.id}/chat/history`);
      setMessages(data.messages || []);
    } catch (err) {
      setError(err.message || 'Failed to load conversation history.');
    } finally {
      setInitialLoading(false);
    }
  }, [meeting?.id]);

  useEffect(() => {
    loadHistory();
  }, [loadHistory]);

  useEffect(() => {
    scrollToBottom();
  }, [messages, loading]);

  const handleSendMessage = async (textToSend) => {
    const text = String(textToSend || input).trim();
    if (!text || loading) return;

    setError(null);
    setInput('');

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
      const data = await apiRequest(`/meetings/${meeting.id}/chat`, {
        method: 'POST',
        body: { message: text },
      });

      if (data.message) {
        setMessages((prev) => [
          ...prev.filter((m) => m.id !== tempUserMsg.id),
          tempUserMsg,
          data.message,
        ]);
      }
    } catch (err) {
      setError(err.message || 'Failed to generate answer. Please try again.');
    } finally {
      setLoading(false);
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  };

  const handleClearHistory = async () => {
    if (!window.confirm('Are you sure you want to clear chat history for this meeting?')) return;
    try {
      await apiRequest(`/meetings/${meeting.id}/chat/history`, { method: 'DELETE' });
      setMessages([]);
    } catch (err) {
      setError(err.message || 'Failed to clear chat history.');
    }
  };

  const handleReindex = async () => {
    setReindexing(true);
    setReindexDone(false);
    try {
      await apiRequest(`/meetings/${meeting.id}/index`, { method: 'POST' });
      setReindexDone(true);
      setTimeout(() => setReindexDone(false), 3000);
    } catch (err) {
      setError(err.message || 'Failed to index vectors.');
    } finally {
      setReindexing(false);
    }
  };

  const handleKeyDown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSendMessage();
    }
  };

  return (
    <div className="space-y-4">
      {/* Header Card */}
      <Card>
        <CardHeader className="py-3.5 px-4 sm:px-6">
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
            <div className="flex items-center gap-2.5">
              <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-burgundy/10 text-burgundy">
                <Sparkles className="h-5 w-5" />
              </div>
              <div>
                <div className="flex items-center gap-2">
                  <CardTitle className="text-base font-semibold text-ink">
                    In-Meeting AI Assistant
                  </CardTitle>
                  <Badge variant="midnight" className="text-[10px] tracking-wide uppercase">
                    RAG Grounded
                  </Badge>
                </div>
                <p className="text-xs text-ink-muted">
                  Ask anything about &quot;{meeting.title}&quot;. Answers are strictly grounded in
                  diarized transcript citations.
                </p>
              </div>
            </div>

            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={handleReindex}
                disabled={reindexing}
                className="text-xs gap-1.5"
                title="Index transcript segments into ChromaDB vector store"
              >
                {reindexing ? (
                  <>
                    <RefreshCw className="h-3.5 w-3.5 animate-spin" />
                    Indexing...
                  </>
                ) : reindexDone ? (
                  <>
                    <CheckCircle2 className="h-3.5 w-3.5 text-green-600" />
                    Indexed
                  </>
                ) : (
                  <>
                    <Database className="h-3.5 w-3.5 text-ink-muted" />
                    Vector Index
                  </>
                )}
              </Button>

              {messages.length > 0 && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={handleClearHistory}
                  className="text-xs text-red-600 hover:text-red-700 hover:bg-red-50 dark:hover:bg-red-950/20 gap-1.5"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                  Clear
                </Button>
              )}
            </div>
          </div>
        </CardHeader>
      </Card>

      {/* Main Conversation Window */}
      <Card className="min-h-[480px] flex flex-col justify-between">
        <CardContent className="p-4 sm:p-6 flex-1 flex flex-col justify-between space-y-4">
          {/* Messages Feed */}
          <div className="space-y-4 max-h-[520px] overflow-y-auto pr-1">
            {initialLoading ? (
              <div className="flex items-center justify-center py-16 text-sm text-ink-muted gap-2">
                <RefreshCw className="h-4 w-4 animate-spin text-burgundy" />
                Loading conversation...
              </div>
            ) : messages.length === 0 ? (
              <div className="py-8 text-center space-y-4">
                <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-burgundy/10 text-burgundy">
                  <Bot className="h-6 w-6" />
                </div>
                <div className="max-w-md mx-auto space-y-1">
                  <h3 className="text-sm font-semibold text-ink">
                    Ask questions about this meeting
                  </h3>
                  <p className="text-xs text-ink-muted">
                    Your questions are answered using vector similarity across transcript segments,
                    decisions, and action items with exact timestamp seeking.
                  </p>
                </div>

                {/* Starter Prompts */}
                <div className="pt-2 flex flex-wrap justify-center gap-2 max-w-xl mx-auto">
                  {STARTER_PROMPTS.map((prompt, idx) => (
                    <button
                      key={idx}
                      type="button"
                      onClick={() => handleSendMessage(prompt)}
                      className="rounded-full border border-border bg-surface-subtle px-3 py-1.5 text-xs text-ink hover:border-burgundy/40 hover:bg-burgundy/5 transition-colors text-left"
                    >
                      💡 {prompt}
                    </button>
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
                        <span className="font-medium">{isUser ? 'You' : 'VoxaMeet Assistant'}</span>
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

                      {/* Citations block for Assistant */}
                      {!isUser && Array.isArray(msg.citations) && msg.citations.length > 0 && (
                        <div className="pt-2 border-t border-border/60 space-y-1.5">
                          <p className="text-[11px] font-semibold text-ink-muted flex items-center gap-1">
                            <Clock className="h-3 w-3" />
                            Transcript Citations ({msg.citations.length})
                          </p>
                          <div className="flex flex-wrap gap-1.5">
                            {msg.citations.map((c, cIdx) => (
                              <button
                                key={cIdx}
                                type="button"
                                onClick={() => seekToMs && seekToMs(c.startMs)}
                                className="inline-flex items-center gap-1.5 rounded-md border border-border bg-surface px-2 py-1 text-[11px] font-medium text-ink hover:border-burgundy hover:text-burgundy transition-colors shadow-xs group"
                                title={`Quote: "${c.quote}" (Click to play)`}
                              >
                                <Play className="h-2.5 w-2.5 text-burgundy fill-burgundy group-hover:scale-110 transition-transform" />
                                <span className="font-semibold text-burgundy">{c.speakerName}:</span>
                                <span>{formatMs(c.startMs)}</span>
                              </button>
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

            {/* Assistant typing indicator */}
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
                  <span>Synthesizing grounded answer from transcript chunks...</span>
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

          {/* Input Box */}
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
                placeholder="Ask about this meeting... (Press Enter to send, Shift+Enter for new line)"
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
    </div>
  );
}
