import { Bell, Search, Plus, ListTodo, Monitor } from 'lucide-react';

type View = 'sessions' | 'queue';

interface HeaderProps {
    onNewTask?: () => void;
    activeView?: View;
    onViewChange?: (view: View) => void;
    showViewToggle?: boolean;
}

export function Header({ onNewTask, activeView = 'queue', onViewChange, showViewToggle = !!onViewChange }: HeaderProps) {
    return (
        <header className="h-12 bg-black border-b border-white/10 flex items-center justify-between px-4 select-none">
            <div className="flex items-center gap-4">
                <span className="text-sm font-semibold text-white tracking-tight">Agent Manager</span>
                {showViewToggle && (
                    <>
                        <span className="text-gray-700">/</span>
                        <div className="flex items-center gap-px bg-white/5 border border-white/5 rounded-md overflow-hidden">
                            <button
                                onClick={() => onViewChange?.('queue')}
                                className={`px-3 py-1 text-sm flex items-center gap-1.5 transition-colors ${activeView === 'queue'
                                        ? 'bg-white text-black font-medium'
                                        : 'bg-transparent text-gray-400 hover:text-white hover:bg-white/5'
                                    }`}
                            >
                                <ListTodo size={14} />
                                Queue
                            </button>
                            <button
                                onClick={() => onViewChange?.('sessions')}
                                className={`px-3 py-1 text-sm flex items-center gap-1.5 transition-colors ${activeView === 'sessions'
                                        ? 'bg-white text-black font-medium'
                                        : 'bg-transparent text-gray-400 hover:text-white hover:bg-white/5'
                                    }`}
                            >
                                <Monitor size={14} />
                                Sessions
                            </button>
                        </div>
                    </>
                )}
            </div>

            {/* Middle - Search/Command Palette trigger */}
            <div className="flex-1 max-w-xl mx-4">
                <button className="w-full bg-black hover:bg-white/5 text-left px-3 py-1.5 text-sm text-gray-500 border border-white/10 rounded-md flex items-center gap-2 transition-colors group hover:border-gray-600">
                    <Search size={14} className="group-hover:text-gray-300" />
                    <span className="group-hover:text-gray-300">Search or jump to...</span>
                    <span className="ml-auto text-xs text-gray-600 border border-white/10 px-1 rounded group-hover:text-gray-400 group-hover:border-gray-500">⌘K</span>
                </button>
            </div>

            <div className="flex items-center gap-3">
                <button className="text-gray-500 hover:text-white transition-colors">
                    <Bell size={18} />
                </button>
                <button
                    onClick={onNewTask}
                    className="bg-white hover:bg-gray-200 text-black text-xs font-semibold px-3 py-1.5 rounded-sm flex items-center gap-1 transition-colors"
                >
                    <Plus size={14} />
                    New Task
                </button>
            </div>
        </header>
    );
}
