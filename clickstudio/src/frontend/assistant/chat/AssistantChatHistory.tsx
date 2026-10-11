import { useEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from 'react';
import { MAX_ASSISTANT_CHAT_TITLE_LENGTH, type AssistantChat } from './assistant-chat-state';
import { OverlayPortal } from '../../common/components/OverlayPortal';
import { Button } from '../../common/components/ui';
import { Icon } from '../../common/components/icons';

export type AssistantChatHistoryProps = {
    chats: readonly AssistantChat[];
    activeChatId: string;
    onNewChat: () => void;
    onSelectChat: (chatId: string) => void;
    onRenameChat: (chatId: string, title: string) => void;
    onDeleteChat: (chatId: string) => void;
};

export function AssistantChatHistory({
    chats,
    activeChatId,
    onNewChat,
    onSelectChat,
    onRenameChat,
    onDeleteChat,
}: AssistantChatHistoryProps) {
    const historyRef = useRef<HTMLDivElement>(null);
    const historyTriggerRef = useRef<HTMLButtonElement>(null);
    const selectButtonsRef = useRef(new Map<string, HTMLButtonElement>());
    const actionButtonsRef = useRef(new Map<string, HTMLButtonElement>());
    const deleteButtonsRef = useRef(new Map<string, HTMLButtonElement>());
    const deleteDialogRef = useRef<HTMLElement>(null);
    const [historyOpen, setHistoryOpen] = useState(false);
    const [actionsChatId, setActionsChatId] = useState<string | null>(null);
    const [renamingChatId, setRenamingChatId] = useState<string | null>(null);
    const [pendingDeleteChat, setPendingDeleteChat] = useState<AssistantChat | null>(null);
    const [renameValue, setRenameValue] = useState('');
    const [search, setSearch] = useState('');
    const activeChat = chats.find(chat => chat.id === activeChatId);
    const orderedChats = [...chats].sort((left, right) =>
        right.updatedAt.localeCompare(left.updatedAt),
    );
    const visibleChats = orderedChats.filter(chat =>
        chat.title.toLowerCase().includes(search.trim().toLowerCase()),
    );

    useEffect(() => {
        if (!historyOpen) return;
        const closeOnOutsidePointer = (event: PointerEvent) => {
            if (
                !pendingDeleteChat &&
                event.target instanceof Node &&
                !historyRef.current?.contains(event.target)
            ) {
                setHistoryOpen(false);
                setActionsChatId(null);
                setRenamingChatId(null);
            }
        };
        document.addEventListener('pointerdown', closeOnOutsidePointer);
        return () => document.removeEventListener('pointerdown', closeOnOutsidePointer);
    }, [historyOpen, pendingDeleteChat]);

    const focusHistoryTrigger = () =>
        window.requestAnimationFrame(() => historyTriggerRef.current?.focus());
    const closeHistory = () => {
        setHistoryOpen(false);
        setActionsChatId(null);
        setRenamingChatId(null);
    };
    const handleKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
        if (event.key !== 'Escape' || !historyOpen) return;
        event.preventDefault();
        event.stopPropagation();
        if (actionsChatId) {
            const chatId = actionsChatId;
            setActionsChatId(null);
            window.requestAnimationFrame(() => actionButtonsRef.current.get(chatId)?.focus());
        } else if (renamingChatId) {
            const chatId = renamingChatId;
            setRenamingChatId(null);
            setRenameValue('');
            window.requestAnimationFrame(() => selectButtonsRef.current.get(chatId)?.focus());
        } else {
            setHistoryOpen(false);
            historyTriggerRef.current?.focus();
        }
    };
    const selectChat = (chatId: string) => {
        onSelectChat(chatId);
        closeHistory();
        setSearch('');
        focusHistoryTrigger();
    };
    const startRename = (chatId: string, title: string) => {
        setRenameValue(title);
        setActionsChatId(null);
        setRenamingChatId(chatId);
    };
    const cancelRename = (chatId: string) => {
        setRenamingChatId(null);
        setRenameValue('');
        window.requestAnimationFrame(() => selectButtonsRef.current.get(chatId)?.focus());
    };
    const saveRename = (chatId: string) => {
        if (!renameValue.trim()) return;
        onRenameChat(chatId, renameValue);
        setRenamingChatId(null);
        setRenameValue('');
        window.requestAnimationFrame(() => selectButtonsRef.current.get(chatId)?.focus());
    };
    const requestDeleteChat = (chatId: string) => {
        const chat = chats.find(item => item.id === chatId);
        if (chat) setPendingDeleteChat(chat);
    };
    const cancelDeleteChat = () => {
        const chatId = pendingDeleteChat?.id;
        setPendingDeleteChat(null);
        window.requestAnimationFrame(() => {
            const deleteButton = chatId ? deleteButtonsRef.current.get(chatId) : undefined;
            if (deleteButton?.isConnected) deleteButton.focus();
            else historyTriggerRef.current?.focus();
        });
    };
    const confirmDeleteChat = () => {
        if (!pendingDeleteChat) return;
        onDeleteChat(pendingDeleteChat.id);
        setActionsChatId(null);
        setPendingDeleteChat(null);
        focusHistoryTrigger();
    };
    const handleDeleteDialogKeyDown = (event: ReactKeyboardEvent<HTMLElement>) => {
        if (event.key === 'Escape') {
            event.preventDefault();
            event.stopPropagation();
            cancelDeleteChat();
            return;
        }
        if (event.key !== 'Tab') return;
        const controls = [
            ...(deleteDialogRef.current?.querySelectorAll<HTMLButtonElement>(
                'button:not(:disabled)',
            ) ?? []),
        ];
        const first = controls[0],
            last = controls.at(-1),
            active = document.activeElement;
        if (event.shiftKey && active === first) {
            event.preventDefault();
            last?.focus();
        } else if (!event.shiftKey && active === last) {
            event.preventDefault();
            first?.focus();
        } else if (!controls.some(control => control === active)) {
            event.preventDefault();
            (event.shiftKey ? last : first)?.focus();
        }
    };

    return (
        <div
            className="assistant-chat-toolbar"
            onKeyDown={event => {
                if (!pendingDeleteChat) handleKeyDown(event);
            }}
            onBlur={event => {
                if (pendingDeleteChat) return;
                const nextFocus = event.relatedTarget;
                if (!(nextFocus instanceof Node) || !historyRef.current?.contains(nextFocus))
                    closeHistory();
            }}
        >
            <div className="assistant-chat-switcher" ref={historyRef}>
                <button
                    ref={historyTriggerRef}
                    type="button"
                    className="button-base button-secondary assistant-chat-history-trigger"
                    aria-label={`Chat history: ${activeChat?.title ?? 'New chat'}`}
                    aria-expanded={historyOpen}
                    aria-controls="assistant-chat-history"
                    onClick={() => {
                        setHistoryOpen(open => !open);
                        setActionsChatId(null);
                        setRenamingChatId(null);
                    }}
                    title={activeChat?.title ?? 'New chat'}
                >
                    <span>{activeChat?.title ?? 'New chat'}</span>
                    <Icon name="chevron" />
                </button>
                <div
                    id="assistant-chat-history"
                    className="assistant-chat-history-popover"
                    role="region"
                    aria-label="Chat history"
                    hidden={!historyOpen}
                >
                    <div className="assistant-chat-history-heading">
                        <strong>Recent chats</strong>
                        <span>{chats.length}</span>
                    </div>
                    {orderedChats.length > 8 && (
                        <label className="assistant-chat-search">
                            <Icon name="search" />
                            <input
                                type="search"
                                aria-label="Search conversations"
                                placeholder="Search conversations"
                                value={search}
                                onChange={event => setSearch(event.target.value)}
                            />
                        </label>
                    )}
                    <ul className="assistant-chat-history-list" aria-label="Conversations">
                        {visibleChats.map(chat => (
                            <li className="assistant-chat-history-item" key={chat.id}>
                                {renamingChatId === chat.id ? (
                                    <form
                                        className="assistant-chat-rename-inline"
                                        aria-label={`Rename ${chat.title}`}
                                        onSubmit={event => {
                                            event.preventDefault();
                                            saveRename(chat.id);
                                        }}
                                    >
                                        <input
                                            autoFocus
                                            aria-label={`New name for ${chat.title}`}
                                            value={renameValue}
                                            maxLength={MAX_ASSISTANT_CHAT_TITLE_LENGTH}
                                            onChange={event => setRenameValue(event.target.value)}
                                            onKeyDown={event => {
                                                if (event.key === 'Escape') {
                                                    event.preventDefault();
                                                    event.stopPropagation();
                                                    cancelRename(chat.id);
                                                }
                                            }}
                                        />
                                        <Button
                                            variant="primary"
                                            type="submit"
                                            aria-label="Save conversation name"
                                            title="Save name"
                                            disabled={!renameValue.trim()}
                                        >
                                            <Icon name="check" />
                                        </Button>
                                        <Button
                                            variant="ghost"
                                            aria-label="Cancel renaming"
                                            title="Cancel"
                                            onClick={() => cancelRename(chat.id)}
                                        >
                                            <Icon name="close" />
                                        </Button>
                                    </form>
                                ) : (
                                    <div className="assistant-chat-history-row">
                                        <button
                                            ref={element => {
                                                if (element)
                                                    selectButtonsRef.current.set(chat.id, element);
                                                else selectButtonsRef.current.delete(chat.id);
                                            }}
                                            type="button"
                                            className="assistant-chat-history-select"
                                            aria-current={
                                                chat.id === activeChatId ? 'page' : undefined
                                            }
                                            onClick={() => selectChat(chat.id)}
                                            title={chat.title}
                                        >
                                            <span>{chat.title}</span>
                                            {chat.id === activeChatId && (
                                                <>
                                                    <span className="sr-only">
                                                        Current conversation
                                                    </span>
                                                    <Icon name="check" />
                                                </>
                                            )}
                                        </button>
                                        <button
                                            ref={element => {
                                                if (element)
                                                    actionButtonsRef.current.set(chat.id, element);
                                                else actionButtonsRef.current.delete(chat.id);
                                            }}
                                            type="button"
                                            className="assistant-chat-history-actions-trigger"
                                            aria-label={`Actions for ${chat.title}`}
                                            aria-expanded={actionsChatId === chat.id}
                                            aria-controls={`assistant-chat-actions-${chat.id}`}
                                            onClick={() =>
                                                setActionsChatId(current =>
                                                    current === chat.id ? null : chat.id,
                                                )
                                            }
                                        >
                                            <Icon name="more" />
                                        </button>
                                    </div>
                                )}
                                <div
                                    id={`assistant-chat-actions-${chat.id}`}
                                    className="assistant-chat-row-actions"
                                    role="group"
                                    aria-label={`Actions for ${chat.title}`}
                                    hidden={actionsChatId !== chat.id || renamingChatId === chat.id}
                                >
                                    <Button
                                        variant="ghost"
                                        onClick={() => startRename(chat.id, chat.title)}
                                    >
                                        Rename
                                    </Button>
                                    <button
                                        type="button"
                                        className="button-base button-danger"
                                        ref={element => {
                                            if (element)
                                                deleteButtonsRef.current.set(chat.id, element);
                                            else deleteButtonsRef.current.delete(chat.id);
                                        }}
                                        onClick={() => requestDeleteChat(chat.id)}
                                    >
                                        Delete
                                    </button>
                                </div>
                            </li>
                        ))}
                        {!visibleChats.length && (
                            <li className="assistant-chat-history-empty">No matching chats.</li>
                        )}
                    </ul>
                </div>
            </div>
            <Button
                variant="secondary"
                className="assistant-new-chat-button"
                onClick={() => {
                    closeHistory();
                    setSearch('');
                    onNewChat();
                    focusHistoryTrigger();
                }}
            >
                <Icon name="plus" />
                New chat
            </Button>
            {pendingDeleteChat && (
                <OverlayPortal>
                    <div
                        className="assistant-chat-delete-layer"
                        onClick={event => {
                            if (event.target === event.currentTarget) cancelDeleteChat();
                        }}
                    >
                        <section
                            ref={deleteDialogRef}
                            role="alertdialog"
                            aria-modal="true"
                            aria-labelledby="assistant-chat-delete-title"
                            aria-describedby="assistant-chat-delete-description"
                            tabIndex={-1}
                            className="assistant-chat-delete-dialog"
                            onKeyDown={handleDeleteDialogKeyDown}
                        >
                            <h2 id="assistant-chat-delete-title">Delete this conversation?</h2>
                            <p id="assistant-chat-delete-description">
                                “{pendingDeleteChat.title}” and its messages will be removed from
                                this browser. This can’t be undone.
                            </p>
                            <div className="assistant-chat-delete-actions">
                                <Button variant="secondary" autoFocus onClick={cancelDeleteChat}>
                                    Cancel
                                </Button>
                                <Button variant="danger" onClick={confirmDeleteChat}>
                                    Delete conversation
                                </Button>
                            </div>
                        </section>
                    </div>
                </OverlayPortal>
            )}
        </div>
    );
}
