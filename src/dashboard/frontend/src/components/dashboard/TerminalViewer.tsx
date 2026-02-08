import { Dialog } from '@headlessui/react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Square, X } from 'lucide-react';
import { clsx } from 'clsx';

import { fetchSessionOutput, killSession, type Session } from '../../api/client';

interface TerminalViewerProps {
    session: Session;
    onClose: () => void;
}

export function TerminalViewer({ session, onClose }: TerminalViewerProps) {
    const queryClient = useQueryClient();
    const [autoScroll, setAutoScroll] = useState(true);
    const scrollContainerRef = useRef<HTMLDivElement>(null);

    const queryKey = useMemo(() => ['session-output', session.id], [session.id]);

    const { data, isError, error, isFetching } = useQuery({
        queryKey,
        queryFn: () => fetchSessionOutput(session.id, 500),
        refetchInterval: 1000,
        retry: 2,
        staleTime: 0,
    });

    // Auto-scroll when new output arrives, unless the user has scrolled up.
    useEffect(() => {
        if (!autoScroll) return;
        const el = scrollContainerRef.current;
        if (!el) return;
        requestAnimationFrame(() => {
            el.scrollTop = el.scrollHeight;
        });
    }, [data?.output, autoScroll]);

    const handleScroll = () => {
        const el = scrollContainerRef.current;
        if (!el) return;
        const { scrollTop, scrollHeight, clientHeight } = el;
        const isAtBottom = scrollHeight - scrollTop - clientHeight < 50;
        setAutoScroll(isAtBottom);
    };

    const handleKillSession = async () => {
        if (!confirm(`Kill session ${session.id}?`)) return;
        await killSession(session.id);
        queryClient.invalidateQueries({ queryKey: ['sessions'] });
        onClose();
    };

    const statusLabel = session.status.replace(/_/g, ' ');

    return (
        <Dialog open={true} onClose={onClose} className="relative z-50 font-sans">
            <div className="fixed inset-0 bg-black/80" aria-hidden="true" />

            <div className="fixed inset-0 flex items-center justify-center p-4">
                <Dialog.Panel className="w-full max-w-6xl h-[80vh] bg-black border border-white/10 text-gray-200 flex flex-col shadow-2xl rounded-lg overflow-hidden">
                    <div className="flex items-center justify-between p-4 border-b border-white/10">
                        <div className="flex items-center gap-3 min-w-0">
                            <Dialog.Title className="text-lg font-semibold text-white truncate" title={session.id}>
                                {session.id}
                            </Dialog.Title>
                            <span className="text-xs px-2 py-1 border border-purple-900/50 bg-purple-950/30 text-purple-300 rounded-md font-medium capitalize">
                                {session.agent_type}
                            </span>
                            <span
                                className={clsx('text-xs px-2 py-1 border rounded-md font-medium capitalize', {
                                    'border-emerald-900/50 bg-emerald-950/30 text-emerald-300': ['working', 'running'].includes(session.status),
                                    'border-zinc-700/50 bg-zinc-900/30 text-zinc-400': session.status === 'idle',
                                    'border-red-900/50 bg-red-950/30 text-red-300': session.status === 'error',
                                    'border-blue-900/50 bg-blue-950/30 text-blue-300': session.status === 'done',
                                    'border-amber-900/50 bg-amber-950/30 text-amber-300': session.status === 'needs_input',
                                })}
                            >
                                {statusLabel}
                            </span>
                            {isFetching && <span className="text-xs text-gray-500">Updating…</span>}
                        </div>

                        <div className="flex items-center gap-2">
                            <button
                                onClick={handleKillSession}
                                className="px-3 py-1.5 text-sm bg-red-500/10 hover:bg-red-500/20 text-red-400 border border-red-900/50 rounded transition-colors flex items-center gap-2"
                            >
                                <Square size={14} fill="currentColor" />
                                Kill Session
                            </button>
                            <button onClick={onClose} className="p-2 hover:bg-white/10 rounded transition-colors text-gray-500 hover:text-white">
                                <X size={20} />
                            </button>
                        </div>
                    </div>

                    <div
                        ref={scrollContainerRef}
                        onScroll={handleScroll}
                        className="flex-1 overflow-auto bg-black p-4"
                    >
                        {isError ? (
                            <div className="text-red-400 text-sm">
                                Failed to fetch terminal output. Session may have ended.
                                {error instanceof Error ? ` (${error.message})` : null}
                            </div>
                        ) : (
                            <pre className="text-sm text-green-300 font-mono leading-relaxed whitespace-pre">
                                {data?.output || 'Loading...'}
                            </pre>
                        )}
                    </div>

                    <div className="px-4 py-2 border-t border-white/10 flex items-center justify-between text-xs text-gray-500">
                        <span>{data?.lines || 0} lines captured</span>
                        <div className="flex items-center gap-3">
                            <span
                                className={clsx('flex items-center gap-2', {
                                    'text-emerald-400': autoScroll,
                                    'text-amber-400': !autoScroll,
                                })}
                            >
                                <span className="w-1.5 h-1.5 rounded-full bg-current" />
                                {autoScroll ? 'Auto-scrolling' : 'Scroll paused'}
                            </span>
                            {!autoScroll && (
                                <button
                                    className="px-2 py-1 rounded border border-white/10 hover:border-white/20 hover:bg-white/5 text-gray-300 transition-colors"
                                    onClick={() => {
                                        setAutoScroll(true);
                                        const el = scrollContainerRef.current;
                                        if (el) el.scrollTop = el.scrollHeight;
                                    }}
                                >
                                    Jump to bottom
                                </button>
                            )}
                        </div>
                    </div>
                </Dialog.Panel>
            </div>
        </Dialog>
    );
}

