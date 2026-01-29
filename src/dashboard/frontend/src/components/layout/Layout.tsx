import { useState } from 'react';
import { Sidebar, type SidebarView } from './Sidebar';
import { Header } from './Header';

type View = 'sessions' | 'queue';

interface LayoutProps {
    children: React.ReactNode;
    onNewTask?: () => void;
    activeView?: View;
    onViewChange?: (view: View) => void;
}

export function Layout({ children, onNewTask, activeView = 'queue', onViewChange }: LayoutProps) {
    const [activeSidebarView, setActiveSidebarView] = useState<SidebarView>('dashboard');

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
