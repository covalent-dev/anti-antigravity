import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { fetchSessions, killSession, type Session } from '../../api/client';
import { Play, Square, AlertCircle, CheckCircle, Clock, HelpCircle } from 'lucide-react';
import { clsx } from 'clsx';

function SessionCard({ session }: { session: Session }) {
    const queryClient = useQueryClient();
    const killMutation = useMutation({
        mutationFn: killSession,
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['sessions'] });
        },
    });

    const statusLabel = session.status.replace(/_/g, ' ');

    return (
        <div className="bg-black p-3 border border-white/10 rounded-lg shadow-sm hover:border-blue-500/50 transition-colors group w-full">
            <div className="flex justify-between items-start mb-2">
                <h3 className="text-sm font-semibold text-white truncate" title={session.id}>
                    {session.id}
                </h3>
                <span className={clsx("text-xs px-2 py-0.5 border rounded-md font-medium capitalize", {
                    'border-emerald-900/50 bg-emerald-950/30 text-emerald-300': ['working', 'running'].includes(session.status),
                    'border-zinc-700/50 bg-zinc-900/30 text-zinc-400': session.status === 'idle',
                    'border-red-900/50 bg-red-950/30 text-red-300': session.status === 'error',
                    'border-blue-900/50 bg-blue-950/30 text-blue-300': session.status === 'done',
                    'border-amber-900/50 bg-amber-950/30 text-amber-300': session.status === 'needs_input',
                })}>
                    {statusLabel}
                </span>
            </div>

            <div className="text-xs text-gray-400 mb-3 line-clamp-2">{session.message}</div>

            {session.progress && (
                <div className="w-full bg-white/5 h-1.5 rounded-full overflow-hidden mb-3">
                    <div
                        className="bg-blue-600/80 h-full transition-all duration-300 rounded-full"
                        style={{ width: `${(session.progress.current / session.progress.total) * 100}%` }}
                    />
                </div>
            )}

            <div className="flex justify-between items-center opacity-0 group-hover:opacity-100 transition-opacity">
                <span className="text-xs text-purple-400 font-medium capitalize">{session.agent_type}</span>
                <button
                    onClick={() => killMutation.mutate(session.id)}
                    className="text-red-400 hover:text-red-300 hover:bg-red-500/10 p-1 rounded transition-colors"
                    title="Kill Session"
                >
                    <Square size={12} fill="currentColor" />
                </button>
            </div>
        </div>
    );
}

export function SessionBoard() {
    const { data: sessions, isLoading } = useQuery({
        queryKey: ['sessions'],
        queryFn: fetchSessions,
        refetchInterval: 2000,
    });

    if (isLoading) return <div className="p-4 text-gray-500">Loading sessions...</div>;

    const grouped = {
        idle: sessions?.filter(s => s.status === 'idle') || [],
        working: sessions?.filter(s => ['working', 'running'].includes(s.status)) || [],
        needs_input: sessions?.filter(s => s.status === 'needs_input') || [],
        done: sessions?.filter(s => s.status === 'done') || [],
        error: sessions?.filter(s => s.status === 'error') || [],
    };

    return (
        <div className="flex gap-4 h-full p-4 overflow-x-auto min-w-full font-sans">
            <Column title="Idle" count={grouped.idle.length} items={grouped.idle} icon={<Clock size={16} />} />
            <Column title="Working" count={grouped.working.length} items={grouped.working} icon={<Play size={16} />} />
            <Column title="Needs Input" count={grouped.needs_input.length} items={grouped.needs_input} icon={<HelpCircle size={16} />} />
            <Column title="Done" count={grouped.done.length} items={grouped.done} icon={<CheckCircle size={16} />} />
            <Column title="Error" count={grouped.error.length} items={grouped.error} icon={<AlertCircle size={16} />} />
        </div>
    );
}

function Column({ title, count, items, icon }: { title: string, count: number, items: Session[], icon: React.ReactNode }) {
    return (
        <div className="flex-1 min-w-[280px] bg-black flex flex-col border border-white/10 rounded-lg overflow-hidden">
            <div className="flex items-center justify-between p-3 border-b border-white/10 bg-white/5">
                <div className="flex items-center gap-2 text-white font-semibold text-sm">
                    {icon}
                    <span>{title}</span>
                </div>
                <span className="text-xs bg-white/5 text-gray-400 px-2 py-0.5 rounded-full font-medium">{count}</span>
            </div>
            <div className="flex-1 bg-black p-2 space-y-2 overflow-y-auto">
                {items.map(session => <SessionCard key={session.id} session={session} />)}
                {items.length === 0 && <div className="text-xs text-gray-600 text-center py-4">No sessions</div>}
            </div>
        </div>
    );
}
