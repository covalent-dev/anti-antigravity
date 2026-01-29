import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { fetchQueue, launchTask, getTaskDetail, type QueueItem, type QueueData } from '../../api/client';
import { useState } from 'react';
import { Play, Clock, AlertCircle, CheckCircle, ChevronRight, X } from 'lucide-react';

const priorityColors: Record<string, string> = {
    p0: 'text-red-300 border-red-900/50 bg-red-950/40',
    p1: 'text-yellow-200 border-yellow-900/50 bg-yellow-950/40',
    p2: 'text-emerald-300 border-emerald-900/50 bg-emerald-950/40',
    p3: 'text-zinc-400 border-zinc-700/50 bg-zinc-900/40',
};

const stateConfig = {
    pending: { icon: Clock, label: 'Pending', color: 'text-zinc-400', bg: 'bg-black border-zinc-800' },
    'in-progress': { icon: Play, label: 'In Progress', color: 'text-blue-300', bg: 'bg-black border-blue-900/30' },
    blocked: { icon: AlertCircle, label: 'Blocked', color: 'text-red-300', bg: 'bg-black border-red-900/30' },
    completed: { icon: CheckCircle, label: 'Completed', color: 'text-emerald-300', bg: 'bg-black border-emerald-900/30' },
};

interface TaskDetailPanelProps {
    taskId: string;
    onClose: () => void;
    onLaunch: (taskId: string, model?: string) => void;
}

function TaskDetailPanel({ taskId, onClose, onLaunch }: TaskDetailPanelProps) {
    const [selectedModel, setSelectedModel] = useState('');
    const { data: task, isLoading } = useQuery({
        queryKey: ['task', taskId],
        queryFn: () => getTaskDetail(taskId),
    });

    if (isLoading) {
        return (
            <div className="bg-black border-l border-white/10 w-[550px] p-4">
                <div className="animate-pulse text-gray-500">Loading...</div>
            </div>
        );
    }

    return (
        <div className="bg-black border-l border-white/10 w-[550px] flex flex-col">
            <div className="flex justify-between items-center p-4 border-b border-white/10">
                <h3 className="font-semibold text-white truncate">{task?.title || taskId}</h3>
                <button onClick={onClose} className="text-gray-500 hover:text-white transition-colors">
                    <X size={18} />
                </button>
            </div>

            <div className="flex-1 overflow-y-auto p-4 flex flex-col gap-4">
                <div className="flex gap-2 flex-wrap text-xs shrink-0">
                    {task?.priority && (
                        <span className={`px-2 py-0.5 border rounded-md font-medium ${priorityColors[task.priority.toLowerCase()] || priorityColors.p2}`}>
                            {task.priority.toUpperCase()}
                        </span>
                    )}
                    {task?.agent && (
                        <span className="px-2 py-0.5 border border-purple-500/50 bg-purple-500/10 text-purple-400 rounded-md font-medium capitalize">
                            {task.agent}
                        </span>
                    )}
                    {task?.state && (
                        <span className="px-2 py-0.5 bg-white/5 text-gray-400 border border-white/10 rounded-md capitalize">
                            {task.state}
                        </span>
                    )}
                </div>

                {task?.content && (
                    <div className="bg-black border border-white/10 rounded-lg p-3 text-sm text-gray-300 whitespace-pre-wrap flex-1">
                        {task.content}
                    </div>
                )}

                {task?.state === 'pending' && (
                    <div className="space-y-2 shrink-0">
                        <label className="block text-xs font-semibold text-gray-500">Model Override</label>
                        <select
                            value={selectedModel}
                            onChange={e => setSelectedModel(e.target.value)}
                            className="w-full bg-black border border-white/10 p-2 text-sm focus:border-white/30 outline-none rounded-md"
                        >
                            <option value="">Default (from task)</option>
                            <option value="sonnet">Sonnet</option>
                            <option value="opus">Opus</option>
                            <option value="gpt-4o">GPT-4o</option>
                            <option value="o3">o3</option>
                            <option value="gemini-2.5-pro">Gemini 2.5 Pro</option>
                        </select>
                    </div>
                )}
            </div>

            {task?.state === 'pending' && (
                <div className="p-4 border-t border-white/10">
                    <button
                        onClick={() => onLaunch(taskId, selectedModel || undefined)}
                        className="w-full px-4 py-2 bg-white hover:bg-gray-200 text-black text-sm font-semibold flex items-center justify-center gap-2 transition-colors rounded-md"
                    >
                        <Play size={16} fill="currentColor" />
                        Launch Task
                    </button>
                </div>
            )}
        </div>
    );
}

interface TaskQueueProps {
    selectedTaskId?: string | null;
    onSelectedTaskIdChange?: (taskId: string | null) => void;
}

export function TaskQueue({ selectedTaskId, onSelectedTaskIdChange }: TaskQueueProps) {
    const [uncontrolledSelectedTaskId, setUncontrolledSelectedTaskId] = useState<string | null>(null);
    const isControlled = selectedTaskId !== undefined;
    const selectedTask = isControlled ? selectedTaskId : uncontrolledSelectedTaskId;
    const setSelectedTask = isControlled ? (onSelectedTaskIdChange ?? (() => {})) : setUncontrolledSelectedTaskId;
    const queryClient = useQueryClient();

    const { data: queue, isLoading } = useQuery({
        queryKey: ['queue'],
        queryFn: fetchQueue,
        refetchInterval: 3000,
    });

    const launchMutation = useMutation({
        mutationFn: ({ taskId, model }: { taskId: string; model?: string }) => launchTask(taskId, model),
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['queue'] });
            queryClient.invalidateQueries({ queryKey: ['sessions'] });
            setSelectedTask(null);
        },
    });

    if (isLoading) {
        return <div className="text-gray-500 p-4">Loading queue...</div>;
    }

    const renderColumn = (state: keyof typeof stateConfig, tasks: QueueItem[]) => {
        const config = stateConfig[state];
        const Icon = config.icon;

        // Sort completed tasks by creation time (most recent first)
        const displayTasks = state === 'completed'
            ? [...tasks].sort((a, b) => new Date(b.created).getTime() - new Date(a.created).getTime())
            : tasks;

        const getTimeBadge = (created: string) => {
            const date = new Date(created);
            const now = new Date();
            const diffMs = now.getTime() - date.getTime();
            const diffHours = diffMs / (1000 * 60 * 60);

            if (diffHours < 1) {
                return <span className="text-[10px] px-1.5 py-0.5 border border-pink-500/30 bg-pink-500/10 text-pink-400 rounded-md font-medium uppercase">Recent</span>;
            }
            if (date.getDate() === now.getDate() && date.getMonth() === now.getMonth() && date.getFullYear() === now.getFullYear()) {
                return <span className="text-[10px] px-1.5 py-0.5 border border-cyan-500/30 bg-cyan-500/10 text-cyan-400 rounded-md font-medium uppercase">Today</span>;
            }
            return null;
        };

        return (
            <div className="flex-1 min-w-[280px] bg-black border border-white/10 rounded-lg flex flex-col max-h-full overflow-hidden">
                <div className={`p-3 border-b border-white/10 bg-white/5`}>
                    <div className="flex items-center gap-2">
                        <Icon size={16} className={config.color} />
                        <span className={`font-semibold ${config.color}`}>{config.label}</span>
                        <span className="ml-auto text-xs text-gray-400 bg-white/5 px-2 py-0.5 rounded-full font-medium">
                            {tasks.length}
                        </span>
                    </div>
                </div>
                <div className="flex-1 overflow-y-auto p-2 space-y-2">
                    {displayTasks.map(task => (
                        <div
                            key={task.id}
                            onClick={() => setSelectedTask(task.id)}
                            className={`p-3 bg-black border rounded-md cursor-pointer hover:border-white/30 transition-colors ${selectedTask === task.id ? 'border-blue-500/50 ring-1 ring-blue-500/20' : 'border-white/10'
                                }`}
                        >
                            <div className="flex items-start justify-between gap-2">
                                <span className="text-sm text-gray-300 line-clamp-2 font-medium">{task.title}</span>
                                <ChevronRight size={14} className="text-gray-600 flex-shrink-0 mt-1" />
                            </div>
                            <div className="flex gap-1 mt-3 flex-wrap items-center">
                                {state === 'completed' && getTimeBadge(task.created)}
                                {task.priority && (
                                    <span className={`text-[10px] px-1.5 py-0.5 border rounded-md ${priorityColors[task.priority.toLowerCase()] || priorityColors.p2} font-medium uppercase`}>
                                        {task.priority}
                                    </span>
                                )}
                                {task.agent && (
                                    <span className="text-[10px] px-1.5 py-0.5 border border-purple-500/30 bg-purple-500/10 text-purple-400 rounded-md font-medium capitalize">
                                        {task.agent}
                                    </span>
                                )}
                            </div>
                        </div>
                    ))}
                    {tasks.length === 0 && (
                        <div className="text-center text-gray-600 text-xs py-8">No tasks</div>
                    )}
                </div>
            </div>
        );
    };

    const activeStates: (keyof QueueData)[] = ['pending', 'in-progress', 'blocked', 'completed'];

    return (
        <div className="flex h-full font-sans">
            <div className="flex-1 flex flex-col p-4 overflow-hidden">
                <div className="flex items-center justify-between mb-4">
                    <h2 className="text-lg font-semibold text-white tracking-tight pl-1">Task Queue</h2>
                </div>
                <div className="flex gap-4 overflow-x-auto flex-1 pb-2">
                    {activeStates.map(state => renderColumn(state, queue?.[state] || []))}
                </div>
            </div>

            {selectedTask && (
                <TaskDetailPanel
                    taskId={selectedTask}
                    onClose={() => setSelectedTask(null)}
                    onLaunch={(taskId, model) => launchMutation.mutate({ taskId, model })}
                />
            )}
        </div>
    );
}
