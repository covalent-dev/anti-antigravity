import axios from 'axios';

export const api = axios.create({
    baseURL: '/api',
});

export type SessionStatus = 'idle' | 'working' | 'needs_input' | 'done' | 'error' | 'running';

export interface Session {
    id: string;
    agent_type: string;
    status: SessionStatus;
    message: string;
    progress?: {
        current: number;
        total: number;
        desc: string;
    };
    updated_at?: string;
}

export interface QueueItem {
    id: string;
    title: string;
    agent: string;
    priority: string;
    project?: string;
    created: string;
}

export interface QueueData {
    pending: QueueItem[];
    'in-progress': QueueItem[];
    blocked: QueueItem[];
    completed: QueueItem[];
}

export interface Template {
    name: string;
    path: string;
}

export interface TemplateDetail {
    name: string;
    content: string;
    fields: Array<{
        name: string;
        required: boolean;
        auto: boolean;
    }>;
}

export const fetchSessions = async () => {
    const { data } = await api.get<{ sessions: Session[] }>('/sessions');
    return data.sessions;
};

export const fetchQueue = async () => {
    const { data } = await api.get<QueueData>('/queue');
    return data;
};

export const fetchTemplates = async () => {
    const { data } = await api.get<{ templates: Template[] }>('/templates');
    return data.templates;
};

export const fetchTemplateDetail = async (name: string) => {
    const { data } = await api.get<TemplateDetail>(`/templates/${name}`);
    return data;
};

export const createTask = async (payload: any) => {
    const { data } = await api.post('/tasks', payload);
    return data;
};

export const killSession = async (sessionId: string) => {
    const { data } = await api.post(`/sessions/${sessionId}/kill`);
    return data;
};

export const killAllSessions = async () => {
    const { data } = await api.post(`/sessions/kill-all`);
    return data;
};

// Freeform task creation
export const createQuickTask = async (payload: { prompt: string; agent?: string; model?: string; priority?: string; launch?: boolean }) => {
    const { data } = await api.post('/tasks/quick', payload);
    return data;
};

// Launch a task with optional model override
export const launchTask = async (taskId: string, model?: string) => {
    const { data } = await api.post(`/tasks/${taskId}/launch`, { model });
    return data;
};

// Get task detail
export const getTaskDetail = async (taskId: string) => {
    const { data } = await api.get(`/tasks/${taskId}`);
    return data;
};

// Move task (e.g., to blocked, back to pending)
export const moveTask = async (taskId: string, target: 'pending' | 'blocked' | 'completed') => {
    const { data } = await api.post(`/tasks/${taskId}/move`, { target });
    return data;
};
