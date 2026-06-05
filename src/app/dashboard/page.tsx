"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import Link from "next/link";

// ─── Types ───────────────────────────────────────────────────────────────────

interface DashboardData {
  unmatchedReceiptLines: number;
  invoicesWithoutReceipt: number;
  readyToPay: number;
  posInProgress: number;
  ap: { totalUnpaid: number; unpaidCount: number; totalPastDue: number; pastDueCount: number };
}

interface ChatMessage {
  role: "user" | "assistant";
  content: string;
  status?: string;
  isStreaming?: boolean;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function fmt(n: number) {
  return n.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });
}

function renderText(text: string) {
  // Simple bold + line break rendering without a markdown library
  const lines = text.split("\n");
  return lines.map((line, i) => {
    const parts = line.split(/\*\*(.*?)\*\*/g);
    return (
      <span key={i}>
        {parts.map((part, j) =>
          j % 2 === 1 ? <strong key={j}>{part}</strong> : part
        )}
        {i < lines.length - 1 && <br />}
      </span>
    );
  });
}

const STARTERS = [
  "What needs attention today?",
  "Which invoices are ready to pay?",
  "Show me unmatched receipts",
  "What transfers are in transit?",
];

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function DashboardPage() {
  const [data, setData] = useState<DashboardData | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    fetch("/api/dashboard")
      .then((r) => r.json())
      .then(setData)
      .catch(() => null);
  }, []);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  const sendMessage = useCallback(async (text: string) => {
    if (!text.trim() || isLoading) return;

    const userMessage: ChatMessage = { role: "user", content: text.trim() };
    const newMessages = [...messages, userMessage];
    setMessages(newMessages);
    setInput("");
    setIsLoading(true);

    // Add empty assistant message that we'll stream into
    const assistantIdx = newMessages.length;
    setMessages((prev) => [...prev, { role: "assistant", content: "", isStreaming: true }]);

    try {
      const res = await fetch("/api/ai/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          messages: newMessages.map((m) => ({ role: m.role, content: m.content })),
        }),
      });

      if (!res.body) throw new Error("No response body");

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";

        for (const line of lines) {
          if (!line.trim()) continue;
          try {
            const event = JSON.parse(line) as { type: string; text?: string };
            if (event.type === "status") {
              setMessages((prev) => {
                const updated = [...prev];
                updated[assistantIdx] = { ...updated[assistantIdx], status: event.text };
                return updated;
              });
            } else if (event.type === "text") {
              setMessages((prev) => {
                const updated = [...prev];
                updated[assistantIdx] = {
                  ...updated[assistantIdx],
                  content: (updated[assistantIdx].content ?? "") + event.text,
                  status: undefined,
                };
                return updated;
              });
            } else if (event.type === "done" || event.type === "error") {
              setMessages((prev) => {
                const updated = [...prev];
                updated[assistantIdx] = {
                  ...updated[assistantIdx],
                  isStreaming: false,
                  status: undefined,
                  content: event.type === "error"
                    ? (event.text ?? "Something went wrong.")
                    : updated[assistantIdx].content,
                };
                return updated;
              });
            }
          } catch {
            // malformed line, skip
          }
        }
      }
    } catch {
      setMessages((prev) => {
        const updated = [...prev];
        updated[assistantIdx] = {
          ...updated[assistantIdx],
          content: "Sorry, something went wrong. Please try again.",
          isStreaming: false,
          status: undefined,
        };
        return updated;
      });
    } finally {
      setIsLoading(false);
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  }, [messages, isLoading]);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      sendMessage(input);
    }
  };

  const today = new Date().toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" });

  return (
    <div className="h-screen flex flex-col bg-gray-50 overflow-hidden">

      {/* ── Metric strip ───────────────────────────────────────────────── */}
      <div className="flex-none px-6 pt-6 pb-4">
        <div className="flex items-center justify-between mb-3">
          <p className="text-xs text-gray-400">{today}</p>
        </div>
        <div className="grid grid-cols-4 gap-3">
          <MetricCard
            label="Accounts Payable"
            value={data ? fmt(data.ap.totalUnpaid) : "—"}
            sub={data ? `${data.ap.unpaidCount} unpaid` : ""}
            alert={data && data.ap.pastDueCount > 0 ? `${data.ap.pastDueCount} past due` : undefined}
            href="/invoices"
          />
          <MetricCard
            label="Unmatched Receipts"
            value={data ? String(data.unmatchedReceiptLines) : "—"}
            sub="lines need invoice"
            urgent={!!data && data.unmatchedReceiptLines > 0}
            href="/receipts"
          />
          <MetricCard
            label="Ready to Pay"
            value={data ? String(data.readyToPay) : "—"}
            sub="invoices approved"
            good={!!data && data.readyToPay > 0}
            href="/invoices?filter=ready-to-pay"
          />
          <MetricCard
            label="POs Active"
            value={data ? String(data.posInProgress) : "—"}
            sub="in progress"
            href="/pos"
          />
        </div>
      </div>

      {/* ── Chat area ──────────────────────────────────────────────────── */}
      <div className="flex-1 flex flex-col min-h-0 px-6 pb-6">
        <div className="flex-1 flex flex-col min-h-0 bg-white rounded-xl border border-gray-200 overflow-hidden">

          {/* Messages */}
          <div className="flex-1 overflow-y-auto p-6 space-y-5">
            {messages.length === 0 ? (
              <EmptyState onSelect={sendMessage} />
            ) : (
              messages.map((msg, i) => (
                <MessageBubble key={i} message={msg} />
              ))
            )}
            <div ref={messagesEndRef} />
          </div>

          {/* Input */}
          <div className="flex-none border-t border-gray-100 p-4">
            <div className="flex items-end gap-3">
              <textarea
                ref={inputRef}
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder="Ask anything about inventory, invoices, transfers, or POs…"
                rows={1}
                className="flex-1 resize-none text-sm text-gray-900 placeholder-gray-400 border-0 outline-none bg-transparent leading-relaxed"
                style={{ maxHeight: "120px", overflowY: "auto" }}
                disabled={isLoading}
              />
              <button
                onClick={() => sendMessage(input)}
                disabled={!input.trim() || isLoading}
                className="flex-none w-8 h-8 flex items-center justify-center rounded-lg bg-gray-900 text-white disabled:opacity-30 hover:bg-gray-700 transition-colors"
              >
                <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 10.5L12 3m0 0l7.5 7.5M12 3v18" />
                </svg>
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Sub-components ────────────────────────────────────────────────────────────

function MetricCard({
  label, value, sub, alert, urgent, good, href,
}: {
  label: string; value: string; sub: string;
  alert?: string; urgent?: boolean; good?: boolean; href: string;
}) {
  return (
    <Link href={href} className={`block rounded-lg border px-4 py-3 transition-colors hover:opacity-90 ${
      urgent ? "bg-warm-50 border-warm-200"
      : good ? "bg-sage-50 border-sage-200"
      : "bg-white border-gray-200"
    }`}>
      <p className="text-[10px] font-semibold uppercase tracking-wider text-gray-400 mb-1">{label}</p>
      <p className={`text-xl font-bold tabular-nums ${urgent ? "text-warm-800" : good ? "text-sage-800" : "text-gray-900"}`}>
        {value}
      </p>
      <p className={`text-xs mt-0.5 ${urgent ? "text-warm-600" : good ? "text-sage-600" : "text-gray-400"}`}>
        {sub}
      </p>
      {alert && (
        <p className="text-xs mt-0.5 text-burgundy-600 font-medium">{alert}</p>
      )}
    </Link>
  );
}

function EmptyState({ onSelect }: { onSelect: (text: string) => void }) {
  return (
    <div className="flex flex-col items-center justify-center h-full text-center py-12">
      <div className="w-10 h-10 rounded-full bg-gray-100 flex items-center justify-center mb-4">
        <svg className="w-5 h-5 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M9.813 15.904L9 18.75l-.813-2.846a4.5 4.5 0 00-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 003.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 003.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 00-3.09 3.09z" />
        </svg>
      </div>
      <p className="text-sm font-medium text-gray-700 mb-1">Orchard AI</p>
      <p className="text-xs text-gray-400 mb-8 max-w-xs">
        Ask anything about Magna&rsquo;s inventory — receipts, invoices, transfers, POs, or what needs attention.
      </p>
      <div className="flex flex-wrap gap-2 justify-center">
        {STARTERS.map((s) => (
          <button
            key={s}
            onClick={() => onSelect(s)}
            className="text-xs text-gray-600 bg-gray-50 border border-gray-200 rounded-full px-3 py-1.5 hover:bg-gray-100 transition-colors"
          >
            {s}
          </button>
        ))}
      </div>
    </div>
  );
}

function MessageBubble({ message }: { message: ChatMessage }) {
  const isUser = message.role === "user";

  return (
    <div className={`flex ${isUser ? "justify-end" : "justify-start"}`}>
      <div className={`max-w-[75%] ${isUser ? "order-1" : ""}`}>
        {isUser ? (
          <div className="bg-gray-900 text-white text-sm rounded-2xl rounded-tr-sm px-4 py-2.5">
            {message.content}
          </div>
        ) : (
          <div className="text-sm text-gray-800 leading-relaxed">
            {message.status && !message.content && (
              <span className="text-xs text-gray-400 italic">{message.status}</span>
            )}
            {message.content && renderText(message.content)}
            {message.isStreaming && message.content && (
              <span className="inline-block w-1.5 h-3.5 bg-gray-400 ml-0.5 animate-pulse rounded-sm" />
            )}
          </div>
        )}
      </div>
    </div>
  );
}
