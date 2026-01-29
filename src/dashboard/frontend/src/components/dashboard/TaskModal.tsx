import { Dialog } from '@headlessui/react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { fetchTemplates, createTask, createQuickTask, fetchTemplateDetail, type Template } from '../../api/client';
import { useState, useEffect } from 'react';
import { X, Play, Zap, FileText } from 'lucide-react';
import axios from 'axios';

type TaskMode = 'template' | 'freeform';

interface TaskModalProps {
    isOpen: boolean;
    onClose: () => void;
}

export function TaskModal({ isOpen, onClose }: TaskModalProps) {
    const [mode, setMode] = useState<TaskMode>('freeform');
    const [freeformPrompt, setFreeformPrompt] = useState('');
    const [selectedTemplate, setSelectedTemplate] = useState<string>('');
    const [fields, setFields] = useState<Record<string, string>>({});
    const [agent, setAgent] = useState('claude');
    const [model, setModel] = useState('sonnet');
    const [priority, setPriority] = useState('P2');
    const [launchImmediately, setLaunchImmediately] = useState(true);
    const [submitError, setSubmitError] = useState<string | null>(null);

    const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null;

    const getErrorMessage = (error: unknown) => {
        if (axios.isAxiosError(error)) {
            const data = error.response?.data;
            if (isRecord(data)) {
                const maybeMissing = data.missing;
                const maybeError = data.error;
                if (Array.isArray(maybeMissing) && maybeMissing.length > 0 && typeof maybeError === 'string') {
                    const missingStrings = maybeMissing.filter((m): m is string => typeof m === 'string');
                    if (missingStrings.length === maybeMissing.length) {
                        return `${maybeError}: ${missingStrings.join(', ')}`;
                    }
                }
                if (typeof maybeError === 'string') return maybeError;
                if (typeof data.message === 'string') return data.message;
            }
            return error.message || 'Request failed';
        }
        if (error instanceof Error) return error.message;
        return 'Something went wrong';
    };

    const { data: templates } = useQuery({ queryKey: ['templates'], queryFn: fetchTemplates });
    const { data: templateDetail } = useQuery({
        queryKey: ['template', selectedTemplate],
        queryFn: () => fetchTemplateDetail(selectedTemplate),
        enabled: !!selectedTemplate,
    });

    const queryClient = useQueryClient();

    const createMutation = useMutation({
        mutationFn: createTask,
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['queue'] });
            queryClient.invalidateQueries({ queryKey: ['sessions'] });
            setSubmitError(null);
            onClose();
            resetForm();
        },
        onError: (error) => setSubmitError(getErrorMessage(error)),
    });

    const quickMutation = useMutation({
        mutationFn: createQuickTask,
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['queue'] });
            queryClient.invalidateQueries({ queryKey: ['sessions'] });
            setSubmitError(null);
            onClose();
            resetForm();
        },
        onError: (error) => setSubmitError(getErrorMessage(error)),
    });

    const resetForm = () => {
        setFreeformPrompt('');
        setSelectedTemplate('');
        setFields({});
        setSubmitError(null);
    };

    useEffect(() => {
        if (templateDetail) {
            // Pre-fill fields or clear them
            // In a real app we might want to preserve some
        }
    }, [templateDetail]);

    const handleClose = () => {
        setSubmitError(null);
        onClose();
    };

    const handleSubmit = (e: React.FormEvent) => {
        e.preventDefault();
        setSubmitError(null);
        if (mode === 'freeform') {
            quickMutation.mutate({
                prompt: freeformPrompt,
                agent,
                model,
                priority,
                launch: launchImmediately,
            });
        } else {
            createMutation.mutate({
                template: selectedTemplate,
                fields,
                agent,
                model,
                priority,
                launch: launchImmediately,
            });
        }
    };

    const isPending = createMutation.isPending || quickMutation.isPending;

    return (
        <Dialog open={isOpen} onClose={handleClose} className="relative z-50 font-sans">
            {/* Solid overlay, no blur */}
            <div className="fixed inset-0 bg-black/80" aria-hidden="true" />

            <div className="fixed inset-0 flex items-center justify-center p-4">
                <Dialog.Panel className="w-full max-w-2xl bg-black border border-white/10 text-gray-200 flex flex-col max-h-[90vh] shadow-2xl">
                    <div className="flex justify-between items-center p-4 border-b border-white/10">
                        <Dialog.Title className="text-lg font-semibold text-white">Create New Task</Dialog.Title>
                        <button onClick={handleClose} className="text-gray-500 hover:text-white transition-colors">
                            <X size={20} />
                        </button>
                    </div>

                    <form onSubmit={handleSubmit} className="flex-1 overflow-y-auto p-6 space-y-6">
                        {/* Mode Toggle */}
                        <div className="flex gap-px p-1 bg-white/5 border border-white/5 rounded-lg overflow-hidden">
                            <button
                                type="button"
                                onClick={() => setMode('freeform')}
                                className={`flex-1 py-2 px-3 text-sm font-medium flex items-center justify-center gap-2 transition-colors ${mode === 'freeform'
                                        ? 'bg-zinc-800 text-white shadow-sm border border-zinc-700'
                                        : 'text-gray-400 hover:text-white hover:bg-white/5'
                                    }`}
                            >
                                <Zap size={14} />
                                Freeform
                            </button>
                            <button
                                type="button"
                                onClick={() => setMode('template')}
                                className={`flex-1 py-2 px-3 text-sm font-medium flex items-center justify-center gap-2 transition-colors ${mode === 'template'
                                        ? 'bg-zinc-800 text-white shadow-sm border border-zinc-700'
                                        : 'text-gray-400 hover:text-white hover:bg-white/5'
                                    }`}
                            >
                                <FileText size={14} />
                                Template
                            </button>
                        </div>

                        {/* Agent/Model/Priority Row */}
                        <div className="grid grid-cols-3 gap-4">
                            <div>
                                <label className="block text-xs font-semibold text-gray-400 mb-1">Agent</label>
                                <select
                                    value={agent}
                                    onChange={e => setAgent(e.target.value)}
                                    className="w-full bg-black border border-white/10 p-2 text-sm focus:border-white/30 outline-none rounded-md text-white"
                                >
                                    <option value="claude">Claude</option>
                                    <option value="codex">Codex</option>
                                    <option value="gemini">Gemini</option>
                                </select>
                            </div>
                            <div>
                                <label className="block text-xs font-semibold text-gray-400 mb-1">Model</label>
                                <select
                                    value={model}
                                    onChange={e => setModel(e.target.value)}
                                    className="w-full bg-black border border-white/10 p-2 text-sm focus:border-white/30 outline-none rounded-md text-white"
                                >
                                    <option value="sonnet">Sonnet</option>
                                    <option value="opus">Opus</option>
                                    <option value="gpt-4o">GPT-4o</option>
                                    <option value="o3">o3</option>
                                    <option value="gemini-2.5-pro">Gemini 2.5 Pro</option>
                                    <option value="gemini-2.5-flash">Gemini 2.5 Flash</option>
                                </select>
                            </div>
                            <div>
                                <label className="block text-xs font-semibold text-gray-400 mb-1">Priority</label>
                                <select
                                    value={priority}
                                    onChange={e => setPriority(e.target.value)}
                                    className="w-full bg-black border border-white/10 p-2 text-sm focus:border-white/30 outline-none rounded-md text-white"
                                >
                                    <option value="p0">P0 - Critical</option>
                                    <option value="p1">P1 - High</option>
                                    <option value="p2">P2 - Normal</option>
                                    <option value="p3">P3 - Low</option>
                                </select>
                            </div>
                        </div>

                        {/* Freeform Mode */}
                        {mode === 'freeform' && (
                            <div>
                                <label className="block text-xs font-semibold text-gray-400 mb-1">Task Description</label>
                                <textarea
                                    value={freeformPrompt}
                                    onChange={e => setFreeformPrompt(e.target.value)}
                                    rows={6}
                                    className="w-full bg-black border border-white/10 p-3 text-sm focus:border-white/30 outline-none placeholder-gray-600 resize-none rounded-md text-white"
                                    placeholder="Describe what you want the agent to do..."
                                    required
                                />
                            </div>
                        )}

                        {/* Template Mode */}
                        {mode === 'template' && (
                            <>
                                <div>
                                    <label className="block text-xs font-semibold text-gray-400 mb-1">Template</label>
                                    <select
                                        value={selectedTemplate}
                                        onChange={e => setSelectedTemplate(e.target.value)}
                                        className="w-full bg-black border border-white/10 p-2 text-sm focus:border-white/30 outline-none rounded-md text-white"
                                    >
                                        <option value="">Select template...</option>
                                        {templates?.map((t: Template) => (
                                            <option key={t.name} value={t.name}>{t.name}</option>
                                        ))}
                                    </select>
                                </div>

                                {templateDetail && (
                                    <div className="space-y-4 border-t border-white/10 pt-4">
                                        <h4 className="text-sm font-semibold text-blue-400">Template Fields</h4>
                                        {templateDetail.fields.filter(f => !f.auto).map(field => (
                                            <div key={field.name}>
                                                <label className="block text-xs font-semibold text-gray-400 mb-1">
                                                    {field.name} {field.required && <span className="text-red-400">*</span>}
                                                </label>
                                                <input
                                                    type="text"
                                                    required={field.required}
                                                    value={fields[field.name] || ''}
                                                    onChange={e => setFields(prev => ({ ...prev, [field.name]: e.target.value }))}
                                                    className="w-full bg-black border border-white/10 p-2 text-sm focus:border-white/30 outline-none placeholder-gray-600 rounded-md text-white"
                                                    placeholder={`Enter ${field.name}...`}
                                                />
                                            </div>
                                        ))}
                                    </div>
                                )}
                            </>
                        )}

                        {/* Launch Option */}
                        <label className="flex items-center gap-2 text-sm text-gray-400 cursor-pointer hover:text-white transition-colors">
                            <input
                                type="checkbox"
                                checked={launchImmediately}
                                onChange={e => setLaunchImmediately(e.target.checked)}
                                className="bg-black border border-gray-600 rounded-sm text-white focus:ring-0 checked:bg-zinc-600"
                            />
                            Launch immediately after creating
                        </label>

                        {submitError && (
                            <div className="text-sm text-red-200 border border-red-900/50 bg-red-950/30 rounded-md p-3">
                                {submitError}
                            </div>
                        )}
                    </form>

                    <div className="p-4 border-t border-white/10 flex justify-end gap-2 bg-black rounded-b-lg">
                        <button onClick={onClose} className="px-4 py-2 text-sm text-gray-400 hover:text-white transition-colors font-medium">
                            Cancel
                        </button>
                        <button
                            onClick={handleSubmit}
                            disabled={isPending}
                            className="px-4 py-2 bg-white hover:bg-gray-200 text-black text-sm font-medium flex items-center gap-2 transition-colors disabled:opacity-50 rounded-md shadow-sm"
                        >
                            <Play size={16} fill="currentColor" />
                            {isPending ? 'Creating...' : launchImmediately ? 'Create & Launch' : 'Create Task'}
                        </button>
                    </div>
                </Dialog.Panel>
            </div>
        </Dialog>
    );
}
