import { Dialog } from '@headlessui/react';
import { useQuery } from '@tanstack/react-query';
import { Command } from 'cmdk';
import { ListTodo, Monitor, Plus, Search } from 'lucide-react';
import { useMemo, useState } from 'react';
import { fetchQueue, type QueueData, type QueueItem } from '../../api/client';

type View = 'sessions' | 'queue';

interface CommandPaletteProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    onNewTask?: () => void;
    onViewChange?: (view: View) => void;
    onSelectTask?: (taskId: string) => void;
}

function flattenQueue(queue?: QueueData): QueueItem[] {
    if (!queue) return [];
    const items = [
        ...queue.pending,
        ...queue['in-progress'],
        ...queue.blocked,
        ...queue.completed,
    ];
    const seen = new Set<string>();
    const deduped: QueueItem[] = [];
    for (const item of items) {
        if (seen.has(item.id)) continue;
        seen.add(item.id);
        deduped.push(item);
    }
    return deduped;
}

export function CommandPalette({ open, onOpenChange, onNewTask, onViewChange, onSelectTask }: CommandPaletteProps) {
    const [query, setQuery] = useState('');
    const { data: queue } = useQuery({ queryKey: ['queue'], queryFn: fetchQueue });

    const tasks = useMemo(() => {
        const all = flattenQueue(queue);
        all.sort((a, b) => new Date(b.created).getTime() - new Date(a.created).getTime());

        const q = query.trim().toLowerCase();
        if (!q) return all.slice(0, 12);
        return all
            .filter((task) => (task.title || '').toLowerCase().includes(q) || task.id.toLowerCase().includes(q))
            .slice(0, 20);
    }, [queue, query]);

    const close = () => {
        setQuery('');
        onOpenChange(false);
    };

    return (
        <Dialog open={open} onClose={close} className="relative z-50 font-sans">
            <div className="fixed inset-0 bg-black/60 backdrop-blur-sm" aria-hidden="true" />
            <div className="fixed inset-0 flex items-start justify-center p-4 pt-24">
                <Dialog.Panel className="w-full max-w-xl overflow-hidden rounded-lg border border-white/10 bg-black shadow-2xl">
                    <Command className="w-full" shouldFilter={false}>
                        <div className="flex items-center gap-2 border-b border-white/10 px-3">
                            <Search size={16} className="text-gray-500" />
                            <Command.Input
                                value={query}
                                onValueChange={setQuery}
                                placeholder="Search commands and tasks…"
                                autoFocus
                                className="flex-1 bg-transparent py-3 text-sm text-gray-200 outline-none placeholder:text-gray-600"
                            />
                            <span className="text-[10px] text-gray-600 border border-white/10 px-1.5 py-0.5 rounded">ESC</span>
                        </div>

                        <Command.List className="max-h-[360px] overflow-y-auto p-2">
                            <div className="px-2 py-2 text-[11px] font-semibold tracking-wide text-gray-600 uppercase select-none">
                                Commands
                            </div>

                            <Command.Item
                                value="New Task"
                                onSelect={() => {
                                    close();
                                    onNewTask?.();
                                }}
                                className="px-2 py-2 rounded-md cursor-pointer text-sm text-gray-200 flex items-center gap-2 aria-selected:bg-white/10 aria-selected:text-white"
                            >
                                <Plus size={14} className="text-gray-400" />
                                New Task
                            </Command.Item>

                            <Command.Item
                                value="Go to Dashboard"
                                onSelect={() => {
                                    close();
                                    onViewChange?.('queue');
                                }}
                                className="px-2 py-2 rounded-md cursor-pointer text-sm text-gray-200 flex items-center gap-2 aria-selected:bg-white/10 aria-selected:text-white"
                            >
                                <ListTodo size={14} className="text-gray-400" />
                                Go to Dashboard
                            </Command.Item>

                            <Command.Item
                                value="Go to Sessions"
                                onSelect={() => {
                                    close();
                                    onViewChange?.('sessions');
                                }}
                                className="px-2 py-2 rounded-md cursor-pointer text-sm text-gray-200 flex items-center gap-2 aria-selected:bg-white/10 aria-selected:text-white"
                            >
                                <Monitor size={14} className="text-gray-400" />
                                Go to Sessions
                            </Command.Item>

                            <div className="my-2 border-t border-white/10" />

                            <div className="px-2 py-2 text-[11px] font-semibold tracking-wide text-gray-600 uppercase select-none">
                                Tasks
                            </div>

                            {tasks.length === 0 ? (
                                <div className="px-2 py-8 text-center text-sm text-gray-600">No matching tasks</div>
                            ) : (
                                tasks.map((task) => (
                                    <Command.Item
                                        key={task.id}
                                        value={`${task.title} ${task.id}`}
                                        onSelect={() => {
                                            close();
                                            onViewChange?.('queue');
                                            onSelectTask?.(task.id);
                                        }}
                                        className="px-2 py-2 rounded-md cursor-pointer text-sm text-gray-200 flex items-start gap-2 aria-selected:bg-white/10 aria-selected:text-white"
                                    >
                                        <span className="min-w-0 flex-1">
                                            <span className="block text-sm text-gray-200 truncate">{task.title}</span>
                                            <span className="block text-[11px] text-gray-600 truncate">{task.id}</span>
                                        </span>
                                    </Command.Item>
                                ))
                            )}
                        </Command.List>
                    </Command>
                </Dialog.Panel>
            </div>
        </Dialog>
    );
}

