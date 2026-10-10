import { THEMES, ACCENT_CHOICES, EXPERIENCE_LEVELS, type AccentChoice } from './appearance-types';
import { useCallback, useEffect, useRef, useState } from 'react';
import { api, message, post } from './api';
import { Button, cx, Icon } from './components/ui';
import { CloudConnectionDialog } from './components/CloudConnectionDialog';
import {
    CLICKHOUSE_CLOUD_CONNECTION_ID,
    disconnectClickHouseCloud,
    restoreClickHouseCloudSession,
    type SavedCloudConnectionProfile,
} from './cloud-connection';
import { Workspace } from './Workspace';
import {
    experienceOptions,
    getCopy,
    resolveLocale,
    themeAppearance,
    themeOptions,
    type ExperienceLevel,
    type Locale,
    type Theme,
} from './i18n';
import { RadioGroup } from '@clickhouse/click-ui/RadioGroup';
import clickhouseLogomarkDark from './assets/clickhouse-logomark-dark.svg';
import clickhouseLogomarkLight from './assets/clickhouse-logomark-light.svg';
import type { Connected, Session } from './workspace-types';
import { resolveConnectionSelection } from '../shared/connection-selection';

const connectionLabel = (connection: Connected, demo: boolean) => {
    if (demo && connection.dataSource === 'fixture') {
        if (connection.id === 'demo') {
            return 'Sample data';
        }

        return 'Another sample';
    }

    return connection.name;
};
const storedPreference = (key: string): string | null => {
    try {
        return localStorage.getItem(key);
    } catch {
        return null;
    }
};
const pref = <T extends string>(key: string, values: readonly T[], fallback: T): T => {
    const value = storedPreference(key);
    return values.find(candidate => candidate === value) ?? fallback;
};
const browserLocales = (): readonly string[] => {
    if (typeof navigator === 'undefined') {
        return [];
    }

    if (navigator.languages.length) {
        return navigator.languages;
    }

    return [navigator.language];
};

function writeConnectionToUrl(id: string) {
    const url = new URL(window.location.href);
    if (id) url.searchParams.set('connection', id);
    else url.searchParams.delete('connection');
    window.history.replaceState(window.history.state, '', url);
}

function cloudProfileDefaults(connection?: Connected): SavedCloudConnectionProfile | undefined {
    if (!connection) return undefined;
    try {
        const host = new URL(connection.host);
        if (!host.hostname.toLowerCase().endsWith('.clickhouse.cloud')) return undefined;
        return { host: host.origin, database: connection.database, username: connection.username };
    } catch {
        return undefined;
    }
}

function App() {
    const [locale] = useState<Locale>(() =>
        resolveLocale(storedPreference('clickstudio:locale'), ...browserLocales()),
    );
    const [theme, setTheme] = useState<Theme>(() =>
        pref('clickstudio:theme', THEMES, 'click-dark'),
    );
    const [accent, setAccent] = useState<AccentChoice>(() =>
        pref('clickstudio:accent', ACCENT_CHOICES, 'cyan'),
    );
    const [experience, setExperience] = useState<ExperienceLevel>(() =>
        pref('clickstudio:experience', EXPERIENCE_LEVELS, 'beginner'),
    );
    const [session, setSession] = useState<Session>();
    const [connections, setConnections] = useState<Connected[]>([]);
    const [connectionId, setConnectionId] = useState(
        () => new URLSearchParams(location.search).get('connection') ?? '',
    );
    const [sessionError, setSessionError] = useState('');
    const [token, setToken] = useState('');
    const [busy, setBusy] = useState(false);
    const [connectionPicker, setConnectionPicker] = useState(false);
    const [cloudDialogOpen, setCloudDialogOpen] = useState(false);
    const [connectionActionBusy, setConnectionActionBusy] = useState(false);
    const [cloudConnectionError, setCloudConnectionError] = useState('');
    const trustActionRef = useRef<() => Promise<void>>(async () => undefined);
    const testConnectionActionRef = useRef<() => Promise<void>>(async () => undefined);
    const copy = getCopy(locale);
    const connection = connections.find(item => item.id === connectionId) ?? connections[0];
    const hasPreviewSourceSwitcher = Boolean(
        session?.demo && connections.some(item => item.id === 'playground'),
    );
    const hasCloudConnection = connections.some(item => item.id === CLICKHOUSE_CLOUD_CONNECTION_ID);
    const persistCloudInLocalServer = session?.cloudConnectionPersistence === 'local-server';
    const isSampleData = Boolean(session?.demo && connection?.dataSource === 'fixture');
    const isPlayground = Boolean(connection?.id === 'playground');
    const isCloudConnection = connection?.id === CLICKHOUSE_CLOUD_CONNECTION_ID;
    const otherConnections = connection
        ? connections.filter(
              item =>
                  item.id !== connection.id &&
                  (hasPreviewSourceSwitcher || !session?.demo || experience === 'expert'),
          )
        : [];
    const sourceChoices = hasPreviewSourceSwitcher
        ? connections
              .filter(
                  item =>
                      item.id === 'demo' ||
                      item.id === 'playground' ||
                      item.id === CLICKHOUSE_CLOUD_CONNECTION_ID,
              )
              .sort((left, right) => {
                  const rank = (id: string) => {
                      switch (id) {
                          case 'playground':
                              return 0;

                          case 'demo':
                              return 1;

                          default:
                              return 2;
                      }
                  };
                  return rank(left.id) - rank(right.id);
              })
        : otherConnections;
    const dark = themeAppearance[theme].dark;
    const selectConnection = useCallback((id: string) => {
        setConnectionId(id);
        writeConnectionToUrl(id);
    }, []);

    const disconnectCloud = async () => {
        setCloudConnectionError('');
        try {
            await disconnectClickHouseCloud();
        } catch (error) {
            setCloudConnectionError(`Could not disconnect Cloud: ${message(error)}`);
            return;
        }
        setConnections(current =>
            current.filter(item => item.id !== CLICKHOUSE_CLOUD_CONNECTION_ID),
        );
        if (isCloudConnection) {
            const fallback = connections.find(item => item.id === 'playground') ?? connections[0];
            if (fallback) selectConnection(fallback.id);
        }
        setConnectionPicker(false);
    };

    const connectCloud = (connected: Connected) => {
        setConnections(current => [...current.filter(item => item.id !== connected.id), connected]);
        setCloudConnectionError('');
        selectConnection(connected.id);
        setConnectionPicker(false);
        setCloudDialogOpen(false);
    };

    useEffect(() => {
        document.documentElement.dataset.theme = theme;
        document.documentElement.dataset.accent = accent;
        document.documentElement.lang = locale;
        document.documentElement.style.colorScheme = dark ? 'dark' : 'light';
        document
            .querySelector('meta[name="theme-color"]')
            ?.setAttribute('content', themeAppearance[theme].chromeColor);
        try {
            localStorage.setItem('clickstudio:theme', theme);
            localStorage.setItem('clickstudio:accent', accent);
            localStorage.setItem('clickstudio:locale', locale);
            localStorage.setItem('clickstudio:experience', experience);
        } catch {}
    }, [accent, dark, experience, locale, theme]);

    const loadSession = useCallback(async () => {
        const next = await api<Session>('/session');
        setSession(next);
        if (next.principal) {
            let profiles = await api<Connected[]>('/connections');
            if (next.cloudConnectionPersistence === 'local-server') {
                try {
                    const cloud = await restoreClickHouseCloudSession();
                    if (cloud)
                        profiles = [
                            ...profiles.filter(item => item.id !== CLICKHOUSE_CLOUD_CONNECTION_ID),
                            cloud,
                        ];
                    else
                        profiles = profiles.filter(
                            item => item.id !== CLICKHOUSE_CLOUD_CONNECTION_ID,
                        );
                    setCloudConnectionError('');
                } catch (error) {
                    setCloudConnectionError(
                        `Could not restore Cloud connection: ${message(error)}`,
                    );
                }
            }
            setConnections(profiles);
            const selected = resolveConnectionSelection(
                profiles,
                new URLSearchParams(location.search).get('connection') ?? '',
            );
            setConnectionId(selected);
            writeConnectionToUrl(selected);
        }
    }, []);

    useEffect(() => {
        void loadSession().catch(error => setSessionError(message(error)));
    }, [loadSession]);

    const login = async () => {
        if (!token || busy) return;
        setBusy(true);
        setSessionError('');
        try {
            await post('/session', { token });
            setToken('');
            await loadSession();
        } catch (error) {
            setSessionError(message(error));
        } finally {
            setBusy(false);
        }
    };

    const runConnectionAction = async (testConnection: boolean) => {
        if (connectionActionBusy) return;
        setConnectionActionBusy(true);
        try {
            await (testConnection ? testConnectionActionRef.current : trustActionRef.current)();
        } finally {
            setConnectionActionBusy(false);
        }
    };

    if (!session)
        return (
            <main className="auth-screen">
                <section className="auth-card animate-enter">
                    <Brand theme={theme} />
                    <span className="eyebrow mt-8">{copy.auth.privateWorkspace}</span>
                    <h1>{sessionError ? copy.auth.unavailable : copy.auth.opening}</h1>
                    {sessionError ? (
                        <>
                            <p>{sessionError}</p>
                            <Button
                                variant="primary"
                                onClick={() => {
                                    setSessionError('');
                                    void loadSession().catch(error =>
                                        setSessionError(message(error)),
                                    );
                                }}
                            >
                                {copy.auth.retry}
                            </Button>
                        </>
                    ) : (
                        <div className="splash-status">
                            <span className="loading-orbit" />
                            <p>{copy.auth.opening}</p>
                        </div>
                    )}
                </section>
            </main>
        );
    if (!session.principal)
        return (
            <main className="auth-screen">
                <form
                    className="auth-card animate-enter"
                    onSubmit={event => {
                        event.preventDefault();
                        void login();
                    }}
                >
                    <Brand theme={theme} />
                    <span className="eyebrow mt-8">{copy.auth.privateWorkspace}</span>
                    <h1>{copy.auth.title}</h1>
                    <p>{copy.auth.description}</p>
                    <label className="field-label">
                        {copy.auth.token}
                        <input
                            className="field-input mt-2"
                            type="password"
                            autoComplete="current-password"
                            value={token}
                            onChange={event => setToken(event.target.value)}
                            autoFocus
                        />
                    </label>
                    {sessionError && <div className="callout callout-error">{sessionError}</div>}
                    <Button
                        variant="primary"
                        type="submit"
                        disabled={busy || !token}
                        className="mt-4 w-full"
                    >
                        {busy ? copy.auth.opening : copy.auth.open}
                        <span className="button-arrow">↗</span>
                    </Button>
                    <div className="auth-footnote">
                        <Icon name="lock" /> {copy.auth.credentialsNotice}
                    </div>
                </form>
            </main>
        );

    const connectionNeedsTest = Boolean(connection && !session.demo && !connection.manifest);
    let connectionStatus:
        'Connected · read/write' | 'Retest needed' | 'Read-only' | 'Review needed' | 'Test needed';

    if (isCloudConnection) {
        connectionStatus = 'Connected · read/write';
    } else if (connection?.trusted) {
        if (connectionNeedsTest) {
            connectionStatus = 'Retest needed';
        } else {
            connectionStatus = 'Read-only';
        }
    } else if (connection?.manifest) {
        connectionStatus = 'Review needed';
    } else {
        connectionStatus = 'Test needed';
    }

    return (
        <div className="application" data-experience={experience}>
            <header className="topbar">
                <Brand theme={theme} />
                <div className="topbar-divider" />
                {renderConnectionPicker({
                    connectionPicker,
                    setConnectionPicker,
                    isSampleData,
                    isPlayground,
                    isCloudConnection,
                    connection,
                    copy,
                    session,
                    connectionNeedsTest,
                    connectionStatus,
                    hasPreviewSourceSwitcher,
                    persistCloudInLocalServer,
                    connectionActionBusy,
                    runConnectionAction,
                    sourceChoices,
                    selectConnection,
                    hasCloudConnection,
                    setCloudDialogOpen,
                })}
                {hasCloudConnection ? (
                    <div className="cloud-connection-actions">
                        <Button
                            variant="danger"
                            className="cloud-topbar-action cloud-topbar-disconnect"
                            onClick={() => void disconnectCloud()}
                        >
                            Disconnect Cloud
                        </Button>
                    </div>
                ) : (
                    (!session.demo || hasPreviewSourceSwitcher) && (
                        <div className="cloud-connection-actions">
                            <Button
                                variant="secondary"
                                className="cloud-topbar-action cloud-topbar-connect"
                                onClick={() => {
                                    setConnectionPicker(false);
                                    setCloudDialogOpen(true);
                                }}
                            >
                                Connect Cloud
                            </Button>
                        </div>
                    )
                )}
                <div className="topbar-spacer" />
                {renderAppearanceControls({
                    copy,
                    experience,
                    setExperience,
                    accent,
                    setAccent,
                    theme,
                    setTheme,
                })}
            </header>
            {cloudConnectionError && (
                <div className="callout callout-error cloud-session-error" role="alert">
                    {cloudConnectionError}
                </div>
            )}
            {connection ? (
                <Workspace
                    key={connection.id}
                    connection={connection}
                    connectionLabel={connectionLabel(connection, session.demo)}
                    connections={connections}
                    onSelectConnection={selectConnection}
                    onRefreshConnections={async () => {
                        const latest = await api<Connected[]>('/connections');
                        setConnections(latest);
                    }}
                    trustActionRef={trustActionRef}
                    testConnectionActionRef={testConnectionActionRef}
                    demoMode={session.demo}
                    experience={experience}
                    nativeParserEnabled
                    dark={dark}
                    copy={copy}
                    locale={locale}
                />
            ) : (
                <div className="empty-connection">
                    <Icon name="schema" />
                    <h1>{copy.app.name}</h1>
                    <p>No connection profiles are configured for this workspace.</p>
                </div>
            )}
            {cloudDialogOpen && (
                <CloudConnectionDialog
                    initialProfile={cloudProfileDefaults(connection)}
                    persistInLocalServer={persistCloudInLocalServer}
                    onClose={() => setCloudDialogOpen(false)}
                    onConnect={connectCloud}
                />
            )}
        </div>
    );
}

function renderConnectionPicker({
    connectionPicker,
    setConnectionPicker,
    isSampleData,
    isPlayground,
    isCloudConnection,
    connection,
    copy,
    session,
    connectionNeedsTest,
    connectionStatus,
    hasPreviewSourceSwitcher,
    persistCloudInLocalServer,
    connectionActionBusy,
    runConnectionAction,
    sourceChoices,
    selectConnection,
    hasCloudConnection,
    setCloudDialogOpen,
}: {
    connectionPicker: boolean;
    setConnectionPicker: import('react').Dispatch<import('react').SetStateAction<boolean>>;
    isSampleData: boolean;
    isPlayground: boolean;
    isCloudConnection: boolean;
    connection: Connected | undefined;
    copy: ReturnType<typeof getCopy>;
    session: Session;
    connectionNeedsTest: boolean;
    connectionStatus:
        'Connected · read/write' | 'Retest needed' | 'Read-only' | 'Review needed' | 'Test needed';
    hasPreviewSourceSwitcher: boolean;
    persistCloudInLocalServer: boolean;
    connectionActionBusy: boolean;
    runConnectionAction: (testConnection: boolean) => Promise<void>;
    sourceChoices: Connected[];
    selectConnection: (id: string) => void;
    hasCloudConnection: boolean;
    setCloudDialogOpen: import('react').Dispatch<import('react').SetStateAction<boolean>>;
}) {
    const getSourceDescription = () => {
        if (isSampleData) {
            return 'Sample rows are generated in this browser.';
        }

        if (isPlayground) {
            return 'SQL runs on the public ClickHouse Playground with read-only access.';
        }

        return undefined;
    };
    const getSourceBadge = () => {
        if (isSampleData) {
            return 'SAMPLE DATA';
        }

        if (isPlayground) {
            return 'PLAYGROUND';
        }

        if (isCloudConnection) {
            return 'CLICKHOUSE CLOUD';
        }

        return 'LIVE CONNECTION';
    };
    const getConnectionLabel = () => {
        if (connection) {
            if (isPlayground) {
                return 'ClickHouse';
            }

            return connectionLabel(connection, session.demo);
        }

        return 'Choose connection';
    };
    const getConnectionDetails = (connection: Connected) => {
        if (isSampleData) {
            return 'Generated sample data · SQL stays in this browser';
        }

        if (isPlayground) {
            return `${connection.host} · public read-only access`;
        }

        if (isCloudConnection) {
            return `${connection.host} · ${connection.database} · ${persistCloudInLocalServer ? 'local server session' : 'password held in this tab'}`;
        }

        if (session.demo) {
            return 'Local sample data';
        }

        return `Database: ${connection.database} · Server: ${connection.host}`;
    };
    const getConnectionTone = (connection: Connected) => {
        if (isSampleData) {
            return 'is-sample';
        }

        if (isPlayground || (connection.trusted && !connectionNeedsTest)) {
            return 'is-ready';
        }

        return 'is-review';
    };
    const getConnectionHelp = (connection: Connected) => {
        if (isSampleData) {
            return 'Sample rows are generated for the preview. SQL is not sent to a database.';
        }

        if (isPlayground) {
            return 'Queries run against the public ClickHouse SQL Playground. Access is read only.';
        }

        if (isCloudConnection) {
            return 'Queries pass through this site to your Cloud service over HTTPS. Your Cloud user controls which reads and writes are allowed.';
        }

        if (session.demo) {
            return 'This demo uses sample data. Your SQL is not sent to a real database.';
        }

        if (connectionNeedsTest) {
            if (connection.trusted) {
                return 'Read-only access is on, but this server needs a fresh capability check.';
            }

            return 'Test this connection to discover its ClickHouse features.';
        }

        if (connection.trusted) {
            return 'Read-only access is on. Queries can read data but cannot change it.';
        }

        return 'Connection tested. Turn on read-only access when you are ready to query.';
    };
    const getConnectionActionLabel = (connection: Connected) => {
        if (connectionActionBusy) {
            if (connectionNeedsTest) {
                return 'Testing…';
            }

            return 'Saving…';
        }

        if (session.demo) {
            return 'Start exploring';
        }

        if (connectionNeedsTest) {
            if (connection.trusted) {
                return 'Retest connection';
            }

            return 'Test connection';
        }

        if (connection.trusted) {
            return 'Turn off read-only access';
        }

        return 'Trust connection';
    };
    return (
        <div className="connection-wrap">
            <button
                className="connection-trigger"
                type="button"
                aria-haspopup="dialog"
                aria-expanded={connectionPicker}
                aria-controls="connection-menu"
                onClick={() => setConnectionPicker(value => !value)}
            >
                <span
                    className={cx(
                        'connection-env',
                        isSampleData && 'is-demo',
                        isPlayground && 'is-playground',
                        isCloudConnection && 'is-cloud',
                    )}
                    title={getSourceDescription()}
                >
                    <span
                        className={cx(
                            'status-light',
                            isSampleData || !connection?.trusted ? 'is-warning' : 'is-trusted',
                        )}
                    />
                    {getSourceBadge()}
                </span>
                {isPlayground && (
                    <span className="connection-quick-status is-ready">{copy.common.readOnly}</span>
                )}
                {(!session.demo || isCloudConnection) && !isPlayground && (
                    <span
                        className={cx(
                            'connection-quick-status',
                            connection?.trusted && !connectionNeedsTest ? 'is-ready' : 'is-review',
                        )}
                    >
                        {connectionStatus}
                    </span>
                )}
                <strong title={connection?.name}>{getConnectionLabel()}</strong>
                <span className="connection-database">
                    {connection?.database ?? '—'} <Icon name="chevron" />
                </span>
            </button>
            {connectionPicker && connection && (
                <div
                    className="connection-menu animate-enter"
                    id="connection-menu"
                    role="dialog"
                    aria-label={
                        hasPreviewSourceSwitcher ? 'Data source options' : 'Connection details'
                    }
                >
                    <div className="connection-menu-content">
                        <div className="connection-menu-current">
                            <span className="connection-menu-heading">
                                {hasPreviewSourceSwitcher
                                    ? 'Current data source'
                                    : 'Current connection'}
                            </span>
                            <strong>{connectionLabel(connection, session.demo)}</strong>
                            <small>{getConnectionDetails(connection)}</small>
                        </div>
                        <p
                            className={cx('connection-menu-note', getConnectionTone(connection))}
                            role="status"
                        >
                            {getConnectionHelp(connection)}
                        </p>
                        {!isCloudConnection &&
                            ((!session.demo && !isPlayground) || !connection.trusted) && (
                                <Button
                                    variant={
                                        !session.demo && connection.trusted ? 'ghost' : 'primary'
                                    }
                                    className="connection-menu-action"
                                    disabled={connectionActionBusy}
                                    onClick={() => void runConnectionAction(connectionNeedsTest)}
                                >
                                    {getConnectionActionLabel(connection)}
                                </Button>
                            )}
                        {sourceChoices.length > 0 && (
                            <div className="connection-switch-list">
                                <span className="connection-menu-heading">
                                    {hasPreviewSourceSwitcher
                                        ? 'Choose data source'
                                        : 'Switch connection'}
                                </span>
                                {sourceChoices.map(item => {
                                    const getSourceDetails = () => {
                                        if (item.id === 'playground') {
                                            return 'Real ClickHouse · public read only';
                                        }

                                        if (item.dataSource === 'fixture') {
                                            return 'Generated sample rows · no database request';
                                        }

                                        return `${item.database} · ${item.host}`;
                                    };
                                    return (
                                        <button
                                            key={item.id}
                                            type="button"
                                            aria-pressed={item.id === connection.id}
                                            onClick={() => {
                                                selectConnection(item.id);
                                                setConnectionPicker(false);
                                            }}
                                        >
                                            <span>
                                                <strong>
                                                    {connectionLabel(item, session.demo)}
                                                </strong>
                                                <small>{getSourceDetails()}</small>
                                            </span>
                                            <span
                                                className="connection-choice-arrow"
                                                aria-hidden="true"
                                            >
                                                {item.id === connection.id ? '✓' : '›'}
                                            </span>
                                        </button>
                                    );
                                })}
                            </div>
                        )}
                    </div>
                    {hasCloudConnection && (
                        <div className="connection-menu-footer">
                            <Button
                                variant="secondary"
                                className="connection-menu-action cloud-connect-trigger"
                                onClick={() => {
                                    setConnectionPicker(false);
                                    setCloudDialogOpen(true);
                                }}
                            >
                                Change Cloud service
                            </Button>
                        </div>
                    )}
                </div>
            )}
        </div>
    );
}

function renderAppearanceControls({
    copy,
    experience,
    setExperience,
    accent,
    setAccent,
    theme,
    setTheme,
}: {
    copy: ReturnType<typeof getCopy>;
    experience: 'beginner' | 'expert';
    setExperience: import('react').Dispatch<import('react').SetStateAction<'beginner' | 'expert'>>;
    accent: 'cyan' | 'clickhouse-yellow';
    setAccent: import('react').Dispatch<
        import('react').SetStateAction<'cyan' | 'clickhouse-yellow'>
    >;
    theme: 'click-dark' | 'click-light';
    setTheme: import('react').Dispatch<
        import('react').SetStateAction<'click-dark' | 'click-light'>
    >;
}) {
    return (
        <div className="topbar-control-rail">
            <div className="experience-switch">
                <span className="mode-caption">{copy.common.workspaceMode}</span>
                <RadioGroup
                    className="navbar-mode-control"
                    value={experience}
                    onValueChange={value => {
                        const selected = experienceOptions(copy).find(
                            option => option.value === value,
                        );
                        if (selected) setExperience(selected.value);
                    }}
                    aria-label={copy.common.workspaceMode}
                    inline
                    orientation="horizontal"
                    dir="end"
                >
                    <RadioGroup.Item
                        value="beginner"
                        className={`navbar-mode-option is-beginner ${experience === 'beginner' ? 'is-active' : ''}`}
                        label={copy.app.beginner}
                    />
                    <RadioGroup.Item
                        value="expert"
                        className={`navbar-mode-option is-expert ${experience === 'expert' ? 'is-active' : ''}`}
                        label={copy.app.expert}
                    />
                </RadioGroup>
            </div>
            <div className="topbar-preferences">
                <div className="accent-mode-control" role="group" aria-label={copy.app.accent}>
                    <button
                        type="button"
                        className={`accent-mode-option ${accent === 'cyan' ? 'is-active' : ''}`}
                        aria-label={copy.app.cyanAccent}
                        aria-pressed={accent === 'cyan'}
                        title={copy.app.cyanAccent}
                        onClick={() => setAccent('cyan')}
                    >
                        <span className="accent-mode-swatch is-cyan" aria-hidden="true" />
                    </button>
                    <button
                        type="button"
                        className={`accent-mode-option ${accent === 'clickhouse-yellow' ? 'is-active' : ''}`}
                        aria-label={copy.app.clickhouseYellowAccent}
                        aria-pressed={accent === 'clickhouse-yellow'}
                        title={copy.app.clickhouseYellowAccent}
                        onClick={() => setAccent('clickhouse-yellow')}
                    >
                        <span
                            className="accent-mode-swatch is-clickhouse-yellow"
                            aria-hidden="true"
                        />
                    </button>
                </div>
                <div className="experience-switch theme-switch">
                    <div
                        className="theme-mode-control"
                        role="radiogroup"
                        aria-label={copy.app.theme}
                    >
                        {themeOptions(copy).map(option => (
                            <label
                                key={option.value}
                                className={`theme-mode-option ${theme === option.value ? 'is-active' : ''}`}
                                title={option.label}
                            >
                                <input
                                    type="radio"
                                    name="clickstudio-theme"
                                    value={option.value}
                                    checked={theme === option.value}
                                    aria-label={option.label}
                                    onChange={() => setTheme(option.value)}
                                />
                                <Icon
                                    name={option.value === 'click-dark' ? 'moon' : 'sun'}
                                    className="theme-mode-icon"
                                />
                            </label>
                        ))}
                    </div>
                </div>
            </div>
        </div>
    );
}

function Brand({ theme }: { theme: Theme }) {
    const logo = themeAppearance[theme].dark ? clickhouseLogomarkDark : clickhouseLogomarkLight;
    return (
        <div className="brand-lockup">
            <img className="brand-symbol" src={logo} alt="ClickHouse" />
            <span className="brand-name">
                Click<span>Studio</span>
                <small>CLICKHOUSE WORKSPACE</small>
            </span>
        </div>
    );
}

export default App;
