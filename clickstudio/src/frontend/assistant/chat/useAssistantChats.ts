import { useEffect, useRef, useState } from 'react';
import {
    MAX_ASSISTANT_CHAT_TITLE_LENGTH,
    assistantChatsStorageKey,
    createAssistantChat,
    createAssistantChatState,
    loadAssistantChatState,
    type AssistantChat,
    type AssistantChatState,
} from './assistant-chat-state';

export function useAssistantChats(connectionId: string) {
    const key = assistantChatsStorageKey(connectionId);
    const [loaded] = useState(() => loadAssistantChatState(key));
    const [state, setState] = useState<AssistantChatState>(
        loaded.state ?? createAssistantChatState(),
    );
    const [storageError, setStorageError] = useState(loaded.error ?? '');
    const stateRef = useRef(state);
    stateRef.current = state;
    const activeChat = state.chats.find(chat => chat.id === state.activeChatId) ?? state.chats[0]!;

    useEffect(() => {
        try {
            localStorage.setItem(key, JSON.stringify(state));
            setStorageError('');
        } catch {
            setStorageError('Chat history could not be saved in this browser.');
        }
    }, [key, state]);

    useEffect(() => {
        const persist = () => {
            try {
                localStorage.setItem(key, JSON.stringify(stateRef.current));
            } catch {}
        };
        window.addEventListener('pagehide', persist);
        return () => window.removeEventListener('pagehide', persist);
    }, [key]);

    const updateChat = (chatId: string, update: (chat: AssistantChat) => AssistantChat) => {
        setState(current => ({
            ...current,
            chats: current.chats.map(chat => (chat.id === chatId ? update(chat) : chat)),
        }));
    };
    const selectChat = (chatId: string) => {
        setState(current =>
            current.chats.some(chat => chat.id === chatId)
                ? { ...current, activeChatId: chatId }
                : current,
        );
    };
    const renameChat = (chatId: string, title: string) => {
        const normalizedTitle = title.trim().slice(0, MAX_ASSISTANT_CHAT_TITLE_LENGTH);
        if (!normalizedTitle) return;
        updateChat(chatId, chat => ({ ...chat, title: normalizedTitle }));
    };
    const createChat = (force = false) => {
        if (!force && !activeChat.turns.length && activeChat.title === 'New chat')
            return activeChat.id;
        const chat = createAssistantChat();
        setState(current => ({
            ...current,
            activeChatId: chat.id,
            chats: [...current.chats, chat],
        }));
        return chat.id;
    };
    const deleteChat = (chatId: string) => {
        const replacement = createAssistantChat();
        setState(current => {
            const chats = current.chats.filter(chat => chat.id !== chatId);
            if (!chats.length)
                return { version: 1, activeChatId: replacement.id, chats: [replacement] };
            return {
                ...current,
                chats,
                activeChatId: current.activeChatId === chatId ? chats[0]!.id : current.activeChatId,
            };
        });
    };

    return {
        chats: state.chats,
        activeChat,
        storageError,
        updateChat,
        selectChat,
        renameChat,
        createChat,
        deleteChat,
    };
}
