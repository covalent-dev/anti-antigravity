import { LayoutGrid, Cpu, Terminal, BookOpen, Settings, Hexagon } from 'lucide-react';
import { clsx } from 'clsx';

export type SidebarView = 'dashboard' | 'system' | 'terminal' | 'docs' | 'settings';

interface SidebarItemProps {
    icon: React.ElementType;
    label: string;
    active?: boolean;
    onClick?: () => void;
}

function SidebarItem({ icon: Icon, label, active, onClick }: SidebarItemProps) {
    return (
        <button
            type="button"
            aria-label={label}
            title={label}
            onClick={onClick}
            className={clsx(
                "p-3 cursor-pointer transition-colors rounded-lg",
                active
                    ? "text-white bg-white/10"
                    : "text-gray-500 hover:text-white hover:bg-white/5"
            )}
        >
            <Icon size={24} strokeWidth={1.5} />
        </button>
    );
}

interface SidebarProps {
    activeView: SidebarView;
    onViewChange: (view: SidebarView) => void;
}

export function Sidebar({ activeView, onViewChange }: SidebarProps) {
    return (
        <aside className="w-16 bg-black flex flex-col items-center py-4 border-r border-[#2b2b2b] h-screen select-none">
            {/* Brand / Logo */}
            <button
                type="button"
                aria-label="Dashboard"
                title="Dashboard"
                onClick={() => onViewChange('dashboard')}
                className="mb-6 text-blue-500"
            >
                <Hexagon size={28} strokeWidth={2} />
            </button>

            <nav className="flex-1 flex flex-col gap-2 w-full">
                <SidebarItem
                    icon={LayoutGrid}
                    label="Dashboard"
                    active={activeView === 'dashboard'}
                    onClick={() => onViewChange('dashboard')}
                />
                <SidebarItem
                    icon={Cpu}
                    label="System"
                    active={activeView === 'system'}
                    onClick={() => onViewChange('system')}
                />
                <SidebarItem
                    icon={Terminal}
                    label="Terminal"
                    active={activeView === 'terminal'}
                    onClick={() => onViewChange('terminal')}
                />
                <SidebarItem
                    icon={BookOpen}
                    label="Docs"
                    active={activeView === 'docs'}
                    onClick={() => onViewChange('docs')}
                />
            </nav>

            <div className="flex flex-col gap-2 w-full">
                <SidebarItem
                    icon={Settings}
                    label="Settings"
                    active={activeView === 'settings'}
                    onClick={() => onViewChange('settings')}
                />
            </div>
        </aside>
    );
}
