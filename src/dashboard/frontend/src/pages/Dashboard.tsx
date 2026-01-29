import { useState } from 'react';
import { SessionBoard } from '../components/dashboard/SessionBoard';
import { TaskQueue } from '../components/dashboard/TaskQueue';
import { Layout } from '../components/layout/Layout';
import { TaskModal } from '../components/dashboard/TaskModal';

type View = 'sessions' | 'queue';

export function Dashboard() {
    const [isTaskModalOpen, setIsTaskModalOpen] = useState(false);
    const [activeView, setActiveView] = useState<View>('queue');
    const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null);

    return (
        <Layout
            onNewTask={() => setIsTaskModalOpen(true)}
            activeView={activeView}
            onViewChange={setActiveView}
            onSelectTask={setSelectedTaskId}
        >
            {activeView === 'sessions' && <SessionBoard />}
            {activeView === 'queue' && (
                <TaskQueue selectedTaskId={selectedTaskId} onSelectedTaskIdChange={setSelectedTaskId} />
            )}
            <TaskModal isOpen={isTaskModalOpen} onClose={() => setIsTaskModalOpen(false)} />
        </Layout>
    );
}
