import { useEffect, useState } from 'react';
import { Sidebar, type SidebarView } from './Sidebar';
import { Header } from './Header';
import { CommandPalette } from './CommandPalette';

type View = 'sessions' | 'queue';

interface LayoutProps {
    children: React.ReactNode;
    onNewTask?: () => void;
    activeView?: View;
    onViewChange?: (view: View) => void;
    onSelectTask?: (taskId: string) => void;
}

function isEditableTarget(target: EventTarget | null) {
    if (!target) return false;
    if (!(target instanceof HTMLElement)) return false;
    if (target.isContentEditable) return true;
    const tag = target.tagName;
    return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT';
}

export function Layout({ children, onNewTask, activeView = 'queue', onViewChange, onSelectTask }: LayoutProps) {
    const [activeSidebarView, setActiveSidebarView] = useState<SidebarView>('dashboard');
    const [isCommandPaletteOpen, setIsCommandPaletteOpen] = useState(false);

    useEffect(() => {
        const onKeyDown = (event: KeyboardEvent) => {
            const key = event.key.toLowerCase();
            const isCmdK = (event.metaKey || event.ctrlKey) && key === 'k';
            if (!isCmdK) return;

            if (isCommandPaletteOpen) {
                event.preventDefault();
                setIsCommandPaletteOpen(false);
                return;
            }

            if (isEditableTarget(event.target)) return;
            event.preventDefault();
            setIsCommandPaletteOpen(true);
        };

        window.addEventListener('keydown', onKeyDown);
        return () => window.removeEventListener('keydown', onKeyDown);
    }, [isCommandPaletteOpen]);

    const commandPaletteViewChange = (view: View) => {
        setActiveSidebarView('dashboard');
        onViewChange?.(view);
    };

    const showPlaceholder = activeSidebarView !== 'dashboard';
    const placeholderTitle = (() => {
        switch (activeSidebarView) {
            case 'system':
                return 'System';
            case 'terminal':
                return 'Terminal';
            case 'docs':
                return 'Docs';
            case 'settings':
                return 'Settings';
            default:
                return 'View';
        }
    })();

    return (
        <div className="flex h-screen bg-black text-gray-300 overflow-hidden font-sans">
            <Sidebar activeView={activeSidebarView} onViewChange={setActiveSidebarView} />
            <div className="flex-1 flex flex-col min-w-0">
                <Header
                    onNewTask={onNewTask}
                    activeView={activeView}
                    onViewChange={activeSidebarView === 'dashboard' ? onViewChange : undefined}
                    showViewToggle={activeSidebarView === 'dashboard'}
                    onOpenCommandPalette={() => setIsCommandPaletteOpen(true)}
                />
                <main className="flex-1 overflow-auto bg-black relative">
                    {children}
                    {showPlaceholder && (
                        <div className="absolute inset-0 bg-black flex items-center justify-center">
                            <div className="max-w-lg w-full px-6">
                                <h2 className="text-xl font-semibold text-white tracking-tight">{placeholderTitle}</h2>
                                <p className="mt-2 text-sm text-gray-400">
                                    This section is a placeholder. Sidebar navigation is wired up, but this view is not implemented yet.
                                </p>
                            </div>
                        </div>
                    )}
                </main>
                <CommandPalette
                    open={isCommandPaletteOpen}
                    onOpenChange={setIsCommandPaletteOpen}
                    onNewTask={() => {
                        setActiveSidebarView('dashboard');
                        onNewTask?.();
                    }}
                    onViewChange={commandPaletteViewChange}
                    onSelectTask={(taskId) => {
                        setActiveSidebarView('dashboard');
                        onViewChange?.('queue');
                        onSelectTask?.(taskId);
                    }}
                />

                {/* Status Bar */}
                <footer className="h-6 bg-black border-t border-white/10 text-gray-500 flex items-center px-3 text-xs justify-between select-none font-sans">
                    <div className="flex items-center gap-4">
                        <span className="flex items-center gap-2">
                            <span className="w-1.5 h-1.5 bg-green-500 rounded-full"></span>
                            Connected to Localhost
                        </span>
                        <span>main*</span>
                    </div>
                    <div className="flex items-center gap-4">
                        <span>Ln 1, Col 1</span>
                        <span>UTF-8</span>
                        <span>TypeScript React</span>
                    </div>
                </footer>
            </div>
        </div>
    );
}
